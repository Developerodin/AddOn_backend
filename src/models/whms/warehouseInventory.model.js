import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

/**
 * WHMS warehouse inventory: one document per style code (globally unique styleCode + styleCodeId).
 * - Refs: join to live Product / StyleCode when they still exist.
 * - itemData + styleCode + styleCodeData: denormalized copies if masters are removed later.
 */

/**
 * Single audit line for an inventory row (product + style code).
 * Append-only history. If you set totalQuantityAfter + blockedQuantityAfter + availableQuantityAfter,
 * keep: availableQuantityAfter === max(0, totalQuantityAfter - blockedQuantityAfter) (app/service layer).
 */
const warehouseInventoryLogSchema = mongoose.Schema(
  {
    action: {
      type: String,
      trim: true,
      default: '',
    },
    message: {
      type: String,
      trim: true,
      default: '',
    },
    quantityDelta: {
      type: Number,
    },
    blockedDelta: {
      type: Number,
    },
    totalQuantityAfter: { type: Number, min: 0 },
    blockedQuantityAfter: { type: Number, min: 0 },
    availableQuantityAfter: { type: Number, min: 0 },
    userId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      default: null,
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  { _id: true, timestamps: { createdAt: true, updatedAt: false } }
);

const warehouseInventorySchema = mongoose.Schema(
  {
    itemId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Product',
      required: true,
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
    /** Audit trail; always an array — see pre-validate hook if missing from raw updates. */
    logs: {
      type: [warehouseInventoryLogSchema],
      default() {
        return [];
      },
    },
  },
  { timestamps: true }
);

warehouseInventorySchema.index({ itemId: 1, styleCodeId: 1 });

/** Ensure `logs` exists so push/markModified never runs on undefined (creates / lean / legacy docs). */
warehouseInventorySchema.pre('validate', function ensureLogsArray(next) {
  if (!Array.isArray(this.logs)) {
    this.logs = [];
  }
  next();
});

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
