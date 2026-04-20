/* eslint-disable no-undef */
/**
 * Mongosh script: audit Yarn Purchase Order updates by PO _id.
 *
 * Usage:
 *   mongosh "$MONGODB_URL" --quiet scripts/audit-yarn-po-updates.mongosh.js -- 69cf84a67cd22f3f9dae8ae7
 */

const poIdArg =
  (typeof process !== 'undefined' && process.env && process.env.PO_ID && String(process.env.PO_ID)) ||
  (process.argv || []).find((a) => /^[a-f0-9]{24}$/i.test(String(a)));
if (!poIdArg) {
  printjson({ error: 'Missing PO ObjectId argument (24-hex string).' });
  quit(1);
}

const poId = ObjectId(poIdArg);
const po = db.yarnpurchaseorders.findOne(
  { _id: poId },
  { poNumber: 1, currentStatus: 1, createDate: 1, lastUpdateDate: 1, statusLogs: 1 }
);

if (!po) {
  printjson({ error: `PO not found for id=${poIdArg}` });
  quit(1);
}

const usersById = new Map();
const addUser = (id) => {
  if (!id) return;
  const k = String(id);
  if (usersById.has(k)) return;
  const u = db.users.findOne({ _id: ObjectId(k) }, { name: 1, email: 1 });
  if (u) usersById.set(k, { name: u.name || null, email: u.email || null });
};

(po.statusLogs || []).forEach((l) => addUser(l && l.updatedBy && l.updatedBy.user));

const statusLogs = (po.statusLogs || [])
  .map((l) => {
    const userId = l?.updatedBy?.user ? String(l.updatedBy.user) : null;
    const u = userId ? usersById.get(userId) : null;
    return {
      when: l?.updatedAt || null,
      statusCode: l?.statusCode || null,
      notes: l?.notes || null,
      by: {
        userId,
        usernameStored: l?.updatedBy?.username || null,
        name: u?.name || null,
        email: u?.email || null,
      },
    };
  })
  .sort((a, b) => new Date(a.when || 0) - new Date(b.when || 0));

const pathRe = new RegExp(`^/v1/yarn-management/yarn-purchase-orders/${poIdArg}($|/)`, 'i');
const api = db.useractivitylogs
  .find(
    { method: { $in: ['PATCH', 'PUT', 'DELETE'] }, path: { $regex: pathRe } },
    { createdAt: 1, userId: 1, method: 1, path: 1, statusCode: 1, action: 1, requestMeta: 1, errorMessage: 1 }
  )
  .sort({ createdAt: 1 })
  .toArray();

api.forEach((l) => addUser(l && l.userId));

const apiUpdates = api.map((l) => {
  const userId = l?.userId ? String(l.userId) : null;
  const u = userId ? usersById.get(userId) : null;
  return {
    when: l?.createdAt || null,
    method: l?.method || null,
    path: l?.path || null,
    statusCode: l?.statusCode ?? null,
    action: l?.action || null,
    by: {
      userId,
      name: u?.name || null,
      email: u?.email || null,
    },
    updatedDataSent: l?.requestMeta || null,
    errorMessage: l?.errorMessage || null,
  };
});

printjson({
  purchaseOrder: {
    id: poIdArg,
    poNumber: po.poNumber || null,
    currentStatus: po.currentStatus || null,
    createDate: po.createDate || null,
    lastUpdateDate: po.lastUpdateDate || null,
  },
  statusLogs,
  apiUpdates,
});

