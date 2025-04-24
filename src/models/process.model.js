import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

const processStepSchema = mongoose.Schema(
  {
    stepTitle: {
      type: String,
      required: true,
      trim: true,
    },
    stepDescription: {
      type: String,
      required: true,
      trim: true,
    },
    duration: {
      type: Number, // duration in minutes
      required: true,
    },
  },
  {
    _id: true, // Enable automatic _id for each step
    timestamps: true,
  }
);

const processSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    image: {
      type: String,
      trim: true,
    },
    steps: [processStepSchema],
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json
processSchema.plugin(toJSON);
processSchema.plugin(paginate);

const Process = mongoose.model('Process', processSchema);

export default Process; 