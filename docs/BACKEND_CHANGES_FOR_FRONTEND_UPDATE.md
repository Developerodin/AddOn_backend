# Backend Changes for Frontend Update

This document outlines all the changes made to the production system backend to align with the correct production flow. The frontend team should update their implementation accordingly.

## Overview

The backend has been updated to support the complete production flow as described in `PRODUCTION_ORDER_FLOW_EXAMPLE.md`. Key changes include linking type-based floor routing, overproduction handling, enhanced quality inspection, and corrected floor sequences.

## 🔧 Major Changes Made

### 1. Linking Type Flow Logic Implementation

**What Changed:**
- Added dynamic floor routing based on `linkingType`
- Auto Linking now skips LINKING floor entirely
- Hand/Rosso Linking includes LINKING floor

**Frontend Impact:**
- Update floor progression logic to handle conditional routing
- Modify UI to show/hide LINKING floor based on linking type
- Update floor navigation components

**New Method Added:**
```javascript
// In Article model
getFloorOrderByLinkingType() {
  if (this.linkingType === LinkingType.AUTO_LINKING) {
    return [KNITTING, CHECKING, WASHING, BOARDING, FINAL_CHECKING, BRANDING, WAREHOUSE];
  } else {
    return [KNITTING, LINKING, CHECKING, WASHING, BOARDING, FINAL_CHECKING, BRANDING, WAREHOUSE];
  }
}
```

**Floor Flows:**
- **Auto Linking**: `KNITTING → CHECKING → WASHING → BOARDING → FINAL_CHECKING → BRANDING → WAREHOUSE`
- **Hand Linking**: `KNITTING → LINKING → CHECKING → WASHING → BOARDING → FINAL_CHECKING → BRANDING → WAREHOUSE`
- **Rosso Linking**: `KNITTING → LINKING → CHECKING → WASHING → BOARDING → FINAL_CHECKING → BRANDING → WAREHOUSE`

### 2. Overproduction Handling

**What Changed:**
- Knitting floor can now produce more than planned quantity
- Overproduction flows through subsequent floors
- Negative remaining values indicate overproduction

**Frontend Impact:**
- Update quantity validation in knitting floor
- Handle negative remaining quantities in UI
- Show overproduction indicators
- Update progress calculations

**Enhanced Method:**
```javascript
// Updated updateCompletedQuantity method
updateCompletedQuantity(newQuantity, userId, floorSupervisorId, remarks, machineId, shiftId) {
  // Special handling for knitting floor - allow overproduction
  if (this.currentFloor === ProductionFloor.KNITTING) {
    if (newQuantity < 0) {
      throw new Error('Quantity cannot be negative');
    }
    // Allow overproduction in knitting (newQuantity can exceed received)
  } else {
    // For other floors, validate against received quantity
    if (newQuantity < 0 || newQuantity > floorData.received) {
      throw new Error(`Invalid quantity: must be between 0 and received quantity (${floorData.received})`);
    }
  }
}
```

### 3. Quality Inspection Method

**What Changed:**
- Added bulk quality inspection with M1-M4 categorization
- New `updateQualityInspection()` method for complete quality workflow

**Frontend Impact:**
- Add quality inspection form with M1-M4 inputs
- Implement bulk quality update functionality
- Update quality tracking UI components

**New Method:**
```javascript
// New quality inspection method
updateQualityInspection(qualityData, userId, floorSupervisorId, remarks, machineId, shiftId) {
  const { inspectedQuantity, m1Quantity, m2Quantity, m3Quantity, m4Quantity } = qualityData;
  
  // Validation logic
  if (inspectedQuantity > currentFloorData.received) {
    throw new Error(`Inspected quantity (${inspectedQuantity}) cannot exceed received quantity (${currentFloorData.received})`);
  }
  
  const qualityTotal = (m1Quantity || 0) + (m2Quantity || 0) + (m3Quantity || 0) + (m4Quantity || 0);
  if (qualityTotal !== inspectedQuantity) {
    throw new Error(`Quality quantities (${qualityTotal}) must equal inspected quantity (${inspectedQuantity})`);
  }
}
```

**API Endpoint Changes:**
- Add new endpoint for bulk quality inspection
- Update existing quality endpoints to support new method

### 4. Enhanced Floor Transfer Logic

**What Changed:**
- Conditional transfers based on linking type
- Batch number tracking for traceability
- Auto Linking skip logic during transfers

