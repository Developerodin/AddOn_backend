# Help & Support Module

> A ticketing / query-raising module that lets users raise support tickets, lets agents/admins move them through a status lifecycle, tracks **how long** each ticket spends in every status, and rolls everything up into an **Analytics** tab.

- **Module name:** `helpSupport`
- **Backend base path:** `/v1/help-support`
- **Frontend route:** `/help-and-support` (tabs: **Tickets**, **Analytics**)
- **Owner:** TBD
- **Status of this doc:** Spec / design — to be implemented

---

## 1. Overview

The Help & Support screen gives every user a place to **raise a ticket** describing a problem, question, or request. A ticket carries a **title** (required), a **description**, and a list of **points to be covered** (all optional except the title).

Once raised, a ticket flows through a **status lifecycle** (raised → pending → in progress → on hold → resolved → closed, etc.). Independently, it carries a **resolution property / disposition** (e.g. user-set path, completed, pending discussion).

Every status change is recorded in a **history timeline** with timestamps, so the system can compute **how much time a ticket spent in each status** (e.g. time in review, time pending) and the **total lifetime** of the ticket.

The **Analytics** tab aggregates this across all tickets — total tickets, status breakdown, average/total time per status, SLA breaches, and agent workload.

### Goals
- Self-service ticket creation for any authenticated user.
- A clear, auditable status lifecycle with full history.
- Accurate **time-in-status** accounting per ticket and in aggregate.
- An analytics dashboard summarizing time and volume across all tickets.

### Non-goals (v1)
- Email/WhatsApp inbound ticket creation (future).
- Customer-facing public portal (internal users only for v1).
- Automated SLA escalation actions (we record breaches; actions come later).

---

## 2. Roles & Permissions

| Capability | Requester (any user) | Support Agent | Admin |
|---|---|---|---|
| Create ticket | ✅ | ✅ | ✅ |
| View own tickets | ✅ | ✅ | ✅ |
| View all tickets | ❌ | ✅ | ✅ |
| Comment / add note | ✅ (own) | ✅ | ✅ |
| Change status | ❌ | ✅ | ✅ |
| Assign / reassign | ❌ | ✅ (self) | ✅ |
| Set disposition / resolution | ❌ | ✅ | ✅ |
| Delete / archive ticket | ❌ | ❌ | ✅ |
| View Analytics tab | ❌ | ✅ | ✅ |

> Wire these through the existing auth + role middleware (`req.user`, role guard). Reuse the project's `auth()` middleware pattern used by other v1 routes.

---

## 3. Domain Model

### 3.1 Ticket fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `ticketNumber` | String | auto | Human-readable, e.g. `HS-2026-000123`. Unique, sequential. |
| `title` | String | **Yes** | The only required field on creation. Trimmed, max 200. |
| `description` | String | No | Free text. |
| `pointsToBeCovered` | String[] | No | List of bullet points the requester wants addressed. |
| `category` | String (enum) | No | e.g. `bug`, `feature_request`, `how_to`, `data_issue`, `access`, `other`. |
| `priority` | String (enum) | No | `low` \| `medium` \| `high` \| `urgent`. Default `medium`. |
| `status` | String (enum) | auto | Current lifecycle status. Default `raised`. See §4. |
| `disposition` | String (enum) | No | Resolution property / outcome. See §5. |
| `raisedBy` | ObjectId → User | auto | Set from `req.user`. |
| `assignedTo` | ObjectId → User | No | The agent handling it. |
| `attachments` | Object[] | No | `{ fileName, url, size, mimeType }` (reuse fileManager). |
| `tags` | String[] | No | Free-form labels. |
| `statusHistory` | Object[] | auto | Append-only timeline. See §6. |
| `comments` | Object[] | No | Threaded notes. See §3.2. |
| `timeInStatus` | Object | auto/derived | Cached milliseconds per status. See §6.3. |
| `firstResponseAt` | Date | auto | First agent response timestamp (for SLA). |
| `resolvedAt` | Date | auto | When status entered a terminal "resolved/closed". |
| `closedAt` | Date | auto | When fully closed. |
| `totalActiveTimeMs` | Number | derived | Total lifetime excluding paused statuses (see §6.4). |
| `slaDueAt` | Date | No | Optional SLA target. |
| `isDeleted` | Boolean | auto | Soft delete. Default `false`. |
| `createdAt` / `updatedAt` | Date | auto | Mongoose timestamps. |

