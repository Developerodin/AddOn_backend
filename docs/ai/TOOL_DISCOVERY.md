# AI tool discovery

Read-only survey of Addon ERP for a typed tool layer (READ / COMPUTE / WRITE).
WRITE means “create a pending suggestion a manager approves later”. There is **no** `AiSuggestion` model or approval queue in the repo today.

Scope: `AddOn_backend` (Express + Mongoose) and `Addon_frontend` (Next.js 14). `addonweb` is a separate OpenCart site that warehouse orders sync to; it is not the ERP API.

Placeholder screens skipped in Part 3: Catalog Dashboard, Vendor Dashboard, Yarn Dashboard (`MODULES.md`).

---

## Part 1 — System overview

### 1. Backend structure

Business data is an Express app. Next.js does not host the ERP API.

| Layer | Path |
| --- | --- |
| Boot | `AddOn_backend/src/index.js` — Mongo connect, S3 check, cron start, `app.listen` |
| Express app | `AddOn_backend/src/app.js` — helmet, body parser (50mb), passport JWT, `optionalAuth`, `/v1` |
| Route table | `AddOn_backend/src/routes/v1/index.js` — mounts feature routers and `userActivityLog` |
| Controllers | `AddOn_backend/src/controllers/**` |
| Services | `AddOn_backend/src/services/**` |
| Models | `AddOn_backend/src/models/**` |
| Request schemas | `AddOn_backend/src/validations/**` (Joi) via `middlewares/validate.js` |
| Config | `AddOn_backend/src/config/config.js` |

Typical call: `routes/v1/<feature>.route.js` → `controllers/<feature>.controller.js` → `services/<feature>.service.js` → Mongoose model. Not every route uses `validate()` or `auth()`.

**Next.js API routes (not the ERP):**

- `Addon_frontend/app/api/auth/set-cookie/route.ts`
- `Addon_frontend/app/api/auth/me/route.ts`
- `Addon_frontend/app/api/qz-tray/sign/route.ts`
- `Addon_frontend/app/api/qz-tray/certificate/route.ts`
- `Addon_frontend/app/api/raw-materials/route.ts`
- `Addon_frontend/app/api/data/route.ts`
- `Addon_frontend/pages/api/auth/logout.ts`

The UI calls the Express base URL (axios). Frontend deps: Next 14.2.1, React 18, Redux Toolkit, Tailwind. No OpenAI SDK on the frontend (`Addon_frontend/package.json`).

### 2. Auth and permissions

Two different systems. They are not the same check.

**A. JWT role rights (backend)**

- Login issues JWT. Strategy: `AddOn_backend/src/config/passport.js` (`jwt` strategy). Secret and expiry: `config.js` `jwt.*`.
- Middleware: `auth(...requiredRights)` in `AddOn_backend/src/middlewares/auth.js`.
- Rights map: `roleRights` in `AddOn_backend/src/config/roles.js`.
- Roles in the enum: `user`, `accounts`, `admin`, `super_admin`, plus WHMS stage roles `floor_supervisor`, `barcode_team`, `scanning_team`, `billing_team`, `dispatch_team` (`roles.js`). The user form only offers `user | accounts | admin | super_admin` (`Addon_frontend/app/users/add/page.tsx`).
- `user` and `super_admin` share the same API right list as far as catalog/production go. `super_admin` rights equal `admin` rights (`roles.js`: `super_admin: adminPermissions`). Those rights are user CRUD, machines, orders, activity logs, help-support, and WHMS stage keys. They do **not** name Knitting Floor, Yarn PO, Sales, etc.
- If `requiredRights` is empty, `auth()` only checks that a JWT user exists.
- WHMS exception: if role rights fail, `hasWhmsApiAccess` (`AddOn_backend/src/utils/whmsNavigationAccess.util.js`) allows the call when `User.navigation` has the matching Warehouse Management toggle. Mapping is only Pick&Pack, Scanning, Billing, Dispatch, Returns.
- Help & Support exception: `hasHelpSupportApiAccess` in `AddOn_backend/src/utils/helpSupportRole.util.js`. Hard-coded super email `admin@addon.in` can manage tickets even if the role would not.

**B. Screen / navigation permissions (what the sidebar uses)**

Stored on the user document, not in a separate permission collection.

- Field: `User.navigation` (`Schema.Types.Mixed`) in `AddOn_backend/src/models/user.model.js`.
- Shape and defaults: `DEFAULT_NAVIGATION` and `ROLE_NAVIGATION_TEMPLATES` in `AddOn_backend/src/utils/navigationHelper.js`.
- Helpers: `getDefaultNavigationByRole`, `mergeNavigation`, `validateNavigationStructure`, `getNavigationPermission(navigation, path)`, `setNavigationPermission`, `backfillMissingReports`.
- Write path: `PATCH /v1/users/:userId/navigation` → `user.service.js` `updateUserNavigationById`. Requires `auth('manageUsers')`.
- New users with no navigation get the role template (`user.service.js` `createUser`).

**Super Admin vs User (navigation template, not API rights):**

- `ROLE_NAVIGATION_TEMPLATES.super_admin = ROLE_NAVIGATION_TEMPLATES.admin` — almost every screen `true`. Help & Support stays `false` in that template.
- `ROLE_NAVIGATION_TEMPLATES.user` — dashboards, Catalog → Items, Sales → All Sales on; production, yarn, warehouse, vendor, reports, users off.
- `accounts` uses the `user` template.
- Templates apply only when navigation is missing at create time. Later edits are per-user. `updateUserNavigationById` merges onto the stored tree and does **not** re-apply the role template (comment in `user.service.js`).

**Where screens are actually enforced:**

- Frontend: `hasPermission` / `hasSubPermission` in `Addon_frontend/shared/contextapi/navigationContext.tsx`. Pages call `useNavigation().hasSubPermission(...)`. Menu: `Addon_frontend/shared/hooks/useNavigationMenu.ts`, path map `Addon_frontend/shared/utils/routeUtils.ts`.
- Next middleware (`Addon_frontend/middleware.ts`) only checks that cookie `accessToken` exists and is not expired, and only for `/dashboard`, `/dashboards`, `/catalog`, `/settings`, `/replenishment`, `/sales`, `/inventory`, `/reports`. Production, yarn, warehouse, and vendor paths are not in `protectedPaths`.
- Backend production routes do not call `auth()` (`AddOn_backend/src/routes/v1/production.route.js` has zero `auth(`). Same for `sales.route.js` (imports `auth`, never calls it), `chatbot.route.js`, `replenishment.route.js`. Yarn routes call `auth()` only in `yarn/yarnReceiving.route.js`. Catalog product routes were not in the `auth(` file list.
- `optionalAuth` (`AddOn_backend/src/middlewares/optionalAuth.js`) runs on every request. It sets `req.user` when a Bearer token is present and never rejects.

**Implication for tools:** a tool that only checks `roleRights` will not match the screen the manager was given. A tool that only trusts the frontend will not match the API, because most production/yarn/sales routes are unauthenticated. Tools must read `req.user.navigation` with `getNavigationPermission` and refuse when the screen boolean is not `true`. That check does not exist for those modules today.

Extra UI role gates (not the navigation tree):

- Knitting On Hold / Short Close buttons: `admin` or `super_admin` only (`Addon_frontend/app/production/floor-supervisor/knitting/page.tsx`).
- Vendor PO create/edit: `hasFullVendorPoRaiseAccess` for `admin` and `super_admin` (`Addon_frontend/app/vendor-po/raise/components/vendorPoRaiseAccess.ts`).
- Activity log UI: `admin` or `super_admin` (`Addon_frontend/app/users/components/UserActivityLogsTab.tsx`).

