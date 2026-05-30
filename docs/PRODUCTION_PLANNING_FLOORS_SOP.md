# Standard Operating Procedure — Production Planning & Floors

**Document ID:** SOP-PROD-001
**Version:** 1.0
**Applies to:** AddOn production system (sock manufacturing)
**Owners:** Production Planning Manager, Floor Supervisors, QC Head, Warehouse Manager

---

## 1. Purpose

Define the end-to-end process for planning, executing, tracking, and closing production orders across all production floors so that:

- Every article is traceable from yarn issue to dispatch via container handoff.
- Quality (M1/M2/M3/M4) is captured at each gate, not just at Final Checking.
- WIP, throughput, and rework loops are auditable through `ArticleLog`, `M3Log`, `M4Log`.
- No floor can "ghost-receive" or "ghost-transfer" outside the container-receive protocol.

## 2. Scope

Covers all 12 production floors and the planning layer that feeds them:

```
Knitting → (Linking) → Checking → Washing → Boarding → Silicon
       → Secondary Checking → Branding → Re-Boarding → Final Checking
       → Dispatch → Warehouse
```

`Linking` is included only for `Hand Linking` and `Rosso Linking` articles. `Auto Linking` skips the Linking floor (see `getFloorOrderByLinkingType` in `src/utils/productionHelper.js`).

## 3. Definitions

| Term | Meaning |
|---|---|
| PO | Production Order (`ProductionOrder` model) |
| Article | A line on a PO with planned quantity, linking type, priority (`Article` model) |
| Floor | A processing station with `received / transferred / completed / pending` counters in `article.floorQuantities[floorKey]` |
| Container Receive | Quantity moves to the next floor only after that floor scans and accepts the container (`usesContainerReceive` returns `true` for all floors Knitting → Warehouse) |
| M1 | Pass / first-grade |
| M2 | Held for re-inspection / under review |
| M3 | Sent for repair / rework |
| M4 | Reject / scrap |
| Linking Type | `Auto Linking`, `Rosso Linking`, `Hand Linking` (determines floor sequence) |
| Priority | `Urgent`, `High`, `Medium`, `Low` |
| Status | `Pending`, `In Progress`, `Completed`, `On Hold`, `Short Close`, `Cancelled` |

## 4. Roles & Responsibilities

| Role | Owns |
|---|---|
| Production Planner | PO creation, article breakdown, linking-type assignment, machine-order assignment, priority, due dates |
| Knitting Supervisor | Yarn issue confirmation, machine queue, knit output, M1 declaration, container packing to next floor |
| Linking Supervisor | Linking quality, throughput, transfer to Checking |
| Checking Supervisor (1°) | M1/M2/M3/M4 grading at first checkpoint, M3 routing to repair, M4 to scrap ledger |
| Washing / Boarding / Silicon Supervisors | Process WIP, output count, container handover |
| Secondary Checking | Second QC gate before branding |
| Branding Supervisor | Brand application, output transfer to Re-Boarding |
| Re-Boarding | Final shape-set before Final Checking |
| Final Checking Supervisor | Final M1/M2/M3/M4 confirmation, repair routing, dispatch readiness |
| Dispatch | Stock Transfer Notes, packing for warehouse |
| Warehouse | Receiving, slotting, client allocation |
| QC Head | M2 disposition, repair sign-off, daily reject (M4) review |

## 5. Planning Procedure (pre-floor)

**Trigger:** New customer order or replenishment request.

1. **Create Production Order** with PO number, customer/order ref, target date, priority.
2. **Add Articles** to PO. For each article set:
   - `articleNumber`, `knittingCode`, `plannedQuantity`
   - `linkingType` — drives floor sequence (validate against product processes via `validateProductProcesses`)
   - `priority`
3. **Validate processes** — system maps product processes to floors via `mapProcessToFloor`. Reject articles whose process list does not map cleanly to floors.
4. **Machine Order Assignment** — assign each article (or split) to a knitting machine + needle. Set yarn issue requirements. `YarnIssueStatus` starts at `Pending`.
5. **Yarn Issue** — store team issues yarn; `YarnIssueStatus` → `In Progress` → `Completed`. PO cannot start knitting before yarn issue is at least `In Progress` against that assignment.
6. **Release to Floor** — Knitting supervisor sees the article in queue with `status = Pending`.

**Hard rules for planners:**
- Never set `linkingType` after production has started on an article — it changes the floor sequence and corrupts `floorQuantities`.
- Never reduce `plannedQuantity` below current completed quantity on any downstream floor.
- Short-close instead of cancel once any floor has `transferred > 0`.

## 6. Standard Floor Cycle (applies to every floor)

Each floor follows the same six-step cycle. Deviations are called out per-floor in §7.

**Step 1 — Receive**
- Scan inbound container.
- System increments `floorQuantities[thisFloor].received` and decrements upstream `transferred` balance.
- Reject the container if quantity, article, or PO does not match. Do **not** edit numbers manually.

