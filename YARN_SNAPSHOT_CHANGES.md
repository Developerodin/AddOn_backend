# Yarn Daily Closing Snapshots — Change Log

## Overview

Added persisted end-of-day closing kg per yarn, a scheduled cron job, and updated the yarn report service to use snapshot-based opening balances for accurate date-range reporting.

---

## New Files

### `src/models/yarnReq/yarnDailyClosingSnapshot.model.js`
New Mongoose model that stores one closing kg record per yarn per calendar day.

**Schema fields:**
| Field | Type | Notes |
|-------|------|-------|
| `snapshotDate` | String | `YYYY-MM-DD` in business timezone (default: `Asia/Kolkata`) |
| `yarnCatalogId` | ObjectId (ref: YarnCatalog) | — |
| `closingKg` | Number | Net physical kg (boxes + cones) |
| `computedAt` | Date | When the job ran |
| `source` | String | `'cron'` by default |

**Index:** Unique compound index on `(snapshotDate, yarnCatalogId)` — makes upserts idempotent.

---

### `src/services/yarnManagement/physicalKgPerYarn.js`
Shared helper module extracted from `yarnReport.service.js`. Used by both the cron job and the report service to avoid logic drift.

**Exports:**
- `getYarnIdsWithPhysicalStock()` — returns `Set<string>` of all yarnCatalogIds that have boxes (weight > 0) or cones in storage (not issued)
- `computePhysicalKgMap(yarnIds, catalogMap)` — returns `Map<yarnId, kg>` of net physical kg per yarn from YarnBox + YarnCone (current live state)

---

### `src/cron/yarnDailySnapshot.cron.js`
Daily cron job that computes and persists closing kg snapshots.

**Behaviour:**
- Runs at `00:00` (midnight) local business-timezone time (snapshots the **previous calendar day**)
- Queries all yarns with physical stock via `getYarnIdsWithPhysicalStock`
- Computes net kg via `computePhysicalKgMap`
- Upserts one `YarnDailyClosingSnapshot` document per yarn (safe to re-run)
- Logs duration and row counts on completion

**Exports:**
- `runYarnDailySnapshot()` — can be called manually for ad-hoc backfill
- `startYarnDailySnapshotJob()` — starts the CronJob instance
- `stopYarnDailySnapshotJob(job)` — stops it cleanly

---

## Modified Files

### `src/models/index.js`
- Added import of `YarnDailyClosingSnapshot`
- Added `YarnDailyClosingSnapshot` to named exports

---

### `src/services/yarnManagement/yarnReport.service.js`

**Removed:**
- Local `getYarnIdsWithPhysicalStock()` function (moved to `physicalKgPerYarn.js`)
- Local `getOpeningFromPhysicalStorage()` function (replaced by `computePhysicalKgMap` from `physicalKgPerYarn.js`)

**Added imports:**
- `YarnDailyClosingSnapshot` from models
- `getYarnIdsWithPhysicalStock`, `computePhysicalKgMap` from `./physicalKgPerYarn.js`

**Changed — `getYarnReportByDateRange`:**

Opening balance now reads from `YarnDailyClosingSnapshot` instead of live physical:

| Before | After |
|--------|-------|
| Opening = current live YarnBox + YarnCone | Opening = EOD snapshot for `start − 1 day` |
| Always reflects today's inventory | Reflects inventory as of the day before the report range |
| No warnings | Emits `meta.warnings` if snapshot is missing |

**Fallback behaviour:** If no snapshot exists for `start − 1 day` (e.g. before go-live or if job failed), the service falls back to current physical inventory and sets `meta.usedFallback: true` with a warning message.

**API response additions (`meta` field):**
```json
{
  "results": [...],
  "startDate": "2026-03-03",
  "endDate": "2026-04-03",
  "meta": {
    "snapshotOpeningDate": "2026-03-02",
    "usedFallback": false
  }
}
```
When fallback is active:
```json
{
  "meta": {
    "snapshotOpeningDate": "2026-03-02",
    "usedFallback": true,
    "warnings": [
      "No snapshot found for 2026-03-02. Opening balance reflects current physical inventory (not period-accurate stock as of 2026-03-02)."
    ]
  }
}
```

---

### `src/index.js`
- Imported `startYarnDailySnapshotJob` and `stopYarnDailySnapshotJob`
- Added `yarnSnapshotCronJob` variable
- Starts the job on server boot when `YARN_DAILY_SNAPSHOT_ENABLED=true`
- Stops the job cleanly in `exitHandler` and `SIGTERM` handler

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `YARN_DAILY_SNAPSHOT_ENABLED` | _(unset / disabled)_ | Set to `true` to enable the cron job |
| `YARN_SNAPSHOT_TZ` | `Asia/Kolkata` | Business timezone for snapshot date keys and cron schedule |
| `YARN_SNAPSHOT_CRON` | `0 0 * * *` | Cron schedule override (default: 00:00 midnight local TZ, IST when `YARN_SNAPSHOT_TZ=Asia/Kolkata`) |

---

## How Opening Balance Now Works

```
Report range: [start, end]  (e.g. 2026-03-03 → 2026-04-03)

Opening = YarnDailyClosingSnapshot where snapshotDate = "start_date − 1 calendar day"

Closing / Balance column:
  YarnDailyClosingSnapshot where snapshotDate = end_date (`closingKg` per yarnCatalogId)

Reconciliation variance (closingVariances) compares snapshot closing vs:
  opening + pur − purRet + returned − issued  (yarns with PO in range)
  opening + returned − issued                 (transactions only in range)
  snapshot opening vs snapshot closing        (yarns idle in range; no PO, no txs)

Totals: Sum `closingKg` once per yarn for that snapshot key (API `meta.summary.uniqueYarnClosingKgSum`).
Do not sum Balance or Opening down report rows—the same kg is repeated when one yarn spans multiple shades/suppliers.
```


---

## Data Flow Diagram

```
Daily Cron (00:00 IST)
  └── computePhysicalKgMap()    ← YarnBox + YarnCone (live)
        └── upsert YarnDailyClosingSnapshot (snapshotDate = yesterday)

GET /yarn-report?start=X&end=Y
  └── YarnDailyClosingSnapshot.find({ snapshotDate: X-1 })  ← opening
  └── YarnTransaction [X, Y]                                 ← issued / returned
  └── YarnPurchaseOrder [X, Y]                               ← pur / purRet
```

---

## Notes

- **Backfill:** Historical snapshots before go-live cannot be auto-generated. Call `runYarnDailySnapshot()` manually with a modified date if needed for specific past dates, or accept fallback mode for pre-launch reports.
- **Multi-row opening:** Opening kg is per `yarnCatalogId`. When multiple report rows share the same yarn (different shade/supplier), each row shows the same opening **and closing balance**. Summing the opening or balance column over-counts. Use **`meta.summary.uniqueYarnOpeningKgSum` / `uniqueYarnClosingKgSum`** (exactly-one total per yarn) or compare **`sumDisplayedOpeningAcrossRowsKg` / `sumDisplayedBalanceAcrossRowsKg`** vs those to see duplication.
- **Idempotency:** The cron job uses `bulkWrite` with `upsert: true`, so re-running for the same date is safe.
- **Single-instance assumption:** If running multiple server pods, only one should have `YARN_DAILY_SNAPSHOT_ENABLED=true` to avoid duplicate writes (upserts are still safe, just wasteful).
