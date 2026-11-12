/**
 * Proves the three gaps left after syncOwnershipApply.js, without creating another production order.
 *
 *   1. Yarn issue the way the screen does it (yarn_issued transaction, then cone issueStatus issued),
 *      then returnYarnCone. The cone on addon must match addon2 afterwards.
 *   2. Re-ingest the master creates already on both databases. Counts by _id and by eventId stay 1.
 *   3. One vendor floor transfer on a flow that already exists on both databases.
 *
 *   cd AddOn_backend && node scripts/syncOwnershipRemainder.js
 */
import mongoose from 'mongoose';
import { YarnCatalog } from '../src/models/index.js';
import SyncOutbox from '../src/models/sync/syncOutbox.model.js';
import { createYarnCone, returnYarnCone, updateYarnConeById } from '../src/services/yarnManagement/yarnCone.service.js';
import { createYarnTransaction } from '../src/services/yarnManagement/yarnTransaction.service.js';
import { transferVendorProductionFlowQuantity } from '../src/services/vendorManagement/vendorProductionFlow.service.js';
import { ingestEvent } from '../src/services/sync/syncInbox.service.js';
import { toWireEvent } from '../src/services/sync/syncCursor.service.js';
import {
  CLOUD_DB,
  CLOUD_SITE_ID,
  FACTORY_DB,
  FACTORY_SITE_ID,
  actAs,
  errText,
  inboxFor,
  log,
  openRaw,
  pollUntil,
  stuckReason,
} from './lib/syncOwnershipProofLib.js';

const TS = Date.now();
const results = [];

/**
 * @param {string} step
 * @param {boolean} pass
 * @param {string} detail
 */
const record = (step, pass, detail) => {
  results.push({ step, pass, detail });
  log(`  → ${step}: ${pass ? 'PASS' : 'FAIL'}${detail ? ` (${detail})` : ''}`);
};

/**
 * Production yarn issue, then return, factory → cloud.
 * @param {import('mongodb').Db} cloud
 */
const stepYarn = async (cloud) => {
  log('\n[1] yarn issue screen → returnYarnCone');
  const catalogs = await YarnCatalog.find({ status: 'active' }).select('_id yarnName').limit(50).lean();
  let catalog = null;
  for (const cat of catalogs) {
    // eslint-disable-next-line no-await-in-loop
    if (await cloud.collection('yarncatalogs').findOne({ _id: cat._id }, { projection: { _id: 1 } })) {
      catalog = cat;
      break;
    }
  }
  if (!catalog) return record('1 yarn issue/return', false, 'no yarn catalog on both databases');

  const barcode = `SYNCRET${TS}`;
  const cone = await createYarnCone({
    poNumber: 'SYNC-RETURN',
    boxId: `SYNC-RETURN-${TS}`,
    yarnCatalogId: catalog._id,
    yarnName: catalog.yarnName,
    coneWeight: 1,
    tearWeight: 0,
    barcode,
  });
  log(`  cone ${cone._id} ${barcode}`);
  const txn = await createYarnTransaction({
    yarnCatalogId: String(catalog._id),
    yarnName: catalog.yarnName,
    transactionType: 'yarn_issued',
    transactionDate: new Date().toISOString(),
    transactionNetWeight: 1,
    transactionTotalWeight: 1,
    transactionTearWeight: 0,
    transactionConeCount: 1,
    conesIdsArray: [String(cone._id)],
    orderno: 'SYNC-RETURN',
  });
  log(`  yarn_issued ${txn._id}`);
  await updateYarnConeById(String(cone._id), { issueStatus: 'issued', issueDate: new Date().toISOString(), issueWeight: 1 });
  log('  cone marked issued');

  const issued = await pollUntil(async () => {
    const row = await cloud.collection('yarncones').findOne({ _id: cone._id }, { projection: { issueStatus: 1 } });
    const txnRow = await cloud.collection('yarntransactions').findOne({ _id: txn._id }, { projection: { transactionType: 1 } });
    return { done: Boolean(row && row.issueStatus === 'issued' && txnRow), state: { row, txnRow } };
  });
  log(`  issued on addon after ${issued.secs} s: ${JSON.stringify(issued.state && issued.state.row)}`);
  if (!issued.ok) return record('1 yarn issue/return', false, issued.fatal || 'issue did not reach addon');

  try {
    await returnYarnCone(barcode, { returnWeight: 0 });
    log('  returnYarnCone ok');
  } catch (err) {
    return record('1 yarn issue/return', false, `return rejected: ${errText(err)}`);
  }

  const fields = { issueStatus: 1, returnStatus: 1, coneWeight: 1, returnWeight: 1 };
  const factoryCone = await mongoose.connection.db.collection('yarncones').findOne({ _id: cone._id }, { projection: fields });
  const ids = (await SyncOutbox.find({ aggregateId: String(cone._id), eventType: 'yarnConeReturned' }).select('eventId').lean()).map((r) => r.eventId);
  const returned = await pollUntil(async () => {
    const [row, inbox] = await Promise.all([
      cloud.collection('yarncones').findOne({ _id: cone._id }, { projection: fields }),
      inboxFor(cloud, ids),
    ]);
    const match = row && factoryCone && row.issueStatus === factoryCone.issueStatus && row.coneWeight === factoryCone.coneWeight;
    return { done: match && inbox.every((r) => r.status === 'APPLIED'), fatal: stuckReason(inbox), state: { row, inbox } };
  });
  log(`  addon2 ${JSON.stringify(factoryCone)}`);
  log(`  addon   ${JSON.stringify(returned.state && returned.state.row)} after ${returned.secs} s`);
  return record('1 yarn issue/return', returned.ok, returned.ok ? `${barcode} matches` : returned.fatal || 'return did not match');
};

