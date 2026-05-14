/**
 * PO / vendor-lot YarnBox clustering for excel mismatch tooling.
 */
import { YarnBox } from '../models/index.js';
import { LT_SECTION_CODES } from '../models/storageManagement/storageSlot.model.js';

/** @type {RegExp} */
const LT_STORAGE_PATTERN = new RegExp(`^(LT-|${LT_SECTION_CODES.map((s) => `${s}-`).join('|')})`, 'i');

/**
 * Describes LT slot / remaining box weight flags for warehouse screens.
 * @param {Record<string, unknown>} b
 * @returns {string}
 */
function yarnBoxLongTermStorageHint(b) {
  const loc = b.storageLocation != null ? String(b.storageLocation).trim() : '';
  const stored = b.storedStatus === true;
  const kg = Number(b.boxWeight ?? 0);
  const conesFullyOut = b.coneData?.conesIssued === true;
  const lt = Boolean(loc && LT_STORAGE_PATTERN.test(loc));
  const parts = [];
  if (lt) parts.push(`LT@${loc}`);
  else if (loc) parts.push(`slot@${loc}`);
  else parts.push('no_slot');
  parts.push(`stored=${stored}`);
  parts.push(`${Math.round(kg * 1000) / 1000}kg`);
  if (conesFullyOut) parts.push('conesTransferredToST_UI');
  return parts.join('|');
}


/**
 * @param {string} poFragment
 * @returns {string}
 */
function normalizePoToken(poFragment) {
  const m = String(poFragment || '').trim().match(/^(?:PO[-\s]?)(\d{4})[-\s]?(\d+)/i);
  if (!m) return String(poFragment || '').trim();
  return `PO-${m[1]}-${m[2]}`;
}

/**
 * @param {string} boxId
 * @returns {string|null}
 */
function extractPoNumberFromBoxId(boxId) {
  const s = String(boxId || '').trim();
  const m = s.match(/^BOX-(PO-\d{4}-\d+)/i);
  return m ? normalizePoToken(m[1]) : null;
}

/**
 * @param {string} s
 * @returns {string}
 */
export function regexEscape(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} boxIdRaw
 * @returns {{ poNumber: string|null, vendorLotToken: string|null }}
 */
export function extractPoLotFromStructuredBoxId(boxIdRaw) {
  const s = String(boxIdRaw || '').replace(/--+/g, '-').trim();
  const m = s.match(/^BOX-(PO-\d{4}-\d+)-([A-Za-z0-9]+)-\d+-\d+$/i);
  if (!m) {
    return { poNumber: extractPoNumberFromBoxId(s), vendorLotToken: null };
  }
  return { poNumber: normalizePoToken(m[1]), vendorLotToken: m[2] };
}

/**
 * @param {string|null} poNumber
 * @param {string|null} vendorLotToken
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function findYarnBoxesByPoVendorLot(poNumber, vendorLotToken) {
  if (!poNumber) return [];
  const base = { poNumber, returnedToVendorAt: null };
  if (vendorLotToken) {
    const esc = regexEscape(vendorLotToken);
    return YarnBox.find({
      ...base,
      $or: [{ lotNumber: new RegExp(`^${esc}$`, 'i') }, { boxId: new RegExp(`-${esc}-`, 'i') }],
    })
      .select(
        'boxId barcode yarnName yarnCatalogId shadeCode lotNumber boxWeight storedStatus storageLocation coneData updatedAt'
      )
      .sort({ updatedAt: -1 })
      .limit(120)
      .lean();
  }
  return YarnBox.find(base)
    .select(
      'boxId barcode yarnName yarnCatalogId shadeCode lotNumber boxWeight storedStatus storageLocation coneData updatedAt'
    )
    .sort({ updatedAt: -1 })
    .limit(80)
    .lean();
}

/**
 * @param {Record<string, unknown>[]} boxes
 * @returns {{ distinctYarnKinds: number, homogeneousYarn: boolean, yarnBreakdownCsv: string, clusterPreviewCsv: string, clusterStoragePreviewCsv: string }}
 */
export function summarizeYarnAcrossBoxes(boxes) {
  if (!boxes.length) {
    return {
      distinctYarnKinds: 0,
      homogeneousYarn: true,
      yarnBreakdownCsv: '',
      clusterPreviewCsv: '',
      clusterStoragePreviewCsv: '',
    };
  }
  /** @type {Map<string, { label: string, count: number }>} */
  const byKey = new Map();
  for (const b of boxes) {
    const cat = b.yarnCatalogId != null ? String(b.yarnCatalogId) : '';
    const yn = String(b.yarnName || '').trim().toLowerCase();
    const key = cat || `name:${yn || 'unknown'}`;
    const label = cat ? `catalog:${cat}` : `yarn:${String(b.yarnName || '').slice(0, 40)}`;
    const cur = byKey.get(key);
    if (cur) cur.count += 1;
    else byKey.set(key, { label, count: 1 });
  }
  const distinctYarnKinds = byKey.size;
  const yarnBreakdownCsv = [...byKey.values()]
    .map((v) => `${v.label.replace(/\|+/g, ' ')} ×${v.count}`)
    .join(' | ');
  const clusterPreviewCsv = boxes
    .slice(0, 15)
    .map(
      (b) =>
        `${String(b._id)}→${String(b.boxId)}→lot:${String(b.lotNumber || '')}→${String(b.yarnName || '').slice(0, 28)}`
    )
    .join(' || ');
  const clusterStoragePreviewCsv = boxes
    .slice(0, 15)
    .map((b) => `${String(b._id)}→${yarnBoxLongTermStorageHint(b)}`)
    .join(' || ');
  return {
    distinctYarnKinds,
    homogeneousYarn: distinctYarnKinds <= 1,
    yarnBreakdownCsv,
    clusterPreviewCsv,
    clusterStoragePreviewCsv,
  };
}

/**
 * @param {string} excelBarcode
 * @param {Record<string, unknown>[]} cluster
 * @returns {boolean}
 */
export function excelBarcodeInCluster(excelBarcode, cluster) {
  const bc = String(excelBarcode || '').trim();
  if (!bc) return false;
  return cluster.some((b) => String(b._id) === bc || String(b.barcode || '') === bc);
}
