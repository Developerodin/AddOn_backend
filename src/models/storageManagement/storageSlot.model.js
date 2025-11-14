import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';

export const STORAGE_ZONES = {
  LONG_TERM: 'LT',
  SHORT_TERM: 'ST',
};

const MAX_SHELVES_PER_ZONE = 150;
const FLOORS_PER_SHELF = 4;

const storageSlotSchema = mongoose.Schema(
  {
    zoneCode: {
      type: String,
      enum: Object.values(STORAGE_ZONES),
      required: true,
    },
    shelfNumber: {
      type: Number,
      min: 1,
      max: MAX_SHELVES_PER_ZONE,
      required: true,
    },
    floorNumber: {
      type: Number,
      min: 1,
      max: FLOORS_PER_SHELF,
      required: true,
    },
    label: {
      type: String,
      unique: true,
      required: true,
    },
    barcode: {
      type: String,
      unique: true,
      required: true,
    },
    capacityNotes: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

storageSlotSchema.plugin(toJSON);
storageSlotSchema.plugin(paginate);

storageSlotSchema.index({ zoneCode: 1, shelfNumber: 1, floorNumber: 1 }, { unique: true });

storageSlotSchema.pre('validate', function (next) {
  const shelf = String(this.shelfNumber).padStart(3, '0');
  const label = `${this.zoneCode}-S${shelf}-F${this.floorNumber}`;

  if (!this.label) {
    this.label = label;
  }

  if (!this.barcode) {
    this.barcode = label;
  }

  next();
});

storageSlotSchema.statics.seedDefaultSlots = async function () {
  const bulkOps = [];

  const zones = Object.values(STORAGE_ZONES);
  zones.forEach((zoneCode) => {
    for (let shelf = 1; shelf <= MAX_SHELVES_PER_ZONE; shelf += 1) {
      for (let floor = 1; floor <= FLOORS_PER_SHELF; floor += 1) {
        const shelfStr = String(shelf).padStart(3, '0');
        const label = `${zoneCode}-S${shelfStr}-F${floor}`;

        bulkOps.push({
          updateOne: {
            filter: { label },
            update: {
              $setOnInsert: {
                zoneCode,
                shelfNumber: shelf,
                floorNumber: floor,
                label,
                barcode: label,
                isActive: true,
              },
            },
            upsert: true,
          },
        });
      }
    }
  });

  if (bulkOps.length === 0) {
    return { inserted: 0 };
  }

  const result = await this.bulkWrite(bulkOps, { ordered: false });
  return {
    inserted: result.upsertedCount ?? 0,
    matched: result.matchedCount ?? 0,
  };
};

const StorageSlot = mongoose.model('StorageSlot', storageSlotSchema);

export default StorageSlot;


