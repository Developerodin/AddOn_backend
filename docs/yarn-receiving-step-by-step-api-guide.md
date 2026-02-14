# Yarn Receiving Step-by-Step API Guide

## Overview
The yarn receiving workflow has been refactored to support step-by-step processing, allowing the UI to process each step individually with user review between steps. The system also supports auto-approval when processing Excel data that matches expected values.

## Workflow Steps

### Step 1: Update PO to "in_transit" with Packing Details
**Endpoint:** `POST /v1/yarn-management/yarn-receiving/process-step-by-step`  
**Body:**
```json
{
  "step": 1,
  "poNumber": "PO-2026-257",
  "packing": {
    "packingNumber": "EPR-01",
    "courierName": "Ekart",
    "courierNumber": "EPR-02",
    "vehicleNumber": "MH04BC4455",
    "challanNumber": "MH04BC5544",
    "dispatchDate": "2026-02-10",
    "estimatedDeliveryDate": "2026-02-28",
    "notes": ""
  },
  "lots": [
    {
      "lotNumber": "EW1205",
      "numberOfCones": 5,
      "totalWeight": 1901,
      "numberOfBoxes": 5,
      "poItems": [
        { "poItem": "698b191e0ba35154c81460a6", "receivedQuantity": 343 }
      ]
    }
  ],
  "updated_by": {
    "username": "admin@addon.in",
    "user_id": "6831691b98f9ff407c4e8788"
  },
  "notes": "Shipment collected by courier"
}
```

**What it does:**
- Updates PO status to `in_transit`
- Adds packing details to `packListDetails` array
- Calculates total weight and number of boxes from lots

---

### Step 2: Add Lot Details to Packing List
**Endpoint:** `POST /v1/yarn-management/yarn-receiving/process-step-by-step`  
**Body:**
```json
{
  "step": 2,
  "poNumber": "PO-2026-257",
  "lots": [
    {
      "lotNumber": "EW1205",
      "numberOfCones": 5,
      "totalWeight": 1901,
      "numberOfBoxes": 5,
      "poItems": [
        { "poItem": "698b191e0ba35154c81460a6", "receivedQuantity": 343 },
        { "poItem": "698b191e0ba35154c81460a7", "receivedQuantity": 343 }
      ]
    }
  ]
}
```

**What it does:**
- Adds lot details to `receivedLotDetails` array
- Sets lot status to `lot_pending` by default

---

### Step 3: Process/Generate Barcodes (Create Boxes)
**Endpoint:** `POST /v1/yarn-management/yarn-receiving/process-step-by-step`  
**Body:**
```json
{
  "step": 3,
  "poNumber": "PO-2026-257",
  "lots": [
    {
      "lotNumber": "EW1205",
      "numberOfBoxes": 5
    }
  ]
}
```

**What it does:**
- Creates boxes with auto-generated barcodes
- Returns created box details

---

### Step 4: Update Box Details
**Endpoint:** `POST /v1/yarn-management/yarn-receiving/process-step-by-step`  
**Body:**
```json
{
  "step": 4,
  "poNumber": "PO-2026-257",
  "lots": [
    {
      "lotNumber": "EW1205",
      "boxUpdates": [
        {
          "yarnName": "70/1-Sea Green-Sea Green-Nylon/Nylon",
          "shadeCode": "WN96793",
          "boxWeight": 343,
          "numberOfCones": 2
        }
      ]
    }
  ]
}
```

**What it does:**
- Updates each box with yarnName, shadeCode, boxWeight, and numberOfCones
- Matches boxUpdates array to boxes by lotNumber and creation order

---

### Step 5: Send for QC
**Endpoint:** `POST /v1/yarn-management/yarn-receiving/process-step-by-step`  
**Body:**
```json
{
  "step": 5,
  "poNumber": "PO-2026-066",
  "lotNumber": "DDM217090"
}
```

**What it does:**
- Updates lot status to `lot_qc_pending`
- Lot is now ready for QC review

---

### Step 6: Get Box by Barcode (for QC)
**Endpoint:** `GET /v1/yarn-management/yarn-boxes/barcode/:barcode`  
**Example:** `GET /v1/yarn-management/yarn-boxes/barcode/698b5995b350cb3ef414ca63`

