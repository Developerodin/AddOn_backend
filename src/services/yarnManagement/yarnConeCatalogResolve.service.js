import mongoose from 'mongoose';
import YarnCatalog from '../../models/yarnManagement/yarnCatalog.model.js';
import YarnBox from '../../models/yarnReq/yarnBox.model.js';
import YarnTransaction from '../../models/yarnReq/yarnTransaction.model.js';
import YarnPurchaseOrder from '../../models/yarnReq/yarnPurchaseOrder.model.js';

/**
 * Escapes a string for use in a RegExp.
 * @param {string} s
 * @returns {string}
 */
export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds an active YarnCatalog _id by exact then case-insensitive yarnName.
 * @param {string} yarnName
 * @returns {Promise<mongoose.Types.ObjectId|null>}
 */
export async function findYarnCatalogIdByYarnName(yarnName) {
  const trimmed = String(yarnName || '').trim();
  if (!trimmed) return null;

  let cat = await YarnCatalog.findOne({
    yarnName: trimmed,
    status: { $ne: 'deleted' },
  })
    .select('_id')
    .lean();

  if (!cat) {
    cat = await YarnCatalog.findOne({
      yarnName: { $regex: new RegExp(`^${escapeRegex(trimmed)}$`, 'i') },
      status: { $ne: 'deleted' },
    })
      .select('_id')
      .lean();
  }

  return cat?._id ?? null;
}

/**
 * Resolves yarnCatalogId from PO line when poNumber + yarnName (+ optional shade) match.
 * @param {{ poNumber?: string, yarnName?: string, shadeCode?: string }} params
 * @returns {Promise<mongoose.Types.ObjectId|null>}
 */
export async function findYarnCatalogIdFromPurchaseOrderItem({ poNumber, yarnName, shadeCode }) {
  const poNum = String(poNumber || '').trim();
  const yname = String(yarnName || '').trim();
  if (!poNum || !yname) return null;

  const po = await YarnPurchaseOrder.findOne({ poNumber }).select('poItems').lean();
  if (!po?.poItems?.length) return null;

  const sameName = po.poItems.filter((p) => String(p.yarnName || '').trim() === yname);
  if (sameName.length === 0) return null;

  const shade = String(shadeCode || '').trim();
  let item = null;
  if (sameName.length === 1) {
    item = sameName[0];
  } else if (shade) {
    item = sameName.find((p) => String(p.shadeCode || '').trim() === shade) || null;
  }
  const rawId = item?.yarnCatalogId;
  if (!rawId || !mongoose.Types.ObjectId.isValid(String(rawId))) return null;
  return new mongoose.Types.ObjectId(String(rawId));
}

/**
 * Latest yarn transaction for this cone that carries a yarnCatalogId.
 * @param {mongoose.Types.ObjectId|string} coneId
 * @returns {Promise<mongoose.Types.ObjectId|null>}
 */
export async function findYarnCatalogIdFromLatestConeTransaction(coneId) {
  if (coneId == null || !mongoose.Types.ObjectId.isValid(String(coneId))) return null;
  const oid = coneId instanceof mongoose.Types.ObjectId ? coneId : new mongoose.Types.ObjectId(String(coneId));

  const txn = await YarnTransaction.findOne({
    conesIdsArray: oid,
    yarnCatalogId: { $exists: true, $ne: null },
  })
    .sort({ transactionDate: -1, createdAt: -1 })
    .select('yarnCatalogId')
    .lean();

  const raw = txn?.yarnCatalogId;
  if (!raw || !mongoose.Types.ObjectId.isValid(String(raw))) return null;
  return new mongoose.Types.ObjectId(String(raw));
}

/**
 * Resolves yarnCatalogId for a cone-shaped document (lean or mongoose doc).
 * Order: existing id → parent box → yarnName → PO line → latest issue txn.
 * @param {object} cone
 * @returns {Promise<{ catalogId: mongoose.Types.ObjectId|null, source: string }>}
 */
export async function resolveYarnCatalogIdForCone(cone) {
  const existing = cone?.yarnCatalogId;
  if (existing && mongoose.Types.ObjectId.isValid(String(existing))) {
    return { catalogId: new mongoose.Types.ObjectId(String(existing)), source: 'cone' };
  }

  const boxId = String(cone?.boxId || '').trim();
  let box = null;
  if (boxId) {
    box = await YarnBox.findOne({ boxId }).select('yarnCatalogId yarnName shadeCode poNumber').lean();
    if (box?.yarnCatalogId && mongoose.Types.ObjectId.isValid(String(box.yarnCatalogId))) {
      return {
        catalogId: new mongoose.Types.ObjectId(String(box.yarnCatalogId)),
        source: 'box',
      };
    }
  }

  const yarnName = cone?.yarnName ?? box?.yarnName;
  const byName = await findYarnCatalogIdByYarnName(yarnName);
  if (byName) return { catalogId: byName, source: 'yarnName' };

  const fromPo = await findYarnCatalogIdFromPurchaseOrderItem({
    poNumber: cone?.poNumber ?? box?.poNumber,
    yarnName: cone?.yarnName ?? box?.yarnName,
    shadeCode: cone?.shadeCode ?? box?.shadeCode,
  });
  if (fromPo) return { catalogId: fromPo, source: 'poItem' };

  const fromTxn = await findYarnCatalogIdFromLatestConeTransaction(cone?._id);
  if (fromTxn) return { catalogId: fromTxn, source: 'transaction' };

  return { catalogId: null, source: 'none' };
}
