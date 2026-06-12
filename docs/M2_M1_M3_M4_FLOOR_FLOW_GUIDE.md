# M1 / M2 / M3 / M4 Floor Flow Guide

How quality buckets move across **Checking → Secondary Checking → Final Checking → Dispatch**, including **M2 Management** actions (merge, M3, M4) and **brand-wise merge** on Final Checking.

---

## Core rule (every QC floor)

Applies to **Checking**, **Secondary Checking**, and **Final Checking**:

```
REM = RCV − M1Trf − M2 − M3 − M4
```

| Field | Meaning |
|-------|---------|
| **RCV** | Units arrived on this floor (container accept / upstream transfer) |
| **M1** | Good quality count (total good classified) |
| **M1Trf** | Good already **sent out** from this floor (normal M1 transfer **or** M2→M1 merge) |
| **M2** | Repairable — on floor + tracked in **M2 Management ledger** |
| **M3 / M4** | Defect buckets — stay on floor only, **no cascade** |
| **REM** | What is still on the floor (not yet transferred / defected-out) |

**Important:** `M1Trf ≠ M1`. You can have M1 = 1000 but M1Trf = 0 until good is transferred out, or until M2 is merged to M1 (merge also bumps M1Trf).

---

## Typical process flow

```mermaid
flowchart LR
  Linking --> Checking
  Checking --> Washing
  Washing --> Boarding
  Boarding --> SecondaryChecking
  SecondaryChecking --> Branding
  Branding --> FinalChecking
  FinalChecking --> Dispatch
```

- **Normal M1** = good path, floor-by-floor via containers/transfers
- **M2 merge** = repair finished → treated as good already transferred; cascades forward in one shot

---

## What each M2 action does

### 1) M2 created (QC floor save)

When operator increases **M2** on Checking / Secondary / Final save:

- Floor **M2 += X**
- **M2 Management** opens a ledger entry (source = that floor)
- **REM -= X**
- Nothing moves downstream yet

### 2) M2 → M3 or M2 → M4 (M2 Management)

- **Source floor only** — no cascade
- M2 −= qty, M3 or M4 += qty on same floor
- Ledger entry reduced or closed
- REM unchanged (still a defect; just reclassified M2 → M3/M4)

### 3) M2 → M1 merge (M2 Management)

Cascade runs **source floor → … → Dispatch** (every floor in process order from source through Dispatch).

#### On source QC floor (where M2 was born)

```
M2         −= merge qty
M1         += merge qty
M1Trf      += merge qty
transferred += merge qty
completed  += merge qty
```

#### On downstream QC floors (Secondary / Final — if they already have activity)

```
M1, M1Trf, transferred += merge qty
(M2 unchanged, RCV unchanged)
```

#### On operational floors (Washing, Branding, etc. — if active)

```
RCV, completed += merge qty
transferred += merge qty (if floor already transferring)
```

#### On Dispatch

```
RCV += merge qty only
(no transferred bump on merge cascade)
```

#### On Final Checking (branded article)

- Same scalar bumps as above
- **Plus** `transferredData` brand lines (operator picks brand, e.g. Allen Solly / Van Heusen)

---

## Quick reference — where qty moves

| Action | Which floors change | Dispatch impact |
|--------|---------------------|-----------------|
| **M1 transfer** (normal) | Next floor RCV on container accept; step-by-step | Only when Final Checking → Dispatch transfer happens |
| **M2 → M3 / M4** | Source QC only | **None** |
| **M2 → M1 merge** | Source → all downstream through Dispatch | **RCV += merge qty** on Dispatch |
| **M3 / M4 direct entry** (QC save) | That QC floor only | **None** |

---

## Worked example — 1020 received at Checking

**Assumed process:** Linking → Checking → Washing → Boarding → Secondary → Branding → Final Checking → Dispatch  

**Brands at Final Checking (from Branding):** Allen Solly 400 RCV, Van Heusen 620 RCV  

---

### Step 0 — Checking classifies 1020

| Field | Qty |
|-------|-----|
| RCV | 1020 |
| M1 (good) | 990 |
| M2 (repair) | 25 |
| M3 | 3 |
| M4 | 2 |

```
REM = 1020 − 0 − 25 − 3 − 2 = 990   (M1 not transferred yet)
```

**M2 Management:** 1 open entry, **25 qty**, source = **Checking**

---

### Step 1 — Transfer good M1 out (990)

Checking after transfer:

| Field | Qty |
|-------|-----|
| M1 | 990 |
| M1Trf | 990 |
| M2 | 25 |
| M3 | 3 |
| M4 | 2 |
| **REM** | **0** |

990 flows operationally: Checking → Washing → … → Branding → Final Checking → Dispatch (when FC→Dispatch transfer is done).

Assume all 990 eventually lands at Dispatch via the normal good path:

- **Dispatch RCV from good path = 990**

---

### Step 2 — M2 actions in M2 Management (source = Checking)