### 3. Multi-tenancy

No `companyId`, `orgId`, or `tenantId` anywhere under `AddOn_backend` (search of `*.js`). One Mongo database, one user collection. Scoping is “whoever has the JWT / navigation flag”, not a company filter. Tools do not need a tenant predicate. They do need the navigation check above.

### 4. Existing AI code (Replenishment Agent)

This is a sales/store chatbot, not a production or yarn agent.

| Piece | Where |
| --- | --- |
| Provider | OpenAI. Package `openai` `^5.16.0` in `AddOn_backend/package.json`. Key `OPENAI_API_KEY` required in `config.js`. |
| Model used | `gpt-3.5-turbo` in `aiToolService.js` (`detectIntentWithAI`) and `conversation.service.js`. |
| Embeddings | `faq.service.js` `openai.embeddings.create` for FAQ vectors (`faqVector.model.js`). |
| Routes | `POST /v1/chatbot/chat` and helpers in `routes/v1/chatbot.route.js`. **No `auth()`.** Telegram webhook on the same router (`telegramWebhook.controller.js`, `node-telegram-bot-api`). |
| Orchestration | `chatbot.controller.js` `processChatMessage` → `chatbot.service.js` `processMessage`. |
| Intent + “tools” | `services/aiToolService.js`. Keyword routing plus one Chat Completions call that returns JSON intent. Tools return **HTML strings** for the chat UI, not JSON the model can chain. |
| Session | `conversation.service.js` keeps context in a process-local `Map`, cleaned by `setInterval` every 30 minutes. Not in Mongo. |
| Data | Sales, products, stores, replenishment, machines, yarn catalog/PO/inventory/transactions/requisitions/issue/return, articles. Direct model queries and some service calls (`replenishment.service.js`, `analytics.service.js`, `product.service.js`). |
| Replenishment math | `models/replenishment.model.js` + `POST /v1/replenishment/calculate`. Methods enum: `moving_average`, `weighted_average`, `seasonal_adjustment`. Route also has no `auth()`. |
| UI | Sidebar “Replenishment Agent” → `/replenishment`. Store analysis tab also calls `GET /analytics/store-replenishment` (`Addon_frontend/app/analytics/store-analysis/[storeId]/page.tsx`). |

Reusable:

- OpenAI client setup and `OPENAI_API_KEY` config.
- The idea of a named function per question inside `aiToolService.js` (`getLiveInventory`, `getYarnInventory`, `getArticlesByOrder`, `getYarnPurchaseOrders`, `getSalesReport`, …).
- Do not reuse the HTML responses, the unauthenticated route, `gpt-3.5-turbo` intent JSON, or the in-memory session as the new tool runtime.

`aiToolService.js` is about 7k+ lines. Treat it as a legacy chat surface, not as the typed tool registry.

### 5. Activity logs

`UserActivityLog` — `AddOn_backend/src/models/userActivityLog.model.js`.

- Middleware `userActivityLog` (`AddOn_backend/src/middlewares/userActivityLog.js`) is mounted on the whole `/v1` router (`routes/v1/index.js`).
- On `res.finish`, if `req.user._id` is set, it writes method, path, route, status, inferred action (`create|read|update|delete|list|login|logout|other`), resource, resourceId, durationMs, ip, userAgent, sanitized body (`requestMeta`). Passwords/tokens stripped.
- Skips `/v1/auth/login` and `/v1/auth/register`.
- Indexes: `userId`, `path`, `createdAt`, compounds. **TTL 30 days** (`expireAfterSeconds`).
- Query API: `routes/v1/userActivityLog.route.js` (this file does use `auth(`).

Separate production trail: `ArticleLog` (`models/production/articleLog.model.js`) with `LogAction` enum in `models/production/enums.js`. `userId` and `floorSupervisorId` and `orderId` / `articleId` are **strings**, not `User` / `Article` refs.

Yarn PO and vendor PO keep `statusLogs` on the PO document.

This middleware is a poor AI audit log: it misses unauthenticated calls (no `req.user`), drops bodies on GET, and deletes rows after 30 days. Reuse the schema shape if you want, but AI traces need their own collection and no TTL that short.

### 6. Tests

- Jest 26, `supertest`, `AddOn_backend/jest.config.cjs`. `testEnvironment: node`, `NODE_ENV=test`.
- Run from `AddOn_backend`: `npm test` (`jest -i --colors --verbose --detectOpenHandles`). Coverage: `npm run coverage`.
- DB: `config.js` appends `-test` to `MONGODB_URL` when `NODE_ENV=test`. `tests/utils/setupTestDB.js` connects and **`deleteMany()` on every collection before each test**. No in-memory Mongo, no checked-in dump.
- Tests live in `AddOn_backend/tests/unit/**` and `tests/integration/**`. Fixtures: `tests/fixtures/user.fixture.js`, `token.fixture.js`, `yarnManagement.fixture.js`.
- Many `package.json` scripts (`test:production-flow`, `seed:*`, `report:*`) are one-off scripts against the **development** database, not Jest. Do not point tool tests at those.

### 7. Background jobs / events

No queue library (no Bull, Bee, Agenda). No app-wide `EventEmitter` on status changes. Status changes are direct service/model writes.

`cron` package `^4.3.3`. Started in `index.js`:

| Job | File | Schedule | What it does |
| --- | --- | --- | --- |
| Order sync | `src/cron/orderSync.cron.js` | `ORDER_SYNC_CRON_SCHEDULE` or `*/30 * * * *` UTC | `order.service.js` `syncOrdersFromAllSources` for last 24h. Marketplace `Order` model, not production orders. |
| Website outbound | `src/cron/websiteOrderOutbound.cron.js` | `WEBSITE_ORDER_OUTBOUND_CRON` or `*/2 * * * *` Asia/Kolkata | `websiteOrderOutbound.service.js` `processOutboundQueue`. Collection `WebsiteOrderOutboundQueue` statuses `pending|sent|failed|dead`. Disabled with a warning if `ADDONWEB_BASE_URL` or `WEBSITE_ORDER_SYNC_API_KEY` is empty. |
| Yarn daily snapshot | `src/cron/yarnDailySnapshot.cron.js` | only if `YARN_DAILY_SNAPSHOT_ENABLED=true`. Default `0 0 * * *` Asia/Kolkata | Upserts `YarnDailyClosingSnapshot.closingKg` from **current** physical kg (`physicalKgPerYarn.js`). Comment in file: backfill labels a date but still writes today’s stock. |

`conversation.service.js` `setInterval` is process memory cleanup, not a domain event.

Hooking “order moved to a floor” means wrapping the floor transfer functions in `services/production/article.service.js` (and vendor equivalent `vendorProductionFlow.service.js`). There is no single status service.

---

## Part 2 — Data model map

Units are stated only when the schema or a comment in that file says so. “No unit field” means the number is bare.

### Identity and audit

**User** — `AddOn_backend/src/models/user.model.js`  
Fields: `name`, `email` (unique), `password` (private, bcrypt), `phoneNumber`, `role` (see Part 1), `navigation` (Mixed). No link to `TeamMaster`.

**UserActivityLog** — `models/userActivityLog.model.js`  
See Part 1.5. `userId` → `User`.

**Token** — `models/token.model.js`  
Refresh / reset-password / verify-email tokens.