/**
 * Second delivery of the master creates from the earlier run. No new masters.
 * @param {import('mongodb').Db} cloud
 * @param {import('mongodb').Db} factory
 */
const stepMasters = async (cloud, factory) => {
  log('\n[2] re-ingest existing master creates');
  const specs = [
    { collection: 'categories', field: 'name', re: /^SYNC-CAT-/ },
    { collection: 'stylecodes', field: 'styleCode', re: /^SYNCSC/ },
    { collection: 'products', field: 'softwareCode', re: /^SYNCSW/ },
    { collection: 'yarncatalogs', field: 'yarnName', re: /^SYNC-YARN-/ },
  ];
  const pairs = [];
  for (const spec of specs) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await cloud.collection(spec.collection).find({ [spec.field]: spec.re }).project({ _id: 1 }).toArray();
    rows.forEach((row) => pairs.push({ collection: spec.collection, _id: row._id }));
  }
  if (pairs.length < 4) return record('2 master re-ingest', false, `found ${pairs.length} SYNC masters on addon`);

  const checkSide = async (dbName, siteId, sourceSiteId, peerDb) => {
    await actAs(dbName, siteId);
    const ids = pairs.map((p) => String(p._id));
    const rows = await peerDb.collection('syncoutboxes').find({ aggregateId: { $in: ids }, siteId: sourceSiteId }).toArray();
    if (!rows.length) return { ok: false, detail: `no ${sourceSiteId} outbox rows` };
    const outcomes = [];
    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop
      const again = await ingestEvent(sourceSiteId, toWireEvent(row));
      outcomes.push(again.outcome);
    }
    const db = mongoose.connection.db;
    const counts = await Promise.all(pairs.map((p) => db.collection(p.collection).countDocuments({ _id: p._id })));
    const inboxCounts = await Promise.all(rows.map((r) => db.collection('syncinboxes').countDocuments({ eventId: r.eventId })));
    const ok = counts.every((n) => n === 1) && inboxCounts.every((n) => n === 1) && outcomes.every((o) => o === 'DUPLICATE' || o === 'STORED');
    return { ok, detail: `outcomes ${outcomes.join(',')} counts ${counts.join(',')} inbox ${inboxCounts.join(',')}` };
  };

  const onCloud = await checkSide(CLOUD_DB, CLOUD_SITE_ID, FACTORY_SITE_ID, factory);
  const onFactory = await checkSide(FACTORY_DB, FACTORY_SITE_ID, CLOUD_SITE_ID, cloud);
  log(`  addon  ${onCloud.detail}`);
  log(`  addon2 ${onFactory.detail}`);
  await actAs(FACTORY_DB, FACTORY_SITE_ID);
  const pass = onCloud.ok && onFactory.ok;
  return record('2 master re-ingest', pass, pass ? `${pairs.length} masters stay at 1` : 'a count moved');
};

/**
 * One dispatch → warehouse transfer on a flow present on both databases.
 * Final checking has no spare M1 on this copy. Dispatch still has unsent quantity, and that
 * transfer is the explicit vendor move. It reuses a container barcode that already exists on both sides.
 * @param {import('mongodb').Db} cloud
 */
