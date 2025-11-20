# Yarn Inventory & Requisition API Documentation

This document provides comprehensive API documentation for Yarn Inventory and Yarn Requisition endpoints.

---

## Table of Contents

1. [Yarn Inventory APIs](#yarn-inventory-apis)
2. [Yarn Requisition APIs](#yarn-requisition-apis)

---

## Yarn Inventory APIs

### 1. Get All Yarn Inventories

**Endpoint:** `GET /v1/yarn-management/yarn-inventories`

**Description:** Retrieves a paginated list of yarn inventories with optional filtering. Returns LTS/STS breakdown with blocked weight included in net weight.

**Query Parameters:**
- `yarn_id` (optional, string): Filter by yarn catalog ID
- `yarn_name` (optional, string): Filter by yarn name (case-insensitive partial match)
- `inventory_status` (optional, string): Filter by inventory status. Valid values: `in_stock`, `low_stock`, `soon_to_be_low`
- `overbooked` (optional, boolean): Filter by overbooked status
- `sortBy` (optional, string): Sort field
- `limit` (optional, number): Number of results per page
- `page` (optional, number): Page number

**Response Structure:**
```json
{
  "results": [
    {
      "yarn": {
        "_id": "507f1f77bcf86cd799439011",
        "yarnName": "Cotton 40s",
        "yarnType": "Cotton",
        "status": "active"
      },
      "yarnId": "507f1f77bcf86cd799439011",
      "yarnName": "Cotton 40s",
      "longTermStorage": {
        "totalWeight": 1000.5,
        "netWeight": 950.5,
        "numberOfCones": 100
      },
      "shortTermStorage": {
        "totalWeight": 500.25,
        "netWeight": 450.25,
        "numberOfCones": 50
      },
      "inventoryStatus": "in_stock",
      "overbooked": false
    }
  ],
  "page": 1,
  "limit": 10,
  "totalPages": 5,
  "totalResults": 50
}
```

**Status Codes:**
- `200 OK`: Successfully retrieved inventories

---

### 2. Create Yarn Inventory

**Endpoint:** `POST /v1/yarn-management/yarn-inventories`

**Description:** Creates or initializes a new yarn inventory record. Automatically calculates total inventory from long-term and short-term buckets if not provided.

**Request Body:**
```json
{
  "yarn": "507f1f77bcf86cd799439011",
  "yarnName": "Cotton 40s",
  "totalInventory": {
    "totalWeight": 0,
    "totalTearWeight": 0,
    "totalNetWeight": 0,
    "numberOfCones": 0
  },
  "longTermInventory": {
    "totalWeight": 1000.5,
    "totalTearWeight": 50.0,
    "totalNetWeight": 950.5,
    "numberOfCones": 100
  },
  "shortTermInventory": {
    "totalWeight": 500.25,
    "totalTearWeight": 50.0,
    "totalNetWeight": 450.25,
    "numberOfCones": 50
  },
  "blockedNetWeight": 0,
  "inventoryStatus": "in_stock",
  "overbooked": false
}
```

**Request Body Fields:**
- `yarn` (required, string): Yarn catalog ObjectId
- `yarnName` (required, string): Yarn name (will be auto-synced from catalog)
- `totalInventory` (optional, object): Total inventory bucket
  - `totalWeight` (number, min: 0, default: 0)
  - `totalTearWeight` (number, min: 0, default: 0)
  - `totalNetWeight` (number, min: 0, default: 0)
  - `numberOfCones` (number, min: 0, default: 0)
- `longTermInventory` (optional, object): Long-term storage inventory bucket (same structure as totalInventory)
- `shortTermInventory` (optional, object): Short-term storage inventory bucket (same structure as totalInventory)
- `blockedNetWeight` (optional, number, min: 0, default: 0): Blocked net weight
- `inventoryStatus` (optional, string, default: "in_stock"): Valid values: `in_stock`, `low_stock`, `soon_to_be_low`
- `overbooked` (optional, boolean, default: false): Overbooked status

**Response Structure:**
```json
{
  "yarn": {
    "_id": "507f1f77bcf86cd799439011",
    "yarnName": "Cotton 40s",
    "yarnType": "Cotton",
    "status": "active"
  },
  "yarnId": "507f1f77bcf86cd799439011",
  "yarnName": "Cotton 40s",
  "longTermStorage": {
    "totalWeight": 1000.5,
    "netWeight": 950.5,
    "numberOfCones": 100
  },
  "shortTermStorage": {
    "totalWeight": 500.25,
    "netWeight": 450.25,
    "numberOfCones": 50
  },
  "inventoryStatus": "in_stock",
  "overbooked": false
}
```

**Status Codes:**
- `201 Created`: Successfully created inventory
- `400 Bad Request`: Invalid input or inventory already exists for this yarn

---

### 3. Get Yarn Inventory by ID

**Endpoint:** `GET /v1/yarn-management/yarn-inventories/:inventoryId`

**Description:** Retrieves a single yarn inventory by inventory ID.

**Path Parameters:**
- `inventoryId` (required, string): Inventory ObjectId

**Response Structure:**
```json
{
  "yarn": {
    "_id": "507f1f77bcf86cd799439011",
    "yarnName": "Cotton 40s",
    "yarnType": "Cotton",
    "status": "active"
  },
  "yarnId": "507f1f77bcf86cd799439011",
  "yarnName": "Cotton 40s",
  "longTermStorage": {
    "totalWeight": 1000.5,
    "netWeight": 950.5,
    "numberOfCones": 100
  },
  "shortTermStorage": {
    "totalWeight": 500.25,
    "netWeight": 450.25,
    "numberOfCones": 50
  },
  "inventoryStatus": "in_stock",
  "overbooked": false
}
```

**Status Codes:**
- `200 OK`: Successfully retrieved inventory
- `404 Not Found`: Inventory not found

---

### 4. Get Yarn Inventory by Yarn Catalog ID

**Endpoint:** `GET /v1/yarn-management/yarn-inventories/yarn/:yarnId`

**Description:** Retrieves yarn inventory by yarn catalog ID.

**Path Parameters:**
- `yarnId` (required, string): Yarn catalog ObjectId

**Response Structure:**
```json
{
  "yarn": {
    "_id": "507f1f77bcf86cd799439011",
    "yarnName": "Cotton 40s",
    "yarnType": "Cotton",
    "status": "active"
  },
  "yarnId": "507f1f77bcf86cd799439011",
  "yarnName": "Cotton 40s",
  "longTermStorage": {
    "totalWeight": 1000.5,
    "netWeight": 950.5,
    "numberOfCones": 100
  },
  "shortTermStorage": {
    "totalWeight": 500.25,
    "netWeight": 450.25,
    "numberOfCones": 50
  },
  "inventoryStatus": "in_stock",
  "overbooked": false
}
```

**Status Codes:**
- `200 OK`: Successfully retrieved inventory
- `404 Not Found`: Inventory not found for this yarn

---

## Yarn Requisition APIs

### 1. Get Yarn Requisition List

**Endpoint:** `GET /v1/yarn-management/yarn-requisitions`

**Description:** Retrieves a list of yarn requisitions filtered by date range and optional PO sent status. Results are sorted by creation date (newest first).

**Query Parameters:**
- `startDate` (required, ISO date string): Start date for filtering (inclusive)
- `endDate` (required, ISO date string): End date for filtering (inclusive)
- `poSent` (optional, boolean): Filter by PO sent status

**Response Structure:**
```json
[
  {
    "_id": "507f1f77bcf86cd799439011",
    "yarnName": "Cotton 40s",
    "yarn": {
      "_id": "507f1f77bcf86cd799439012",
      "yarnName": "Cotton 40s",
      "yarnType": "Cotton",
      "status": "active"
    },
    "minQty": 1000,
    "availableQty": 800,
    "blockedQty": 200,
    "alertStatus": "below_minimum",
    "poSent": false,
    "created": "2024-01-15T10:30:00.000Z",
    "lastUpdated": "2024-01-15T10:30:00.000Z"
  },
  {
    "_id": "507f1f77bcf86cd799439013",
    "yarnName": "Polyester 60s",
    "yarn": {
      "_id": "507f1f77bcf86cd799439014",
      "yarnName": "Polyester 60s",
      "yarnType": "Polyester",
      "status": "active"
    },
    "minQty": 500,
    "availableQty": 600,
    "blockedQty": 700,
    "alertStatus": "overbooked",
    "poSent": true,
    "created": "2024-01-14T09:15:00.000Z",
    "lastUpdated": "2024-01-14T15:20:00.000Z"
  }
]
```

**Response Fields:**
- `_id`: Requisition ObjectId
- `yarnName`: Yarn name
- `yarn`: Populated yarn catalog object with `_id`, `yarnName`, `yarnType`, `status`
- `minQty`: Minimum required quantity
- `availableQty`: Available quantity
- `blockedQty`: Blocked quantity
- `alertStatus`: Alert status (`null`, `below_minimum`, or `overbooked`)
  - `below_minimum`: When `availableQty < minQty`
  - `overbooked`: When `blockedQty > availableQty`
- `poSent`: Boolean indicating if purchase order has been sent
- `created`: Creation timestamp
- `lastUpdated`: Last update timestamp

**Status Codes:**
- `200 OK`: Successfully retrieved requisitions
- `400 Bad Request`: Invalid date range or missing required parameters

---

### 2. Create Yarn Requisition

**Endpoint:** `POST /v1/yarn-management/yarn-requisitions`

**Description:** Creates a new yarn requisition. Alert status is automatically computed based on `minQty`, `availableQty`, and `blockedQty`.

**Request Body:**
```json
{
  "yarnName": "Cotton 40s",
  "yarn": "507f1f77bcf86cd799439012",
  "minQty": 1000,
  "availableQty": 800,
  "blockedQty": 200,
  "poSent": false
}
```

**Request Body Fields:**
- `yarnName` (required, string): Yarn name (will be auto-synced from catalog)
- `yarn` (required, string): Yarn catalog ObjectId
- `minQty` (required, number, min: 0): Minimum required quantity
- `availableQty` (required, number, min: 0): Available quantity
- `blockedQty` (required, number, min: 0, default: 0): Blocked quantity
- `alertStatus` (optional, string): Valid values: `below_minimum`, `overbooked` (auto-computed if not provided)
- `poSent` (optional, boolean, default: false): Purchase order sent status

**Response Structure:**
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "yarnName": "Cotton 40s",
  "yarn": "507f1f77bcf86cd799439012",
  "minQty": 1000,
  "availableQty": 800,
  "blockedQty": 200,
  "alertStatus": "below_minimum",
  "poSent": false,
  "created": "2024-01-15T10:30:00.000Z",
  "lastUpdated": "2024-01-15T10:30:00.000Z"
}
```

**Status Codes:**
- `201 Created`: Successfully created requisition
- `400 Bad Request`: Invalid input

---

### 3. Update Yarn Requisition Status

**Endpoint:** `PATCH /v1/yarn-management/yarn-requisitions/:yarnRequisitionId/status`

**Description:** Updates the purchase order sent status for a yarn requisition.

**Path Parameters:**
- `yarnRequisitionId` (required, string): Requisition ObjectId

**Request Body:**
```json
{
  "poSent": true
}
```

**Request Body Fields:**
- `poSent` (required, boolean): Purchase order sent status

**Response Structure:**
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "yarnName": "Cotton 40s",
  "yarn": "507f1f77bcf86cd799439012",
  "minQty": 1000,
  "availableQty": 800,
  "blockedQty": 200,
  "alertStatus": "below_minimum",
  "poSent": true,
  "created": "2024-01-15T10:30:00.000Z",
  "lastUpdated": "2024-01-15T11:45:00.000Z"
}
```

**Status Codes:**
- `200 OK`: Successfully updated requisition status
- `404 Not Found`: Requisition not found
- `400 Bad Request`: Invalid input

---

## Notes

### Yarn Inventory Response Transformation

All yarn inventory responses are transformed to include:
- `longTermStorage` and `shortTermStorage` objects with:
  - `totalWeight`: Total weight in the storage
  - `netWeight`: Net weight (includes blocked weight)
  - `numberOfCones`: Number of cones
- The `yarn` field is populated with catalog information (`_id`, `yarnName`, `yarnType`, `status`)

### Yarn Requisition Alert Status Logic

The `alertStatus` field is automatically computed:
- `below_minimum`: When `availableQty < minQty`
- `overbooked`: When `blockedQty > availableQty`
- `null`: When neither condition is met

### Timestamps

- Yarn Inventory uses standard `createdAt` and `updatedAt` timestamps
- Yarn Requisition uses custom timestamps: `created` and `lastUpdated`

---

## Error Responses

All endpoints may return the following error responses:

**400 Bad Request:**
```json
{
  "code": 400,
  "message": "Error message describing the issue"
}
```

**404 Not Found:**
```json
{
  "code": 404,
  "message": "Resource not found"
}
```

**500 Internal Server Error:**
```json
{
  "code": 500,
  "message": "Internal server error"
}
```

