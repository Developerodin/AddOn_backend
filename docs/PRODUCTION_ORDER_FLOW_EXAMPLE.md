# Production Order Flow: From Creation to Warehouse

This document explains the complete flow of a production order from creation to warehouse delivery, with detailed examples.

## Overview

The production system follows a multi-floor manufacturing process where articles move through different production stages. Each article tracks quantities, quality metrics, and floor-specific data.

## Production Floors Flow

**For Auto Linking (linkingType: "Auto Linking"):**
```
KNITTING → CHECKING → WASHING → BOARDING → FINAL_CHECKING → BRANDING → WAREHOUSE
```

**For Hand Linking (linkingType: "Hand Linking"):**
```
KNITTING → LINKING → CHECKING → WASHING → BOARDING → FINAL_CHECKING → BRANDING → WAREHOUSE
```

**For Rosso Linking (linkingType: "Rosso Linking"):**
```
KNITTING → LINKING → CHECKING → WASHING → BOARDING → FINAL_CHECKING → BRANDING → WAREHOUSE
```

## Example: Complete Order Flow

### 1. Order Creation

**Initial State:**
```javascript
// Create a new production order
const productionOrder = {
  priority: "HIGH",
  status: "PENDING",
  currentFloor: "KNITTING",
  orderNote: "Urgent customer order for winter collection",
  articles: []
}
```

**After Order Creation:**
```javascript
{
  _id: "507f1f77bcf86cd799439011",
  orderNumber: "ORD-000001", // Auto-generated
  priority: "HIGH",
  status: "PENDING",
  currentFloor: "KNITTING",
  orderNote: "Urgent customer order for winter collection",
  articles: [],
  createdAt: "2024-01-15T10:00:00Z",
  createdBy: "507f1f77bcf86cd799439012"
}
```

### 2. Adding Articles to Order

**Add Article 1 (Auto Linking):**
```javascript
// Article data with Auto Linking
const article1 = {
  id: "ART-1705312800000-abc123",
  articleNumber: "ART-001",
  plannedQuantity: 100,
  linkingType: "Auto Linking",    // Auto linking - skips linking floor
  priority: "HIGH",
  status: "PENDING",
  progress: 0,
  currentFloor: "KNITTING",
  floorQuantities: {
    knitting: {
      received: 100,    // Initial planned quantity
      completed: 0,
      remaining: 100,
      transferred: 0,
      m4Quantity: 0     // Defect tracking for knitting
    },
    linking: { received: 0, completed: 0, remaining: 0, transferred: 0 }, // Not used for Auto Linking
    checking: { received: 0, completed: 0, remaining: 0, transferred: 0, m1Quantity: 0, m2Quantity: 0, m3Quantity: 0, m4Quantity: 0 },
    washing: { received: 0, completed: 0, remaining: 0, transferred: 0 },
    boarding: { received: 0, completed: 0, remaining: 0, transferred: 0 },
    finalChecking: { received: 0, completed: 0, remaining: 0, transferred: 0, m1Quantity: 0, m2Quantity: 0, m3Quantity: 0, m4Quantity: 0 },
    branding: { received: 0, completed: 0, remaining: 0, transferred: 0 },
    warehouse: { received: 0, completed: 0, remaining: 0, transferred: 0 }
  }
}
```

### 3. KNITTING Floor Operations

**Step 3.1: Update Completed Quantity (Overproduction Scenario)**
```javascript
// Machine produces 110 units (overproduction - 10 more than planned)
await article1.updateCompletedQuantity(110, userId, floorSupervisorId, "Machine production completed with overproduction", machineId, shiftId);

// Result:
floorQuantities.knitting = {
  received: 100,      // Planned quantity
  completed: 110,      // Actual production (overproduction)
  remaining: -10,      // Negative remaining indicates overproduction
  transferred: 0,
  m4Quantity: 0
}
```

**Step 3.2: Update M4 Defect Quantity**
```javascript
// Track 8 defective pieces from overproduction
await article1.updateKnittingM4Quantity(8, userId, floorSupervisorId, "8 pieces with major defects from overproduction", machineId, shiftId);

// Result:
floorQuantities.knitting = {
  received: 100,
  completed: 110,
  remaining: -10,      // Overproduction
  transferred: 0,
  m4Quantity: 8       // Defects tracked
}
```

