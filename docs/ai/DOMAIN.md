# Domain locks

Facts the AI tool layer must follow. One source line each.

- `Product.bom.quantity` is grams per piece, pending one human confirmation. Yarn stock is kg. Convert with `÷ 1000`.
  Source: dev `addon` ratio `(plannedQuantity × bom.quantity) / yarn_issued net kg` median ~907 on 771 lines; 0 lines near 1 (`docs/ai/TOOL_DISCOVERY.md` Q1).

- `YarnPurchaseOrder.poItems.quantity` is kg.
  Source: 119 POs, `sum(poItems.quantity) / sum(receivedLotDetails.netWeight)` median 1.00; lot `netWeight` comment says kg (`yarnPurchaseOrder.model.js`).

- Pairs pending on a floor = `max(0, received - transferred)`. Never use `remaining`.
  Source: `liveFloorPending` in `AddOn_backend/src/services/production/backlogReport.service.js`.

- On QC floors `checking`, `secondaryChecking`, and `finalChecking`, also show `m1Remaining`, `m2Remaining`, `m3Quantity`, `m4Quantity`. Pending pairs still use the formula above.
  Source: same `liveFloorPending`; QC fields on `Article.floorQuantities` in `article.model.js`. Dev sample: Checking `remaining` was 0 while `received - transferred` was the open M2.

- Floor quantities (`received`, `transferred`, `completed`, `remaining`, M1–M4) are pairs. `.5` is a valid half-pair entry. Display rounded to 2 decimals, same as `formatProductionQty`.
  Source: `Addon_frontend/shared/utils/halfStepQuantity.ts`. Command center and STN say pairs. Local `addon`: 6037 fields are exact `.5`.

- kg displays at 3 decimals (`roundKg3`). Pairs display at 2 decimals.
  Source: Live Inventory uses `toLocaleString()` (3 fraction digits). `getInventoryBreakdownForCatalogIds` rounds with `roundKg3`. Pair display is `formatProductionQty`.

- `plannedQuantity` is assumed pairs, pending team confirmation. Do not compare it with floor counts.
  Source: integer on all 1871 local articles; no unit field on `Article`.

- Order stage grouping, computed in code, not read from a stored field: `inProduction` = sum of pending on knitting through finalChecking; `inWarehouse` = warehouse pending; `readyToDispatch` = dispatch pending (command center "Ready to Dispatch"); `dispatched` = `dispatch.transferred`.
  Source: `backlogReport.service.js` includes dispatch and warehouse in the floor-pending sum; STN `qtyInPairs` / `dispatch.transferred` is the outbound counter.

- "Overdue" does not exist. There is no due date. "Stuck" means pending on a floor with no `ArticleLog` movement for N days. N is config, not decided yet.
  Source: `backlogUpcoming.util.js` has no dates; `ProductionOrder` has no due date.

- Vendor master is `VendorManagement` only (`vendormanagements`). Ignore `Vendor` / `vendors`.
  Source: Vendor List calls `GET /v1/vendor-management` (`vendorManagementService.ts`). Dev: `vendormanagements` 2, `vendors` 0.

- Warehouse orders are `WarehouseOrder` only (`warehouseorders`). Ignore `WhmsOrder`.
  Source: Orders page calls `GET /v1/whms/warehouse-orders` (`whmsWarehouseOrderService.ts`). Dev: `warehouseorders` 55, `whmsorders` 0.

- Live warehouse stock is `getWarehouseInventoryByStyleCode` + `serializeWarehouseInventory` (the Stock screen). Not Core Report `sapStock`, not `getGapReport`, not `loadWarehouseStockByProduct`.
  Source: `warehouseInventory.service.js`, `warehouseInventorySerializer.js`. Screen: `WhmsWarehouseInventoryTab.tsx`.

- Warehouse available = total − blocked. Damaged is not in that formula. One stock row per style code. The unit is the style's pack (`1 Pair` on most rows, `Pack of N` on some). Never convert packs to pairs or pieces.
  Source: `warehouseInventory.model.js` pre-save; serializer `quantities`. Local `addon`: 4699/4702 rows pack `1 Pair`, 3 rows `Pack of 3`.

- A product total is valid only when no style sits on another active product and every style has the same pack. A shared style code or a duplicate factory code is not a combined total.
  Source: local `addon`, 65 style code ids on more than one active product. Factory codes `A5837` and `A5838` each have two active products.

- Warehouse order stage is the stored `flowStatus` plus the label map in `whmsWarehouseOrderService.ts` (`WAREHOUSE_ORDER_FLOW_STATUS_LABELS`). Do not derive a stage from coarse `status`.
  Source: `WarehouseOrder.flowStatus`; UI `warehouseOrderFlowStatusLabel`. Coarse labels: `warehouseOrderStatusLabel`.

