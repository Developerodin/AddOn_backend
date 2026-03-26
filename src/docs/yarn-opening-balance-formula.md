# Yarn Opening Balance Formula

## Final Formula

`Opening Balance = StoredBoxes + UnallocatedBoxes + EligibleCones`

## Definitions

- `StoredBoxes = SUM(boxWeight)` for boxes in storage where `boxWeight > 0`
- `UnallocatedBoxes = SUM(boxWeight)` for unallocated/non-LT boxes where `boxWeight > 0`
- `EligibleCones = SUM(coneWeight)` for cones where:
  - `coneStorageId` exists and is not empty
  - `issueStatus != "issued"`

## Compact Form

`Opening Balance = SUM(boxWeight of all counted boxes with boxWeight > 0) + SUM(coneWeight of cones in storage and not issued)`

## Purchase (Pur) Formula

`Pur = SUM(receivedQuantity)`

Where each quantity is counted only when:

- lot status is `lot_accepted`
- PO `goodsReceivedDate` is within report range (`start_date` to `end_date`)
- lot item is mapped to the PO item (`receivedLotDetails[].poItems[].poItem == poItems._id`)

`Pur` only includes accepted lots. Rejected lots are counted in `PurRet`.

## Balance Formula

`Balance = Opening + Pur - PurRet + Returned - Issued`

Field mapping used in report:

- `Opening` = opening balance formula above
- `Pur` = accepted purchase quantity in range
- `PurRet` = rejected purchase quantity in range
- `Returned` = `yarnReturnedFromKnitting`
- `Issued` = `yarnIssueToKnitting`

Example for `start_date = 2026-03-01`, `end_date = 2026-03-30`:

`Balance(30 Mar) = Opening(1 Mar) + Pur(1–30 Mar) - PurRet(1–30 Mar) + Returned(1–30 Mar) - Issued(1–30 Mar)`

## Notes

- `boxWeight` is treated as net weight.
- Do **not** subtract `tearweight` from `boxWeight` in this formula.
