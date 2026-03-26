## Vendor Production Flow (Frontend API + UI Contract)

This doc is the implementation contract for frontend integration.

- Model: `VendorProductionFlow`
- Base route: `/v1/vendor-management/production-flow`
- Fixed pipeline: `secondaryChecking -> washing -> boarding -> branding -> finalChecking -> dispatch`
- All mutation APIs return updated flow document; always re-render from response.

Backend supports additive updates using `mode: "increment"` and delta fields.

**Floor-specific breakdown (styleCode / brand):**

- `vendor-production-flow-branding-floor-api.md` — branding `transferredData` / `receivedData`
- `vendor-production-flow-final-checking-floor-api.md` — final checking `transferredData` / `receivedData` (vendor has no M3)

---

## 1) Load flow data

`GET /v1/vendor-management/production-flow`

Optional query filters:
- `vendor`
- `vendorPurchaseOrder`
- `product`
- `currentFloorKey`

Use response as single source of truth for UI counters.

### 1.1 Single flow (detail page)

`GET /v1/vendor-management/production-flow/:vendorProductionFlowId`

Auth required. Returns one document with the same populated fields as list rows (`vendor`, `vendorPurchaseOrder`, `product`). `404` if id is missing or invalid.

---

## 2) Patch one floor

`PATCH /v1/vendor-management/production-flow/:vendorProductionFlowId/floors/:floorKey`

### 2.1 Increment mode (recommended)

Use deltas only.

```json
{
  "mode": "increment",
  "completedDelta": 10
}
```

For checking floors (`secondaryChecking`, `finalChecking`) you can also send quality split deltas (additive on previous stored values):

```json
{
  "mode": "increment",
  "m1Delta": 5,
  "m2Delta": 3,
  "m4Delta": 1,
  "repairStatus": "In Review",
  "repairRemarks": "batch check"
}
```

**M1 / M2 / M4 rules**

- Backend **does not** overwrite `m1Quantity` with `received − m2 − m4`.
- **Default (checking floors):** sending `m1Quantity` / `m2Quantity` / `m4Quantity` **without** `mode: "replace"` and **without** structural fields (`received`, `completed`, `transferred`, `remaining`, or `*Delta` for those) is treated as **additive** — each value is applied as **`m1Delta` / `m2Delta` / `m4Delta`** (increment on top of existing).
- **Absolute overwrite:** send **`mode: "replace"`** with the full `m1Quantity` / `m2Quantity` / `m4Quantity` you want stored.
- You can also send **`mode: "increment"`** with **`m1Delta` / `m2Delta` / `m4Delta`** explicitly (same additive behavior).
- Invariant: **`m1Quantity + m2Quantity + m4Quantity ≤ received`** on that checking floor after each update.

**`remaining` vs `m1Remaining` (checking floors)**

- **`remaining`** = **`received − m2Quantity − m4Quantity − transferred − completed`** — net quantity after reserving M2/M4 and after outflow. Example: `received = 120`, `m2 = 10`, `m4 = 0`, no transfers → **`remaining = 110`**.
- **`m1Remaining`** = **`m1Quantity − m1Transferred`** — how much of the **declared M1 bucket** is still available to transfer (M1 path only). These are different fields; do not expect `remaining === m1Remaining` unless your numbers happen to align.

Backend behavior:

- Applies `$inc` for deltas
- Recomputes **derived only**: `remaining`, `m1Remaining`, `m2Remaining` (not `m1Quantity`)
- Validates impossible states and rejects with `400`

### 2.2 Replace mode (absolute values)

Send absolute numbers when setting a floor from the form (no `mode: "increment"` and no `*Delta` fields):

```json
{
  "m1Quantity": 30,
  "m2Quantity": 10,
  "m4Quantity": 10,
  "repairStatus": "Not Required",
  "repairRemarks": ""
}
```

Use this for “first save” of the split; use **increment** + `m1Delta` / `m2Delta` / `m4Delta` for later additive updates.

### 2.3 Reset secondary checking (retest)

`PATCH` `.../floors/secondaryChecking` with:

```json
{ "resetSecondaryChecking": true }
```

Clears on **secondary checking only**: M1–M4, transfers, completed, repair text, `receivedData`; **keeps** `received` (and planned flow totals). Invalid on other floors.

### 2.4 Auto-transfer note (important)

When `completedDelta` is patched, current service auto-moves transferable quantity to next floor.
Frontend should assume that completing a floor may also increase next floor `received` and current floor `transferred`.

---