### 3.2 Comment sub-document

```js
{
  _id: ObjectId,
  author: ObjectId,        // User
  body: String,            // required
  attachments: [ ... ],
  isInternal: Boolean,     // internal note vs visible to requester
  createdAt: Date,
}
```

---

## 4. Status Lifecycle

`status` is the **current stage** of the ticket. Full enum:

| Status | Meaning | Counts as "active" time? |
|---|---|---|
| `raised` | Newly created, not yet picked up | Yes |
| `pending` | Acknowledged, awaiting triage/assignment | Yes |
| `in_progress` | Agent actively working | Yes |
| `in_review` | Work done, under review / verification | Yes |
| `on_hold` | Paused (waiting on a dependency) | **No** (paused) |
| `awaiting_user` | Waiting for requester reply | **No** (paused, clock-stop for SLA) |
| `resolved` | Solution delivered, pending requester confirmation | Yes |
| `reopened` | Requester rejected the resolution | Yes |
| `closed` | Terminal — done | — (terminal) |
| `cancelled` | Terminal — withdrawn/duplicate | — (terminal) |

### 4.1 Allowed transitions

```
raised      → pending, in_progress, cancelled
pending     → in_progress, on_hold, awaiting_user, cancelled
in_progress → in_review, on_hold, awaiting_user, resolved, cancelled
in_review   → in_progress, resolved
on_hold     → in_progress, pending, cancelled
awaiting_user → in_progress, pending, cancelled
resolved    → closed, reopened
reopened    → in_progress, on_hold
closed      → reopened            (within reopen window, e.g. 7 days)
cancelled   → (terminal)
```

> Enforce transitions in the service layer with a transition map; reject illegal jumps with a `400`.

---

## 5. Disposition (Resolution Property)

`disposition` is **independent of status** — it captures *how/why* a ticket is being handled or was resolved. The requester is not the one setting it; agents/admins do.

Enum:

| Disposition | Meaning |
|---|---|
| `unset` | Default, not yet categorized |
| `user_set_path` | Agent guided the user to the correct path/flow; user to proceed |
| `completed` | Work fully completed |
| `pending_discussion` | Needs further discussion before action |
| `needs_more_info` | Blocked on requester input |
| `duplicate` | Duplicate of another ticket (link via `relatedTicket`) |
| `not_reproducible` | Could not reproduce |
| `wont_fix` | Acknowledged, intentionally not actioned |
| `deferred` | Valid, scheduled for later |
| `escalated` | Escalated to another team |

> `status` answers *“where is it in the pipeline?”*; `disposition` answers *“what's the outcome/handling?”*. Both are tracked and both appear in analytics.

---

## 6. Time Tracking & History

This is the core of the module: **measure how long a ticket spends in each status**.

### 6.1 `statusHistory` (append-only)

Every status change pushes an entry:

```js
{
  _id: ObjectId,
  fromStatus: String | null,   // null on creation
  toStatus: String,
  changedBy: ObjectId,         // User
  note: String,                // optional reason
  enteredAt: Date,             // when toStatus began
  exitedAt: Date | null,       // set when the NEXT change happens; null = current
  durationMs: Number | null,   // exitedAt - enteredAt, set on exit
}
```