**HelpSupportTicket** — `models/helpSupport/ticket.model.js`  
Closest thing to a task. `status`: `raised`, `pending`, `in_progress`, `in_review`, `on_hold`, `awaiting_user`, `resolved`, `reopened`, `closed`, `cancelled`. `assignedTo` → `User`, `raisedBy` → `User`. Not a production floor task.

### Master catalog

**Product** (Items) — `models/product.model.js`  
`name`, `softwareCode` (unique), `internalCode`, `vendorCode`, `factoryCode` (not unique, not indexed), `knittingCode`, `styleCodes[]` → `StyleCode`, `productionType` `internal|outsourced`, `category` → `Category`, `attributes` Map, `status` `active|inactive`.

- `bom[]`: `yarnCatalogId` → `YarnCatalog`, `yarnName` snapshot, `quantity` (no unit).
- `rawMaterials[]`: `rawMaterialId` → `RawMaterial`, `quantity` (no unit).
- `processes[]`: `processId` → `Process`.

Article identity is `Article.articleNumber === Product.factoryCode` (pre-save in `article.model.js`). There is no `productId` on Article.

**Category** — `models/category.model.js` — `status` `active|inactive`.

**RawMaterial** — `models/rawMaterial.model.js` — `unit` is a free string (kg, meters, pcs, whatever was typed). Also `groupName`, `type`, `countSize`, `material`, `color`, `shade`, `mrp` (string), `hsnCode`, `gst` (string).

**Process** — `models/process.model.js` — `name`, `type`, `status` `active|inactive`, steps with `duration` in **minutes** (comment on the field).

**ProductAttribute** — `models/productAttribute.model.js` — `category` `Manufacturing|Warehouse`, input `select|radio|checkbox|text|textarea`.

**StyleCode** — `models/styleCode.model.js` — `styleCode` unique, `eanCode`, `mrp` (number, currency not named in schema), `brand`, `pack`, `status` `active|inactive`.  
`bom[]` is **raw material** + `quantity`, not yarn. Different BOM from `Product.bom`.

**StyleCodePairs** — `models/styleCodePairs.model.js` — `status` `active|inactive`. Pairs two style codes (see file for the two sides).

**Machine** — `models/machine.model.js` — `status` `Active|Under Maintenance|Idle`. Maintenance interval enum `1 month|3 months|6 months|12 months`. Needle config lives on the machine (used by assignments).

**TeamMaster** — `models/production/teamMaster.model.js` collection `team_masters`  
`teamMemberName`, `contactNumber`, `workingFloor` = `ProductionFloor` enum, `role` `Supervisor|Team Member`, `status` `Active|Inactive`, `myTeam[]` → `TeamMaster`, `articleData[].activeArticle` → `Article`, `barcode`. **No `userId`.** Floor staff in this collection are not login users unless names happen to match.

**ContainersMaster** — `models/production/containersMaster.model.js`  
`ContainerStatus` `Active|Inactive`. `ContainerType` `bag|bigContainer|container` (comment: bag 1–300, bigContainer 301–500, container 501+).

**YarnCatalog** — `models/yarnManagement/yarnCatalog.model.js`  
`yarnName`, embedded snapshots of yarn type / subtype / count-size / blend / color (`status` on embeds `active|inactive|deleted`), `pantonShade`, `pantonName`, `season`, `gst` (percent), `hsnCode`, `minQuantity` (no unit), flags `linking`, `sampling`, `status` `active|inactive|suspended`.  
No `schema.index()` in this file. Lookup by name is a scan unless you add one. Post-find hooks still tolerate legacy ObjectId embeds.

**Yarn master lookups** — `models/yarnManagement/`:

- `supplier.model.js` — brand/supplier. Status `active|inactive|deleted` and a second status `active|inactive|suspended`.
- `yarnType.model.js`, `countSize.model.js`, `blend.model.js`, `color.model.js` — `active|inactive` (yarn type also `deleted`).

### Sales, stores, analytics

**Sales** — `models/sales.model.js`  
`date`, `plant` → `Store`, `materialCode` → `Product`, `quantity` (no unit), `mrp`, `discount`, `gsv`, `nsv`, `totalTax` (currency not named; chatbot HTML uses ₹).  
**No indexes** on `date` or `materialCode`. Six-month item sales will scan.

**SealsExcelMaster** — `models/sealsExcelMaster.model.js`  
Uploaded sales Excel. Status `pending|processing|completed|failed`. (Filename spelling is `seals`, screen is “Master Sales”.)

**Store** — `models/store.model.js` — grade enum `A+` … `F`.

**Forecast** / **Replenishment** — `models/forecast.model.js`, `models/replenishment.model.js` — method `moving_average|weighted_average|seasonal_adjustment`.

**Order** (marketplace, not production) — `models/order.model.js`  
Payment-ish status `pending|completed|failed|refunded`. Fulfilment `pending|picked|packed|shipped|delivered|cancelled`. Source `Website|Amazon|Flipkart|Blinkit`. Order status `pending|processing|completed|cancelled|refunded`. This is what `orderSync.cron.js` fills. Do not use it for “production order X”.

### Production

Enums: `AddOn_backend/src/models/production/enums.js`.

**Order status** (`OrderStatus`): `Pending`, `In Progress`, `Completed`, `On Hold`, `Short Close`, `Cancelled`.

**Priority**: `Urgent`, `High`, `Medium`, `Low`.

**LinkingType**: `Auto Linking`, `Rosso Linking`, `Hand Linking`.

**ProductionFloor**: `Knitting`, `Linking`, `Checking`, `Washing`, `Boarding`, `Silicon`, `Secondary Checking`, `Branding`, `Re-Boarding`, `Final Checking`, `Warehouse`, `Dispatch`.

**QualityCategory**: `M1`, `M2`, `M3`, `M4`.

**RepairStatus**: `Not Required`, `In Review`, `Repaired`, `Rejected`.

**M2 entry status**: `OPEN`, `PARTIAL`, `RESOLVED`.

**M2 log type**: `ENTRY`, `MERGE_TO_M1`, `TRANSFER_TO_M3`, `TRANSFER_TO_M4`.

**M3/M4 log type**: `ENTRY`, `OUTWARD`.

**Yarn issue/return on a machine queue row**: `Pending`, `In Progress`, `Completed`.

**ProductionOrder** — `models/production/productionOrder.model.js` collection `production_orders`  
`orderNumber` unique, `priority`, `status`, `articles[]` → `Article`, `currentFloor`, `orderNote`, `createdBy` / `lastModifiedBy` → `User`.  
Indexes: `orderNumber`, `status`, `priority`, `currentFloor`, compound `{ currentFloor, status, createdAt }`.  
`currentFloor` is recomputed in pre-save from article floors. Static `getOrdersByFloor`.

**Article** — `models/production/article.model.js` (~1900 lines)  
`id` string unique, `orderId` → `ProductionOrder`, `articleNumber` (= product `factoryCode`), `knittingCode`, `plannedQuantity` (pieces; code comments say “units”, no unit enum), `linkingType`, `priority`, `status` (same `OrderStatus`), `progress` percent, `brandingType` `Heat Transfer|Embroidery`, `machineId` → `Machine`.  
`currentFloor` on the article schema is **commented out**. Order-level `currentFloor` still exists. `yarnEstimation.service.js` still reads `article.currentFloor` inside `buildArticleFloorProgress`. That field will be empty on current documents unless something else sets it (not in the schema). Floor position is `floorQuantities`.

`floorQuantities.<floorKey>` for `knitting`, `linking`, `checking`, `washing`, `boarding`, `silicon`, `secondaryChecking`, `branding`, `reBoarding`, `finalChecking`, and dispatch/warehouse keys further down the same schema. Common counters, all **pieces**:

- `received`, `completed`, `remaining`, `transferred`
- QC floors add `m1Quantity`, `m2Quantity`, `m3Quantity`, `m4Quantity`, `m1Transferred`, `m1Remaining`, `m2Transferred`, `m2Remaining`, `repairStatus`, `repairRemarks`
- Knitting adds `m4Quantity` and `weight` (comment: “e.g. kg”)
- Linking/washing add `repairReceived`
- Later floors store `transferItems[]` with `styleCode` (brand/style split)

“On floor now” is not one field. For a non-QC floor the useful on-hand is `received - transferred` or `remaining` (the service keeps `remaining` in sync). QC floors split good (M1) vs M2/M3/M4. Do not sum `completed` across floors.

**ArticleLog** — `models/production/articleLog.model.js`  
`action` = `LogAction` (long enum in `enums.js`, includes every floor transfer and M1–M4 update). `quantity` pieces. `fromFloor`, `toFloor`. `userId` and `floorSupervisorId` are strings. `orderId` and `articleId` are strings.

**FloorStatistics** — `models/production/floorStatistics.model.js`.

**MachineOrderAssignment** — `models/production/machineOrderAssignment.model.js` collection `machine_order_assignments`  
One doc per machine + `activeNeedle`. `productionOrderItems[]`: `productionOrder`, `article`, `status` (`OrderStatus`), `yarnIssueStatus`, `yarnReturnStatus`, numeric `priority`. `isActive`. This is the knitting queue, not a user task list.

**M2Log / M3Log / M4Log** — `models/production/m2Log.model.js`, `m3Log.model.js`, `m4Log.model.js`.  
M2 source floors in code: Checking, Secondary Checking, Final Checking (`m2Management.service.js` `M2_QC_FLOORS`). M2 can merge back to M1 or move to M3/M4.

**DispatchStockTransferNote** — `models/production/dispatchStockTransferNote.model.js`.

### Yarn

**YarnRequisition** — `models/yarnReq/yarnRequisition.model.js`  
`yarnCatalogId` → `YarnCatalog`, `minQty`, `availableQty`, `blockedQty` (no unit on the schema), `alertStatus` `null|below_minimum|overbooked`, `poSent`, `draftForPo`, `preferredSupplierId` → `Supplier`, `dismissed`, `linkedPurchaseOrderId` / `attachedDraftPoId` → `YarnPurchaseOrder`.  
List + live stock: `services/yarnManagement/yarnReq.service.js` `getYarnRequisitionList` (`includeLiveStock`). Draft PO: `yarnRequisitionDraftMerge.helper.js` `mergeRequisitionLineIntoDraftPo` / `createDraftPurchaseOrderForRequisition`.

**YarnPurchaseOrder** — `models/yarnReq/yarnPurchaseOrder.model.js`  
PO `status`: `draft`, `submitted_to_supplier`, `in_transit`, `goods_partially_received`, `goods_received`, `qc_pending`, `po_rejected`, `po_accepted`, `po_accepted_partially`, `returned_to_vendor`.  
Lot `status`: `lot_pending`, `lot_qc_pending`, `lot_rejected`, `lot_accepted`, `lot_returned_to_vendor`.  
Line: `yarnCatalogId`, `quantity`, `rate`, `gstRate`, `estimatedDeliveryDate`, `sourceRequisitionId`. Lot weights: comment on `netWeight` says **kg**; `totalWeight` is gross. `numberOfCones`, `numberOfBoxes`. `poItems.quantity` itself has no unit comment.

**YarnGrn** — `models/yarnReq/yarnGrn.model.js` — `status` `active|superseded|voided`. Snapshot of the printed GRN. `purchaseOrder` ref.

**YarnBox** — `models/yarnReq/yarnBox.model.js`  
`boxId`, `poNumber` (string, not an ObjectId), `yarnCatalogId`, `yarnName`, `boxWeight`, `initialBoxWeight`, `grossWeight`, `tearweight`, `numberOfCones`, `storageLocation`, `storedStatus` boolean, `returnedToVendorAt`, `atVendorAt` (processor, not PO return), `vendorShipmentId` → `YarnVendorShipment`.  
No box status enum. “In stock” is a filter in `yarnStockActiveFilters.js` (`activeYarnBoxMatch`), not a field. Weights are the same kg family as cones (used by `computePhysicalKgMap`).

**YarnCone** — `models/yarnReq/yarnCone.model.js`  
`coneWeight`, `tearWeight` (kg family), `yarnCatalogId` required, `boxId` string, `poNumber` string, `orderId` optional → production order.  
`issueStatus`: `issued|not_issued|used|returned_to_vendor`. Unavailable for stock: `issued`, `used`, `returned_to_vendor`.  
`returnStatus`: `returned|not_returned`.

**YarnInventory** — `models/yarnReq/yarnInventory.model.js`  
One row per `yarnCatalogId`. Buckets `totalInventory`, `longTermInventory`, `shortTermInventory`: `totalWeight`, `totalTearWeight`, `totalNetWeight`, `totalBlockedWeight`, `numberOfCones`. `blockedNetWeight`. `inventoryStatus` `in_stock|low_stock|soon_to_be_low`. `overbooked`.  
This is a **rollup**. Live kg is recomputed from boxes and cones (`yarnInventory.service.js` `computeInventoryFromStorage`, `physicalKgPerYarn.js` `computePhysicalKgMap`). **SUPERSEDED:** do not call `computePhysicalKgMap` or `computeInventoryFromStorage` for current stock. Live stock is `getInventoryBreakdownForCatalogIds`. See `docs/ai/DOMAIN.md`.

**YarnTransaction** — `models/yarnReq/yarnTransaction.model.js`  
Types: `yarn_issued`, `yarn_issued_linking`, `yarn_issued_sampling`, `yarn_blocked`, `yarn_stocked`, `internal_transfer`, `yarn_returned`, `yarn_sent_to_vendor`, `yarn_received_from_vendor`.  
Weights: `transactionNetWeight`, `transactionTotalWeight`, `transactionTearWeight`, `transactionConeCount`. `orderId` → `ProductionOrder`, `articleId` → `Article`.

**YarnFloorIssueBatch** — `models/yarnReq/yarnFloorIssueBatch.model.js` — `purpose` `linking|sampling`.

**YarnPoVendorReturn** / **YarnPoReturnChallan** — return to supplier. Challan line type `cone|box`. Cancellation `partial|full_po`.

**YarnVendorShipment** — yarn sent to a processor and received back (`atVendorAt` on the box).

**YarnDailyClosingSnapshot** — `snapshotDate`, `yarnCatalogId`, `closingKg` (**kg**), `source`.

**StorageSlot** — `models/storageManagement/storageSlot.model.js`. Long-term section codes used by box barcode matching (`LT_SECTION_CODES`).

**YarnOrder** — `models/yarnManagement/yarnOrder.model.js`  
Legacy. Line points at `YarnType`, not `YarnCatalog`. Status `accepted|rejected|hold|pending`. `toJSON` plugin still special-cases the name. Not the live PO (`YarnPurchaseOrder` is).

### Vendor PO

**Vendor** — `models/vendor.model.js` — `status` `active|inactive`.

**VendorManagement** — `models/vendorManagement/vendorManagement.model.js` — `status` `active|inactive`. Second vendor master. Confirm with the screen which collection “Vendor List” writes before a tool queries it (open question in Part 5). Routes under `/v1/vendor-management` use `VendorManagement`. `/v1/vendors` uses `vendor.route.js`.

