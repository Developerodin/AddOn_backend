import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';

export const STORAGE_ZONES = {
  LONG_TERM: 'LT',
  SHORT_TERM: 'ST',
};

/** ST: one section B7-01 (no G), 4 floors (F1..F4). */
export const ST_SECTION_CODE = 'B7-01';
/** LT: four sections B7-02..B7-05, 4 floors each (F1..F4). */
export const LT_SECTION_CODES = ['B7-02', 'B7-03', 'B7-04', 'B7-05'];

const MAX_SHELVES_PER_ZONE = 50;
/** LT: 12 shelves × 4 floors = 48 slots per section → 192 total. */
const MAX_SHELVES_LT = 12;
const FLOORS_PER_SHELF_ST = 4;
const FLOORS_PER_SHELF_LT = 4;
const FLOORS_PER_SHELF_MAX = 4;

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
      max: FLOORS_PER_SHELF_MAX,
      required: true,
    },
    /** Section: ST = B7-01, LT = B7-02 | B7-03 | B7-04 | B7-05. */
    sectionCode: {
      type: String,
      trim: true,
      required: false,
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

storageSlotSchema.index(
  { zoneCode: 1, sectionCode: 1, shelfNumber: 1, floorNumber: 1 },
  { unique: true }
);

storageSlotSchema.pre('validate', function (next) {
  const shelf = String(this.shelfNumber).padStart(4, '0');
  const floor = String(this.floorNumber).padStart(2, '0');
  const prefix = this.sectionCode || this.zoneCode;
  const label = `${prefix}-S${shelf}-F${floor}`;

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

  // ST: B7-01-S0001-F01..F04 (4 floors), shelves S0001..S0050
  const stZone = STORAGE_ZONES.SHORT_TERM;
  for (let shelf = 1; shelf <= MAX_SHELVES_PER_ZONE; shelf += 1) {
    for (let floor = 1; floor <= FLOORS_PER_SHELF_ST; floor += 1) {
      const shelfStr = String(shelf).padStart(4, '0');
      const floorStr = String(floor).padStart(2, '0');
      const label = `${ST_SECTION_CODE}-S${shelfStr}-F${floorStr}`;
      bulkOps.push({
        updateOne: {
          filter: { label },
          update: {
            $setOnInsert: {
              zoneCode: stZone,
              sectionCode: ST_SECTION_CODE,
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

  // LT: 4 sections, 12 shelves × 4 floors (F01..F04) → 48 per section, 192 total
  const ltZone = STORAGE_ZONES.LONG_TERM;
  LT_SECTION_CODES.forEach((sectionCode) => {
    for (let shelf = 1; shelf <= MAX_SHELVES_LT; shelf += 1) {
      for (let floor = 1; floor <= FLOORS_PER_SHELF_LT; floor += 1) {
        const shelfStr = String(shelf).padStart(4, '0');
        const floorStr = String(floor).padStart(2, '0');
        const label = `${sectionCode}-S${shelfStr}-F${floorStr}`;
        bulkOps.push({
          updateOne: {
            filter: { label },
            update: {
              $setOnInsert: {
                zoneCode: ltZone,
                sectionCode,
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
