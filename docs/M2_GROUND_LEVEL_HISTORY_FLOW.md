# M2 Ground-Level History Flow

**Document ID:** FLOW-M2-001  
**Version:** 1.0 (proposed approach)  
**Status:** Design / SOP — no backend or frontend changes yet  
**Applies to:** Checking, Secondary Checking, Final Checking floors

---

## 1. Purpose

Define a **log-only M2 (repairable) workflow** where:

- **Ground staff** physically move, repair, and track repairable pieces on the shop floor.
- **The system** only records **M2 history logs** — quantity, source QC floor, destination repair floor, remarks, user, and timestamp.
- **No automatic quantity movement** on target floors (`received`, `repairReceived`, etc.) when M2 is sent for repair.
- When repaired items return to a QC floor, the supervisor records outcomes as **M1** (pass forward) or **new M2** (send for repair again) — each action is another log entry.

This keeps the digital record as an **audit trail / history**, while physical WIP is maintained manually at ground level.

---

## 2. Production Floors Reference

Full sock manufacturing sequence (product process may skip floors not in the article’s route):

| # | Floor | Key | Typical role |
|---|-------|-----|--------------|
| 1 | Knitting | `knitting` | Knit body; M4 defects at source |
| 2 | Linking | `linking` | Link toe/heel (*Hand / Rosso only*; skipped for Auto Linking) |
| 3 | Checking | `checking` | **1st QC gate** — M1/M2/M3/M4 grading |
| 4 | Washing | `washing` | Wash |
| 5 | Boarding | `boarding` | Board / heat-set |
| 6 | Silicon | `silicon` | Silicon application (if in process) |
| 7 | Secondary Checking | `secondaryChecking` | **2nd QC gate** |
| 8 | Branding | `branding` | Brand label / heat transfer / embroidery |
| 9 | Re-Boarding | `reBoarding` | Re-shape after branding (if in process) |
| 10 | Final Checking | `finalChecking` | **Final QC gate** |
| 11 | Dispatch | `dispatch` | Pack for warehouse |
| 12 | Warehouse | `warehouse` | Receive and slot |

### Floor sequence by linking type

**Hand Linking / Rosso Linking:**
```
Knitting → Linking → Checking → Washing → Boarding → Silicon
  → Secondary Checking → Branding → Re-Boarding → Final Checking → Dispatch → Warehouse
```

**Auto Linking** (Linking skipped):
```
Knitting → Checking → Washing → Boarding → Silicon
  → Secondary Checking → Branding → Re-Boarding → Final Checking → Dispatch → Warehouse
```

Actual sequence per article comes from **product processes** (`getFloorOrder()`), not a fixed list.

### QC gates (M2 applies here only)

| QC gate | Floor key | Previous floor (typical) |
|---------|-----------|--------------------------|
| 1st QC | `checking` | Linking or Knitting (auto) |
| 2nd QC | `secondaryChecking` | Silicon |
| Final QC | `finalChecking` | Re-Boarding or Branding |

---

## 3. Quality categories (reminder)

| Code | Meaning | System behaviour in this approach |
|------|---------|-----------------------------------|
| **M1** | Good / pass | Counted toward forward transfer to next floor |
| **M2** | Repairable — needs rework | **Log only** when sent out; ground maintains physical pieces |
| **M3** | Minor defect | Held / repaired on same floor (separate from M2 history) |
| **M4** | Major reject | Outward to M4 management ledger |

**M2 focus:** repairable items that leave the QC floor and go to an earlier floor for physical repair.

---

## 4. Core principle: log-only M2

### What the system DOES

| Action | System records |
|--------|----------------|
| Supervisor grades qty as M2 | M2 qty on QC floor + optional log entry |
| Supervisor sends M2 for repair | **M2 history log**: qty, from QC floor, to repair floor, remarks, user, time |
| Repaired items return (ground) | Supervisor enters M1 and/or new M2 on QC floor + **return / outcome log** |
| Supervisor passes repaired qty as M1 | Normal M1 transfer to next floor (existing flow) |

### What the system does NOT do (in this approach)

- Does **not** bump `received` / `repairReceived` on the target repair floor.
- Does **not** auto-route items back through intermediate floors in `floorQuantities`.
- Does **not** track physical location of each M2 piece — only **event logs**.

### What ground staff DOES

- Physically move M2 pieces to the selected repair floor.
- Repair, hold, and return pieces to the correct QC gate.
- Match physical counts with what supervisors enter in the system.

---

## 5. M2 history log entry (conceptual schema)

Each M2 event is one row in **M2 history** for an article (new collection or `ArticleLog` with a dedicated action type).

| Field | Required | Description |
|-------|----------|-------------|
| `articleId` | Yes | Article reference |
| `orderId` | Yes | Production order reference |
| `articleNumber` | Yes | Factory code / article number |
| `eventType` | Yes | See event types below |
| `quantity` | Yes | Pieces in this event |
| `qcFloor` | Yes | `Checking` \| `Secondary Checking` \| `Final Checking` |
| `repairFloor` | For send-back | Where pieces go for repair (user-selected) |
| `m1Quantity` | For return outcome | Qty passed as M1 after repair |
| `m2Quantity` | For return outcome | Qty still M2 (re-send for repair) |
| `remarks` | Optional | Free text |
| `userId` | Yes | Who recorded the entry |
| `floorSupervisorId` | Yes | Supervisor on QC floor |
| `timestamp` | Yes | When recorded |