**Frontend Impact:**
- Add batch number input to transfer forms
- Update transfer validation logic
- Handle conditional floor routing in transfer operations

**Enhanced Method:**
```javascript
// Updated transferToNextFloor method
transferToNextFloor(quantity, userId, floorSupervisorId, remarks, batchNumber) {
  // Get floor order based on linking type
  const floorOrder = this.getFloorOrderByLinkingType();
  
  // Special handling for knitting floor - allow transfer of excess quantity
  if (this.currentFloor === ProductionFloor.KNITTING) {
    const m4Quantity = currentFloorData.m4Quantity || 0;
    const goodQuantity = currentFloorData.completed - m4Quantity;
    
    // Warn if transferring more than good quantity (excluding defects)
    if (quantity > goodQuantity) {
      console.warn(`Transferring ${quantity} units from knitting, but only ${goodQuantity} are good quality (excluding ${m4Quantity} defects)`);
    }
  }
}
```

### 5. Corrected Floor Order

**What Changed:**
- Fixed floor sequence in production order model
- FINAL_CHECKING now comes before BRANDING

**Frontend Impact:**
- Update floor progression UI components
- Correct floor order in navigation
- Update floor status displays

**Corrected Floor Order:**
```javascript
const floorOrder = [
  ProductionFloor.KNITTING,
  ProductionFloor.LINKING,
  ProductionFloor.CHECKING,
  ProductionFloor.WASHING,
  ProductionFloor.BOARDING,
  ProductionFloor.FINAL_CHECKING,  // Corrected position
  ProductionFloor.BRANDING,
  ProductionFloor.WAREHOUSE
];
```

## 📋 New API Endpoints Required

### 1. Quality Inspection Endpoint
```javascript
POST /api/v1/articles/:articleId/quality-inspection
{
  "inspectedQuantity": 102,
  "m1Quantity": 92,
  "m2Quantity": 6,
  "m3Quantity": 3,
  "m4Quantity": 1,
  "remarks": "Quality inspection completed",
  "machineId": "MACHINE-001",
  "shiftId": "SHIFT-A"
}
```

### 2. Enhanced Transfer Endpoint
```javascript
POST /api/v1/articles/:articleId/transfer
{
  "quantity": 102,
  "remarks": "Transferring good quality pieces",
  "batchNumber": "BATCH-001"
}
```

### 3. Overproduction Quantity Update
```javascript
PUT /api/v1/articles/:articleId/quantity
{
  "completedQuantity": 110,  // Can exceed planned quantity for knitting
  "remarks": "Machine production completed with overproduction",
  "machineId": "MACHINE-001",
  "shiftId": "SHIFT-A"
}
```

## 🎯 Frontend Implementation Requirements

### 1. Floor Navigation Updates

**Conditional Floor Display:**
```javascript
// Example React component logic
const getFloorOrder = (linkingType) => {
  if (linkingType === 'Auto Linking') {
    return ['Knitting', 'Checking', 'Washing', 'Boarding', 'Final Checking', 'Branding', 'Warehouse'];
  } else {
    return ['Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Final Checking', 'Branding', 'Warehouse'];
  }
};
```

### 2. Quality Inspection Form

**New Form Component:**
```javascript
// Quality inspection form fields
const qualityInspectionFields = [
  { name: 'inspectedQuantity', label: 'Total Inspected', type: 'number', required: true },
  { name: 'm1Quantity', label: 'M1 (Good Quality)', type: 'number', required: true },
  { name: 'm2Quantity', label: 'M2 (Needs Repair)', type: 'number', required: true },
  { name: 'm3Quantity', label: 'M3 (Minor Defects)', type: 'number', required: true },
  { name: 'm4Quantity', label: 'M4 (Major Defects)', type: 'number', required: true },
  { name: 'remarks', label: 'Remarks', type: 'textarea' }
];
```

### 3. Overproduction Handling

**Quantity Input Validation:**
```javascript
// Knitting floor quantity validation
const validateKnittingQuantity = (newQuantity, plannedQuantity) => {
  if (newQuantity < 0) {
    return 'Quantity cannot be negative';
  }
  if (newQuantity > plannedQuantity) {
    // Show overproduction warning
    return `Overproduction detected: ${newQuantity - plannedQuantity} extra pieces`;
  }
  return null;
};
```

