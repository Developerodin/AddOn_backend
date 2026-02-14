# Yarn Receiving – How to Provide PO Numbers and Convert Excel to JSON

This guide explains **how to provide PO numbers** in the UI and **how to convert your Excel into the JSON** that you send to `POST /v1/yarn-management/yarn-receiving/process`.

---

## 1. How to provide PO numbers

The Excel does **not** contain a PO Number column. The user must provide PO number(s) in the frontend. You can support either **one PO per upload** or **multiple POs in one upload**.

### Option A: One PO per upload (simplest)

1. **Before** uploading Excel: user selects **one PO** (e.g. from a dropdown).
2. Dropdown can be filled by:
   - `GET /v1/yarn-management/yarn-purchase-orders?status=...` (list POs), or
   - `GET /v1/yarn-management/yarn-purchase-orders/by-number/:poNumber` if user types and you validate.
3. User uploads/pastes Excel.
4. You use the **selected PO number** for all rows when converting Excel → JSON (one item in `items[]`).

**Result:** One `items[]` entry with that `poNumber`, and all Excel rows (filtered by BRAND if needed) are grouped into that PO’s lots.

### Option B: Multiple POs in one upload

1. User selects **multiple POs** (multi-select dropdown or comma-separated input).
2. User uploads Excel.
3. Excel has **BRAND** column. For each row, match **BRAND** to the PO’s supplier brand and assign the row to that PO. (You need PO list with supplier/brand info to do this.)
4. When converting: group rows by **assigned PO number** and then by **Lot**. Build one `items[]` entry per PO, each with its own lots.

**Alternative (no BRAND matching):** If all rows in the file belong to one PO, user selects that one PO and you use Option A. If the file can contain multiple POs, add a **PO Number** column to the Excel template so each row has a PO; then group by that column.

### Summary: PO number source

| Scenario | Where PO number comes from |
|----------|----------------------------|
| One PO, one file | User selects **one PO** in dropdown before/after selecting file. Use that PO for all rows. |
| Multiple POs, one file | User selects **multiple POs**; assign each row to a PO by **BRAND** (match Excel BRAND to PO’s supplier brand). Or add PO Number column to Excel. |

**API to get PO details (for dropdown and for resolving PO item IDs):**

- List POs: `GET /v1/yarn-management/yarn-purchase-orders?start_date=&end_date=&status=...`
- Get one PO by number (for item IDs and validation): `GET /v1/yarn-management/yarn-purchase-orders/by-number/:poNumber`

---

## Quantity, Net Weight, and Box Weight (PO item wise)

- **Received quantity** is **PO item wise**: each `poItems[].receivedQuantity` = the quantity received for that PO order line only. From Excel this is **Net Weight** for the row that corresponds to that PO item (one row = one box = one PO item).
- **Lot / packing totals:** If a lot has 5 PO items, **totalWeight** for the lot = **sum of those 5 PO items’ received quantities** = sum of the 5 Net Weights (box weights) in that lot. So total quantity / total weight for the lot = sum of (received quantity per PO item).
- **Box:** One box per PO item; **boxWeight** = that PO item’s **receivedQuantity** = **Net Weight** for that row.

---

## 2. End-to-end flow: Excel → JSON → API

High-level steps:

1. User selects PO number(s) (and optionally packing details).
2. User provides Excel file (or pastes data).
3. Parse Excel into rows (normalize column names: trim, match "SHADE NO" / "Shade No" etc.).
4. Optionally filter rows by BRAND if multiple POs selected.
5. For each PO number, get PO details (to resolve `poItem` _ids).
6. Group rows by (PO Number, Lot).
7. For each group, build one **lot** object: lotNumber, numberOfBoxes, numberOfCones, totalWeight, poItems, boxUpdates.
8. Build **items** array: one object per PO with poNumber, packing, lots.
9. POST the JSON to the API.

---

## 3. Step-by-step: Convert Excel to JSON

### Step 3.1 Parse Excel to rows

- Read the first sheet (or the sheet you use).
- First row = headers. Normalize: trim, lowercase, replace spaces with nothing or one space so you can match:
  - `Lot`, `SHADE NO`, `Net Weight`, `no of cones`, `COUNT/SIZE`, `COLOUR`, `BRAND`, `Recvd Date`, etc.
- Each subsequent row = one record. Example row (by header name):

```js
{
  lot: "EW1205",
  shadeNo: "WN96793",
  netWeight: 373,
  noOfCones: 2,
  countSize: "70/1",
  colour: "Sea Green",
  brand: "SomeBrand",
  recvdDate: "2026-02-10",
  yarnType: "Nylon/Nylon"
}
```

Use **no of cones**; if empty, use **nof cones round up**.

### Step 3.2 Resolve yarn name and PO item ID

For each row you need:

- **yarnName** – Resolve from COUNT/SIZE + COLOUR + SHADE NO (and YARN TYPE if needed), e.g. via YarnCatalog or a fixed format like `"{countSize}-{colour}-{colour}-{yarnType}"`.
- **poItem** – PO line _id. Get PO by number: `GET /v1/yarn-management/yarn-purchase-orders/by-number/:poNumber`. From response, in `poItems[]`, find the item whose `yarnName` and `shadeCode` (or shade no) match this row. Use that item’s `_id` as `poItem`.

If no matching PO item, skip row or collect error.

### Step 3.3 Group rows by (PO Number, Lot)

- **If one PO selected:** group only by **Lot**. All rows belong to that PO.
- **If multiple POs:** first assign each row to a PO (by BRAND), then group by (poNumber, lot).

Example: after grouping you have:

```text
PO-2026-257:
  EW1205: [ row1, row2 ]
  EW1206: [ row3 ]
```