### Event types

| `eventType` | When used |
|-------------|-----------|
| `M2_CREATED` | Qty first classified as M2 on a QC floor (optional; can be part of quality save) |
| `M2_SENT_FOR_REPAIR` | Supervisor confirms M2 qty + selects destination repair floor |
| `M2_RETURNED` | Ground confirms pieces are back at QC floor (optional marker) |
| `M2_OUTCOME` | After return: how many → M1, how many → M2 again, remarks |
| `M2_REPAIR_COMPLETE` | All M2 for a batch resolved (optional close-out) |

---

## 6. Workflow — Checking floor

### Step 1 — Receive and inspect

Example: **100 pcs** received on Checking (from Linking / Knitting via container).

Supervisor inspects and enters:

| Category | Qty |
|----------|-----|
| M1 | 50 |
| M2 | 50 |
| M3 | 0 |
| M4 | 0 |

System saves floor quality on `floorQuantities.checking` (existing behaviour).  
Optionally log `M2_CREATED` for 50 pcs.

### Step 2 — Send M2 for repair (log only)

Supervisor opens **Send M2 for repair**:

- Quantity: **50** (max = current M2 on floor)
- **Repair floor:** user selects e.g. **Linking**
- Remarks: e.g. "Hole at toe — linking rework"

System writes **one M2 history log**:

```json
{
  "eventType": "M2_SENT_FOR_REPAIR",
  "quantity": 50,
  "qcFloor": "Checking",
  "repairFloor": "Linking",
  "remarks": "Hole at toe — linking rework"
}
```

**Ground:** 50 pcs physically go to Linking. No change to Linking `received` in the system.

Checking floor M2 balance for display:

```
M2 on floor (logical) = M2 graded − M2 sent for repair + M2 returned as M2 again
```

(Exact balance rules can be derived from history sum; no need to mutate other floors.)

### Step 3 — Repair and return (ground)

Linking repairs items. Ground brings **50 pcs** back to Checking when ready.  
No system action required until supervisor records outcome.

### Step 4 — Record return outcome

Supervisor at Checking records what came back:

| Outcome | Qty | Action |
|---------|-----|--------|
| Repaired → M1 | 30 | Log `M2_OUTCOME`: 30 to M1 |
| Still need repair → M2 | 20 | Log `M2_OUTCOME`: 20 remain M2 |

```json
{
  "eventType": "M2_OUTCOME",
  "quantity": 50,
  "qcFloor": "Checking",
  "m1Quantity": 30,
  "m2Quantity": 20,
  "remarks": "30 OK after linking repair; 20 need second pass"
}
```

### Step 5 — Pass M1 to next floor

Supervisor transfers **30 M1** to Washing (normal M1 transfer + container flow — **unchanged**).

### Step 6 — Re-send remaining M2 (if any)

For the **20** still M2:

- Supervisor again selects repair floor (e.g. Linking or Knitting).
- New log: `M2_SENT_FOR_REPAIR`, qty 20, repairFloor Linking.

Cycle repeats until M2 balance = 0.

---

## 7. Workflow — Secondary Checking floor

**Same approach as Checking.** Only differences:

| Item | Secondary Checking |
|------|-------------------|
| QC floor key | `secondaryChecking` |
| Typical previous floor | Silicon |
| Typical repair floor choices | Silicon, Boarding, Washing, Checking, Linking, Knitting (any floor **before** Secondary Checking in article flow) |
| M1 forward target | Branding (next in flow) |

### Example

- Received: **80**
- M1: **60**, M2: **20**
- Send 20 M2 → **Boarding** (log only)
- Return: 15 → M1, 5 → M2 again (log outcome)
- Transfer 15 M1 → Branding
- Send 5 M2 → Boarding again (new log)

All events stored in **same M2 history** for the article, with `qcFloor: "Secondary Checking"`.

---

## 8. Workflow — Final Checking floor

**Same log-only M2 approach.**

| Item | Final Checking |
|------|----------------|
| QC floor key | `finalChecking` |
| Typical previous floor | Re-Boarding or Branding |
| Typical repair floor choices | Branding, Secondary Checking, Silicon, Boarding, Washing, Checking, Linking, Knitting |
| M1 forward target | Dispatch |

### Example

- Received: **60**
- M1: **55**, M2: **5**
- Send 5 M2 → **Branding** (log)
- Return: 5 → M1 (all repaired)
- Log outcome: 5 to M1
- Transfer 5 M1 to Dispatch (plus existing 55 M1 already transferred or batched)

Final Checking may still use `confirmFinalQuality` for dispatch lock — M2 history is **additional** traceability, not a replacement for M1 confirmation.

---

## 9. M2 history timeline (single article)

Example article **A584** on Checking:

