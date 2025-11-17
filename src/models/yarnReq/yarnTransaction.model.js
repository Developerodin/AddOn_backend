import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';

export const yarnTransactionTypes = ['yarn_issued', 'yarn_blocked', 'yarn_stocked', 'internal_transfer', 'yarn_returned'];

const yarnTransactionSchema = mongoose.Schema(
  {
    yarn: {
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
    orderno: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

yarnTransactionSchema.plugin(toJSON);
yarnTransactionSchema.plugin(paginate);

const YarnTransaction = mongoose.model('YarnTransaction', yarnTransactionSchema);

export default YarnTransaction;