**Step 3.3: Transfer to Next Floor (Auto Linking)**
```javascript
// For Auto Linking: Transfer 102 good pieces directly to CHECKING (skips linking floor)
// Transfer 102 good pieces to checking (110 completed - 8 defects = 102 good pieces)
await article1.transferToNextFloor(102, userId, floorSupervisorId, "Transferring good quality pieces from overproduction to checking", batchNumber);

// Result:
floorQuantities.knitting = {
  received: 100,
  completed: 110,
  remaining: -10,      // Overproduction remains
  transferred: 102,    // 102 pieces transferred (more than planned)
  m4Quantity: 8
}

floorQuantities.linking = {
  received: 0,        // Skipped for Auto Linking
  completed: 0,
  remaining: 0,
  transferred: 0
}

floorQuantities.checking = {
  received: 102,      // Received directly from knitting (overproduction quantity)
  completed: 0,
  remaining: 102,     // Higher quantity than originally planned
  transferred: 0,
  m1Quantity: 0,     // Quality categories initialized
  m2Quantity: 0,
  m3Quantity: 0,
  m4Quantity: 0
}

// Article moves directly to checking floor (skips linking)
article1.currentFloor = "CHECKING"
```

### 4. CHECKING Floor Operations (Direct from Knitting for Auto Linking)

**Step 4.1: Quality Inspection and Categorization**
```javascript
// Quality inspection results (higher quantity due to overproduction from knitting)
const qualityData = {
  inspectedQuantity: 102,  // Total pieces inspected from knitting overproduction
  m1Quantity: 92,    // Good quality (higher due to overproduction)
  m2Quantity: 6,     // Needs repair
  m3Quantity: 3,     // Minor defects
  m4Quantity: 1      // Major defects
};

await article1.updateQualityInspection(qualityData, userId, floorSupervisorId, "Quality inspection completed", machineId, shiftId);

// Result:
floorQuantities.checking = {
  received: 102,     // Received directly from knitting overproduction
  completed: 0,      // No pieces completed yet (only M1 can be completed)
  remaining: 102,    // All pieces need processing
  transferred: 0,
  m1Quantity: 92,    // Good quality (higher than originally planned)
  m2Quantity: 6,     // Needs repair
  m3Quantity: 3,     // Minor defects
  m4Quantity: 1      // Major defects
}
```

**Step 4B: Article-wise Checked Quantities (M1–M4) and M2 Repair Review**

- M1 – Good Quality (Green): Pass all checks; eligible to complete and transfer to WASHING.
- M2 – Needs Repair (Yellow): Requires supervisor review before outcome is decided.
- M3 – Minor Defects (Orange): Recorded as minor issues; do not move forward.
- M4 – Major Defects (Red): Significant issues; hold or reject; do not move forward.

M2 Repair Review (supervisor-driven):
- Repair Status options: Not Required, In Review, Repaired, Rejected.
- M2 item shifting allowed:
  - M2 → M1 (repaired to good)
  - M2 → M3 (still minor defects)
  - M2 → M4 (major defects)
- UI action: shift in steps of 10 items per click.

Note: Only M1 pieces are considered “completed” and are eligible to transfer. M3/M4 remain at CHECKING and are recorded.

**Step 4.2: Repair M2 Items**
```javascript
// Repair process: 4 M2 items become M1, 2 become M3
const shiftData = {
  fromM2: 6,
  toM1: 4,           // Successfully repaired
  toM3: 2,           // Still have minor defects
  toM4: 0
};

await article1.shiftM2Items(shiftData, userId, floorSupervisorId);

// Result:
floorQuantities.checking = {
  received: 102,
  completed: 0,      // Still no completed pieces (only M1 can be completed)
  remaining: 102,    // All pieces still need processing
  transferred: 0,
  m1Quantity: 96,    // 92 + 4 repaired (ready for completion)
  m2Quantity: 0,     // All M2 items processed
  m3Quantity: 5,     // 3 + 2 from repair
  m4Quantity: 1      // Major defects remain
}
```

**Step 4.3: Complete M1 Pieces (Good Quality Only)**
```javascript
// Complete only M1 pieces (good quality) - these are the only pieces that can be completed
await article1.updateCompletedQuantity(96, userId, floorSupervisorId, "M1 pieces completed for transfer", machineId, shiftId);

// Result:
floorQuantities.checking = {
  received: 102,
  completed: 96,      // Only M1 pieces completed (good quality)
  remaining: 6,       // M3 + M4 remain (5 + 1) - these cannot be completed
  transferred: 0,
  m1Quantity: 96,
  m2Quantity: 0,
  m3Quantity: 5,
  m4Quantity: 1
}
```

