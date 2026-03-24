# Vendor Production Flow API Integration Guide

This document describes the API integration for the Vendor Production Flow module. It follows a strictly linear, fixed sequence:
`secondaryChecking` → `washing` → `boarding` → `branding` → `finalChecking`

---

## 1. Create a Production Flow
Initializes a production batch for a specific Vendor.
- **Endpoint**: `POST /v1/vendor-management/production-flow`
- **Request Body**:
```json
{
  "vendor": "65f1a...", // Vendor ID
  "vendorPurchaseOrder": "65f1b...", // PO ID (Optional)
  "product": "65f1c...", // Product ID
  "plannedQuantity": 500,
  "referenceCode": "BATCH-001",
  "remarks": "Express order"
}
```

---

## 2. Tracking the Current Stage
Each flow document tracks its location using the `currentFloorKey` field.

- **Current Stage**: `currentFloorKey` (e.g., `washing`)
- **Transitions**: As items finish at one stage, they move forward. Use `PATCH /:flowId/update-floor` to update the current stage.

---

## 3. Global Stage Update Logic
When transferring from **Stage A** to **Stage B**:
1. Increment the `transferred` count in **Stage A**.
2. Update `currentFloorKey` to **Stage B**.
3. Increment the `received` count in **Stage B**.
4. Push a record into **Stage B's** `receivedData` array describing where it came from.

---

## 3. Floor-Specific API Payloads

### Floor 1: `secondaryChecking`
Tracks quality grades (M1, M2, M4) and optional external source data.
- **Payload (`PATCH /.../floors/secondaryChecking`)**:
```json
{
  "received": 500,
  "m1Quantity": 450,
  "m2Quantity": 30,
  "m4Quantity": 20,
  "repairStatus": "REQUIRED", // NOT_REQUIRED, REQUIRED, IN_PROGRESS, REPAIRED
  "repairRemarks": "30 minor fixes",
  "externalSource": {
    "sourceRef": "SYS-01",
    "notes": "Imported from scan"
  }
}
```

### Floors 2 & 3: `washing` and `boarding`
Standard processing floors.
- **Payload (`PATCH /.../floors/washing` or `/boarding`)**:
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

### Floor 4: `branding`
Tracks style codes and brand names during processing.
- **Payload (`PATCH /.../floors/branding`)**:
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

### Floor 5: `finalChecking`
Final audit before warehouse delivery.
- **Payload (`PATCH /.../floors/finalChecking`)**:
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

---

## 4. Final Confirmation
Once all stages are complete, set the batch as confirmed.
- **Endpoint**: `POST /v1/vendor-management/production-flow/:id/confirm`
- **Body**: `{}`
- **Result**: `finalQualityConfirmed` becomes `true`.
