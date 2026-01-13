# M2 Repair Transfer Feature Documentation

## Overview

This feature allows transferring M2 (repairable) quantities from checking floors (Checking, Secondary Checking, Final Checking) back to **any previous floor** in the process flow for repair. Users can select which floor to send repair items to, or it defaults to the immediate previous floor. After repair, these items will follow the same process flow again from that floor.

## Backend Changes

### 1. Article Model (`src/models/production/article.model.js`)

#### Added Fields to Checking Floors
- **`m2Quantity`**: Current remaining M2 items available for repair. **This is reduced when items are sent for repair.**
- **`m2Transferred`**: Tracks total M2 items that have been sent for repair (additive counter for audit trail)
- **`m2Remaining`**: Calculated field showing remaining M2 items available for repair (equals `m2Quantity` after transfer)

**Important:** When M2 items are sent for repair:
- `m2Quantity` is **reduced** by the transfer quantity (items are removed)
- `m2Transferred` is **increased** by the transfer quantity (for audit trail)
- `m2Remaining` = `m2Quantity` (since m2Quantity is already reduced)

These fields are added to:
- `floorQuantities.checking`
- `floorQuantities.secondaryChecking`
- `floorQuantities.finalChecking`

#### Added Fields to All Floors (for Repair Item Tracking)
- **`repairReceived`**: Tracks how many items were received as repairs from checking floors. This allows distinguishing between regular production items and repair items.

These fields are added to:
- `floorQuantities.linking`
- `floorQuantities.washing`
- `floorQuantities.boarding`
- `floorQuantities.silicon`
- `floorQuantities.branding`
- `floorQuantities.warehouse`
- `floorQuantities.dispatch`

**Example:**
```javascript
// Linking floor data
linking: {
  received: 25,        // Total received (regular + repair)
  repairReceived: 10,  // Items received from repair transfer
  // Regular items = received - repairReceived = 25 - 10 = 15
}
```

#### New Method: `transferM2ForRepair()`
```javascript
article.transferM2ForRepair(checkingFloor, quantity, userId, floorSupervisorId, remarks, targetFloor)
```

**Parameters:**
- `checkingFloor`: The checking floor from which to transfer (Checking, Secondary Checking, or Final Checking)
- `quantity`: Number of M2 items to transfer for repair (optional, defaults to all remaining)
- `userId`: User ID performing the transfer
- `floorSupervisorId`: Floor supervisor ID
- `remarks`: Optional remarks for the repair transfer
- `targetFloor`: **Optional** - Target floor to send repair items to. If not provided, defaults to immediate previous floor. Must be a floor that comes before the checking floor in the process flow.

**What it does:**
1. Validates that the floor is a checking floor
2. Validates that M2 quantity is available
3. Determines target floor (user-selected or immediate previous floor)
4. Validates that target floor is before checking floor in process flow
5. **Reduces `m2Quantity`** on checking floor (items sent for repair are removed from m2Quantity)
6. **Increases `m2Transferred`** for audit trail (tracks total sent for repair)
7. Updates `m2Remaining` (equals m2Quantity after reduction)
8. Adds received quantity to target floor (repair items will go through flow again)
9. Updates repair status
10. Creates log entry

**Returns:**
```javascript
{
  checkingFloor: 'Checking',
  targetFloor: 'Linking',  // or user-selected floor
  quantity: 10,
  m2Quantity: 0,  // ✅ Updated: reduced from 10 to 0 (items removed)
  m2Transferred: 10,  // Total sent for repair (audit trail)
  m2Remaining: 0,  // Equals m2Quantity
  targetFloorReceived: 120,        // Total received on target floor
  targetFloorRepairReceived: 10,    // Repair items received on target floor
  message: '10 repairable items transferred from Checking to Linking for repair. M2 quantity reduced from 10 to 0'
}
```

**Key Point:** `m2Quantity` is **reduced** when items are sent for repair. It represents the current remaining M2 items, not the original total found.