**Step 4.4: Confirm Final Quality**
```javascript
// Confirm quality before transfer
await article1.confirmFinalQuality(true, userId, floorSupervisorId, "Quality confirmed for transfer");

// Result:
article1.finalQualityConfirmed = true
```

**Step 4.5: Transfer to Washing**
```javascript
// Transfer all completed pieces (M1 only - 96 pieces)
await article1.transferToNextFloor(96, userId, floorSupervisorId, "Transferring good quality pieces", batchNumber);

// Result:
floorQuantities.checking = {
  received: 102,
  completed: 96,      // Only M1 pieces completed
  remaining: 6,       // M3 + M4 remain (5 + 1) - defects stay at checking floor
  transferred: 96,    // M1 pieces transferred (higher than originally planned)
  m1Quantity: 96,
  m2Quantity: 0,
  m3Quantity: 5,
  m4Quantity: 1
}

floorQuantities.washing = {
  received: 96,       // Received good quality pieces (overproduction benefit)
  completed: 0,
  remaining: 96,
  transferred: 0
}

article1.currentFloor = "WASHING"
```

### 5. WASHING Floor Operations

**Step 5.1: Complete Washing Process**
```javascript
// Washing completes all pieces (higher quantity from overproduction)
await article1.updateCompletedQuantity(96, userId, floorSupervisorId, "Washing process completed", machineId, shiftId);

// Transfer to boarding
await article1.transferToNextFloor(96, userId, floorSupervisorId, "Transferring to boarding", batchNumber);

article1.currentFloor = "BOARDING"
```

### 6. BOARDING Floor Operations

**Step 6.1: Complete Boarding Process**
```javascript
// Boarding completes all pieces (higher quantity from overproduction)
await article1.updateCompletedQuantity(96, userId, floorSupervisorId, "Boarding process completed", machineId, shiftId);

// Transfer to final checking
await article1.transferToNextFloor(96, userId, floorSupervisorId, "Transferring to final quality check", batchNumber);

article1.currentFloor = "FINAL_CHECKING"
```

### 7. FINAL_CHECKING Floor Operations

**Step 7.1: Final Quality Inspection and Categorization**
```javascript
// Final quality check (higher quantity from overproduction)
const finalQualityData = {
  inspectedQuantity: 96,  // Total pieces inspected
  m1Quantity: 92,    // Final good quality (higher than originally planned)
  m2Quantity: 0,     // No repairs needed
  m3Quantity: 3,     // Minor defects
  m4Quantity: 1      // Major defects
};

await article1.updateQualityInspection(finalQualityData, userId, floorSupervisorId, "Final quality inspection", machineId, shiftId);

// Result:
floorQuantities.finalChecking = {
  received: 96,       // Received from boarding
  completed: 0,        // No pieces completed yet (only M1 can be completed)
  remaining: 96,      // All pieces need processing
  transferred: 0,
  m1Quantity: 92,      // Good quality (higher than originally planned)
  m2Quantity: 0,       // No repairs needed
  m3Quantity: 3,       // Minor defects
  m4Quantity: 1        // Major defects
}
```

**Step 7B: Article-wise Checked Quantities (M1–M4) and M2 Repair Review (Final Checking)**

- Same M1–M4 categories and meanings as CHECKING.
- If any M2 exist, supervisor applies the same Repair Review statuses and may shift M2 → M1/M3/M4 (10 items per click UI).
- Only M1 are completed and moved to BRANDING. M3/M4 remain recorded at FINAL_CHECKING.

**Step 7.2: Complete M1 Pieces (Good Quality Only)**
```javascript
// Complete only M1 pieces (good quality) - these are the only pieces that can be completed
await article1.updateCompletedQuantity(92, userId, floorSupervisorId, "M1 pieces completed for final transfer", machineId, shiftId);

// Result:
floorQuantities.finalChecking = {
  received: 96,
  completed: 92,      // Only M1 pieces completed (good quality)
  remaining: 4,       // M3 + M4 remain (3 + 1) - these cannot be completed
  transferred: 0,
  m1Quantity: 92,
  m2Quantity: 0,
  m3Quantity: 3,
  m4Quantity: 1
}
```

