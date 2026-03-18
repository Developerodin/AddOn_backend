# Final Checking Floor — API Reference

All APIs called on the Final Checking Floor Supervisor page (`/production/floor-supervisor/final-checking`).

**Base URL:** `http://localhost:8000/v1` (from `shared/data/utilities/api.ts`)

---

## ⚠️ CRITICAL: Accept BEFORE Transfer

**Error:** `transferItems total (X) exceeds transferable (0) on Final Checking`

**Cause:** Final Checking has no received work yet (`received = 0`). Transfer requires `received > 0`.

**Fix:** User must **Accept the container** before they can transfer.

| Step | Action | API |
|------|--------|-----|
| 1 | Scan container barcode | `GET /containers-masters/barcode/:barcode` |
| 2 | **Accept Article Quantity** | `PATCH /production/articles/:id/floor-received-data` with `floor: "Final Checking"`, `quantity: container.quantity` |
| 3 | Clear container (optional) | `PATCH /containers-masters/barcode/:barcode/clear-active` |
| 4 | **Then** Transfer to Warehouse | `PATCH /production/floors/FinalChecking/orders/:oid/articles/:aid` with `transferredData` |

**Flow:** Branding transfers → work goes to containers. Final Checking must **accept** those containers (step 2) so `finalChecking.received` increases. Only after that can the user transfer.

**Frontend checklist:**
1. Branding must have transferred first (containers have `activeArticle`, `activeFloor`, `quantity`).
2. On Final Checking: scan container → **Accept** (call floor-received-data) → **then** Transfer.
3. Disable or hide Transfer button until `finalChecking.received > 0`.

---

## 1. Production Service (`/v1/production`)

### 1.1 Get Floor Orders (Load Orders)

**When:** Page load, debounced search (500ms), pagination/filter change.

**Service:** `productionService.getFloorOrders('FinalChecking', apiFilters)`

**Endpoint:** `GET /v1/production/floors/FinalChecking/orders`

**Query params:**
| Param    | Type   | Description                    |
|----------|--------|--------------------------------|
| page     | number | Page number (default 1)        |
| limit    | number | Items per page (10, 25, 50, 100) |
| status   | string | Filter: Pending, In Progress, etc. |
| priority | string | Filter: Urgent, High, etc.      |
| search   | string | Search order/article           |

**Response:** Paginated list of `ProductionOrder` with articles, floorQuantities.finalChecking, etc.

---

### 1.2 Get Article (Full Article Details)

**When:** Scan container → fetch full article for branding.transferredData pre-fill.

**Service:** `productionService.getArticle(articleId)`

**Endpoint:** `GET /v1/production/articles/:articleId`

**Response:** Full article with orderId, machineId populated, floorQuantities including branding.transferredData.

---

### 1.3 Get Article Processes

**When:** Update container modal opens → resolve next floor from process flow.

**Service:** `productionService.getArticleProcesses(articleId)`

**Endpoint:** `GET /v1/production/articles/:articleId/processes`

**Response:** `{ processes: ArticleProcess[] }` — used to determine next floor (e.g. Warehouse) after Final Checking.

---

### 1.4 Get Article Logs

**When:** View order modal → user selects article and clicks Logs.

**Service:** `productionService.getArticleLogs(articleId)`

**Endpoint:** `GET /v1/production/logs/article/:articleId`

**Query params (optional):** action, dateFrom, dateTo, floor, limit, page, sortBy.

**Response:** Paginated article logs (transfers, quality updates, etc.).

---

### 1.5 Update Quality Inspection (M1–M4)

**When:** Update order submit — when M1/M2/M3/M4 quantities change.

**Service:** `productionService.updateQualityInspection(articleId, qualityData)`

**Endpoint:** `POST /v1/production/articles/:articleId/quality-inspection`

**Body:**
```json
{
  "inspectedQuantity": number,
  "m1Quantity": number,
  "m2Quantity": number,
  "m3Quantity": number,
  "m4Quantity": number,
  "remarks": string,
  "floor": "Final Checking"
}
```

---

### 1.6 Update Article Progress (Transfer to Warehouse)

**When:** Update order submit — when transferItems (M1 good) change.

**Service:** `productionService.updateArticleProgress('FinalChecking', orderId, articleId, progressData)`

**Endpoint:** `PATCH /v1/production/floors/FinalChecking/orders/:orderId/articles/:articleId`

**Body:**
```json
{
  "remarks": string,
  "repairStatus": "Not Required" | "In Review" | "Repaired" | "Rejected",
  "repairRemarks": string,
  "transferredData": [
    { "transferred": number, "styleCode": string, "brand": string }
  ],
  "userId": string,
  "floorSupervisorId": string
}
```

**Note:** Backend calculates completed quantity from `transferredData`; do not send `completedQuantity`.

---

