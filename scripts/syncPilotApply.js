/**
 * Pilot apply proof (local Mac only).
 *
 *   Factory stand-in: container on :8001, database addon2, SYNC_SITE_ID factory-mac (pushes to :8000)
 *   Cloud stand-in:   dev API on :8000,   database addon
 *
 * Writes on addon2 through the real services, then polls addon for the applied result:
 *   1. read one yarn catalog id, one supplier, and one product factoryCode from addon2 (exits if missing)
 *   2. createPurchaseOrder + createProductionOrder on addon2
 *   3. transferArticle (Knitting → next floor) on addon2
 *   4. poll addon for up to 90 s: same PO _id + poNumber, same order _id + orderNumber, same article floor
 *   5. re-apply both creates on addon with the same ids; row counts must stay 1
 *
 * Needs on both APIs: SYNC_ENABLED=true and SYNC_APPLY_PILOT=true. Prints no URIs with credentials, no keys.
 *
 *   cd AddOn_backend && node scripts/syncPilotApply.js
 */
import mongoose from 'mongoose';
import config from '../src/config/config.js';
import { connectMongooseForScript } from './lib/mongoScriptConnect.js';
import { Supplier, YarnCatalog, YarnPurchaseOrder } from '../src/models/index.js';
import Product from '../src/models/product.model.js';
import { ProductionOrder, Article } from '../src/models/production/index.js';
import SyncOutbox from '../src/models/sync/syncOutbox.model.js';
import { validateProductProcesses } from '../src/utils/productionHelper.js';
import { createPurchaseOrder } from '../src/services/yarnManagement/yarnPurchaseOrder.service.js';
import { createProductionOrder } from '../src/services/production/order.service.js';
import { transferArticle } from '../src/services/production/article.service.js';
import { PILOT_EVENT_TYPES } from '../src/services/sync/syncPilotCapture.js';
import { insertIfAbsent } from '../src/services/sync/syncPilotApply.service.js';
import { ingestEvent } from '../src/services/sync/syncInbox.service.js';
import { toWireEvent } from '../src/services/sync/syncCursor.service.js';

