import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

const machineSchema = mongoose.Schema(
  {
    machineCode: {
      type: String,
      required: false,
      trim: true,
      unique: true,
    },
    machineNumber: {
      type: String,
      required: false,
      trim: true,
      unique: true,
    },
    /** Array of { needleSize, cutoffQuantity } for multiple needle configs */
    needleSizeConfig: {
      type: [
        {
          needleSize: { type: String, trim: true },
          cutoffQuantity: { type: Number, default: 0 },
        },
      ],
      default: [],
    },
    model: {
      type: String,
      required: false,
      trim: true,
    },
    floor: {
      type: String,
      required: false,
      trim: true,
    },
    company: {
      type: String,
      required: false,
      trim: true,
    },
    machineType: {
      type: String,
      required: false,
      trim: true,
    },
    // Operational details
    status: {
      type: String,
      enum: ['Active', 'Under Maintenance', 'Idle'],
      default: 'Idle',
      required: false,
    },
    assignedSupervisor: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false, // Optional as per requirements
    },
    capacityPerShift: {
      type: Number,
      required: false,
      min: 0,
    },
    capacityPerDay: {
      type: Number,
      required: false,
      min: 0,
    },
    // Maintenance details
    installationDate: {
      type: Date,
      required: false,
    },
    maintenanceRequirement: {
      type: String,
      enum: ['1 month', '3 months', '6 months', '12 months'],
      required: false,
    },
    lastMaintenanceDate: {
      type: Date,
      required: false,
    },
    nextMaintenanceDate: {
      type: Date,
      required: false,
    },
    maintenanceNotes: {
      type: String,
      trim: true,
      required: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Add plugins for converting MongoDB document to JSON and pagination support
machineSchema.plugin(toJSON);
machineSchema.plugin(paginate);

/**
 * Check if machine code is taken
 * @param {string} machineCode - The machine code
 * @param {ObjectId} [excludeMachineId] - The id of the machine to be excluded
 * @returns {Promise<boolean>}
 */
machineSchema.statics.isMachineCodeTaken = async function (machineCode, excludeMachineId) {
  const machine = await this.findOne({ machineCode, _id: { $ne: excludeMachineId } });
  return !!machine;
};

/**
 * Check if machine number is taken
 * @param {string} machineNumber - The machine number
 * @param {ObjectId} [excludeMachineId] - The id of the machine to be excluded
 * @returns {Promise<boolean>}
 */
machineSchema.statics.isMachineNumberTaken = async function (machineNumber, excludeMachineId) {
  const machine = await this.findOne({ machineNumber, _id: { $ne: excludeMachineId } });
  return !!machine;
};

/**
 * Calculate next maintenance date based on maintenance requirement
 * @param {Date} lastMaintenanceDate - The last maintenance date
 * @param {string} maintenanceRequirement - The maintenance requirement interval
 * @returns {Date} - The next maintenance date
 */
machineSchema.methods.calculateNextMaintenanceDate = function (lastMaintenanceDate, maintenanceRequirement) {
  const months = {
    '1 month': 1,
    '3 months': 3,
    '6 months': 6,
    '12 months': 12,
  };
  
  const monthsToAdd = months[maintenanceRequirement] || 6;
  const nextDate = new Date(lastMaintenanceDate);
  nextDate.setMonth(nextDate.getMonth() + monthsToAdd);
  return nextDate;
};

/**
 * Check if machine needs maintenance
 * @returns {boolean} - True if maintenance is due
 */
machineSchema.methods.needsMaintenance = function () {
  if (!this.nextMaintenanceDate) return false;
  return new Date() >= this.nextMaintenanceDate;
};

/**
 * @typedef Machine
 */
const Machine = mongoose.model('Machine', machineSchema);

export default Machine;
