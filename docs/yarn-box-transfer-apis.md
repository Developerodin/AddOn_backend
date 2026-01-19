# Yarn Box Transfer APIs Documentation

This document describes the APIs for transferring boxes between storage locations and retrieving storage history.

## Overview

The system supports transferring yarn boxes between different storage locations:
- **LT→ST**: Long-term to Short-term (updates inventory, maintains logs)
- **LT→LT**: Long-term to Long-term (location change only, maintains complete logs)
- **ST→ST**: Short-term to Short-term (location change only, maintains complete logs)

**All transfer types maintain complete audit trail** including:
- Box IDs that were transferred
- From/to storage locations
- Transfer dates and times
- Weights and yarn information
- Transaction records for history tracking

---

## API Endpoints

### 1. Transfer Boxes (Unified)

Transfer boxes between any storage locations (LT→ST, LT→LT, ST→ST).

**Endpoint:** `POST /v1/yarn-management/yarn-boxes/transfer`

**Request Body:**
```json
{
  "boxIds": ["BOX-PO-2026-867-11121-1768030623043-2", "BOX-PO-2026-867-11105-1768029465221-1"],
  "toStorageLocation": "LT-S002-F1",
  "transferDate": "2026-01-15T10:00:00Z"
}
```

**Request Parameters:**
- `boxIds` (array, required): Array of box IDs to transfer
- `toStorageLocation` (string, required): Target storage location (must start with `LT-` or `ST-`)
- `transferDate` (string, optional): Transfer date in ISO format (defaults to current date)

**Response (200 OK):**
```json
{
  "message": "Successfully transferred 2 box(es) from long-term to long-term (LT-S002-F1)",
  "transferType": "LT_TO_LT",
  "boxesTransferred": 2,
  "results": [
    {
      "yarnName": "20s-Light Grey Melange-Lt. Grey Melange-Cotton/Combed Melange",
      "yarnId": "6926a7b5a5ccbd9b84f710e5",
      "boxIds": ["BOX-PO-2026-867-11121-1768030623043-2"],
      "boxesTransferred": 1,
      "totalWeight": 52.6,
      "totalNetWeight": 52.6,
      "totalCones": 24,
      "fromLocations": ["LT-S001-F1"],
      "toStorageLocation": "LT-S002-F1",
      "transactionId": "6962019f234429005b75417d"
    }
  ]
}
```

**Response Fields:**
- `message`: Human-readable success message
- `transferType`: Type of transfer (`LT_TO_ST`, `LT_TO_LT`, `ST_TO_ST`)
- `boxesTransferred`: Total number of boxes transferred
- `results`: Array of transfer results grouped by yarn

**What This API Does:**
1. Validates all boxes exist and are in valid storage locations
2. Validates boxes are stored and QC approved
3. Groups boxes by yarn (creates separate transactions per yarn)
4. Updates box `storageLocation` to target location
5. For **LT→ST**: Creates transaction via service (updates inventory buckets)
6. For **LT→LT** or **ST→ST**: Creates transaction record directly with **complete logs** (location change only, no inventory update)
   - Logs include: box IDs, from/to locations, weights, dates, yarn information
   - Full audit trail maintained for all transfer types
7. Returns transfer results with transaction IDs

**Error Responses:**
- `400 Bad Request`: Invalid box IDs, invalid storage location, boxes not ready
- `404 Not Found`: Boxes not found, yarn catalog not found

---

### 2. Transfer Boxes to Short-Term (Legacy)

Legacy endpoint for backward compatibility. Only supports LT→ST transfers.

**Endpoint:** `POST /v1/yarn-management/yarn-boxes/transfer-to-short-term`

**Request Body:**
```json
{
  "boxIds": ["BOX-PO-2026-867-11121-1768030623043-2"],
  "toStorageLocation": "ST-S001-F1",
  "transferDate": "2026-01-15T10:00:00Z"
}
```

