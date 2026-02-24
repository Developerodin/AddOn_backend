# Warehouse Management System (WHMS) — API Reference for Frontend

Use this document to wire the WHMS backend APIs in your frontend. All endpoints are under the **WHMS** module.

---

## Base URL & Auth

- **Base path:** `/v1/whms` (e.g. `https://your-api.com/v1/whms`)
- **Authentication:** Bearer JWT. Send header: `Authorization: Bearer <token>`
- **Permissions:** Read endpoints use `getOrders`; create/update/delete use `manageOrders`

---

## Response conventions

- **Success:** Body is the resource(s) or `{ results, page, limit, totalPages, totalResults }` for paginated lists.
- **Error:** `{ status: 'error', statusCode: number, message: string }`
- **204 No Content:** Used for successful DELETE (no body).

---

## 1. Orders

Base path: **`/v1/whms/orders`**

### 1.1 Create order

**`POST /v1/whms/orders`**

**Purpose:** Create a new WHMS order. Used when receiving an order from sales/website or creating a manual order. On success, the order gets `stockBlockStatus: 'tentative-block'` and `lifecycleStatus: 'order-received'` by default.

**Headers:** `Authorization: Bearer <token>` (required), `Content-Type: application/json`

---

**Request body — field reference**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| orderNumber | string | No | Auto-generated if omitted (e.g. `ORD-2024-00001`). Send only if you need a specific number. |
| channel | string | No | `online` \| `retail` \| `wholesale` \| `marketplace` \| `direct`. Default: `online`. |
| customer | object | **Yes** | See below. At least `name` is required inside. |
| customer.name | string | **Yes** | Customer full name. |
| customer.phone | string | No | |
| customer.email | string | No | Valid email if provided. |
| customer.address | object | No | Optional: street, city, state, zipCode, country, addressLine1, addressLine2. |
| items | array | **Yes** | At least **one** item. See item fields below. |
| items[].sku | string | **Yes** | Product SKU (should match Product.softwareCode or internalCode for name resolution). |
| items[].name | string | **Yes** | Display name (or resolved from Product when available). |
| items[].quantity | number | **Yes** | Integer ≥ 1. |
| items[].unitPrice | number | No | ≥ 0. |
| items[].totalPrice | number | No | ≥ 0. |
| items[].productId | string | No | Product ObjectId — used to resolve name/image from Product. |
| packingInstructions | object | No | fragile (boolean), packagingType, specialHandling, notes. |
| dispatchMode | string | No | `standard` \| `express` \| `overnight` \| `pickup`. Default: `standard`. |
| totalValue | number | No | Order total value, ≥ 0. |
| totalQuantity | number | No | Sum of item quantities, ≥ 0. |
| priority | string | No | `low` \| `medium` \| `high`. Default: `medium`. |
| estimatedDispatchDate | string | No | ISO 8601 date (e.g. `2024-12-01T00:00:00.000Z`). |

---

**Minimal request (bare minimum to create an order):**

```json
{
  "customer": {
    "name": "Customer Name"
  },
  "items": [
    {
      "sku": "SKU001",
      "name": "Product Name",
      "quantity": 1
    }
  ]
}
```

**Full request (all optional fields included):**

```json
{
  "orderNumber": "ORD-2024-00001",
  "channel": "online",
  "customer": {
    "name": "Customer Name",
    "phone": "+1234567890",
    "email": "customer@example.com",
    "address": {
      "street": "123 Main St",
      "city": "City",
      "state": "State",
      "zipCode": "12345",
      "country": "Country",
      "addressLine1": "Line 1",
      "addressLine2": "Line 2"
    }
  },
  "items": [
    {
      "sku": "SKU001",
      "name": "Product Name",
      "quantity": 2,
      "unitPrice": 100,
      "totalPrice": 200,
      "productId": "507f1f77bcf86cd799439011"
    }
  ],
  "packingInstructions": {
    "fragile": false,
    "packagingType": "box",
    "specialHandling": "",
    "notes": ""
  },
  "dispatchMode": "standard",
  "totalValue": 200,
  "totalQuantity": 2,
  "priority": "medium",
  "estimatedDispatchDate": "2024-12-01T00:00:00.000Z"
}
```