- On **create**: push `{ fromStatus: null, toStatus: 'raised', enteredAt: now, exitedAt: null }`.
- On **status change**: close the open entry (`exitedAt = now`, compute `durationMs`), then push a new open entry for the new status.
- The currently-open entry (`exitedAt === null`) represents the live status; its running duration is `now - enteredAt`.

### 6.2 Disposition history (optional, same shape)

Track `dispositionHistory` with the same pattern if disposition timing matters; otherwise just store current `disposition` + a `dispositionChangedAt`.

### 6.3 `timeInStatus` cache

A denormalized map for fast reads and analytics, updated on every transition:

```js
timeInStatus: {
  raised:        Number,  // ms
  pending:       Number,
  in_progress:   Number,
  in_review:     Number,
  on_hold:       Number,
  awaiting_user: Number,
  resolved:      Number,
  reopened:      Number,
}
```

> On read of an **open** ticket, add the live running duration of the current status on top of the cached value so the UI shows real-time numbers.

### 6.4 Derived totals

- **`totalLifetimeMs`** = `now (or closedAt) - createdAt`.
- **`totalActiveTimeMs`** = sum of `timeInStatus` for statuses where *"counts as active"* = Yes (excludes `on_hold`, `awaiting_user`). Used for SLA.
- **`timeToFirstResponseMs`** = `firstResponseAt - createdAt`.
- **`timeToResolutionMs`** = `resolvedAt - createdAt`.

### 6.5 Computation helper

A single service function `recordTransition(ticket, toStatus, user, note)` must:
1. Validate the transition against the transition map.
2. Close the open `statusHistory` entry (set `exitedAt`, `durationMs`).
3. Increment `timeInStatus[fromStatus]` by that `durationMs`.
4. Push the new open `statusHistory` entry.
5. Update derived fields (`firstResponseAt`, `resolvedAt`, `closedAt`) when relevant.
6. Save atomically.

---

## 7. Analytics

The **Analytics tab** in Help & Support aggregates across all tickets (filterable by date range, agent, category, priority).

### 7.1 Summary cards
- Total tickets (and new in range).
- Open vs resolved vs closed counts.
- Average **time to first response**.
- Average **time to resolution**.
- SLA breach count / breach rate.

### 7.2 Time summaries (the headline ask)
- **Total time across all tickets** (sum of lifetimes).
- **Aggregate time-in-status**: total + average ms spent in each status across all tickets (e.g. "total time in review", "total time pending", "total time on hold").
- **Per-ticket totals** table: total time, active time, time in review, time pending — sortable.

### 7.3 Breakdowns
- Tickets by **status** (bar/pie).
- Tickets by **disposition**.
- Tickets by **priority** and **category**.
- **Agent workload**: open tickets per agent, avg resolution time per agent.
- Trend over time: created vs resolved per day/week.

### 7.4 Aggregation approach
Use a Mongo aggregation pipeline over the `Ticket` collection:
- `$group` on `status` summing `timeInStatus.<status>` for status totals.
- `$group` global for averages of `timeToResolutionMs`, `timeToFirstResponseMs`.
- Apply `$match` for date range / filters first.
- Precompute heavy rollups in a daily cron if volume grows.

---

## 8. Backend Implementation

Follow existing project conventions (ESM, `controller → service → model`, Joi validation, `toJSON` + `paginate` plugins, `catchAsync`, `ApiError`).

### 8.1 Files to add

```
src/models/helpSupport/ticket.model.js
src/services/helpSupport/ticket.service.js          # CRUD + recordTransition + comments
src/services/helpSupport/ticketAnalytics.service.js # aggregation pipelines
src/controllers/helpSupport/ticket.controller.js
src/controllers/helpSupport/ticketAnalytics.controller.js
src/validations/helpSupport/ticket.validation.js
src/routes/v1/helpSupport/ticket.route.js
src/routes/v1/helpSupport/index.js
```

Register the router in `src/routes/v1/index.js`:

