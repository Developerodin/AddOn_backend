import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';

export const yarnConeIssueStatuses = ['issued', 'not_issued'];
export const yarnConeReturnStatuses = ['returned', 'not_returned'];

const issuedBySchema = mongoose.Schema(
  {
    username: {
      type: String,
      trim: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { _id: false }
);

const returnBySchema = mongoose.Schema(
  {
    username: {
      type: String,
      trim: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { _id: false }
);

const yarnConeSchema = mongoose.Schema(
  {
    poNumber: {
      type: String,
      required: true,
      trim: true,
    },
    boxId: {
      type: String,
      required: true,
      trim: true,
    },
    coneWeight: {
      type: Number,
      min: 0,
    },
    tearWeight: {
      type: Number,
      min: 0,
    },
    yarnName: {
      type: String,
      trim: true,
    },
    yarn: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'YarnCatalog',
    },
    shadeCode: {
      type: String,
      trim: true,
    },
    issueStatus: {
      type: String,
      enum: yarnConeIssueStatuses,
      default: 'not_issued',
    },
    issuedBy: issuedBySchema,
    issueDate: {
      type: Date,
    },
    issueWeight: {
      type: Number,
      min: 0,
    },
    returnStatus: {
      type: String,
      enum: yarnConeReturnStatuses,
      default: 'not_returned',
    },
    returnDate: {
      type: Date,
    },
    returnWeight: {
      type: Number,
      min: 0,
    },
    returnBy: returnBySchema,
    coneStorageId: {
      type: String,
      trim: true,
    },
    barcode: {
      type: String,
      trim: true,
      unique: true,
    },
  },
  {
    timestamps: true,
  }
);

yarnConeSchema.plugin(toJSON);
yarnConeSchema.plugin(paginate);

const YarnCone = mongoose.model('YarnCone', yarnConeSchema);

export default YarnCone;


