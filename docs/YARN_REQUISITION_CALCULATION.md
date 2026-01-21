# Yarn Requisition Calculation Guide

## Overview

Yarn requisitions are automatically created/updated when inventory levels drop below minimum thresholds or when yarn is overbooked. They track the need to purchase more yarn.

## How Requisitions Are Calculated

### 1. **Automatic Creation/Update**

Requisitions are automatically created or updated when:
- Inventory status becomes `low_stock` (total net weight ≤ minQty)
- Inventory status becomes `soon_to_be_low` (total net weight ≤ minQty × 1.2)
- Yarn is overbooked (blocked weight > total available weight)
- A `yarn_blocked` transaction is created

### 2. **Calculation Formula**

```javascript
// From YarnInventory
totalNet = totalInventory.totalNetWeight  // Total net weight (LT + ST)
blockedNet = blockedNetWeight             // Blocked/reserved weight (≥ 0)
availableNet = max(totalNet - blockedNet, 0)  // Available for use

// From YarnCatalog
minQty = yarnCatalog.minQuantity          // Minimum required quantity

// Requisition Values
availableQty = availableNet                // Available quantity
blockedQty = blockedNet                   // Blocked quantity (never negative)
minQty = minQty                           // Minimum required quantity
```

### 3. **Alert Status Calculation**

```javascript
if (availableQty < minQty) {
  alertStatus = 'below_minimum'  // Need to order more yarn
}
else if (blockedQty > availableQty) {
  alertStatus = 'overbooked'    // More yarn blocked than available
}
else {
  alertStatus = null            // No alert needed
}
```

### 4. **When Requisitions Are Updated**

Requisitions are updated in real-time when:
- **Yarn is stocked** (yarn_stocked transaction)
- **Yarn is transferred** (internal_transfer transaction)
- **Yarn is blocked** (yarn_blocked transaction)
- **Yarn is issued** (yarn_issued transaction)
- **Yarn is returned** (yarn_returned transaction)

### 5. **API Behavior**

When you call `GET /v1/yarn-management/yarn-requisitions`:
1. Fetches all requisitions matching the date filter
2. **Recalculates each requisition** from current inventory data
3. Updates the requisition record in the database
4. Returns the updated values

This ensures requisitions always show **current, accurate data**.

## Example Calculation

### Scenario:
- **Total Net Weight**: 128 kg (from inventory)
- **Blocked Weight**: 0 kg
- **Minimum Quantity**: 100 kg

### Calculation:
```
availableQty = 128 - 0 = 128 kg
blockedQty = 0 kg
minQty = 100 kg

Since availableQty (128) > minQty (100):
  alertStatus = null (no alert)
```

### Scenario 2:
- **Total Net Weight**: 50 kg
- **Blocked Weight**: 0 kg
- **Minimum Quantity**: 100 kg

### Calculation:
```
availableQty = 50 - 0 = 50 kg
blockedQty = 0 kg
minQty = 100 kg

Since availableQty (50) < minQty (100):
  alertStatus = 'below_minimum'
```

### Scenario 3 (Overbooked):
- **Total Net Weight**: 100 kg
- **Blocked Weight**: 150 kg
- **Minimum Quantity**: 100 kg

### Calculation:
```
availableQty = max(100 - 150, 0) = 0 kg
blockedQty = 150 kg
minQty = 100 kg

Since blockedQty (150) > availableQty (0):
  alertStatus = 'overbooked'
```

## Data Flow

```
Yarn Transaction Created
    ↓
Update Inventory Buckets
    ↓
Calculate: totalNet, blockedNet, availableNet
    ↓
Check if requisition needed:
  - low_stock?
  - soon_to_be_low?
  - overbooked?
    ↓
Create/Update YarnRequisition
    ↓
Store: minQty, availableQty, blockedQty, alertStatus
```

## Key Points

1. **Requisitions are automatic** - No manual creation needed
2. **Real-time updates** - Recalculated on every transaction
3. **Always accurate** - API recalculates from current inventory
4. **Blocked quantity is never negative** - Enforced in code
5. **Only active requisitions** - Only created when thresholds are breached

## API Endpoints

### Get Requisition List
```
GET /v1/yarn-management/yarn-requisitions?startDate=...&endDate=...&poSent=false
```

**Response:**
```json
[
  {
    "_id": "...",
    "yarnName": "20s-Beige-BEIGE-Bamboo/Bamboo",
    "minQty": 100,
    "availableQty": 128,
    "blockedQty": 0,
    "alertStatus": null,
    "poSent": false
  }
]
```

### Update PO Sent Status
```
PATCH /v1/yarn-management/yarn-requisitions/:id/status
{
  "poSent": true
}
```

## Fixes Applied

1. **Fixed field name bug**: Changed `inventory.totalInventory.netWeight` → `inventory.totalInventory.totalNetWeight`
2. **Prevented negative blockedQty**: Added `Math.max(0, ...)` to ensure blockedQty is never negative
3. **Real-time recalculation**: Requisitions are recalculated from actual inventory on every API call
4. **Accurate calculations**: All values now come from current inventory state
