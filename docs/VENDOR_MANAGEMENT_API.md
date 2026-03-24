# Vendor Management API (Frontend Integration)

All routes are mounted under **`/v1`**. Replace `<API_BASE>` with your server origin (e.g. `https://api.example.com`).

## Authentication

Every endpoint requires a JWT:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

Unauthorized responses use **`401`** with message like `Please authenticate`.

---

## Base paths

| Area | Base path |
|------|-----------|
| Vendors (VendorManagement) | `GET/POST/PATCH/DELETE` **`/v1/vendor-management`** |
| Vendor purchase orders (VPO) | **`/v1/vendor-management/purchase-orders`** |
| Vendor boxes | **`/v1/vendor-management/boxes`** |

Related docs:

- Vendor production flow frontend guide: `docs/VENDOR_PRODUCTION_FLOW_FRONTEND_API.md`

**Important:** Purchase-order and box routes are registered **before** `/:vendorManagementId`, so paths like `/purchase-orders` are not interpreted as a vendor id.

---

## 1. Vendors (`VendorManagement`)

Mongo model: `VendorManagement` (collection `vendormanagements`). JSON responses use **`id`** (string) on the root document instead of `_id` (toJSON plugin).

### 1.1 Create vendor

`POST /v1/vendor-management`  
**Status:** `201 Created`

**Body**

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `header` | object | yes | See header shape below |
| `contactPersons` | array | yes | Min 1 row; row 1 must have `contactName` + `phone` |
| `products` | string[] (ObjectIds) | no | Product ids; default `[]` |

**`header`**

| Field | Required | Notes |
|-------|----------|--------|
| `vendorCode` | yes | Uppercased |
| `vendorName` | yes | |
| `status` | yes | `active` or `inactive` (case-insensitive) |
| `city`, `state`, `notes`, `address` | no | Strings |
| `gstin` | no | Empty or valid 15-char Indian GSTIN |

**`contactPersons[]`**

| Field | Notes |
|-------|--------|
| `contactName` | Row 1 required |
| `phone` | Row 1 required; `^+?[\d\s\-()]{10,15}$` |
| `email` | Optional; valid email if present |

**Example**

```json
{
  "header": {
    "vendorCode": "VND001",
    "vendorName": "Acme",
    "status": "active",
    "city": "Mumbai",
    "state": "MH",
    "gstin": ""
  },
  "contactPersons": [
    { "contactName": "Ravi", "phone": "9876543210", "email": "ravi@example.com" }
  ],
  "products": []
}
```

**Errors:** `400` duplicate vendor code / GSTIN / validation.

---

### 1.2 List vendors (paginated)

`GET /v1/vendor-management`

**Query (all optional)**

| Param | Description |
|-------|-------------|
| `vendorName`, `vendorCode`, `status`, `city`, `state` | Filters |
| `search` | Broad search on header fields |
| `sortBy` | e.g. `createdAt:desc` (comma-separated) |
| `page`, `limit` | Pagination |
| `populate` | `products` to populate product refs |

**Response `200`**

```json
{
  "results": [ { "id": "...", "header": {}, "contactPersons": [], "products": [] } ],
  "page": 1,
  "limit": 10,
  "totalPages": 1,
  "totalResults": 0
}
```

---

### 1.3 Get vendor by id

`GET /v1/vendor-management/:vendorManagementId`

**Query:** `populate=products` (optional)

**Response `200`:** single vendor object.  
**`404`:** not found (if invalid id or missing doc).

---

### 1.4 Update vendor

`PATCH /v1/vendor-management/:vendorManagementId`

**Body:** at least one of `header`, `contactPersons`, `products`.

- `header`: partial update; if sent, **at least one** field inside `header`.
- `products`: **replaces** the full array (use `[]` to clear links).

**Response `200`:** updated document.

---

### 1.5 Delete vendor

`DELETE /v1/vendor-management/:vendorManagementId`

**Status:** `204 No Content`

---

### 1.6 Add products to vendor (merge)

