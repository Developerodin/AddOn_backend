# Warehouse orders API (WHMS)

Base path: **`/v1/whms/warehouse-orders`**

Authentication: JWT **`Authorization: Bearer <token>`**

| Capability | Right |
|------------|--------|
| List, get by id | `getOrders` |
| Create, update, delete | `manageOrders` |

---

## Payload fields (what your modal needs)

### Header

| Field | Notes |
|------|------|
| `date` | Auto today (server defaults if you don’t send it) |
| `clientType` | Dropdown: `Store` \| `Trade` \| `Departmental` \| `Ecom` |
| `clientId` | Dropdown value should be the WarehouseClient `_id` |

### Line items (two arrays)

You asked for **both**: `styleCodeSinglePair[]` and `styleCodeMultiPair[]`.

#### `styleCodeSinglePair[]`

Each item:

| Field | Notes |
|------|------|
| `styleCodeId` | StyleCode master `_id` (ref `StyleCode`) |
| `styleCode` | string (optional; backend auto-fills from master if missing) |
| `pack` | string |
| `colour` | string |
| `type` | string |
| `pattern` | string |
| `quantity` | number \(\(\ge 1\)\) |

#### `styleCodeMultiPair[]`

Each item:

| Field | Notes |
|------|------|
| `styleCodeMultiPairId` | StyleCodePairs master `_id` (ref `StyleCodePairs`) |
| `styleCode` | string (optional; backend auto-fills from master if missing) |
| `pack` | string |
| `colour` | string |
| `type` | string |
| `pattern` | string |
| `quantity` | number \(\(\ge 1\)\) |

Server enforces: at least **one** item across both arrays.

### `status` (lifecycle)

Stored as lowercase kebab-case; map labels in the UI as you like.

| API value | Typical UI label |
|-----------|------------------|
| `draft` | Draft |
| `pending` | Pending |
| `in-progress` | In-Progress |
| `packed` | Packed |
| `dispatched` | Dispatched |
| `cancelled` | Cancelled |

**Default on create:** `pending` (if you omit `status`).

**Status-wise list:** `GET /v1/whms/warehouse-orders?status=pending` (same for any value above).

**Multiple statuses in one request:** `GET /v1/whms/warehouse-orders?statusIn=pending,in-progress` (comma-separated, no spaces required).

---

## Endpoints

### Create

`POST /v1/whms/warehouse-orders`

**Body (example)**

```json
{
  "clientType": "Store",
  "clientId": "65f000000000000000000001",
  "styleCodeSinglePair": [
    {
      "styleCodeId": "65f000000000000000000101",
      "pack": "1x",
      "colour": "Black",
      "type": "Crew",
      "pattern": "Solid",
      "quantity": 12
    }
  ],
  "styleCodeMultiPair": [
    {
      "styleCodeMultiPairId": "65f000000000000000000201",
      "pack": "3-pair",
      "colour": "Assorted",
      "type": "Ankle",
      "pattern": "Mix",
      "quantity": 4
    }
  ]
}
```

### List (paginated)

`GET /v1/whms/warehouse-orders`

**Query params (all optional)**

| Param | Type | What it does |
|------|------|--------------|
| `q` | string | Search over `orderNumber` + `clientName` (case-insensitive partial) |
| `orderNumber` | string | Prefix match (case-insensitive) |
| `status` | string | One of the lifecycle values — **filter by a single status** |
| `statusIn` | string | Comma-separated statuses, e.g. `pending,in-progress` — **filter by multiple** (use this or `status`, not both needed; `statusIn` wins if both sent) |
| `clientType` | string | `Store` \| `Trade` \| `Departmental` \| `Ecom` |
| `clientId` | ObjectId | Filter by selected client |
| `dateFrom`, `dateTo` | date | Filter by order `date` field (range) |
| `createdFrom`, `createdTo` | date | Filter by doc `createdAt` (range) |
| `styleCodeId` | ObjectId | Orders that contain this `styleCodeSinglePair[].styleCodeId` |
| `styleCodeMultiPairId` | ObjectId | Orders that contain this `styleCodeMultiPair[].styleCodeMultiPairId` |
| `page`, `limit` | number | Pagination |
| `sortBy` | string | e.g. `createdAt:desc`, `date:desc`, `orderNumber:asc` |

**Examples**

```http
GET /v1/whms/warehouse-orders?sortBy=date:desc&page=1&limit=20
Authorization: Bearer <token>
```

```http
GET /v1/whms/warehouse-orders?q=WO-2026&dateFrom=2026-03-01&dateTo=2026-03-31&sortBy=createdAt:desc
Authorization: Bearer <token>
```

```http
GET /v1/whms/warehouse-orders?clientType=Store&clientId=65f000000000000000000001&status=pending
Authorization: Bearer <token>
```

### Get by id

`GET /v1/whms/warehouse-orders/:orderId`

### Update (partial)

`PATCH /v1/whms/warehouse-orders/:orderId`

You can update: `date`, both arrays, `status`, `meta`  
You **cannot** update: `clientId`, `clientType`

### Delete

`DELETE /v1/whms/warehouse-orders/:orderId`

