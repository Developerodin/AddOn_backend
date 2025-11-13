import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';
import YarnCatalog from '../yarnManagement/yarnCatalog.model.js';

const yarnRequisitionSchema = mongoose.Schema(
  {
    yarnName: {
      type: String,
      required: true,
      trim: true,
    },
    yarn: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'YarnCatalog',
      required: true,
    },
    minQty: {
      type: Number,
      required: true,
      min: 0,
    },
    availableQty: {
      type: Number,
      required: true,
      min: 0,
    },
    blockedQty: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    alertStatus: {
      type: String,
      enum: [null, 'below_minimum', 'overbooked'],
      default: null,
    },
    poSent: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: { createdAt: 'created', updatedAt: 'lastUpdated' },
  }
);

yarnRequisitionSchema.plugin(toJSON);
yarnRequisitionSchema.plugin(paginate);

yarnRequisitionSchema.pre('save', async function (next) {
  if (this.isModified('yarn')) {
    const yarn = await YarnCatalog.findById(this.yarn);
    if (yarn) {
      this.yarnName = yarn.yarnName || this.yarnName;
    }
  }
  next();
});

const YarnRequisition = mongoose.model('YarnRequisition', yarnRequisitionSchema);

export default YarnRequisition;