**Important:** 
- **All three checking floors work the same way**: Checking, Secondary Checking, and Final Checking all support M2 repair transfer with the same functionality
- Users can select **any floor that comes before the checking floor** in the process flow
- If `targetFloor` is not specified, it defaults to the immediate previous floor

**Available Target Floors by Checking Floor:**

1. **From Checking Floor:**
   - Can transfer to: **Linking** (default/immediate previous) or **Knitting**
   - Example flow: `Knitting → Linking → Checking → ...`
   - If items need major repair, can send back to Knitting
   - If items need minor repair, can send back to Linking

2. **From Secondary Checking Floor:**
   - Can transfer to: **Silicon** (default/immediate previous), **Boarding**, **Washing**, **Checking**, **Linking**, or **Knitting**
   - Example flow: `Knitting → Linking → Checking → Washing → Boarding → Silicon → Secondary Checking → ...`
   - Can skip multiple floors if needed (e.g., send directly to Washing or even Knitting)

3. **From Final Checking Floor:**
   - Can transfer to: **Branding** (default/immediate previous), **Secondary Checking**, **Silicon**, **Boarding**, **Washing**, **Checking**, **Linking**, or **Knitting**
   - Example flow: `Knitting → Linking → Checking → Washing → Boarding → Silicon → Secondary Checking → Branding → Final Checking → ...`
   - Maximum flexibility - can send back to any previous floor in the entire process flow

#### Pre-Save Hook Updates
- Automatically calculates `m2Remaining` on save
- Validates M2 data consistency
- Auto-fixes data inconsistencies

**Note:** `m2Quantity` is reduced when items are sent for repair, so `m2Transferred` may be greater than `m2Quantity` (this is expected - m2Transferred is cumulative, m2Quantity is current remaining).

### 2. Service Layer (`src/services/production/article.service.js`)

#### New Service Method: `transferM2ForRepair()`
```javascript
export const transferM2ForRepair = async (floor, orderId, articleId, repairData, user = null)
```

**API Endpoint:**
```
POST /api/v1/production/floors/:floor/repair/:orderId/articles/:articleId
```

**Request Body:**
```json
{
  "quantity": 10,  // Optional: defaults to all remaining M2
  "targetFloor": "Linking",  // Optional: defaults to immediate previous floor. Can be any floor before checking floor in process flow
  "remarks": "Items need repair on linking floor",
  "userId": "user_id_here",  // Optional if user is authenticated
  "floorSupervisorId": "supervisor_id_here"  // Optional if user is authenticated
}
```

**Response:**
```json
{
  "article": { /* article object */ },
  "repairTransferDetails": {
    "fromFloor": "Checking",
    "toFloor": "Linking",
    "quantity": 10,
    "m2Quantity": 0,
    "m2Transferred": 10,
    "m2Remaining": 0,
    "targetFloorReceived": 120,
    "targetFloorRepairReceived": 10,
    "message": "10 repairable items transferred from Checking to Linking for repair. M2 quantity reduced from 10 to 0",
    "timestamp": "2026-01-12T12:00:00.000Z"
  }
}
```

**Notes:**
- `m2Quantity`: Updated value (reduced when items are sent for repair)
- `m2Transferred`: Total sent for repair (audit trail, cumulative)
- `targetFloorRepairReceived`: Shows how many items on the target floor are from repair transfers
- Regular items = `targetFloorReceived - targetFloorRepairReceived`

### 3. Controller (`src/controllers/production.controller.js`)

#### New Controller Method
```javascript
export const transferM2ForRepair = catchAsync(async (req, res) => {
  const { floor, orderId, articleId } = req.params;
  const result = await productionService.transferM2ForRepair(floor, orderId, articleId, req.body, req.user);
  res.send(result);
});
```

### 4. Validation (`src/validations/production.validation.js`)

#### Validation Schema
```javascript
const transferM2ForRepair = {
  params: Joi.object().keys({
    floor: Joi.string().valid('Checking', 'Secondary Checking', 'Final Checking').required(),
    orderId: Joi.string().custom(objectId).required(),
    articleId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    quantity: Joi.number().integer().min(1).optional(),
    remarks: Joi.string().optional(),
    userId: Joi.string().custom(objectId).optional(),
    floorSupervisorId: Joi.string().custom(objectId).optional()
  }),
};
```

