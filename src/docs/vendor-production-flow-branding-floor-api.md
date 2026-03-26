# Vendor production flow — Branding floor (frontend)

Aligned with `article.model.js` `floorQuantities.branding`: counters plus **styleCode / brand** breakdown on `transferredData` and `receivedData`.

## Endpoint

`PATCH /v1/vendor-management/production-flow/:vendorProductionFlowId/floors/branding`

Auth required. Prefer **`mode: "replace"`** when sending full `transferredData` / `receivedData` arrays (or omit `mode` when you only send those + scalars — resolves to replace unless deltas are present).

## Scalars (same as other standard floors)

- `received`, `completed`, `remaining`, `transferred`
- `repairReceived`
- `mode`, `receivedDelta`, `completedDelta`, `transferredDelta`, `autoTransferToNextFloor` (same rules as main vendor production flow doc)

## `transferredData` (array)

### Meaning of `transferred` in each row

For each line, **`transferred`** is **one number** for all of these at once:

1. **Completed** quantity on **branding** for that `styleCode` / `brand` line.
2. Quantity **included in** this floor’s **outbound** handoff.
3. Quantity **going to the next floor** (**final checking**).

So: **completed (per line) = that line’s transfer out = quantity toward next floor.** There is no separate `completed` field per row—the row’s `transferred` is that quantity.

If you send `transferredData` and do not send `completed`/`completedDelta`, backend derives floor completion from `sum(transferredData[].transferred)`. That derived completion then participates in normal forward movement to final checking.

**Aggregates (keep in sync in your UI or when PATCHing):**

- **Sum of** `transferredData[].transferred` **≈** floor **`transferred`** (total sent to final checking).
- When every completed unit is forwarded, floor **`completed`** **≈** floor **`transferred`** as well.

| Field         | Type   | Required | Notes                          |
|---------------|--------|----------|--------------------------------|
| `transferred` | number | yes      | `>= 0` — completed + sent to next floor for this line |
| `styleCode`   | string | no       | default `''`                   |
| `brand`       | string | no       | default `''`                   |

Example:

```json
{
  "mode": "replace",
  "transferredData": [
    { "transferred": 40, "styleCode": "699024260d1e1d92d979e147", "brand": "Van Heusen" },
    { "transferred": 15, "styleCode": "", "brand": "" }
  ]
}
```

## `receivedData` (array)

Inbound lines from **boarding** (or earlier), with optional container + style/brand (same shape as article branding `receivedData`).

| Field                           | Type     | Notes                                |
|---------------------------------|----------|--------------------------------------|
| `receivedStatusFromPreviousFloor` | string | default `''`                         |
| `receivedInContainerId`         | ObjectId \| null | optional                     |
| `receivedTimestamp`             | ISO date | optional                             |
| `transferred`                   | number   | default `0` (often updated later)   |
| `styleCode`                     | string   | default `''`                         |
| `brand`                         | string   | default `''`                         |

## Frontend checklist

- After each successful PATCH, **rebind UI from the response body** (source of truth).
- Sending **`transferredData` / `receivedData` replaces the whole array** for that field unless you merge client-side before send.
- You can combine **numeric deltas** (`mode: "increment"`) with **`transferredData` / `receivedData`** in one request; arrays are `$set`, numbers use `$inc` where applicable.

## Lookup: style codes by product `vendorCode`

Products store `vendorCode` and `styleCodes[]` (ObjectIds → `StyleCode`). Use this to pick **`styleCode`** (id) and **`brand`** for `transferredData` / `receivedData` rows.

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
| `styleCodes` | **Distinct** `StyleCode` documents linked from those products’ `styleCodes` arrays, sorted by `styleCode` |

Use each row’s **`id`** as `styleCode` in branding payloads when you store the ObjectId as string; use **`brand`** for the `brand` field when you want a human-readable label.

### Example (curl)

```bash
curl -s "http://localhost:3000/v1/products/style-codes-by-vendor-code?vendorCode=VX116675"
```

---

## See also

- `vendor-production-flow-frontend-api.md` — global pipeline and transfer API
- `vendor-production-flow-final-checking-floor-api.md` — final checking (M1–M4 + same breakdown fields)
