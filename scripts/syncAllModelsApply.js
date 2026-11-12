/**
 * Proof: every data-entry model syncs both ways through `documentUpserted`.
 *
 *   cd AddOn_backend && node scripts/syncAllModelsApply.js
 *
 * Local Mac only. Mongo 127.0.0.1:27017; factory db `addon2` (API :8001, site factory-mac), cloud db `addon`
 * (API :8000, site cloud-mac). Both APIs must be running with SYNC_ENABLED and SYNC_APPLY_PILOT true; their push
 * workers carry the events. Prints ids and statuses only, never credentials or connection strings with secrets.
 *
 * 1. addon2: through the real models (hooks fire) create 9 YarnTransactions (one per type), Category, Product,
 *    StyleCode, YarnCatalog, YarnCone, WarehouseInventory and one UserActivityLog.
 * 2. Poll addon up to 150 s: every id but the activity log must be there with the same business key; the activity
 *    log must be absent.
 * 3. addon: create one Category; poll addon2 for it.
 * 4. Re-ingest the addon2 Category event into addon (same eventId): category count for that _id stays 1.
 */

// This process writes factory rows first, so its outbox rows must carry the factory site id. Set before config loads.
process.env.SYNC_SITE_ID = 'factory-mac';

const MONGO = 'mongodb://127.0.0.1:27017';
const FACTORY_DB = 'addon2';
const CLOUD_DB = 'addon';
const POLL_MS = 150 * 1000;
const POLL_EVERY_MS = 5000;
const CONNECT_OPTS = { useNewUrlParser: true, useUnifiedTopology: true };

const { default: mongoose } = await import('mongoose');
// Registrar before any model, so every schema below gets the capture hooks.
await import('../src/services/sync/syncModelRegistrar.js');
const { default: config } = await import('../src/config/config.js');
const { default: Category } = await import('../src/models/category.model.js');
const { default: Product } = await import('../src/models/product.model.js');
const { default: StyleCode } = await import('../src/models/styleCode.model.js');
const { default: YarnCatalog } = await import('../src/models/yarnManagement/yarnCatalog.model.js');
const { default: YarnCone } = await import('../src/models/yarnReq/yarnCone.model.js');
const { default: YarnTransaction, yarnTransactionTypes } = await import('../src/models/yarnReq/yarnTransaction.model.js');
const { default: WarehouseInventory } = await import('../src/models/whms/warehouseInventory.model.js');
const { default: UserActivityLog } = await import('../src/models/userActivityLog.model.js');
const { default: SyncOutbox } = await import('../src/models/sync/syncOutbox.model.js');
const { default: SyncInbox } = await import('../src/models/sync/syncInbox.model.js');
const { toWireEvent } = await import('../src/services/sync/syncCursor.service.js');
const { ingestEvent } = await import('../src/services/sync/syncInbox.service.js');

const results = [];

/**
 * Record and print one check.
 * @param {string} name
 * @param {boolean} ok
 * @param {string} [detail]
 */
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

/** @param {number} ms */
const sleep = (ms) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

/**
 * Point the default mongoose connection (used by the models and the outbox) at one database.
 * @param {string} db
 */
const useDefaultDb = async (db) => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  await mongoose.connect(`${MONGO}/${db}`, CONNECT_OPTS);
};

/**
 * One expected row: the model, its _id, and the business key compared across databases.
 * @param {import('mongoose').Model} Model
 * @param {import('mongoose').Document} doc
 * @param {string} keyField
 */
const expected = (Model, doc, keyField) => ({
  label: `${Model.modelName}${keyField === 'transactionType' ? `:${doc.transactionType}` : ''}`,
  modelName: Model.modelName,
  collection: Model.collection.collectionName,
  _id: doc._id,
  keyField,
  key: doc.get(keyField),
});

/**
 * Poll `db` until every row in `rows` is present with the same key, or the deadline passes.
 * @param {import('mongodb').Db} db
 * @param {Array<ReturnType<typeof expected>>} rows
 * @returns {Promise<Map<string, any>>} label → found row (or null)
 */
