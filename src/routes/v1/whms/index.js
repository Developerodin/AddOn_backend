import express from 'express';
import orderRoute from './order.route.js';
import inwardRoute from './inward.route.js';
import inwardReceiveRoute from './inwardReceive.route.js';
import warehouseInventoryRoute from './warehouseInventory.route.js';
import approvalsRoute from './approvals.route.js';
import consolidationRoute from './consolidation.route.js';
import gapReportRoute from './gapReport.route.js';
import pickPackRoute from './pickPack.route.js';

const router = express.Router();

router.use('/orders', orderRoute);
router.use('/inward', inwardRoute);
router.use('/inward-receive', inwardReceiveRoute);
router.use('/warehouse-inventory', warehouseInventoryRoute);
router.use('/approvals', approvalsRoute);
router.use('/consolidation', consolidationRoute);
router.use('/gap-report', gapReportRoute);
router.use('/pick-pack', pickPackRoute);

export default router;
