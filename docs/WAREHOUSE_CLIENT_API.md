# Warehouse clients API (WHMS)

Base path: **`/v1/whms/warehouse-clients`**

Authentication: JWT **`Authorization: Bearer <token>`**

| Capability | Right |
|------------|--------|
| List, get by id | `getOrders` |
| Create, update, delete | `manageOrders` |

---

## Client types (`type`)

| Value | `storeProfile` |
|--------|----------------|
| **`Store`** | **Create:** `type` + `storeProfile`; optional `status`, `remarks`, `slNo`. **PATCH:** only `storeProfile` (unless changing type). Data lives under `storeProfile`. |
| **`Trade`** | Do not send `storeProfile` |
| **`Departmental`** | Do not send `storeProfile` |
| **`Ecom`** | Do not send `storeProfile` |

---

## Endpoints

### List (paginated)

`GET /v1/whms/warehouse-clients`

**Query (all optional)**

| Param | Description |
|--------|-------------|
| `page`, `limit` | Pagination |
| `sortBy` | e.g. `createdAt:desc` |
| `type` | `Store` \| `Trade` \| `Departmental` \| `Ecom` |
| `status` | `active` \| `inactive` |
| `city` | Case-insensitive partial match |
| `state` | Case-insensitive partial match |
| `parentKeyCode` | Case-insensitive partial match |
| `search` | Matches retailerName, distributorName, parentKeyCode, gstin, contactPerson, outlet, plus `storeProfile` (brand, sapCode, billCode, retekCode, brandSub, classification) |

**Response**

```json
{
  "results": [ { /* WarehouseClient */ } ],
  "page": 1,
  "limit": 10,
  "totalPages": 1,
  "totalResults": 2
}
```

---

### List by client type (paginated)

`GET /v1/whms/warehouse-clients/by-type/:type`

**Path**

| Segment | Description |
|---------|-------------|
| `:type` | **Required.** `Store` \| `Trade` \| `Departmental` \| `Ecom` |

Returns only clients of that type. Same response shape as the general list.

**Query (all optional)** — same filters as the list endpoint, **except** `type` is not passed here (it is in the path).

| Param | Description |
|--------|-------------|
| `page`, `limit` | Pagination |
| `sortBy` | e.g. `createdAt:desc` |
| `status` | `active` \| `inactive` |
| `city` | Root or `storeProfile.city` |
| `state` | Root or `storeProfile.state` |
| `parentKeyCode` | Case-insensitive partial match (root) |
| `search` | Same multi-field search as list |

**Examples**

```http
GET /v1/whms/warehouse-clients/by-type/Store?search=brand&page=1&limit=20
Authorization: Bearer <token>
```

```http
GET /v1/whms/warehouse-clients/by-type/Trade?search=mumbai&status=active
```

For types with spaces or special characters, URL-encode the segment (e.g. `Departmental` is fine as-is).

---

### Create

`POST /v1/whms/warehouse-clients`

**Body — two shapes (discriminated by `type`):**

| `type` | Body |
|--------|------|
| **`Store`** | **`type`** + **`storeProfile`** (required). Optional root: **`status`**, **`remarks`**, **`slNo`**. Any other root key → `400`. |
| **`Trade`**, **`Departmental`**, **`Ecom`** | **`type`** required; other root fields optional; do **not** send `storeProfile`. |

**201** — created document. New Store rows have empty root string fields; data is under `storeProfile`.

---

### Get by id

`GET /v1/whms/warehouse-clients/:clientId`

`:clientId` — MongoDB ObjectId.

**200** — single client. **404** if missing.

---

### Update (partial)

`PATCH /v1/whms/warehouse-clients/:clientId`

**Body (at least one field):**

| Current `type` | Behaviour |
|----------------|-----------|
| **`Store`** | Only **`storeProfile`** is applied (shallow merge). Root fields in the body are **ignored**. To change to Trade/Departmental/Ecom, send **`type`** plus the root fields you need for that type. |
| **Not Store** | Root fields as before; optional `type` change to **`Store`** requires **`storeProfile`**. |

**200** — updated document.

---

### Delete

`DELETE /v1/whms/warehouse-clients/:clientId`

**204** — no body.

---

## JSON shape (API / `toJSON`)

Mongoose returns `id` (string) instead of `_id`. Timestamps: `createdAt`, `updatedAt`.

### When `type === "Store"` (list, get, create, update)

Responses include **only** these keys — wholesale root fields (`distributorName`, `retailerName`, `gstin`, …) are **not** sent:

| Field | Type | Notes |
|--------|------|--------|
| `id` | string | |
| `type` | `"Store"` | |
| `storeProfile` | object | See table below |
| `status` | string | `active` \| `inactive` |
| `remarks` | string | |
| `slNo` | number \| null | Optional |
| `createdAt` | string (ISO) | |
| `updatedAt` | string (ISO) | |

