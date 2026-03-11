#!/usr/bin/env node
/**
 * Recreate PO receivedLotDetails and packListDetails from existing boxes and cones.
 * Boxes and cones are NOT modified - only the YarnPurchaseOrder document is updated/created.
 *
 * Use when: PO was cleared/deleted but boxes and cones still exist in storage.
 *
 * Run:
 *   node src/scripts/recreate-po-from-boxes.js --po-number=PO-2026-869
 *   node src/scripts/recreate-po-from-boxes.js --po-number=PO-2026-869 --dry-run
 *   node src/scripts/recreate-po-from-boxes.js --po-number=PO-2026-869 --supplier-id=xxx  (when creating new PO)
 *   node src/scripts/recreate-po-from-boxes.js --po-number=PO-2026-869 --force-recreate  (delete existing PO, create fresh from boxes)
 */

import mongoose from 'mongoose';
import { YarnBox, YarnCone, YarnPurchaseOrder, YarnCatalog, Supplier } from '../models/index.js';
import config from '../config/config.js';
import logger from '../config/logger.js';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const forceRecreate = args.includes('--force-recreate');
const poNumberArg = args.find((a) => a.startsWith('--po-number='));
const supplierIdArg = args.find((a) => a.startsWith('--supplier-id='));
const PO_NUMBER = poNumberArg ? poNumberArg.split('=')[1]?.trim() : null;
const SUPPLIER_ID = supplierIdArg ? supplierIdArg.split('=')[1]?.trim() : null;

const toNum = (v) => Math.max(0, Number(v ?? 0));

async function findYarnCatalogByYarnName(yarnName) {
  if (!yarnName) return null;
  if (!yarnName.trim()) return null;
  let catalog = await YarnCatalog.findOne({ yarnName: yarnName.trim(), status: { $ne: 'deleted' } }).lean();
  if (catalog) return catalog;
  const escaped = yarnName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  catalog = await YarnCatalog.findOne({
    yarnName: { $regex: new RegExp(`^${escaped}$`, 'i') },
    status: { $ne: 'deleted' },
  }).lean();
  return catalog;
}

/** Extract sizeCount from yarnName (e.g. "20s-Black-..." -> "20s") */
function extractSizeCount(yarnName) {
  if (!yarnName) return 'N/A';
  const m = String(yarnName).match(/^([\d./]+[sS]?)/);
  return m ? m[1] : 'N/A';
}

