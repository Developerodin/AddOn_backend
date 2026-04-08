## Vendor Production Flow (Frontend API + UI Contract)

This doc is the implementation contract for frontend integration.

- Model: `VendorProductionFlow`
- Base route: `/v1/vendor-management/production-flow`
- Fixed pipeline: `secondaryChecking -> branding -> finalChecking -> dispatch` (container staging on secondary→branding and branding→final checking)
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

---

## 2.A) Container workflow (critical for vendor pipeline)

Vendor pipeline uses **container-gated receive** on these legs:

- **`secondaryChecking → branding`**
- **`branding → finalChecking`** (styleCode/brand breakdown)

Meaning:

- A *transfer* creates/stages a **container** (`containers_masters`) with `activeFloor` = destination and an `activeItems[]` row pointing to the `vendorProductionFlow`.
- The destination floor’s **`received` does NOT increase** until someone scans and accepts that container on the receiving floor.

### 2.A.1 Which API stages quantity on a container?

Containers are **already created** (same `containers_masters` as factory). For secondary→branding and branding→final checking you **reuse** a physical container and pass its barcode; the backend **does not** create a new `ContainersMaster` document for vendor staging.

You have two ways to stage:

1) **Auto-transfer (from floor PATCH)**  
If you include `autoTransferToNextFloor: true` **and** `existingContainerBarcode` (the physical bag/container) and there is transferable quantity, backend will:
- increment source `transferred` (and `m1Transferred` for checking floors)
- append a vendor line on that container and set `activeFloor` to the next floor
- keep `currentFloorKey` on the source until accept

2) **Manual transfer endpoint**  
`PATCH /v1/vendor-management/production-flow/:vendorProductionFlowId/transfer`  
Send **`existingContainerBarcode`** together with `fromFloorKey`, `toFloorKey`, `quantity` (and `transferItems` when branding→final checking). Response includes **`vendorTransferContainer: { _id, barcode }`** pointing at that same container.

### 2.A.2 How frontend gets the barcode to scan

- You **choose** the container (existing barcode) before calling transfer or auto-transfer; that barcode is what operators scan on the next floor.
- **Manual transfer** response still includes **`vendorTransferContainer`** (the container you passed in).
- If you need to list containers already staged for a floor, you can still use:

  - List staged containers for the receiving floor:  
    `GET /v1/containers-masters/by-floor/:activeFloor/with-articles`  
    where `activeFloor` is the literal string: **`Branding`** or **`Final Checking`**.

  - Or if you already know barcode from scanner:  
    `GET /v1/containers-masters/barcode/:barcode/with-articles`

Container payload will include `activeItems[]` with:
- `vendorProductionFlowId`
- `quantity`
- optional `transferItems` (branding → final checking only)

### 2.A.3 Accepting a container (the only time destination `received` increases)

On the receiving floor, scan + accept:

- `POST /v1/containers-masters/barcode/:barcode/accept`

Backend will:
- add `quantity` into destination floor `received`
- append `receivedData` rows stamped with `receivedInContainerId`
- set `currentFloorKey` to the receiving floor

Response includes:
- `vendorProductionFlows` when container carried vendor items
- `articles` when container carried production items

### 2.A.4 Branding → Final Checking style-wise rule (no double-counting)

- The container **must** carry `transferItems`: `[{ transferred, styleCode, brand }]`.
- On accept, final checking receives **exactly** `sum(transferItems)` and pushes one `receivedData` row per line.
- Backend validates **cumulative** final-checking receive per `(styleCode, brand)` cannot exceed **cumulative** branding `transferredData` for that key.
  - Example (same style key): first container 10 → ok, second 20 → ok, third “repeat 10 again” would be rejected if branding total cap is only 30.

### 2.A.5 Multi-container and partial transfers

Supported patterns:

- Multiple transfers can use **different** existing containers, or the **same** container across transfers (each transfer appends another `activeItems` line).
- Accepting containers is additive; each accept adds to destination `received` and appends `receivedData`.

