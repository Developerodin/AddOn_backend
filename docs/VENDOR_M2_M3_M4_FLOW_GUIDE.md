# Vendor M2 / M3 / M4 Management Flow Guide

Vendor production uses `VendorProductionFlow` (not `Article`). Pipeline:

```
secondaryChecking → branding → finalChecking → dispatch
```

QC floors for M2 ledger: **secondaryChecking**, **finalChecking** only.

## Collections

| Ledger | Collection | Key fields |
|--------|------------|------------|
| M2 | `vendor_m2_logs` | `vendorProductionFlowId`, `referenceCode`, `vpoNumber`, `sourceFloor` |
| M3 | `vendor_m3_logs` | same flow identity fields |
| M4 | `vendor_m4_logs` | final checking M4 only (SC uses `vm4Quantity` for vendor returns) |

Reuses production enums: `M2LogType`, `M2EntryStatus`, `M3LogType`, `M4LogType`.

## M2 lifecycle

1. **ENTRY** — auto-created when floor PATCH increases `m2Quantity` on SC/FC (`recordVendorM2Entry`).
2. **MERGE_TO_M1** — cascade from source floor through dispatch (requires dispatch received or `currentFloorKey === 'dispatch'`). On final checking with style rows, `transferredData` is bumped proportionally.
3. **TRANSFER_TO_M3** — moves qty from open M2 entry to floor `m3Quantity`.
4. **TRANSFER_TO_M4** — FC → `m4Quantity` + M4 ledger; SC → `vm4Quantity` (vendor return path, no M4 ledger).

Cascade utility: `src/utils/vendorM2Cascade.util.js`.

## M3 / M4 outward

- On-hand = sum of floor `m3Quantity` / `m4Quantity` across QC floors.
- Outward is ledger-only via `m3Tracking.outwardTotal` / `m4Tracking.outwardTotal` on the flow document.
- Available = on-hand − outward total.

## API routes (under `/v1/vendor-management`)

| Method | Path |
|--------|------|
| GET | `/m2/entries`, `/m2/logs`, `/m2/statistics` |
| POST | `/m2/entries/:entryId/merge-to-m1`, `/transfer-to-m3`, `/transfer-to-m4` |
| GET | `/m3/flows`, `/m3/logs`, `/m3/statistics` |
| POST | `/m3/flows/:flowId/outward` |
| GET | `/m4/flows`, `/m4/logs`, `/m4/statistics` |
| POST | `/m4/flows/:flowId/outward` |

## Migration

Legacy SC data may have `floorQuantities.secondaryChecking.m4Quantity`. Run:

```bash
node scripts/migrate-vendor-sc-m4-to-vm4.js --apply
```

Copies to `vm4Quantity` and unsets `m4Quantity`.