**VendorPurchaseOrder** — `models/vendorManagement/vendorPurchaseOrder.model.js`  
Status: `draft`, `submitted_to_vendor`, `in_transit`, `goods_partially_received`, `goods_received`, `qc_pending`, `po_rejected`, `po_accepted`, `po_accepted_partially`.  
Lot: `lot_pending|lot_qc_pending|lot_rejected|lot_accepted`.  
Line: `productId` → `Product`, `quantity` (pieces, no unit field), `rate`, `type`, `color`, `pattern`.

**VendorGrn**, **VendorBox**, **VendorProductionFlow** — parallel to in-house floors but the flow document stores floor qty itself (`vendorFloorQuantity.embed.js`). Floors in services: secondary checking, branding, re-boarding, final checking, dispatch. Same M1–M4 idea. M2 sources: `secondaryChecking`, `finalChecking`.

**Vendor M2/M3/M4 logs** — `vendorM2Log.model.js`, `vendorM3Log.model.js`, `vendorM4Log.model.js`.

### WHMS

**WarehouseOrder** (live) — `models/whms/warehouseOrder.model.js`  
Coarse `status`: `draft`, `pending`, `in-progress`, `packed`, `dispatched`, `cancelled`.  
Fine `flowStatus`: `order-created`, `picking`, `picking-done`, `barcode-in-progress`, `packing-done`, `sent-to-scanning`, `scanning-in-progress`, `scanning-done`, `sent-to-billing`, `billed`, `ready-to-dispatch`, `dispatched`, `partial-dispatched`, `ready-for-pickup`, `delivered`, `cancelled`.  
`coarseStatusForFlowStatus` maps fine → coarse. Items: `singlePair` | `multiPair`. Client type from `WarehouseClient`.

**WhmsOrder** (legacy) — `models/whms/whmsOrder.model.js`  
Still has a service (`services/whms/order.service.js`) and routes `whms/order.route.js`. Status `pending|in-progress|packed|dispatched|cancelled`. `clear-whms-orders.js` calls it legacy. Gap report and consolidation still query it. Do not mix with `WarehouseOrder`.

**WarehouseInventory** — `models/whms/warehouseInventory.model.js` collection **`stocks`**.  
One row per `styleCode`. `itemId` → `Product` optional, `styleCodeId` → `StyleCode`, `totalQuantity`, `blockedQuantity`, `availableQuantity` (derived `total - blocked`), `damagedQuantity` (not saleable). **Pieces.** No kg.

**WarehouseInventoryLog**, **InwardReceive**, **InwardRecord** (`pending|partial|received|qc-pending|completed`), **PickList**, **PickListBatch** (`mode` `all|custom`), **ScanSession**, **WhmsInvoice**, **WarehouseReturn**, **WarehouseClient** (`active|inactive`), **VarianceApproval**, **DispatchApproval**, **ConsolidationBatch** (`draft|ready|dispatched`), **FactoryRequirement**.

### Relationships

```
Product.factoryCode = Article.articleNumber
Product.bom[] → YarnCatalog (qty, unit not stored)
Product.rawMaterials[] → RawMaterial (RawMaterial.unit is free text)
Product.processes[] → Process → floor sequence
Product.styleCodes[] → StyleCode
StyleCode.bom[] → RawMaterial   (not yarn)

ProductionOrder.articles[] → Article
Article.floorQuantities.{knitting…dispatch} = pieces on that floor
Article.machineId → Machine
MachineOrderAssignment.productionOrderItems → ProductionOrder + Article

YarnCatalog
  ← YarnRequisition (min / available / blocked)
  ← YarnPurchaseOrder lines
  ← YarnBox / YarnCone (physical kg)
  ← YarnInventory (rollup)
  ← YarnTransaction (issue, return, block, stock)
  ← YarnDailyClosingSnapshot.closingKg

Yarn PO → lots → YarnGrn (snapshot) → YarnBox → cones
Issue: YarnCone.issueStatus=issued + YarnTransaction.yarn_issued → ProductionOrder / Article
Return: YarnTransaction.yarn_returned + cone returnStatus
PO return: YarnPoVendorReturn → challan
Processor: YarnVendorShipment (not the same as PO return)

VendorManagement / Vendor
VendorPurchaseOrder lines → Product
VendorProductionFlow floors + VendorBox
Vendor GRN

WHMS: WarehouseOrder → pick list → scan session → invoice → dispatch
Stock: WarehouseInventory by StyleCode (collection `stocks`)
InwardReceive brings production/vendor goods into that stock
WebsiteOrderOutboundQueue pushes warehouse status to addonweb

TeamMaster.workingFloor + articleData → Article
TeamMaster is not User
HelpSupportTicket.assignedTo → User   (support tickets only)
```

### Confusing / likely unused

| Issue | Evidence |
| --- | --- |
| Two BOMs | `Product.bom` is yarn. `StyleCode.bom` is raw material. |
| Article has no `currentFloor` | Field removed in `article.model.js`. Order still has it. Estimation still reads `article.currentFloor`. |
| Article ↔ product is a string match | `factoryCode`, not an ObjectId. `factoryCode` is not unique and not indexed (`product.model.js`). |
| YarnInventory vs boxes/cones | Rollup can drift. Scripts in `package.json` (`compare:yarn-physical-vs-inventory`, `sync:dataaudit-inventory`) exist because of that. |
| YarnOrder vs YarnPurchaseOrder | Old model refs `YarnType`. Live PO is `yarnReq/yarnPurchaseOrder.model.js`. |
| Order vs ProductionOrder vs WarehouseOrder vs WhmsOrder | Four order collections. Marketplace sync, factory, live WHMS, legacy WHMS. |
| Vendor vs VendorManagement | Two masters, two route prefixes. |
| WarehouseInventory collection name `stocks` | Model name and collection differ. |
| TeamMaster vs User | No foreign key. Assignee scoring cannot join them. |
| ArticleLog ids are strings | `userId` / `articleId` / `orderId` are strings. |
| Navigation key typos | `Purchase Order Recevied`, `Pick&Pack`. Frontend checks the typo (`purchase-order-received/page.tsx`). |
| `DEFAULT_NAVIGATION` in the user schema vs `navigationHelper.js` | User schema default is missing some keys the helper has (`Style Codes`, `Style Code Pairs`, Vendor PO return keys, Re-Boarding on vendor). Helper merge is what create-user uses. Old documents can miss keys. |
| Chatbot “tools” | HTML + no auth + no navigation check. |

---

## Part 3 — Candidate tools

Permission key is the `User.navigation` path `getNavigationPermission` should read. Until backend routes enforce it, the tool layer has to.

WRITE tools have **no existing function** that creates a suggestion. They should call the same draft helpers where those exist, but persist an `AiSuggestion` your new code owns, not submit the PO. Creating that model is out of scope for this report.

Placeholder dashboards skipped.

### Must-cover questions