Frontend guidance:

- Treat each **accept scan** as a **one-time receipt** for that container’s current payload. Do not attempt to “re-accept” the same staged load.
- If user wants to send more later for the same style key, stage another transfer on a container (or reuse a container per your ops rules) with only the **new quantity** (do not resend already-sent lines).

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

When `autoTransferToNextFloor` / `completedDelta` triggers a forward move **to `branding` or `finalChecking`**, the backend **does not** increase the next floor’s `received` immediately. You must send **`existingContainerBarcode`** on that floor PATCH; the backend stages quantity on that **`containers_masters`** document. **`received` on the destination updates only when someone scans the container barcode** on the receiving floor (`POST /v1/containers-masters/barcode/:barcode/accept`).

Moves **to `dispatch`** from final checking: if you send **`existingContainerBarcode`** (and style **`transferredData`** when applicable), **`dispatch.received` does not increase** until **`POST .../containers-masters/barcode/:barcode/accept`** at **Dispatch**. If you omit the barcode, **`dispatch.received` updates in the same PATCH** (direct handoff, no scan).

---

## 3) Transfer quantity between floors (manual route selection)

`PATCH /v1/vendor-management/production-flow/:vendorProductionFlowId/transfer`

**Body (required):** `fromFloorKey`, `toFloorKey`, `quantity`.

For **secondary → branding** and **branding → final checking**, also send **`existingContainerBarcode`** (reuse a container that already exists; backend does not create a new one).

**Secondary → branding:** `quantity` + **`existingContainerBarcode`**. Backend increments source `transferred` / `m1Transferred`, appends a vendor line on that container with `activeFloor: "Branding"`. **Branding `received` increases on container accept**, not on this PATCH.

**Branding → final checking:** **`existingContainerBarcode`** + **`transferItems`** (style lines). Sum of `transferred` must equal `quantity`.

```json
{
  "fromFloorKey": "secondaryChecking",
  "toFloorKey": "branding",
  "quantity": 10,
  "existingContainerBarcode": "674a1b2c3d4e5f6789012345"
}
```

```json
{
  "fromFloorKey": "branding",
  "toFloorKey": "finalChecking",
  "quantity": 24,
  "existingContainerBarcode": "674a1b2c3d4e5f6789012345",
  "transferItems": [
    { "transferred": 10, "styleCode": "S1", "brand": "B1" },
    { "transferred": 14, "styleCode": "S2", "brand": "B2" }
  ]
}
```

Response includes updated `VendorProductionFlow` plus **`vendorTransferContainer: { _id, barcode }`** for the container you passed. **`currentFloorKey` stays on the sending floor** until the container is accepted on the destination.

### Container accept (vendor + factory)

`POST /v1/containers-masters/barcode/:barcode/accept` — same as production. Response may include **`vendorProductionFlows`** when the container carried vendor lines.

### Transfer rules

- Move is forward-only in pipeline sequence.
- `toFloorKey` must be after `fromFloorKey`.
- Source and destination cannot be same.

**Pool used for transfer (source floor):**

- **Checking floors** (`secondaryChecking`, `finalChecking`):  
  `available ≈ m1Quantity - m1Transferred` (and server rules so you cannot exceed what’s allowed on that floor).
- **Branding:**  
  `available = completed - transferred` (pipeline semantics).

**State updates on `PATCH .../transfer`:**

| Leg | `from` floor | `to` floor | What changes immediately | Destination `received` |
|-----|----------------|------------|---------------------------|---------------------------|
| Secondary → branding | `transferred`, `m1Transferred` | — | **No** — staged in container | **`branding.received`** only on **`POST .../containers-masters/barcode/:barcode/accept`** |
| Branding → final checking | `transferred`, rows **`$push`** to **`branding.transferredData`** | — | **No** — staged in container ( **`transferItems`** = style/brand lines ) | **`finalChecking.received`** only on **accept**; **`receivedData`** gets **one row per line** (same `transferred` / `styleCode` / `brand`) |
| Final checking → dispatch | (if you add a direct transfer API for this leg) | `dispatch.received` | Same request | N/A for vendor container flow |
| Other forward legs (e.g. FC → dispatch via **confirm**) | See §5 | | | |

