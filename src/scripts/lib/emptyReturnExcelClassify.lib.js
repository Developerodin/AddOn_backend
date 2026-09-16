/**
 * Classify Excel cone rows into empty-return vs mark-used leftover vs skip.
 */

import { oid, returnCoversCurrentIssue } from './emptyReturnExcelCones.lib.js';
import { isAlreadyUsedCleared, shouldMarkUsedLeftover } from './emptyReturnExcelMarkUsed.lib.js';

/**
 * @param {{ barcode: string, excelOrder: string, rowIndex: number }[]} excelRows
 * @param {Map<string, object>} coneByBarcode
 * @param {{ latestIssue: Map<string, object>, returns: Map<string, object[]> }} txns
 * @returns {object[]}
 */
export function classifyExcelRows(excelRows, coneByBarcode, txns) {
  const seen = new Set();
  const out = [];
  for (const row of excelRows) {
    const barcode = String(row.barcode || '').trim();
    if (!barcode) {
      out.push({ ...row, barcode: '', action: 'skip_empty_barcode', reason: 'Empty barcode' });
      continue;
    }
    if (seen.has(barcode)) {
      out.push({ ...row, barcode, action: 'skip_duplicate_barcode', reason: 'Duplicate barcode in Excel' });
      continue;
    }
    seen.add(barcode);
    const cone = coneByBarcode.get(barcode);
    if (!cone) {
      out.push({ ...row, barcode, action: 'not_found', reason: 'YarnCone not found' });
      continue;
    }
    const coneId = String(cone._id);
    const issueStatus = String(cone.issueStatus || '');
    if (issueStatus !== 'issued') {
      if (shouldMarkUsedLeftover(cone)) {
        out.push({
          ...row,
          barcode,
          coneId,
          issueStatus,
          yarnCatalogId: cone.yarnCatalogId ? String(cone.yarnCatalogId) : '',
          coneDoc: cone,
          action: 'would_mark_used',
          reason:
            'not_issued leftover in ST — mark used (yarn_returned already exists for last issue; do not create another txn)',
          needsConeClose: false,
          needsReturnTxn: false,
          needsMarkUsed: true,
        });
        continue;
      }
      out.push({
        ...row,
        barcode,
        coneId,
        issueStatus,
        action: isAlreadyUsedCleared(cone) ? 'skip_already_used' : 'skip_not_issued',
        reason: isAlreadyUsedCleared(cone)
          ? 'Already used / empty / no slot'
          : `issueStatus is '${issueStatus}'`,
        needsConeClose: false,
        needsReturnTxn: false,
        needsMarkUsed: false,
      });
      continue;
    }
    const latestIssue = txns.latestIssue.get(coneId);
    if (!latestIssue) {
      out.push({
        ...row,
        barcode,
        coneId,
        issueStatus,
        action: 'skip_missing_yarn_issued',
        reason: 'No yarn_issued transaction references this cone',
        needsConeClose: false,
        needsReturnTxn: false,
      });
      continue;
    }
    const latestIssueOrder = String(latestIssue.orderno || '');
    const latestIssueArticleId = oid(latestIssue.articleId);
    const issueTxnId = oid(latestIssue._id);
    const covered = (txns.returns.get(coneId) || []).some((rt) => returnCoversCurrentIssue(latestIssue, rt));
    if (covered) {
      out.push({
        ...row,
        barcode,
        coneId,
        issueStatus,
        latestIssueOrder,
        latestIssueArticleId,
        issueTxnId,
        latestIssue,
        action: 'would_close_cone_only',
        reason: 'yarn_returned already exists for this issue order+article; close cone only',
        needsConeClose: true,
        needsReturnTxn: false,
      });
      continue;
    }
    if (!latestIssue.yarnCatalogId || !latestIssue.orderId || !latestIssue.articleId) {
      out.push({
        ...row,
        barcode,
        coneId,
        issueStatus,
        latestIssueOrder,
        latestIssueArticleId,
        issueTxnId,
        latestIssue,
        action: 'skip_missing_issue_refs',
        reason: 'Latest yarn_issued is missing yarnCatalogId, orderId, or articleId',
        needsConeClose: false,
        needsReturnTxn: false,
      });
      continue;
    }
    out.push({
      ...row,
      barcode,
      coneId,
      issueStatus,
      latestIssueOrder,
      latestIssueArticleId,
      issueTxnId,
      latestIssue,
      action: 'would_close_cone_and_create_return_txn',
      reason: 'Empty-return cone and create 0 kg yarn_returned for latest issue order+article',
      needsConeClose: true,
      needsReturnTxn: true,
    });
  }
  return out;
}