### When `type` is `Trade` \| `Departmental` \| `Ecom`

Full root fields as stored (no `storeProfile` in the document).

| Field | Type | Notes |
|--------|------|--------|
| `id` | string | |
| `slNo` | number \| null | Serial / row number from imports |
| `distributorName` | string | |
| `parentKeyCode` | string | ParentKey - Code |
| `retailerName` | string | |
| `type` | string | `Trade` \| `Departmental` \| `Ecom` |
| `contactPerson` | string | |
| `mobilePhone` | string | |
| `address` | string | |
| `locality` | string | |
| `city` | string | |
| `zipCode` | string | |
| `state` | string | |
| `gstin` | string | |
| `email` | string | E-Mail |
| `phone1` | string | |
| `rsm` | string | |
| `asm` | string | |
| `se` | string | |
| `dso` | string | |
| `outlet` | string | |
| `status` | string | `active` \| `inactive` |
| `remarks` | string | |
| `createdAt` | string (ISO) | |
| `updatedAt` | string (ISO) | |

### `storeProfile` (Store type only)

| Field | Type |
|--------|------|
| `billCode` | string |
| `sapCode` | string |
| `retekCode` | string |
| `classification` | string |
| `city` | string |
| `state` | string |
| `brand` | string |
| `brandSub` | string | Brand - Sub |
| `openingDate` | string (ISO) \| null |
| `address` | string |
| `gst` | string |
| `storeLandlineNo` | string |
| `smNameAndContact` | string | SM Name & Contact No. |
| `storeMailId` | string |

---

## Frontend notes

1. **Store create:** build the form from **`storeProfile`** fields only; POST `{ "type": "Store", "storeProfile": { ... } }` — no retailer/distributor root keys.
2. **Store edit:** PATCH only `{ "storeProfile": { ... } }` (merged). Do not send root fields for Store clients.
3. **Trade / Departmental / Ecom:** use root fields; omit `storeProfile`.
4. **List / search:** `city` / `state` match root **or** `storeProfile.city` / `storeProfile.state` so Store-only rows still filter correctly.

---

## TypeScript (reference)

```ts
export type WarehouseClientType = 'Store' | 'Trade' | 'Departmental' | 'Ecom';

export interface WarehouseClientStoreProfile {
  billCode?: string;
  sapCode?: string;
  retekCode?: string;
  classification?: string;
  city?: string;
  state?: string;
  brand?: string;
  brandSub?: string;
  openingDate?: string | null;
  address?: string;
  gst?: string;
  storeLandlineNo?: string;
  smNameAndContact?: string;
  storeMailId?: string;
}

/** POST body when creating a Store client */
export interface CreateWarehouseClientStore {
  type: 'Store';
  storeProfile: WarehouseClientStoreProfile;
}

/** API JSON for Store rows — no wholesale root fields */
export interface WarehouseClientStoreResponse {
  id: string;
  type: 'Store';
  storeProfile: WarehouseClientStoreProfile;
  status?: 'active' | 'inactive';
  remarks?: string;
  slNo?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Trade / Departmental / Ecom API document */
export interface WarehouseClient {
  id: string;
  slNo?: number | null;
  distributorName?: string;
  parentKeyCode?: string;
  retailerName?: string;
  type: WarehouseClientType;
  contactPerson?: string;
  mobilePhone?: string;
  address?: string;
  locality?: string;
  city?: string;
  zipCode?: string;
  state?: string;
  gstin?: string;
  email?: string;
  phone1?: string;
  rsm?: string;
  asm?: string;
  se?: string;
  dso?: string;
  outlet?: string;
  status?: 'active' | 'inactive';
  remarks?: string;
  storeProfile?: WarehouseClientStoreProfile;
  createdAt?: string;
  updatedAt?: string;
}

export interface PaginatedWarehouseClients {
  results: WarehouseClient[];
  page: number;
  limit: number;
  totalPages: number;
  totalResults: number;
}
```

---

## Example: create Store client

```http
POST /v1/whms/warehouse-clients
Content-Type: application/json
Authorization: Bearer <token>

{
  "type": "Store",
  "storeProfile": {
    "billCode": "BILL-1",
    "sapCode": "SAP-99",
    "brand": "MyBrand",
    "brandSub": "SubLine",
    "city": "Mumbai",
    "state": "Maharashtra",
    "openingDate": "2024-06-01T00:00:00.000Z",
    "address": "Plot 12, Industrial Area",
    "gst": "27AAAAA0000A1Z5",
    "storeMailId": "sm@store.com"
  }
}
```

## Example: create Trade client (no store block)

```http
POST /v1/whms/warehouse-clients
Content-Type: application/json

{
  "type": "Trade",
  "retailerName": "Wholesale Partner",
  "parentKeyCode": "TR-200",
  "gstin": "09BBBBB0000B1Z1"
}
```
