# Order Management API Documentation

Complete API reference for managing orders manually, syncing from external sources, and all CRUD operations.

**Base URL:** `/v1/orders`

**Authentication:** All endpoints require JWT token in Authorization header:
```
Authorization: Bearer {your-jwt-token}
```

---

## 📋 Table of Contents

1. [Create Order Manually](#1-create-order-manually)
2. [Get All Orders](#2-get-all-orders)
3. [Get Single Order](#3-get-single-order)
4. [Get Order by Source + External ID](#4-get-order-by-source--external-id)
5. [Update Order (Full/Partial)](#5-update-order-fullpartial)
6. [Update Order Status](#6-update-order-status)
7. [Update Logistics Information](#7-update-logistics-information)
8. [Update Payment Status](#8-update-payment-status)
9. [Delete Order](#9-delete-order)
10. [Sync Orders from Sources](#10-sync-orders-from-sources)
11. [Get Order Statistics](#11-get-order-statistics)

---

## 1. Create Order Manually

**Endpoint:** `POST /v1/orders`

**Description:** Create a new order manually in the system.

**Request Body:**
```json
{
  "source": "Website",
  "externalOrderId": "ORD-12345",
  "customer": {
    "name": "John Doe",
    "phone": "+1234567890",
    "email": "john@example.com",
    "address": {
      "street": "123 Main Street",
      "city": "New York",
      "state": "NY",
      "country": "USA",
      "zipCode": "10001",
      "addressLine1": "123 Main Street",
      "addressLine2": "Apt 4B"
    }
  },
  "items": [
    {
      "sku": "SKU-001",
      "name": "Product Name",
      "quantity": 2,
      "price": 29.99
    },
    {
      "sku": "SKU-002",
      "name": "Another Product",
      "quantity": 1,
      "price": 49.99
    }
  ],
  "payment": {
    "method": "Credit Card",
    "status": "completed",
    "amount": 109.98
  },
  "logistics": {
    "status": "pending",
    "trackingId": "",
    "warehouse": "Warehouse A",
    "picker": ""
  },
  "orderStatus": "pending",
  "meta": {
    "notes": "Special handling required"
  }
}
```

**Response (201 Created):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "source": "Website",
  "externalOrderId": "ORD-12345",
  "customer": { ... },
  "items": [ ... ],
  "payment": { ... },
  "logistics": { ... },
  "orderStatus": "pending",
  "timestamps": {
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  "meta": { ... },
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:3000/v1/orders \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "Website",
    "externalOrderId": "ORD-12345",
    "customer": {
      "name": "John Doe",
      "email": "john@example.com",
      "phone": "+1234567890"
    },
    "items": [{
      "sku": "SKU-001",
      "name": "Product Name",
      "quantity": 2,
      "price": 29.99
    }],
    "payment": {
      "method": "Credit Card",
      "status": "completed",
      "amount": 59.98
    },
    "orderStatus": "pending"
  }'
```

---

## 2. Get All Orders

**Endpoint:** `GET /v1/orders`

**Description:** Retrieve all orders with optional filtering and pagination.

**Query Parameters:**
- `source` (optional): Filter by source (`Website`, `Amazon`, `Flipkart`, `Blinkit`)
- `orderStatus` (optional): Filter by status (`pending`, `processing`, `completed`, `cancelled`, `refunded`)
- `customer.email` (optional): Filter by customer email
- `logistics.trackingId` (optional): Filter by tracking ID
- `page` (optional): Page number (default: 1)
- `limit` (optional): Results per page (default: 10)
- `sortBy` (optional): Sort field (e.g., `createdAt:desc`)

**Example Request:**
```bash
GET /v1/orders?source=Website&orderStatus=pending&page=1&limit=20&sortBy=createdAt:desc
```

**Response (200 OK):**
```json
{
  "results": [
    {
      "id": "65f1a2b3c4d5e6f7g8h9i0j1",
      "source": "Website",
      "externalOrderId": "ORD-12345",
      "customer": { ... },
      "items": [ ... ],
      "payment": { ... },
      "logistics": { ... },
      "orderStatus": "pending",
      ...
    }
  ],
  "page": 1,
  "limit": 20,
  "totalPages": 5,
  "totalResults": 100
}
```

**cURL Example:**
```bash
curl -X GET "http://localhost:3000/v1/orders?source=Website&orderStatus=pending&page=1&limit=20" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## 3. Get Single Order

**Endpoint:** `GET /v1/orders/:orderId`

**Description:** Get a specific order by its MongoDB ID.

**Path Parameters:**
- `orderId` (required): MongoDB ObjectId of the order

**Response (200 OK):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "source": "Website",
  "externalOrderId": "ORD-12345",
  "customer": {
    "name": "John Doe",
    "phone": "+1234567890",
    "email": "john@example.com",
    "address": { ... }
  },
  "items": [ ... ],
  "payment": { ... },
  "logistics": { ... },
  "orderStatus": "pending",
  "timestamps": { ... },
  "meta": { ... }
}
```

**cURL Example:**
```bash
curl -X GET http://localhost:3000/v1/orders/65f1a2b3c4d5e6f7g8h9i0j1 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## 4. Get Order by Source + External ID

**Endpoint:** `GET /v1/orders/source/:source/:externalOrderId`

**Description:** Get an order by its source and external order ID (useful for synced orders).

**Path Parameters:**
- `source` (required): Order source (`Website`, `Amazon`, `Flipkart`, `Blinkit`)
- `externalOrderId` (required): External order ID from the source platform

**Response (200 OK):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "source": "Amazon",
  "externalOrderId": "123-4567890-1234567",
  ...
}
```

**cURL Example:**
```bash
curl -X GET http://localhost:3000/v1/orders/source/Amazon/123-4567890-1234567 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## 5. Update Order (Full/Partial)

**Endpoint:** `PATCH /v1/orders/:orderId`

**Description:** Update any field(s) of an order. Supports partial updates - only send fields you want to change.

**Path Parameters:**
- `orderId` (required): MongoDB ObjectId of the order

**Request Body (partial update example):**
```json
{
  "orderStatus": "processing",
  "customer": {
    "email": "newemail@example.com"
  },
  "payment": {
    "status": "completed"
  },
  "logistics": {
    "status": "picked",
    "warehouse": "Warehouse B"
  },
  "meta": {
    "notes": "Updated notes"
  }
}
```

**Request Body (update items):**
```json
{
  "items": [
    {
      "sku": "SKU-001",
      "name": "Updated Product Name",
      "quantity": 3,
      "price": 29.99
    }
  ]
}
```

**Response (200 OK):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "source": "Website",
  "externalOrderId": "ORD-12345",
  "orderStatus": "processing",
  ...
}
```

**cURL Example:**
```bash
curl -X PATCH http://localhost:3000/v1/orders/65f1a2b3c4d5e6f7g8h9i0j1 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "orderStatus": "processing",
    "logistics": {
      "status": "picked"
    }
  }'
```

---

## 6. Update Order Status

**Endpoint:** `PATCH /v1/orders/:orderId/status`

**Description:** Quick endpoint to update only the order status.

**Path Parameters:**
- `orderId` (required): MongoDB ObjectId of the order

**Request Body:**
```json
{
  "orderStatus": "completed"
}
```

**Valid Status Values:**
- `pending`
- `processing`
- `completed`
- `cancelled`
- `refunded`

**Response (200 OK):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "orderStatus": "completed",
  "timestamps": {
    "updatedAt": "2024-01-15T11:00:00.000Z"
  },
  ...
}
```

**cURL Example:**
```bash
curl -X PATCH http://localhost:3000/v1/orders/65f1a2b3c4d5e6f7g8h9i0j1/status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"orderStatus": "completed"}'
```

---

## 7. Update Logistics Information

**Endpoint:** `PATCH /v1/orders/:orderId/logistics`

**Description:** Update shipping/logistics information (status, tracking ID, warehouse, picker).

**Path Parameters:**
- `orderId` (required): MongoDB ObjectId of the order

**Request Body:**
```json
{
  "status": "shipped",
  "trackingId": "TRACK123456789",
  "warehouse": "Warehouse A",
  "picker": "John Smith"
}
```

**Valid Logistics Status Values:**
- `pending`
- `picked`
- `packed`
- `shipped`
- `delivered`
- `cancelled`

**Response (200 OK):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "logistics": {
    "status": "shipped",
    "trackingId": "TRACK123456789",
    "warehouse": "Warehouse A",
    "picker": "John Smith"
  },
  ...
}
```

**cURL Example:**
```bash
curl -X PATCH http://localhost:3000/v1/orders/65f1a2b3c4d5e6f7g8h9i0j1/logistics \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "shipped",
    "trackingId": "TRACK123456789"
  }'
```

---

## 8. Update Payment Status

**Endpoint:** `PATCH /v1/orders/:orderId`

**Description:** Update payment information (status, method, amount).

**Path Parameters:**
- `orderId` (required): MongoDB ObjectId of the order

**Request Body:**
```json
{
  "payment": {
    "status": "completed",
    "method": "Credit Card",
    "amount": 109.98
  }
}
```

**Valid Payment Status Values:**
- `pending`
- `completed`
- `failed`
- `refunded`

**Response (200 OK):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "payment": {
    "method": "Credit Card",
    "status": "completed",
    "amount": 109.98
  },
  ...
}
```

**cURL Example:**
```bash
curl -X PATCH http://localhost:3000/v1/orders/65f1a2b3c4d5e6f7g8h9i0j1 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "payment": {
      "status": "completed"
    }
  }'
```

---

## 9. Delete Order

**Endpoint:** `DELETE /v1/orders/:orderId`

**Description:** Delete an order permanently.

**Path Parameters:**
- `orderId` (required): MongoDB ObjectId of the order

**Response (204 No Content):**
No response body

**cURL Example:**
```bash
curl -X DELETE http://localhost:3000/v1/orders/65f1a2b3c4d5e6f7g8h9i0j1 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## 10. Sync Orders from Sources

### Sync from All Sources

**Endpoint:** `POST /v1/orders/sync`

**Description:** Sync orders from all configured sources (Website, Amazon, Flipkart, Blinkit).

**Request Body:**
```json
{
  "startDate": "2024-01-01T00:00:00.000Z",
  "endDate": "2024-01-15T23:59:59.999Z",
  "limit": 100,
  "sources": ["Website", "Amazon"]
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Orders synced from all sources",
  "data": {
    "success": true,
    "summary": {
      "totalCreated": 45,
      "totalUpdated": 12,
      "totalErrors": 0,
      "sourcesProcessed": 4
    },
    "results": [
      {
        "source": "Website",
        "totalFetched": 20,
        "created": 15,
        "updated": 5,
        "errors": 0,
        "success": true
      },
      ...
    ]
  }
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:3000/v1/orders/sync \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "startDate": "2024-01-01T00:00:00.000Z",
    "endDate": "2024-01-15T23:59:59.999Z",
    "limit": 100
  }'
```

### Sync from Specific Source

**Endpoint:** `POST /v1/orders/sync/:source`

**Description:** Sync orders from a specific source.

**Path Parameters:**
- `source` (required): Source to sync (`Website`, `Amazon`, `Flipkart`, `Blinkit`)

**Request Body:**
```json
{
  "startDate": "2024-01-01T00:00:00.000Z",
  "endDate": "2024-01-15T23:59:59.999Z",
  "limit": 50
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Orders synced from Website",
  "data": {
    "source": "Website",
    "totalFetched": 20,
    "created": 15,
    "updated": 5,
    "errors": 0,
    "success": true
  }
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:3000/v1/orders/sync/Website \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "startDate": "2024-01-01T00:00:00.000Z",
    "endDate": "2024-01-15T23:59:59.999Z"
  }'
```

---

## 11. Get Order Statistics

**Endpoint:** `GET /v1/orders/stats`

**Description:** Get aggregated statistics about orders.

**Query Parameters:**
- `source` (optional): Filter by source
- `orderStatus` (optional): Filter by status

**Response (200 OK):**
```json
[
  {
    "_id": "Website",
    "statuses": [
      {
        "status": "pending",
        "count": 15,
        "amount": 1500.00
      },
      {
        "status": "completed",
        "count": 45,
        "amount": 4500.00
      }
    ],
    "totalOrders": 60,
    "totalRevenue": 6000.00
  },
  {
    "_id": "Amazon",
    "statuses": [ ... ],
    "totalOrders": 30,
    "totalRevenue": 3000.00
  }
]
```

**cURL Example:**
```bash
curl -X GET "http://localhost:3000/v1/orders/stats?source=Website&orderStatus=completed" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## 📝 Complete API Summary

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/v1/orders` | Create order manually | ✅ manageOrders |
| GET | `/v1/orders` | Get all orders (with filters) | ✅ getOrders |
| GET | `/v1/orders/:orderId` | Get single order | ✅ getOrders |
| GET | `/v1/orders/source/:source/:externalOrderId` | Get by source + external ID | ✅ getOrders |
| PATCH | `/v1/orders/:orderId` | Update order (any field) | ✅ manageOrders |
| PATCH | `/v1/orders/:orderId/status` | Update order status only | ✅ manageOrders |
| PATCH | `/v1/orders/:orderId/logistics` | Update logistics info | ✅ manageOrders |
| DELETE | `/v1/orders/:orderId` | Delete order | ✅ manageOrders |
| POST | `/v1/orders/sync` | Sync from all sources | ✅ manageOrders |
| POST | `/v1/orders/sync/:source` | Sync from specific source | ✅ manageOrders |
| GET | `/v1/orders/stats` | Get order statistics | ✅ getOrders |

---

## 🔐 Permission Requirements

- **getOrders**: Required for all GET endpoints (view orders)
- **manageOrders**: Required for POST, PATCH, DELETE endpoints (create/edit/delete orders)

---

## ⚠️ Error Responses

### 400 Bad Request
```json
{
  "statusCode": 400,
  "message": "Validation error message",
  "error": "Bad Request"
}
```

### 401 Unauthorized
```json
{
  "statusCode": 401,
  "message": "Please authenticate",
  "error": "Unauthorized"
}
```

### 404 Not Found
```json
{
  "statusCode": 404,
  "message": "Order not found",
  "error": "Not Found"
}
```

### 500 Internal Server Error
```json
{
  "statusCode": 500,
  "message": "Internal server error",
  "error": "Internal Server Error"
}
```

---

## 📌 Quick Reference Examples

### Create Order
```bash
POST /v1/orders
```

### Get Pending Orders
```bash
GET /v1/orders?orderStatus=pending
```

### Update Status to Completed
```bash
PATCH /v1/orders/{orderId}/status
{"orderStatus": "completed"}
```

### Add Tracking Number
```bash
PATCH /v1/orders/{orderId}/logistics
{"status": "shipped", "trackingId": "TRACK123"}
```

### Update Payment Status
```bash
PATCH /v1/orders/{orderId}
{"payment": {"status": "completed"}}
```

### Delete Order
```bash
DELETE /v1/orders/{orderId}
```

