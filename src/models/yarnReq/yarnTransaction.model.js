import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';
import YarnCatalog from '../yarnManagement/yarnCatalog.model.js';

export const yarnTransactionTypes = [
  'yarn_issued',
  'yarn_issued_linking',
  'yarn_issued_sampling',
  'yarn_blocked',
  'yarn_stocked',
  'internal_transfer',
  'yarn_returned',
];

const yarnTransactionSchema = mongoose.Schema(
  {
    yarnCatalogId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'YarnCatalog',
      required: true,
    },
    yarnName: {
      type: String,
      required: true,
      trim: true,
    },
    transactionType: {
      type: String,
      enum: yarnTransactionTypes,
      required: true,
    },
    transactionDate: {
      type: Date,
      required: true,
    },
    transactionNetWeight: {
      type: Number,
      min: 0,
    },
    transactionTotalWeight: {
      type: Number,
      min: 0,
    },
    transactionTearWeight: {
      type: Number,
      min: 0,
    },
    transactionConeCount: {
      type: Number,
      min: 0,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProductionOrder',
    },
    orderno: {
      type: String,
      trim: true,
    },
    articleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Article',
    },
    articleNumber: {
      type: String,
      trim: true,
    },
    machineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Machine',
    },
    // For internal_transfer: Track which boxes were transferred
    boxIds: {
      type: [String],
      default: [],
    },
    // Track which cones are involved in this transaction (e.g. issued/transferred)
    conesIdsArray: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'YarnCone',
      default: [],
    },
    // Track storage locations for transfer history
    fromStorageLocation: {
      type: String,
      trim: true,
    },
    toStorageLocation: {
      type: String,
      trim: true,
    },
    /** Authenticated user email when the transaction is created (e.g. linking/sampling floor issue); set server-side only. */
    issuedByEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    /** Floor-issue batch (linking/sampling); links rows from POST /yarn-cones/floor-issue-batch. */
    issueBatchId: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// List + sort by date scoped by type (floor issue history, reports, etc.)
yarnTransactionSchema.index({ transactionType: 1, transactionDate: -1 });
yarnTransactionSchema.index({ issueBatchId: 1, yarnCatalogId: 1, transactionType: 1 });
yarnTransactionSchema.index({ issueBatchId: 1, transactionDate: -1 }, { sparse: true });
// Order-scoped history
yarnTransactionSchema.index({ orderId: 1, transactionDate: -1 }, { sparse: true });

yarnTransactionSchema.pre('save', async function (next) {
  if (this.yarnCatalogId && (this.isModified('yarnCatalogId') || !this.yarnName)) {
    try {
      const cat = await YarnCatalog.findById(this.yarnCatalogId).select('yarnName').lean();
      if (cat?.yarnName) this.yarnName = cat.yarnName;
    } catch (e) {
      console.error('[YarnTransaction] yarnName sync:', e.message);
    }
  }
  next();
});

yarnTransactionSchema.plugin(toJSON);
yarnTransactionSchema.plugin(paginate);

const YarnTransaction = mongoose.model('YarnTransaction', yarnTransactionSchema);

export default YarnTransaction;


