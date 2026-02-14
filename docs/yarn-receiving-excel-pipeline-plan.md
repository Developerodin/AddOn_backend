# Yarn Receiving Excel Pipeline – Implementation Plan

## 1. Overview

**Goal:** One-shot flow: user provides **PO number(s)** and **one Excel file** (~1000 rows). The system runs the full receiving pipeline per PO until box creation and box weight/cone updates, with Excel data mapped by **brand** and by **count size + color + shade code** to PO items and yarn names.

**Pipeline (per PO):**
1. **Update to In-Transit** – Set status `in_transit` and add packing list (packing number, courier, vehicle, challan, dates, number of boxes, total weight, PO items).
2. **Add Lot to Packing List** – Add `receivedLotDetails` (lot number, number of cones, total weight, number of boxes, PO items with received quantity).
3. **Process / Generate Barcodes** – Call bulk box creation API to create boxes for each lot.
4. **Update Box Weight and Cones** – PATCH each created box with yarn name, shade code, box weight, number of cones (from Excel).

**Mapping rule:** Excel is grouped by **brand** first. For each brand, resolve to PO(s) whose supplier matches that brand. Then group Excel rows by **count size + color + shade code** → resolve to **yarn name** (via YarnCatalog). That yarn name must exist in the PO’s `poItems` for that supplier. Use that to fill packing list, received quantities, and box updates.

---

## 2. API Flow (Existing Endpoints)

| Step | Method | Endpoint | Purpose |
|------|--------|----------|---------|
| Resolve PO | GET | `/v1/yarn-management/yarn-purchase-orders?start_date=&end_date=` or by ID | Get PO by poNumber (need by poNumber) |
| 1a | PATCH | `/v1/yarn-management/yarn-purchase-orders/:purchaseOrderId` | Set `packListDetails` (one entry: packing info, poItems, totalWeight, numberOfBoxes). No receivedLotDetails yet. |
| 1b | PATCH | `/v1/yarn-management/yarn-purchase-orders/:purchaseOrderId/status` | Set `status_code: "in_transit"`, `updated_by`, `notes` |
| 2 | PATCH | `/v1/yarn-management/yarn-purchase-orders/:purchaseOrderId` | Add/update `packListDetails[].receivedLotDetails`: lotNumber, numberOfCones, totalWeight, numberOfBoxes, poItems[{ poItem, receivedQuantity }] |
| 3 | POST | `/v1/yarn-management/yarn-boxes/bulk` | Body: `{ poNumber, lotDetails: [{ lotNumber, numberOfBoxes }] }` – creates boxes (barcodes) |
| 4 | PATCH | `/v1/yarn-management/yarn-boxes/:yarnBoxId` | Update each box: `yarnName`, `shadeCode`, `boxWeight`, `numberOfCones` |

**Note:** Step 1 can be either (1a then 1b) or a single PATCH that sets both packListDetails and status; current API has status separate. Plan assumes: 1a → 1b → 2 → 3 → 4.

---

## 3. Excel Input (Assumed Structure)

Rough column set to support mapping and pipeline (to be confirmed with your actual sheet):

- **Brand** (or Supplier name) – to map to PO(s).
- **Count / Size** – e.g. 70/1, 20s.
- **Color** – color name.
- **Shade code** – e.g. WN96793.
- **Lot number** – e.g. EW1205.
- **Number of cones** (lot level).
- **Total weight** (lot level).
- **Number of boxes** (per lot).
- **Received quantity** – per PO line (may need one column per yarn or a key to PO item).

Optional/static:
- Packing number, courier name, courier number, vehicle number, challan number, dispatch date, estimated delivery date (can be same for whole file or per row).

If Excel has **one row per box**, then:
- Columns: Brand, Count size, Color, Shade code, Lot number, Box weight, Number of cones, (and possibly PO item key or yarn name).
- Aggregation: Group by (PO, lot, yarn) to get lot-level numberOfCones, totalWeight, numberOfBoxes, and per–PO-item receivedQuantity; then per-box rows for step 4.

---

## 4. Mapping: Brand → PO, and (Count + Color + Shade) → Yarn Name

1. **Brand → PO**
   - From Excel: distinct **Brand** values.
   - In DB: `YarnPurchaseOrder` has `supplier` (ObjectId) and `supplierName` (string). Supplier model has `brandName`.
   - Resolve: For each brand string from Excel, find `Supplier` by `brandName` (or normalized name), then find all `YarnPurchaseOrder` with that `supplier` and status suitable for receiving (e.g. `submitted_to_supplier` or as per business rule). Result: list of POs per brand.

