# Vendor dispatch → warehouse (frontend)

Use this when `currentFloorKey === 'dispatch'` and the user must move stock from **dispatch** into **WHMS** (warehouse inward). This is the same pattern as **final checking → dispatch**: you **stage** an existing physical container, then **warehouse scans** that container to complete the handoff.

**Base URL:** `/v1` (same auth as other vendor APIs: `Authorization: Bearer <token>`, `Content-Type: application/json`).

---

## Numbers to show on the dispatch screen

Read from `GET /v1/vendor-management/production-flow/:vendorProductionFlowId` → `floorQuantities.dispatch`:

| Field | Meaning for UI |
|--------|----------------|
| `received` | Total units that have arrived on dispatch (from final checking scans / confirm). |
| `transferred` | Total units already staged toward the warehouse (sum of completed dispatch→WHMS transfers). |
| **`remaining`** | **Units still on dispatch** = `received - transferred` (backend keeps this in sync). Use this as **max transferable** in one go (or cap partial transfers to this). |
| `completed` | Pipeline “completed” on dispatch; for transfers, backend keeps it consistent with `transferred` / `received`. |
| `receivedData[]` | Inbound lines from FC (style/brand + `transferred` per row, container id, timestamps). |
| `transferredData[]` | **Outbound** style/brand lines appended each time you call dispatch→warehouse transfer (ledger toward WHMS). |

**Disable the transfer form** when `remaining <= 0` (nothing left to send).

---

## Step 1 — User picks quantity and a **warehouse** container

1. User enters **quantity** `1 … dispatch.remaining`.
2. User scans or selects **`existingContainerBarcode`** — must be an **already created** `ContainersMaster` row in **Active** status (same as SC→branding / branding→FC). The backend **does not** create a new bag here.
3. Optionally collect **`transferItems`** (style/brand split). If omitted, one implicit line is used (`styleCode` / `brand` empty).

---

## Step 2 — Call transfer API

**`PATCH /v1/vendor-management/production-flow/:vendorProductionFlowId/transfer`**

### Body (required shape)

```json
{
  "fromFloorKey": "dispatch",
  "toFloorKey": "warehouse",
  "quantity": 120,
  "existingContainerBarcode": "SCANNED_BARCODE_OR_24_CHAR_ID",
  "transferItems": [
    { "transferred": 70, "styleCode": "XL-BLUE", "brand": "Adidas" },
    { "transferred": 50, "styleCode": "XL-RED", "brand": "Puma" }
  ]
}
```

Rules (enforced by Joi + service):

- `fromFloorKey` must be `dispatch`, `toFloorKey` must be `warehouse`.
- `quantity` ≥ 1 and must be **≤ `dispatch.received - dispatch.transferred`** (i.e. ≤ `remaining`).
- `existingContainerBarcode` is **required** (non-empty trim).
- If `transferItems` is present and non-empty: **sum of `transferred`** must **exactly equal** `quantity`.

### Minimal body (no style split)

```json
{
  "fromFloorKey": "dispatch",
  "toFloorKey": "warehouse",
  "quantity": 120,
  "existingContainerBarcode": "SCANNED_BARCODE_OR_24_CHAR_ID"
}
```

### Typical success response

The handler returns the updated vendor production flow object. After dispatch→warehouse you should also see:

```json
{
  "vendorTransferContainer": {
    "barcode": "...",
    "_id": "..."
  }
}
```

Use this to confirm which container was staged for the warehouse desk.

### Typical errors (show message to user)

- `existingContainerBarcode is required for dispatch → warehouse…`
- `Only N quantity on dispatch is available…` (`N` = remaining)
- `transferItems sum (X) must equal quantity (Y)`
- `Container not found` / `Container must be Active…`

---

## Step 3 — Warehouse completes the handoff (WHMS scan)

After a successful transfer, the container’s `activeFloor` is set to **`Warehouse Inward`** (internal string). The **same barcode** must be accepted through the existing containers API:

**`POST /v1/containers-masters/barcode/:barcode/accept`**

(Empty body is fine for the vendor WHMS path; the server detects `Warehouse Inward` and runs vendor inward accept.)

That call:

- Clears the container’s staged vendor items.
- Appends `warehouse:handoff` rows on `floorQuantities.dispatch.receivedData` (audit trail).
- Promotes vendor inward receive / WHMS queue (see backend `applyVendorWarehouseInwardAcceptFromContainer`).

**Frontend split:** dispatch operator uses **vendor-management transfer**; warehouse operator uses **containers accept** on the bag you just staged.

---

## React-style pseudo-flow

```ts
// maxQty = flow.floorQuantities.dispatch.remaining (or received - transferred)
await api.patch(
  `/v1/vendor-management/production-flow/${flowId}/transfer`,
  {
    fromFloorKey: 'dispatch',
    toFloorKey: 'warehouse',
    quantity: formQty,
    existingContainerBarcode: formBarcode.trim(),
    // optional:
    // transferItems: linesWhereSumEqualsFormQty,
  }
);
// then tell warehouse to scan:
await api.post(`/v1/containers-masters/barcode/${encodeURIComponent(formBarcode)}/accept`, {});
```

---

## Related (not this doc)

- **Final checking → dispatch:** same `PATCH .../transfer` with `fromFloorKey: 'finalChecking'`, `toFloorKey: 'dispatch'`, `existingContainerBarcode`, optional `transferItems` (sum = quantity).
- **GET flow** for list/detail: `GET /v1/vendor-management/production-flow` and `GET /v1/vendor-management/production-flow/:id`.

---

## Backend source (for support / debugging)

| Piece | File |
|--------|------|
| Transfer service | `src/services/vendorManagement/vendorDispatchWarehouseTransfer.service.js` |
| Route + validation | `src/routes/v1/vendorManagement.route.js`, `src/validations/vendorManagement.validation.js` → `transferVendorProductionFlow` |
| Dispatch floor schema | `src/models/vendorManagement/vendorFloorQuantity.embed.js` → `vendorDispatchFloorSchema` |
| Container accept branch | `src/services/production/containersMaster.service.js` → `acceptContainerByBarcode` (Warehouse Inward) |