**Request Parameters:**
- `boxIds` (array, required): Array of box IDs to transfer
- `toStorageLocation` (string, required): Target short-term storage location (must start with `ST-`)
- `transferDate` (string, optional): Transfer date in ISO format

**Response:** Same format as unified transfer API

**What This API Does:**
- Same as unified transfer API but validates `toStorageLocation` must be short-term
- Internally calls `transferBoxes()` function

---

### 3. Get Storage Location History

Retrieve current inventory and transfer history for a specific storage location.

**Endpoint:** `GET /v1/storage/slots/:storageLocation/history`

**URL Parameters:**
- `storageLocation` (string, required): Storage location barcode (e.g., `LT-S001-F1`)

**Response (200 OK):**
```json
{
  "storageLocation": "LT-S001-F1",
  "currentInventory": {
    "totalBoxes": 2,
    "totalWeight": 105.26,
    "yarns": [
      {
        "yarnName": "20s-Light Grey Melange-Lt. Grey Melange-Cotton/Combed Melange",
        "boxes": [
          {
            "boxId": "BOX-PO-2026-867-11121-1768030623043-2",
            "boxWeight": 52.6,
            "netWeight": 52.6,
            "numberOfCones": 24,
            "receivedDate": "2026-01-10T07:37:03.045Z"
          }
        ],
        "totalWeight": 52.6,
        "totalNetWeight": 52.6,
        "boxCount": 1
      }
    ]
  },
  "transferHistory": [
    {
      "transactionType": "internal_transfer",
      "transactionDate": "2026-01-15T10:00:00Z",
      "yarnName": "20s-Light Grey Melange-Lt. Grey Melange-Cotton/Combed Melange",
      "weight": 52.6,
      "boxIds": ["BOX-PO-2026-867-11121-1768030623043-2"],
      "fromLocation": "LT-S001-F1",
      "toLocation": "LT-S002-F1"
    },
    {
      "transactionType": "yarn_stocked",
      "transactionDate": "2026-01-10T07:37:03.045Z",
      "yarnName": "20s-Light Grey Melange-Lt. Grey Melange-Cotton/Combed Melange",
      "weight": 52.6,
      "boxIds": [],
      "fromLocation": null,
      "toLocation": null
    }
  ]
}
```

**Response Fields:**
- `storageLocation`: The queried storage location
- `currentInventory`: Current boxes and weights on this location
  - `totalBoxes`: Total number of boxes
  - `totalWeight`: Total weight in kg
  - `yarns`: Array of yarn summaries with box details
- `transferHistory`: Array of transfer transactions (last 50)
  - `transactionType`: Type of transaction (`internal_transfer`, `yarn_stocked`)
  - `transactionDate`: When the transfer occurred
  - `yarnName`: Yarn name
  - `weight`: Net weight transferred
  - `boxIds`: Array of box IDs involved
  - `fromLocation`: Source location (if transfer)
  - `toLocation`: Destination location (if transfer)

**What This API Does:**
1. Finds all boxes currently stored in the specified location
2. Groups boxes by yarn and calculates totals
3. Retrieves transfer history (transfers from/to this location)
4. Returns current inventory and complete transfer log

**Error Responses:**
- `400 Bad Request`: Missing storage location parameter

---

## Transfer Types Explained

### LT→ST Transfer (Long-term to Short-term)

**Behavior:**
- Updates inventory: Deducts from `longTermInventory`, adds to `shortTermInventory`
- Box location updated: `LT-S001-F1` → `ST-S001-F1`
- Creates `internal_transfer` transaction via service (triggers inventory update)
- Used when boxes are moved to short-term for yarn issuance

**Example:**
```
Before:
  - LT-S001-F1: 100kg (2 boxes)
  - Inventory: longTermInventory = 100kg, shortTermInventory = 0kg

Transfer: 1 box (50kg) from LT-S001-F1 → ST-S001-F1

After:
  - LT-S001-F1: 50kg (1 box)
  - ST-S001-F1: 50kg (1 box)
  - Inventory: longTermInventory = 50kg, shortTermInventory = 50kg
```

