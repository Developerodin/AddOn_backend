import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';
import {
  vendorStandardFloorSchema,
  vendorBrandingFloorSchema,
  vendorFinalCheckingFloorSchema,
  vendorSecondaryCheckingFloorSchema,
} from './vendorFloorQuantity.embed.js';

/**
 * Fixed vendor production pipeline (only order that exists for this module):
 * secondaryChecking → washing → boarding → branding → finalChecking
 */
export const vendorProductionFlowSequence = [
  'secondaryChecking',
  'washing',
  'boarding',
  'branding',
  'finalChecking',
];

/** Same as {@link vendorProductionFlowSequence} — all floor keys on the document */
export const vendorProductionFloorKeys = [...vendorProductionFlowSequence];

const floorQuantitiesSchema = new mongoose.Schema(
  {
    secondaryChecking: { type: vendorSecondaryCheckingFloorSchema, default: () => ({}) },
    washing: { type: vendorStandardFloorSchema, default: () => ({}) },
    boarding: { type: vendorStandardFloorSchema, default: () => ({}) },
    branding: { type: vendorBrandingFloorSchema, default: () => ({}) },
    finalChecking: { type: vendorFinalCheckingFloorSchema, default: () => ({}) },
  },
  { _id: false }
);

const vendorProductionFlowSchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VendorManagement',
      required: true,
      index: true,
    },
    vendorPurchaseOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VendorPurchaseOrder',
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
    },
    referenceCode: {
      type: String,
      trim: true,
    },
    plannedQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    remarks: {
      type: String,
      trim: true,
      default: '',
    },
    floorQuantities: {
      type: floorQuantitiesSchema,
      default: () => ({}),
    },
    currentFloorKey: {
      type: String,
      enum: vendorProductionFloorKeys,
    },
    finalQualityConfirmed: {
      type: Boolean,
      default: false,
    },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

/** Always the linear vendor pipeline (no branching). */
vendorProductionFlowSchema.methods.getResolvedFloorSequence = function getResolvedFloorSequence() {
  return [...vendorProductionFlowSequence];
};

vendorProductionFlowSchema.plugin(toJSON);
vendorProductionFlowSchema.plugin(paginate);

vendorProductionFlowSchema.index({ vendor: 1, createdAt: -1 });
vendorProductionFlowSchema.index({ vendorPurchaseOrder: 1 });

const VendorProductionFlow = mongoose.model('VendorProductionFlow', vendorProductionFlowSchema);

export default VendorProductionFlow;