const pollPresent = async (db, rows) => {
  const found = new Map();
  const deadline = Date.now() + POLL_MS;
  for (;;) {
    for (const row of rows) {
      if (!found.get(row.label)) {
        // eslint-disable-next-line no-await-in-loop
        found.set(row.label, await db.collection(row.collection).findOne({ _id: row._id }));
      }
    }
    const missing = rows.filter((r) => !found.get(r.label));
    if (!missing.length || Date.now() > deadline) return found;
    console.log(`  waiting: ${missing.length} of ${rows.length} not yet on target (${Math.round((deadline - Date.now()) / 1000)} s left)`);
    // eslint-disable-next-line no-await-in-loop
    await sleep(POLL_EVERY_MS);
  }
};

/**
 * Print the receiver inbox row for a missing document, to show why it is not there.
 * @param {import('mongodb').Db} db receiver db
 * @param {ReturnType<typeof expected>} row
 */
const explainMissing = async (db, row) => {
  const inbox = await db
    .collection(SyncInbox.collection.collectionName)
    .findOne({ entityType: row.modelName, aggregateId: String(row._id), eventType: 'documentUpserted' });
  console.log(`  ${row.label} ${row._id}: inbox ${inbox ? `${inbox.status} ${inbox.lastError || ''}` : 'none'}`);
};

/**
 * Compare found rows against the expected keys and record one check per row.
 * @param {string} where
 * @param {Array<ReturnType<typeof expected>>} rows
 * @param {Map<string, any>} found
 * @param {import('mongodb').Db} receiverDb
 */
const checkRows = async (where, rows, found, receiverDb) => {
  for (const row of rows) {
    const doc = found.get(row.label);
    const same = Boolean(doc) && String(doc[row.keyField]) === String(row.key);
    check(`${where} has ${row.label} ${row._id}`, same, doc ? `${row.keyField}=${doc[row.keyField]}` : 'missing');
    // eslint-disable-next-line no-await-in-loop
    if (!doc) await explainMissing(receiverDb, row);
  }
};

const tag = `SYNCALL-${Date.now()}`;
const oid = () => new mongoose.Types.ObjectId();
console.log(`tag ${tag}`);

// ---- 1. factory writes (addon2, site factory-mac) ----
await useDefaultDb(FACTORY_DB);
console.log(`step 1: create on ${FACTORY_DB} as ${config.sync.siteId} (applyPilot=${config.sync.applyPilot})`);

const category = await Category.create({ name: `${tag} category` });
const styleCode = await StyleCode.create({ styleCode: `${tag}-SC`, eanCode: `${tag}-EAN`, mrp: 1 });
const product = await Product.create({ name: `${tag} product`, softwareCode: `${tag}-SW`, category: category._id });
const catalog = await YarnCatalog.create({
  yarnName: `${tag} yarn`,
  yarnType: { _id: oid(), name: 'SyncTestType', status: 'active' },
  countSize: { _id: oid(), name: 'SyncTestCount', status: 'active' },
  blend: { _id: oid(), name: 'SyncTestBlend', status: 'active' },
});
// Weight 0 and no storage slot: the cone post-save does not touch yarn inventory.
const cone = await YarnCone.create({
  poNumber: `${tag}-PO`,
  boxId: `${tag}-BOX`,
  yarnCatalogId: catalog._id,
  barcode: `${tag}-CONE`,
  coneWeight: 0,
});
const stock = await WarehouseInventory.create({ styleCodeId: styleCode._id, styleCode: styleCode.styleCode, totalQuantity: 7 });
const transactions = [];
for (const transactionType of yarnTransactionTypes) {
  // eslint-disable-next-line no-await-in-loop
  transactions.push(
    await YarnTransaction.create({
      yarnCatalogId: catalog._id,
      yarnName: catalog.yarnName,
      transactionType,
      transactionDate: new Date(),
      transactionNetWeight: 0,
      transactionTotalWeight: 0,
      transactionConeCount: 0,
    })
  );
}
const activity = await UserActivityLog.create({ userId: oid(), method: 'POST', path: `/v1/${tag}`, statusCode: 201 });

