import express from 'express';
import orderRoute from './order.route.js';
import inwardRoute from './inward.route.js';
import inwardReceiveRoute from './inwardReceive.route.js';
import warehouseInventoryRoute from './warehouseInventory.route.js';
import warehouseClientRoute from './warehouseClient.route.js';
import warehouseOrderRoute from './warehouseOrder.route.js';
import approvalsRoute from './approvals.route.js';
import consolidationRoute from './consolidation.route.js';
import gapReportRoute from './gapReport.route.js';
import pickListRoute from './pickList.route.js';
import scanningRoute from './scanning.route.js';
import invoiceRoute from './invoice.route.js';
import warehouseReturnRoute from './warehouseReturn.route.js';

const router = express.Router();

router.use('/orders', orderRoute);
router.use('/inward', inwardRoute);
router.use('/inward-receive', inwardReceiveRoute);
router.use('/warehouse-inventory', warehouseInventoryRoute);
router.use('/warehouse-clients', warehouseClientRoute);
router.use('/warehouse-orders', warehouseOrderRoute);
router.use('/approvals', approvalsRoute);
router.use('/consolidation', consolidationRoute);
router.use('/gap-report', gapReportRoute);
router.use('/pick-list', pickListRoute);
router.use('/scanning', scanningRoute);
router.use('/invoices', invoiceRoute);
router.use('/returns', warehouseReturnRoute);

export default router;