### 5. Routes (`src/routes/v1/production.route.js`)

#### New Route
```javascript
router
  .route('/floors/:floor/repair/:orderId/articles/:articleId')
  .post(validate(productionValidation.transferM2ForRepair), productionController.transferM2ForRepair);
```

## Frontend Implementation Guide

### 1. Checking Floors UI Components

#### Display M2 Information
**All three checking floors work identically**: Checking, Secondary Checking, and Final Checking all have the same M2 repair transfer functionality. On any of these floors, display:

```javascript
// Example data structure from article
const floorData = article.floorQuantities.checking; // or secondaryChecking, finalChecking

// Display fields:
- m2Quantity: Current remaining M2 (repairable) items (reduced when sent for repair)
- m2Transferred: Total sent for repair (audit trail, cumulative)
- m2Remaining: Available for repair (equals m2Quantity after transfer)

// For target floors (e.g., linking, washing, etc.):
const targetFloorData = article.floorQuantities.linking;

// Display fields:
- received: Total received (regular + repair items)
- repairReceived: Items received from repair transfers
- Regular items: received - repairReceived
```

#### UI Elements to Add

1. **M2 Status Card**
   ```
   ┌─────────────────────────────┐
   │ M2 Repairable Items         │
   ├─────────────────────────────┤
   │ Total M2: 15                │
   │ Sent for Repair: 5          │
   │ Available: 10               │
   └─────────────────────────────┘
   ```

2. **Transfer M2 for Repair Button**
   - Only show if `m2Remaining > 0`
   - Button text: "Send M2 for Repair"
   - Opens modal/dialog for quantity selection

3. **Repair Transfer Modal**
   ```
   ┌─────────────────────────────┐
   │ Send M2 for Repair          │
   ├─────────────────────────────┤
   │ Available: 10 items         │
   │                             │
   │ Quantity: [10] (max)        │
   │                             │
   │ Target Floor: [Dropdown ▼]  │
   │   - Linking (default)       │
   │   - Knitting                │
   │   - (other previous floors) │
   │                             │
   │ Remarks: [textarea]         │
   │                             │
   │ [Cancel] [Send for Repair]  │
   └─────────────────────────────┘
   ```
   
   **Note:** The dropdown should show all floors that come before the checking floor in the process flow:
   
   - **From Checking Floor**: Show options: Linking, Knitting
   - **From Secondary Checking Floor**: Show options: Silicon, Boarding, Washing, Checking, Linking, Knitting
   - **From Final Checking Floor**: Show options: Branding, Secondary Checking, Silicon, Boarding, Washing, Checking, Linking, Knitting
   
   The first option in the dropdown should be the default (immediate previous floor).

### 2. API Integration