**Step 2 — Start Work**
- Supervisor moves article to `In Progress` via "Work Started" action.
- `ArticleLog` records `WORK_STARTED` with floor + user + timestamp.

**Step 3 — Produce**
- Operate machines/process. Update `completed` quantity at end of shift or per batch.
- Use `QUANTITY_UPDATED` / `PROGRESS_UPDATED` actions only — never bulk-edit DB.

**Step 4 — In-floor Quality (where applicable)**
- Floors with QC duty (Knitting, Checking, Secondary Checking, Final Checking) declare M1/M2/M3/M4 splits using the methods in `qualityMethods.js`:
  - `updateQualityCategories`
  - `updateKnittingM4Quantity` (Knitting M4 only)
  - `updateQualityInspection`
- M4 items move to `m4_logs` ledger via `M4LogType.ENTRY` and never re-enter the flow.
- M3 items go to repair queue; status tracked via `RepairStatus`.
- M2 items remain on the floor until QC Head dispositions them (`shiftM2Items` → M1/M3/M4).

**Step 5 — Pack to Container**
- Pack only `M1` (and `M2` already cleared to M1) into the outbound container.
- Set container type per quantity:
  - `bag` (1–300)
  - `bigContainer` (301–500)
  - `container` (501+)
- Label container with PO, article, qty, source floor, target floor.

**Step 6 — Transfer**
- Trigger `TRANSFERRED_TO_<NEXT_FLOOR>` action.
- `transferred` increments on this floor. Next floor sees inbound container as `Pending Receive`.
- Quantity becomes visible on next floor's `received` **only** after Step 1 there. This is the container-receive protocol; do not bypass it.

**Common rules:**
- Never close a floor (`Completed`) while `received - transferred - M3_held - M4_held > 0`.
- Always close shift with remarks if any of: machine breakdown, material shortage, abnormal M3/M4 spike.
- Every supervisor action must be logged via the `ArticleLog` action enums in `LogAction`.

## 7. Floor-Specific SOP

### 7.1 Knitting
- Pre-req: Yarn issued, machine assignment active, needle locked.
- Output: Sock body knit. Defective bodies declared M4 (`updateKnittingM4Quantity`) and ledgered in `m4_logs`.
- Container target: `Linking` (Hand/Rosso) or `Checking` (Auto).
- KPI: needles utilised, output/hour, M4%.

### 7.2 Linking (Hand / Rosso only)
- Skip entirely for `Auto Linking` articles. System enforces this via `getFloorOrderByLinkingType`.
- Link toe seam. Reject visible defects to M3 (repair) or M4.
- Container target: `Checking`.

### 7.3 Checking (1° QC gate)
- Full inspection: knit faults, seam, length, count.
- Mandatory action: `updateQualityCategories` to set M1/M2/M3/M4 counts.
- M3 → on-floor repair queue, status drives `RepairStatus`.
- M4 → outward to `m4_logs` (no recovery).
- Container target: `Washing`.

### 7.4 Washing
- Recipe per article (water, time, chemicals). No quantity grading here.
- Watch shrinkage; if final length out-of-spec, escalate to QC Head — do not silently transfer.
- Container target: `Boarding`.

### 7.5 Boarding
- Heat-set on board forms. Record reject for tears as M3/M4 on the next QC floor — boarding itself does not grade.
- Container target: `Silicon`.

### 7.6 Silicon
- Apply silicon grip/print as per article spec.
- Skip transparently if the article's product process list does not include silicon (planner must confirm).
- Container target: `Secondary Checking`.

### 7.7 Secondary Checking (2° QC gate)
- Visual + measurement QC of branding/silicon/board output.
- Mandatory `updateQualityCategories`.
- Container target: `Branding`.

### 7.8 Branding
- Apply brand label/heat transfer/tag.
- Defects in branding are routed back to in-house rework, not M3/M4 (label issue, not garment).
- Container target: `Re-Boarding`.

### 7.9 Re-Boarding
- Re-set shape post-branding heat exposure.
- Container target: `Final Checking`.

### 7.10 Final Checking (final QC gate)
- Mandatory:
  - `updateQualityInspection` for line-level inspection
  - `confirmFinalQuality` to lock M1 quantity that proceeds to Dispatch
  - `updateCompletedQuantityWithQuality` to reconcile counters
- M2 items: held until QC Head moves them (`shiftM2Items`) to M1, M3, or M4.
- M3 repair loop: `REPAIR_STARTED` → `REPAIR_COMPLETED` (re-grade as M1) or `REPAIR_REJECTED` (→ M4).
- Previous-floor consistency: system validates against Re-Boarding (if active) or Branding via `getFinalCheckingPrevFloorKey`. If counts disagree, fix upstream before transferring.
- Container target: `Dispatch`.

### 7.11 Dispatch
- Generate Dispatch Stock Transfer Note (`DispatchStockTransferNote` model).
- Pack per warehouse SKU spec.
- Container target: `Warehouse`.

### 7.12 Warehouse
- Receive STN, slot per `YARN_INVENTORY_STORAGE_SLOTS_FLOW` conventions (article-level, not yarn-level).
- Allocate to client orders.
- Closes the production order when warehouse `received` for all articles equals confirmed M1 from Final Checking.