---

**Response — success `201 Created`**

Returns the created order object. Use this shape for type definitions / UI state.

```json
{
  "id": "507f1f77bcf86cd799439011",
  "orderNumber": "ORD-2024-00001",
  "date": "2024-11-15T10:00:00.000Z",
  "status": "pending",
  "channel": "online",
  "customer": {
    "name": "Customer Name",
    "phone": "+1234567890",
    "email": "customer@example.com",
    "address": {
      "street": "123 Main St",
      "city": "City",
      "state": "State",
      "zipCode": "12345",
      "country": "Country",
      "addressLine1": "Line 1",
      "addressLine2": "Line 2"
    }
  },
  "items": [
    {
      "sku": "SKU001",
      "name": "Product Name",
      "quantity": 2,
      "unitPrice": 100,
      "totalPrice": 200,
      "productId": "507f1f77bcf86cd799439011",
      "stockAvailable": null,
      "stockQuantity": null
    }
  ],
  "packingInstructions": {
    "fragile": false,
    "packagingType": "box",
    "specialHandling": "",
    "notes": ""
  },
  "dispatchMode": "standard",
  "totalValue": 200,
  "totalQuantity": 2,
  "priority": "medium",
  "estimatedDispatchDate": "2024-12-01T00:00:00.000Z",
  "actualDispatchDate": null,
  "stockBlockStatus": "tentative-block",
  "lifecycleStatus": "order-received",
  "tracking": null,
  "source": null,
  "payment": null,
  "logistics": null,
  "meta": {},
  "createdAt": "2024-11-15T10:00:00.000Z",
  "updatedAt": "2024-11-15T10:00:00.000Z"
}
```

---

**Error responses**

| Status | When | Body |
|--------|------|------|
| **400** | Validation failed (e.g. missing customer.name, empty items, quantity &lt; 1, invalid enum) | `{ status: 'error', statusCode: 400, message: '...' }` |
| **401** | Missing or invalid JWT | `{ status: 'error', statusCode: 401, message: 'Please authenticate' }` |
| **403** | User does not have `manageOrders` | `{ status: 'error', statusCode: 403, message: 'Forbidden' }` |
| **500** | Server error (e.g. DB failure) | `{ status: 'error', statusCode: 500, message: '...' }` |

**Validation rules (backend enforces):**

- `customer` is required and must have `name`.
- `items` must be a non-empty array.
- Each item: `sku`, `name`, `quantity` (integer ≥ 1) required; `unitPrice`, `totalPrice` ≥ 0 if present.
- `channel` / `dispatchMode` / `priority` must be one of the allowed enums if provided.
- `estimatedDispatchDate` must be a valid date string if provided.

---

### 1.2 List orders (paginated)

**`GET /v1/whms/orders`**

**Query parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| status | string | No | `pending` \| `in-progress` \| `packed` \| `dispatched` \| `cancelled` |
| channel | string | No | Filter by channel |
| orderNumber | string | No | Exact or partial match |
| stockBlockStatus | string | No | `available` \| `tentative-block` \| `pick-block` |
| lifecycleStatus | string | No | e.g. `order-received`, `picking-done`, `dispatched` |
| dateFrom | string (ISO date) | No | Filter orders created on or after |
| dateTo | string (ISO date) | No | Filter orders created on or before |
| sortBy | string | No | e.g. `createdAt:desc`, `orderNumber:asc` |
| limit | number | No | Page size (default 10) |
| page | number | No | Page number (default 1) |

**Response:** `200`

