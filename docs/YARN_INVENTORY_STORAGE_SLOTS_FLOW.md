# Yarn Inventory & Storage Slots – How It Works

## Overview

Inventory is calculated from **actual physical storage** (boxes and cones), not from a separate inventory table. Storage slots (LT/ST) define where boxes can be placed. Changing slot layout in `seed-storage-slots.js` **can** affect inventory if the matching logic is not aligned.

---

## 1. Storage Slots (seed-storage-slots.js)

**What it does:** Creates `StorageSlot` documents – physical rack/shelf positions.

| Zone | Section Codes | Label Format | Example |
|------|---------------|--------------|---------|
| **ST** (Short-term) | B7-01 | `B7-01-S0001-F01` | 50 shelves × 4 floors = 200 slots |
| **LT** (Long-term) | B7-02, B7-03, B7-04, B7-05 | `B7-02-S0001-F01` | 4 sections × 12 shelves × 4 floors = 192 slots |

**Key:** `label` and `barcode` are the same (e.g. `B7-01-S0001-F01`). When a box is assigned to a slot, `YarnBox.storageLocation = slot.barcode`.

---

## 2. How Boxes Get storageLocation

Two paths:

1. **bulkAssignBoxesToSlots** (storage slot service)  
   - User assigns box barcode to rack barcode  
   - Sets `box.storageLocation = slot.barcode` (e.g. `B7-02-S0001-F01`)

2. **yarnBoxTransfer.transferBoxes** (legacy?)  
   - Expects `toStorageLocation` starting with `LT-` or `ST-` (e.g. `LT-S001-F1`)

---

## 3. Inventory Calculation Logic

**Source:** `yarnInventory.service.js`, `report-yarn-inventory.js`

| Storage | Source | Query |
|---------|--------|-------|
| **Long-term (LT)** | Boxes in LT slots | `YarnBox` where `storageLocation` matches LT pattern |
| **Short-term (ST)** | Cones in ST + unopened boxes in ST | Cones: `coneStorageId` set, not issued. Boxes: `storageLocation` matches ST pattern |

**Current query pattern:**
```javascript
// LT boxes
storageLocation: { $regex: /^LT-/i }

// ST boxes  
storageLocation: { $regex: /^ST-/i }
```

---

## 4. The Mismatch (Bug)

| Storage slots use | Inventory expects |
|-------------------|-------------------|
| `B7-01-S0001-F01` (ST) | `ST-*` |
| `B7-02-S0001-F01` (LT) | `LT-*` |

Boxes assigned via `bulkAssignBoxesToSlots` get `storageLocation = "B7-02-S0001-F01"`, which does **not** match `/^LT-/`. So those boxes are **excluded** from inventory.

**Result:** Inventory shows 0 for LT/ST if boxes use B7-xx slot barcodes.

---

## 5. Correct Matching (Fix) – Applied

Use section prefix; support both legacy and new formats:

| Zone | Matches |
|------|---------|
| LT | `LT-*` (legacy) OR `B7-02-*`, `B7-03-*`, `B7-04-*`, `B7-05-*` |
| ST | `ST-*` (legacy) OR `B7-01-*` |

**Updated files:**
- `yarnInventory.service.js` – `LT_STORAGE_REGEX`, `ST_STORAGE_REGEX`
- `yarnBox.model.js` – post-save hook `LT_STORAGE_PATTERN`
- `yarnBox.service.js` – QC sync `LT_STORAGE_PATTERN`
- `report-yarn-inventory.js` – `LT_REGEX`, `ST_REGEX`

---

## 6. Cones (Short-term)

Cones use `coneStorageId` (slot barcode where the cone sits). Same barcodes: `B7-01-S0001-F01`, etc. Inventory matches cones by `yarn` and `coneStorageId` presence – no LT/ST regex on cones. Cones are always short-term.

---

## 7. Summary: Does Changing Slots Affect Inventory?

| Change | Effect |
|--------|--------|
| Add/remove shelves in seed | No – only creates new slots |
| Change section codes (B7-01, B7-02…) | **Yes** – inventory regex must match new codes |
| Change label format | **Yes** – `storageLocation` format changes |

**Rule:** If you change `ST_SECTION_CODE` or `LT_SECTION_CODES` in `storageSlot.model.js`, update the inventory regex in `yarnInventory.service.js` and `report-yarn-inventory.js` to match.
