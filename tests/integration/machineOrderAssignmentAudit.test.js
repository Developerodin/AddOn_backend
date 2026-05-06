import mongoose from 'mongoose';
import '../../src/models/production/index.js';
import Machine from '../../src/models/machine.model.js';
import MachineOrderAssignment from '../../src/models/production/machineOrderAssignment.model.js';
import MachineOrderAssignmentLog from '../../src/models/production/machineOrderAssignmentLog.model.js';
import { OrderStatus, YarnIssueStatus, YarnReturnStatus, LogAction } from '../../src/models/production/enums.js';
import * as moaService from '../../src/services/production/machineOrderAssignment.service.js';
import setupTestDB from '../utils/setupTestDB.js';

setupTestDB();

const countLogs = () => MachineOrderAssignmentLog.countDocuments();

async function seedMachine() {
  return Machine.create({
    machineCode: `AUDIT-${Date.now()}`,
    machineNumber: `N${Date.now()}`,
    floor: 'Knitting',
  });
}

describe('Machine order assignment audit logs', () => {
  let machine;
  let poId;
  let articleId;
  let userId;

  beforeEach(async () => {
    machine = await seedMachine();
    poId = new mongoose.Types.ObjectId();
    articleId = new mongoose.Types.ObjectId();
    userId = new mongoose.Types.ObjectId();
  });

  describe('createMachineOrderAssignment', () => {
    test('persists log without userId (auditSource system)', async () => {
      expect(await countLogs()).toBe(0);
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
      expect(await countLogs()).toBe(1);
      const log = await MachineOrderAssignmentLog.findOne();
      expect(log.auditSource).toBe('system');
      expect(log.userId).toBeUndefined();
      expect(log.action).toBe(LogAction.ASSIGNMENT_CREATED);
      expect(log.snapshotAfter).toBeTruthy();
      expect(log.snapshotAfter.machine).toBeDefined();
    });

    test('persists log with userId (auditSource user)', async () => {
      await moaService.createMachineOrderAssignment(
        {
          machine: machine._id,
          activeNeedle: '7',
          productionOrderItems: [],
        },
        userId
      );
      const log = await MachineOrderAssignmentLog.findOne();
      expect(log.auditSource).toBe('user');
      expect(String(log.userId)).toBe(String(userId));
      expect(log.snapshotAfter).toBeTruthy();
    });
  });

  describe('updateMachineOrderAssignmentById', () => {
    test('merge PATCH logs per-item field changes', async () => {
      const a = await moaService.createMachineOrderAssignment(
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
        userId
      );
      const startCount = await countLogs();
      const item = a.productionOrderItems[0];

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

      expect(await countLogs()).toBe(startCount + 1);
      const last = await MachineOrderAssignmentLog.findOne().sort({ createdAt: -1 });
      expect(last.action).toBe(LogAction.ASSIGNMENT_ITEMS_UPDATED);
      expect(last.changes.some((c) => c.field.includes(String(item._id)) && c.field.includes('status'))).toBe(true);
      expect(last.snapshotBefore).toBeTruthy();
      expect(last.snapshotAfter).toBeTruthy();
    });

    test('logs full completion removal with snapshots', async () => {
      const a = await moaService.createMachineOrderAssignment(
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
        userId
      );
      const itemId = a.productionOrderItems[0]._id;
      await moaService.updateProductionOrderItemYarnIssueStatusById(
        a._id,
        itemId,
        { yarnIssueStatus: YarnIssueStatus.COMPLETED },
        userId
      );
      await moaService.updateProductionOrderItemYarnReturnStatusById(
        a._id,
        itemId,
        { yarnReturnStatus: YarnReturnStatus.COMPLETED },
        userId
      );
      const beforeLast = await countLogs();
      await moaService.updateProductionOrderItemStatusById(
        a._id,
        itemId,
        { status: OrderStatus.COMPLETED },
        userId
      );
      expect(await countLogs()).toBe(beforeLast + 1);
      const last = await MachineOrderAssignmentLog.findOne().sort({ createdAt: -1 });
      expect(last.action).toBe(LogAction.ASSIGNMENT_ITEM_COMPLETED_REMOVED);
      expect(last.changes.some((c) => c.field === 'productionOrderItems.removed')).toBe(true);
      expect(last.snapshotAfter.productionOrderItems.length).toBe(0);
    });

    test('no log when merge produces no effective change', async () => {
      const a = await moaService.createMachineOrderAssignment(
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
        userId
      );
      const n = await countLogs();
      await moaService.updateMachineOrderAssignmentById(
        a._id,
        {
          productionOrderItems: [
            {
              productionOrder: poId,
              article: articleId,
              status: OrderStatus.PENDING,
            },
          ],
        },
        userId
      );
      expect(await countLogs()).toBe(n);
    });

    test('moving (PO,article) to another assignment preserves yarn + status and writes transfer logs', async () => {
      const machineB = await seedMachine();
      const assignmentA = await moaService.createMachineOrderAssignment(
        {
          machine: machine._id,
          activeNeedle: '7',
          productionOrderItems: [
            {
              productionOrder: poId,
              article: articleId,
              status: OrderStatus.IN_PROGRESS,
              yarnIssueStatus: YarnIssueStatus.COMPLETED,
              yarnReturnStatus: YarnReturnStatus.IN_PROGRESS,
              priority: 1,
            },
          ],
        },
        userId
      );
      const assignmentB = await moaService.createMachineOrderAssignment(
        {
          machine: machineB._id,
          activeNeedle: '7',
          productionOrderItems: [],
        },
        userId
      );
      const before = await countLogs();

      await moaService.updateMachineOrderAssignmentById(
        assignmentB._id,
        {
          productionOrderItems: [
            {
              productionOrder: poId,
              article: articleId,
              status: OrderStatus.PENDING,
            },
          ],
        },
        userId
      );

      const refreshedA = await MachineOrderAssignment.findById(assignmentA._id);
      expect(refreshedA.productionOrderItems.length).toBe(0);

      const refreshedB = await MachineOrderAssignment.findById(assignmentB._id);
      expect(refreshedB.productionOrderItems.length).toBe(1);
      const row = refreshedB.productionOrderItems[0];
      expect(String(row.status)).toBe(OrderStatus.IN_PROGRESS);
      expect(String(row.yarnIssueStatus)).toBe(YarnIssueStatus.COMPLETED);
      expect(String(row.yarnReturnStatus)).toBe(YarnReturnStatus.IN_PROGRESS);

      const transferLogs = await MachineOrderAssignmentLog.find({
        action: LogAction.ASSIGNMENT_ITEM_TRANSFERRED_BETWEEN_MACHINES,
      }).sort({ createdAt: 1 });
      expect(transferLogs.length).toBeGreaterThanOrEqual(2);
      expect(transferLogs.every((l) => typeof l.remarks === 'string' && l.remarks.includes('→'))).toBe(true);
      expect(await countLogs()).toBeGreaterThan(before);
    });
  });

  describe('per-item endpoints', () => {
    async function oneItemAssignment() {
      const a = await moaService.createMachineOrderAssignment(
        {
          machine: machine._id,
          activeNeedle: '7',
          productionOrderItems: [
            {
              productionOrder: poId,
              article: articleId,
              status: OrderStatus.PENDING,
              yarnIssueStatus: YarnIssueStatus.COMPLETED,
              yarnReturnStatus: YarnReturnStatus.PENDING,
              priority: 1,
            },
          ],
        },
        userId
      );
      return { assignment: a, itemId: a.productionOrderItems[0]._id };
    }

    test('updateProductionOrderItemPriorityById writes log with snapshots', async () => {
      const { assignment, itemId } = await oneItemAssignment();
      const n = await countLogs();
      await moaService.updateProductionOrderItemPriorityById(assignment._id, itemId, { priority: 2 }, userId);
      expect(await countLogs()).toBe(n + 1);
      const log = await MachineOrderAssignmentLog.findOne().sort({ createdAt: -1 });
      expect(log.snapshotBefore && log.snapshotAfter).toBeTruthy();
    });

    test('updateProductionOrderItemStatusById writes log without userId', async () => {
      const { assignment, itemId } = await oneItemAssignment();
      const n = await countLogs();
      await moaService.updateProductionOrderItemStatusById(assignment._id, itemId, { status: OrderStatus.IN_PROGRESS }, undefined);
      expect(await countLogs()).toBe(n + 1);
      const log = await MachineOrderAssignmentLog.findOne().sort({ createdAt: -1 });
      expect(log.auditSource).toBe('system');
    });

    test('updateProductionOrderItemPrioritiesById batches one log', async () => {
      const a = await moaService.createMachineOrderAssignment(
        {
          machine: machine._id,
          activeNeedle: '7',
          productionOrderItems: [
            {
              productionOrder: poId,
              article: articleId,
              status: OrderStatus.PENDING,
              yarnIssueStatus: YarnIssueStatus.COMPLETED,
              yarnReturnStatus: YarnReturnStatus.PENDING,
              priority: 1,
            },
            {
              productionOrder: new mongoose.Types.ObjectId(),
              article: new mongoose.Types.ObjectId(),
              status: OrderStatus.PENDING,
              yarnIssueStatus: YarnIssueStatus.COMPLETED,
              yarnReturnStatus: YarnReturnStatus.PENDING,
              priority: 2,
            },
          ],
        },
        userId
      );
      const i1 = a.productionOrderItems[0]._id;
      const i2 = a.productionOrderItems[1]._id;
      const n = await countLogs();
      await moaService.updateProductionOrderItemPrioritiesById(
        a._id,
        [
          { itemId: i1, priority: 2 },
          { itemId: i2, priority: 1 },
        ],
        userId
      );
      expect(await countLogs()).toBe(n + 1);
    });

    test('deleteProductionOrderItemById logs removal', async () => {
      const { assignment, itemId } = await oneItemAssignment();
      const n = await countLogs();
      await moaService.deleteProductionOrderItemById(assignment._id, itemId, userId);
      expect(await countLogs()).toBe(n + 1);
      const log = await MachineOrderAssignmentLog.findOne().sort({ createdAt: -1 });
      expect(log.changes[0].newValue.reason).toBe('manual_delete');
    });
  });

  describe('reset and delete assignment', () => {
    test('resetMachineOrderAssignmentById clears queue and logs', async () => {
      const a = await moaService.createMachineOrderAssignment(
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
        userId
      );
      const n = await countLogs();
      await moaService.resetMachineOrderAssignmentById(a._id, userId);
      expect(await countLogs()).toBe(n + 1);
      const last = await MachineOrderAssignmentLog.findOne().sort({ createdAt: -1 });
      expect(last.snapshotAfter.productionOrderItems).toEqual([]);
    });

    test('deleteMachineOrderAssignmentById logs with snapshotBefore only', async () => {
      const a = await moaService.createMachineOrderAssignment(
        {
          machine: machine._id,
          activeNeedle: '7',
          productionOrderItems: [],
        },
        userId
      );
      const n = await countLogs();
      await moaService.deleteMachineOrderAssignmentById(a._id, userId);
      expect(await countLogs()).toBe(n + 1);
      const last = await MachineOrderAssignmentLog.findOne().sort({ createdAt: -1 });
      expect(last.action).toBe(LogAction.ASSIGNMENT_DEACTIVATED);
      expect(last.snapshotBefore).toBeTruthy();
      expect(last.snapshotAfter == null).toBe(true);
    });
  });

  describe('order / article sync helpers', () => {
    test('removeProductionOrderFromAssignments logs order_sync without userId', async () => {
      const a = await moaService.createMachineOrderAssignment(
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
        userId
      );
      const n = await countLogs();
      await moaService.removeProductionOrderFromAssignments(poId, undefined);
      expect(await countLogs()).toBe(n + 1);
      const last = await MachineOrderAssignmentLog.findOne().sort({ createdAt: -1 });
      expect(last.auditSource).toBe('order_sync');
      expect(last.action).toBe(LogAction.ASSIGNMENT_SYNC_ORDER_REMOVED_FROM_QUEUE);
      const still = await MachineOrderAssignment.findById(a._id);
      expect(still.productionOrderItems.length).toBe(0);
    });

    test('removeArticleFromAssignments logs with userId', async () => {
      const a = await moaService.createMachineOrderAssignment(
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
        userId
      );
      const n = await countLogs();
      await moaService.removeArticleFromAssignments(poId, articleId, userId);
      expect(await countLogs()).toBe(n + 1);
      const last = await MachineOrderAssignmentLog.findOne().sort({ createdAt: -1 });
      expect(last.auditSource).toBe('user');
      expect(last.action).toBe(LogAction.ASSIGNMENT_SYNC_ARTICLE_REMOVED_FROM_QUEUE);
      const still = await MachineOrderAssignment.findById(a._id);
      expect(still.productionOrderItems.length).toBe(0);
    });
  });
});