| # | Time | Event | Qty | Repair floor | M1 | M2 | User |
|---|------|-------|-----|--------------|----|----|------|
| 1 | 10:00 | Quality save | — | — | 50 | 50 | Sup A |
| 2 | 10:15 | M2_SENT_FOR_REPAIR | 50 | Linking | — | — | Sup A |
| 3 | 14:00 | M2_OUTCOME | 50 | — | 30 | 20 | Sup A |
| 4 | 14:10 | M1 transfer | 30 | — | → Washing | — | Sup A |
| 5 | 14:20 | M2_SENT_FOR_REPAIR | 20 | Knitting | — | — | Sup A |
| 6 | 17:00 | M2_OUTCOME | 20 | — | 20 | 0 | Sup B |
| 7 | 17:05 | M1 transfer | 20 | — | → Washing | — | Sup B |

Supervisor or QC Head can open **M2 history** for the article and see the full repair story without reading `floorQuantities` on Linking/Knitting.

---

## 10. UI expectations (future)

### On each QC floor page (Checking / Secondary / Final)

1. **Quality entry** — M1 / M2 / M3 / M4 (existing).
2. **Send M2 for repair** — qty + **repair floor dropdown** (only floors before this QC gate in article flow) + remarks → **writes log only**.
3. **M2 outcome after return** — qty returned, split M1 / M2 again + remarks → **writes log**.
4. **M2 history panel** — table of all `M2_*` events for this article, filterable by QC floor.

### Repair floor dropdown rules

| QC floor | Allowed repair floors |
|----------|----------------------|
| Checking | Knitting, Linking (and any floor before Checking in article process) |
| Secondary Checking | All floors before Secondary Checking in process |
| Final Checking | All floors before Final Checking in process |

Do **not** show Warehouse, Dispatch, or the current QC floor as repair targets.

---

## 11. Roles

| Role | Responsibility |
|------|----------------|
| QC floor supervisor | Grade M1/M2/M3/M4; log M2 send-back and return outcomes; transfer M1 forward |
| Repair floor staff | Physical repair (ground); no system entry required |
| QC Head | Review M2 history; resolve aged M2; approve M2 → M1 outcomes |
| Planner / admin | View M2 history reports per order / article |

---

## 12. Rules

1. **M2 send-back = log only** — never auto-increment target floor `received`.
2. **Every M2 send** must record: quantity, `qcFloor`, `repairFloor`, user, timestamp.
3. **Every return** should record outcome: how much → M1, how much → M2 again.
4. **M1 forward** uses existing container transfer flow (unchanged).
5. **Re-send M2** creates a **new** log row; do not edit old send rows.
6. **Same approach** on Checking, Secondary Checking, and Final Checking — only `qcFloor` and allowed repair floors differ.
7. **Ground truth** for physical pieces is the shop floor; system history must be updated when supervisors confirm counts.

---

## 13. Comparison with current implementation

| Topic | Current system | This proposed approach |
|-------|----------------|------------------------|
| M2 send-back | Updates target `received` + `repairReceived` | **Log only** |
| M2 tracking | `m2Quantity`, `m2Transferred` on QC floor | QC floor counters + **M2 history ledger** |
| Return from repair | Implicit via re-flow through all floors | Supervisor logs **M2_OUTCOME** when pieces are back |
| Physical repair | Partially modelled in `floorQuantities` | **Ground maintains**; system is audit trail |
| Target floor UI | `repairReceived` breakdown | Optional read-only hint from logs, not floor counters |

Existing `M2_REPAIR_TRANSFER_DOCUMENTATION.md` describes the **quantity-mutation** model. This document describes the **ground-level log-only** model to move toward.

---

## 14. Implementation checklist (when coding later)

- [ ] M2 history model or `ArticleLog` action types (`M2_SENT_FOR_REPAIR`, `M2_OUTCOME`, …)
- [ ] API: create M2 history entry (no `transferM2ForRepair` floor quantity side effects)
- [ ] API: list M2 history by article / order / QC floor
- [ ] UI: repair floor picker filtered by article process order
- [ ] UI: M2 outcome form (returned qty → M1 / M2 split)
- [ ] UI: M2 history tab on Checking, Secondary Checking, Final Checking
- [ ] Reports: open M2 count by repair floor, ageing from last `M2_SENT_FOR_REPAIR`

---

## 15. Quick reference — one scenario end-to-end

```
Checking receives 100
  → M1: 50, M2: 50
  → Log: send 50 M2 to Linking
  → [Ground repairs at Linking, returns to Checking]
  → Log: outcome 30→M1, 20→M2
  → Transfer 30 M1 → next floor (Washing)
  → Log: send 20 M2 to Linking again
  → [Ground repairs again]
  → Log: outcome 20→M1
  → Transfer 20 M1 → Washing

Total M1 forwarded: 50 (initial) + 30 + 20 = 100 ✓
M2 history: 2 send rows + 2 outcome rows — full audit trail
```

Same pattern applies on **Secondary Checking** and **Final Checking** with their respective repair floor options and M1 forward targets.

---

**End of document**
