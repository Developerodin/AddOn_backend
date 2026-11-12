/**
 * Ownership apply proof (local Mac only). Mongo at 127.0.0.1:27017; prints no URIs, keys or credentials.
 *
 *   Factory stand-in: container on :8001, database addon2, site factory-mac, worker pushes to :8000
 *   Cloud stand-in:   dev API on :8000,   database addon,  site cloud-mac,   worker pushes to :8001
 *
 * This process writes through the real services, acting as the site whose database it is connected to, then polls the
 * other database (up to 150 s per step) for the applied result:
 *   1. production order on addon2, article walked Knitting → Final Checking with the real progress, container receive
 *      and quality inspection services. Pass when Final Checking received/completed/transferred match on addon.
 *   2. yarn cone create → issueConeForFloor → returnYarnCone on addon2; same cone _id + barcode + state on addon.
 *   3. warehouse inventory create + quantity update on addon2; same _id + quantity on addon.
 *   4. category, product, style code, yarn catalog on addon2 → addon, then on addon → addon2; re-ingest the same
 *      event ids and show the row counts stay 1.
 * No yarn purchase order is created. Do not run twice: every run creates new documents.
 *
 *   cd AddOn_backend && node scripts/syncOwnershipApply.js
 */
import mongoose from 'mongoose';
import { YarnCatalog } from '../src/models/index.js';
import Product from '../src/models/product.model.js';
import { Article } from '../src/models/production/index.js';
import SyncOutbox from '../src/models/sync/syncOutbox.model.js';
import { validateProductProcesses } from '../src/utils/productionHelper.js';
import { createProductionOrder } from '../src/services/production/order.service.js';
import {
  qualityInspection,
  updateArticleFloorReceivedData,
  updateArticleProgress,
} from '../src/services/production/article.service.js';
import { createYarnCone, returnYarnCone } from '../src/services/yarnManagement/yarnCone.service.js';
import { createFloorIssueBatch, issueConeForFloor } from '../src/services/yarnManagement/yarnConeFloorIssue.service.js';
import { createWarehouseInventory, updateWarehouseInventoryById } from '../src/services/whms/warehouseInventory.service.js';
import { createCategory } from '../src/services/category.service.js';
import { createProduct } from '../src/services/product.service.js';
import { createStyleCode } from '../src/services/styleCode.service.js';
import { createYarnCatalog } from '../src/services/yarnManagement/yarnCatalog.service.js';
import { ingestEvent } from '../src/services/sync/syncInbox.service.js';
import { toWireEvent } from '../src/services/sync/syncCursor.service.js';
import {
  CLOUD_DB,
  CLOUD_SITE_ID,
  FACTORY_DB,
  FACTORY_SITE_ID,
  actAs,
  errText,
  floorView,
  inboxFor,
  log,
  openRaw,
  outboxStatus,
  pollUntil,
  qcDetail,
  stuckReason,
} from './lib/syncOwnershipProofLib.js';

const TS = Date.now();
const TAG = `syncOwnershipApply ${new Date(TS).toISOString()}`;
const QTY = 4;
const QC_FLOORS = ['Checking', 'Secondary Checking', 'Final Checking'];
const PROOF_EMAIL = 'sync-proof@example.invalid';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const results = [];

/** @param {string} step @param {boolean} pass @param {string} detail */
const record = (step, pass, detail) => {
  results.push({ step, pass, detail });
  log(`  → ${step}: ${pass ? 'PASS' : 'FAIL'}${detail ? ` (${detail})` : ''}`);
};

/**
 * Exit with the per-step summary. Non-zero when any step failed.
 * @param {string|null} abort reason the run stopped early
 */