2. **(Count size + Color + Shade code) → Yarn name**
   - YarnCatalog: has `countSize.name`, `colorFamily.name`, `pantonName`/`pantonShade`, and generated `yarnName` (format: `countSize-colour-pantonName-type/subtype`).
   - Resolve: For each Excel group (count size, color, shade code), query YarnCatalog (e.g. by countSize name, color name, pantonName/pantonShade or shade equivalent) to get exact `yarnName`. If multiple matches, prefer one that appears in the PO’s `poItems` (by `yarnName` or `yarn` ref).
   - Validation: Resolved yarn name must exist in the PO’s `poItems` for that supplier; else row is skipped or reported.

3. **PO item id**
   - From PO: `poItems` array; each item has `_id`, `yarnName`, `sizeCount`, `shadeCode`, etc.
   - Map: (yarnName, shadeCode) or (yarnName only) → `poItems[]._id` for received quantities and for pack list.

---

## 5. Static / Configurable Fields

- **Packing-level (one per upload or per PO):** packingNumber, courierName, courierNumber, vehicleNumber, challanNumber, dispatchDate, estimatedDeliveryDate. Can be:
  - Fixed in config/env,
  - Or single row in Excel (first row),
  - Or per-PO input in the API request (recommended for flexibility).
- **Status update:** `updated_by` from authenticated user; `notes` optional.

---

## 6. Implementation Components

### 6.1 Backend

1. **Get PO by poNumber**
   - Add `getPurchaseOrderByPoNumber(poNumber)` in `yarnPurchaseOrder.service.js` (or reuse existing findOne by poNumber).
   - Optionally expose GET by poNumber in route (e.g. `GET /yarn-purchase-orders/by-number/:poNumber`) so the pipeline can resolve PO from the list of PO numbers provided by the user.

2. **Yarn name resolution**
   - Add (or reuse) a helper that, given (countSize, color, shadeCode) and optionally supplier/PO context, returns:
     - `yarnName` from YarnCatalog,
     - and optionally the PO item `_id` if PO is passed (so we only allow yarns that exist on that PO).

3. **Excel parsing**
   - New module: e.g. `src/services/yarnManagement/yarnReceivingExcel.service.js`.
   - Use a library (e.g. `xlsx` or `exceljs`) to read the file (multipart upload or base64 in request).
   - Parse rows into a canonical list of records (brand, countSize, color, shadeCode, lotNumber, boxWeight, numberOfCones, etc.).
   - Normalize headers (trim, lowercase, map known aliases) so “Count Size” / “count size” / “CountSize” all work.

4. **Pipeline orchestration**
   - New: e.g. `yarnReceivingPipeline.service.js` (or inside `yarnReceivingExcel.service.js`).
   - Input: `{ poNumbers: string[], excelFile: Buffer | path, staticPacking?: {...}, updated_by }`.
   - For each `poNumber`:
     - Load PO by poNumber (get full PO with poItems).
     - Filter Excel rows by brand = PO’s supplier’s brandName.
     - Group filtered rows by (lotNumber, yarn key = countSize+color+shadeCode). For each group:
       - Resolve yarnName and PO item ids; skip or collect errors if not found.
       - Compute: numberOfBoxes, totalWeight, numberOfCones, and per–PO-item receivedQuantity (from Excel or derived).
     - Build one pack list entry per (packing set) and one receivedLotDetails per lot:
       - packingNumber, courierName, courierNumber, vehicleNumber, challanNumber, dispatchDate, estimatedDeliveryDate, numberOfBoxes, totalWeight, poItems (array of PO item _ids).
       - receivedLotDetails: lotNumber, numberOfCones, totalWeight, numberOfBoxes, poItems: [{ poItem, receivedQuantity }].
     - Call in order:
       1. PATCH PO with packListDetails (and merge receivedLotDetails into the same pack list entry if your API expects it that way; from your sample, receivedLotDetails sit inside the first pack list entry).
       2. PATCH PO status to `in_transit`.
       3. (If not already in step 1) PATCH PO again to add/update receivedLotDetails in packListDetails.
       4. POST yarn-boxes/bulk with `{ poNumber, lotDetails }`.
       5. For each created box (and matching Excel row by lot + yarn): PATCH yarn-boxes/:yarnBoxId with yarnName, shadeCode, boxWeight, numberOfCones.

   - Return: summary per PO (status, created boxes, failed rows, validation errors).

5. **New API endpoint** (implemented as JSON; frontend converts Excel to this payload)
   - `POST /v1/yarn-management/yarn-receiving/process`
   - Body: JSON `{ items: [{ poNumber, packing, lots }], notes? }`. Frontend converts Excel to this shape.
   - Auth: use existing auth middleware; `updated_by` set from `req.user`.
   - Handler: run pipeline for each item; return summary and any errors.
   - Full payload spec for frontend: `docs/yarn-receiving-api-payload.md`.