`POST /v1/vendor-management/:vendorManagementId/products`

**Body:** `{ "productIds": ["<productObjectId>", "..."] }` (min 1)

**Response `200`:** vendor with **`products` populated** (selected product fields).

---

### 1.7 Remove products from vendor

`DELETE /v1/vendor-management/:vendorManagementId/products`

**Body:** `{ "productIds": ["...", "..."] }` (min 1)

**Response `200`:** vendor with **`products` populated**.

---

## 2. Vendor purchase orders (VPO)

### VPO numbering

- Server assigns **`vpoNumber`**; clients must not rely on sending their own.
- Format: **`VPO-YYYY-NNNN`** (e.g. `VPO-2026-0001`, `VPO-2026-0002`).
- Sequence is **per calendar year**; a new year starts at `VPO-2027-0001`, etc.
- Optional **`year`** on create/bulk selects which year’s series (default: current year).

### PO status enums

`vendorPurchaseOrderStatuses`:

- `submitted_to_vendor`, `in_transit`, `goods_partially_received`, `goods_received`, `qc_pending`, `po_rejected`, `po_accepted`, `po_accepted_partially`

### Lot status enums (embedded lots)

`vendorLotStatuses`:

- `lot_pending`, `lot_qc_pending`, `lot_rejected`, `lot_accepted`

---

### 2.1 Create VPO

`POST /v1/vendor-management/purchase-orders`  
**Status:** `201 Created`

**Body**

| Field | Required | Notes |
|-------|----------|--------|
| `vendor` | yes | `VendorManagement` id |
| `poItems` | yes | Min 1 line |
| `subTotal`, `gst`, `total` | yes | Numbers ≥ 0 |
| `notes` | no | |
| `goodsReceivedDate`, `estimatedOrderDeliveryDate` | no | ISO dates |
| `creditDays` | no | ≥ 0 |
| `currentStatus` | no | Enum above; default first enum |
| `statusLogs`, `receivedLotDetails`, `packListDetails` | no | See Joi / model |
| `year` | no | 2000–2100; which year’s VPO sequence |

**`poItems[]`**

| Field | Required | Notes |
|-------|----------|--------|
| `productId` | yes | Product ObjectId |
| `productName` | no | Overwritten from Product on save if empty |
| `quantity`, `rate` | yes | ≥ 0 |
| `gstRate` | no | ≥ 0 |
| `estimatedDeliveryDate` | no | |

**Response:** created PO including **`vpoNumber`**.

---

### 2.2 Bulk create VPOs

`POST /v1/vendor-management/purchase-orders/bulk`  
**Status:** `201 Created`

**Body**

```json
{
  "year": 2026,
  "orders": [
    { "vendor": "...", "poItems": [...], "subTotal": 0, "gst": 0, "total": 0 }
  ]
}
```

- **`year`** (optional): applies to all orders unless an order entry includes its own **`year`** (optional per entry).
- Each order gets the **next** `vpoNumber` in that year, **in order**.

**Response**

```json
{
  "created": [ { "...": "..." } ],
  "count": 2,
  "year": 2026
}
```

---

### 2.3 List VPOs (paginated)

`GET /v1/vendor-management/purchase-orders`

**Query (optional):** `vendor`, `vendorName`, `vpoNumber`, `currentStatus`, `search`, `sortBy`, `page`, `limit`, `populate` (string; e.g. `vendor` or `poItems.productId` or comma-separated, per paginate plugin)

**Response `200`:** paginate shape `{ results, page, limit, totalPages, totalResults }`.

---

### 2.4 Get VPO by id

`GET /v1/vendor-management/purchase-orders/:vendorPurchaseOrderId`

Populates `vendor` and `poItems.productId` (server-side).

---

### 2.5 Get VPO by number

`GET /v1/vendor-management/purchase-orders/by-number/:vpoNumber`

Example: `/by-number/VPO-2026-0001` (URL-encode if needed).

---

### 2.6 Update VPO

`PATCH /v1/vendor-management/purchase-orders/:vendorPurchaseOrderId`