### 1.7 Update Article Floor Received Data (Accept Article) — **REQUIRED BEFORE TRANSFER**

**When:** Scan container → user clicks "Accept Article Quantity". **Must run before transfer.**

**Service:** `productionService.updateArticleFloorReceivedData(articleId, body)`

**Endpoint:** `PATCH /v1/production/articles/:articleId/floor-received-data`

**Body (minimal – backend auto-fills from Branding):**
```json
{
  "floor": "Final Checking",
  "quantity": 100,
  "receivedData": {
    "receivedStatusFromPreviousFloor": "Transferred from Branding",
    "receivedInContainerId": "container_id_or_null",
    "receivedTimestamp": "2025-03-16T10:00:00.000Z"
  }
}
```

- `quantity` = from `container.quantity` (GET container by barcode).
- Backend auto-populates `receivedTransferItems` from `branding.transferredData` when `quantity` is sent.
- After this call, `finalChecking.received` increases → user can then transfer.

---

## 2. Containers Master Service (`/v1/containers-masters`)

### 2.1 Get Container by Barcode

**When:** 
- Scan container drawer: user scans/enters barcode.
- Update container modal: debounced barcode check (500ms).

**Service:** `containersMasterService.getByBarcode(barcode)`

**Endpoint:** `GET /v1/containers-masters/barcode/:barcode`

**Response:** Container with activeArticle, activeFloor, quantity, etc.

---

### 2.2 Update Container by Barcode

**When:** Update container modal → "Update & submit order" button.

**Service:** `containersMasterService.updateByBarcode(barcode, body)`

**Endpoint:** `PATCH /v1/containers-masters/barcode/:barcode`

**Body:**
```json
{
  "activeArticle": string,
  "activeFloor": string,
  "quantity": number
}
```

---

### 2.3 Clear Active by Barcode

**When:** Accept Article Quantity success → clear container after transfer.

**Service:** `containersMasterService.clearActiveByBarcode(barcode)`

**Endpoint:** `PATCH /v1/containers-masters/barcode/:barcode/clear-active`

**Body:** None (empty).

---

## 3. Team Master Service (`/v1/team-masters`)

### 3.1 List Team Members

**When:** 
- Assign drawer: open drawer.
- My Team tab: load, search, refresh.

**Service:** `teamMasterService.list({ workingFloor: "Final Checking", limit: 200 })`

**Endpoint:** `GET /v1/team-masters?workingFloor=Final%20Checking&limit=200`

**Query params:** teamMemberName, workingFloor, role, status, search, sortBy, page, limit.

---

### 3.2 Get Team Member by ID

**When:** My Team tab → View active articles → fetch full member with articleData.

**Service:** `teamMasterService.getById(teamMemberId)`

**Endpoint:** `GET /v1/team-masters/:teamMemberId`

---

### 3.3 Add Active Article

**When:** Assign drawer → Confirm assign.

**Service:** `teamMasterService.addActiveArticle(teamMemberId, articleId)`

**Endpoint:** `POST /v1/team-masters/:teamMemberId/active-article`

**Body:**
```json
{
  "articleId": string
}
```

---

### 3.4 Remove Active Article

**When:** 
- Assign drawer → Article received (after accept).
- My Team tab → Article complete.

**Service:** `teamMasterService.removeActiveArticle(teamMemberId, articleId)`

**Endpoint:** `DELETE /v1/team-masters/:teamMemberId/active-article/:articleId`

---

## Flow Summary

| User Action                    | APIs Called                                                                 |
|-------------------------------|-----------------------------------------------------------------------------|
| Page load / search / filter   | `GET /production/floors/FinalChecking/orders`                              |
| Open Update Order modal       | (uses orders from state)                                                   |
| Open Update Container modal   | `GET /production/articles/:id/processes` (next floor), `GET /containers-masters/barcode/:barcode` (debounced) |
| Submit Update Order           | `POST /production/articles/:id/quality-inspection`, `PATCH /production/floors/FinalChecking/orders/:oid/articles/:aid` |
| Update & submit (container)   | `PATCH /containers-masters/barcode/:barcode` → then `handleUpdateSubmit`   |
| Scan container (accept)       | `GET /containers-masters/barcode/:barcode`, `GET /production/articles/:id`, `PATCH /production/articles/:id/floor-received-data`, `PATCH /containers-masters/barcode/:barcode/clear-active` |
| View order logs               | `GET /production/logs/article/:articleId`                                  |
| Assign drawer                 | `GET /team-masters?workingFloor=...`, `POST /team-masters/:id/active-article`, `DELETE /team-masters/:id/active-article/:aid` |
| My Team tab                   | `GET /team-masters?workingFloor=...`, `GET /team-masters/:id`, `GET /production/articles/:id` (per active article), `DELETE /team-masters/:id/active-article/:aid` |
