/* eslint-disable no-undef */
/**
 * Mongosh script: audit YarnBox updates related to a PO.
 *
 * It uses:
 * - YarnBox documents (by poNumber) to get box _ids + boxIds
 * - UserActivityLog entries hitting /v1/yarn-management/yarn-boxes* endpoints
 *
 * Usage:
 *   PO_ID=... mongosh "$MONGODB_URL" --quiet scripts/audit-yarn-box-updates-for-po.mongosh.js
 *
 * Output:
 * - poNumber
 * - boxesCount
 * - apiUpdates[] (when/who/path/requestMeta)
 */

const poIdArg = process?.env?.PO_ID ? String(process.env.PO_ID) : null;
if (!poIdArg || !/^[a-f0-9]{24}$/i.test(poIdArg)) {
  printjson({ error: 'Missing/invalid PO_ID env var (expected 24-hex ObjectId).' });
  quit(1);
}

const po = db.yarnpurchaseorders.findOne({ _id: ObjectId(poIdArg) }, { poNumber: 1 });
if (!po || !po.poNumber) {
  printjson({ error: `PO not found or missing poNumber for id=${poIdArg}` });
  quit(1);
}
const poNumber = String(po.poNumber);

const boxes = db.yarnboxes
  .find({ poNumber }, { _id: 1, boxId: 1, barcode: 1, lotNumber: 1, yarnName: 1 })
  .toArray();

const boxObjectIds = boxes.map((b) => b._id).filter(Boolean);
const boxIdStrings = boxes.map((b) => b.boxId).filter(Boolean);
const boxIdHexes = boxObjectIds.map((id) => id.toString());

const usersById = new Map();
const addUser = (id) => {
  if (!id) return;
  const k = String(id);
  if (usersById.has(k)) return;
  const u = db.users.findOne({ _id: ObjectId(k) }, { name: 1, email: 1 });
  if (u) usersById.set(k, { name: u.name || null, email: u.email || null });
};

// Activity log: anything touching yarn-boxes routes.
// We'll include:
// - per-box updates: PATCH /:yarnBoxId  (yarnBoxId = Mongo _id)
// - bulk ops that include poNumber in body (update-qc-status, bulkCreate, etc.)
// - transfer ops often use boxIds/barcodes, so include any requestMeta that references known boxIds.
const basePathRe = /^\/v1\/yarn-management\/yarn-boxes(\/|$)/i;

// 1) Exact per-box PATCH updates (captures boxWeight/numberOfCones/storageLocation edits etc.)
const perBoxPaths = boxIdHexes.map((id) => `/v1/yarn-management/yarn-boxes/${id}`);
const perBoxApi = db.useractivitylogs
  .find(
    {
      method: { $in: ['PATCH', 'PUT', 'DELETE'] },
      path: { $in: perBoxPaths },
    },
    { createdAt: 1, userId: 1, method: 1, path: 1, statusCode: 1, action: 1, requestMeta: 1, errorMessage: 1 }
  )
  .sort({ createdAt: 1 })
  .toArray();

// 2) Bulk/other yarn-boxes endpoints that reference the PO or its boxes
const bulkApi = db.useractivitylogs
  .find(
    {
      method: { $in: ['PATCH', 'PUT', 'POST', 'DELETE'] },
      path: { $regex: basePathRe },
      $or: [
        { 'requestMeta.poNumber': poNumber },
        { 'requestMeta.po_number': poNumber },
        { 'requestMeta.boxIds': { $in: boxIdStrings } },
        { 'requestMeta.items': { $exists: true } },
      ],
    },
    { createdAt: 1, userId: 1, method: 1, path: 1, statusCode: 1, action: 1, requestMeta: 1, errorMessage: 1 }
  )
  .sort({ createdAt: 1 })
  .toArray();

const api = [...perBoxApi, ...bulkApi].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

api.forEach((l) => addUser(l && l.userId));

const apiUpdates = api
  .map((l) => {
    const userId = l?.userId ? String(l.userId) : null;
    const u = userId ? usersById.get(userId) : null;
    return {
      when: l?.createdAt || null,
      method: l?.method || null,
      path: l?.path || null,
      statusCode: l?.statusCode ?? null,
      action: l?.action || null,
      by: { userId, name: u?.name || null, email: u?.email || null },
      updatedDataSent: l?.requestMeta || null,
      errorMessage: l?.errorMessage || null,
    };
  })
  // Filter out false positives from bulk endpoints.
  .filter((u) => {
    if (perBoxPaths.includes(u.path)) return true;
    const meta = u.updatedDataSent || {};
    return meta && (meta.poNumber === poNumber || meta.po_number === poNumber);
  });

printjson({
  po: { id: poIdArg, poNumber },
  boxesCount: boxes.length,
  sampleBoxes: boxes.slice(0, 5),
  apiUpdates,
});

