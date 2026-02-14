# Yarn Receiving – Excel Structure & Box Mapping Logic

This doc describes how an Excel like **"Yarn loft bags details"** should be structured and how to convert it into the API payload. It also defines the **box rule**: one box per PO item, box weight = that PO item’s received quantity (e.g. 2 PO items with 373 kg each → 2 boxes of 373 kg each).

---

## Your Excel columns (exact headers)

Your sheet has these columns:

| # | Excel column       | Used for API? | Maps to |
|---|--------------------|---------------|---------|
| 1 | Sr no              | No            | Display / order only |
| 2 | Recvd Date         | Optional      | `packing.dispatchDate` or `estimatedDeliveryDate` (first row or per PO) |
| 3 | Name/DesignNo      | Optional      | Help resolve yarn name |
| 4 | BRAND              | Yes           | Resolve/validate PO (supplier brand); user may still select PO Number in form |
| 5 | YARN TYPE          | Optional      | Help resolve yarn name (e.g. Nylon/Nylon) |
| 6 | COUNT/SIZE         | **Yes**       | Resolve **yarnName** with COLOUR + SHADE NO (e.g. 70/1) |
| 7 | COLOUR             | **Yes**       | Resolve **yarnName** (e.g. Sea Green) |
| 8 | SHADE NO           | **Yes**       | `boxUpdates[].shadeCode` + resolve PO item |
| 9 | Lot                | **Yes**       | `lots[].lotNumber` |
| 10 | Net Weight        | **Yes**       | `boxUpdates[].boxWeight` and that row’s **receivedQuantity** for the PO item |
| 11 | Location           | No            | Not in API (storage location) |
| 12 | Purchase Rate      | No            | Not in API (cost) |
| 13 | Cone full weight   | No            | Reference |
| 14 | no of cones        | **Yes**       | `boxUpdates[].numberOfCones` (cones in this box/row) |
| 15 | nof cones round up | Optional      | Use if “no of cones” empty; else same as no of cones |
| 16 | Cone weight        | No            | Reference (per-cone weight) |
| 17 | total tare Weight  | No            | Reference (tare) |
| 18 | Gross weight       | Optional      | Reference; API uses **Net Weight** for box weight |
| 19 | Brand As per System| Optional      | Same as BRAND if needed for matching |
| 20 | Brand              | Optional      | Same as BRAND |

**Note:** There is **no PO Number** column in the Excel. The frontend must get **PO Number** from the user (e.g. dropdown or input) and optionally use **BRAND** to validate or filter which POs are allowed.

**Yarn name resolution:** Build or resolve **yarnName** from **COUNT/SIZE** + **COLOUR** + **SHADE NO** (and optionally **YARN TYPE** / **Name/DesignNo**) via YarnCatalog, then match to the PO’s `poItems` to get `poItem` _id.

**One row = one box:** Each Excel row is one box. Use **Net Weight** as that box’s weight and **no of cones** (or nof cones round up) as cones for that box.

---

## Quantity, Net Weight, and Box Weight – Rules

All quantity and weight values are **PO item wise**; lot and packing totals are **sums** of those.

| Level | What it is | How to get it |
|-------|------------|----------------|
| **PO item (per line)** | Received quantity for that PO order line only | From Excel: **Net Weight** for the row that corresponds to that PO item (one row = one box = one PO item). This is `poItems[].receivedQuantity` and also `boxUpdates[].boxWeight` for that box. |
| **Box** | One box per PO item; box weight = that PO item’s received quantity | **boxWeight** = that PO item’s **receivedQuantity** = **Net Weight** for that row. |
| **Lot** | Totals for the lot (all PO items in that lot) | **totalWeight** (lot) = **sum of all poItems[].receivedQuantity** in that lot = sum of all **Net Weight** in that lot. Same idea for “total quantity”: total of received = sum of (received quantity per PO item). |
| **Packing** | If packing has 5 PO items | Total quantity = sum of those 5 PO items’ received quantities. Total weight = sum of those 5 box weights (Net Weights). So **numberOfBoxes** = number of PO items (e.g. 5); **totalWeight** for the lot = sum of the 5 received quantities. |

**In short:** Use **Net Weight** from Excel **per row** as the **received quantity for that PO item** and as that box’s **box weight**. Lot/packing totals = **sum of PO-item received quantities** (same as sum of box weights / Net Weights in that lot).

---

## 1. Box logic (what you need)

- **Rule:** For each **PO item** in the lot, you create **one box**.
- **Box weight** = **received quantity** for that PO item (e.g. 373 kg for received quantity 373).
- **Order:** `boxUpdates` order must match the order of boxes created: first PO item → first box, second PO item → second box, etc.

**Example:**

