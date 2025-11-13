import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';

const qcDataSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    username: {
      type: String,
      trim: true,
    },
    date: {
      type: Date,
    },
    remarks: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      trim: true,
    },
    mediaUrl: {
      type: String,
      trim: true,
    },
  },
  { _id: false }
);

const coneIssueBySchema = mongoose.Schema(
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

const coneDataSchema = mongoose.Schema(
  {
    conesIssued: {
      type: Boolean,
      default: false,
    },
    coneIssueDate: {
      type: Date,
    },
    coneIssueBy: coneIssueBySchema,
    numberOfCones: {
      type: Number,
      min: 0,
    },
  },
  { _id: false }
);

const yarnBoxSchema = mongoose.Schema(
  {
    boxId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    poNumber: {
      type: String,
      required: true,
      trim: true,
    },
    receivedDate: {
      type: Date,
    },
    orderDate: {
      type: Date,
    },
    yarnName: {
      type: String,
      required: true,
      trim: true,
    },
    shadeCode: {
      type: String,
      trim: true,
    },
    orderQty: {
      type: Number,
      min: 0,
    },
    lotNumber: {
      type: String,
      trim: true,
    },
    boxWeight: {
      type: Number,
      min: 0,
    },
    barcode: {
      type: String,
      trim: true,
    },
    numberOfCones: {
      type: Number,
      min: 0,
    },
    qcData: qcDataSchema,
    storageLocation: {
      type: String,
      trim: true,
    },
    coneData: coneDataSchema,
  },
  {
    timestamps: true,
  }
);

yarnBoxSchema.plugin(toJSON);
yarnBoxSchema.plugin(paginate);

const YarnBox = mongoose.model('YarnBox', yarnBoxSchema);

export default YarnBox;