## 3) Transfer quantity between floors (manual route selection)

`PATCH /v1/vendor-management/production-flow/:vendorProductionFlowId/transfer`

Use this when user chooses destination floor explicitly (for example, direct `secondaryChecking -> branding`).

Recommended payload:

```json
{
  "mode": "increment",
  "fromFloorKey": "secondaryChecking",
  "toFloorKey": "branding",
  "quantity": 10
}
```

Compatibility note:
- Validation supports `quantityDelta`, but current controller/service path reads `quantity`.
- To avoid mismatch, send `quantity` from frontend.

### Transfer rules

- Move is forward-only in pipeline sequence.
- `toFloorKey` must be after `fromFloorKey`.
- Source and destination cannot be same.

Pool used for transfer:
- From checking floor (`secondaryChecking`, `finalChecking`): transfer uses **M1** pool  
  `available = m1Quantity - m1Transferred`
- From normal floors (`washing`, `boarding`, `branding`): transfer uses normal pool  
  `available = completed - transferred`

State updates:
- `from.transferred += qty`
- (checking floor only) `from.m1Transferred += qty`
- `to.received += qty`

---

## 4) Final-checking M2 rework transfer

`PATCH /v1/vendor-management/production-flow/:vendorProductionFlowId/final-checking/m2-transfer`

```json
{
  "toFloorKey": "washing",
  "quantity": 5,
  "remarks": "rework batch 7"
}
```

Rules:
- Allowed target floors: `washing`, `boarding`, `branding`
- Available M2: `finalChecking.m2Quantity - finalChecking.m2Transferred`
- Updates:
  - `finalChecking.m2Transferred += qty`
  - `target.repairReceived += qty`
  - `target.remaining += qty`

---

## 5) Confirm and dispatch

`POST /v1/vendor-management/production-flow/:vendorProductionFlowId/confirm`

Optional body:

```json
{
  "remarks": "ready to dispatch"
}
```

Confirm behavior:
- Moves pending final-checking completed qty to dispatch
- Sets:
  - `currentFloorKey = "dispatch"`
  - `finalQualityConfirmed = true`
  - `completedAt = now`

---

## 6) End-to-end call sequence (floor-by-floor)

### Flow A: direct branding route

1. Load flow (`GET`)
2. Secondary checking quality split (`PATCH floors/secondaryChecking`)
3. Transfer to branding (`PATCH transfer`, `secondaryChecking -> branding`)
4. Complete branding (`PATCH floors/branding`)
5. Complete final checking (`PATCH floors/finalChecking`)
6. Confirm dispatch (`POST confirm`)

### Flow B: full standard route

1. Load flow
2. Secondary checking update
3. Transfer `secondaryChecking -> washing`
4. Complete washing
5. Complete boarding
6. Complete branding
7. Complete final checking
8. Confirm dispatch

### Flow C: mixed route

1. Load flow
2. Transfer part direct to branding
3. Transfer part to washing
4. Process washing -> boarding -> branding
5. Complete final checking
6. Confirm dispatch

---

## 7) Frontend form rules and edge cases

### 7.1 Quantity input validation

Before API call, block submit when:
- Quantity is empty, NaN, decimal (if not allowed), or `<= 0`
- Quantity > computed available pool

### 7.2 How to compute available in UI

For transfer modal:
- If source is checking floor:  
  `available = max(0, m1Quantity - m1Transferred)`
- Else:  
  `available = max(0, completed - transferred)`

Always recalc from latest server response after each success.

### 7.3 Destination validation

- Disallow backward move in UI dropdown.
- Disallow same floor.
- Show only valid forward floors.

### 7.4 Handling 400 errors gracefully

Common backend 400 messages:
- `Transfer quantity must be greater than 0`
- `Destination floor must be after source floor`
- `Only X quantity available to transfer`
- `Only X M1 quantity available to transfer`
- `Completed + transferred cannot exceed received`

UI action:
- Show exact backend message near form
- Do not mutate local totals manually
- Refetch current row if needed

### 7.5 Prevent stale state bugs

- Disable submit while mutation is in-flight.
- Use optimistic UI only for button loading, not for counters.
- On success, replace row from response payload.
- If multi-user editing is possible, poll or refresh before submit.

---

## 8) Minimal frontend integration checklist

- Use increment mode for all floor updates.
- Use `quantity` for transfer payload.
- Always render from API response document.
- Keep transfer modal aware of M1 vs normal pool logic.
- Surface backend validation messages directly.
- Support all three paths: direct branding, full route, mixed route.