- Production orders are `ProductionOrder` only (`production_orders`). Not `Order`, `WarehouseOrder`, or `WhmsOrder`.
  Source: Production Orders screen `/production/supervisor` reads the production order API (`supervisor/page.tsx`).

- Live Inventory permission is `User.navigation['Yarn Management']['Dashboard']`.
  Source: sidebar path `/yarn-management/dashboard`; page gate `hasSubPermission("/yarn-management", "Dashboard")` (`dashboard/page.tsx`).

- Tools reuse the service function behind the matching screen via a thin adapter. Never re-implement a formula. Check single-item speed, UI formatting, rounding (backlog `Math.round`), and stale fields (`ProductionOrder.status`).
  Source: Live Inventory vs `computePhysicalKgMap` on local `addon`, 2026-10-19.

- Live yarn stock is `getInventoryBreakdownForCatalogIds` (same aggregation as the Live Inventory screen, `aggregateInventoryFromStorage`). `computePhysicalKgMap` is for the snapshot cron only. `computeInventoryFromStorage` is buggy (`$or` clobber); never use it. Do not read `YarnInventory` as the stock figure.
  Source: `yarnInventory.service.js`. Screen: `GET /v1/yarn-management/yarn-inventories`. One yarn 55 ms. `computePhysicalKgMap` disagreed (navy 116.404 vs screen 116.385). `computeInventoryFromStorage` added every live cone (~10158 kg) onto each yarn.

- Blocked kg is the net weight of issued cones (`issueStatus: 'issued'`, `coneWeight - tearWeight`). Available = LTS + STS − blocked, as the screen shows. Unallocated is a separate column and is not in available. Possible double subtraction, pending yarn team confirmation.
  Source: `aggregateInventoryFromStorage` and `dashboard/page.tsx`. `YarnInventory.blockedNetWeight` was 0 while the screen showed 0.391 kg.

- `TeamMaster` people are not `User`s. `ArticleLog.userId` is not a per-user workload signal.
  Source: no `userId` on `teamMaster.model.js`. Dev: 2/75 name matches. Of 200 recent logs, 12.5% of `userId` values were a `User._id`; 175 were one short non-id token.

- Dev data: `Sales.materialCode` does not match any current `Product._id` (0/5992). Do not use this DB's sales rows for item lookup until that is fixed.
  Source: Q9 on local `addon`. Sales written 2025-08-19; products created from 2026-03-09.

- Yarn PO status is `currentStatus`, not `status`. `status` is absent on all 453 dev docs. `currentStatus` is set on all 453.
  Source: schema `yarnPurchaseOrder.model.js`; aggregate on `yarnpurchaseorders` (260 `goods_received`, 152 `goods_partially_received`, 30 `submitted_to_supplier`, 5 `in_transit`, 4 `po_accepted`, 1 `draft`, 1 `po_rejected`).

- `ProductionOrder.status` is not kept in sync with article status. All 136 dev orders are `Pending` and `currentFloor` `Knitting`, while 136 orders have at least one `In Progress` article.
  Source: aggregate on `production_orders` and `articles`, local `addon`.

- Known data issue: Joi schemas in `production.validation.js` use `.integer()`, while the floor UI (`halfStepQuantity.ts`) allows `.5`. Junk non-half-step values sit on A1353 (1440.7), A5436 (880.99999 / 880.899), and A6574 (434.2).
  Source: `AddOn_backend/src/validations/production.validation.js`; `Addon_frontend/shared/utils/halfStepQuantity.ts`; local `addon` scan.

## Known issues

- Stock and Orders leaf pages do not call `hasSubPermission`. The hub (`warehouse-management/page.tsx`) and the sidebar do. Tool gates are still `Warehouse Management.Stock` and `Warehouse Management.Orders`.
  Source: `app/warehouse-management/stock/page.tsx`, `app/warehouse-management/orders/page.tsx` (no `hasSubPermission`); hub checks the module key.

- Duplicate factory codes `A5837` and `A5838`: each has two active products that share one style code. Do not treat the factory code as one product.
  Source: local `addon` product scan, Part A.

- Requisition alertStatus/availableQty are computed by recalculateRequisitionFromInventory → computeInventoryFromStorage ($or bug). Below-minimum alerts are unreliable. Do NOT build AI tools on YarnRequisition until fixed.
  Source: `yarnReq.service.js` `recalculateRequisitionFromInventory`, called from `getYarnRequisitionList` when `skipRecalculation` is false. It writes `availableQty`, `blockedQty`, `alertStatus`, `minQty`. `computeInventoryFromStorage` spreads `activeYarnConeMatch`, which replaces the yarn `$or`.