async function run() {
  if (!PO_NUMBER) {
    logger.error('Usage: node src/scripts/recreate-po-from-boxes.js --po-number=PO-2026-869 [--supplier-id=xxx] [--dry-run]');
    process.exit(1);
  }

  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);

    if (isDryRun) logger.info('DRY RUN – no writes will be performed');

    const boxes = await YarnBox.find({ poNumber: PO_NUMBER }).lean();
    const cones = await YarnCone.find({ poNumber: PO_NUMBER }).lean();

    if (boxes.length === 0) {
      logger.error(`No boxes found for PO ${PO_NUMBER}. Nothing to recreate.`);
      process.exit(1);
    }

    logger.info(`Found ${boxes.length} boxes, ${cones.length} cones for PO ${PO_NUMBER}`);

    // Aggregate by lot
    const lotMap = new Map();
    for (const b of boxes) {
      const lot = lotMap.get(b.lotNumber) || {
        yarnName: b.yarnName || '',
        shadeCode: b.shadeCode || '',
        boxes: [],
        cones: [],
      };
      lot.boxes.push(b);
      lotMap.set(b.lotNumber, lot);
    }
    for (const c of cones) {
      const box = boxes.find((x) => x.boxId === c.boxId);
      const lotNum = box?.lotNumber || '';
      if (lotNum) {
        const lot = lotMap.get(lotNum);
        if (lot) lot.cones.push(c);
      }
    }

    // Build unique poItems from (yarnName, shadeCode) and resolve YarnCatalog
    const poItemKey = (yarnName, shadeCode) => `${(yarnName || '').trim()}|||${(shadeCode || '').trim()}`;
    const poItemMap = new Map();
    for (const [, lot] of lotMap) {
      const key = poItemKey(lot.yarnName, lot.shadeCode);
      if (poItemMap.has(key)) continue;
      const catalog = await findYarnCatalogByYarnName(lot.yarnName);
      if (!catalog) {
        logger.warn(`No YarnCatalog found for yarnName="${lot.yarnName}" – skipping. Add catalog to avoid issues.`);
      }
      poItemMap.set(key, {
        yarnName: lot.yarnName,
        shadeCode: lot.shadeCode,
        yarnId: catalog?._id?.toString() || '',
        sizeCount: extractSizeCount(lot.yarnName),
      });
    }

    // Build receivedLotDetails
    const receivedLotDetails = [];
    for (const [lotNumber, lot] of lotMap) {
      const totalWeight = lot.boxes.reduce((s, b) => s + toNum(b.boxWeight), 0);
      const totalCones = lot.boxes.reduce((s, b) => s + toNum(b.numberOfCones), 0);
      const key = poItemKey(lot.yarnName, lot.shadeCode);
      const item = poItemMap.get(key);
      if (!item || !item.yarnId) {
        logger.warn(`Skipping lot ${lotNumber}: no YarnCatalog for ${lot.yarnName}`);
        continue;
      }
      receivedLotDetails.push({
        lotNumber,
        numberOfCones: totalCones,
        totalWeight,
        numberOfBoxes: lot.boxes.length,
        poItems: [{ poItem: item.yarnId, receivedQuantity: Math.round(totalWeight * 100) / 100 }],
        status: 'lot_accepted',
      });
    }

    // Build packListDetails (one per lot with minimal info)
    const packListDetails = receivedLotDetails.map((lot) => ({
      poItems: [],
      packingNumber: `RECREATED-${lot.lotNumber}`,
      courierName: '',
      courierNumber: '',
      vehicleNumber: '',
      challanNumber: '',
      dispatchDate: undefined,
      estimatedDeliveryDate: undefined,
      notes: '',
      numberOfCones: lot.numberOfCones,
      totalWeight: lot.totalWeight,
      numberOfBoxes: lot.numberOfBoxes,
      files: [],
    }));

    // Build poItems for PO (with _id for receivedLotDetails references)
    const poItems = [];
    const keyToPoItemId = new Map();
    for (const [key, item] of poItemMap) {
      if (!item.yarnId) continue;
      const poItemId = new mongoose.Types.ObjectId();
      poItems.push({
        _id: poItemId,
        yarnName: item.yarnName,
        yarn: new mongoose.Types.ObjectId(item.yarnId),
        sizeCount: item.sizeCount,
        shadeCode: item.shadeCode,
        pantoneName: '',
        rate: 0,
        quantity: 0,
      });
      keyToPoItemId.set(key, poItemId);
    }

    // Fix receivedLotDetails to use poItem _ids (not yarn catalog ids)
    for (const lot of receivedLotDetails) {
      const lotData = lotMap.get(lot.lotNumber);
      if (lotData) {
        const key = poItemKey(lotData.yarnName, lotData.shadeCode);
        const poItemId = keyToPoItemId.get(key);
        if (poItemId) lot.poItems[0].poItem = poItemId;
      }
    }

    // Calculate subTotal, gst, total (use 0 for recreated)
    const subTotal = 0;
    const gst = 0;
    const total = 0;

    const existingPo = await YarnPurchaseOrder.findOne({ poNumber: PO_NUMBER }).lean();

    // Force recreate: delete existing PO and create fresh (boxes/cones unchanged)
    let supplierIdFromDeletedPo = null;
    if (existingPo && forceRecreate) {
      logger.info(`--force-recreate: Deleting existing PO ${PO_NUMBER} and creating fresh from boxes.`);
      supplierIdFromDeletedPo = existingPo.supplier?.toString?.();
      if (!isDryRun) {
        await YarnPurchaseOrder.deleteOne({ poNumber: PO_NUMBER });
      }
      // Fall through to create path
    }

    if (existingPo && !forceRecreate) {
      logger.info(`PO ${PO_NUMBER} exists. Updating receivedLotDetails and packListDetails.`);
      if (existingPo.poItems?.length) {
        // Match receivedLotDetails to existing poItem _ids by (yarnName, shadeCode)
        const existingKeyToId = new Map();
        for (const pi of existingPo.poItems) {
          const name = (pi.yarnName || pi.yarn?.yarnName || '').trim();
          const shade = (pi.shadeCode || '').trim();
          existingKeyToId.set(poItemKey(name, shade), pi._id);
        }
        for (const lot of receivedLotDetails) {
          const lotData = lotMap.get(lot.lotNumber);
          if (lotData) {
            const key = poItemKey(lotData.yarnName, lotData.shadeCode);
            const existingId = existingKeyToId.get(key);
            if (existingId) lot.poItems[0].poItem = existingId;
          }
        }
      }
      if (!isDryRun) {
        const updatePayload = {
          receivedLotDetails,
          packListDetails,
        };
        if (!existingPo.poItems?.length) {
          updatePayload.poItems = poItems;
          updatePayload.subTotal = subTotal;
          updatePayload.gst = gst;
          updatePayload.total = total;
        }
        await YarnPurchaseOrder.updateOne({ poNumber: PO_NUMBER }, { $set: updatePayload });
      }
      logger.info(`Updated: ${receivedLotDetails.length} lots, ${packListDetails.length} packlists`);
    } else {
      // PO doesn't exist, or we just deleted it (--force-recreate)
      let supplierId = SUPPLIER_ID || supplierIdFromDeletedPo;
      if (!supplierId) {
        const firstSupplier = await Supplier.findOne().lean();
        if (!firstSupplier) {
          logger.error('No PO found and no Supplier in DB. Pass --supplier-id=xxx to create new PO.');
          process.exit(1);
        }
        supplierId = firstSupplier._id.toString();
        logger.info(`Using first supplier: ${firstSupplier.brandName || supplierId}`);
      } else if (supplierIdFromDeletedPo) {
        logger.info(`Using supplier from deleted PO: ${supplierId}`);
      }
      const supplier = await Supplier.findById(supplierId).lean();
      if (!supplier) {
        logger.error(`Supplier ${supplierId} not found`);
        process.exit(1);
      }
      logger.info(`Creating new PO ${PO_NUMBER} with supplier ${supplier.brandName || supplierId}`);
      if (!isDryRun) {
        await YarnPurchaseOrder.create({
          poNumber: PO_NUMBER,
          supplierName: supplier.brandName || 'Unknown',
          supplier: new mongoose.Types.ObjectId(supplierId),
          poItems,
          subTotal,
          gst,
          total,
          currentStatus: 'goods_received',
          receivedLotDetails,
          packListDetails,
        });
      }
      logger.info(`Created PO with ${receivedLotDetails.length} lots, ${packListDetails.length} packlists`);
    }

    logger.info('Done.');
  } catch (error) {
    logger.error('Script failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run();