| Question | Tool | Type | Why this source |
| --- | --- | --- | --- |
| How much of item X was sold in the last 6 months? | `get_item_sales` | READ | `Sales` via `sales.service.js` `querySales`. Sum `quantity` where `materialCode` = product and `date` in range. Also `nsv` / `gsv`. |
| Current stock of item X | `get_whms_stock` | READ | `warehouseInventory.service.js` `getWarehouseInventoryByStyleCode` / `queryWarehouseInventories`. Pieces. Item may have many style codes (`Product.styleCodes`). |
| Current stock of yarn Y | `get_yarn_live_stock` | READ | **SUPERSEDED.** Not `computePhysicalKgMap` / `computeInventoryFromStorage`. Live stock is `getInventoryBreakdownForCatalogIds`. See `docs/ai/DOMAIN.md`. |
| Pieces of order X on each floor | `get_order_floor_qty` | READ | `Article.floorQuantities` for articles on `ProductionOrder.articles`. `order.service.js` / article fetch. Not `Order`. |
| Yarn needed for order X, and do we have it? | `get_order_yarn_requirement` | COMPUTE | `yarnEstimation.service.js` `getYarnEstimationByOrder` gives BOM qty + issued/returned/consumption kg. On-hand kg: **SUPERSEDED**, not `computePhysicalKgMap`. See `docs/ai/DOMAIN.md`. **BOM qty unit is not in the schema** — see risks. |
| How many of article X can we make with current yarn? | `get_buildable_qty` | COMPUTE | Product BOM via `articleNumber` → `Product.factoryCode`, divide available net kg by BOM qty per piece. Blocked because BOM unit is unspecified. |
| Yarns below critical, draft a PO | `list_yarn_below_min` + `suggest_yarn_draft_po` | READ + WRITE | `yarnReq.service.js` `getYarnRequisitionList` with `alertStatus=below_minimum`. Draft helper `createDraftPurchaseOrderForRequisition` already writes a real draft PO — a WRITE tool must **not** call it until a manager approves. |
| Orders stuck / overdue on a floor | `list_overdue_floor_orders` | COMPUTE | `backlogReport.service.js` `getBacklogReport`, `floor.service.js` `getFloorBottleneckAnalysis`. “Overdue” rule is inside the backlog util (`backlogUpcoming.util.js`), not a single `dueDate` on the order (no due date on `ProductionOrder`). |
| Who should handle the pending task on floor X | `suggest_floor_assignee` | COMPUTE | Users with that floor’s navigation flag, ranked by open `ArticleLog` volume and/or `MachineOrderAssignment` queue. `TeamMaster` is not a user. See Part 4. |

Hinglish examples are in the module tables.

### Users

| Tool | Type | Question | Hinglish | Input | Output | Source | Permission | Difficulty |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `list_users_with_screen` | READ | Who can open Knitting Floor? | Knitting floor kaun khol sakta hai? | `navPath` | `userId`, `name`, `role` | `User.find` + `getNavigationPermission` | `Users` | Easy. Query is the missing product feature, logic already exists. |

Activity log reads are a poor workload signal (30-day TTL, path-level). Not listed as a tool.

### Reports

All READ. Permission = the report name under `Reports.*`.

| Tool | Question | Source | Difficulty |
| --- | --- | --- | --- |
| `get_production_order_summary` | Order-wise production status? | `orderSummaryReport.service.js` `getOrderSummaryReport` | Easy |
| `get_daily_production_summary` | What was produced on date D? | Daily production report service under `services/production/` (same reports folder as order summary; confirm the export name when implementing) | Medium. Need the exact service function; screen exists. |
| `get_backlog_report` | What is pending or overdue? | `backlogReport.service.js` `getBacklogReport` | Easy |
| `get_core_report` | Stock, WIP, machines, vendor PO pending in one view? | `coreReport.service.js` | Medium. Wide aggregation. |
| `get_advanced_plan` / `get_needle_plan` | Knitting plan / needle plan? | Planning services used by those screens. Not fully traced in this pass. | Medium |
| `get_vendor_report` | Vendor invoice vs lots? | Vendor report service. Not fully traced. | Medium |

### Master catalog

READ only. Managers rarely need the agent to edit masters. Permission keys under `Catalog.*` and `Yarn Management.Yarn Master.*` / `Cataloguing`.

| Tool | Question | Hinglish | Input | Output | Source | Permission | Difficulty |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `get_item` | What is item X, BOM, processes? | Item X ka BOM kya hai? | `factoryCode` or `name` | product fields, `bom[]` qty **unit unknown**, processes | `Product` | `Catalog.Items` | Easy |
| `get_style_code` | EAN / MRP / raw-material BOM for style? | Style ka MRP aur BOM? | `styleCode` | `mrp`, `bom[]` raw material | `StyleCode` | `Catalog.Style Codes` | Easy |
| `get_yarn_catalog` | Yarn spec and min qty? | Yarn Y ka min kitna hai? | `yarnName` or id | catalog fields, `minQuantity` unit unknown | `YarnCatalog` | `Yarn Management.Cataloguing` | Easy, but name match is unindexed |
| `list_machines` | Which machines are idle? | Kaun si machine idle hai? | `status` | machine, needle, status | `Machine` | `Catalog.Machines` | Easy |

### Sales, stores, analytics, replenishment

| Tool | Type | Question | Hinglish | Input | Output | Source | Permission | Difficulty |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `get_item_sales` | READ | Sold qty and NSV for item in a date range | Pichhle 6 mahine item X kitna bika? | `productId` or code, `from`, `to`, optional `storeId` | `quantity` (no unit), `nsv`, `gsv`, `mrp` | `querySales` | `Sales.All Sales` | Medium. No index on `date`+`materialCode`. |
| `list_stores` | READ | Which stores? | Store list dikhao | search | store, grade | `Store` | `Stores` | Easy |
| `get_store_sales_kpis` | READ | Store sales KPIs | Is store ka sales kaisa hai? | `storeId`, range | charts data the analytics API already returns | `analytics.service.js` | `Analytics` | Medium. Reuse analytics, don’t re-aggregate in the model. |
| `get_replenishment_recs` | COMPUTE | What should this store restock? | Is store ko kya restock chahiye? | `storeId` | priority High/Medium/Low, suggested qty from existing model | `replenishment.service.js` | `Replenishment Agent` | Easy if you call the existing calculate/read. The current chatbot HTML is not the contract. |

`suggest_store_replenishment` as WRITE only makes sense after you define the suggestion document. The current calculate endpoint writes `Replenishment` rows directly. Don’t wrap that as a silent WRITE.

### Production planning and floors