const finish = async (abort = null) => {
  log('\n===== summary =====');
  results.forEach((r) => log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.step}${r.detail ? `  ${r.detail}` : ''}`));
  if (abort) log(`  STOPPED: ${abort}`);
  const ok = !abort && results.length > 0 && results.every((r) => r.pass);
  log(`\nRESULT: ${ok ? 'PASS' : 'FAIL'}`);
  await mongoose.disconnect().catch((e) => log(`  disconnect: ${errText(e)}`));
  process.exit(ok ? 0 : 1);
};

/**
 * Product on addon2 whose processes validate, that also exists on addon, with Final Checking in its flow.
 * @param {import('mongodb').Db} cdb
 * @returns {Promise<{ product: any, floors: string[] }|null>}
 */
const pickProduct = async (cdb) => {
  const candidates = await Product.find({ factoryCode: { $regex: /^.{4,5}$/ } }).populate('processes.processId').limit(200);
  let best = null;
  for (const p of candidates) {
    if (!validateProductProcesses(p.processes, p.factoryCode).valid) continue;
    // eslint-disable-next-line no-await-in-loop
    const onCloud = await cdb.collection('products').findOne({ factoryCode: p.factoryCode }, { projection: { _id: 1 } });
    if (!onCloud) continue;
    // eslint-disable-next-line no-await-in-loop
    const order = await new Article({ articleNumber: p.factoryCode, linkingType: 'Auto Linking' }).getFloorOrder();
    const fc = order.indexOf('Final Checking');
    if (fc < 0) continue;
    const floors = order.slice(0, fc + 1);
    if (!best || floors.length < best.floors.length) best = { product: p, floors };
  }
  return best;
};

/** Step 1: one order, walked floor by floor; the cloud must follow each hop. */
const stepFloors = async (cdb) => {
  log('\n[1] floor chain: production order on addon2, Knitting → Final Checking');
  const picked = await pickProduct(cdb);
  if (!picked) return record('1 floor chain', false, 'no product on both databases with Final Checking in its flow');
  const { product, floors } = picked;
  log(`  product factoryCode ${product.factoryCode}; floors: ${floors.join(' → ')}`);

  const order = await createProductionOrder(
    {
      priority: 'Low',
      orderNote: TAG,
      articles: [{ articleNumber: product.factoryCode, plannedQuantity: QTY, linkingType: 'Auto Linking', priority: 'Low', remarks: TAG }],
    },
    null
  );
  const orderId = String(order._id);
  const articleDoc = await Article.findOne({ orderId: order._id });
  const articleId = String(articleDoc._id);
  log(`  order ${orderId} (${order.orderNumber}), article ${articleId}, planned ${QTY}`);
  const keyOf = (floor) => articleDoc.getFloorKey(floor);

  const eventIdsForOrder = async () =>
    (await SyncOutbox.find({ entityType: 'productionOrder', aggregateId: orderId }).select('eventId').lean()).map((r) => r.eventId);

  /** Wait until the cloud article matches the factory on every floor walked so far. */
  const waitForCloud = async (label, keys) => {
    const factory = floorView(await Article.findById(articleId).lean(), keys);
    const ids = await eventIdsForOrder();
    const polled = await pollUntil(async () => {
      const [cArticle, inbox] = await Promise.all([
        cdb.collection('articles').findOne({ _id: new mongoose.Types.ObjectId(articleId) }),
        inboxFor(cdb, ids),
      ]);
      const cloud = floorView(cArticle, keys);
      return { done: same(cloud, factory), fatal: stuckReason(inbox), state: { cloud, inbox } };
    });
    log(`  [${label}] after ${polled.secs} s: ${polled.ok ? 'addon matches addon2' : 'NO MATCH'}`);
    if (!polled.ok) {
      log(`    addon2: ${JSON.stringify(factory)}`);
      log(`    addon:  ${JSON.stringify(polled.state && polled.state.cloud)}`);
      (await outboxStatus(mongoose.connection.db, ids)).forEach((r) =>
        log(`    addon2 outbox ${r.originSequence} ${r.eventType} ${r.status}${r.lastError ? ` ${r.lastError}` : ''}`)
      );
      ((polled.state && polled.state.inbox) || []).forEach((r) =>
        log(`    addon inbox ${r.eventType} ${r.status}${r.lastError ? ` ${r.lastError}` : ''}`)
      );
    }
    return polled;
  };

  const first = await waitForCloud('order create', [keyOf(floors[0])]);
  if (!first.ok) return record('1 floor chain', false, first.fatal || 'order did not reach addon');

  for (let i = 0; i < floors.length; i += 1) {
    const floor = floors[i];
    const key = keyOf(floor);
    try {
      if (i > 0) {
        // eslint-disable-next-line no-await-in-loop
        const before = await Article.findById(articleId).lean();
        const prev = before.floorQuantities[keyOf(floors[i - 1])];
        const qty = (prev.transferred || 0) - (before.floorQuantities[key].received || 0);
        // eslint-disable-next-line no-await-in-loop
        await updateArticleFloorReceivedData(articleId, {
          floor,
          quantity: qty,
          receivedData: {
            receivedStatusFromPreviousFloor: 'Completed',
            receivedInContainerId: new mongoose.Types.ObjectId(),
            receivedTimestamp: new Date(),
          },
        });
        log(`  ${floor}: container receive ${qty}`);
      }
      // eslint-disable-next-line no-await-in-loop
      const now = await Article.findById(articleId).lean();
      const fd = now.floorQuantities[key];
      if (QC_FLOORS.includes(floor)) {
        const m1 = (fd.received || 0) - (fd.m1Quantity || 0);
        // eslint-disable-next-line no-await-in-loop
        await qualityInspection(articleId, { floor, inspectedQuantity: m1, m1Quantity: m1, remarks: TAG }, null);
        log(`  ${floor}: qualityInspection M1 ${m1}`);
      } else {
        const done = floor === 'Knitting' ? QTY - (fd.completed || 0) : (fd.received || 0) - (fd.completed || 0);
        // eslint-disable-next-line no-await-in-loop
        await updateArticleProgress(floor, orderId, articleId, { completedQuantity: done, remarks: TAG }, null);
        log(`  ${floor}: updateArticleProgress completed +${done}`);
      }
    } catch (err) {
      log(`\n  REJECTED on floor ${floor}: ${errText(err)}`);
      record('1 floor chain', false, `real service rejected ${floor}`);
      return finish(`floor ${floor} rejected by the real service`);
    }
    const keys = floors.slice(0, i + 1).map(keyOf);
    if (i + 1 < floors.length) keys.push(keyOf(floors[i + 1]));
    // eslint-disable-next-line no-await-in-loop
    const hop = await waitForCloud(floor, keys);
    if (!hop.ok) return record('1 floor chain', false, `${floor}: ${hop.fatal || 'not applied on addon within 150 s'}`);
  }

  const fcKey = keyOf('Final Checking');
  const fArticle = await Article.findById(articleId).lean();
  const cArticle = await cdb.collection('articles').findOne({ _id: new mongoose.Types.ObjectId(articleId) });
  const f = floorView(fArticle, [fcKey])[fcKey];
  const c = floorView(cArticle, [fcKey])[fcKey];
  log(`  Final Checking addon2: ${JSON.stringify(f)}  qc ${JSON.stringify(qcDetail(fArticle, fcKey))}`);
  log(`  Final Checking addon:  ${JSON.stringify(c)}  qc ${JSON.stringify(qcDetail(cArticle, fcKey))}`);
  const pass = same(f, c) && f.received > 0;
  return record('1 floor chain', pass, pass ? `Final Checking ${JSON.stringify(c)}` : 'Final Checking differs');
};

/** Step 2: cone create → floor issue → return. */
const stepYarn = async (cdb) => {
  log('\n[2] yarn cone: create → issueConeForFloor → returnYarnCone on addon2');
  const catalogs = await YarnCatalog.find({ linking: true, status: 'active' }).select('_id yarnName').limit(200).lean();
  let catalog = null;
  for (const cat of catalogs) {
    // eslint-disable-next-line no-await-in-loop
    if (await cdb.collection('yarncatalogs').findOne({ _id: cat._id }, { projection: { _id: 1 } })) {
      catalog = cat;
      break;
    }
  }
  if (!catalog) return record('2 yarn cone', false, 'no active linking yarn catalog on both databases');
  const barcode = `SYNCOWN${TS}`;
  const serviceErrors = [];
  let cone;
  try {
    cone = await createYarnCone({
      poNumber: 'SYNC-PROOF',
      boxId: `SYNC-PROOF-${TS}`,
      yarnCatalogId: catalog._id,
      yarnName: catalog.yarnName,
      coneWeight: 1,
      tearWeight: 0,
      barcode,
    });
    log(`  createYarnCone: _id ${cone._id} barcode ${cone.barcode} (catalog ${catalog._id})`);
    const batch = await createFloorIssueBatch({ floor: 'linking', issuedByEmail: PROOF_EMAIL });
    await issueConeForFloor({ barcode, floor: 'linking', totalWeight: 1, totalTearWeight: 0, issuedByEmail: PROOF_EMAIL, issueBatchId: batch.issueBatchId });
    log('  issueConeForFloor: ok');
  } catch (err) {
    log(`  REJECTED: ${errText(err)}`);
    return record('2 yarn cone', false, `create/issue rejected: ${errText(err)}`);
  }
  try {
    await returnYarnCone(barcode, { returnWeight: 0 });
    log('  returnYarnCone: ok');
  } catch (err) {
    serviceErrors.push(`returnYarnCone rejected: ${errText(err)}`);
    log(`  returnYarnCone REJECTED: ${errText(err)}`);
  }

  const fields = { _id: 1, barcode: 1, issueStatus: 1, returnStatus: 1, issueWeight: 1, coneWeight: 1, returnWeight: 1 };
  const factoryCone = await mongoose.connection.db.collection('yarncones').findOne({ _id: cone._id }, { projection: fields });
  const ids = (await SyncOutbox.find({ entityType: 'yarnCone', aggregateId: String(cone._id) }).select('eventId').lean()).map((r) => r.eventId);
  log(`  outbox events for this cone on addon2: ${ids.length}`);
  const polled = await pollUntil(async () => {
    const [c, inbox] = await Promise.all([cdb.collection('yarncones').findOne({ _id: cone._id }, { projection: fields }), inboxFor(cdb, ids)]);
    const allIn = inbox.length === ids.length && inbox.every((r) => r.status === 'APPLIED');
    return { done: allIn && same(c, factoryCone), fatal: stuckReason(inbox), state: { c, inbox } };
  });
  log(`  after ${polled.secs} s`);
  log(`    addon2 cone: ${JSON.stringify(factoryCone)}`);
  log(`    addon cone:  ${JSON.stringify(polled.state && polled.state.c)}`);
  ((polled.state && polled.state.inbox) || []).forEach((r) => log(`    addon inbox ${r.eventType} ${r.status}${r.lastError ? ` ${r.lastError}` : ''}`));
  if (serviceErrors.length) return record('2 yarn cone', false, serviceErrors.join('; '));
  return record('2 yarn cone', polled.ok, polled.ok ? `cone ${cone._id} ${barcode} matches` : polled.fatal || 'no match within 150 s');
};

/** Step 3: warehouse inventory create + update. */
const stepWarehouse = async (cdb) => {
  log('\n[3] warehouse inventory: create + quantity update on addon2');
  let inv;
  try {
    const style = await createStyleCode({ styleCode: `SYNCWH${TS}`, eanCode: `SYNCWH${TS}`, mrp: 1, brand: 'SYNC', pack: '1' });
    const item = await Product.findOne({}).select('_id').lean();
    inv = await createWarehouseInventory({ itemId: item._id, styleCodeId: style._id, styleCode: style.styleCode, totalQuantity: 5 });
    log(`  createWarehouseInventory: _id ${inv._id} styleCode ${inv.styleCode} total ${inv.totalQuantity}`);
    inv = await updateWarehouseInventoryById(inv._id, { totalQuantity: 8, adjustReason: TAG }, null);
    log(`  updateWarehouseInventoryById: total ${inv.totalQuantity}`);
  } catch (err) {
    log(`  REJECTED: ${errText(err)}`);
    return record('3 warehouse', false, `rejected: ${errText(err)}`);
  }
  const ids = (await SyncOutbox.find({ entityType: 'warehouseInventory', aggregateId: String(inv._id) }).select('eventId').lean()).map((r) => r.eventId);
  const polled = await pollUntil(async () => {
    const [c, inbox] = await Promise.all([
      cdb.collection('stocks').findOne({ _id: inv._id }, { projection: { totalQuantity: 1, availableQuantity: 1 } }),
      inboxFor(cdb, ids),
    ]);
    return { done: Boolean(c) && c.totalQuantity === 8, fatal: stuckReason(inbox), state: { c, inbox } };
  });
  log(`  after ${polled.secs} s: addon row ${JSON.stringify(polled.state && polled.state.c)}`);
  ((polled.state && polled.state.inbox) || []).forEach((r) => log(`    addon inbox ${r.eventType} ${r.status}${r.lastError ? ` ${r.lastError}` : ''}`));
  return record('3 warehouse', polled.ok, polled.ok ? `_id ${inv._id} total 8 on addon` : polled.fatal || 'no match within 150 s');
};

/**
 * One category, style code, product and yarn catalog on the current database through the real services.
 * @param {string} side 'F' (factory) or 'C' (cloud)
 * @returns {Promise<Array<{ collection: string, _id: any, codeField: string, code: string }>>}
 */
const createMasters = async (side) => {
  const sfx = `${side}${TS}`;
  const category = await createCategory({ name: `SYNC-CAT-${sfx}` });
  const style = await createStyleCode({ styleCode: `SYNCSC${sfx}`, eanCode: `SYNCEAN${sfx}`, mrp: 1, brand: 'SYNC', pack: '1' });
  const product = await createProduct({ name: `SYNC-PROD-${sfx}`, softwareCode: `SYNCSW${sfx}`, category: category._id, styleCodes: [style._id] });
  const tpl = await YarnCatalog.findOne({ status: 'active' }).lean();
  const yarn = await createYarnCatalog({
    yarnName: `SYNC-YARN-${sfx}`,
    yarnType: tpl.yarnType,
    ...(tpl.yarnSubtype ? { yarnSubtype: tpl.yarnSubtype } : {}),
    countSize: tpl.countSize,
    blend: tpl.blend,
    ...(tpl.colorFamily ? { colorFamily: tpl.colorFamily } : {}),
    remark: TAG,
  });
  return [
    { collection: 'categories', _id: category._id, codeField: 'name', code: category.name },
    { collection: 'stylecodes', _id: style._id, codeField: 'styleCode', code: style.styleCode },
    { collection: 'products', _id: product._id, codeField: 'softwareCode', code: product.softwareCode },
    { collection: 'yarncatalogs', _id: yarn._id, codeField: 'yarnName', code: yarn.yarnName },
  ];
};

/**
 * Poll the peer database until every master row exists with the same code.
 * @param {import('mongodb').Db} peer
 * @param {Array<Record<string, any>>} masters
 * @param {Array<Record<string, any>>} rows outbox rows for these masters
 */
const waitForMasters = async (peer, masters, rows) => {
  const polled = await pollUntil(async () => {
    const found = await Promise.all(
      masters.map((m) => peer.collection(m.collection).findOne({ _id: m._id }, { projection: { [m.codeField]: 1 } }))
    );
    const inbox = await inboxFor(peer, rows.map((r) => r.eventId));
    const done = found.every((d, i) => d && d[masters[i].codeField] === masters[i].code);
    return { done, fatal: stuckReason(inbox), state: { found, inbox } };
  });
  masters.forEach((m, i) => {
    const d = polled.state && polled.state.found[i];
    log(`    ${m.collection} ${m._id} ${m.codeField}=${m.code} → ${d ? `present (${d[m.codeField]})` : 'missing'}`);
  });
  ((polled.state && polled.state.inbox) || []).forEach((r) => log(`    inbox ${r.eventType} ${r.status}${r.lastError ? ` ${r.lastError}` : ''}`));
  log(`    after ${polled.secs} s`);
  return polled;
};

/**
 * Re-ingest the same outbox rows into the current database and count rows by _id and inbox rows by eventId.
 * @param {string} sourceSiteId
 * @param {Array<Record<string, any>>} masters
 * @param {Array<Record<string, any>>} rows
 */
const reingest = async (sourceSiteId, masters, rows) => {
  const outcomes = [];
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    const r = await ingestEvent(sourceSiteId, toWireEvent(row));
    outcomes.push(`${row.eventType}:${r.outcome}/${r.apply ? r.apply.applyOutcome : '-'}`);
  }
  const db = mongoose.connection.db;
  const counts = await Promise.all(masters.map((m) => db.collection(m.collection).countDocuments({ _id: m._id })));
  const inboxCounts = await Promise.all(rows.map((r) => db.collection('syncinboxes').countDocuments({ eventId: r.eventId })));
  log(`    re-ingest: ${outcomes.join(', ')}`);
  log(`    rows by _id ${JSON.stringify(counts)}  inbox rows by eventId ${JSON.stringify(inboxCounts)}`);
  return counts.every((n) => n === 1) && inboxCounts.every((n) => n === 1);
};

/** Step 4: masters both ways + re-ingest. */
const stepMasters = async (cdb, fdb) => {
  log('\n[4] masters both ways');
  const outboxFor = (masters) => SyncOutbox.find({ aggregateId: { $in: masters.map((m) => String(m._id)) } }).lean();
  let fMasters;
  let cMasters;
  let fRows;
  let cRows;
  try {
    fMasters = await createMasters('F');
    fRows = await outboxFor(fMasters);
    log(`  created on addon2; outbox rows ${fRows.length}`);
  } catch (err) {
    return record('4 masters', false, `create on addon2 rejected: ${errText(err)}`);
  }
  log('  waiting for addon');
  const toCloud = await waitForMasters(cdb, fMasters, fRows);

  await actAs(CLOUD_DB, CLOUD_SITE_ID);
  try {
    cMasters = await createMasters('C');
    cRows = await outboxFor(cMasters);
    log(`  created on addon (site ${CLOUD_SITE_ID}); outbox rows ${cRows.length}`);
  } catch (err) {
    await actAs(FACTORY_DB, FACTORY_SITE_ID);
    return record('4 masters', false, `create on addon rejected: ${errText(err)}`);
  }
  log('  waiting for addon2');
  const toFactory = await waitForMasters(fdb, cMasters, cRows);

  log('  re-ingest factory events on addon');
  const onCloud = await reingest(FACTORY_SITE_ID, fMasters, fRows);
  await actAs(FACTORY_DB, FACTORY_SITE_ID);
  log('  re-ingest cloud events on addon2');
  const onFactory = await reingest(CLOUD_SITE_ID, cMasters, cRows);

  const pass = toCloud.ok && toFactory.ok && onCloud && onFactory && fRows.length === 4 && cRows.length === 4;
  const detail = `addon2→addon ${toCloud.ok ? 'ok' : toCloud.fatal || 'timeout'}, addon→addon2 ${toFactory.ok ? 'ok' : toFactory.fatal || 'timeout'}, counts stay 1: ${onCloud && onFactory}`;
  return record('4 masters', pass, detail);
};

const main = async () => {
  await actAs(FACTORY_DB, FACTORY_SITE_ID);
  const cloud = await openRaw(CLOUD_DB);
  const factory = await openRaw(FACTORY_DB);
  log(`factory db ${FACTORY_DB} (site ${FACTORY_SITE_ID})   cloud db ${CLOUD_DB} (site ${CLOUD_SITE_ID})`);
  await stepFloors(cloud.db);
  await stepYarn(cloud.db);
  await stepWarehouse(cloud.db);
  await stepMasters(cloud.db, factory.db);
  await cloud.close();
  await factory.close();
  return finish();
};

main().catch(async (err) => {
  log(`\nthrew: ${errText(err)}`);
  await finish(`threw: ${errText(err)}`);
});
