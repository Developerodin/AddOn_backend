# Yarn Receiving Step-by-Step Implementation Plan

## Overview
Refactor the yarn receiving pipeline to support step-by-step processing with manual QC workflow and auto-approval option when processing Excel data.

## Current State
- `runReceivingPipelineForPo` does everything in one go: pack list + in_transit → received lots → create boxes → update boxes
- All APIs exist but need to be properly integrated into the step-by-step workflow

## New Workflow

### Step 1: Update PO to "in_transit" with Packing Details
**API:** `PATCH /v1/yarn-management/yarn-purchase-orders/:purchaseOrderId/status`
- Status: `in_transit`
- Packing details: `packListDetails` array with:
  - `packingNumber`
  - `courierName`
  - `courierNumber`
  - `vehicleNumber`
  - `challanNumber`
  - `dispatchDate`
  - `estimatedDeliveryDate`
  - `numberOfBoxes` (calculated from lots)
  - `totalWeight` (calculated from lots)
  - `poItems` (array of PO item IDs)

### Step 2: Add Lot Details to Packing List
**API:** `PATCH /v1/yarn-management/yarn-purchase-orders/:purchaseOrderId`
- Update `receivedLotDetails` array with:
  - `lotNumber`
  - `numberOfCones`
  - `totalWeight`
  - `numberOfBoxes`
  - `poItems`: `[{ poItem, receivedQuantity }]`
  - `status`: `lot_pending` (default)

### Step 3: Process/Generate Barcodes (Create Boxes)
**API:** `POST /v1/yarn-management/yarn-boxes/bulk-create`
- Input: `{ poNumber, lotDetails: [{ lotNumber, numberOfBoxes }] }`
- Creates boxes with auto-generated barcodes

### Step 4: Update Box Details
**API:** `PATCH /v1/yarn-management/yarn-boxes/:boxId`
- Update each box with:
  - `yarnName`
  - `shadeCode`
  - `boxWeight`
  - `numberOfCones`

### Step 5: Send for QC
**API:** `PATCH /v1/yarn-management/yarn-purchase-orders/lot-status`
- Update lot status to `lot_qc_pending`
- Input: `{ poNumber, lotNumber, lotStatus: "lot_qc_pending" }`

### Step 6: Get Box by Barcode (for QC)
**API:** `GET /v1/yarn-management/yarn-boxes/barcode/:barcode`
- Already exists, returns box details with PO and supplier info

### Step 7: Approve QC
**API:** `PATCH /v1/yarn-management/yarn-purchase-orders/lot-status-qc-approve`
- Update lot status to `lot_accepted`
- Input: `{ poNumber, lotNumber, lotStatus: "lot_accepted", updated_by, notes, remarks?, mediaUrl? }`
- Updates all boxes for the lot with QC data

## Implementation Tasks

### 1. Refactor Pipeline Service (`yarnReceivingPipeline.service.js`)

#### 1.1 Create Separate Step Functions
- `updatePoToInTransit()` - Step 1: Update PO status and packListDetails
- `addLotDetails()` - Step 2: Add receivedLotDetails
- `processBarcodes()` - Step 3: Create boxes (wrapper around bulkCreateYarnBoxes)
- `updateBoxDetails()` - Step 4: Update box weight/cones/yarnName/shadeCode
- `sendForQc()` - Step 5: Update lot status to lot_qc_pending
- `approveQc()` - Step 6: Update lot status to lot_accepted (wrapper around existing service)

#### 1.2 Modify `runReceivingPipelineForPo`
- Add `autoApproveQc` parameter (boolean, default false)
- If `autoApproveQc === true` and data matches, skip Step 5 and go directly to Step 7
- Keep backward compatibility - if called without step-by-step flags, run full pipeline

#### 1.3 Add Step-by-Step Processing Function
- `processReceivingStepByStep()` - New function that processes one step at a time
- Returns current step and allows UI to call next step

