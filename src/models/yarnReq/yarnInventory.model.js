import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';
import YarnCatalog from '../yarnManagement/yarnCatalog.model.js';

export const yarnInventoryStatuses = ['in_stock', 'low_stock', 'soon_to_be_low'];

const inventoryBucketSchema = mongoose.Schema(
  {
    totalWeight: {
      type: Number,
      default: 0,
    },
    totalTearWeight: {
      type: Number,
      default: 0,
    },
    totalNetWeight: {
      type: Number,
      default: 0,
    },
    totalBlockedWeight: {
      type: Number,
      default: 0,
    },
    
    numberOfCones: {
      type: Number,
      default: 0,
    },
  
  },
  { _id: false }
);

const yarnInventorySchema = mongoose.Schema(
  {
    yarn: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'YarnCatalog',
      required: true,
      unique: true,
    },
    yarnName: {
      type: String,
      required: true,
      trim: true,
    },
    totalInventory: {
      type: inventoryBucketSchema,
      default: () => ({}),
    },
    longTermInventory: {
      type: inventoryBucketSchema,
      default: () => ({}),
    },
    shortTermInventory: {
      type: inventoryBucketSchema,
      default: () => ({}),
    },
    blockedNetWeight: {
      type: Number,
      default: 0,
    },
    inventoryStatus: {
      type: String,
      enum: yarnInventoryStatuses,
      default: 'in_stock',
    },
    overbooked: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

yarnInventorySchema.plugin(toJSON);
yarnInventorySchema.plugin(paginate);

yarnInventorySchema.pre('save', async function (next) {
  if (this.isModified('yarn') || !this.yarnName) {
    const yarn = await YarnCatalog.findById(this.yarn);
    if (yarn) {
      this.yarnName = yarn.yarnName || this.yarnName;
    }
  }
  next();
});

const YarnInventory = mongoose.model('YarnInventory', yarnInventorySchema);

export default YarnInventory;