---

### LT→LT Transfer (Long-term to Long-term)

**Behavior:**
- No inventory change: Stays in `longTermInventory` (just different rack)
- Box location updated: `LT-S001-F1` → `LT-S002-F1`
- Creates transaction record directly (bypasses inventory update service)
- Used for reorganizing storage, moving boxes between racks

**Example:**
```
Before:
  - LT-S001-F1: 100kg (2 boxes)
  - Inventory: longTermInventory = 100kg

Transfer: 1 box (50kg) from LT-S001-F1 → LT-S002-F1

After:
  - LT-S001-F1: 50kg (1 box)
  - LT-S002-F1: 50kg (1 box)
  - Inventory: longTermInventory = 100kg (unchanged)
```

---

### ST→ST Transfer (Short-term to Short-term)

**Behavior:**
- No inventory change: Stays in `shortTermInventory` (just different rack)
- Box location updated: `ST-S001-F1` → `ST-S002-F1`
- **Creates transaction record with complete logs** (box IDs, locations, dates, weights)
- Transaction logged for audit trail (bypasses inventory update service)
- Used for reorganizing short-term storage

**Example:**
```
Before:
  - ST-S001-F1: 50kg (1 box)
  - Inventory: shortTermInventory = 50kg

Transfer: 1 box (50kg) from ST-S001-F1 → ST-S002-F1

After:
  - ST-S001-F1: 0kg (0 boxes)
  - ST-S002-F1: 50kg (1 box)
  - Inventory: shortTermInventory = 50kg (unchanged)
  - Log: "BOX-123 transferred from ST-S001-F1 to ST-S002-F1 on 2026-01-15"
```

---

## Use Cases

### Use Case 1: Move Boxes to Short-Term for Issuance

**Scenario:** Need to move boxes from long-term storage to short-term for yarn issuance.

**API Call:**
```bash
POST /v1/yarn-management/yarn-boxes/transfer
{
  "boxIds": ["BOX-123"],
  "toStorageLocation": "ST-S001-F1"
}
```

**Result:**
- Box moved to short-term storage
- Inventory updated (LT decreases, ST increases)
- Box ready for yarn issuance

---

### Use Case 2: Reorganize Long-Term Storage

**Scenario:** Need to move boxes between long-term racks for better organization.

**API Call:**
```bash
POST /v1/yarn-management/yarn-boxes/transfer
{
  "boxIds": ["BOX-123", "BOX-456"],
  "toStorageLocation": "LT-S002-F1"
}
```

**Result:**
- Boxes moved to new rack
- Inventory unchanged (still in long-term)
- Complete transfer log maintained with box IDs, locations, dates

---

### Use Case 3: Reorganize Short-Term Storage

**Scenario:** Need to move boxes between short-term racks for better organization.

**API Call:**
```bash
POST /v1/yarn-management/yarn-boxes/transfer
{
  "boxIds": ["BOX-123"],
  "toStorageLocation": "ST-S002-F1"
}
```

**Result:**
- Boxes moved to new short-term rack
- Inventory unchanged (still in short-term)
- **Complete transfer log maintained** with box IDs, locations, dates, weights
- Full audit trail for ST→ST transfers

---

### Use Case 4: Check Rack Inventory and History

**Scenario:** Need to see what's currently on a rack and its transfer history.

**API Call:**
```bash
GET /v1/storage/slots/LT-S001-F1/history
```

**Result:**
- Current boxes and weights on the rack
- Complete history of transfers (what moved, when, which boxes)
- Organized by yarn for easy viewing

---

## Data Models

### YarnTransaction (Transfer Log)

Each transfer creates a transaction record with:

```javascript
{
  yarn: ObjectId,                    // Yarn catalog reference
  yarnName: String,                 // Yarn name
  transactionType: "internal_transfer",
  transactionDate: Date,             // When transfer occurred
  transactionTotalWeight: Number,    // Total weight
  transactionNetWeight: Number,     // Net weight (after tear)
  transactionTearWeight: Number,     // Tear weight
  transactionConeCount: Number,      // Number of cones
  orderno: String,                  // Comma-separated box IDs
  boxIds: [String],                 // Array of box IDs
  fromStorageLocation: String,      // Source location
  toStorageLocation: String          // Destination location
}
```