**Branding → final checking (style-wise quantity):**

- Request **`transferItems`**: `[{ transferred, styleCode, brand }, ...]` with **sum(transferred) = quantity**.
- Container stores the same **`transferItems`** on the active line.
- On **accept**, **`finalChecking.received`** increases by **exactly** `sum(transferItems)` (same as container line `quantity`). No extra units are applied unless you scan another container or patch the floor.
- So **only the quantity that left branding in that transfer** (broken down by style) is what lands in **final checking `received`** for that scan.

**Final checking → dispatch (not the same as `received`):**

- **`POST .../confirm`** moves **`pendingToDispatch = finalChecking.completed - finalChecking.transferred`** (pending “finished” QC work) onto **dispatch**.
- So **dispatch** gets units that are **completed** on final checking and not yet counted as transferred to dispatch — **not** “all `received`” in one click. Typical sequence: FC **`received`** (from containers) → operators set **`completed`** / M1–M4 via **`PATCH floors/finalChecking`** → **confirm** pushes the pending completed amount to **`dispatch.received`**.

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
- Joi may allow `washing` / `boarding` / `branding`; current service implementation only completes rework to **`branding`**. If the API rejects other targets, use **`branding`**.
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

Confirm behavior (backend):
- **`dispatch.received +=`** `max(0, finalChecking.completed - finalChecking.transferred)` (that pending amount).
- **`finalChecking.transferred`** and **`finalChecking.m1Transferred`** are increased by that same pending amount so the floor stays consistent.
- **`dispatch.completed`** is set from **`dispatch.received`** after the move.
- Sets **`currentFloorKey = "dispatch"`**, **`finalQualityConfirmed = true`**, **`completedAt = now`**.

So **dispatch** reflects **QC-completed** work on final checking, not raw **`received`** unless **`completed`** has been brought in line (usually **`completed ≤ received`** after inspection).

**Dispatch style-wise note (after confirm):**

- Backend appends style-wise rows into **`dispatch.receivedData`** on confirm by splitting the `pendingToDispatch` quantity proportionally across the style buckets present in `finalChecking.receivedData` (fallback: one blank style row if none exist).
- This avoids “missing style breakdown” at dispatch without requiring the operator to re-enter style lines at final checking.

---

## 6) End-to-end call sequence (fixed pipeline only)

`secondaryChecking → branding → finalChecking → dispatch`

1. **`GET`** flow — render counters from server.
2. **`PATCH .../floors/secondaryChecking`** — set **M1 / M2 / M4** (and optional **`autoTransferToNextFloor`**, which stages a **container** to branding; destination **`received`** on scan).
3. **`PATCH .../transfer`** `secondaryChecking → branding` with **`quantity`** — or rely on step 2 auto-transfer; **scan container** at branding: **`POST .../containers-masters/barcode/:barcode/accept`** → **`branding.received`** updates.
4. **`PATCH .../floors/branding`** — complete work on branding (**`completed`**, etc.).
5. **`PATCH .../transfer`** `branding → finalChecking` with **`quantity`** + **`transferItems`** (style-wise); **scan** at final checking → **`finalChecking.received`** and **`finalChecking.receivedData`** lines match **`transferItems`**.
6. **`PATCH .../floors/finalChecking`** — inspection split **M1 / M2 / M4**, **`completed`**, etc.
7. **`POST .../confirm`** — move **`completed - transferred`** pending from final checking to **dispatch**.

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
- Use `quantity` for every transfer; add **`transferItems`** for **branding → final checking**.
- After transfer, if response includes **`vendorTransferContainer`**, run **container accept** on the destination floor before expecting **`received`** to change.
- Always render from API response document.
- Transfer modal: **M1 pool** on checking floors; **`completed - transferred`** on branding.
- Surface backend validation messages directly.

