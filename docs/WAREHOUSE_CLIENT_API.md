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
| **`Store`** | Used — extra store fields (see below) |
| **`Trade`** | Cleared on save (do not send) |
| **`Departmental`** | Cleared on save |
| **`Ecom`** | Cleared on save |

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
| `search` | Matches retailerName, distributorName, parentKeyCode, gstin, contactPerson, outlet |

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

### Create

`POST /v1/whms/warehouse-clients`

**Body:** JSON object; **`type`** is required. All other fields optional.

**201** — created document (same shape as GET by id).

---

### Get by id

`GET /v1/whms/warehouse-clients/:clientId`

`:clientId` — MongoDB ObjectId.

**200** — single client. **404** if missing.

---

### Update (partial)

`PATCH /v1/whms/warehouse-clients/:clientId`

**Body:** at least one allowed field. Root fields and/or nested `storeProfile` (merged when `type` is `Store`).

**200** — updated document.

---

### Delete

`DELETE /v1/whms/warehouse-clients/:clientId`

**204** — no body.

---

## JSON shape (API / `toJSON`)

Mongoose returns `id` (string) instead of `_id`. Timestamps: `createdAt`, `updatedAt`.

### Root fields (all types)

| Field | Type | Notes |
|--------|------|--------|
| `id` | string | |
| `slNo` | number \| null | Serial / row number from imports |
| `distributorName` | string | |
| `parentKeyCode` | string | ParentKey - Code |
| `retailerName` | string | |
| `type` | string | `Store` \| `Trade` \| `Departmental` \| `Ecom` |
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
| `storeProfile` | object \| omitted | Only for **Store**; see below |
| `createdAt` | string (ISO) | |
| `updatedAt` | string (ISO) | |

### `storeProfile` (only when `type === "Store"`)

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

1. **Store form:** show base fields + full `storeProfile` section. On submit, send `type: "Store"` and `storeProfile: { ... }`.
2. **Other types:** hide `storeProfile`; if user switches from Store to Trade, backend drops `storeProfile` on save.
3. **PATCH `storeProfile`:** values are **merged** into existing `storeProfile` (shallow merge). Omit keys you do not want to change.
4. **List filters:** combine `type=Store` with `search` for outlet search UX.

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
  "retailerName": "ABC Mart",
  "parentKeyCode": "PK-1001",
  "distributorName": "Dist Co",
  "contactPerson": "Jane",
  "mobilePhone": "9876543210",
  "city": "Mumbai",
  "state": "Maharashtra",
  "gstin": "27AAAAA0000A1Z5",
  "email": "store@example.com",
  "storeProfile": {
    "billCode": "BILL-1",
    "sapCode": "SAP-99",
    "brand": "MyBrand",
    "brandSub": "SubLine",
    "openingDate": "2024-06-01T00:00:00.000Z",
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
