import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

/**
 * Append-only audit rows for {@link WarehouseInventory} — kept in a separate collection
 * so the main inventory document does not grow without bound.
 */
const warehouseInventoryLogSchema = mongoose.Schema(
  {
    warehouseInventoryId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'WarehouseInventory',
      required: true,
      index: true,
    },
    /** Denormalized from parent row for filtered reporting without joining stocks. */
    styleCodeId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StyleCode',
      default: null,
      index: true,
    },
    styleCode: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
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
    quantityDelta: { type: Number },
    blockedDelta: { type: Number },
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
  { timestamps: { createdAt: true, updatedAt: false } }
);

warehouseInventoryLogSchema.index({ warehouseInventoryId: 1, createdAt: -1 });

warehouseInventoryLogSchema.plugin(toJSON);
warehouseInventoryLogSchema.plugin(paginate);

const WarehouseInventoryLog = mongoose.model(
  'WarehouseInventoryLog',
  warehouseInventoryLogSchema,
  'warehouse_inventory_logs'
);

export default WarehouseInventoryLog;