**Step 7.3: Confirm Final Quality**
```javascript
// Confirm final quality before transfer
await article1.confirmFinalQuality(true, userId, floorSupervisorId, "Final quality confirmed");

// Result:
article1.finalQualityConfirmed = true
```

**Step 7.4: Transfer to Branding**
```javascript
// Transfer all completed pieces (M1 only - 92 pieces)
await article1.transferToNextFloor(92, userId, floorSupervisorId, "Transferring to branding", batchNumber);

// Result:
floorQuantities.finalChecking = {
  received: 96,
  completed: 92,      // Only M1 pieces completed
  remaining: 4,       // M3 + M4 remain (3 + 1) - defects stay at final checking floor
  transferred: 92,    // M1 pieces transferred (higher than originally planned)
  m1Quantity: 92,
  m2Quantity: 0,
  m3Quantity: 3,
  m4Quantity: 1
}

floorQuantities.branding = {
  received: 92,       // Received good quality pieces (overproduction benefit)
  completed: 0,
  remaining: 92,
  transferred: 0
}

article1.currentFloor = "BRANDING"
```

### 8. BRANDING Floor Operations

**Step 8.1: Complete Branding**
```javascript
// Branding completes all pieces (higher quantity from overproduction)
await article1.updateCompletedQuantity(92, userId, floorSupervisorId, "Branding completed", machineId, shiftId);

// Transfer to warehouse
await article1.transferToNextFloor(92, userId, floorSupervisorId, "Transferring to warehouse", batchNumber);

article1.currentFloor = "WAREHOUSE"
```

### 9. WAREHOUSE Floor Operations

**Step 9.1: Complete Warehouse Process**
```javascript
// Warehouse receives and completes (higher quantity from overproduction)
await article1.updateCompletedQuantity(92, userId, floorSupervisorId, "Warehouse delivery completed", machineId, shiftId);

// Mark article as completed
article1.status = "COMPLETED"
article1.completedAt = new Date()
```

## Final State Summary

### Article Final State (Auto Linking + Overproduction Scenario):
```javascript
{
  id: "ART-1705312800000-abc123",
  articleNumber: "ART-001",
  plannedQuantity: 100,
  linkingType: "Auto Linking",    // Auto linking - skips linking floor
  status: "COMPLETED",
  progress: 100,
  currentFloor: "WAREHOUSE",
  finalQualityConfirmed: true,
  floorQuantities: {
    knitting: {
      received: 100,      // Planned quantity
      completed: 110,     // Overproduction (+10)
      remaining: -10,     // Negative indicates overproduction
      transferred: 102,   // Good pieces transferred directly to checking
      m4Quantity: 8      // Defects from overproduction
    },
    linking: {
      received: 0,        // Skipped for AUTO linking
      completed: 0,
      remaining: 0,
      transferred: 0
    },
    checking: {
      received: 102,     // Received directly from knitting overproduction
      completed: 96,     // Only M1 pieces completed (good quality)
      remaining: 6,      // M3 + M4 remain (defects stay at checking floor)
      transferred: 96,   // Higher than originally planned
      m1Quantity: 96,
      m2Quantity: 0,
      m3Quantity: 5,
      m4Quantity: 1
    },
    washing: {
      received: 96,       // Higher quantity from overproduction
      completed: 96,
      remaining: 0,
      transferred: 96
    },
    boarding: {
      received: 96,       // Higher quantity from overproduction
      completed: 96,
      remaining: 0,
      transferred: 96
    },
    finalChecking: {
      received: 96,       // Higher quantity from overproduction
      completed: 92,      // Only M1 pieces completed (good quality)
      remaining: 4,       // M3 + M4 remain (defects stay at final checking floor)
      transferred: 92,    // Higher than originally planned
      m1Quantity: 92,
      m2Quantity: 0,
      m3Quantity: 3,
      m4Quantity: 1
    },
    branding: {
      received: 92,       // Higher quantity from overproduction
      completed: 92,
      remaining: 0,
      transferred: 92
    },
    warehouse: {
      received: 92,       // Final delivered quantity (overproduction benefit)
      completed: 92,
      remaining: 0,
      transferred: 0
    }
  }
}
```