| Tool | Type | Question | Hinglish | Input | Output | Source | Permission | Difficulty |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `get_production_order` | READ | Order header, articles, status, priority | Order X ka status kya hai? | `orderNumber` | status, priority, currentFloor, article ids | `ProductionOrder` | `Production Planning.Production Orders` | Easy |
| `get_order_floor_qty` | READ | Pieces on each floor right now | Order X abhi kis floor pe kitne piece hai? | `orderNumber` | per article, per floor: received, completed, remaining, transferred, m1–m4 (pieces) | `Article.floorQuantities` | same, or the specific floor key if the caller is a floor user | Medium. QC vs non-QC meaning differs. |
| `list_floor_wip` | READ | What is sitting on floor F? | Knitting pe kya pada hai? | floor name | articles with `remaining > 0` or `received > transferred` | `Article` query on `floorQuantities.<key>` | `Production Planning.<Floor> Floor` | Medium. Dynamic field path, no index per floor key seen. |
| `list_overdue_floor_orders` | COMPUTE | Stuck / overdue on a floor | Knitting pe kaun se order atke hain? | floor, optional asOf | order, article, qty, age | `getBacklogReport`, `getFloorBottleneckAnalysis` | `Reports.Backlog report` and/or that floor | Medium. Confirm the overdue definition in `backlogUpcoming.util.js` before exposing it. |
| `get_order_yarn_requirement` | COMPUTE | Yarn needed vs issued vs on-hand | Order X ke liye yarn kitna chahiye, hai kya? | `orderId` | per yarn: `bomQuantity` (unit unknown), issued/returned/consumption **kg**, on-hand **kg**, shortfall kg | `getYarnEstimationByOrder`. On-hand: **SUPERSEDED**, not `computePhysicalKgMap`. See `docs/ai/DOMAIN.md`. | `Production Planning.Production Orders` plus `Yarn Management.Inventory` or `Analytics & reports` | Hard. Two units. Estimation does not itself check live stock. |
| `get_buildable_qty` | COMPUTE | How many pieces of article X from current yarn? | Article X current yarn se kitne banenge? | `articleNumber` | buildable pieces, limiting yarn, available kg, bom qty | Product BOM + physical kg | `Catalog.Items` + yarn inventory screen | Hard. Same unit problem. Also `factoryCode` lookup. |
| `get_knitting_queue` | READ | What is queued on a machine? | Machine pe kaun sa order hai? | `machineId` | items, priority, yarn issue status | `MachineOrderAssignment` | `Production Planning.Knitting Floor` | Easy |
| `get_m2_open` | READ | Open M2 repair qty | M2 me kitna repair pada hai? | optional order/article | qty pieces, status OPEN/PARTIAL/RESOLVED | `m2Management.service.js` | `Production Planning.M2 Management` | Easy |
| `suggest_floor_assignee` | COMPUTE | Who should take the pending work on floor X? | Floor X ka pending kaun kare? | floor, optional order/article | ranked `{userId, name, openSignals}` | Users with that floor nav flag; load from `ArticleLog` string `userId` and knitting queue. Not TeamMaster. | that floor’s screen, plus `Users` if the caller may see names | Hard. No task model, TeamMaster ≠ User, ArticleLog userId is a string. |
| `suggest_hold_or_short_close` | WRITE | Suggest marking an order on hold or short close | Order hold / short close suggest karo | order id, reason | pending suggestion only | UI already limits the real action to admin/super_admin | `Production Planning.Production Orders` and role admin/super_admin | Medium. Do not call the status update. |

Floor screens share one quantity shape, so one `get_order_floor_qty` covers Knitting through Dispatch. Permission should be the floor the user is allowed to see, not “any production user”.

### Yarn management

| Tool | Type | Question | Hinglish | Input | Output | Source | Permission | Difficulty |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `get_yarn_live_stock` | READ | Current yarn stock | Yarn Y ka stock kitna hai? | `yarnCatalogId` or name | long-term kg, short-term kg, cones, blocked kg | **SUPERSEDED.** Not `computeInventoryFromStorage` / `computePhysicalKgMap`. See `docs/ai/DOMAIN.md`. | `Yarn Management.Inventory` (live inventory screen; nav key is `Inventory`, dashboard key is `Dashboard`) | Medium. Physical vs rollup. |
| `list_yarn_below_min` | READ | Which yarns are below critical? | Critical se neeche kaun si yarn hai? | optional supplier | yarn, minQty, availableQty, blockedQty, alertStatus, live kg | `getYarnRequisitionList` | `Yarn Management.Purchase Management.Requisition list` | Easy |
| `get_yarn_po` | READ | PO status, lots, pending qty | PO ka status kya hai? | po number | status, lines, lot status, received kg | `YarnPurchaseOrder` | `Purchase Management.Purchase Order` | Easy |
| `list_yarn_qc_pending` | READ | Lots waiting for QC | QC pending kaun se lot hain? | — | PO, lot, weight kg | lots with `lot_qc_pending` | `Purchase Management.Yarn QC` | Easy |
| `get_yarn_issued_to_order` | READ | Yarn issued to an order | Order pe kitna yarn issue hua? | `orderId` | per yarn issued/returned kg, cones | `getYarnEstimationByOrder` or `YarnTransaction` | `Yarn Management.Yarn Issue.Issue for orders` | Easy |
| `suggest_yarn_draft_po` | WRITE | Draft a PO for yarns below min | Critical yarn ka PO draft banao | yarn ids, supplier id, qty kg | suggestion payload, not a `YarnPurchaseOrder` | Same fields as `createDraftPurchaseOrderForRequisition` | `Purchase Management.Draft POs` or `Requisition list` | Medium. Helper writes a real draft today. Suggestion layer must sit in front of it. |
| `suggest_yarn_issue` | WRITE | Suggest issuing yarn to an order | Order X ko yarn issue suggest karo | order, article, cone/box ids, weight kg | suggestion | Issue service (cone scan / weigh). Do not call it. | `Yarn Issue.Issue for orders` | Hard. Issue path is scan and weight, not a single “issue N kg” function. |

Live Inventory in `MODULES.md` is the stock screen. Nav flags also include `Yarn Management.Dashboard` and `Inventory`. Match the flag the live-inventory page actually checks (`hasSubPermission("/yarn-management", "Dashboard")` on `app/yarn-management/dashboard/full-inventory/page.tsx` and `dashboard/page.tsx`). Confirm which URL is “Live Inventory” before locking the permission key (Part 5).

### Vendor PO

| Tool | Type | Question | Hinglish | Input | Output | Source | Permission | Difficulty |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `list_vendor_pos` | READ | Open vendor POs | Vendor PO kitne pending hain? | status | PO, vendor, product, qty pieces, status | `VendorPurchaseOrder` | `Vendor PO.Vendor PO Raise` | Easy |
| `get_vendor_floor_qty` | READ | Pieces on a vendor floor | Vendor ke final checking pe kitne piece? | PO or flow id, floor | floor qty pieces, M grades | `vendorProductionFlow.service.js` | `Vendor PO.<floor name>` | Medium. Parallel model to in-house articles. |
| `list_vendor_qc_pending` | READ | Vendor lots in QC | Vendor QC me kya pada hai? | — | lot, qty | vendor PO lot status `lot_qc_pending` | `Vendor PO.Vendor PO Receive` | Easy |
| `suggest_vendor_po` | WRITE | Suggest raising a vendor PO | Vendor PO suggest karo | vendor id, product, qty | suggestion | create PO service, do not call it | `Vendor PO.Vendor PO Raise` | Medium |

### WHMS

| Tool | Type | Question | Hinglish | Input | Output | Source | Permission | Difficulty |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `get_whms_stock` | READ | Saleable stock for a style / item | Item X ka warehouse stock? | `styleCode` or article+style | `totalQuantity`, `blockedQuantity`, `availableQuantity`, `damagedQuantity` pieces | `getWarehouseInventoryByStyleCode` | `Warehouse Management.Stock` | Easy. One row per style, not per product. |
| `get_whms_order` | READ | Where is warehouse order in the pipeline? | Warehouse order kis stage pe hai? | order number | `status`, `flowStatus` | `WarehouseOrder` only | `Warehouse Management.Orders` | Easy. Ignore `WhmsOrder` unless you confirm the screen still reads it. |
| `list_whms_orders_by_stage` | READ | What is waiting at scanning / billing / dispatch? | Scanning pe kitne order hain? | `flowStatus` | orders | `WarehouseOrder` | the stage screen (`Scanning`, `Billing`, `Dispatch`, `Pick&Pack`) | Easy |
| `suggest_stock_adjustment` | WRITE | Suggest a stock adjustment | Stock adjust suggest karo | style, delta pieces, reason | suggestion | `updateWarehouseInventoryById` exists; do not call it | `Warehouse Management.Stock` | Medium |

### File manager

Skip for v1. No production decision sits on `fileManager.model.js` (`folder|file`).

---

## Part 4 — Task-assignment readiness

### Is there a task model?

No production task or assignment-to-user model.

What exists:

