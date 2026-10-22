const SHORT_CLOSE = 'Short Close';

/**
 * Article status used when rolling an order up.
 * TODO: Short Close is folded into Pending. docs/ai/DOMAIN.md does not lock a
 * Short Close rule yet. Revisit this mapping when DOMAIN.md does.
 * @param {string} status
 * @returns {string}
 */
export function statusForRollup(status) {
  if (status === SHORT_CLOSE) return 'Pending';
  return status;
}

/**
 * Status a manager should hear. Stored ProductionOrder.status is stale:
 * DOMAIN.md records every dev order as Pending while articles are In Progress.
 * Order: any Cancelled, else all Completed, else any On Hold, else any In Progress, else Pending.
 * @param {string[]} articleStatuses
 * @returns {string}
 */
export function deriveOrderStatus(articleStatuses) {
  const statuses = (articleStatuses || []).map(statusForRollup);
  if (statuses.includes('Cancelled')) return 'Cancelled';
  if (statuses.length > 0 && statuses.every((status) => status === 'Completed')) {
    return 'Completed';
  }
  if (statuses.includes('On Hold')) return 'On Hold';
  if (statuses.includes('In Progress')) return 'In Progress';
  return 'Pending';
}