At least one field in body. Optional `vpoNumber` change (must stay unique).

---

### 2.7 Delete VPO

`DELETE /v1/vendor-management/purchase-orders/:vendorPurchaseOrderId`

**Status:** `204 No Content`

**Side effect:** deletes all **`VendorBox`** documents with **`vendorPurchaseOrderId`** equal to this PO.

---

## 3. Vendor boxes

### 3.1 Create box (manual)

`POST /v1/vendor-management/boxes`  
**Status:** `201 Created`

**Body (main fields)**

| Field | Required | Notes |
|-------|----------|--------|
| `vpoNumber` | yes | |
| `vendorPurchaseOrderId` | yes | VPO id |
| `boxId` | no | Auto `VBOX-<timestamp>` if omitted |
| `vendor`, `vendorPoItemId`, `productId`, `productName`, `lotNumber` | no | `productName` filled from Product if `productId` set |
| `receivedDate`, `orderDate` | no | |
| `orderQty`, `boxWeight`, `grossWeight`, `numberOfUnits`, `tearweight` | no | |
| `barcode` | no | Auto from document id on save if omitted |
| `qcData`, `storageLocation`, `storedStatus` | no | |

---

### 3.2 Bulk create boxes (by VPO + lots)

`POST /v1/vendor-management/boxes/bulk`  
**Status:** `201 Created`

**Body**

```json
{
  "vpoNumber": "VPO-2026-0001",
  "lotDetails": [
    {
      "lotNumber": "L1",
      "numberOfBoxes": 3,
      "productId": "<optional>",
      "vendorPoItemId": "<optional po line item _id>"
    }
  ]
}
```

**Resolution rules**

- If **`lotNumber`** already has boxes for this **`vpoNumber`**, that lot is **skipped** (see `skippedLots` in response).
- Product is resolved from **`productId`**, or from **`vendorPoItemId`** (line item on the PO), or if the PO has **exactly one** line item, that product is used.

**Response**

```json
{
  "createdCount": 3,
  "boxes": [ ],
  "skippedLots": []
}
```

---

### 3.3 List boxes (paginated)

`GET /v1/vendor-management/boxes`

**Query (optional):** `vpoNumber`, `vendorPurchaseOrderId`, `vendor`, `productName`, `lotNumber`, `storedStatus` (boolean or `"true"`/`"false"`), `search`, `sortBy`, `page`, `limit`, `populate` (`productId` only)

---

### 3.4 Get box by id

`GET /v1/vendor-management/boxes/:vendorBoxId`

Populates `productId`, `vendor`, `vendorPurchaseOrderId` (selected fields).

---

### 3.5 Update box

`PATCH /v1/vendor-management/boxes/:vendorBoxId`

At least one field in body.

---

### 3.6 Delete box

`DELETE /v1/vendor-management/boxes/:vendorBoxId`

**Status:** `204 No Content`

---

## Error responses

| Status | Typical cause |
|--------|----------------|
| `400` | Joi validation failed (message often lists joined errors) or business rule (duplicate code, invalid product id) |
| `401` | Missing/invalid JWT |
| `403` | Insufficient rights (if rights are enforced on `auth`) |
| `404` | Resource not found |

---

## Frontend checklist

1. Store **`Authorization: Bearer <token>`** on every call.
2. Use **`id`** (string) for Mongo document ids in JSON responses where the toJSON plugin applies.
3. **`vpoNumber`** is authoritative from the server; never assume client-side numbering.
4. For vendor **products**, use **`GET ...?populate=products`** when you need product details in lists/detail.
5. **Delete VPO** removes dependent **boxes**; confirm in UI before delete.

---

## Source files (backend reference)

- Routes: `src/routes/v1/vendorManagement.route.js`, `vendorManagementPo.route.js`, `vendorManagementBox.route.js`
- Validations: `src/validations/vendorManagement.validation.js`, `vendorPurchaseOrder.validation.js`, `vendorBox.validation.js`
- Models: `src/models/vendorManagement/*.model.js`
