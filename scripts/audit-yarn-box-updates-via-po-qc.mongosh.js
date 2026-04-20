/* eslint-disable no-undef */
/**
 * Find who updated YarnBox QC/details via PO endpoints (lot QC approve etc.)
 *
 * Usage:
 *   PO_NUMBER=PO-2026-1144 mongosh "$MONGODB_URL" --quiet scripts/audit-yarn-box-updates-via-po-qc.mongosh.js
 */

const poNumber = process?.env?.PO_NUMBER ? String(process.env.PO_NUMBER) : null;
if (!poNumber) {
  printjson({ error: 'Missing PO_NUMBER env var.' });
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

const paths = [
  '/v1/yarn-management/yarn-purchase-orders/lot-status-qc-approve',
  '/v1/yarn-management/yarn-purchase-orders/lot-status',
];

const logs = db.useractivitylogs
  .find(
    {
      method: 'PATCH',
      path: { $in: paths },
      'requestMeta.poNumber': poNumber,
    },
    { createdAt: 1, userId: 1, method: 1, path: 1, statusCode: 1, requestMeta: 1, errorMessage: 1 }
  )
  .sort({ createdAt: 1 })
  .toArray();

logs.forEach((l) => addUser(l && l.userId));

const timeline = logs.map((l) => {
  const userId = l?.userId ? String(l.userId) : null;
  const u = userId ? usersById.get(userId) : null;
  return {
    when: l?.createdAt || null,
    path: l?.path || null,
    statusCode: l?.statusCode ?? null,
    by: { userId, name: u?.name || null, email: u?.email || null },
    body: l?.requestMeta || null,
    errorMessage: l?.errorMessage || null,
  };
});

printjson({ poNumber, count: timeline.length, timeline });