#### Example API Call
```javascript
const transferM2ForRepair = async (floor, orderId, articleId, quantity, targetFloor, remarks) => {
  try {
    const response = await fetch(
      `/api/v1/production/floors/${floor}/repair/${orderId}/articles/${articleId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          quantity: quantity, // Optional, defaults to all remaining
          targetFloor: targetFloor, // Optional, defaults to immediate previous floor
          remarks: remarks || ''
        })
      }
    );
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to transfer M2 for repair');
    }
    
    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error transferring M2 for repair:', error);
    throw error;
  }
};
```

### 3. Displaying Repair Items on Target Floors

**Important:** The target floor depends on which checking floor you're transferring from:

- **From Checking Floor**: Repair items go to Linking or Knitting
- **From Secondary Checking Floor**: Repair items can go to Silicon, Boarding, Washing, Checking, Linking, or Knitting
- **From Final Checking Floor**: Repair items can go to Branding, Secondary Checking, Silicon, Boarding, Washing, Checking, Linking, or Knitting

#### Show Repair Items Indicator
When items are sent back for repair, the **target floor** (selected floor or default previous floor) should show:

1. **Received Quantity Breakdown**
   ```javascript
   const floorData = article.floorQuantities.linking;
   const totalReceived = floorData.received;        // 25
   const repairReceived = floorData.repairReceived || 0; // 10
   const regularReceived = totalReceived - repairReceived; // 15
   
   // Display:
   Received: 25 items
   ├─ Regular Items: 15 (from Knitting)
   └─ Repair Items: 10 (from Checking floor M2 transfer)
   ```

2. **Visual Indicator**
   - Badge or icon showing "Repair Items" count
   - Different color/styling for repair items
   - Tooltip should show source floor:
     - "Items sent back from Checking floor for repair"
     - "Items sent back from Secondary Checking floor for repair"
     - "Items sent back from Final Checking floor for repair"

3. **Repair Items Tracking**
   ```javascript
   // When displaying floor data, show:
   const floorData = article.floorQuantities.linking;
   
   // Total received includes both regular and repair items
   const totalReceived = floorData.received; // e.g., 25
   
   // Repair items are tracked separately
   const repairReceived = floorData.repairReceived || 0; // e.g., 10
   
   // Regular items = total received - repair items
   const regularReceived = totalReceived - repairReceived; // e.g., 15
   
   // Display breakdown:
   // Received: 25 items
   // ├─ Regular Items: 15 (from previous floor)
   // └─ Repair Items: 10 (from checking floor M2 transfer)
   ```
   
   **Important:** The `repairReceived` field is automatically tracked by the backend when M2 items are transferred. This allows you to distinguish between:
   - **Regular items**: Normal production flow items (`received - repairReceived`)
   - **Repair items**: Items sent back from checking floors for repair (`repairReceived`)

### 4. Flow Visualization

#### Example 1: From Checking Floor to Linking
**Before Repair Transfer:**
```
Knitting (100) → Linking (100) → Checking (100)
                                      │
                                      ├─ M1: 85 (good)
                                      ├─ M2: 10 (repairable) ← Can send for repair
                                      ├─ M3: 3 (minor defect)
                                      └─ M4: 2 (reject)
```

**After Repair Transfer (M2 sent to Linking):**
```
Knitting (100) → Linking (110) ← 10 repair items added
                │                │
                │                └─ Received: 100 (new) + 10 (repair)
                │
                └─→ Checking (100)
                         │
                         ├─ M1: 85
                         ├─ M2: 0 (all sent for repair)
                         ├─ M3: 3
                         └─ M4: 2
```

#### Example 2: From Secondary Checking Floor to Washing
**Before Repair Transfer:**
```
... → Washing (100) → Boarding (100) → Silicon (100) → Secondary Checking (100)
                                                              │
                                                              ├─ M2: 15 (repairable)
```

**After Repair Transfer (M2 sent to Washing):**
```
... → Washing (115) ← 15 repair items added
      │                │
      │                └─ Received: 100 (new) + 15 (repair)
      │
      └─→ Boarding (100) → Silicon (100) → Secondary Checking (100)
                                                      │
                                                      ├─ M2: 0 (all sent for repair)
```

#### Example 3: From Final Checking Floor to Knitting
**Before Repair Transfer:**
```
Knitting (100) → ... → Final Checking (100)
                                      │
                                      ├─ M2: 20 (repairable)
```

**After Repair Transfer (M2 sent to Knitting - skipping all floors):**
```
Knitting (120) ← 20 repair items added
      │            │
      │            └─ Received: 100 (new) + 20 (repair)
      │
      └─→ ... → Final Checking (100)
                          │
                          ├─ M2: 0 (all sent for repair)
