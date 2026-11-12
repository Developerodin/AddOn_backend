import crypto from 'crypto';
import config from '../../config/config.js';
import logger from '../../config/logger.js';
import SyncOutbox from '../../models/sync/syncOutbox.model.js';
import { SyncOrigin, SYNC_SCHEMA_VERSION } from '../../models/sync/syncEnums.js';
import { computeEventHash } from './syncHash.js';
import { aggregateVersionKey, nextCounterValue, siteSequenceKey } from './syncCounter.service.js';
import { isApplyPilotEnabled, isFactorySite, isInsideSyncApply } from './syncPilotCapture.js';

/**
 * The only sync module a floor service may import. Nothing runs at import time.
 */

export const VENDOR_FLOW_ENTITY_TYPE = 'vendorProductionFlow';
export const VENDOR_TRANSFER_EVENT_TYPE = 'vendorFloorTransfer';

let warnedMissingSiteId = false;

/** Both SYNC_ENABLED and SYNC_SHADOW_VENDOR_TRANSFER must be true. Read at call time. */
export const isVendorTransferShadowEnabled = () => Boolean(config.sync?.enabled && config.sync?.shadowVendorTransfer);

/**
 * Writes one outbox row for a committed explicit vendor floor transfer. Call only after the floor commit,
 * with no floor session. The caller must catch: this may throw, and a throw must not reach the tablet.
 *
 * Payload is a delta only (no floorQuantities).
 *
 * @param {{ flowId: string, fromFloorKey: string, toFloorKey: string, quantity: number, containerBarcode?: string|null }} delta
 * @returns {Promise<import('mongoose').Document|null>} the outbox row, or null when skipped
 */
export const captureVendorTransferShadow = async (delta) => {
  if (!isVendorTransferShadowEnabled()) return null;
  // Applying a peer's vendor transfer must not capture it again (it would go back to its origin).
  if (isInsideSyncApply()) return null;
  // With pilot apply on, vendor transfers are factory → cloud only: the cloud does not publish them.
  if (isApplyPilotEnabled() && !isFactorySite()) return null;

  const siteId = config.sync.siteId;
  if (!siteId) {
    if (!warnedMissingSiteId) {
      warnedMissingSiteId = true;
      logger.warn('[sync] shadow vendor transfer skipped: SYNC_SITE_ID is empty');
    }
    return null;
  }

  const aggregateId = String(delta.flowId);
  // Version first, then site sequence. If the insert below fails, both values are burned (accepted in shadow v1).
  const aggregateVersion = await nextCounterValue(aggregateVersionKey(VENDOR_FLOW_ENTITY_TYPE, aggregateId));
  const originSequence = await nextCounterValue(siteSequenceKey(siteId));

  const event = {
    eventId: crypto.randomUUID(),
    siteId,
    originSequence,
    entityType: VENDOR_FLOW_ENTITY_TYPE,
    eventType: VENDOR_TRANSFER_EVENT_TYPE,
    aggregateId,
    aggregateVersion,
    schemaVersion: SYNC_SCHEMA_VERSION,
    origin: SyncOrigin.USER,
    occurredAt: new Date(),
    payload: {
      flowId: aggregateId,
      fromFloorKey: String(delta.fromFloorKey),
      toFloorKey: String(delta.toFloorKey),
      quantity: Number(delta.quantity),
      containerBarcode: delta.containerBarcode ? String(delta.containerBarcode) : null,
    },
  };
  event.payloadHash = computeEventHash(event);

  return SyncOutbox.create(event);
};