const factoryRows = [
  ...transactions.map((t) => expected(YarnTransaction, t, 'transactionType')),
  expected(Category, category, 'name'),
  expected(Product, product, 'name'),
  expected(StyleCode, styleCode, 'styleCode'),
  expected(YarnCatalog, catalog, 'yarnName'),
  expected(YarnCone, cone, 'barcode'),
  expected(WarehouseInventory, stock, 'totalQuantity'),
];
console.log(`  created ${factoryRows.length} rows + 1 UserActivityLog ${activity._id}`);

for (const row of factoryRows) {
  // eslint-disable-next-line no-await-in-loop
  const n = await SyncOutbox.countDocuments({ entityType: row.modelName, aggregateId: String(row._id), eventType: 'documentUpserted' });
  check(`${FACTORY_DB} outbox has documentUpserted for ${row.label}`, n === 1, `count=${n}`);
}
const ualOutbox = await SyncOutbox.countDocuments({ entityType: 'UserActivityLog', aggregateId: String(activity._id) });
check(`${FACTORY_DB} outbox has no UserActivityLog event`, ualOutbox === 0, `count=${ualOutbox}`);
const factoryCategoryEvent = await SyncOutbox.findOne({
  entityType: 'Category',
  eventType: 'documentUpserted',
  aggregateId: String(category._id),
}).lean();
await mongoose.disconnect();

const factoryConn = await mongoose.createConnection(`${MONGO}/${FACTORY_DB}`, CONNECT_OPTS);
const cloudConn = await mongoose.createConnection(`${MONGO}/${CLOUD_DB}`, CONNECT_OPTS);

// ---- 2. factory → cloud ----
console.log(`step 2: poll ${CLOUD_DB} up to ${POLL_MS / 1000} s`);
const onCloud = await pollPresent(cloudConn.db, factoryRows);
await checkRows(CLOUD_DB, factoryRows, onCloud, cloudConn.db);
const ualOnCloud = await cloudConn.db.collection(UserActivityLog.collection.collectionName).countDocuments({ _id: activity._id });
check(`${CLOUD_DB} has no UserActivityLog ${activity._id}`, ualOnCloud === 0, `count=${ualOnCloud}`);

// ---- 3. cloud → factory ----
config.sync.siteId = 'cloud-mac';
await useDefaultDb(CLOUD_DB);
console.log(`step 3: create Category on ${CLOUD_DB} as ${config.sync.siteId}`);
const cloudCategory = await Category.create({ name: `${tag} cloud category` });
const cloudRows = [expected(Category, cloudCategory, 'name')];
const onFactory = await pollPresent(factoryConn.db, cloudRows);
await checkRows(FACTORY_DB, cloudRows, onFactory, factoryConn.db);

// ---- 4. redelivery of the factory Category event into addon ----
console.log(`step 4: re-ingest ${FACTORY_DB} Category event into ${CLOUD_DB}`);
if (!factoryCategoryEvent) {
  check('factory Category event found for re-ingest', false, 'no outbox row');
} else {
  const out = await ingestEvent('factory-mac', toWireEvent(factoryCategoryEvent));
  check('re-ingest is a duplicate', out.outcome === 'DUPLICATE', `eventId=${factoryCategoryEvent.eventId} outcome=${out.outcome} status=${out.status || ''}`);
  const count = await cloudConn.db.collection(Category.collection.collectionName).countDocuments({ _id: category._id });
  check(`${CLOUD_DB} Category ${category._id} count stays 1`, count === 1, `count=${count}`);
}

await mongoose.disconnect();
await factoryConn.close();
await cloudConn.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? 'FAILED' : 'PASSED'}: ${results.length - failed.length}/${results.length} checks`);
process.exit(failed.length ? 1 : 0);