6. **Validation**
   - Joi schema: `items` array (each with `poNumber`, `lots`; optional `packing`, `notes`), optional top-level `notes`.
   - PO existence is checked inside the pipeline.

### 6.2 Frontend (if any)

- Upload form: PO number(s) (multi-select or comma-separated) + file input (Excel).
- Optional: display static packing fields (or take from config).
- On submit: call `POST .../yarn-receiving/process-excel`.
- Show progress/summary: which POs processed, boxes created, errors per row or per PO.

---

## 7. Data Flow Summary

```
Excel (Brand, Count, Color, Shade, Lot, Weight, Cones, Boxes, …)
       ↓
Group by Brand → resolve to PO(s) by supplier.brandName
       ↓
For each PO:
  Filter rows by PO’s brand
  Group by (Lot, Count+Color+Shade) → resolve to yarnName + PO item _id
       ↓
  Build packListDetails[0] + receivedLotDetails from aggregated groups
       ↓
  PATCH PO (packListDetails with receivedLotDetails)
  PATCH PO status → in_transit
  POST yarn-boxes/bulk (poNumber, lotDetails)
  For each box: PATCH yarn-boxes/:id (yarnName, shadeCode, boxWeight, numberOfCones)
       ↓
Response: per-PO result, created box ids, errors
```

---

## 8. Edge Cases and Validation

- **PO not found** for a given poNumber → skip or fail that PO, return in response.
- **Brand in Excel does not match any PO** → skip those rows or return warning.
- **(Count, color, shade) does not resolve to a yarn in YarnCatalog** → skip row, add to error list.
- **Resolved yarn not in PO’s poItems** → skip row or fail that PO, add to error list.
- **Boxes already exist** for (poNumber, lotNumber): bulk API currently skips that lot and returns existing; pipeline can either skip step 3 for that lot or still run step 4 for existing boxes (need to decide).
- **Duplicate lot in Excel** for same PO → aggregate (sum weights, cones, boxes; merge receivedQuantity per poItem).
- **Large Excel (~1000 rows):** process in memory with streaming parser if needed; consider batch reporting (e.g. first 100 errors) to avoid huge payloads.

---

## 9. File Structure (Proposed)

```
src/
  services/yarnManagement/
    yarnReceivingExcel.service.js   # parse Excel, group rows, resolve yarn names
    yarnReceivingPipeline.service.js # run steps 1–4 per PO (or merge into one service)
  controllers/yarnManagement/
    yarnReceiving.controller.js      # process-excel endpoint
  validations/
    yarnReceiving.validation.js     # poNumbers, file, staticPacking
  routes/v1/yarn/
    yarnReceiving.route.js          # POST /yarn-receiving/process-excel
```

Route mount in `routes/v1/index.js`: e.g. `path: '/yarn-management/yarn-receiving', route: yarnReceivingRoute`.

---

## 10. Dependencies

- Excel: add `xlsx` or `exceljs` (and optionally `multer` for multipart) if not already present.
- No change to existing yarn-purchase-orders or yarn-boxes APIs except possibly adding a GET-by-poNumber convenience.

---

## 11. Order of Implementation (Checklist)

1. [ ] Add `getPurchaseOrderByPoNumber` (or ensure PO can be loaded by poNumber in pipeline).
2. [ ] Add YarnCatalog lookup helper: (countSize, color, shadeCode) → yarnName; optional PO-scoped validation (yarn in poItems).
3. [ ] Add Excel parser: parse file → list of row objects with normalized keys; accept ~1000 rows.
4. [ ] Add pipeline service: given poNumbers + parsed rows + static packing, run steps 1a → 1b → 2 → 3 → 4 per PO; return summary and errors.
5. [ ] Add validation schema and `POST /yarn-receiving/process-excel` (multipart + JSON).
6. [ ] Wire route and auth; test with a small Excel and one PO number.
7. [ ] (Optional) GET PO by poNumber endpoint for easier testing.
8. [ ] (Optional) Frontend upload form and result display.

---

## 12. Open Points for You

1. **Exact Excel columns** – Confirm column names and whether data is one row per box or per lot (or mixed).
2. **Received quantity** – Is it per PO item per lot? How is it represented in Excel (one column per yarn, or one column with a key)?
3. **One packing list per PO or multiple** – Your sample had one packListDetails entry with one receivedLotDetails; confirm if one Excel file = one packing list per PO.
4. **Static packing** – Should all POs in one upload share the same packing/courier/challan/vehicle/dates, or do you want them per PO or from Excel?
5. **Box ↔ Excel row** – After bulk create, boxes are created without yarn name; we need a deterministic way to assign each box to an Excel row (e.g. order of boxes per lot matches order of rows in Excel for that lot, or a box index column in Excel).

Once you confirm these and approve this plan, implementation can follow the checklist above.