```

### 5. Frontend Component Structure

#### Recommended Component Hierarchy
```
ArticleDetailPage
├── FloorProgressCard
│   ├── CheckingFloorCard
│   │   ├── QualityBreakdown
│   │   │   ├── M1Quantity
│   │   │   ├── M2Quantity (with repair button)
│   │   │   ├── M3Quantity
│   │   │   └── M4Quantity
│   │   └── RepairTransferButton (if m2Remaining > 0)
│   │       └── RepairTransferModal
│   └── PreviousFloorCard
│       └── ReceivedQuantityDisplay
│           ├── NewItemsCount
│           └── RepairItemsIndicator (if any)
```

### 6. State Management

#### Update Article State After Repair Transfer
```javascript
// After successful repair transfer
const handleRepairTransfer = async (floor, orderId, articleId, quantity, remarks) => {
  try {
    const result = await transferM2ForRepair(floor, orderId, articleId, quantity, remarks);
    
    // Update local state
    setArticle(prevArticle => {
      const updated = { ...prevArticle };
      const floorKey = getFloorKey(floor); // 'checking', 'secondaryChecking', 'finalChecking'
      
      // Update checking floor M2 tracking
      updated.floorQuantities[floorKey].m2Transferred += quantity;
      updated.floorQuantities[floorKey].m2Remaining -= quantity;
      
      // Update previous floor received
      const previousFloor = result.repairTransferDetails.toFloor;
      const previousFloorKey = getFloorKey(previousFloor);
      updated.floorQuantities[previousFloorKey].received += quantity;
      updated.floorQuantities[previousFloorKey].remaining += quantity;
      
      return updated;
    });
    
    // Show success message
    showNotification('M2 items sent for repair successfully', 'success');
    
    // Refresh article data
    await fetchArticle(articleId);
  } catch (error) {
    showNotification(error.message, 'error');
  }
};
```

### 7. Error Handling

#### Common Error Scenarios

1. **No M2 Available**
   ```javascript
   Error: "No M2 quantity available for repair transfer on Checking floor. M2: 0, M2 Transferred: 0"
   ```
   **UI Response:** Disable repair button, show message "No repairable items available"

2. **Invalid Floor**
   ```javascript
   Error: "M2 repair transfer can only be done from checking floors"
   ```
   **UI Response:** Don't show repair button on non-checking floors

3. **Quantity Exceeds Available**
   ```javascript
   Error: "Repair transfer quantity (15) must be between 1 and 10"
   ```
   **UI Response:** Show validation error in modal, limit input to max available

4. **First Floor in Flow**
   ```javascript
   Error: "Cannot transfer M2 for repair from Checking - it is the first floor in the process flow"
   ```
   **UI Response:** Show message "No previous floor available for repair"

### 8. Logging and Audit Trail

#### Display Repair Transfer History
```javascript
// Fetch article logs filtered by repair transfers
const repairLogs = articleLogs.filter(log => 
  log.action.includes('M2 Repair Transfer') || 
  log.remarks.includes('repair transfer')
);

