/* eslint-disable no-undef */
/**
 * Print current PO details (packListDetails + receivedLotDetails summary).
 *
 * Usage:
 *   PO_ID=... mongosh "$MONGODB_URL" --quiet scripts/print-yarn-po-details.mongosh.js
 */

const poIdArg = process?.env?.PO_ID ? String(process.env.PO_ID) : null;
if (!poIdArg || !/^[a-f0-9]{24}$/i.test(poIdArg)) {
  printjson({ error: 'Missing/invalid PO_ID env var (expected 24-hex ObjectId).' });
  quit(1);
}

const po = db.yarnpurchaseorders.findOne(
  { _id: ObjectId(poIdArg) },
  { poNumber: 1, packListDetails: 1, receivedLotDetails: 1 }
);

if (!po) {
  printjson({ error: `PO not found for id=${poIdArg}` });
  quit(1);
}

printjson({
  poNumber: po.poNumber || null,
  packListDetailsCount: (po.packListDetails || []).length,
  receivedLotDetailsCount: (po.receivedLotDetails || []).length,
  packListDetails: po.packListDetails || [],
  receivedLotDetailsSample: (po.receivedLotDetails || []).slice(0, 3),
});