### Step 3.4 Build one lot object per (PO, Lot) group

For each group (e.g. PO-2026-257 + EW1205 with [ row1, row2 ]):

1. **lotNumber** = group key (e.g. `"EW1205"`).
2. **numberOfBoxes** = number of rows in the group = number of PO items in that lot (e.g. 2).
3. **numberOfCones** = sum of (no of cones) over rows (e.g. row1.noOfCones + row2.noOfCones).
4. **totalWeight** (lot) = **sum of all PO items’ received quantities** in that lot = sum of Net Weight over rows (e.g. row1.netWeight + row2.netWeight). So packing/lot total = sum of (received quantity per PO item).
5. **poItems** (PO item wise):
   - Each PO item’s **receivedQuantity** = received quantity for that PO order line only = **Net Weight** for the row(s) for that PO item.
   - For each row you have resolved (poItem _id, netWeight). Build one entry per PO item: `{ poItem: "<id>", receivedQuantity: netWeight }`. If same poItem appears in multiple rows, **sum** netWeight for that poItem (one entry per PO item with receivedQuantity = sum).
   - Example: 5 PO items in the lot → 5 entries; total for the lot = sum of those 5 receivedQuantity values.
6. **boxUpdates** (one box per PO item):
   - One entry per row, **in the same order as rows**.
   - **boxWeight** = that row’s **Net Weight** = that PO item’s **receivedQuantity** (same value).
   - Each entry: `{ yarnName, shadeCode: row.shadeNo, boxWeight: row.netWeight, numberOfCones: row.noOfCones }`. Use resolved yarnName for that row.

### Step 3.5 Packing (handled by backend)

For now the **frontend does not need to send `packing` at all**.

- The backend applies a **fixed default packing** (Packing Number 0028360, Countrywide Logistics, challan 0028360, vehicle gj05cw1835, dispatch 2026-01-14, estimated 2026-02-14, etc.).
- You can **omit `packing`** entirely in the payload or send `packing: {}` for each item; the backend will fill the pack list details.
- Later, if you add a UI for packing fields, you can start sending `packing` and the backend will use your values instead of the defaults.

### Step 3.6 Build items array

- One element per PO number that has at least one row.
- Each element:

```js
{
  poNumber: "PO-2026-257",
  // packing: { ... },   // optional; can be omitted, backend has defaults
  lots: [ /* all lot objects for this PO, from Step 3.4 */ ],
  notes: ""           // optional
}
```

### Step 3.7 Final JSON

```js
const payload = {
  items: items,   // array from Step 3.6
  notes: ""       // optional global notes
};

// POST to /v1/yarn-management/yarn-receiving/process
fetch('/v1/yarn-management/yarn-receiving/process', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ...' },
  body: JSON.stringify(payload)
});
```

---

## 4. Example: One PO, two rows (two boxes), one lot

**User:** Selects PO `PO-2026-257`, uploads Excel with 2 rows for lot EW1205.

**Excel rows (after parse):**

| Lot   | SHADE NO | Net Weight | no of cones | COUNT/SIZE | COLOUR   |
|-------|----------|------------|-------------|------------|----------|
| EW1205 | WN96793  | 373        | 2           | 70/1       | Sea Green |
| EW1205 | WN96794  | 373        | 2           | 70/1       | Another   |

**After resolve:** Row1 → yarnName "70/1-Sea Green-Sea Green-Nylon/Nylon", poItem id1. Row2 → yarnName "70/1-Another-Another-Nylon/Nylon", poItem id2.

**One lot built:**

```json
{
  "lotNumber": "EW1205",
  "numberOfCones": 4,
  "totalWeight": 746,
  "numberOfBoxes": 2,
  "poItems": [
    { "poItem": "698b191e0ba35154c81460a6", "receivedQuantity": 373 },
    { "poItem": "698b191e0ba35154c81460a7", "receivedQuantity": 373 }
  ],
  "boxUpdates": [
    { "yarnName": "70/1-Sea Green-Sea Green-Nylon/Nylon", "shadeCode": "WN96793", "boxWeight": 373, "numberOfCones": 2 },
    { "yarnName": "70/1-Another-Another-Nylon/Nylon", "shadeCode": "WN96794", "boxWeight": 373, "numberOfCones": 2 }
  ]
}
```

**Payload:**

```json
{
  "items": [
    {
      "poNumber": "PO-2026-257",
      "packing": {
        "challanNumber": "CH-001",
        "vehicleNumber": "MH04BC4455"
      },
      "lots": [ /* the lot above */ ]
    }
  ],
  "notes": ""
}
```

---

## 5. Checklist for implementation

- [ ] UI: PO number(s) – single select or multi-select; fill from GET purchase-orders or by-number.
- [ ] UI: Optional “Packing details” section (challan, courier, vehicle, dates); same for all items.
- [ ] Parse Excel: normalize headers, one row = one box; read Lot, SHADE NO, Net Weight, no of cones, COUNT/SIZE, COLOUR, BRAND, Recvd Date.
- [ ] Get PO by number to resolve `poItem` _ids (match yarnName + shadeCode).
- [ ] Group rows by (PO Number, Lot).
- [ ] For each group: build lot (lotNumber, numberOfBoxes, numberOfCones, totalWeight, poItems, boxUpdates in row order).
- [ ] Build items[] (one per PO, same packing, lots for that PO).
- [ ] POST `{ items, notes }` to `/v1/yarn-management/yarn-receiving/process`.

For full field reference and pack list details, see **yarn-receiving-api-payload.md**. For Excel column mapping and box rule, see **yarn-receiving-excel-mapping.md**.