// Display in timeline:
// - Date/Time
// - From Floor → To Floor
// - Quantity
// - Remarks
// - User who performed transfer
```

## Data Flow Example

### Scenario: Article A584 on Checking Floor

**Initial State:**
```json
{
  "articleNumber": "A584",
  "floorQuantities": {
    "linking": {
      "received": 100,
      "completed": 100,
      "transferred": 100,
      "repairReceived": 0
    },
    "checking": {
      "received": 100,
      "completed": 100,
      "transferred": 85,
      "m1Quantity": 85,
      "m2Quantity": 10,        // Current remaining M2
      "m3Quantity": 3,
      "m4Quantity": 2,
      "m1Transferred": 85,
      "m1Remaining": 0,
      "m2Transferred": 0,       // Total sent for repair (audit trail)
      "m2Remaining": 10
    }
  }
}
```

**After Transferring 10 M2 for Repair:**
```json
{
  "floorQuantities": {
    "linking": {
      "received": 110,        // Total: 100 regular + 10 repair
      "repairReceived": 10,   // Track repair items separately
      "completed": 100,
      "transferred": 100,
      "remaining": 10         // 10 repair items to process
      // Regular items = 110 - 10 = 100
    },
    "checking": {
      "received": 100,
      "completed": 100,
      "transferred": 85,
      "m1Quantity": 85,
      "m2Quantity": 0,        // ✅ REDUCED from 10 to 0 (items removed)
      "m3Quantity": 3,
      "m4Quantity": 2,
      "m1Transferred": 85,
      "m1Remaining": 0,
      "m2Transferred": 10,    // ✅ INCREASED (audit trail: total sent)
      "m2Remaining": 0        // ✅ Updated (equals m2Quantity)
    }
  }
}
```

**Key Changes:**
- `m2Quantity`: **Reduced from 10 to 0** (items sent for repair are removed)
- `m2Transferred`: **Increased from 0 to 10** (tracks total sent for audit trail)
- `m2Remaining`: **Updated to 0** (equals m2Quantity)

**Key Points:**
- `received` = Total items (regular + repair)
- `repairReceived` = Items from repair transfers
- Regular items = `received - repairReceived`
- This allows frontend to display breakdown clearly

**After Linking Completes Repair Items:**
```json
{
  "floorQuantities": {
    "linking": {
      "received": 110,
      "completed": 110,  // Includes 10 repair items
      "transferred": 110,
      "remaining": 0
    },
    "checking": {
      "received": 110,   // Receives repaired items
      "completed": 0,
      "transferred": 85,
      "m1Quantity": 85,
      "m2Quantity": 10,
      "m3Quantity": 3,
      "m4Quantity": 2,
      "m2Transferred": 10,
      "m2Remaining": 0
    }
  }
}
```

## Testing Checklist

### Backend Testing
- [ ] Transfer M2 from Checking floor (all three floors work the same way)
- [ ] Transfer M2 from Secondary Checking floor
- [ ] Transfer M2 from Final Checking floor
- [ ] Test selecting different target floors from each checking floor
- [ ] Test default behavior (immediate previous floor) for all three
- [ ] Validate quantity limits
- [ ] Validate floor restrictions
- [ ] Test with first floor in flow (should fail)
- [ ] Test log creation
- [ ] Test m2Remaining calculation
- [ ] Test pre-save hook validation

### Frontend Testing
- [ ] Display M2 quantities correctly
- [ ] Show/hide repair button based on m2Remaining
- [ ] Repair transfer modal functionality
- [ ] Quantity input validation
- [ ] Previous floor display update
- [ ] Error handling and messages
- [ ] Success notifications
- [ ] State updates after transfer
- [ ] Log display for repair transfers

## API Examples

### Example 1: Transfer from Checking Floor (Default - to Linking)
```bash
curl -X POST \
  http://localhost:8000/api/v1/production/floors/Checking/repair/ORDER_ID/articles/ARTICLE_ID \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer TOKEN' \
  -d '{
    "remarks": "Items need repair on linking floor"
  }'
```
**Result:** Transfers to Linking (immediate previous floor)

### Example 2: Transfer from Checking Floor to Knitting
```bash
curl -X POST \
  http://localhost:8000/api/v1/production/floors/Checking/repair/ORDER_ID/articles/ARTICLE_ID \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer TOKEN' \
  -d '{
    "quantity": 5,
    "targetFloor": "Knitting",
    "remarks": "Major repair needed, sending back to knitting"
  }'
```
**Result:** Transfers from Checking → Knitting (skipping Linking)

### Example 3: Transfer from Secondary Checking Floor (Default - to Silicon)
```bash
curl -X POST \
  http://localhost:8000/api/v1/production/floors/Secondary\ Checking/repair/ORDER_ID/articles/ARTICLE_ID \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer TOKEN' \
  -d '{
    "remarks": "Items need repair on silicon floor"
  }'
```
**Result:** Transfers to Silicon (immediate previous floor)

### Example 4: Transfer from Secondary Checking to Washing
```bash
curl -X POST \
  http://localhost:8000/api/v1/production/floors/Secondary\ Checking/repair/ORDER_ID/articles/ARTICLE_ID \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer TOKEN' \
  -d '{
    "quantity": 8,
    "targetFloor": "Washing",
    "remarks": "Items need repair on washing floor"
  }'
