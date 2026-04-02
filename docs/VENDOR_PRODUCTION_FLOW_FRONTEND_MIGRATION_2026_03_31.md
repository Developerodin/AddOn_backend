# Vendor Production Flow Frontend Migration (2026-03-31)

This is the frontend action document for the vendor flow change shipped in backend.

## What changed in backend

- Flow sequence changed from:
  - `secondaryChecking -> washing -> boarding -> branding -> finalChecking -> dispatch`
- To:
  - `secondaryChecking -> branding -> finalChecking -> dispatch`
- `washing` and `boarding` are removed from active vendor production flow keys.
- Final-checking M2 rework transfer now allows only:
  - `toFloorKey: "branding"`

## Frontend scope to remove

- Remove `washing` stage UI from:
  - stepper/progress bars
  - floor tabs
  - floor filter dropdowns
  - transfer destination dropdowns
- Remove `boarding` stage UI from all the same places.
- Remove any forms/components dedicated to:
  - `PATCH .../floors/washing`
  - `PATCH .../floors/boarding`
- Remove any hardcoded floor arrays that still include:
  - `washing`
  - `boarding`

## Frontend API contract updates

### Floor keys

Use only:

- `secondaryChecking`
- `branding`
- `finalChecking`
- `dispatch`

### Transfer rules

- If using manual transfer API, destination options must not include `washing` or `boarding`.
- For final-checking M2 rework transfer endpoint:
  - allow only `toFloorKey = "branding"`
  - remove old UI choices for `washing` and `boarding`

### Error handling text to expect

If old destinations are sent by stale clients, backend returns validation errors.
Frontend should show backend message directly and prompt refresh.

## UI behavior changes

- Primary happy path:
  1. `secondaryChecking`
  2. `branding`
  3. `finalChecking`
  4. `dispatch`
- Remove route visualizations that depict `secondaryChecking -> washing -> boarding`.
- Remove mixed-path UX variants that branch through washing/boarding.

## Type/constant changes required in frontend

Update shared constants and unions.

Before:

```ts
type VendorFloorKey =
  | "secondaryChecking"
  | "washing"
  | "boarding"
  | "branding"
  | "finalChecking"
  | "dispatch";
```

After:

```ts
type VendorFloorKey =
  | "secondaryChecking"
  | "branding"
  | "finalChecking"
  | "dispatch";
```

Recommended single source constant:

```ts
export const vendorFlowFloorKeys = [
  "secondaryChecking",
  "branding",
  "finalChecking",
  "dispatch",
] as const;
```

## QA checklist for frontend

- Create flow and confirm floor stepper skips washing/boarding.
- Perform transfer from secondary checking and confirm destination list excludes removed floors.
- Complete branding and final checking; confirm dispatch works as expected.
- Try stale payload with removed floor key and verify friendly error display.

## Rollout note

Frontend and backend must be deployed together, or frontend must be feature-flagged to avoid sending removed floor keys.
