import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

/**
 * WHMS warehouse inventory: one document per style code (globally unique styleCode + styleCodeId).
 * Audit history lives in {@link WarehouseInventoryLog} (collection `warehouse_inventory_logs`).
 */

const warehouseInventorySchema = mongoose.Schema(
  {
    /** Optional when stock is keyed by style only (no unique product on Product.styleCodes). */
    itemId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Product',
      required: false,
      default: null,
      index: true,
    },
    styleCodeId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StyleCode',
      required: true,
      unique: true,
    },
    itemData: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
    styleCode: {
      type: String,
      trim: true,
      required: true,
      minlength: 1,
      unique: true,
    },
    styleCodeData: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
    totalQuantity: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    blockedQuantity: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    availableQuantity: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

warehouseInventorySchema.index({ itemId: 1, styleCodeId: 1 });

warehouseInventorySchema.pre('validate', function warehouseInventoryValidate(next) {
  const total = this.totalQuantity ?? 0;
  const blocked = this.blockedQuantity ?? 0;
  if (blocked > total) {
    this.invalidate('blockedQuantity', 'cannot exceed totalQuantity');
  }
  next();
});

warehouseInventorySchema.pre('save', function syncAvailable(next) {
  const total = this.totalQuantity ?? 0;
  const blocked = this.blockedQuantity ?? 0;
  this.availableQuantity = Math.max(0, total - blocked);
  next();
});

warehouseInventorySchema.plugin(toJSON);
warehouseInventorySchema.plugin(paginate);

/** Model name: WarehouseInventory. Collection: `stocks` (unchanged from legacy Stock model). */
const WarehouseInventory = mongoose.model('WarehouseInventory', warehouseInventorySchema, 'stocks');
export default WarehouseInventory;