**What it does:**
- Returns box details with PO and supplier information
- Used during QC review to verify box contents

---

### Step 7: Approve QC
**Endpoint:** `POST /v1/yarn-management/yarn-receiving/process-step-by-step`  
**Body:**
```json
{
  "step": 7,
  "poNumber": "PO-2026-066",
  "lotNumber": "DDM217090",
  "updated_by": {
    "username": "admin@addon.in",
    "user_id": "6831691b98f9ff407c4e8788"
  },
  "notes": "QC approved",
  "qcData": {
    "remarks": "All boxes verified",
    "mediaUrl": {
      "image1": "https://example.com/image1.jpg"
    }
  }
}
```

**What it does:**
- Updates lot status to `lot_accepted`
- Updates all boxes for the lot with QC data
- Sets QC status to `qc_approved` on all boxes

---

## Alternative: Process All Steps at Once

### Full Pipeline Processing
**Endpoint:** `POST /v1/yarn-management/yarn-receiving/process`  
**Body:**
```json
{
  "items": [
    {
      "poNumber": "PO-2026-257",
      "packing": { ... },
      "lots": [ ... ],
      "notes": "Optional notes",
      "autoApproveQc": false
    }
  ],
  "notes": "Optional global notes",
  "autoApproveQc": false
}
```

**What it does:**
- Processes all steps (1-4) in one call
- If `autoApproveQc: true` and data matches expected values, automatically:
  - Sets lot status to `lot_qc_pending` (Step 5)
  - Then immediately approves QC (Step 7)

**Auto-Approval Logic:**
- Compares received quantities with ordered quantities for each PO item
- If all quantities match (within 0.01 tolerance), auto-approves QC
- Only works when `autoApproveQc: true` is set

---

## Using Step Number in URL

You can also use the step number in the URL:

**Endpoint:** `POST /v1/yarn-management/yarn-receiving/step/:stepNumber`  
**Example:** `POST /v1/yarn-management/yarn-receiving/step/1`

Body format is the same as `process-step-by-step` but without the `step` field (it comes from URL).

---

## Error Handling

All endpoints return standard error responses:
- `400 Bad Request` - Invalid input or missing required fields
- `404 Not Found` - PO or lot not found
- `500 Internal Server Error` - Server error

Step-by-step endpoints validate that:
- Previous steps are completed before allowing next step
- Required fields are present for each step
- PO and lot exist before processing

---

## Notes

1. **Authentication:** All endpoints require authentication (`auth()` middleware)
2. **User Context:** If `updated_by` is not provided, it's extracted from `req.user`
3. **Backward Compatibility:** The original `/process` endpoint still works as before
4. **Step 6:** Step 6 (Get box by barcode) uses the existing GET endpoint, not the step-by-step endpoint
5. **Data Matching:** Auto-approval only works when processing Excel data that exactly matches expected values

---

## Example: Complete Workflow

```javascript
// Step 1: Update PO to in_transit
POST /v1/yarn-management/yarn-receiving/process-step-by-step
{ step: 1, poNumber: "PO-2026-257", packing: {...}, lots: [...] }

// Step 2: Add lot details
POST /v1/yarn-management/yarn-receiving/process-step-by-step
{ step: 2, poNumber: "PO-2026-257", lots: [...] }

// Step 3: Generate barcodes
POST /v1/yarn-management/yarn-receiving/process-step-by-step
{ step: 3, poNumber: "PO-2026-257", lots: [...] }

// Step 4: Update box details
POST /v1/yarn-management/yarn-receiving/process-step-by-step
{ step: 4, poNumber: "PO-2026-257", lots: [...] }

// Step 5: Send for QC
POST /v1/yarn-management/yarn-receiving/process-step-by-step
{ step: 5, poNumber: "PO-2026-257", lotNumber: "EW1205" }

// Step 6: Get box by barcode (during QC)
GET /v1/yarn-management/yarn-boxes/barcode/698b5995b350cb3ef414ca63

// Step 7: Approve QC
POST /v1/yarn-management/yarn-receiving/process-step-by-step
{ step: 7, poNumber: "PO-2026-257", lotNumber: "EW1205", updated_by: {...}, notes: "QC approved" }
```
