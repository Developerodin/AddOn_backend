# Production System API Complete Reference

This document provides a comprehensive reference for all Production System APIs, including quality inspection, floor operations, and order management.

## Table of Contents

1. [Authentication](#authentication)
2. [Production Orders](#production-orders)
3. [Floor Operations](#floor-operations)
4. [Quality Control](#quality-control)
5. [Reports & Analytics](#reports--analytics)
6. [Logging & Audit](#logging--audit)
7. [Bulk Operations](#bulk-operations)

---

## Authentication

All API endpoints require authentication via JWT token in the Authorization header:

```http
Authorization: Bearer {your-jwt-token}
```

---

## Production Orders

### Create Production Order

**Endpoint:** `POST /v1/production/orders`

**Request Body:**
```json
{
  "priority": "Medium",
  "articles": [
    {
      "articleNumber": "ART01",
      "plannedQuantity": 1000,
      "linkingType": "Auto Linking",
      "priority": "Medium",
      "remarks": "Special requirements"
    }
  ],
  "orderNote": "Customer order details",
  "customerId": "68d2806412942447531c5fe8",
  "customerName": "ABC Company",
  "customerOrderNumber": "CUST-001",
  "plannedStartDate": "2025-09-23T00:00:00.000Z",
  "plannedEndDate": "2025-09-30T00:00:00.000Z",
  "createdBy": "68d2806412942447531c5fe8"
}
```

**cURL Example:**
```bash
curl -X POST \
  'http://localhost:3000/v1/production/orders' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "priority": "Medium",
    "articles": [
      {
        "articleNumber": "ART01",
        "plannedQuantity": 1000,
        "linkingType": "Auto Linking",
        "priority": "Medium",
        "remarks": "Special requirements"
      }
    ],
    "orderNote": "Customer order details",
    "createdBy": "68d2806412942447531c5fe8"
  }'
```

### Get Production Orders

**Endpoint:** `GET /v1/production/orders`

**Query Parameters:**
```json
{
  "orderNumber": "ORD-000001",
  "priority": "Medium",
  "status": "In Progress",
  "currentFloor": "Checking",
  "customerId": "68d2806412942447531c5fe8",
  "customerName": "ABC Company",
  "customerOrderNumber": "CUST-001",
  "createdBy": "68d2806412942447531c5fe8",
  "lastModifiedBy": "68d2806412942447531c5fe8",
  "sortBy": "createdAt:desc",
  "limit": 10,
  "page": 1,
  "populate": "articles"
}
```

**cURL Example:**
```bash
curl -X GET \
  'http://localhost:3000/v1/production/orders?status=In%20Progress&limit=10&page=1&populate=articles' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

### Get Production Order by ID

**Endpoint:** `GET /v1/production/orders/{orderId}`

**cURL Example:**
```bash
curl -X GET \
  'http://localhost:3000/v1/production/orders/68d283723078afeb184dd33c' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

### Update Production Order

**Endpoint:** `PATCH /v1/production/orders/{orderId}`

**Request Body:**
```json
{
  "priority": "High",
  "orderNote": "Updated order details",
  "plannedEndDate": "2025-10-01T00:00:00.000Z",
  "lastModifiedBy": "68d2806412942447531c5fe8"
}
```

### Delete Production Order

**Endpoint:** `DELETE /v1/production/orders/{orderId}`

**cURL Example:**
```bash
curl -X DELETE \
  'http://localhost:3000/v1/production/orders/68d283723078afeb184dd33c' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

---

## Floor Operations

### Get Floor Orders

**Endpoint:** `GET /v1/production/floors/{floor}/orders`

**Path Parameters:**
- `floor`: One of: `Knitting`, `Linking`, `Checking`, `Washing`, `Boarding`, `Branding`, `Final Checking`, `Warehouse`

**Query Parameters:**
```json
{
  "status": "In Progress",
  "priority": "Medium",
  "sortBy": "createdAt:desc",
  "limit": 10,
  "page": 1,
  "populate": "articles"
}
```

**cURL Example:**
```bash
curl -X GET \
  'http://localhost:3000/v1/production/floors/Checking/orders?status=In%20Progress&limit=10&page=1&populate=articles' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

### Update Article Progress

**Endpoint:** `PATCH /v1/production/floors/{floor}/orders/{orderId}/articles/{articleId}`

**Path Parameters:**
- `floor`: Floor name
- `orderId`: Order ID
- `articleId`: Article ID

**Request Body:**
```json
{
  "completedQuantity": 100,
  "remarks": "Production progress update",
  "userId": "68d2806412942447531c5fe8",
  "floorSupervisorId": "68d2806412942447531c5fe8",
  "machineId": "MACHINE_001",
  "shiftId": "SHIFT_001"
}
```

**Floor-Specific Fields:**

#### Knitting Floor
```json
{
  "completedQuantity": 100,
  "m4Quantity": 5,
  "remarks": "Knitting completed with defects",
  "userId": "68d2806412942447531c5fe8",
  "floorSupervisorId": "68d2806412942447531c5fe8"
}
```

#### Checking Floor (Quality Inspection)
```json
{
  "completedQuantity": 140,
  "m1Quantity": 100,
  "m2Quantity": 20,
  "m3Quantity": 0,
  "m4Quantity": 20,
  "repairStatus": "Required",
  "repairRemarks": "Minor defects need repair",
  "remarks": "Quality inspection completed",
  "userId": "68d2806412942447531c5fe8",
  "floorSupervisorId": "68d2806412942447531c5fe8"
}
```

#### Final Checking Floor
```json
{
  "completedQuantity": 100,
  "m1Quantity": 95,
  "m2Quantity": 3,
  "m3Quantity": 2,
  "m4Quantity": 0,
  "repairStatus": "Not Required",
  "repairRemarks": "",
  "remarks": "Final quality check completed",
  "userId": "68d2806412942447531c5fe8",
  "floorSupervisorId": "68d2806412942447531c5fe8"
}
```

**cURL Example (Checking Floor):**
```bash
curl -X PATCH \
  'http://localhost:3000/v1/production/floors/Checking/orders/68d283723078afeb184dd33c/articles/68d283723078afeb184dd33b' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "completedQuantity": 140,
    "m1Quantity": 100,
    "m2Quantity": 20,
    "m3Quantity": 0,
    "m4Quantity": 20,
    "repairStatus": "Required",
    "repairRemarks": "Minor defects need repair",
    "remarks": "Quality inspection completed",
    "userId": "68d2806412942447531c5fe8",
    "floorSupervisorId": "68d2806412942447531c5fe8"
  }'
```

### Transfer Article to Next Floor

**Endpoint:** `POST /v1/production/floors/{floor}/transfer`

**Request Body:**
```json
{
  "orderId": "68d283723078afeb184dd33c",
  "articleId": "68d283723078afeb184dd33b",
  "remarks": "Transferring to next floor",
  "userId": "68d2806412942447531c5fe8",
  "floorSupervisorId": "68d2806412942447531c5fe8",
  "batchNumber": "BATCH_001"
}
```

**cURL Example:**
```bash
curl -X POST \
  'http://localhost:3000/v1/production/floors/Checking/transfer' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "orderId": "68d283723078afeb184dd33c",
    "articleId": "68d283723078afeb184dd33b",
    "remarks": "Transferring good quality items to washing floor",
    "userId": "68d2806412942447531c5fe8",
    "floorSupervisorId": "68d2806412942447531c5fe8",
    "batchNumber": "BATCH_001"
  }'
```

### Get Floor Statistics

**Endpoint:** `GET /v1/production/floors/{floor}/statistics`

**Query Parameters:**
```json
{
  "dateFrom": "2025-09-23",
  "dateTo": "2025-09-23"
}
```

**cURL Example:**
```bash
curl -X GET \
  'http://localhost:3000/v1/production/floors/Checking/statistics?dateFrom=2025-09-23&dateTo=2025-09-23' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

---

## Quality Control

### Checking vs Final Checking Floors

**Checking Floor:**
- **Purpose**: Initial quality inspection after production
- **Transfer Logic**: Only M1 (good quality) items transfer to next floor
- **Defects**: M2, M3, M4 items remain for repair/rejection
- **API Endpoint**: `PATCH /v1/production/floors/Checking/orders/{orderId}/articles/{articleId}`

**Final Checking Floor:**
- **Purpose**: Final quality confirmation before warehouse
- **Transfer Logic**: All inspected items transfer to warehouse
- **Defects**: M2 items can be shifted to M1 after repair
- **API Endpoint**: `PATCH /v1/production/floors/Final Checking/orders/{orderId}/articles/{articleId}`

### Update Quality Categories (Checking & Final Checking)

**Endpoint:** `PATCH /v1/production/floors/{floor}/orders/{orderId}/articles/{articleId}`

**Note:** This endpoint works for both `Checking` and `Final Checking` floors. The quality fields (m1Quantity, m2Quantity, m3Quantity, m4Quantity) are available on both floors.

**Request Body for Checking Floor:**
```json
{
  "completedQuantity": 140,
  "m1Quantity": 100,
  "m2Quantity": 20,
  "m3Quantity": 0,
  "m4Quantity": 20,
  "repairStatus": "Required",
  "repairRemarks": "Minor defects need repair",
  "remarks": "Quality inspection completed",
  "userId": "68d2806412942447531c5fe8",
  "floorSupervisorId": "68d2806412942447531c5fe8"
}
```

**Request Body for Final Checking Floor:**
```json
{
  "completedQuantity": 100,
  "m1Quantity": 95,
  "m2Quantity": 3,
  "m3Quantity": 2,
  "m4Quantity": 0,
  "repairStatus": "Not Required",
  "repairRemarks": "",
  "remarks": "Final quality check completed",
  "userId": "68d2806412942447531c5fe8",
  "floorSupervisorId": "68d2806412942447531c5fe8"
}
```

**cURL Example for Checking Floor:**
```bash
curl -X PATCH \
  'http://localhost:3000/v1/production/floors/Checking/orders/68d283723078afeb184dd33c/articles/68d283723078afeb184dd33b' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "completedQuantity": 140,
    "m1Quantity": 100,
    "m2Quantity": 20,
    "m3Quantity": 0,
    "m4Quantity": 20,
    "repairStatus": "Required",
    "repairRemarks": "Minor defects need repair",
    "remarks": "Quality inspection completed",
    "userId": "68d2806412942447531c5fe8",
    "floorSupervisorId": "68d2806412942447531c5fe8"
  }'
```

**cURL Example for Final Checking Floor:**
```bash
curl -X PATCH \
  'http://localhost:3000/v1/production/floors/Final Checking/orders/68d283723078afeb184dd33c/articles/68d283723078afeb184dd33b' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "completedQuantity": 100,
    "m1Quantity": 95,
    "m2Quantity": 3,
    "m3Quantity": 2,
    "m4Quantity": 0,
    "repairStatus": "Not Required",
    "repairRemarks": "",
    "remarks": "Final quality check completed",
    "userId": "68d2806412942447531c5fe8",
    "floorSupervisorId": "68d2806412942447531c5fe8"
  }'
```

### Shift M2 Items (Repair Process)

**Endpoint:** `POST /v1/production/floors/{floor}/shift-m2`

**Note:** This endpoint works for both `Checking` and `Final Checking` floors.

**Request Body:**
```json
{
  "articleId": "68d283723078afeb184dd33b",
  "fromM2": 20,
  "toM1": 15,
  "toM3": 5,
  "toM4": 0,
  "remarks": "Repaired minor defects",
  "userId": "68d2806412942447531c5fe8",
  "floorSupervisorId": "68d2806412942447531c5fe8"
}
```

**cURL Example for Checking Floor:**
```bash
curl -X POST \
  'http://localhost:3000/v1/production/floors/Checking/shift-m2' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "articleId": "68d283723078afeb184dd33b",
    "fromM2": 20,
    "toM1": 15,
    "toM3": 5,
    "toM4": 0,
    "remarks": "Repaired minor defects",
    "userId": "68d2806412942447531c5fe8",
    "floorSupervisorId": "68d2806412942447531c5fe8"
  }'
```

**cURL Example for Final Checking Floor:**
```bash
curl -X POST \
  'http://localhost:3000/v1/production/floors/Final Checking/shift-m2' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "articleId": "68d283723078afeb184dd33b",
    "fromM2": 20,
    "toM1": 15,
    "toM3": 5,
    "toM4": 0,
    "remarks": "Repaired minor defects",
    "userId": "68d2806412942447531c5fe8",
    "floorSupervisorId": "68d2806412942447531c5fe8"
  }'
```

### Confirm Final Quality

**Endpoint:** `PATCH /v1/production/floors/final-checking/confirm-quality/{articleId}`

**Request Body:**
```json
{
  "confirmed": true,
  "remarks": "Final quality confirmed",
  "userId": "68d2806412942447531c5fe8",
  "floorSupervisorId": "68d2806412942447531c5fe8"
}
```

### Forward to Warehouse

**Endpoint:** `POST /v1/production/floors/final-checking/forward-warehouse/{articleId}`

**Request Body:**
```json
{
  "quantity": 95,
  "remarks": "Forwarding to warehouse",
  "userId": "68d2806412942447531c5fe8",
  "floorSupervisorId": "68d2806412942447531c5fe8"
}
```

---

## Reports & Analytics

### Get Production Dashboard

**Endpoint:** `GET /v1/production/dashboard`

**Query Parameters:**
```json
{
  "dateFrom": "2025-09-01",
  "dateTo": "2025-09-30",
  "floor": "Checking"
}
```

### Get Efficiency Report

**Endpoint:** `GET /v1/production/reports/efficiency`

**Query Parameters:**
```json
{
  "dateFrom": "2025-09-01",
  "dateTo": "2025-09-30",
  "floor": "Checking",
  "groupBy": "day"
}
```

### Get Quality Report

**Endpoint:** `GET /v1/production/reports/quality`

**Query Parameters:**
```json
{
  "dateFrom": "2025-09-01",
  "dateTo": "2025-09-30",
  "floor": "Checking",
  "qualityCategory": "M1"
}
```

### Get Order Tracking Report

**Endpoint:** `GET /v1/production/reports/order-tracking`

**Query Parameters:**
```json
{
  "orderId": "68d283723078afeb184dd33c",
  "includeLogs": true
}
```

---

## Logging & Audit

### Get Article Logs

**Endpoint:** `GET /v1/production/logs/articles/{articleId}`

**Query Parameters:**
```json
{
  "action": "Quantity Updated",
  "dateFrom": "2025-09-01",
  "dateTo": "2025-09-30",
  "limit": 50,
  "page": 1
}
```

### Get Order Logs

**Endpoint:** `GET /v1/production/logs/orders/{orderId}`

### Get Floor Logs

**Endpoint:** `GET /v1/production/logs/floors/{floor}`

### Get User Logs

**Endpoint:** `GET /v1/production/logs/users/{userId}`

### Get Log Statistics

**Endpoint:** `GET /v1/production/logs/statistics`

### Get Audit Trail

**Endpoint:** `GET /v1/production/logs/audit-trail`

---

## Bulk Operations

### Bulk Create Orders

**Endpoint:** `POST /v1/production/orders/bulk-create`

**Request Body:**
```json
{
  "orders": [
    {
      "priority": "Medium",
      "articles": [
        {
          "articleNumber": "ART01",
          "plannedQuantity": 1000,
          "linkingType": "Auto Linking",
          "priority": "Medium"
        }
      ],
      "orderNote": "Bulk order 1",
      "createdBy": "68d2806412942447531c5fe8"
    }
  ],
  "batchSize": 10
}
```

### Bulk Update Articles

**Endpoint:** `POST /v1/production/articles/bulk-update`

**Request Body:**
```json
{
  "updates": [
    {
      "floor": "Checking",
      "orderId": "68d283723078afeb184dd33c",
      "articleId": "68d283723078afeb184dd33b",
      "completedQuantity": 140,
      "m1Quantity": 100,
      "m2Quantity": 20,
      "m3Quantity": 0,
      "m4Quantity": 20,
      "userId": "68d2806412942447531c5fe8",
      "floorSupervisorId": "68d2806412942447531c5fe8"
    }
  ],
  "batchSize": 50
}
```

---

## Quality Categories Reference

### M1 - Good Quality
- **Description**: Perfect quality items that pass all inspections
- **Action**: Transferred to next floor
- **Color**: Green

### M2 - Minor Defects
- **Description**: Items with minor defects that can be repaired
- **Action**: Stay for repair, can be shifted to M1 after repair
- **Color**: Yellow

### M3 - Minor Defects
- **Description**: Items with minor defects that can be repaired
- **Action**: Stay for repair, can be shifted to M1 after repair
- **Color**: Orange

### M4 - Major Defects
- **Description**: Items with major defects that cannot be repaired
- **Action**: Rejected/scrapped
- **Color**: Red

---

## Floor Flow Reference

### Auto Linking Flow
```
KNITTING → CHECKING → WASHING → BOARDING → FINAL_CHECKING → BRANDING → WAREHOUSE
```

### Hand/Rosso Linking Flow
```
KNITTING → LINKING → CHECKING → WASHING → BOARDING → FINAL_CHECKING → BRANDING → WAREHOUSE
```

---

## Error Codes

| Code | Description |
|------|-------------|
| 400 | Bad Request - Invalid input data |
| 401 | Unauthorized - Invalid or missing token |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource not found |
| 409 | Conflict - Duplicate resource |
| 422 | Unprocessable Entity - Validation error |
| 500 | Internal Server Error - Server error |

---

## Response Format

### Success Response
```json
{
  "success": true,
  "data": {
    // Response data
  },
  "message": "Operation completed successfully"
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": [
      {
        "field": "m1Quantity",
        "message": "M1 quantity must be a positive number"
      }
    ]
  }
}
```

---

## Rate Limiting

- **Default**: 100 requests per minute per IP
- **Authentication**: 10 requests per minute for login attempts
- **Bulk Operations**: 5 requests per minute

---

## WebSocket Events

### Real-time Updates
- **Order Status Changes**: `order.status.changed`
- **Floor Transfers**: `article.transferred`
- **Quality Updates**: `quality.inspection.completed`
- **Progress Updates**: `article.progress.updated`

---

## Testing

### Postman Collection
Import the Postman collection from: `src/docs/postman/`

### Test Environment
- **Base URL**: `http://localhost:3000`
- **Test Database**: `mongodb://localhost:27017/addon_test`

---

## Support

For API support and questions:
- **Email**: support@addon.com
- **Documentation**: https://docs.addon.com/api
- **Status Page**: https://status.addon.com
