import {
  ALLOWED_TRANSITIONS,
  TRANSITION_PERMISSIONS,
  allowedNextStatuses,
} from '../../../src/services/whms/orderFlow.service.js';
import {
  WarehouseOrderFlowStatus as F,
  coarseStatusForFlowStatus,
  flowStatusForCoarseStatus,
} from '../../../src/models/whms/warehouseOrder.model.js';

describe('WHMS order flow', () => {
  describe('ALLOWED_TRANSITIONS map', () => {
    it('follows the fulfilment pipeline order', () => {
      expect(ALLOWED_TRANSITIONS[F.ORDER_CREATED]).toContain(F.PICKING);
      expect(ALLOWED_TRANSITIONS[F.PICKING]).toContain(F.PICKING_DONE);
      expect(ALLOWED_TRANSITIONS[F.PICKING_DONE]).toContain(F.BARCODE_IN_PROGRESS);
      expect(ALLOWED_TRANSITIONS[F.BARCODE_IN_PROGRESS]).toContain(F.PACKING_DONE);
      expect(ALLOWED_TRANSITIONS[F.PACKING_DONE]).toContain(F.SENT_TO_SCANNING);
      expect(ALLOWED_TRANSITIONS[F.SENT_TO_SCANNING]).toContain(F.SCANNING_IN_PROGRESS);
      expect(ALLOWED_TRANSITIONS[F.SCANNING_IN_PROGRESS]).toContain(F.SCANNING_DONE);
      expect(ALLOWED_TRANSITIONS[F.SCANNING_DONE]).toContain(F.SENT_TO_BILLING);
      expect(ALLOWED_TRANSITIONS[F.SENT_TO_BILLING]).toContain(F.BILLED);
      expect(ALLOWED_TRANSITIONS[F.BILLED]).toContain(F.READY_TO_DISPATCH);
      expect(ALLOWED_TRANSITIONS[F.READY_TO_DISPATCH]).toEqual(
        expect.arrayContaining([F.DISPATCHED, F.PARTIAL_DISPATCHED, F.READY_FOR_PICKUP])
      );
    });

    it('blocks stage skipping (order-created cannot jump to billed or dispatched)', () => {
      expect(ALLOWED_TRANSITIONS[F.ORDER_CREATED]).not.toContain(F.BILLED);
      expect(ALLOWED_TRANSITIONS[F.ORDER_CREATED]).not.toContain(F.DISPATCHED);
      expect(ALLOWED_TRANSITIONS[F.PICKING]).not.toContain(F.PACKING_DONE);
    });

    it('lets supervisors step back one stage to correct mistakes', () => {
      expect(ALLOWED_TRANSITIONS[F.PICKING_DONE]).toContain(F.PICKING);
      expect(ALLOWED_TRANSITIONS[F.PACKING_DONE]).toContain(F.BARCODE_IN_PROGRESS);
    });

    it('has no exits from delivered and cancelled', () => {
      expect(ALLOWED_TRANSITIONS[F.DELIVERED]).toEqual([]);
      expect(ALLOWED_TRANSITIONS[F.CANCELLED]).toEqual([]);
    });
  });

  describe('TRANSITION_PERMISSIONS map', () => {
    it('gates supervisor stages to whmsPickingSupervise', () => {
      expect(TRANSITION_PERMISSIONS[F.PICKING_DONE]).toBe('whmsPickingSupervise');
      expect(TRANSITION_PERMISSIONS[F.PACKING_DONE]).toBe('whmsPickingSupervise');
    });

    it('gates each team stage to its own permission', () => {
      expect(TRANSITION_PERMISSIONS[F.BARCODE_IN_PROGRESS]).toBe('whmsBarcode');
      expect(TRANSITION_PERMISSIONS[F.SCANNING_DONE]).toBe('whmsScanning');
      expect(TRANSITION_PERMISSIONS[F.BILLED]).toBe('whmsBilling');
      expect(TRANSITION_PERMISSIONS[F.DISPATCHED]).toBe('whmsDispatch');
    });
  });

  describe('allowedNextStatuses', () => {
    it('filters next stages by the user role rights', () => {
      const order = { flowStatus: F.PICKING };
      // floor_supervisor has whmsPickingSupervise + manageOrders (base)
      expect(allowedNextStatuses(order, { role: 'floor_supervisor' })).toEqual(
        expect.arrayContaining([F.PICKING_DONE, F.CANCELLED])
      );
      // barcode_team cannot mark picking done
      expect(allowedNextStatuses(order, { role: 'barcode_team' })).not.toContain(F.PICKING_DONE);
      // admin can do everything
      expect(allowedNextStatuses({ flowStatus: F.SENT_TO_BILLING }, { role: 'admin' })).toContain(F.BILLED);
    });

    it('falls back to a coarse-status mapping for pre-migration orders', () => {
      const legacyOrder = { status: 'in-progress' }; // no flowStatus
      expect(allowedNextStatuses(legacyOrder, { role: 'admin' })).toContain(F.PICKING_DONE);
    });
  });

  describe('coarse ↔ flow status mapping', () => {
    it('maps every flow status to a valid coarse status', () => {
      for (const flow of Object.values(F)) {
        expect(['draft', 'pending', 'in-progress', 'packed', 'dispatched', 'cancelled']).toContain(
          coarseStatusForFlowStatus(flow)
        );
      }
    });

    it('round-trips the key stages', () => {
      expect(coarseStatusForFlowStatus(F.ORDER_CREATED)).toBe('pending');
      expect(coarseStatusForFlowStatus(F.PICKING)).toBe('in-progress');
      expect(coarseStatusForFlowStatus(F.BILLED)).toBe('packed');
      expect(coarseStatusForFlowStatus(F.PARTIAL_DISPATCHED)).toBe('dispatched');
      expect(flowStatusForCoarseStatus('packed')).toBe(F.PACKING_DONE);
      expect(flowStatusForCoarseStatus('dispatched')).toBe(F.DISPATCHED);
    });
  });
});