const stepVendor = async (cloud) => {
  log('\n[3] vendor transfer factory → cloud');
  const flows = await mongoose.connection.db.collection('vendorproductionflows').find({
    $expr: {
      $gt: [
        { $ifNull: ['$floorQuantities.dispatch.received', 0] },
        { $ifNull: ['$floorQuantities.dispatch.transferred', 0] },
      ],
    },
  }).project({ 'floorQuantities.dispatch.received': 1, 'floorQuantities.dispatch.transferred': 1 }).limit(20).toArray();
  let picked = null;
  for (const flow of flows) {
    // eslint-disable-next-line no-await-in-loop
    const onCloud = await cloud.collection('vendorproductionflows').findOne({ _id: flow._id }, { projection: { _id: 1 } });
    if (onCloud) {
      picked = flow;
      break;
    }
  }
  if (!picked) return record('3 vendor transfer', false, 'no shared flow has unsent dispatch quantity');
  const empties = await mongoose.connection.db.collection('containers_masters').find(
    { barcode: { $exists: true, $ne: '' }, activeFloor: { $in: ['', null] }, $or: [{ activeItems: { $size: 0 } }, { activeItems: { $exists: false } }] },
    { projection: { barcode: 1 } }
  ).limit(30).toArray();
  let container = null;
  for (const row of empties) {
    // eslint-disable-next-line no-await-in-loop
    const onCloudContainer = await cloud.collection('containers_masters').findOne(
      { barcode: row.barcode, activeFloor: { $in: ['', null] }, $or: [{ activeItems: { $size: 0 } }, { activeItems: { $exists: false } }] },
      { projection: { _id: 1 } }
    );
    if (onCloudContainer) {
      container = row;
      break;
    }
  }
  if (!container) return record('3 vendor transfer', false, 'no empty container barcode on both databases');
  log(`  flow ${picked._id} container ${container.barcode}`);
  try {
    await transferVendorProductionFlowQuantity(String(picked._id), 'dispatch', 'warehouse', 1, {
      existingContainerBarcode: container.barcode,
    });
    log('  transfer 1 dispatch → warehouse');
  } catch (err) {
    return record('3 vendor transfer', false, errText(err));
  }
  const factoryTransferred = (await mongoose.connection.db.collection('vendorproductionflows').findOne(
    { _id: picked._id },
    { projection: { 'floorQuantities.dispatch.transferred': 1 } }
  )).floorQuantities.dispatch.transferred;
  const polled = await pollUntil(async () => {
    const row = await cloud.collection('vendorproductionflows').findOne(
      { _id: picked._id },
      { projection: { 'floorQuantities.dispatch.transferred': 1 } }
    );
    const transferred = row && row.floorQuantities && row.floorQuantities.dispatch && row.floorQuantities.dispatch.transferred;
    return { done: transferred === factoryTransferred, state: { transferred } };
  });
  log(`  addon2 transferred ${factoryTransferred}  addon ${JSON.stringify(polled.state && polled.state.transferred)} after ${polled.secs} s`);
  return record('3 vendor transfer', polled.ok, polled.ok ? `flow ${picked._id} transferred ${factoryTransferred}` : 'cloud transferred did not match');
};

/**
 * The warehouse row from the earlier run lives in `stocks`, not `warehouseinventories`.
 * @param {import('mongodb').Db} cloud
 */
const stepWarehouse = async (cloud) => {
  log('\n[warehouse] existing stock row');
  const id = new mongoose.Types.ObjectId('6af57f2bf3adf858d6b6637e');
  const factoryRow = await mongoose.connection.db.collection('stocks').findOne({ _id: id }, { projection: { totalQuantity: 1 } });
  const cloudRow = await cloud.collection('stocks').findOne({ _id: id }, { projection: { totalQuantity: 1 } });
  const pass = Boolean(factoryRow && cloudRow && factoryRow.totalQuantity === 8 && cloudRow.totalQuantity === 8);
  log(`  addon2 ${JSON.stringify(factoryRow)}  addon ${JSON.stringify(cloudRow)}`);
  return record('warehouse', pass, pass ? 'total 8 on both' : 'quantity differs');
};

const main = async () => {
  await actAs(FACTORY_DB, FACTORY_SITE_ID);
  const cloud = await openRaw(CLOUD_DB);
  const factory = await openRaw(FACTORY_DB);
  log('factory addon2 → cloud addon');
  try {
    if (process.argv.includes('--only=vendor')) {
      await stepVendor(cloud.db);
    } else if (process.argv.includes('--only=warehouse')) {
      await stepWarehouse(cloud.db);
    } else {
      await stepYarn(cloud.db);
      await stepMasters(cloud.db, factory.db);
      await stepVendor(cloud.db);
    }
  } catch (err) {
    log(`STOPPED: ${errText(err)}`);
    results.push({ step: 'run', pass: false, detail: errText(err) });
  }
  log('\n===== summary =====');
  results.forEach((r) => log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.step}  ${r.detail || ''}`));
  const ok = results.length > 0 && results.every((r) => r.pass);
  log(`\nRESULT: ${ok ? 'PASS' : 'FAIL'}`);
  await cloud.close().catch(() => {});
  await factory.close().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exit(ok ? 0 : 1);
};

main().catch((err) => {
  log(`STOPPED: ${errText(err)}`);
  process.exit(1);
});
