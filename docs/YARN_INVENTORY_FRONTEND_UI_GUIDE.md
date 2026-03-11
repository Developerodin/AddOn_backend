# Yarn Inventory Frontend UI Guide

Complete guide for building the frontend to display yarn inventory APIs data to users.

---

## Table of Contents

1. [API Overview](#api-overview)
2. [UI Layout Overview](#ui-layout-overview)
3. [Screen-by-Screen Breakdown](#screen-by-screen-breakdown)
4. [Data Structures & Display](#data-structures--display)
5. [Component Recommendations](#component-recommendations)
6. [Sample API Calls](#sample-api-calls)

---

## API Overview

| API | Endpoint | Purpose |
|-----|----------|---------|
| **List Inventories** | `GET /v1/yarn-management/yarn-inventories` | All yarn stock with LT/ST breakdown |
| **Inventory by ID** | `GET /v1/yarn-management/yarn-inventories/:inventoryId` | Single inventory detail |
| **Inventory by Yarn** | `GET /v1/yarn-management/yarn-inventories/yarn/:yarnId` | Inventory for a specific yarn |
| **List Requisitions** | `GET /v1/yarn-management/yarn-requisitions?startDate=&endDate=&poSent=` | Pending/fulfilled requisitions |

**Query params for inventories:**
- `yarn_id` – filter by yarn catalog ID
- `yarn_name` – search by yarn name (partial)
- `inventory_status` – `in_stock` \| `low_stock` \| `soon_to_be_low`
- `overbooked` – `true` \| `false`
- `sortBy` – e.g. `yarnName:asc`, `createdAt:desc`
- `page` – pagination

---

## UI Layout Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  YARN MANAGEMENT                                                             │
├─────────────┬───────────────────────────────────────────────────────────────┤
│             │                                                               │
│  Sidebar    │   Main Content Area                                            │
│             │                                                               │
│  • Dashboard│   ┌─────────────────────────────────────────────────────┐   │
│  • Inventory│   │  Summary Cards (LT total, ST total, Low stock count)  │   │
│  • Requisit.│   └─────────────────────────────────────────────────────┘   │
│  • Boxes    │                                                               │
│  • Cones    │   ┌─────────────────────────────────────────────────────┐   │
│  • POs      │   │  Filters: [Status ▼] [Search yarn...] [Overbooked]  │   │
│             │   └─────────────────────────────────────────────────────┘   │
│             │                                                               │
│             │   ┌─────────────────────────────────────────────────────┐   │
│             │   │  Data Table / Cards                                   │   │
│             │   │  Yarn Name | LT (kg) | ST (kg) | Cones | Status | ... │   │
│             │   └─────────────────────────────────────────────────────┘   │
│             │                                                               │
└─────────────┴───────────────────────────────────────────────────────────────┘
```

---

## Screen-by-Screen Breakdown

### 1. Yarn Inventory List Page

**Route:** `/yarn-management/inventory` (or similar)

**API:** `GET /v1/yarn-management/yarn-inventories`

**Layout:**
```
┌────────────────────────────────────────────────────────────────────────────┐
│  Yarn Inventory                                              [Refresh] [Export] │
├────────────────────────────────────────────────────────────────────────────┤
│  Filters:                                                                  │
│  [Search yarn name...]  [Status: All ▼]  [Overbooked: All ▼]  [Apply]       │
├────────────────────────────────────────────────────────────────────────────┤
│  Summary:                                                                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐      │
│  │ LT Total     │ │ ST Total     │ │ Low Stock    │ │ In Stock     │      │
│  │ 4,096 kg     │ │ 412 kg      │ │ 8 yarns      │ │ 6 yarns      │      │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘      │
├────────────────────────────────────────────────────────────────────────────┤
│  Yarn Name              │ LT Net(kg) │ ST Net(kg) │ Cones │ Status    │ ... │
│  ─────────────────────────────────────────────────────────────────────────  │
│  20/40-Beige-Beige...   │ 0.00      │ 4096.53    │ 6     │ in_stock  │     │
│  2/60s-Ecru-Kora...     │ 0.00      │ 18.00     │ 2     │ in_stock  │     │
│  70/1-Beige-Beige...    │ 0.00      │ 0.00      │ 1     │ low_stock │     │
│  ...                    │           │           │       │           │     │
└────────────────────────────────────────────────────────────────────────────┘
```

**Columns to show:**
| Column | Source | Notes |
|--------|--------|-------|
| Yarn Name | `yarnName` | Truncate if long, tooltip full name |
| LT Net (kg) | `longTermStorage.netWeight` | Long-term = boxes only |
| LT Total (kg) | `longTermStorage.totalWeight` | Optional |
| ST Net (kg) | `shortTermStorage.netWeight` | Short-term = cones (after blocked) |
| ST Total (kg) | `shortTermStorage.totalWeight` | Optional |
| Cones | `shortTermStorage.numberOfCones` | LT always 0 |
| Status | `inventoryStatus` | Badge: green/yellow/red |
| Overbooked | `overbooked` | Badge if true |

---

### 2. Yarn Inventory Detail (Single Yarn)

**Route:** `/yarn-management/inventory/:yarnId` or modal/drawer

**API:** `GET /v1/yarn-management/yarn-inventories/yarn/:yarnId`

**Layout:**
```
┌────────────────────────────────────────────────────────────────────────────┐
│  20/40-Beige-Beige-Nylon/Spandex                              [Edit] [Back] │
├────────────────────────────────────────────────────────────────────────────┤
│  Long-Term Storage (Boxes)                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Total Weight: 0 kg    Net Weight: 0 kg    Boxes: 0                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Short-Term Storage (Cones)                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Total Weight: 4097 kg   Net Weight: 4096.53 kg   Cones: 6           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Status: [in_stock]   Overbooked: No                                         │
└────────────────────────────────────────────────────────────────────────────┘
```

---

### 3. Yarn Requisitions Page

**Route:** `/yarn-management/requisitions`

**API:** `GET /v1/yarn-management/yarn-requisitions?startDate=...&endDate=...&poSent=false`

**Layout:**
```
┌────────────────────────────────────────────────────────────────────────────┐
│  Yarn Requisitions                                                          │
├────────────────────────────────────────────────────────────────────────────┤
│  Date Range: [2025-12-10] to [2026-03-10]   PO Sent: [All ▼]  [Apply]      │
├────────────────────────────────────────────────────────────────────────────┤
│  Yarn Name              │ Min Qty │ Available │ Blocked │ Alert      │ PO  │
│  ─────────────────────────────────────────────────────────────────────────  │
│  70/1-Beige-Beige...    │ 70      │ 0         │ 0       │ below_min  │ No  │
│  20/40-Black-Black...   │ 100     │ 0         │ 0       │ below_min  │ No  │
│  20/40-Beige-Beige...   │ 70      │ 4096.53   │ 0       │ —          │ No  │
└────────────────────────────────────────────────────────────────────────────┘
```

**Columns:**
| Column | Source |
|--------|--------|
| Yarn Name | `yarnName` or `yarn.yarnName` |
| Min Qty | `minQty` |
| Available | `availableQty` |
| Blocked | `blockedQty` |
| Alert | `alertStatus` → badge (below_minimum / overbooked / —) |
| PO Sent | `poSent` → Yes/No |

---

## Data Structures & Display

### Inventory Item (from list API)

```json
{
  "yarn": "692e7cbcabe3fbc58a86e4bb",
  "yarnId": "692e7cbcabe3fbc58a86e4bb",
  "yarnName": "20/40-Beige-Beige-Nylon/Spandex",
  "longTermStorage": {
    "totalWeight": 0,
    "netWeight": 0,
    "numberOfCones": 0
  },
  "shortTermStorage": {
    "totalWeight": 4097.005,
    "netWeight": 4096.53,
    "numberOfCones": 6
  },
  "inventoryStatus": "in_stock",
  "overbooked": false
}
```

**Display mapping:**
- `inventoryStatus` → Badge: `in_stock` (green), `low_stock` (red), `soon_to_be_low` (yellow)
- `numberOfCones` in LT is always 0 (boxes, not cones)
- `shortTermStorage.netWeight` = available net (already excludes blocked)

### Paginated Response

```json
{
  "results": [ /* inventory items */ ],
  "page": 1,
  "limit": 100000,
  "totalPages": 1,
  "totalResults": 16
}
```

Use `totalResults` for “Showing X of Y” and `totalPages` for pagination.

### Requisition Item

```json
{
  "_id": "69b000477683104564af5acb",
  "yarnName": "70/1-Beige-Beige-Nylon/Nylon",
  "yarn": { "_id": "...", "yarnName": "...", "yarnType": { "name": "Nylon" } },
  "minQty": 70,
  "availableQty": 0,
  "blockedQty": 0,
  "alertStatus": "below_minimum",
  "poSent": false
}
```

---

## Component Recommendations

### 1. Inventory Table Component

```jsx
// Props: data (results array), loading, onRowClick
<InventoryTable
  data={inventories.results}
  loading={loading}
  onRowClick={(row) => navigate(`/inventory/${row.yarnId}`)}
  columns={['yarnName', 'longTermStorage.netWeight', 'shortTermStorage.netWeight', 
            'shortTermStorage.numberOfCones', 'inventoryStatus']}
/>
```

### 2. Status Badge

```jsx
const statusConfig = {
  in_stock: { color: 'green', label: 'In Stock' },
  low_stock: { color: 'red', label: 'Low Stock' },
  soon_to_be_low: { color: 'amber', label: 'Soon Low' },
};
<Badge color={statusConfig[item.inventoryStatus]?.color}>
  {statusConfig[item.inventoryStatus]?.label}
</Badge>
```

### 3. Summary Cards

Compute from `results`:
- LT total: `sum(longTermStorage.netWeight)`
- ST total: `sum(shortTermStorage.netWeight)`
- Low stock count: `filter(inventoryStatus === 'low_stock').length`
- In stock count: `filter(inventoryStatus === 'in_stock').length`

### 4. Filters Bar

- Search: `yarn_name` query param
- Status: `inventory_status` (in_stock, low_stock, soon_to_be_low)
- Overbooked: `overbooked` (true/false)

---

## Sample API Calls

### Fetch all inventories (no limit = full list)

```javascript
const res = await fetch(
  `${API_BASE}/v1/yarn-management/yarn-inventories?page=1`,
  { headers: { Authorization: `Bearer ${token}` } }
);
const { results, totalResults, totalPages } = await res.json();
```

### Filter low stock only

```javascript
fetch(`${API_BASE}/v1/yarn-management/yarn-inventories?inventory_status=low_stock`);
```

### Search by yarn name

```javascript
fetch(`${API_BASE}/v1/yarn-management/yarn-inventories?yarn_name=Beige`);
```

### Fetch requisitions (last 3 months, PO not sent)

```javascript
const start = new Date();
start.setMonth(start.getMonth() - 3);
const end = new Date();
fetch(
  `${API_BASE}/v1/yarn-management/yarn-requisitions?` +
  `startDate=${start.toISOString()}&endDate=${end.toISOString()}&poSent=false`
);
```

### Fetch single yarn inventory

```javascript
fetch(`${API_BASE}/v1/yarn-management/yarn-inventories/yarn/${yarnId}`);
```

---

## Quick Reference: What Each Storage Means

| Storage | Source | Meaning |
|---------|--------|---------|
| **Long-Term (LT)** | Boxes in LT slots | Unopened boxes, weight in kg |
| **Short-Term (ST)** | Cones + unopened boxes in ST | Cones ready for use; `netWeight` excludes blocked |
| **numberOfCones** | LT = 0, ST = cone count | LT has boxes only |
| **inventoryStatus** | Computed from min qty | in_stock / low_stock / soon_to_be_low |
| **overbooked** | Blocked > available | true when over-committed |

---

## Navigation Flow Suggestion

```
Yarn Management
├── Dashboard (summary of inventory + requisitions)
├── Inventory
│   ├── List (all inventories)
│   └── Detail (by yarnId)
├── Requisitions
│   └── List (filter by date, poSent)
├── Boxes (yarn-boxes API)
├── Cones (yarn-cones API)
└── Purchase Orders (yarn-purchase-orders API)
```