```
**Result:** Transfers from Secondary Checking → Washing (skipping Silicon and Boarding)

### Example 5: Transfer from Secondary Checking to Knitting
```bash
curl -X POST \
  http://localhost:8000/api/v1/production/floors/Secondary\ Checking/repair/ORDER_ID/articles/ARTICLE_ID \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer TOKEN' \
  -d '{
    "quantity": 10,
    "targetFloor": "Knitting",
    "remarks": "Major repair needed, sending back to knitting"
  }'
```
**Result:** Transfers from Secondary Checking → Knitting (skipping multiple floors)

### Example 6: Transfer from Final Checking Floor (Default - to Branding)
```bash
curl -X POST \
  http://localhost:8000/api/v1/production/floors/Final\ Checking/repair/ORDER_ID/articles/ARTICLE_ID \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer TOKEN' \
  -d '{
    "remarks": "Items need repair on branding floor"
  }'
```
**Result:** Transfers to Branding (immediate previous floor)

### Example 7: Transfer from Final Checking to Boarding
```bash
curl -X POST \
  http://localhost:8000/api/v1/production/floors/Final\ Checking/repair/ORDER_ID/articles/ARTICLE_ID \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer TOKEN' \
  -d '{
    "quantity": 5,
    "targetFloor": "Boarding",
    "remarks": "Items need repair on boarding floor"
  }'
```
**Result:** Transfers from Final Checking → Boarding (skipping Branding, Secondary Checking, Silicon)

### Example 8: Transfer from Final Checking to Knitting (skip multiple floors)
```bash
curl -X POST \
  http://localhost:8000/api/v1/production/floors/Final\ Checking/repair/ORDER_ID/articles/ARTICLE_ID \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer TOKEN' \
  -d '{
    "quantity": 10,
    "targetFloor": "Knitting",
    "remarks": "Major repair needed, sending back to knitting"
  }'
```
**Result:** Transfers from Final Checking → Knitting (skipping all intermediate floors)

## Summary

### Backend Changes Summary
1. ✅ Added `m2Transferred` and `m2Remaining` fields to checking floors
2. ✅ Added `repairReceived` field to all floors that can receive repair items (linking, washing, boarding, silicon, branding, warehouse, dispatch)
3. ✅ Created `transferM2ForRepair()` method in article model
4. ✅ Added service method `transferM2ForRepair()`
5. ✅ Added controller endpoint
6. ✅ Added validation schema
7. ✅ Added route: `POST /floors/:floor/repair/:orderId/articles/:articleId`
8. ✅ Updated pre-save hook for m2Remaining calculation
9. ✅ Automatic tracking of `repairReceived` when M2 items are transferred

### Frontend Requirements Summary
1. Display M2 quantities (total, transferred, remaining) on checking floors
2. Show "Send M2 for Repair" button when m2Remaining > 0
3. Create modal for repair transfer with quantity input
4. Show previous floor where items will be sent
5. Display repair items indicator on previous floor
6. Update UI state after successful transfer
7. Show repair transfer history in logs
8. Handle errors gracefully

### Key Points
- **All three checking floors work identically**: Checking, Secondary Checking, and Final Checking all support M2 repair transfer with the same functionality
- M2 items are sent **back** to a **user-selected previous floor** (or immediate previous if not specified) in the process flow
- Users can select **any floor that comes before the checking floor** in the process flow
- After repair, items follow the **same process flow again** from that floor
- **M2 Quantity is Reduced**: When M2 items are sent for repair, `m2Quantity` is **reduced** (items are removed), not just tracked
- **M2 Transferred is Audit Trail**: `m2Transferred` tracks total sent for repair (cumulative, for audit purposes)
- **Repair items are tracked separately**: The `repairReceived` field on target floors tracks how many items came from repair transfers
- **Regular vs Repair items**: 
  - `received` = Total items (regular + repair)
  - `repairReceived` = Items from repair transfers
  - Regular items = `received - repairReceived`
- `m2Remaining` = `m2Quantity` (since m2Quantity is already reduced when items are sent)
- Frontend can display breakdown: "Received: 25 (15 regular + 10 repair)"
- Frontend should show: "Current M2: 0 (10 sent for repair)" - showing current remaining and total sent