```json
{
  "results": [
    {
      "id": "507f1f77bcf86cd799439011",
      "orderNumber": "ORD-2024-00001",
      "date": "2024-11-15T10:00:00.000Z",
      "status": "pending",
      "channel": "online",
      "customer": { "name": "...", "phone": "...", "email": "...", "address": { ... } },
      "items": [
        {
          "sku": "SKU001",
          "name": "Product Name",
          "quantity": 2,
          "unitPrice": 100,
          "totalPrice": 200,
          "productId": "...",
          "stockAvailable": null,
          "stockQuantity": null,
          "image": "https://..."
        }
      ],
      "packingInstructions": { "fragile": false, "packagingType": "box", "specialHandling": "", "notes": "" },
      "dispatchMode": "standard",
      "totalValue": 200,
      "totalQuantity": 2,
      "priority": "medium",
      "estimatedDispatchDate": null,
      "actualDispatchDate": null,
      "stockBlockStatus": "tentative-block",
      "lifecycleStatus": "order-received",
      "tracking": null,
      "source": null,
      "payment": null,
      "logistics": null,
      "meta": {},
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "page": 1,
  "limit": 10,
  "totalPages": 5,
  "totalResults": 50
}
```

---

### 1.3 Get single order

**`GET /v1/whms/orders/:orderId`**

**Path:** `orderId` — MongoDB ObjectId of the order.

**Response:** `200` — Single order object (same shape as one item in `results` above). Items include resolved `name` and optional `image` from Product.

---

### 1.4 Update order

**`PATCH /v1/whms/orders/:orderId`**

**Path:** `orderId` — MongoDB ObjectId.

**Request body (all optional; at least one field):**

```json
{
  "status": "in-progress",
  "stockBlockStatus": "pick-block",
  "lifecycleStatus": "picking-done",
  "customer": { ... },
  "items": [ ... ],
  "packingInstructions": { ... },
  "dispatchMode": "express",
  "totalValue": 250,
  "totalQuantity": 3,
  "priority": "high",
  "estimatedDispatchDate": "2024-12-05T00:00:00.000Z"
}
```

**Response:** `200` — Updated order object.

---

### 1.5 Save tracking & mark dispatched

**`POST /v1/whms/orders/:orderId/tracking`**

**Path:** `orderId` — MongoDB ObjectId.

**Request body:**

```json
{
  "courierName": "DHL",
  "trackingNumber": "1234567890",
  "dispatchDate": "2024-11-20T14:00:00.000Z",
  "vehicleAwb": "AWB123",
  "remarks": "Left at gate"
}
```

At least one field required. Backend sets: `order.status = 'dispatched'`, `lifecycleStatus = 'dispatched'`, `stockBlockStatus = 'available'`, `actualDispatchDate = now`.

**Response:** `200` — Updated order with tracking and new status.

---

### 1.6 Delete order

**`DELETE /v1/whms/orders/:orderId`**

**Path:** `orderId` — MongoDB ObjectId.

**Response:** `204` No Content.

---

## 2. Inward (GRN)

Base path: **`/v1/whms/inward`**

### 2.1 Create GRN

**`POST /v1/whms/inward`**

**Request body:**