```js
import helpSupportRoute from './helpSupport/index.js';
// ...
{ path: '/help-support', route: helpSupportRoute },
```

Add the model export in `src/models/index.js`.

### 8.2 Mongoose model sketch

```js
import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

export const TICKET_STATUS = [
  'raised', 'pending', 'in_progress', 'in_review',
  'on_hold', 'awaiting_user', 'resolved', 'reopened', 'closed', 'cancelled',
];

export const TICKET_DISPOSITION = [
  'unset', 'user_set_path', 'completed', 'pending_discussion', 'needs_more_info',
  'duplicate', 'not_reproducible', 'wont_fix', 'deferred', 'escalated',
];

const statusHistorySchema = new mongoose.Schema({
  fromStatus: { type: String, enum: [...TICKET_STATUS, null], default: null },
  toStatus:   { type: String, enum: TICKET_STATUS, required: true },
  changedBy:  { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
  note:       { type: String, trim: true },
  enteredAt:  { type: Date, required: true },
  exitedAt:   { type: Date, default: null },
  durationMs: { type: Number, default: null },
}, { _id: true });

const commentSchema = new mongoose.Schema({
  author:     { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true },
  body:       { type: String, required: true, trim: true },
  attachments:[{ fileName: String, url: String, size: Number, mimeType: String }],
  isInternal: { type: Boolean, default: false },
}, { _id: true, timestamps: { createdAt: true, updatedAt: false } });

const ticketSchema = new mongoose.Schema({
  ticketNumber:      { type: String, unique: true, index: true },
  title:             { type: String, required: true, trim: true, maxlength: 200 },
  description:       { type: String, trim: true },
  pointsToBeCovered: [{ type: String, trim: true }],
  category:          { type: String, enum: ['bug','feature_request','how_to','data_issue','access','other'], default: 'other' },
  priority:          { type: String, enum: ['low','medium','high','urgent'], default: 'medium' },
  status:            { type: String, enum: TICKET_STATUS, default: 'raised', index: true },
  disposition:       { type: String, enum: TICKET_DISPOSITION, default: 'unset', index: true },
  raisedBy:          { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true, index: true },
  assignedTo:        { type: mongoose.SchemaTypes.ObjectId, ref: 'User', default: null, index: true },
  attachments:       [{ fileName: String, url: String, size: Number, mimeType: String }],
  tags:              [{ type: String, trim: true }],
  statusHistory:     [statusHistorySchema],
  comments:          [commentSchema],
  timeInStatus:      { type: Object, default: {} },
  firstResponseAt:   { type: Date, default: null },
  resolvedAt:        { type: Date, default: null },
  closedAt:          { type: Date, default: null },
  slaDueAt:          { type: Date, default: null },
  isDeleted:         { type: Boolean, default: false },
}, { timestamps: true });

ticketSchema.plugin(toJSON);
ticketSchema.plugin(paginate);

const Ticket = mongoose.model('HelpSupportTicket', ticketSchema);
export default Ticket;
```

> `ticketNumber` is generated in the service on create (counter or `HS-{YYYY}-{padded seq}`). Keep generation in one place to avoid races (use a counter collection or `findOneAndUpdate` with `$inc`).

### 8.3 Transition map (service)

```js
export const TRANSITIONS = {
  raised:        ['pending', 'in_progress', 'cancelled'],
  pending:       ['in_progress', 'on_hold', 'awaiting_user', 'cancelled'],
  in_progress:   ['in_review', 'on_hold', 'awaiting_user', 'resolved', 'cancelled'],
  in_review:     ['in_progress', 'resolved'],
  on_hold:       ['in_progress', 'pending', 'cancelled'],
  awaiting_user: ['in_progress', 'pending', 'cancelled'],
  resolved:      ['closed', 'reopened'],
  reopened:      ['in_progress', 'on_hold'],
  closed:        ['reopened'],
  cancelled:     [],
};
```

---

