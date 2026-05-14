/**
 * YarnCone lookups for stale-box remediation (sheet `box id` vs PO/lot replacement cluster).
 */

import { YarnCone } from '../models/index.js';
import { yarnConeUnavailableIssueStatuses } from '../models/yarnReq/yarnCone.model.js';

const MAX_DOCS_PER_QUERY = 4000;

/**
 * Short-term-available cone (inventory sync semantics).
 * @param {Record<string, unknown>} c
 * @returns {boolean}
 */
function coneIsActiveShortTerm(c) {
  const storage = c.coneStorageId != null && String(c.coneStorageId).trim() !== '';
  const blocked = yarnConeUnavailableIssueStatuses.includes(String(c.issueStatus || ''));
  const w = Number(c.coneWeight ?? 0);
  return Boolean(storage && !blocked && Number.isFinite(w) && w > 0);
}

/**
 * Builds status histogram for CSV output.
 * @param {Record<string, unknown>[]} rows
 * @returns {string}
 */
function statusHistogramCsv(rows) {
  /** @type {Record<string, number>} */
  const acc = {};
  for (const c of rows) {
    const st = String(c.issueStatus || 'unknown');
    acc[st] = (acc[st] || 0) + 1;
  }
  return Object.entries(acc)
    .map(([k, n]) => `${k}:${n}`)
    .sort()
    .join(';');
}

/**
 * @param {Record<string, unknown>[]} cones
 * @returns {{ total:number, activeShortTerm:number, statusCsv:string, sampleBarcodeCsv:string }}
 */
function agg(cones) {
  const ast = cones.filter(coneIsActiveShortTerm).length;
  return {
    total: cones.length,
    activeShortTerm: ast,
    statusCsv: statusHistogramCsv(cones),
    sampleBarcodeCsv: cones
      .slice(0, 6)
      .map((x) => String(x.barcode || x._id))
      .join(','),
  };
}

/**
 * Loads cones keyed to the excel `BOX-...` plus every replacement cluster box id (dedup query).
 *
 * @param {string|null|undefined} sheetBoxIdNormalized
 * @param {Record<string, unknown>[]} yarnBoxClusterLean
 * @returns {Promise<{ sheetBoxAgg: Record<string, unknown>, clusterAgg: Record<string, unknown>, allBoxIdsTouchedCsv: string, remediationSignalsCsv:string }>}
 */
export async function loadConeRemediationForSheetVsCluster(sheetBoxIdNormalized, yarnBoxClusterLean) {
  const sid = sheetBoxIdNormalized != null ? String(sheetBoxIdNormalized).trim() : '';
  const clusterIds =
    yarnBoxClusterLean?.map((b) => String(b.boxId || '').trim()).filter(Boolean) ?? [];
  const uniq = [...new Set([...(sid ? [sid] : []), ...clusterIds])];

  if (!uniq.length) {
    const emptyAgg = () => agg([]);
    const e = emptyAgg();
    return {
      sheetBoxAgg: {
        conesTotalForSheetBoxId: e.total,
        conesActiveShortTermForSheetBoxId: e.activeShortTerm,
        conesStatusCsvForSheetBoxId: e.statusCsv,
        conesBarcodeSampleCsvForSheetBoxId: '',
      },
      clusterAgg: {
        conesTotalForClusterBoxIds: e.total,
        conesActiveShortTermForClusterBoxIds: e.activeShortTerm,
        conesStatusCsvForClusterCombined: e.statusCsv,
        conesBarcodeSampleCsvForClusterCombined: '',
      },
      allBoxIdsTouchedCsv: '',
      remediationSignalsCsv: 'NO_BOX_IDS_REQUESTED_FOR_CONE_SCAN',
    };
  }

  const cones = await YarnCone.find({
    boxId: { $in: uniq },
    returnedToVendorAt: null,
  })
    .select('boxId barcode issueStatus coneStorageId coneWeight')
    .limit(MAX_DOCS_PER_QUERY)
    .lean();

  const sheetSubset = sid ? cones.filter((c) => String(c.boxId) === sid) : [];
  const clusterIdSet = new Set(clusterIds);
  const clusterSubset = cones.filter((c) => clusterIdSet.has(String(c.boxId)));

  const sheetA = agg(sheetSubset);
  const clusterA = agg(clusterSubset);

  /** @type {string[]} */
  const sig = [];

  if (!sid) {
    sig.push('NO_SHEET_BOX_ID_CANNOT_SCORE_OLD_CONE_DRIFT');
  } else if (sheetA.total === 0) {
    sig.push('NO_CONES_REFERENCE_SHEET_BOX_ID');
  } else if (sheetA.activeShortTerm > 0) {
    sig.push('BLOCKER_OLD_SHEET_BOX_ID_HAS_SHORT_TERM_CONES_FIX_BEFORE_PHYSICAL_REMOVAL');
  } else {
    sig.push('SHEET_BOX_HAS_CONES_BUT_ZERO_ACTIVE_ST_ISSUED_OR_CLOSED_CONES_NEED_AUDIT');
  }

  if (clusterIds.length && clusterA.activeShortTerm > 0) {
    sig.push('REPLACEMENT_CLUSTER_CARRIES_ACTIVE_SHORT_TERM_WEIGHT');
  }
  if (!clusterIds.length && sid && sheetA.total === 0) {
    sig.push('NO_CLUSTER_ALTERNATIVE_FOUND_FOR_THIS_PO_VENDOR_LOT');
  }

  return {
    sheetBoxAgg: {
      conesTotalForSheetBoxId: sheetA.total,
      conesActiveShortTermForSheetBoxId: sheetA.activeShortTerm,
      conesStatusCsvForSheetBoxId: sheetA.statusCsv,
      conesBarcodeSampleCsvForSheetBoxId: sheetA.sampleBarcodeCsv,
    },
    clusterAgg: {
      conesTotalForClusterBoxIds: clusterA.total,
      conesActiveShortTermForClusterBoxIds: clusterA.activeShortTerm,
      conesStatusCsvForClusterCombined: clusterA.statusCsv,
      conesBarcodeSampleCsvForClusterCombined: clusterA.sampleBarcodeCsv,
    },
    allBoxIdsTouchedCsv: uniq.join('|'),
    remediationSignalsCsv: [...new Set(sig.filter(Boolean))].join(';'),
  };
}
