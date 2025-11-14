# Yarn Inventory & Transaction Flow

This document summarises the backend workflow implemented for yarn transactions and inventory updates.

## Key Concepts

- **YarnTransaction** is the single entry point for every movement or reservation of yarn.
- **YarnInventory** aggregates long-term, short-term, and total stock for each yarn ID.
- **YarnRequisition** is raised/updated automatically whenever stock drops below minimum thresholds or when blocking exceeds available stock.

## Transaction Types

| Type              | Behaviour                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `yarn_stocked`    | Adds weight/cones to long-term inventory.                                                                    |
| `internal_transfer` | Moves weight/cones from long-term to short-term storage.                                                   |
| `yarn_returned`   | Adds weight/cones back into short-term storage.                                                              |
| `yarn_issued`     | Deducts weight/cones from short-term storage and releases the same blocked weight.                           |
| `yarn_blocked`    | Keeps physical stock untouched but increments the blocked net weight counter.                                |

## API Contract (POST `/v1/yarn-management/yarn-transactions`)

Common fields:

- `yarn` (ObjectId string) – Yarn catalog reference.
- `yarnName` (string) – Display name (stored redundantly for reporting).
- `transactionType` – One of the types above.
- `transactionDate` – ISO date string.

Quantity payloads:

- For `yarn_blocked`: send `totalBlockedWeight`.
- For other types: send `totalWeight`, `totalTearWeight`, `totalNetWeight`, and `numberOfCones`.

## Inventory Guarantees

- Long-term/short-term buckets never fall below zero; the request is rejected otherwise.
- Total inventory is recalculated automatically from the two buckets.
- Blocked weight is tracked separately and can never be negative.
- The `overbooked` flag flips to `true` when blocked weight exceeds the available net weight.

## Automatic Requisitions

A requisition is (upsert) triggered when:

1. `totalInventory.netWeight` ≤ minimum quantity configured on the yarn catalog (status `low_stock`).
2. `totalInventory.netWeight` is within 20% above the minimum (status `soon_to_be_low`).
3. Blocked weight exceeds total net weight (status flagged as overbooked).

Requisitions reuse the existing `/v1/yarn-management/yarn-requisitions` workflow and remain open (`poSent = false`) until fulfilled externally.

## Front-end Checklist

1. Create a transaction by POSTing to `/v1/yarn-management/yarn-transactions`.
2. Supply the correct quantity fields for the transaction type (see table above).
3. Consume updated inventory summaries by querying the inventory endpoints (to be added) or by fetching the yarn entity.
4. Handle validation errors (HTTP 400) which indicate the request would drive inventory negative.

With this pipeline the UI does not need to orchestrate manual inventory adjustments—the service layer keeps yarn stock, blocked reservations, and requisition records consistent.

## Storage Slot Prefabrication

The `StorageSlot` model represents both LT and ST zones with 150 shelves × 4 floors each. Run:

```
npm run seed:storage-slots
```

to pre-generate the canonical 1,200 slots (`LT-S001-F1` … `ST-S150-F4`). The seeder is idempotent—it upserts missing slots, so you can run it safely multiple times (for example after cleaning a database).