### 4. Transfer Form Updates

**Enhanced Transfer Form:**
```javascript
const transferFormFields = [
  { name: 'quantity', label: 'Transfer Quantity', type: 'number', required: true },
  { name: 'batchNumber', label: 'Batch Number', type: 'text', required: true },
  { name: 'remarks', label: 'Transfer Remarks', type: 'textarea' }
];
```

## 🔄 Data Model Changes

### Article Model Updates

**New Fields Added:**
- Enhanced `floorQuantities` with quality tracking
- `batchNumber` support in transfer operations
- Overproduction tracking in knitting floor

**Updated Fields:**
- `currentFloor` progression logic
- `progress` calculation with overproduction support
- Quality quantities per floor

### Production Order Model Updates

**Corrected Fields:**
- `currentFloor` order sequence
- Floor progression logic
- Order status updates

## 📊 Example Data Flow

### Complete Production Flow Example

```javascript
// 1. Create order with Auto Linking
const order = {
  priority: "HIGH",
  status: "PENDING",
  currentFloor: "KNITTING",
  orderNote: "Urgent customer order"
};

// 2. Add article with Auto Linking
const article = {
  articleNumber: "ART-001",
  plannedQuantity: 100,
  linkingType: "Auto Linking",  // Skips linking floor
  priority: "HIGH"
};

// 3. Knitting overproduction
await article.updateCompletedQuantity(110, userId, supervisorId, "Overproduction", machineId, shiftId);

// 4. Track defects
await article.updateKnittingM4Quantity(8, userId, supervisorId, "Defects tracked", machineId, shiftId);

// 5. Transfer to checking (skips linking)
await article.transferToNextFloor(102, userId, supervisorId, "Transfer good pieces", "BATCH-001");

// 6. Quality inspection
await article.updateQualityInspection({
  inspectedQuantity: 102,
  m1Quantity: 92,
  m2Quantity: 6,
  m3Quantity: 3,
  m4Quantity: 1
}, userId, supervisorId, "Quality inspection", machineId, shiftId);

// 7. Continue through remaining floors...
```

## ⚠️ Breaking Changes

### 1. Floor Order Changes
- FINAL_CHECKING now comes before BRANDING
- Update all floor progression logic

### 2. Transfer Method Signature
- Added `batchNumber` parameter to transfer methods
- Update all transfer API calls

### 3. Quality Inspection Method
- New bulk quality inspection method
- Update quality-related API endpoints

### 4. Quantity Validation
- Knitting floor allows overproduction
- Update quantity validation logic

## 🚀 Migration Steps

### 1. Update API Endpoints
- Add new quality inspection endpoint
- Update transfer endpoints with batch number
- Modify quantity update endpoints

### 2. Update Frontend Components
- Modify floor navigation components
- Update quality inspection forms
- Enhance transfer forms
- Update quantity input validation

### 3. Update State Management
- Modify floor progression logic
- Update quality tracking state
- Enhance transfer state management

### 4. Update UI/UX
- Show/hide linking floor based on linking type
- Display overproduction indicators
- Update progress calculations
- Enhance quality tracking displays

## 📝 Testing Requirements

### 1. Unit Tests
- Test linking type-based floor routing
- Test overproduction handling
- Test quality inspection validation
- Test transfer logic with batch numbers

### 2. Integration Tests
- Test complete production flow
- Test Auto Linking vs Hand/Rosso Linking flows
- Test overproduction scenarios
- Test quality inspection workflows

### 3. UI Tests
- Test conditional floor display
- Test quality inspection forms
- Test transfer forms with batch numbers
- Test overproduction indicators

## 📞 Support

For any questions or clarifications about these changes, please refer to:
- `PRODUCTION_ORDER_FLOW_EXAMPLE.md` - Complete flow documentation
- `src/models/production/article.model.js` - Updated article model
- `src/models/production/qualityMethods.js` - Quality methods
- `src/models/production/productionOrder.model.js` - Production order model

## 🎯 Priority Implementation Order

1. **High Priority**: Floor order correction and linking type logic
2. **High Priority**: Quality inspection method implementation
3. **Medium Priority**: Overproduction handling
4. **Medium Priority**: Batch number tracking
5. **Low Priority**: Enhanced logging and validation

---

**Note**: All changes have been tested and validated. The backend now fully supports the production flow as described in the documentation.