| Action | Qty | Checking after | M2 ledger |
|--------|-----|----------------|-----------|
| M2 → M3 | 5 | M2=20, M3=8 | 20 open |
| M2 → M4 | 3 | M2=17, M4=5 | 17 open |
| M2 → M1 merge | 12 | M2=5, M1=1002, M1Trf=1002 | 5 open |

After **merge 12** from Checking — cascade hits all floors in path:

| Floor | What changes (+12) |
|-------|-------------------|
| **Checking** | M2−12, M1/M1Trf/transferred/completed +12 |
| **Washing, Boarding** (if active) | RCV, completed, transferred +12 |
| **Secondary** (if active) | M1, M1Trf, transferred +12 |
| **Branding** (if active) | RCV, completed, transferred +12 |
| **Final Checking** | M1, M1Trf, transferred +12 + brand line (e.g. 12·Van Heusen) |
| **Dispatch** | **RCV +12** |

Checking REM stays **0** (M2=5, M3=8, M4=5 still account for defects; M1Trf absorbed the merged 12).

---

### Step 3 — M2 at Secondary Checking (separate entry)

Secondary gets RCV from upstream. Operator finds **8 M2** there.

**New M2 ledger entry:** 8 qty, source = **Secondary Checking**

Merge all **8** from Secondary:

| Floor | Effect |
|-------|--------|
| Secondary | M2−8, M1/M1Trf +8 |
| Branding, Final Checking | M1/M1Trf +8 (if active) |
| Final Checking (branded) | `transferredData` +8 (brand pick) |
| Dispatch | **RCV +8** |

Upstream floors (Checking, Washing, etc.) are **not** touched — merge only cascades **forward**.

---

### Step 4 — M2 at Final Checking (separate entry)

Operator marks **10 M2** on Final Checking.

Merge **10** from Final (branded):

| Floor | Effect |
|-------|--------|
| Final Checking | M2−10, M1/M1Trf +10, brand `transferredData` +10 |
| Dispatch | **RCV +10** |

No upstream floors touched.

---

### Final tally — Dispatch RCV

| Source | Dispatch RCV |
|--------|----------------|
| Normal good M1 path (Checking → … → FC → Dispatch) | **990** |
| M2 merge from Checking | **+12** |
| M2 merge from Secondary | **+8** |
| M2 merge from Final Checking | **+10** |
| **Total Dispatch RCV** | **1020** |

**Conservation:** 1020 in at Checking → 990 good + (12+8+10) repaired-back-to-good via merge = **1020 at Dispatch**.

**Never reaches Dispatch:** M3=8 + M4=5 + open M2=5 = **18** (defects stay at QC).

---

## Brand-wise M2 → M1 merge (Checking / Secondary / Final Checking)

M2→M1 merge **skips Branding** in the cascade. For branded articles, the operator must assign brand equity at merge time in **M2 Management** — from **Checking**, **Secondary Checking**, or **Final Checking**.

Brand allocation is required when **all** are true:

1. Merge cascade includes **Final Checking**
2. Article process includes **Branding** or **Re-Boarding**
3. Product catalog has at least one brand (`styleCodes`)

Otherwise: merge is **qty-only** (no brand picker).

**Brand budget source:**

| Situation | Budget used |
|-----------|----------------|
| `finalChecking.receivedData` has brand rows (Branding already ran) | FC received − FC transferred (strict per-brand caps) |
| Branding not done yet | Product catalog brands; split must sum to merge qty |

**Single-brand articles:** backend auto-assigns full merge qty to that brand (no manual split).

When brand is required:

- Multi-brand: operator splits merge qty by brand (must sum to merge qty)
- Backend updates `finalChecking.transferredData` so scalar **M1Trf** and brand breakdown stay in sync
- When merge cascade passes **Branding** or **Re-Boarding**, backend also updates that floor's `transferredData` (and `transferred` when cascade did not already bump it) so the Branding supervisor UI shows the merge brand split
- **Dispatch** does not get brand lines on merge — only **RCV** bump; brand tracking on Dispatch happens on Final Checking → Dispatch transfer

---

## Mental model

1. **M1** = good pipeline (slow, floor-by-floor, containers)
2. **M2** = repair queue (M2 Management) — can become **M3/M4** (local defect) or **M1 via merge** (fast cascade to Dispatch)
3. **M3 / M4** = dead-end defects on QC floor
4. **REM** = what is still sitting on that QC floor

---

## Related code

| Area | File |
|------|------|
| M2 merge cascade | `AddOn_backend/src/utils/m2Cascade.util.js` |
| M2 merge API + brand `transferredData` | `AddOn_backend/src/services/production/m2Management.service.js` |
| Brand validation | `AddOn_backend/src/utils/brandQuantity.util.js` |
| QC REM formula (frontend) | `Addon_frontend/shared/utils/qcFloorQuantities.ts` |
| M2 Management UI | `Addon_frontend/app/production/m2-management/` |

---

## See also

- `AddOn_backend/docs/M2_REPAIR_TRANSFER_DOCUMENTATION.md`
- `AddOn_backend/docs/M2_GROUND_LEVEL_HISTORY_FLOW.md`
- `AddOn_backend/docs/BRANDING_FINAL_CHECKING_TRANSFER_SYNC.md`