### 2. Update Controller (`yarnReceiving.controller.js`)

#### 2.1 Add New Endpoints
- `POST /process-step-by-step` - Process receiving with step-by-step workflow
- `POST /step/:stepNumber` - Process specific step (1-7)
- Keep existing `/process` endpoint for backward compatibility

#### 2.2 Add Auto-Approval Logic
- Check if Excel data matches expected values
- If match, set `autoApproveQc: true` in pipeline call

### 3. Update Validation (`yarnReceiving.validation.js`)

#### 3.1 Add Validation Schemas
- `processReceivingStepByStep` - Validate step-by-step input
- `processReceivingStep` - Validate individual step input
- Add `autoApproveQc` flag validation

### 4. Update Routes (`yarnReceiving.route.js`)

#### 4.1 Add New Routes
```javascript
router.route('/process-step-by-step').post(...)
router.route('/step/:stepNumber').post(...)
```

### 5. Data Matching Logic for Auto-Approval

#### 5.1 Create Matching Function
- `checkDataMatch()` - Compare received data with PO data
- Check:
  - Total weight matches expected
  - Number of boxes matches
  - Number of cones matches
  - PO items received quantities match ordered quantities
- Return boolean: `true` if all match, `false` otherwise

#### 5.2 Integration
- Call `checkDataMatch()` in `runReceivingPipelineForPo` when processing Excel
- If match, set `autoApproveQc: true`

### 6. Error Handling

#### 6.1 Step Validation
- Validate that previous steps are completed before allowing next step
- Check PO status before each step
- Check lot existence before updating lot status

#### 6.2 Rollback Strategy
- If a step fails, provide rollback capability
- Store step state to allow resuming from last successful step

## API Endpoints Summary

### Existing (Keep As-Is)
1. `PATCH /v1/yarn-management/yarn-purchase-orders/:id/status` ✅
2. `PATCH /v1/yarn-management/yarn-purchase-orders/:id` ✅
3. `POST /v1/yarn-management/yarn-boxes/bulk-create` ✅
4. `PATCH /v1/yarn-management/yarn-boxes/:id` ✅
5. `PATCH /v1/yarn-management/yarn-purchase-orders/lot-status` ✅
6. `GET /v1/yarn-management/yarn-boxes/barcode/:barcode` ✅
7. `PATCH /v1/yarn-management/yarn-purchase-orders/lot-status-qc-approve` ✅

### New (To Add)
1. `POST /v1/yarn-management/yarn-receiving/process-step-by-step`
2. `POST /v1/yarn-management/yarn-receiving/step/:stepNumber`

## File Changes Required

1. **src/services/yarnManagement/yarnReceivingPipeline.service.js**
   - Refactor `runReceivingPipelineForPo` to support step-by-step
   - Add new step functions
   - Add auto-approval logic
   - Add data matching function

2. **src/controllers/yarnManagement/yarnReceiving.controller.js**
   - Add step-by-step controller functions
   - Add auto-approval controller logic

3. **src/validations/yarnReceiving.validation.js**
   - Add step-by-step validation schemas

4. **src/routes/v1/yarn/yarnReceiving.route.js**
   - Add new routes for step-by-step processing

## Testing Checklist

- [ ] Step 1: Update PO to in_transit with packing details
- [ ] Step 2: Add lot details to packing list
- [ ] Step 3: Generate barcodes (create boxes)
- [ ] Step 4: Update box details
- [ ] Step 5: Send for QC
- [ ] Step 6: Get box by barcode
- [ ] Step 7: Approve QC
- [ ] Auto-approval when data matches
- [ ] Error handling for incomplete steps
- [ ] Backward compatibility with existing `/process` endpoint

## Notes

- All existing APIs are already implemented, just need to wire them together
- The main work is refactoring the pipeline service to support step-by-step processing
- Auto-approval should only happen when processing Excel data that matches expected values
- UI will call each step sequentially, allowing user to review data between steps
