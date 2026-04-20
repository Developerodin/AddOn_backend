/* eslint-disable no-undef */
/**
 * Print YarnBox createdAt/updatedAt and key fields for a PO.
 *
 * Usage:
 *   PO_NUMBER=PO-2026-1144 mongosh "$MONGODB_URL" --quiet scripts/print-yarn-boxes-timestamps-for-po.mongosh.js
 */

const poNumber = process?.env?.PO_NUMBER ? String(process.env.PO_NUMBER) : null;
if (!poNumber) {
  printjson({ error: 'Missing PO_NUMBER env var.' });
  quit(1);
}

const boxes = db.yarnboxes
  .find(
    { poNumber },
    {
      _id: 1,
      boxId: 1,
      lotNumber: 1,
      yarnName: 1,
      storageLocation: 1,
      storedStatus: 1,
      boxWeight: 1,
      grossWeight: 1,
      numberOfCones: 1,
      tearweight: 1,
      qcData: 1,
      createdAt: 1,
      updatedAt: 1,
    }
  )
  .sort({ createdAt: 1 })
  .toArray();

const changed = boxes.filter((b) => b.updatedAt && b.createdAt && b.updatedAt.getTime() !== b.createdAt.getTime());

printjson({
  poNumber,
  boxesCount: boxes.length,
  boxesWithUpdatesCount: changed.length,
  boxesWithUpdates: changed.map((b) => ({
    _id: String(b._id),
    boxId: b.boxId || null,
    lotNumber: b.lotNumber || null,
    createdAt: b.createdAt || null,
    updatedAt: b.updatedAt || null,
    storageLocation: b.storageLocation || null,
    storedStatus: b.storedStatus ?? null,
    boxWeight: b.boxWeight ?? null,
    grossWeight: b.grossWeight ?? null,
    numberOfCones: b.numberOfCones ?? null,
    tearweight: b.tearweight ?? null,
    qcStatus: b.qcData?.status || null,
    qcDate: b.qcData?.date || null,
    qcUsername: b.qcData?.username || null,
  })),
});

