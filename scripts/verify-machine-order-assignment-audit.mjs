/**
 * Verifies MachineOrderAssignmentLog rows are written for all major flows.
 * Run: NODE_ENV=test node scripts/verify-machine-order-assignment-audit.mjs
 * Requires MongoDB (same MONGODB_URL as test DB).
 */
import mongoose from 'mongoose';
import assert from 'assert';
import config from '../src/config/config.js';
import '../src/models/production/index.js';
import Machine from '../src/models/machine.model.js';
import MachineOrderAssignment from '../src/models/production/machineOrderAssignment.model.js';
import MachineOrderAssignmentLog from '../src/models/production/machineOrderAssignmentLog.model.js';
import { OrderStatus, YarnIssueStatus, YarnReturnStatus, LogAction } from '../src/models/production/enums.js';
import * as moaService from '../src/services/production/machineOrderAssignment.service.js';

const countLogs = () => MachineOrderAssignmentLog.countDocuments();

async function clearCollections() {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany())
  );
}

async function seedMachine() {
  return Machine.create({
    machineCode: `AUDIT-V-${Date.now()}`,
    machineNumber: `NV${Date.now()}`,
    floor: 'Knitting',
  });
}

async function run() {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  console.log('Connected. Running MOA audit checks...\n');

  const userId = new mongoose.Types.ObjectId();

  // 1. Create without user → system log
  await clearCollections();
  const machine = await seedMachine();
  const poId = new mongoose.Types.ObjectId();
  const articleId = new mongoose.Types.ObjectId();
  assert.strictEqual(await countLogs(), 0);
  await moaService.createMachineOrderAssignment(
    {
      machine: machine._id,
      activeNeedle: '7',
      productionOrderItems: [
        {
          productionOrder: poId,
          article: articleId,
          status: OrderStatus.PENDING,
          yarnIssueStatus: YarnIssueStatus.PENDING,
          yarnReturnStatus: YarnReturnStatus.PENDING,
          priority: 1,
        },
      ],
    },
    undefined
  );
  assert.strictEqual(await countLogs(), 1);
  let log = await MachineOrderAssignmentLog.findOne();
  assert.strictEqual(log.auditSource, 'system');
  assert.strictEqual(log.action, LogAction.ASSIGNMENT_CREATED);
  assert.ok(log.snapshotAfter);
  console.log('✓ create without userId → log + snapshotAfter + auditSource system');

  // 2. Merge PATCH logs field-level change
  const a = await MachineOrderAssignment.findOne();
  const item = a.productionOrderItems[0];
  const n0 = await countLogs();
  await moaService.updateMachineOrderAssignmentById(
    a._id,
    {
      productionOrderItems: [
        {
          productionOrder: poId,
          article: articleId,
          status: OrderStatus.ON_HOLD,
        },
      ],
    },
    userId
  );
  assert.strictEqual(await countLogs(), n0 + 1);
  log = await MachineOrderAssignmentLog.findOne().sort({ createdAt: -1 });
  assert.strictEqual(log.action, LogAction.ASSIGNMENT_ITEMS_UPDATED);
  assert.ok(log.changes.some((c) => String(c.field).includes(String(item._id))));
  assert.ok(log.snapshotBefore && log.snapshotAfter);
  console.log('✓ merge PATCH → granular changes + snapshots');

  // 3. Full completion removal (sequential yarn + status)
  await clearCollections();
  const m2 = await seedMachine();
  const po2 = new mongoose.Types.ObjectId();
  const art2 = new mongoose.Types.ObjectId();
  const created = await moaService.createMachineOrderAssignment(
    {
      machine: m2._id,
      activeNeedle: '8',
      productionOrderItems: [
        {
          productionOrder: po2,
          article: art2,
          status: OrderStatus.PENDING,
          yarnIssueStatus: YarnIssueStatus.PENDING,
          yarnReturnStatus: YarnReturnStatus.PENDING,
          priority: 1,
        },
      ],
    },
    userId
  );
  const itemId = created.productionOrderItems[0]._id;
  await moaService.updateProductionOrderItemYarnIssueStatusById(
    created._id,
    itemId,
    { yarnIssueStatus: YarnIssueStatus.COMPLETED },
    userId
  );
  await moaService.updateProductionOrderItemYarnReturnStatusById(
    created._id,
    itemId,
    { yarnReturnStatus: YarnReturnStatus.COMPLETED },
    userId
  );
  await moaService.updateProductionOrderItemStatusById(
    created._id,
    itemId,
    { status: OrderStatus.COMPLETED },
    userId
  );
  log = await MachineOrderAssignmentLog.findOne().sort({ createdAt: -1 });
  assert.strictEqual(log.action, LogAction.ASSIGNMENT_ITEM_COMPLETED_REMOVED);
  const afterAssign = await MachineOrderAssignment.findById(created._id);
  assert.strictEqual(afterAssign.productionOrderItems.length, 0);
  console.log('✓ full completion chain → ASSIGNMENT_ITEM_COMPLETED_REMOVED + item dropped');

  // 4. No-op merge → no extra log
  await clearCollections();
  const m3 = await seedMachine();
  const po3 = new mongoose.Types.ObjectId();
  const art3 = new mongoose.Types.ObjectId();
  const a3 = await moaService.createMachineOrderAssignment(
    {
      machine: m3._id,
      activeNeedle: '9',
      productionOrderItems: [
        {
          productionOrder: po3,
          article: art3,
          status: OrderStatus.PENDING,
          yarnIssueStatus: YarnIssueStatus.PENDING,
          yarnReturnStatus: YarnReturnStatus.PENDING,
          priority: 1,
        },
      ],
    },
    userId
  );
  const nBefore = await countLogs();
  await moaService.updateMachineOrderAssignmentById(
    a3._id,
    {
      productionOrderItems: [
        {
          productionOrder: po3,
          article: art3,
          status: OrderStatus.PENDING,
        },
      ],
    },
    userId
  );
  assert.strictEqual(await countLogs(), nBefore);
  console.log('✓ merge no-op → no new log');

  // 5. removeProductionOrderFromAssignments (order_sync)
  await clearCollections();
  const m4 = await seedMachine();
  const po4 = new mongoose.Types.ObjectId();
  const art4 = new mongoose.Types.ObjectId();
  await moaService.createMachineOrderAssignment(
    {
      machine: m4._id,
      activeNeedle: '10',
      productionOrderItems: [
        {
          productionOrder: po4,
          article: art4,
          status: OrderStatus.PENDING,
          yarnIssueStatus: YarnIssueStatus.PENDING,
          yarnReturnStatus: YarnReturnStatus.PENDING,
          priority: 1,
        },
      ],
    },
    userId
  );
  await moaService.removeProductionOrderFromAssignments(po4, undefined);
  log = await MachineOrderAssignmentLog.findOne().sort({ createdAt: -1 });
  assert.strictEqual(log.auditSource, 'order_sync');
  assert.strictEqual(log.action, LogAction.ASSIGNMENT_SYNC_ORDER_REMOVED_FROM_QUEUE);
  console.log('✓ removeProductionOrderFromAssignments → order_sync log');

  // 6. delete assignment
  await clearCollections();
  const m5 = await seedMachine();
  const a5 = await moaService.createMachineOrderAssignment(
    { machine: m5._id, activeNeedle: '11', productionOrderItems: [] },
    userId
  );
  await moaService.deleteMachineOrderAssignmentById(a5._id, userId);
  log = await MachineOrderAssignmentLog.findOne().sort({ createdAt: -1 });
  assert.strictEqual(log.action, LogAction.ASSIGNMENT_DEACTIVATED);
  assert.ok(log.snapshotBefore);
  console.log('✓ delete assignment → log with snapshotBefore');

  // 7. reset queue
  await clearCollections();
  const m6 = await seedMachine();
  const po6 = new mongoose.Types.ObjectId();
  const art6 = new mongoose.Types.ObjectId();
  const a6 = await moaService.createMachineOrderAssignment(
    {
      machine: m6._id,
      activeNeedle: '12',
      productionOrderItems: [
        {
          productionOrder: po6,
          article: art6,
          status: OrderStatus.PENDING,
          yarnIssueStatus: YarnIssueStatus.PENDING,
          yarnReturnStatus: YarnReturnStatus.PENDING,
          priority: 1,
        },
      ],
    },
    userId
  );
  await moaService.resetMachineOrderAssignmentById(a6._id, userId);
  const a6after = await MachineOrderAssignment.findById(a6._id);
  assert.strictEqual(a6after.productionOrderItems.length, 0);
  log = await MachineOrderAssignmentLog.findOne().sort({ createdAt: -1 });
  assert.strictEqual(log.action, LogAction.ASSIGNMENT_ITEMS_UPDATED);
  assert.ok(log.changes.some((c) => c.field === 'productionOrderItems' && c.newValue === 0));
  console.log('✓ reset queue → cleared + log');

  // 8. removeArticleFromAssignments (user)
  await clearCollections();
  const m7 = await seedMachine();
  const po7 = new mongoose.Types.ObjectId();
  const art7 = new mongoose.Types.ObjectId();
  await moaService.createMachineOrderAssignment(
    {
      machine: m7._id,
      activeNeedle: '13',
      productionOrderItems: [
        {
          productionOrder: po7,
          article: art7,
          status: OrderStatus.PENDING,
          yarnIssueStatus: YarnIssueStatus.PENDING,
          yarnReturnStatus: YarnReturnStatus.PENDING,
          priority: 1,
        },
      ],
    },
    userId
  );
  await moaService.removeArticleFromAssignments(po7, art7, userId);
  log = await MachineOrderAssignmentLog.findOne().sort({ createdAt: -1 });
  assert.strictEqual(log.auditSource, 'user');
  assert.strictEqual(log.action, LogAction.ASSIGNMENT_SYNC_ARTICLE_REMOVED_FROM_QUEUE);
  console.log('✓ removeArticleFromAssignments → user log');

  // 9. delete item manual
  await clearCollections();
  const m8 = await seedMachine();
  const po8 = new mongoose.Types.ObjectId();
  const art8 = new mongoose.Types.ObjectId();
  const a8 = await moaService.createMachineOrderAssignment(
    {
      machine: m8._id,
      activeNeedle: '14',
      productionOrderItems: [
        {
          productionOrder: po8,
          article: art8,
          status: OrderStatus.PENDING,
          yarnIssueStatus: YarnIssueStatus.COMPLETED,
          yarnReturnStatus: YarnReturnStatus.PENDING,
          priority: 1,
        },
      ],
    },
    userId
  );
  const delItemId = a8.productionOrderItems[0]._id;
  await moaService.deleteProductionOrderItemById(a8._id, delItemId, userId);
  log = await MachineOrderAssignmentLog.findOne().sort({ createdAt: -1 });
  assert.strictEqual(log.changes[0].newValue.reason, 'manual_delete');
  console.log('✓ delete item → manual_delete log');

  // 10. item endpoint without userId still logs
  await clearCollections();
  const m9 = await seedMachine();
  const po9 = new mongoose.Types.ObjectId();
  const art9 = new mongoose.Types.ObjectId();
  const a9 = await moaService.createMachineOrderAssignment(
    {
      machine: m9._id,
      activeNeedle: '15',
      productionOrderItems: [
        {
          productionOrder: po9,
          article: art9,
          status: OrderStatus.PENDING,
          yarnIssueStatus: YarnIssueStatus.COMPLETED,
          yarnReturnStatus: YarnReturnStatus.PENDING,
          priority: 1,
        },
      ],
    },
    userId
  );
  const i9 = a9.productionOrderItems[0]._id;
  await moaService.updateProductionOrderItemStatusById(a9._id, i9, { status: OrderStatus.IN_PROGRESS }, undefined);
  log = await MachineOrderAssignmentLog.findOne().sort({ createdAt: -1 });
  assert.strictEqual(log.auditSource, 'system');
  console.log('✓ status update without userId → auditSource system');

  console.log('\nAll MOA audit checks passed.');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