### Production Order Final State:
```javascript
{
  _id: "507f1f77bcf86cd799439011",
  orderNumber: "ORD-000001",
  priority: "HIGH",
  status: "COMPLETED",        // All articles completed
  currentFloor: "WAREHOUSE",  // Highest floor reached
  articles: ["507f1f77bcf86cd799439013"], // Article reference
  actualStartDate: "2024-01-15T10:00:00Z",
  actualEndDate: "2024-01-20T16:00:00Z"
}
```

## Key Metrics (Auto Linking + Overproduction Scenario)

- **Planned Quantity**: 100 pieces
- **Linking Type**: Auto Linking (skips linking floor)
- **Knitting Overproduction**: 110 pieces (+10% overproduction)
- **Final Delivered**: 92 pieces (92% yield from planned, 83.6% from overproduction)
- **Defects Tracked**: 18 pieces across all floors
- **Quality Breakdown**:
  - M1 (Good): 92 pieces (higher than originally planned)
  - M2 (Repaired): 0 pieces
  - M3 (Minor Defects): 3 pieces
  - M4 (Major Defects): 1 piece
- **Overproduction Benefit**: 8 extra pieces delivered due to knitting overproduction
- **Floor Efficiency**: Each floor tracked completion rates and quality metrics with overproduction handling
- **Auto Linking Benefit**: Faster processing by skipping linking floor

## Important Notes

1. **Linking Type Flow**: 
   - Auto Linking: KNITTING → CHECKING (skips linking floor)
   - Hand Linking: KNITTING → LINKING → CHECKING (goes through linking floor)
   - Rosso Linking: KNITTING → LINKING → CHECKING (goes through linking floor)
2. **Overproduction Handling**: Knitting floor can produce more than planned quantity, which flows through subsequent floors
3. **Defect Tracking**: M4 quantities are tracked at knitting floor for machine defects
4. **Quality Flow**: Quality categories (M1-M4) are tracked through checking and final checking floors
5. **Transfer Logic**: Only good quality pieces typically move forward, defects remain at respective floors
6. **Progress Calculation**: Overall progress is calculated based on completed quantities across all floors
7. **Order Status**: Order status is automatically updated based on article statuses
8. **Floor Progression**: Articles move through floors sequentially, with current floor tracking the highest reached floor
9. **Overproduction Benefits**: Extra production in knitting can result in higher final delivery quantities
10. **Negative Remaining**: Negative remaining values in knitting indicate overproduction scenarios
11. **Quantity Flow**: The completed quantity from knitting becomes the main quantity that flows through all subsequent floors
12. **Auto Linking Benefits**: Faster processing and reduced floor transitions for articles with Auto Linking type

This flow ensures complete traceability, quality control, overproduction handling, conditional floor routing, and efficient production management throughout the manufacturing process.

## Example: Same Article with Different Linking Types

### Scenario: Article A1234 with Different Linking Types

**Article A1234 with Auto Linking:**
```javascript
const articleAuto = {
  id: "ART-A1234-AUTO",
  articleNumber: "A1234",
  linkingType: "Auto Linking",
  // Flow: KNITTING → CHECKING → WASHING → BOARDING → FINAL_CHECKING → BRANDING → WAREHOUSE
  // Skips linking floor entirely
}
```

**Article A1234 with Hand Linking:**
```javascript
const articleHand = {
  id: "ART-A1234-HAND", 
  articleNumber: "A1234",
  linkingType: "Hand Linking",
  // Flow: KNITTING → LINKING → CHECKING → WASHING → BOARDING → FINAL_CHECKING → BRANDING → WAREHOUSE
  // Goes through linking floor for manual hand linking process
}
```

**Article A1234 with Rosso Linking:**
```javascript
const articleRosso = {
  id: "ART-A1234-ROSSO",
  articleNumber: "A1234", 
  linkingType: "Rosso Linking",
  // Flow: KNITTING → LINKING → CHECKING → WASHING → BOARDING → FINAL_CHECKING → BRANDING → WAREHOUSE
  // Goes through linking floor for Rosso machine linking process
}
```

### Key Points:
- **Same Article Number**: A1234 can exist with different linking types
- **Different Flows**: Each linking type follows its specific floor sequence
- **Dynamic Routing**: System automatically routes based on linkingType field
- **Independent Processing**: Each article processes independently through its designated flow
