# Vendor Production Flow Frontend API Guide

> **2026 update:** The live vendor pipeline is **`secondaryChecking` → `branding` → `finalChecking` → `dispatch`** (no washing/boarding in code). Production-flow routes **are mounted** under `/v1/vendor-management/production-flow/...`. For **dispatch → warehouse** UI and payloads, use **`docs/VENDOR_DISPATCH_TO_WAREHOUSE_FRONTEND.md`** (accurate contract + WHMS scan step).

This guide is for frontend integration of the vendor production flow.

It documents:

- The fixed vendor production sequence
- The Mongo document structure used by the backend
- The intended API payloads already described in the repo
- The current implementation status in the Express app

All routes in this project are mounted under `/v1`.

## Current backend status

As of 2026-03-24, the vendor production flow model exists in the backend, and the intended API contract is documented in the repo, but these production-flow endpoints are **not currently mounted in Express routes**.

That means:

- The data model exists
- The flow sequence is fixed in code
- The payload shapes are documented
- But the frontend cannot call live `/v1/vendor-management/production-flow...` endpoints yet unless backend routing/controllers are added

This is important for planning frontend work. You can build UI against this contract, but endpoint wiring still needs to be implemented server-side.

## Auth

Use the same auth pattern as the rest of the vendor-management APIs:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

## Fixed flow

The vendor flow is strictly linear and fixed:

```text
secondaryChecking -> washing -> boarding -> branding -> finalChecking
```

This order is defined in the model and does not support branching.

## Source of truth in backend

- Model sequence: `src/models/vendorManagement/vendorProductionFlow.model.js`
- Floor schemas: `src/models/vendorManagement/vendorFloorQuantity.embed.js`
- Existing contract doc: `docs/vendorflow.md`

## Main document shape

A vendor production flow document contains:

```json
{
  "id": "flow_id",
  "vendor": "vendor_management_id",
  "vendorPurchaseOrder": "vendor_po_id",
  "product": "product_id",
  "referenceCode": "BATCH-001",
  "plannedQuantity": 500,
  "remarks": "Express order",
  "currentFloorKey": "washing",
  "finalQualityConfirmed": false,
  "startedAt": "2026-03-24T10:00:00.000Z",
  "completedAt": null,
  "floorQuantities": {
    "secondaryChecking": {},
    "washing": {},
    "boarding": {},
    "branding": {},
    "finalChecking": {}
  },
  "createdAt": "2026-03-24T10:00:00.000Z",
  "updatedAt": "2026-03-24T10:00:00.000Z"
}
```

## Field reference

| Field | Type | Notes |
|------|------|------|
| `vendor` | ObjectId | Required. Refers to `VendorManagement` |
| `vendorPurchaseOrder` | ObjectId | Optional. Refers to `VendorPurchaseOrder` |
| `product` | ObjectId | Optional. Refers to `Product` |
| `referenceCode` | string | Optional batch/reference code |
| `plannedQuantity` | number | Planned quantity for the vendor batch |
| `remarks` | string | Optional notes |
| `currentFloorKey` | enum | One of `secondaryChecking`, `washing`, `boarding`, `branding`, `finalChecking` |
| `finalQualityConfirmed` | boolean | Final confirmation flag |
| `startedAt` | ISO date | Optional |
| `completedAt` | ISO date | Optional |
| `floorQuantities` | object | Per-floor tracking data |

## Floor data structures

### 1. `secondaryChecking`

This is the first floor and the first quality gate.

```json
{
  "received": 500,
  "completed": 0,
  "remaining": 0,
  "transferred": 0,
  "m1Quantity": 450,
  "m2Quantity": 30,
  "m4Quantity": 20,
  "m1Transferred": 0,
  "m1Remaining": 0,
  "m2Transferred": 0,
  "m2Remaining": 0,
  "repairStatus": "REQUIRED",
  "repairRemarks": "30 minor fixes",
  "receivedData": [
    {
      "receivedStatusFromPreviousFloor": "",
      "receivedInContainerId": null,
      "receivedTimestamp": null
    }
  ],
  "externalSource": {
    "pending": true,
    "lastSyncedAt": null,
    "sourceRef": "SYS-01",
    "notes": "Imported from scan"
  }
}
```

Notes:

- Vendor checking floors track `M1`, `M2`, `M4`
- There is no `M3` in vendor flow
- `repairStatus` comes from shared production enums

Typical `repairStatus` values:

- `NOT_REQUIRED`
- `REQUIRED`
- `IN_PROGRESS`
- `REPAIRED`

### 2. `washing`

Standard processing floor:

```json
{
  "received": 450,
  "completed": 450,
  "remaining": 0,
  "transferred": 450,
  "repairReceived": 0,
  "receivedData": [
    {
      "receivedStatusFromPreviousFloor": "Clean",
      "receivedInContainerId": "container_id",
      "receivedTimestamp": "2026-03-24T12:00:00.000Z"
    }
  ]
}
```

### 3. `boarding`

Same schema as `washing`:

```json
{
  "received": 450,
  "completed": 450,
  "remaining": 0,
  "transferred": 450,
  "repairReceived": 0,
  "receivedData": [
    {
      "receivedStatusFromPreviousFloor": "Washed",
      "receivedInContainerId": "container_id",
      "receivedTimestamp": "2026-03-24T13:00:00.000Z"
    }
  ]
}
```

### 4. `branding`

Branding adds style/brand transfer details:

```json
{
  "received": 450,
  "completed": 450,
  "remaining": 0,
  "transferred": 450,
  "repairReceived": 0,
  "transferredData": [
    {
      "transferred": 200,
      "styleCode": "XL-BLUE",
      "brand": "Adidas"
    },
    {
      "transferred": 250,
      "styleCode": "XL-RED",
      "brand": "Puma"
    }
  ],
  "receivedData": [
    {
      "receivedStatusFromPreviousFloor": "Boarding complete",
      "receivedInContainerId": "container_id",
      "receivedTimestamp": "2026-03-24T14:00:00.000Z",
      "transferred": 200,
      "styleCode": "XL-BLUE",
      "brand": "Adidas"
    }
  ]
}
```

### 5. `finalChecking`

Last quality floor before final confirmation:

```json
{
  "received": 450,
  "completed": 450,
  "remaining": 0,
  "transferred": 445,
  "m1Quantity": 445,
  "m2Quantity": 5,
  "m4Quantity": 0,
  "m1Transferred": 445,
  "m1Remaining": 0,
  "m2Transferred": 0,
  "m2Remaining": 5,
  "repairStatus": "NOT_REQUIRED",
  "repairRemarks": "",
  "transferredData": [
    {
      "transferred": 445,
      "styleCode": "XL-BLUE",
      "brand": "Adidas"
    }
  ],
  "receivedData": [
    {
      "receivedStatusFromPreviousFloor": "Branding complete",
      "receivedInContainerId": "container_id",
      "receivedTimestamp": "2026-03-24T15:00:00.000Z",
      "transferred": 445,
      "styleCode": "XL-BLUE",
      "brand": "Adidas"
    }
  ]
}
```

## Intended API contract

The repo already includes a contract doc for these endpoints in `docs/vendorflow.md`.

These are the intended endpoints for frontend integration.

## 1. Create production flow

`POST /v1/vendor-management/production-flow`

### Request body

```json
{
  "vendor": "65f1a...",
  "vendorPurchaseOrder": "65f1b...",
  "product": "65f1c...",
  "plannedQuantity": 500,
  "referenceCode": "BATCH-001",
  "remarks": "Express order"
}
```

### Field notes

| Field | Required | Notes |
|------|------|------|
| `vendor` | yes | VendorManagement id |
| `vendorPurchaseOrder` | no | VendorPurchaseOrder id |
| `product` | no | Product id |
| `plannedQuantity` | no | Number, defaults to `0` in model |
| `referenceCode` | no | Batch code/reference |
| `remarks` | no | Free text |

### Expected frontend behavior

- Create a new batch/flow document for one vendor
- Store returned `id`
- Use `currentFloorKey` to render stage progress

## 2. Get/list production flows

There is no mounted route yet in Express for list/get operations, but frontend will likely need:

- `GET /v1/vendor-management/production-flow`
- `GET /v1/vendor-management/production-flow/:flowId`

Recommended response shape should include the full document shown above.

## 3. Update floor / move flow forward

The existing repo doc mentions transition updates through:

`PATCH /v1/vendor-management/production-flow/:flowId/update-floor`

It also shows floor-specific payload examples such as:

- `PATCH /.../floors/secondaryChecking`
- `PATCH /.../floors/washing`
- `PATCH /.../floors/boarding`
- `PATCH /.../floors/branding`
- `PATCH /.../floors/finalChecking`

Because the endpoints are not yet mounted, frontend and backend should align on one final route style before implementation.

### Recommended route style

For clarity, this is the cleaner REST shape:

`PATCH /v1/vendor-management/production-flow/:flowId/floors/:floorKey`

Where `:floorKey` is one of:

- `secondaryChecking`
- `washing`
- `boarding`
- `branding`
- `finalChecking`

## 4. Confirm final quality

Documented intended endpoint:

`POST /v1/vendor-management/production-flow/:id/confirm`

### Expected result

- Set `finalQualityConfirmed = true`
- Optionally set `completedAt`

## Transition logic

When moving output from one stage to the next:

1. Increase `transferred` in the current floor
2. Update `currentFloorKey` to the next floor
3. Increase `received` in the next floor
4. Push a record into next floor `receivedData`

So if `washing` completes 450 and sends all forward:

- `washing.transferred += 450`
- `currentFloorKey = "boarding"`
- `boarding.received += 450`
- `boarding.receivedData.push(...)`

## Floor payloads for frontend

These payloads come from the existing contract doc and match the model structure.

## Secondary Checking payload

```json
{
  "received": 500,
  "m1Quantity": 450,
  "m2Quantity": 30,
  "m4Quantity": 20,
  "repairStatus": "REQUIRED",
  "repairRemarks": "30 minor fixes",
  "externalSource": {
    "sourceRef": "SYS-01",
    "notes": "Imported from scan"
  }
}
```

## Washing payload

```json
{
  "received": 450,
  "completed": 450,
  "transferred": 450,
  "repairReceived": 0,
  "metadata": {
    "receivedStatusFromPreviousFloor": "Clean",
    "receivedInContainerId": "65f1d...",
    "receivedTimestamp": "2024-03-24T12:00:00Z"
  }
}
```

## Boarding payload

```json
{
  "received": 450,
  "completed": 450,
  "transferred": 450,
  "repairReceived": 0,
  "metadata": {
    "receivedStatusFromPreviousFloor": "Washed",
    "receivedInContainerId": "65f1d...",
    "receivedTimestamp": "2024-03-24T13:00:00Z"
  }
}
```

## Branding payload

```json
{
  "received": 450,
  "completed": 450,
  "transferred": 450,
  "transferredData": [
    {
      "transferred": 200,
      "styleCode": "XL-BLUE",
      "brand": "Adidas"
    },
    {
      "transferred": 250,
      "styleCode": "XL-RED",
      "brand": "Puma"
    }
  ]
}
```

## Final Checking payload

```json
{
  "received": 450,
  "m1Quantity": 445,
  "m2Quantity": 5,
  "m4Quantity": 0,
  "m1Transferred": 445,
  "m1Remaining": 0,
  "repairStatus": "NOT_REQUIRED",
  "transferredData": [
    {
      "transferred": 445,
      "styleCode": "XL-BLUE",
      "brand": "Adidas"
    }
  ]
}
```

## Suggested frontend screen flow

### Create screen

Collect:

- Vendor
- Vendor PO
- Product
- Planned quantity
- Reference code
- Remarks

### Tracking screen

Display:

- Current stage from `currentFloorKey`
- Per-floor totals
- Quality counts on checking floors
- Branding split by `styleCode` and `brand`
- Final confirmation status

### Stage update forms

- `secondaryChecking`: quality buckets plus repair details
- `washing`: received/completed/transferred
- `boarding`: received/completed/transferred
- `branding`: received/completed/transferred plus `transferredData`
- `finalChecking`: final quality buckets plus transfer split

## Integration caution

Before frontend starts live API integration, backend and frontend should confirm these open points:

1. Whether the route style will be `/:flowId/update-floor` or `/:flowId/floors/:floorKey`
2. Whether list/get endpoints for production-flow will be added
3. Exact response shape after each PATCH
4. Whether `completedAt` should be auto-set when final confirmation happens

## Practical recommendation

For now:

- Frontend can build screens and local types from this document
- Backend still needs to expose the vendor production flow routes/controllers/services
- Once routes are implemented, this doc should be updated with exact live endpoints and response examples