- PO has **2 PO items** (e.g. two yarns), each with **received quantity 373**.
- Then you need:
  - **2 boxes** for that lot.
  - **poItems:**  
    `[{ poItem: "<id1>", receivedQuantity: 373 }, { poItem: "<id2>", receivedQuantity: 373 }]`
  - **boxUpdates:**  
    `[  
      { yarnName: "...", shadeCode: "...", boxWeight: 373, numberOfCones: ... },  
      { yarnName: "...", shadeCode: "...", boxWeight: 373, numberOfCones: ... }  
    ]`

So: **numberOfBoxes = number of PO items** (when you use one box per PO item), and each **boxWeight** in `boxUpdates` = that PO item’s **receivedQuantity**.

---

## 2. Excel columns to provide (recommended)

So that the frontend can build the API payload, the Excel (e.g. "Yarn loft bags details") should have at least these columns. You can add more for display; only the ones below are needed for mapping.

### 2.1 Required for mapping

| Excel column (suggested name) | Description | Maps to API |
|-------------------------------|-------------|-------------|
| **PO Number** (or **PO No**) | e.g. `PO-2026-257` | `items[].poNumber` |
| **Lot Number** (or **Lot No**) | e.g. `EW1205` | `lots[].lotNumber` |
| **Yarn Name** (or **Count/Size + Color + Shade**) | Full yarn name or enough to resolve from catalog | `boxUpdates[].yarnName` (and to find PO item) |
| **Shade Code** | e.g. `WN96793` | `boxUpdates[].shadeCode` |
| **Box Weight** (or **Weight (kg)**) | Weight of this box in kg | `boxUpdates[].boxWeight` |
| **Number of Cones** (or **Cones**) | Cones in this box | `boxUpdates[].numberOfCones` |

### 2.2 One row per box (recommended)

- **One row = one box.**  
  So if a lot has 2 PO items (2 boxes), there are 2 rows for that lot with the same `Lot Number` and same `PO Number`, and each row has that box’s yarn name, shade code, box weight, and cones.

Example:

| PO Number   | Lot Number | Yarn Name                          | Shade Code | Box Weight | Number of Cones |
|------------|------------|-------------------------------------|------------|------------|-----------------|
| PO-2026-257 | EW1205     | 70/1-Sea Green-Sea Green-Nylon/Nylon | WN96793    | 373        | 2               |
| PO-2026-257 | EW1205     | 70/1-Sea Green-Sea Green-Nylon/Nylon | WN96793    | 373        | 2               |

Then:
- **numberOfBoxes** for lot `EW1205` = 2.
- **boxUpdates** = 2 entries (one per row, in row order).
- **poItems** = resolve from PO: one PO item per row (same yarn/shade) and `receivedQuantity` = that row’s **Box Weight** (373 each).

### 2.3 Optional columns (packing / lot totals)

Can be in Excel or entered in the form; if in Excel, can be one row per PO or repeated per row:

| Excel column | Description | Maps to API |
|--------------|-------------|-------------|
| Packing Number | Packing ref | `packing.packingNumber` |
| Courier Name | Courier name | `packing.courierName` |
| Courier Number | Courier ref | `packing.courierNumber` |
| Vehicle Number | Vehicle no | `packing.vehicleNumber` |
| Challan Number | Challan no | `packing.challanNumber` |
| Dispatch Date | ISO date | `packing.dispatchDate` |
| Estimated Delivery Date | ISO date | `packing.estimatedDeliveryDate` |
| Notes | Packing notes | `packing.notes` |
| Total Cones (lot) | Sum of cones in lot | `lots[].numberOfCones` |
| Total Weight (lot) | Sum of box weights in lot | `lots[].totalWeight` |

If you don’t have “Total Cones” / “Total Weight”, the frontend can **sum** from the box rows (one row per box).

---

## 3. Conversion logic (Excel → API)

**Input:** Your Excel (columns above) + **PO Number** from user (form/dropdown). Optionally filter rows by **BRAND** matching the selected PO’s supplier brand.

### Step 1: Group rows by PO and Lot

- Group by `(PO Number, Lot)` — PO Number from form; **Lot** from Excel column.
- For each group you get one **lot** in the API.

### Step 2: For each (PO, Lot) group