```json
{
  "grnNumber": "GRN-2024-0001",
  "reference": "PO-12345",
  "date": "2024-11-15T00:00:00.000Z",
  "supplier": "Supplier Name",
  "status": "pending",
  "items": [
    {
      "sku": "SKU001",
      "name": "Product Name",
      "productId": "507f1f77bcf86cd799439011",
      "orderedQty": 100,
      "receivedQty": 0,
      "acceptedQty": 0,
      "rejectedQty": 0,
      "unit": "pcs"
    }
  ],
  "totalItems": 100,
  "notes": ""
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| grnNumber | string | No | Auto-generated if omitted (e.g. GRN-2024-0001) |
| reference | string | No | e.g. PO number |
| date | string (ISO) | No | Defaults to now |
| supplier | string | No | |
| status | string | No | `pending` \| `partial` \| `received` \| `qc-pending` \| `completed` |
| items | array | Yes | Each: sku (required), name, productId, orderedQty (required), receivedQty, acceptedQty, rejectedQty, unit |
| totalItems | number | No | Can be derived from items |
| notes | string | No | |

**Response:** `201` — Created GRN with `id`, `createdAt`, `updatedAt`. Line items have `_id` for updates.

---

### 2.2 List GRNs (paginated)

**`GET /v1/whms/inward`**

**Query parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| status | string | No | `pending` \| `partial` \| `received` \| `qc-pending` \| `completed` |
| supplier | string | No | |
| reference | string | No | |
| dateFrom | string (ISO date) | No | |
| dateTo | string (ISO date) | No | |
| sortBy | string | No | |
| limit | number | No | |
| page | number | No | |

**Response:** `200` — Paginated: `{ results: InwardRecord[], page, limit, totalPages, totalResults }`. Each GRN has `id`, `grnNumber`, `reference`, `date`, `supplier`, `status`, `items[]`, `totalItems`, `notes`, `createdAt`, `updatedAt`.

---

### 2.3 Get single GRN

**`GET /v1/whms/inward/:id`**

**Path:** `id` — GRN document ObjectId.

**Response:** `200` — Single GRN with items (item names resolved from Product when available).

---

### 2.4 Update GRN

**`PATCH /v1/whms/inward/:id`**

**Path:** `id` — GRN document ObjectId.

**Request body (all optional; at least one):**

- `reference`, `date`, `supplier`, `status`, `items` (full array with receivedQty, acceptedQty, rejectedQty), `notes`

**Response:** `200` — Updated GRN.

---

## 3. Approvals

Base path: **`/v1/whms/approvals`**

### 3.1 Variance approvals

**List:** **`GET /v1/whms/approvals/variance`**

**Query:** `type` (`order` \| `grn`), `status` (`pending` \| `approved` \| `rejected`), `sortBy`, `limit`, `page`.

**Response:** `200` — Paginated list. Each item: `id`, `reference` (order/GRN id), `type`, `variance`, `requestedBy`, `date`, `status`, `createdAt`, `updatedAt`.

---

**Create:** **`POST /v1/whms/approvals/variance`**

**Body:**

```json
{
  "reference": "507f1f77bcf86cd799439011",
  "type": "order",
  "variance": "Qty +5 units",
  "requestedBy": "user@example.com"
}
```

- `reference` (ObjectId) — order id or GRN id.  
- `type` — `order` \| `grn`.  
- `variance`, `requestedBy` optional.

**Response:** `201` — Created variance approval.

---

**Update (approve/reject):** **`PATCH /v1/whms/approvals/variance/:id`**

**Path:** `id` — Variance approval document ObjectId.

**Body:** `{ "status": "approved" }` or `{ "status": "rejected" }`

**Response:** `200` — Updated approval.

---

### 3.2 Dispatch approvals

**List:** **`GET /v1/whms/approvals/dispatch`**

**Query:** `status` (`pending` \| `approved` \| `rejected`), `orderId`, `sortBy`, `limit`, `page`.

**Response:** `200` — Paginated list. Each item: `id`, `orderId` (populated), `channel`, `requestedBy`, `pendingApprover` (`sales` \| `accounts` \| `both`), `status`, `requestedAt`, `createdAt`, `updatedAt`.

---

**Create:** **`POST /v1/whms/approvals/dispatch`**

**Body:**

```json
{
  "orderId": "507f1f77bcf86cd799439011",
  "channel": "online",
  "requestedBy": "warehouse@example.com",
  "pendingApprover": "both"
}
```

- `orderId` (ObjectId) required.  
- `pendingApprover`: `sales` \| `accounts` \| `both`.

**Response:** `201` — Created dispatch approval.

---

**Update (approve/reject):** **`PATCH /v1/whms/approvals/dispatch/:id`**

**Path:** `id` — Dispatch approval document ObjectId.

**Body:** `{ "status": "approved" }` or `{ "status": "rejected" }`

**Response:** `200` — Updated approval.

---

## 4. Consolidation

Base path: **`/v1/whms/consolidation`**

### 4.1 Create batch

**`POST /v1/whms/consolidation`**

**Body:**

```json
{
  "batchCode": "BATCH-2024-0001",
  "orderIds": ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012"]
}
```

- `batchCode` optional (auto-generated if omitted).  
- `orderIds` — array of WHMS order ObjectIds.

**Response:** `201` — Created batch with `id`, `batchCode`, `orderIds`, `orderCount`, `totalItems`, `status: 'draft'`, `createdAt`, `updatedAt`.

---

### 4.2 List batches

**`GET /v1/whms/consolidation`**

**Query:** `status` (`draft` \| `ready` \| `dispatched`), `sortBy`, `limit`, `page`.

**Response:** `200` — Paginated: `{ results: ConsolidationBatch[], page, limit, totalPages, totalResults }`. Each batch has `orderIds` populated (order summaries).

---

### 4.3 Get single batch

**`GET /v1/whms/consolidation/:id`**

**Path:** `id` — Batch document ObjectId.

**Response:** `200` — Single batch with populated `orderIds`.

---

### 4.4 Update batch

**`PATCH /v1/whms/consolidation/:id`**

**Path:** `id` — Batch document ObjectId.

**Body (at least one):** `orderIds` (array of order ObjectIds), `status` (`draft` \| `ready` \| `dispatched`).

**Response:** `200` — Updated batch.

---

### 4.5 Set batch status

**`PATCH /v1/whms/consolidation/:id/status`**

**Path:** `id` — Batch document ObjectId.

**Body:** `{ "status": "ready" }` or `"dispatched"`

**Response:** `200` — Updated batch.

---

## 5. Gap report

Base path: **`/v1/whms/gap-report`**

### 5.1 Get gap report

**`GET /v1/whms/gap-report`**

**Query:** `warehouse`, `date`, `styleCode`.

**Response:** `200` — Array of rows (not paginated):

```json
[
  {
    "styleCode": "SKU001",
    "itemName": "Product A",
    "currentStock": 0,
    "ordersQty": 50,
    "requiredQty": 50,
    "shortage": 50,
    "factoryDispatchDate": null
  }
]
```

---

### 5.2 Send requirement to factory

**`POST /v1/whms/gap-report/send-requirement`**

**Body — single item:**

```json
{
  "styleCode": "SKU001",
  "itemName": "Product A",
  "shortage": 50,
  "requestedQty": 50
}
```

**Body — multiple items:**

```json
[
  {
    "styleCode": "SKU001",
    "itemName": "Product A",
    "shortage": 50,
    "requestedQty": 50
  },
  {
    "styleCode": "SKU002",
    "itemName": "Product B",
    "shortage": 30,
    "requestedQty": 30
  }
]
```

- `styleCode`, `shortage` required.  
- `itemName`, `requestedQty` optional (requestedQty defaults to shortage).

**Response:** `201` — Array of created FactoryRequirement documents.

---

## 6. Pick & Pack

Base path: **`/v1/whms/pick-pack`**

### 6.1 Pick list

**Get active pick list:** **`GET /v1/whms/pick-pack/pick-list`**

**Query:** `batchId` (optional) — if provided, returns that pick batch by id; otherwise returns the active pick list.

**Response:** `200` — Single PickList object:

- `id`, `pickBatchId`, `status` (`generated` \| `picking-in-progress` \| `picking-done`), `items[]`, `assignedTo`, `startedAt`, `completedAt`, `createdAt`, `updatedAt`
- Each **item:** `id`, `sku`, `name`, `imageUrl`, `pathIndex`, `rackLocation` (zone, row, column, bin), `requiredQty`, `pickedQty`, `unit`, `status` (`pending` \| `partial` \| `picked` \| `verified` \| `skipped`), `linkedOrderIds`, `batchId`

---

**Generate pick list:** **`POST /v1/whms/pick-pack/pick-list`**

**Body:**

```json
{
  "orderIds": ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012"],
  "batchId": "optional-consolidation-batch-ref"
}
```

- `orderIds` (array of order ObjectIds) required.  
- Backend allocates stock, creates pick list, sets orders to `stockBlockStatus: 'pick-block'`.

**Response:** `201` — Created pick list (full object with items).

---

**Update pick item:** **`PATCH /v1/whms/pick-pack/pick-list/:listId/items/:itemId`**

**Path:**  
- `listId` — PickList document ObjectId.  
- `itemId` — Pick item subdocument ObjectId.

**Body:** `{ "pickedQty": 5 }` and/or `{ "status": "picked" }` (status: `pending` \| `partial` \| `picked` \| `verified` \| `skipped`).

**Response:** `200` — Updated pick list.

---

**Confirm pick (by item):** **`PATCH /v1/whms/pick-pack/pick-list/confirm-pick`**

**Body:** `{ "itemId": "507f...", "pickedQty": 5 }`  
- `itemId` — Pick item ObjectId.  
- `pickedQty` optional (defaults to requiredQty).

**Response:** `200` — Updated pick list.

---

**Skip item:** **`POST /v1/whms/pick-pack/pick-list/skip`**

**Body:** `{ "itemId": "507f..." }`

**Response:** `200` — Updated pick list (item status = `skipped`).

---

**Scan at pick (validate SKU):** **`POST /v1/whms/pick-pack/scan/pick`**

**Body:**

```json
{
  "skuOrBarcode": "SKU001",
  "rackLocation": { "zone": "A", "row": "1", "column": "2", "bin": "B3" }
}
```

**Response:** `200`  
- If match: `{ "match": true, "item": { "id", "sku", "name", "requiredQty", "rackLocation" } }`  
- If no match: `{ "match": false, "message": "SKU not in pick list" }`

---

### 6.2 Pack list & batches

**Get pack list:** **`GET /v1/whms/pick-pack/pack-list`**

**Query:** `batchId` (optional). If provided, returns that batch; otherwise returns current active pack list as `{ batches: [ PackBatch ] }`.

**Response:** `200`  
- With `batchId`: single PackBatch.  
- Without: `{ batches: [ ... ] }` (array of batches; may be empty).

---

**Create pack batch:** **`POST /v1/whms/pick-pack/pack-list/batches`**

**Body:** `{ "orderIds": ["507f...", "507f..."] }` — WHMS order ObjectIds (e.g. after picking done).

**Response:** `201` — Created pack batch with `id`, `batchCode`, `orderIds`, `status: 'ready'`, `orders[]` (each order has `orderId`, `orderNumber`, `customerName`, `status`, `priority`, `items[]`), `cartons[]`, `createdAt`, `updatedAt`. Each pack item has `id`, `sku`, `name`, `pickedQty`, `packedQty`, `status`, `itemBarcode`.

---

**Get single pack batch:** **`GET /v1/whms/pick-pack/pack-list/batches/:batchId`**

**Path:** `batchId` — Pack batch ObjectId or batchCode string.

**Response:** `200` — Single PackBatch with populated `orders.orderId`.

---

**Update packed qty for item:** **`PATCH /v1/whms/pick-pack/pack-list/batches/:batchId/orders/:orderId/items/:itemId`**

**Path:** `batchId`, `orderId`, `itemId` — ObjectIds (orderId can be pack-order subdoc id or WhmsOrder id depending on backend).

**Body:** `{ "packedQty": 3 }` — must be ≤ pickedQty.

**Response:** `200` — Updated pack batch.

---

**Add carton:** **`POST /v1/whms/pick-pack/pack-list/batches/:batchId/cartons`**

**Path:** `batchId` — Pack batch ObjectId.

**Body:** none.

**Response:** `201` — Updated pack batch with new carton in `cartons[]` (each carton has `id`, `cartonBarcode`, `createdAt`).

---

**Update carton:** **`PATCH /v1/whms/pick-pack/pack-list/batches/:batchId/cartons/:cartonId`**

**Path:** `batchId`, `cartonId` — ObjectIds.

**Body:** `{ "cartonBarcode": "CARTON-123" }`

**Response:** `200` — Updated pack batch.

---

**Complete pack batch:** **`POST /v1/whms/pick-pack/pack-list/batches/:batchId/complete`**

**Path:** `batchId` — Pack batch ObjectId.

**Response:** `200` — Batch and its orders set to `status: 'dispatch-ready'`.

---

### 6.3 Barcode generation

**`POST /v1/whms/pick-pack/barcode/generate`**

**Body:**

```json
{
  "batchId": "507f1f77bcf86cd799439011",
  "orderId": "507f1f77bcf86cd799439012",
  "itemIds": ["507f...", "507f..."],
  "types": ["item", "carton", "order"],
  "quantity": 1
}
```

- `batchId` (ObjectId) required.  
- `orderId`, `itemIds`, `types`, `quantity` optional.  
- `types`: `item` \| `carton` \| `order`.

**Response:** `200` — `{ "generated": [ { "type", "id", "barcode" }, ... ] }`. Backend also stores item/carton barcodes on pack items and cartons.

---

### 6.4 Damage / missing report

**Create:** **`POST /v1/whms/pick-pack/reports/damage-missing`**

**Body:**

```json
{
  "orderId": "507f1f77bcf86cd799439011",
  "orderNumber": "ORD-2024-00001",
  "sku": "SKU001",
  "itemName": "Product Name",
  "type": "damage",
  "quantity": 1,
  "reason": "Broken in transit",
  "notes": ""
}
```

- `orderId`, `sku`, `type`, `quantity` required.  
- `type`: `damage` \| `missing`.  
- `itemName` optional (resolved from Product by SKU if not sent).

**Response:** `201` — Created report document (`id`, `orderId`, `orderNumber`, `sku`, `itemName`, `type`, `quantity`, `reason`, `reportedBy`, `reportedAt`, `notes`, `createdAt`, `updatedAt`).

---

**List:** **`GET /v1/whms/pick-pack/reports/damage-missing`**

**Query:** `orderId`, `dateFrom`, `dateTo`, `limit`, `page`.

**Response:** `200` — Paginated list of damage/missing reports.

---

### 6.5 Scan at pack

**`POST /v1/whms/pick-pack/scan/pack`**

**Body:**

```json
{
  "barcode": "WHMS-1234567890-ITEM-507f...",
  "batchId": "507f1f77bcf86cd799439011",
  "orderId": "507f1f77bcf86cd799439012"
}
```

- `barcode`, `batchId` required.

**Response:** `200`  
- If match: `{ "match": true, "item": { "id", "sku", "packedQty" } }` (backend may auto-increment packedQty by 1).  
- If no match: `{ "match": false }`

---

## 7. Enums summary (for frontend constants)

**Order:**  
- status: `pending` \| `in-progress` \| `packed` \| `dispatched` \| `cancelled`  
- channel: `online` \| `retail` \| `wholesale` \| `marketplace` \| `direct`  
- stockBlockStatus: `available` \| `tentative-block` \| `pick-block`  
- lifecycleStatus: `order-received` \| `picking-done` \| `ready-for-barcode` \| `ready-for-scanning` \| `scanning-done` \| `billing-done-dispatch-pending` \| `dispatched`  
- dispatchMode: `standard` \| `express` \| `overnight` \| `pickup`  
- priority: `low` \| `medium` \| `high`

**Inward (GRN):**  
- status: `pending` \| `partial` \| `received` \| `qc-pending` \| `completed`

**Variance approval:**  
- type: `order` \| `grn`  
- status: `pending` \| `approved` \| `rejected`

**Dispatch approval:**  
- pendingApprover: `sales` \| `accounts` \| `both`  
- status: `pending` \| `approved` \| `rejected`

**Consolidation batch:**  
- status: `draft` \| `ready` \| `dispatched`

**Pick list:**  
- status: `generated` \| `picking-in-progress` \| `picking-done`  
- Pick item status: `pending` \| `partial` \| `picked` \| `verified` \| `skipped`

**Pack batch / pack order:**  
- status: `ready` \| `packing` \| `packed` \| `dispatch-ready`  
- Pack item status: `pending` \| `partial` \| `packed` \| `verified` \| `damaged` \| `missing`

**Damage/missing:**  
- type: `damage` \| `missing`

---

## 8. Pagination

All paginated list endpoints return:

```ts
{
  results: T[];
  page: number;
  limit: number;
  totalPages: number;
  totalResults: number;
}
```

Use `limit` and `page` query params to request a page (e.g. `?page=2&limit=20`).

---

## 9. Error responses

- **400** — Validation error (invalid body/query/params).  
- **401** — Unauthorized (missing or invalid token).  
- **403** — Forbidden (insufficient rights).  
- **404** — Resource not found (e.g. orderId, GRN id, batch id).  
- **500** — Internal server error.

Body shape: `{ status: 'error', statusCode: number, message: string }`. In development, `stack` may be included.

Use this document as the single source of truth for implementing or wiring WHMS APIs in the frontend.
