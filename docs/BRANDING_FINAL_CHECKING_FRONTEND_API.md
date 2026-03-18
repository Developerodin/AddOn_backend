# Branding & Final Checking – Frontend API Guide

## Overview

This doc describes how to integrate Branding and Final Checking floors with the backend API: what to send, when, and how data flows.

---

## 1. Branding Floor

### 1.1 Transfer to Final Checking (PATCH)

**Endpoint:** `PATCH /v1/production/floors/Branding/orders/:orderId/articles/:articleId`

**When:** User completes work and transfers to Final Checking (full or partial).

**Request body (minimal):**
```json
{
  "userId": "string (required)",
  "floorSupervisorId": "string (required)",
  "transferredData": [
    { "transferred": 20, "styleCode": "ABC1SALBA04049", "brand": "Allen Solly" }
  ]
}
```

**Request body (with optional fields):**
```json
{
  "userId": "string (required)",
  "floorSupervisorId": "string (required)",
  "remarks": "optional",
  "brandingType": "Heat Transfer",
  "transferredData": [
    { "transferred": 20, "styleCode": "ABC1SALBA04049", "brand": "Allen Solly" },
    { "transferred": 80, "styleCode": "ABC1SALBA04049", "brand": "Allen Solly" }
  ]
}
```

**Notes:**
- `completedQuantity` is **optional**. Backend infers from `transferredData` sum when possible.
- Use `transferredData` (or `transferItems` – both accepted).
- Each partial transfer **appends** to `branding.transferredData` (does not replace).
- If second transfer omits `styleCode`/`brand`, backend enriches from the first transfer.

**Partial transfer example (20 then 80):**
1. First PATCH: `transferredData: [{ transferred: 20, styleCode: "X", brand: "Y" }]`
2. Second PATCH: `transferredData: [{ transferred: 80 }]` – styleCode/brand auto-filled from first

---

## 2. Final Checking Floor

### 2.1 Prerequisite: Receive from Branding

**Container flow:** Branding transfers go to containers. Final Checking must **accept containers** (scan barcode) before it has `received` quantity.

**API:** `POST /v1/containers-masters/barcode/:barcode/accept`

Until containers are accepted, `finalChecking.received = 0` and transfer will fail with:
> "transferItems total (X) exceeds transferable (0). Final Checking has no received work yet. Accept containers from Branding first."

### 2.2 Transfer to Warehouse (PATCH)

**Endpoint:** `PATCH /v1/production/floors/FinalChecking/orders/:orderId/articles/:articleId`

**When:** User completes quality check and transfers to Warehouse.

**Request body (minimal):**
```json
{
  "userId": "string (required)",
  "floorSupervisorId": "string (required)",
  "repairStatus": "Not Required",
  "repairRemarks": "",
  "transferredData": [
    { "transferred": 70, "styleCode": "ABC1SALBA04049", "brand": "Allen Solly" }
  ]
}
```

**Notes:**
- `completedQuantity` is **optional**. Backend infers from `transferredData` sum.
- If `styleCode`/`brand` omitted, backend enriches from `receivedData` (from Branding).
- Partial transfers **append** to `finalChecking.transferredData`.

**Transfer all remaining:**
- Send `transferredData` with sum = `remaining` (or `received - transferred`).
- Example: remaining=30 → `transferredData: [{ transferred: 30, styleCode: "X", brand: "Y" }]`
- **Always send `transferredData`** when transferring – otherwise `finalChecking.transferredData` stays empty.

---

## 3. Response Fields

### Branding
```json
{
  "floorQuantities": {
    "branding": {
      "received": 100,
      "completed": 100,
      "remaining": 0,
      "transferred": 100,
      "transferredData": [
        { "transferred": 20, "styleCode": "ABC1SALBA04049", "brand": "Allen Solly" },
        { "transferred": 80, "styleCode": "ABC1SALBA04049", "brand": "Allen Solly" }
      ]
    }
  }
}
```

### Final Checking
```json
{
  "floorQuantities": {
    "finalChecking": {
      "received": 100,
      "completed": 70,
      "remaining": 30,
      "transferred": 70,
      "transferredData": [
        { "transferred": 70, "styleCode": "ABC1SALBA04049", "brand": "Allen Solly" }
      ],
      "receivedData": [
        { "transferred": 20, "styleCode": "ABC1SALBA04049", "brand": "Allen Solly", ... },
        { "transferred": 80, "styleCode": "ABC1SALBA04049", "brand": "Allen Solly", ... }
      ]
    }
  }
}
```

**Field meanings:**
- `remaining` = work not yet transferred (`received - transferred` for non-Checking; for Checking: `received - m1Transferred - m2 - m3 - m4`)
- `transferred` = cumulative total transferred
- `transferredData` = breakdown by batch (styleCode/brand)

---

## 4. Flow Summary

| Step | Floor | Action | API |
|------|-------|--------|-----|
| 1 | Branding | Transfer 20 | PATCH with `transferredData: [{ transferred: 20, styleCode, brand }]` |
| 2 | Branding | Transfer 80 | PATCH with `transferredData: [{ transferred: 80 }]` (enriched) |
| 3 | Final Checking | Accept containers | POST `/containers-masters/barcode/:barcode/accept` |
| 4 | Final Checking | Transfer to Warehouse | PATCH with `transferredData: [{ transferred: X, ... }]` |
| 5 | Warehouse | Accept containers | POST `/containers-masters/barcode/:barcode/accept` (warehouse.received updates on accept) |

---

## 5. Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `transferItems total (X) exceeds transferable (0)` | Final Checking has no received work | Accept containers from Branding first |
| `Invalid completed quantity: must be between 0 and received (Y)` | Sum of transferredData > received | Send smaller quantity or ensure receive first |
| `transferItems total (X) exceeds transferable (Y)` | Transfer quantity > (completed - transferred) | Send `completedQuantity` or reduce transferredData sum |

---

## 6. Test Scripts

```bash
# Full flow: Branding 20+80 → Final Checking receive + transfer 100
API_URL=http://localhost:8000 TEST_EMAIL=admin@addon.in TEST_PASSWORD=admin@1234 npm run test:full-flow-20-80

# Partial transfer only (Branding 30+70)
npm run test:partial-transfer

# Full production flow
npm run test:production-flow
```
