# Vendor production flow — Final checking floor (frontend)

Aligned with `article.model.js` `floorQuantities.finalChecking` for **counters + repair + styleCode/brand** on `transferredData` and `receivedData`.

**Vendor vs article:** vendor final checking tracks **M1 / M2 / M4** only (no **M3** in this module). Article production may include `m3Quantity`; ignore M3 for vendor UI.

## Endpoint

`PATCH /v1/vendor-management/production-flow/:vendorProductionFlowId/floors/finalChecking`

Auth required.

## Scalars

- Pipeline: `received`, `completed`, `remaining`, `transferred`
- Quality split: `m1Quantity`, `m2Quantity`, `m4Quantity`
- Transfers: `m1Transferred`, `m1Remaining`, `m2Transferred`, `m2Remaining`
- Repair: `repairStatus`, `repairRemarks` (same `RepairStatus` enum as elsewhere)

**Additive vs replace for M1/M2/M4:** follow the rules in `vendor-production-flow-frontend-api.md` (default additive mapping for `m1Quantity`/`m2Quantity`/`m4Quantity` on checking floors unless `mode: "replace"` or structural fields).

## `transferredData` (array)

Same row shape as **branding** `transferredData`. Each row’s **`transferred`** is **one number** for: **completed** on final checking for that style/brand line **and** quantity **moving to the next step** (e.g. **dispatch** / confirm path). Sum of rows should align with floor **`transferred`** when the breakdown is complete; **`completed`** aligns with **`transferred`** when all completed work is forwarded.

If you send `transferredData` and do not send `completed`/`completedDelta`, backend derives floor **`completed`** from `sum(transferredData[].transferred)` (same behavior as branding), then applies normal forward rules.

| Field         | Type   | Required | Notes        |
|---------------|--------|----------|--------------|
| `transferred` | number | yes      | `>= 0` — completed + outbound for this line |
| `styleCode`   | string | no       | default `''` — usually StyleCode **ObjectId** string |
| `brand`       | string | no       | default `''` |

Example:

```json
{
  "mode": "replace",
  "transferredData": [
    { "transferred": 20, "styleCode": "699024260d1e1d92d979e147", "brand": "Van Heusen" }
  ]
}
```

## `receivedData` (array)

Inbound lines from **branding** (each element is one receipt line). Same shape as **branding** `receivedData`: optional container, timestamps, **`styleCode`**, **`brand`**, plus optional **`transferred`** on the row for sub-tracking.

| Field                           | Type     | Notes              |
|---------------------------------|----------|--------------------|
| `receivedStatusFromPreviousFloor` | string | default `''`       |
| `receivedInContainerId`         | ObjectId \| null | optional |
| `receivedTimestamp`             | ISO date | optional      |
| `transferred`                   | number   | default `0` — optional line-level progress |
| `styleCode`                     | string   | default `''` — usually StyleCode **ObjectId** string |
| `brand`                         | string   | default `''`       |

### Showing `receivedData` by style code in the UI

1. **Group rows** by `styleCode` (string id). Each distinct `styleCode` is one “bucket” in the table.
2. **Labels:** `styleCode` on the row is stored as an **id string** (same value you put in PATCH). For display:
   - call **style codes by vendor** API (below), build a map `id → { styleCode, brand, … }`;
   - show **`styleCode`** (human code from `StyleCode.styleCode`) and **`brand`** in column headers or row subtitles;
   - if a row has `brand` set, you can prefer it or merge with lookup.
3. **Totals per style:** sum numeric fields you care about (e.g. row `transferred` or derive from floor counters) per group.
4. **Empty `styleCode`:** group as “Unassigned” or show raw row.

## Lookup: style codes by product `vendorCode`

Use this so dropdowns and tables show **code + brand** next to the **id** you store in `receivedData` / `transferredData`.

### Request

`GET /v1/products/style-codes-by-vendor-code?vendorCode=<vendorCode>`

- **Query:** `vendorCode` (required) — same `vendorCode` as on `Product` (match is **case-insensitive**).
- **Auth:** same as other `GET /v1/products` routes (if your app protects products, send the token).

### Response (200)

```json
{
  "vendorCode": "VX116675",
  "productCount": 3,
  "styleCodes": [
    {
      "id": "699024260d1e1d92d979e147",
      "styleCode": "STYLE-ABC-001",
      "eanCode": "8901234567890",
      "brand": "Van Heusen",
      "pack": "1 Pair",
      "mrp": 299,
      "status": "active"
    }
  ]
}
```

| Field | Meaning |
|-------|--------|
| `vendorCode` | Normalized query value |
| `productCount` | Active products whose `vendorCode` matched |
| `styleCodes` | Distinct `StyleCode` docs linked from those products’ `styleCodes` arrays, sorted by `styleCode` |

**Usage:** use **`id`** as the `styleCode` field in `receivedData` / `transferredData` rows; use **`brand`** and **`styleCode`** (human code) from this response for labels in final-checking screens.

### Example (curl)

```bash
curl -s "http://localhost:3000/v1/products/style-codes-by-vendor-code?vendorCode=VX116675"
```

---

## Related APIs

- **Confirm / dispatch:** `POST /v1/vendor-management/production-flow/:vendorProductionFlowId/confirm`
- **M2 rework:** `PATCH /v1/vendor-management/production-flow/:vendorProductionFlowId/final-checking/m2-transfer` with `toFloorKey`, `quantity`

## Frontend checklist

- **PATCH** with `transferredData` / `receivedData` **replaces** that array on the server for this request (merge on the client if you need partial edits).
- **`remaining`** on checking floors uses the global rule: `received − m2 − m4 − transferred − completed` (see main vendor production flow doc).
- Do not send **M3** fields for vendor; schema has no M3.
- After each successful PATCH, **rebind UI from the response body** (source of truth).

## See also

- `vendor-production-flow-frontend-api.md` — global pipeline and transfer API
- `vendor-production-flow-branding-floor-api.md` — branding floor + same lookup section