## 9. API Endpoints

Base: `/v1/help-support`

### Tickets
| Method | Path | Who | Description |
|---|---|---|---|
| `POST` | `/tickets` | any | Create ticket (`title` required). `raisedBy` from token. |
| `GET` | `/tickets` | agent/admin (all), user (own) | List + filter + paginate. Query: `status`, `disposition`, `priority`, `category`, `assignedTo`, `raisedBy`, `search`, `sortBy`, `limit`, `page`, `dateFrom`, `dateTo`. |
| `GET` | `/tickets/:ticketId` | owner/agent/admin | Get one (includes `statusHistory`, live `timeInStatus`, derived totals). |
| `PATCH` | `/tickets/:ticketId` | agent/admin | Update editable fields (title, description, points, priority, category, tags, assignedTo). |
| `DELETE` | `/tickets/:ticketId` | admin | Soft delete. |

### Status & disposition
| Method | Path | Who | Description |
|---|---|---|---|
| `PATCH` | `/tickets/:ticketId/status` | agent/admin | Body `{ status, note }`. Runs `recordTransition`. |
| `PATCH` | `/tickets/:ticketId/disposition` | agent/admin | Body `{ disposition, note }`. |
| `PATCH` | `/tickets/:ticketId/assign` | agent/admin | Body `{ assignedTo }`. |
| `GET` | `/tickets/:ticketId/history` | owner/agent/admin | Full status (and disposition) timeline with durations. |

### Comments
| Method | Path | Who | Description |
|---|---|---|---|
| `POST` | `/tickets/:ticketId/comments` | owner/agent/admin | Body `{ body, isInternal?, attachments? }`. Sets `firstResponseAt` if first agent reply. |
| `GET` | `/tickets/:ticketId/comments` | owner/agent/admin | List (requester does not see `isInternal`). |

### Analytics
| Method | Path | Who | Description |
|---|---|---|---|
| `GET` | `/analytics/summary` | agent/admin | Cards: totals, open/resolved/closed, avg first-response, avg resolution, SLA breaches. Accepts date/agent/category filters. |
| `GET` | `/analytics/time-in-status` | agent/admin | Total + avg ms per status across all tickets. |
| `GET` | `/analytics/by-status` | agent/admin | Counts grouped by status. |
| `GET` | `/analytics/by-disposition` | agent/admin | Counts grouped by disposition. |
| `GET` | `/analytics/agent-workload` | agent/admin | Per-agent open count + avg resolution time. |
| `GET` | `/analytics/trend` | agent/admin | Created vs resolved over time (day/week bucket). |

### Sample payloads

**Create ticket**
```json
POST /v1/help-support/tickets
{
  "title": "Yarn inventory count mismatch on Floor 2",
  "description": "Counts in app don't match physical stock.",
  "pointsToBeCovered": ["Check box transfers", "Verify last GRN", "Reconcile snapshot"],
  "category": "data_issue",
  "priority": "high"
}
```

**Change status**
```json
PATCH /v1/help-support/tickets/HS-2026-000123/status
{ "status": "in_review", "note": "Fix deployed, verifying counts" }
```

**Time-in-status analytics response (shape)**
```json
{
  "range": { "from": "2026-06-01", "to": "2026-06-25" },
  "totalTickets": 142,
  "totalTimeMs": 9876543210,
  "perStatus": {
    "in_progress": { "totalMs": 3210000000, "avgMs": 22605633, "tickets": 142 },
    "in_review":   { "totalMs": 1080000000, "avgMs": 12000000, "tickets": 90 },
    "pending":     { "totalMs": 2400000000, "avgMs": 16901408, "tickets": 142 },
    "on_hold":     { "totalMs": 540000000,  "avgMs": 30000000, "tickets": 18 }
  }
}
```

---

## 10. Validation (Joi)