1. **numberOfBoxes** = number of rows in the group = number of PO items in that lot (one row = one box = one PO item).
2. **lotNumber** = value of **Lot** column.
3. **numberOfCones** (lot) = sum of **no of cones** (or **nof cones round up**) in the group.
4. **totalWeight** (lot) = **sum of all PO items’ received quantities in that lot** = sum of **Net Weight** over all rows in the group. (So packing/lot total quantity and total weight = sum of the PO-item-wise quantities/weights.)
5. **poItems:**
   - **PO item wise:** each entry is one PO order line. **receivedQuantity** = received quantity for that PO item only = **Net Weight** for the row that corresponds to that PO item.
   - For each row, resolve **(COUNT/SIZE, COLOUR, SHADE NO)** → **yarnName**, then match to PO’s `poItems[]._id` (and `shadeCode`).
   - One row → one PO item; **receivedQuantity** = that row’s **Net Weight** (PO item wise).
   - If the same PO item appears in multiple rows, **sum** Net Weight for that PO item: one entry `{ poItem: "<id>", receivedQuantity: sum }`.
6. **boxUpdates:**
   - One entry per row (one box per PO item), **in the same order as the rows**.
   - **boxWeight** = that PO item’s **receivedQuantity** = **Net Weight** for that row (same value as in poItems for that PO item).
   - Each entry:  
     - **yarnName** = resolved from COUNT/SIZE + COLOUR + SHADE NO (and YARN TYPE if needed).  
     - **shadeCode** = **SHADE NO**.  
     - **boxWeight** = **Net Weight**.  
     - **numberOfCones** = **no of cones** (or **nof cones round up** if no of cones is empty).

### Step 3: Packing (fixed pack list details)

These can be **fixed once** in the frontend form (same values for the whole upload). The frontend copies this single `packing` object into every `items[].packing`.

| Pack list field | API key | Where to fix |
|-----------------|---------|--------------|
| **Challan number** | `packing.challanNumber` | Form (single input, applied to all items) |
| Packing number | `packing.packingNumber` | Form |
| Courier name | `packing.courierName` | Form |
| Courier number | `packing.courierNumber` | Form |
| Vehicle number | `packing.vehicleNumber` | Form |
| Dispatch date | `packing.dispatchDate` | Form (or from Excel **Recvd Date** if you prefer) |
| Estimated delivery date | `packing.estimatedDeliveryDate` | Form |
| Packing notes | `packing.notes` | Form |

- **From Excel:** You can use **Recvd Date** as `dispatchDate` or `estimatedDeliveryDate` (e.g. first row value) if you don’t want a separate form field.
- **From form (recommended):** One “Packing details” section with Challan number, courier, vehicle, dates, notes; same values sent in every `items[].packing`.

### Step 4: Build payload

- One **item** per **PO Number** (user-selected).
- Each item has one **packing** object and **lots** array (one lot per distinct **Lot** value for that PO).
- Each lot: **lotNumber** (Lot), **numberOfCones**, **totalWeight**, **numberOfBoxes**, **poItems**, **boxUpdates** as above.

---

## 4. Example: 2 PO items, 373 kg each, 1 box per PO item

**Excel (2 rows for same PO and lot):**

| PO Number   | Lot Number | Yarn Name                          | Shade Code | Box Weight | Number of Cones |
|------------|------------|-------------------------------------|------------|------------|-----------------|
| PO-2026-257 | EW1205     | 70/1-Sea Green-Sea Green-Nylon/Nylon | WN96793    | 373        | 2               |
| PO-2026-257 | EW1205     | 70/1-Another-Another-Nylon/Nylon    | WN96794    | 373        | 2               |

**Resolved PO items (example IDs):**  
- Yarn 1 → `698b191e0ba35154c81460a6`  
- Yarn 2 → `698b191e0ba35154c81460a7`

**API payload for that PO/lot:**

```json
{
  "items": [
    {
      "poNumber": "PO-2026-257",
      "packing": { },
      "lots": [
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
      ]
    }
  ]
}
```

So: **2 PO items, 373 kg each → 2 boxes, each with box weight 373 kg**, and `boxUpdates` order matches the order of boxes (first row = first box, second row = second box).

---

## 5. Summary

| What you need | Your Excel / API |
|---------------|-------------------|
| **Lot** | Column **Lot** → `lots[].lotNumber`. |
| **Box weight & received qty** | Column **Net Weight** → `boxUpdates[].boxWeight` and that row’s PO item `receivedQuantity`. |
| **Cones per box** | Column **no of cones** (or **nof cones round up**) → `boxUpdates[].numberOfCones`. |
| **Shade** | Column **SHADE NO** → `boxUpdates[].shadeCode` and to match PO item. |
| **Yarn name** | Resolve from **COUNT/SIZE** + **COLOUR** + **SHADE NO** (and **YARN TYPE** if needed) → `boxUpdates[].yarnName` and PO item. |
| **PO Number** | Not in Excel — user selects in form; optionally validate with **BRAND**. |
| **Box rule** | One row = one box; box weight = Net Weight; order of `boxUpdates` = row order. |

**One row = one box.** **Net Weight** = box weight = received quantity for that box’s PO item.
