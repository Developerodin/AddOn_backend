/**
 * Backfill InwardReceive rows with the latest styleCode for their brand.
 *
 * Production floors store brand-only transfers (styleCode=""). When those reach
 * warehouse inward, the system resolved styleCode from the product catalog — but
 * previously it picked the first/oldest match instead of the newest. This script
 * updates all inward rows (and their linked WarehouseInventory) to the latest
 * styleCode per brand from the product catalog.
 *
 * Usage:
 *   node src/scripts/backfill-inward-receive-latest-stylecode.js                # dry-run
 *   node src/scripts/backfill-inward-receive-latest-stylecode.js --execute      # apply changes
 */
import mongoose from 'mongoose';
import config from '../config/config.js';
import Product from '../models/product.model.js';
import StyleCode from '../models/styleCode.model.js';
import InwardReceive from '../models/whms/inwardReceive.model.js';
import WarehouseInventory from '../models/whms/warehouseInventory.model.js';
import { latestStyleCodeForBrand } from '../utils/brandQuantity.util.js';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function parseArgs(argv) {
  return {
    execute: argv.includes('--execute'),
  };
}

async function main() {
  const { execute } = parseArgs(process.argv.slice(2));
  await mongoose.connect(config.mongoose.url, config.mongoose.options);

  console.log(`\n=== Backfill InwardReceive latest styleCode ===`);
  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY-RUN'}\n`);

  const rows = await InwardReceive.find({
    brand: { $exists: true, $ne: '' },
    articleNumber: { $exists: true, $ne: '' },
  }).lean();

  console.log(`Found ${rows.length} inward receive rows with brand + articleNumber\n`);

  const productCache = new Map();

  async function getProductWithStyleCodes(factoryCode) {
    const key = factoryCode.toLowerCase();
    if (productCache.has(key)) return productCache.get(key);
    const product = await Product.findOne({
      factoryCode: new RegExp(`^${escapeRegex(factoryCode)}$`, 'i'),
    })
      .populate('styleCodes', 'styleCode brand createdAt')
      .lean();
    productCache.set(key, product);
    return product;
  }

  const styleCodeDocCache = new Map();

  async function getStyleCodeDoc(styleCodeStr) {
    const key = styleCodeStr.toLowerCase();
    if (styleCodeDocCache.has(key)) return styleCodeDocCache.get(key);
    const doc = await StyleCode.findOne({
      styleCode: new RegExp(`^${escapeRegex(styleCodeStr)}$`, 'i'),
    }).lean();
    styleCodeDocCache.set(key, doc);
    return doc;
  }

  let updated = 0;
  let skipped = 0;
  let noProduct = 0;
  let noLatest = 0;
  let sameCode = 0;
  let inventoryUpdated = 0;
  let inventoryNotFound = 0;
  let styleCodeDocNotFound = 0;
  const errors = [];

  for (const row of rows) {
    const articleNumber = String(row.articleNumber).trim();
    const brand = String(row.brand).trim();
    const currentStyle = String(row.styleCode ?? '').trim();

    if (!brand) {
      skipped++;
      continue;
    }

    const product = await getProductWithStyleCodes(articleNumber);
    if (!product) {
      noProduct++;
      continue;
    }

    const latestStyle = latestStyleCodeForBrand(brand, product.styleCodes);
    if (!latestStyle) {
      noLatest++;
      continue;
    }

    if (currentStyle.toLowerCase() === latestStyle.toLowerCase()) {
      sameCode++;
      continue;
    }

    console.log(
      `[${execute ? 'UPDATE' : 'WOULD UPDATE'}] InwardReceive ${row._id} ` +
      `article=${articleNumber} brand="${brand}" ` +
      `styleCode: "${currentStyle}" → "${latestStyle}"`
    );

    if (execute) {
      try {
        await InwardReceive.updateOne(
          { _id: row._id },
          { $set: { styleCode: latestStyle } }
        );

        if (row.status === 'accepted' && currentStyle) {
          const newStyleDoc = await getStyleCodeDoc(latestStyle);
          if (!newStyleDoc?._id) {
            styleCodeDocNotFound++;
            console.log(`  ⚠ StyleCode doc not found for "${latestStyle}" — inventory not updated`);
          } else {
            const oldStyleDoc = await getStyleCodeDoc(currentStyle);
            if (oldStyleDoc?._id) {
              const inv = await WarehouseInventory.findOne({
                itemId: product._id,
                styleCodeId: oldStyleDoc._id,
              });
              if (inv) {
                const creditedQty = Math.max(0, Number(row.receivedQuantity) || 0);
                if (String(oldStyleDoc._id) === String(newStyleDoc._id)) {
                  console.log(`  ℹ Same StyleCode doc, no inventory move needed`);
                } else {
                  inv.currentStock = Math.max(0, (inv.currentStock || 0) - creditedQty);
                  inv.totalInward = Math.max(0, (inv.totalInward || 0) - creditedQty);
                  await inv.save();

                  let newInv = await WarehouseInventory.findOne({
                    itemId: product._id,
                    styleCodeId: newStyleDoc._id,
                  });
                  if (!newInv) {
                    newInv = new WarehouseInventory({
                      itemId: product._id,
                      styleCodeId: newStyleDoc._id,
                      styleCode: newStyleDoc.styleCode,
                      itemData: {
                        factoryCode: product.factoryCode,
                        name: product.name,
                        productId: String(product._id),
                      },
                      styleCodeData: {
                        styleCode: newStyleDoc.styleCode,
                        eanCode: newStyleDoc.eanCode,
                        mrp: newStyleDoc.mrp,
                        brand: newStyleDoc.brand,
                        pack: newStyleDoc.pack,
                      },
                      currentStock: 0,
                      totalInward: 0,
                      totalOutward: 0,
                    });
                  }
                  newInv.currentStock = (newInv.currentStock || 0) + creditedQty;
                  newInv.totalInward = (newInv.totalInward || 0) + creditedQty;
                  newInv.styleCode = newStyleDoc.styleCode;
                  newInv.styleCodeData = {
                    styleCode: newStyleDoc.styleCode,
                    eanCode: newStyleDoc.eanCode,
                    mrp: newStyleDoc.mrp,
                    brand: newStyleDoc.brand,
                    pack: newStyleDoc.pack,
                  };
                  await newInv.save();
                  inventoryUpdated++;
                  console.log(`  ✓ Inventory moved ${creditedQty} from "${currentStyle}" → "${latestStyle}"`);
                }
              } else {
                inventoryNotFound++;
              }
            }
          }
        }

        updated++;
      } catch (err) {
        errors.push({ id: row._id, error: err.message });
        console.error(`  ✗ Error: ${err.message}`);
      }
    } else {
      updated++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total rows scanned:        ${rows.length}`);
  console.log(`Already correct:           ${sameCode}`);
  console.log(`${execute ? 'Updated' : 'Would update'}:          ${updated}`);
  console.log(`Skipped (no brand):        ${skipped}`);
  console.log(`No product found:          ${noProduct}`);
  console.log(`No latest styleCode found: ${noLatest}`);
  if (execute) {
    console.log(`Inventory moved:           ${inventoryUpdated}`);
    console.log(`Inventory not found:       ${inventoryNotFound}`);
    console.log(`StyleCode doc not found:   ${styleCodeDocNotFound}`);
  }
  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    errors.forEach((e) => console.log(`  ${e.id}: ${e.error}`));
  }

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