### YarnBox (Updated on Transfer)

Box location is updated:

```javascript
{
  boxId: String,                    // Unique box ID
  storageLocation: String,          // Updated to new location
  storedStatus: Boolean,            // Still true
  // ... other fields unchanged
}
```

---

## Validation Rules

1. **Box Validation:**
   - Boxes must exist
   - Boxes must have valid storage locations (start with `LT-` or `ST-`)
   - Boxes must be stored (`storedStatus: true`)
   - Boxes must be QC approved (`qcData.status: 'qc_approved'`)

2. **Location Validation:**
   - Target location must be valid (start with `LT-` or `ST-`)
   - For LT→ST: Target must start with `ST-`
   - For LT→LT: Target must start with `LT-`

3. **Yarn Catalog:**
   - Yarn catalog must exist for each box's yarn name
   - Case-insensitive matching supported

---

## Error Handling

### Common Errors

**400 Bad Request:**
```json
{
  "statusCode": 400,
  "message": "boxIds array is required with at least one box ID"
}
```

**404 Not Found:**
```json
{
  "statusCode": 404,
  "message": "Boxes not found: BOX-123, BOX-456"
}
```

**400 Bad Request (Invalid State):**
```json
{
  "statusCode": 400,
  "message": "Boxes must be stored and QC approved: BOX-123"
}
```

---

## Integration Notes

1. **Inventory Updates:**
   - Only LT→ST transfers update inventory buckets
   - LT→LT and ST→ST transfers are **fully logged** but don't affect inventory totals
   - Inventory updates are atomic (MongoDB transactions)

2. **Transaction Logging:**
   - **All transfers create transaction records** (LT→ST, LT→LT, ST→ST)
   - Transaction records include box IDs, locations, dates, weights for complete audit trail
   - **ST→ST transfers maintain complete logs** just like LT→LT transfers
   - History API retrieves transactions involving a location (works for all transfer types)

3. **Box Location Updates:**
   - Box `storageLocation` is updated immediately
   - Box remains stored (`storedStatus: true`)
   - Other box properties unchanged

4. **Grouping by Yarn:**
   - Multiple boxes of different yarns are grouped
   - Separate transactions created per yarn
   - Results array contains one entry per yarn

---

## Examples

### Example 1: Transfer Single Box LT→ST

```bash
curl -X POST http://localhost:8000/v1/yarn-management/yarn-boxes/transfer \
  -H "Content-Type: application/json" \
  -d '{
    "boxIds": ["BOX-PO-2026-867-11121-1768030623043-2"],
    "toStorageLocation": "ST-S001-F1"
  }'
```

### Example 2: Transfer Multiple Boxes LT→LT

```bash
curl -X POST http://localhost:8000/v1/yarn-management/yarn-boxes/transfer \
  -H "Content-Type: application/json" \
  -d '{
    "boxIds": ["BOX-123", "BOX-456"],
    "toStorageLocation": "LT-S002-F1",
    "transferDate": "2026-01-15T10:00:00Z"
  }'
```

### Example 3: Get Storage History

```bash
curl -X GET http://localhost:8000/v1/storage/slots/LT-S001-F1/history
```

---

## Related APIs

- **Get Storage Contents:** `GET /v1/storage/slots/barcode/:barcode` - Get current boxes/cones in a location
- **Yarn Inventory:** `GET /v1/yarn-management/yarn-inventories` - Get inventory totals
- **Yarn Transactions:** `GET /v1/yarn-management/yarn-transactions` - Get all transactions

---

## Version History

- **v1.0** (2026-01-15): Initial implementation
  - Unified transfer API (LT→ST, LT→LT, ST→ST)
  - Storage history API
  - Complete audit trail with box IDs