const HOST = 'mongodb://127.0.0.1:27017';
const FACTORY_DB = 'addon2';
const CLOUD_DB = 'addon';
/** Must equal SYNC_SITE_ID in factory/docker-compose.local-test.yml: that container's worker pushes these rows. */
const FACTORY_SITE_ID = 'factory-mac';
const POLL_MS = 130 * 1000;
const POLL_EVERY_MS = 3000;
const TAG = `syncPilotApply ${new Date().toISOString()}`;

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = async (msg, code = 1) => {
  log(`\nRESULT: FAIL - ${msg}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(code);
};

const floorView = (a) => {
  if (!a) return null;
  const fq = a.floorQuantities || {};
  const pick = (k) => (fq[k] ? { received: fq[k].received || 0, completed: fq[k].completed || 0, transferred: fq[k].transferred || 0 } : null);
  return { currentFloor: a.currentFloor || null, knitting: pick('knitting'), linking: pick('linking') };
};

const floorKeyOf = (floor) => {
  const map = { Knitting: 'knitting', Linking: 'linking', Checking: 'checking', Washing: 'washing', Boarding: 'boarding' };
  return map[floor] || null;
};

const main = async () => {
  // Script process acts as the factory publisher on addon2. The dev .env is the cloud's, so override at runtime.
  config.sync.enabled = true;
  config.sync.applyPilot = true;
  config.sync.siteId = FACTORY_SITE_ID;

  await connectMongooseForScript({ mongoose: { url: `${HOST}/${FACTORY_DB}`, options: config.mongoose.options } });
  const cloud = await mongoose.createConnection(`${HOST}/${CLOUD_DB}`, config.mongoose.options);
  const cdb = cloud.db;
  log(`factory db: ${FACTORY_DB}   cloud db: ${CLOUD_DB}   publisher site: ${FACTORY_SITE_ID}`);

  // ---------- 1. master data from addon2 ----------
  log('\n[1] master data on addon2');
  const catalog = await YarnCatalog.findOne({}).select('_id yarnName').lean();
  if (!catalog) return fail('no yarn catalog row on addon2');
  const supplier = await Supplier.findOne({}).select('_id brandName').lean();
  if (!supplier || !supplier.brandName) return fail('no supplier with a brandName on addon2 (PO needs supplierName)');

  const candidates = await Product.find({ factoryCode: { $regex: /^.{4,5}$/ } })
    .populate('processes.processId')
    .limit(200);
  const product = candidates.find((p) => validateProductProcesses(p.processes, p.factoryCode).valid);
  if (!product) return fail('no product on addon2 with a 4-5 char factoryCode whose processes validate');
  const productOnCloud = await cdb.collection('products').findOne({ factoryCode: product.factoryCode }, { projection: { _id: 1 } });
  if (!productOnCloud) return fail(`product factoryCode ${product.factoryCode} is not on addon (cloud); transfer apply needs it`);
  log(`  yarn catalog: ${catalog._id} (${catalog.yarnName || '-'})`);
  log(`  supplier:     ${supplier._id} (${supplier.brandName})`);
  log(`  product:      factoryCode ${product.factoryCode} (also on addon: yes)`);

  // ---------- 2. creates on addon2 ----------
  log('\n[2] create on addon2 through the real services');
  const po = await createPurchaseOrder({
    supplierName: supplier.brandName,
    supplier: supplier._id,
    poItems: [{ yarnCatalogId: catalog._id, yarnName: catalog.yarnName || '', rate: 1, quantity: 1, gstRate: 0 }],
    subTotal: 1,
    gst: 0,
    total: 1,
    currentStatus: 'draft',
    notes: TAG,
  });
  log(`  yarn PO:          _id ${po._id}  poNumber ${po.poNumber}`);

  const order = await createProductionOrder(
    {
      priority: 'Low',
      orderNote: TAG,
      articles: [
        { articleNumber: product.factoryCode, plannedQuantity: 2, linkingType: 'Auto Linking', priority: 'Low', remarks: TAG },
      ],
    },
    null
  );
  const articleId = String(order.articles[0]._id);
  log(`  production order: _id ${order._id}  orderNumber ${order.orderNumber}  article ${articleId}`);

  // ---------- 3. transfer on addon2 ----------
  log('\n[3] transfer one article one floor on addon2');
  // A new article has completed = 0, so transferArticle refuses. Set completed directly. Do not call
  // updateArticleProgress: on Knitting that already moves the units, and it is not a synced event.
  await Article.updateOne(
    { _id: articleId },
    { $set: { 'floorQuantities.knitting.completed': 1, 'floorQuantities.knitting.transferred': 0 } }
  );
  const transfer = await transferArticle('Knitting', String(order._id), articleId, { quantity: 1, remarks: TAG }, null);
  log(`  transferArticle: ${transfer.transferDetails.fromFloor} → ${transfer.transferDetails.toFloor} qty ${transfer.transferDetails.quantity}`);

  const outboxRows = await SyncOutbox.find({
    $or: [{ aggregateId: String(po._id) }, { aggregateId: String(order._id) }],
  })
    .sort({ originSequence: 1 })
    .lean();
  log(`  outbox rows on addon2: ${outboxRows.length}`);
  outboxRows.forEach((r) => log(`    seq ${r.originSequence}  ${r.eventType}  v${r.aggregateVersion}  ${r.status}`));
  if (outboxRows.length !== 3) return fail(`expected 3 outbox rows, found ${outboxRows.length}`);

  // ---------- 4. poll addon ----------
  log(`\n[4] poll addon for up to ${POLL_MS / 1000} s`);
  const factoryArticle = floorView(await Article.findById(articleId).lean());
  const toKey = floorKeyOf(transfer.transferDetails.toFloor);
  const started = Date.now();
  let state = {};
  while (Date.now() - started < POLL_MS) {
    // eslint-disable-next-line no-await-in-loop
    const [cPo, cOrder, cArticle, inbox] = await Promise.all([
      cdb.collection('yarnpurchaseorders').findOne({ _id: po._id }, { projection: { poNumber: 1 } }),
      cdb.collection('production_orders').findOne({ _id: order._id }, { projection: { orderNumber: 1 } }),
      cdb.collection('articles').findOne({ _id: new mongoose.Types.ObjectId(articleId) }),
      cdb
        .collection('syncinboxes')
        .find({ eventId: { $in: outboxRows.map((r) => r.eventId) } }, { projection: { eventType: 1, status: 1, lastError: 1 } })
        .toArray(),
    ]);
    const cloudArticle = floorView(cArticle);
    state = {
      poOk: Boolean(cPo && cPo.poNumber === po.poNumber),
      orderOk: Boolean(cOrder && cOrder.orderNumber === order.orderNumber),
      floorOk:
        Boolean(cloudArticle) &&
        cloudArticle.currentFloor === factoryArticle.currentFloor &&
        JSON.stringify(cloudArticle.knitting) === JSON.stringify(factoryArticle.knitting) &&
        (!toKey || JSON.stringify(cloudArticle[toKey]) === JSON.stringify(factoryArticle[toKey])),
      cloudArticle,
      inbox,
      cPo,
      cOrder,
    };
    const transferRow = inbox.find((r) => r.eventType === PILOT_EVENT_TYPES.ARTICLE_FLOOR_TRANSFER);
    const transferSettled = transferRow && ['APPLIED', 'APPLY_FAILED', 'CONFLICTED', 'QUARANTINED'].includes(transferRow.status);
    if (state.poOk && state.orderOk && (state.floorOk || transferSettled)) break;
    // eslint-disable-next-line no-await-in-loop
    await sleep(POLL_EVERY_MS);
  }
  const secs = Math.round((Date.now() - started) / 1000);

  const outboxAfter = await SyncOutbox.find({ eventId: { $in: outboxRows.map((r) => r.eventId) } })
    .sort({ originSequence: 1 })
    .select('eventType status lastError')
    .lean();
  log(`  after ${secs} s`);
  log('  addon2 outbox:');
  outboxAfter.forEach((r) => log(`    ${r.eventType}  ${r.status}${r.lastError ? `  lastError: ${r.lastError}` : ''}`));
  log('  addon inbox:');
  if (!state.inbox || !state.inbox.length) log('    (none of these events stored yet)');
  (state.inbox || []).forEach((r) => log(`    ${r.eventType}  ${r.status}${r.lastError ? `  lastError: ${r.lastError}` : ''}`));
  log(`  PO on addon:     ${state.cPo ? `_id ${state.cPo._id} poNumber ${state.cPo.poNumber}` : 'missing'}  → ${state.poOk ? 'MATCH' : 'NO MATCH'}`);
  log(`  order on addon:  ${state.cOrder ? `_id ${state.cOrder._id} orderNumber ${state.cOrder.orderNumber}` : 'missing'}  → ${state.orderOk ? 'MATCH' : 'NO MATCH'}`);
  log(`  article addon2:  ${JSON.stringify(factoryArticle)}`);
  log(`  article addon:   ${JSON.stringify(state.cloudArticle || null)}`);
  log(`  article floor    → ${state.floorOk ? 'MATCH' : 'NO MATCH'}`);

  const step4Pass = state.poOk && state.orderOk && state.floorOk;

  // ---------- 5. re-apply creates on addon with the same ids ----------
  // Runs only for documents already confirmed on addon. It never writes to addon2 and never makes a new _id.
  if (state.poOk || state.orderOk) {
    log('\n[5] re-apply the creates on addon with the same ids');
    await mongoose.disconnect();
    await connectMongooseForScript({ mongoose: { url: `${HOST}/${CLOUD_DB}`, options: config.mongoose.options } });
    // Receiver side now: same flags, cloud site id does not matter for ingest.
    const countPo = () =>
      Promise.all([YarnPurchaseOrder.countDocuments({ _id: po._id }), YarnPurchaseOrder.countDocuments({ poNumber: po.poNumber })]);
    const countOrder = () =>
      Promise.all([
        ProductionOrder.countDocuments({ _id: order._id }),
        ProductionOrder.countDocuments({ orderNumber: order.orderNumber }),
        Article.countDocuments({ orderId: order._id }),
      ]);
    const creates = outboxRows.filter((r) => r.eventType !== PILOT_EVENT_TYPES.ARTICLE_FLOOR_TRANSFER);
    const results = [];
    for (const row of creates) {
      // a) same eventId redelivered through the real ingest path
      // eslint-disable-next-line no-await-in-loop
      const again = await ingestEvent(FACTORY_SITE_ID, toWireEvent(row));
      results.push(`  ingest same eventId ${row.eventType}: outcome ${again.outcome}, domainInvoked ${again.domainInvoked}, apply ${again.apply ? again.apply.applyOutcome : '-'}`);
    }
    // b) the apply insert itself, called again with the same source ids (as a new eventId would)
    const poPayload = creates.find((r) => r.eventType === PILOT_EVENT_TYPES.YARN_PO_CREATED).payload;
    const orderPayload = creates.find((r) => r.eventType === PILOT_EVENT_TYPES.PRODUCTION_ORDER_CREATED).payload;
    const beforePo = await countPo();
    const beforeOrder = await countOrder();
    const poInserted = state.poOk ? await insertIfAbsent(YarnPurchaseOrder, { ...poPayload.document, _id: poPayload._id, poNumber: poPayload.poNumber }) : null;
    const orderInserted = state.orderOk
      ? await insertIfAbsent(ProductionOrder, { ...orderPayload.order, _id: orderPayload._id, orderNumber: orderPayload.orderNumber })
      : null;
    const afterPo = await countPo();
    const afterOrder = await countOrder();
    results.forEach((l) => log(l));
    log(`  direct apply insert PO again:    inserted ${poInserted}`);
    log(`  direct apply insert order again: inserted ${orderInserted}`);
    log(`  PO rows on addon    [by _id, by poNumber]:            before ${JSON.stringify(beforePo)}  after ${JSON.stringify(afterPo)}`);
    log(`  order rows on addon [by _id, by orderNumber, articles]: before ${JSON.stringify(beforeOrder)}  after ${JSON.stringify(afterOrder)}`);
    const idempotent =
      (!state.poOk || (afterPo[0] === 1 && afterPo[1] === 1 && poInserted === false)) &&
      (!state.orderOk || (afterOrder[0] === 1 && afterOrder[1] === 1 && orderInserted === false));
    log(`  second apply inserted no second row → ${idempotent ? 'YES' : 'NO'}`);
    if (!idempotent) return fail('second apply changed row counts');
  } else {
    log('\n[5] skipped: neither create reached addon');
  }

  await cloud.close();
  if (!step4Pass) {
    const missing = [!state.poOk && 'purchase order', !state.orderOk && 'production order', !state.floorOk && 'article floor'].filter(Boolean);
    return fail(`not seen on addon within ${POLL_MS / 1000} s: ${missing.join(', ')}`);
  }
  log('\nRESULT: PASS');
  await mongoose.disconnect();
  return process.exit(0);
};

main().catch(async (err) => {
  await fail(`threw: ${err && err.message}`);
});