| Record | What it assigns | User link |
| --- | --- | --- |
| `HelpSupportTicket` | Support ticket | `assignedTo` → `User`. Screen Help & Support, not in `MODULES.md` floors. |
| `MachineOrderAssignment` | Knitting queue row on a **machine** | No user. `yarnIssueStatus` / item `status`. |
| `TeamMaster` | Named people on a floor, optional `activeArticle` | **No User ref.** |
| `ArticleLog` | Who punched a floor action | `userId` and `floorSupervisorId` **strings**. |
| `UserActivityLog` | HTTP calls | `userId` → `User`, 30-day TTL. |

Users see floor work on the floor screens (queue / remaining qty), not in an inbox. Support agents see tickets on Help & Support.

### Users who can open screen X

```js
getNavigationPermission(user.navigation, 'Production Planning.Knitting Floor')
```

`AddOn_backend/src/utils/navigationHelper.js`.

Query: load users and filter in process. `navigation` is Mixed, so “everyone with Knitting Floor” is not a normal Mongo index. `super_admin` is **not** automatically true at read time; only the stored booleans count. A super admin whose document was created from the template will have those booleans true. A user later stripped in the UI will not.

WHMS stage APIs already do this for five keys via `hasWhmsNavigationAccess`. Copy that pattern. Do not copy `roleRights` as the screen check.

Role shortcuts that are not navigation:

- `admin` / `super_admin`: hold and short-close on knitting, full vendor PO raise, activity log screen.
- `accounts`: same nav template as `user`, plus API right `whmsBilling`.

### Workload signals

| Signal | Usable for “who is free”? | Caveat |
| --- | --- | --- |
| Open help tickets per `assignedTo` | Only for support agents | Wrong domain for floors |
| `ArticleLog` count by `userId` in a window | Proxy for who is active on a floor | String id, must match `User._id` string; logs are history, not an open queue |
| `MachineOrderAssignment` items not `Completed` / `Cancelled` | Knitting machine load | Per machine, not per user |
| `TeamMaster.articleData` | Who is scanned onto an article | Not a login user |
| `floor.service.js` `getFloorWorkloadDistribution` | Load **per floor**, not per person | Uses article qty |
| `UserActivityLog` | Recent API usage | 30-day TTL, noisy |

A first scorer can be: users with the floor navigation flag, minus anyone with `TeamMemberStatus` if you later link them, ranked by ArticleLog count on that `fromFloor` over N days. Label it a heuristic.

### Events worth a suggestion

| Event | Where it happens today | Single hook? |
| --- | --- | --- |
| Order/article moved to next floor | `article.service.js` transfer functions (container receive vs direct transfer) | No. Several functions. |
| QC M2/M3/M4 recorded | `m2Management.service.js` and article quality methods | No |
| Yarn below `minQuantity` / requisition `below_minimum` | `yarnTransaction.service.js` updates `YarnRequisition`; list API recalculates | Closest existing signal. Still not an event bus. |
| Yarn PO received / lot QC pending | `yarnPurchaseOrder.service.js` status updates | No bus. Status log is on the document. |
| Vendor PO received | vendor PO service | No bus |
| WHMS flow status change | `warehouseOrder.service.js` and `whmsOrderFlow.service.js` | Two services (live vs legacy) |
| Website status push | `WebsiteOrderOutboundQueue` + cron | Poll, not a domain event |
| Marketplace order sync | `orderSync.cron.js` | Not production |

There is no one service to wrap. Practical hooks: article transfer, yarn requisition upsert, yarn PO status change, warehouse order flow change. Cron can also scan `below_minimum` and backlog on a schedule; nothing in `index.js` does that today.

---

## Part 5 — Risks and open questions

### Risks

1. **Screen permissions are not on the API** for production, sales, catalog, most yarn, and the chatbot. A tool that runs with the service role can read every module. Enforce `getNavigationPermission` inside the tool runner.
2. **Chatbot is unauthenticated** and uses `gpt-3.5-turbo` to pick tools that return HTML. Do not extend it.
3. **No tenant key.** Fine for one company. Do not add a fake `companyId` filter.
4. **Sales 6-month query** has no index on `{ materialCode: 1, date: -1 }` (`sales.model.js`).
5. **Product.factoryCode** is the article join and is not indexed or unique.
6. **YarnCatalog.yarnName** has no index in the schema file.
7. **Floor WIP queries** filter `floorQuantities.<key>.remaining`. Those nested paths are not indexed in the article indexes seen (`status`, `articleNumber`).
8. **SUPERSEDED.** Do not call `computePhysicalKgMap` / `computeInventoryFromStorage` for live yarn stock. Use the Live Inventory helper. See `docs/ai/DOMAIN.md`. `YarnInventory` is still a rollup and is not the stock figure.
9. **BOM quantity has no unit.** Yarn side is kg (GRN `netWeight` comment, snapshot `closingKg`, `physicalKgPerYarn.js`). `Product.bom.quantity` is a bare number. Buildable qty and “yarn needed vs stock” are not safe until you confirm the unit (grams per piece vs kg per piece vs something else).
10. **Article.currentFloor removed** but estimation still reads it. Floor answers must use `floorQuantities`.
11. **Four order models.** Tools must pin `ProductionOrder` vs `WarehouseOrder`.
12. **WhmsOrder still served** by `services/whms/order.service.js` while `clear-whms-orders.js` calls it legacy.
13. **TeamMaster cannot score assignees** until it references `User`.
14. **ArticleLog.userId is a string.** Bad join, easy mismatch.
15. **Activity log TTL 30 days** deletes audit history. AI traces need another collection.
16. **Yarn daily snapshot is not historical** when backfilled (file comment: current stock written under an old date).
17. **Draft PO helper writes real drafts.** `createDraftPurchaseOrderForRequisition` is not a suggestion.
18. **Navigation typos and drift** (`Recevied`, schema default vs helper). Permission checks must use the exact key the UI uses.
19. **Large services.** `article.model.js` and `aiToolService.js` are far past a size you want to import casually. Call small service functions, don’t grow the chat file.

### Questions (not answered in code)

1. What is the unit of `Product.bom.quantity` and of `YarnPurchaseOrder` line `quantity` / `YarnRequisition.minQty`? Kg, grams, or cones?
2. For “on this floor right now”, which number should the agent say: `remaining`, `received - transferred`, or M1 only on QC floors?
3. What date makes a production order “overdue”? `ProductionOrder` has no due date. Is it the backlog report’s rule?
4. Which vendor master does Vendor List use, `Vendor` or `VendorManagement`?
5. Which WHMS order does the Orders screen read, `WarehouseOrder` or `WhmsOrder`?
6. Which navigation key is Live Inventory: `Yarn Management.Dashboard` or `Inventory`? The full-inventory page checks `Dashboard`.
7. Should Team Master people be linked to `User` before assignee suggestions, or are floor logins already the same people under a different name?
8. Is `ArticleLog.userId` always `User._id.toString()`?
9. For item sales, is `Sales.quantity` pieces, and is `materialCode` always the catalog product (not a style code)?
10. May a floor user with only “Knitting Floor” see yarn availability, or must they also have a yarn screen?
11. Should WRITE suggestions be approvable by anyone with the screen, or only `admin` / `super_admin`?
12. Are Catalog / Vendor / Yarn dashboards staying dead, or do they already have routes that `MODULES.md` still calls placeholder?

### Not verified in this pass

- Exact function names for Daily production summary, Advanced Planning, Needle Wise Planning, and Vendor Report (screens exist; the service entry points were not opened line by line).
- Whether `app/api/data/route.ts` and `app/api/raw-materials/route.ts` are still called.
- Runtime data quality (duplicate `factoryCode`, inventory drift). That needs the database, which this pass did not query.
