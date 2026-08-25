import { OrderStatus } from '../../models/production/enums.js';

/**
 * Single source of truth for "which machine-queue statuses count as pending knitting".
 *
 * Before this module three call sites each had their own list, so the Production
 * Order Summary, the Needle Wise report and the per-machine pending drawer all
 * produced different totals for the same factory. Every consumer must import a
 * named set from here instead of inlining an array.
 */

/**
 * Statuses that mean the machine is done with this queue row, for any reason.
 * A row in one of these states never contributes to pending knitting.
 * @type {ReadonlyArray<string>}
 */
export const TERMINAL_QUEUE_STATUSES = Object.freeze([
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED,
  OrderStatus.SHORT_CLOSE,
  OrderStatus.ON_HOLD,
]);

/**
 * Terminal statuses that mean "the machine closed this row and the unknit
 * balance is not coming back as pending" (business rule, confirmed with ops).
 * @type {ReadonlyArray<string>}
 */
export const CLOSED_ON_MACHINE_STATUSES = Object.freeze([
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED,
]);

/**
 * Statuses hidden from the machine queue UI (Advanced Planning / top-items).
 * Deliberately NOT the same as {@link TERMINAL_QUEUE_STATUSES}: a Cancelled row
 * is still shown to supervisors so they know why a machine freed up.
 * @type {ReadonlyArray<string>}
 */
export const HIDDEN_FROM_QUEUE_STATUSES = Object.freeze([
  OrderStatus.COMPLETED,
  OrderStatus.ON_HOLD,
  OrderStatus.SHORT_CLOSE,
]);

const TERMINAL_SET = new Set(TERMINAL_QUEUE_STATUSES);
const CLOSED_ON_MACHINE_SET = new Set(CLOSED_ON_MACHINE_STATUSES);
const HIDDEN_SET = new Set(HIDDEN_FROM_QUEUE_STATUSES);

/**
 * Normalises a queue-row status, defaulting a missing value to Pending
 * (matches the schema default on productionOrderItems.status).
 * @param {unknown} status
 * @returns {string}
 */
export const normalizeQueueStatus = (status) =>
  status == null || status === '' ? OrderStatus.PENDING : String(status);

/**
 * True when the machine is finished with this row and it should not be counted
 * as pending knitting.
 * @param {unknown} status
 * @returns {boolean}
 */
export const isTerminalQueueStatus = (status) => TERMINAL_SET.has(normalizeQueueStatus(status));

/**
 * True when the row is still live work on a machine.
 * @param {unknown} status
 * @returns {boolean}
 */
export const isLiveQueueStatus = (status) => !isTerminalQueueStatus(status);

/**
 * True when the row was closed on the machine (Completed / Cancelled) and its
 * unknit balance must be excluded from pending.
 * @param {unknown} status
 * @returns {boolean}
 */
export const isClosedOnMachineStatus = (status) =>
  CLOSED_ON_MACHINE_SET.has(normalizeQueueStatus(status));

/**
 * True when the row should be hidden from machine-queue display surfaces.
 * @param {unknown} status
 * @returns {boolean}
 */
export const isHiddenFromQueueStatus = (status) => HIDDEN_SET.has(normalizeQueueStatus(status));

/**
 * Where an article's remaining knitting quantity belongs.
 *
 * `onMachine` + `unplanned` are the only buckets that count as pending work.
 * The rest are reported separately so the report always reconciles instead of
 * silently dropping quantity.
 */
export const KnitPendingBucket = Object.freeze({
  /** At least one live queue row on a machine. Real, planned, pending. */
  ON_MACHINE: 'onMachine',
  /** Never queued on any machine. Real pending work that still needs planning. */
  UNPLANNED: 'unplanned',
  /** Every queue row terminal, at least one Short Close. Reported as hold. */
  SHORT_CLOSED: 'shortClosed',
  /** Every queue row terminal, closed as Completed / Cancelled. Not pending. */
  CLOSED_ON_MACHINE: 'closedOnMachine',
  /** Every queue row terminal and only ever On Hold. Paused, not pending. */
  ON_HOLD: 'onHold',
});

/** Buckets that add up to the knitting the factory still owes. */
export const PENDING_BUCKETS = Object.freeze([
  KnitPendingBucket.ON_MACHINE,
  KnitPendingBucket.UNPLANNED,
]);

/**
 * Picks the bucket for an article from the statuses of every machine-queue row
 * that references it.
 *
 * Precedence matters when an article sits on more than one machine: any live row
 * wins, then Short Close (so short-close leftover keeps reporting as hold, as it
 * did before), then closed-on-machine, then On Hold.
 *
 * @param {Iterable<string>|null|undefined} queueStatuses Statuses of every queue row for the article
 * @returns {string} One of {@link KnitPendingBucket}
 */
export const resolveKnitPendingBucket = (queueStatuses) => {
  const statuses = [...(queueStatuses ?? [])].map(normalizeQueueStatus);
  if (statuses.length === 0) return KnitPendingBucket.UNPLANNED;
  if (statuses.some(isLiveQueueStatus)) return KnitPendingBucket.ON_MACHINE;
  if (statuses.includes(OrderStatus.SHORT_CLOSE)) return KnitPendingBucket.SHORT_CLOSED;
  if (statuses.some(isClosedOnMachineStatus)) return KnitPendingBucket.CLOSED_ON_MACHINE;
  return KnitPendingBucket.ON_HOLD;
};