- `createTicket`: `title` **required**; everything else optional with enums validated.
- `updateStatus`: `status` required & in enum; `note` optional string.
- `updateDisposition`: `disposition` required & in enum.
- `listTickets`: validate filter/pagination query params (mirror `getCategories` style).
- Reuse `objectId` custom validator for all id params.

---

## 11. Frontend (Next.js App Router)

### Routes
```
app/help-and-support/page.tsx            # tabbed shell: Tickets | Analytics
app/help-and-support/[ticketId]/page.tsx # ticket detail + timeline
```

### Components (under `app/(components)` or a feature folder)
- `RaiseTicketModal` — form: title (required), description, dynamic "points to be covered" list, category, priority, attachments.
- `TicketTable` — filterable/paginated list with status & disposition chips, assignee, age, time-in-current-status.
- `TicketDetail` — header (number, title, status/disposition chips), description, points checklist, comments thread, attachments.
- `StatusTimeline` — vertical timeline from `statusHistory` showing each status, who changed it, and `durationMs` (humanized).
- `StatusChangeControl` — dropdown limited to allowed next statuses (from transition map) + note field.
- `TimeInStatusCard` — per-ticket bar of time spent per status.
- `AnalyticsTab` — summary cards + charts (by status, by disposition, time-in-status totals, agent workload, trend).

### Data layer
- Add a `helpSupportService` under `shared/services` mirroring existing services (axios + base API).
- Add Redux slice/RTK query endpoints if the project uses them for other modules; otherwise follow the existing data-fetch pattern.
- Humanize durations client-side (e.g. `2d 4h 12m`).

### UX notes
- Requester view = own tickets only + "Raise ticket" button.
- Agent/Admin view = all tickets, assignment, status/disposition controls, Analytics tab.
- Live time-in-current-status should tick (compute from `enteredAt`).

---

## 12. Indexes & Performance
- Indexes: `status`, `disposition`, `assignedTo`, `raisedBy`, `createdAt`, `ticketNumber (unique)`.
- For analytics at scale, add a nightly cron rollup into a `helpSupportDailyStats` collection (reuse the `src/cron` pattern).
- Cap `statusHistory`/`comments` growth is fine (bounded per ticket).

---

## 13. Edge Cases
- **Title-only ticket**: must succeed (all other fields optional).
- **Illegal transition**: reject `400` with allowed list.
- **Reopen after close**: allowed within reopen window; reopen resets `resolvedAt`/`closedAt` and adds a new active period.
- **Paused statuses** (`on_hold`, `awaiting_user`): excluded from `totalActiveTimeMs` and SLA clock, but still tracked in `timeInStatus`.
- **Live ticket time**: reads must add the running duration of the open status entry.
- **Concurrent status changes**: guard with optimistic check on current `status` before transition.
- **Soft delete**: excluded from lists and analytics by default.

---

## 14. Implementation Checklist
- [ ] Model `ticket.model.js` with enums, sub-schemas, plugins, index export.
- [ ] `ticketNumber` generator (counter-based, race-safe).
- [ ] Service: CRUD, `recordTransition`, disposition change, assign, comments.
- [ ] Analytics service: aggregation pipelines (summary, time-in-status, breakdowns, workload, trend).
- [ ] Controllers + Joi validations + routes; register in `routes/v1/index.js`.
- [ ] Auth/role guards on agent/admin-only endpoints.
- [ ] Frontend tabbed screen, raise-ticket modal, detail + timeline, analytics tab.
- [ ] Humanized duration utilities (shared).
- [ ] Seed/test data + unit tests for transition logic and time accounting.
- [ ] Optional cron rollup for analytics.

---

## 15. Future Enhancements
- Email/WhatsApp inbound ticket creation.
- SLA auto-escalation actions + notifications.
- CSAT/feedback on close.
- Saved views & bulk actions.
- Knowledge-base / FAQ suggestions on ticket creation (reuse existing `faq` + `faqVector`).