## 8. Quality Workflow (cross-floor)

```
M1 (pass)   → flows to next floor
M2 (review) → held on floor → QC Head dispositions → M1 | M3 | M4
M3 (repair) → repair queue → RepairStatus = In Review → Repaired (→ M1) | Rejected (→ M4)
M4 (reject) → m4_logs ledger ENTRY → permanent outward
```

Rules:
- Only Knitting writes its own M4 (knitting defects). All other M4 originates at a QC gate.
- M3 repair sign-off must happen on the same floor where the defect was raised.
- M2 ageing > 24h triggers an auto-escalation to QC Head (operational rule, enforce in dashboard alerts).

## 9. Status Lifecycle

```
Pending → In Progress → Completed
            ↓
         On Hold ↔ In Progress
            ↓
     Short Close | Cancelled
```

- `Cancelled` is only allowed when no floor has any `transferred > 0`.
- `Short Close` after partial production; balance qty is written off with a reason in `ArticleLog`.
- `On Hold` requires a reason: material shortage, machine breakdown, design freeze, customer hold.

## 10. Container-Receive Protocol (critical)

This is the only legal way quantity moves between floors. Manual edits break audit.

1. Source floor `TRANSFERRED_TO_<NEXT>` → container goes into "in transit" state.
2. Receiving floor scans container → `received` increments here, source's `transferred` is now matched.
3. Any mismatch (qty, article, PO) → container is rejected, returned to source. No partial accept.
4. `usesContainerReceive(fromFloor)` returns `true` for every floor in the flow — there is no shortcut.

## 11. Logging & Traceability

Every supervisor action must produce an `ArticleLog` entry. Required actions per floor:

- Floor entry: `WORK_STARTED`
- Production update: `QUANTITY_UPDATED` or `PROGRESS_UPDATED`
- Quality calls: `QUALITY_CHECK_STARTED`, `QUALITY_CHECK_COMPLETED`, `M1/M2/M3/M4_QUANTITY_UPDATED`
- Transfers: `TRANSFERRED_TO_<FLOOR>`
- Exceptions: `MACHINE_BREAKDOWN`, `MATERIAL_SHORTAGE`, `ISSUE_REPORTED`, `ISSUE_RESOLVED`
- Closure: `WORK_COMPLETED`

Cross-checks (run via report.service):
- Sum of floor `received` ≤ Knitting `completed`.
- Final Checking `confirmedM1` + total `M4` + total `Repair Rejected` = sum of all upstream `completed`.
- Warehouse `received` ≤ Dispatch `transferred`.

## 12. Exception Handling

| Situation | Action |
|---|---|
| Machine breakdown | `MACHINE_BREAKDOWN` log, redistribute via `machineOrderAssignment.service.js` (ASSIGNMENT_ITEM_TRANSFERRED_BETWEEN_MACHINES), set article `On Hold` if no fallback machine |
| Yarn shortage mid-batch | `MATERIAL_SHORTAGE` log, planner re-issues from store, article stays `In Progress` |
| Wrong container received | Reject scan, container returns to source floor, raise `ISSUE_REPORTED` |
| Quantity mismatch at floor close | Reconcile with upstream `transferred`. If still off, escalate to QC Head; do not transfer. |
| Repeated M3/M4 from same machine | Stop machine, raise `MACHINE_BREAKDOWN`, route to maintenance |
| Customer cancellation | If no `transferred > 0`: `Cancelled`. Else: `Short Close` + WIP disposition note |

## 13. KPIs (per floor, per shift)

- Output qty (`completed` delta)
- First-pass yield = M1 / (M1+M2+M3+M4)
- M4% (target ≤ 1.5% on QC floors)
- WIP age (oldest `received` not yet `transferred`)
- Transfer cycle time (received → transferred)
- Container-reject rate (target < 0.5%)

## 14. Audit & Review

- **Daily:** Floor supervisor closes shift with reconciled counters and signs off in dashboard.
- **Weekly:** Planning reviews PO status, short-close candidates, M3 repair backlog.
- **Monthly:** QC Head reviews M4 trends per machine, per article, per supplier yarn lot.
- **Per PO close:** Reconcile Knitting `completed` → Warehouse `received`; archive `ArticleLog`, `M3Log`, `M4Log` for the PO.

## 15. References

- `src/models/production/enums.js` — canonical floor, status, quality, log enums
- `src/models/production/article.model.js` — `floorQuantities` schema and lifecycle hooks
- `src/utils/productionHelper.js` — floor order, linking-type rules, container-receive predicates
- `src/models/production/qualityMethods.js` — M1/M2/M3/M4 transitions
- `src/services/production/*` — order, article, floor, quality, log, m3/m4 management services
- `docs/M2_REPAIR_TRANSFER_DOCUMENTATION.md` — M2/M3 repair flow details
- `docs/BRANDING_FINAL_CHECKING_TRANSFER_SYNC.md` — Branding ↔ Final Checking sync
