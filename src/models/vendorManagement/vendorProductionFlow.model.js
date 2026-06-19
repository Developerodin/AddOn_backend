import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';
import {
  vendorDispatchFloorSchema,
  vendorBrandingFloorSchema,
  vendorReBoardingFloorSchema,
  vendorFinalCheckingFloorSchema,
  vendorSecondaryCheckingFloorSchema,
} from './vendorFloorQuantity.embed.js';

/**
 * Vendor production pipeline:
 * secondaryChecking → branding → reBoarding → finalChecking → dispatch
 *
 * `reBoarding` is only traversed when `brandingType` is `Embroidery`; for `Heat Transfer`
 * (and legacy flows with no branding type) articles move branding → finalChecking directly.
 * See {@link ../../services/vendorManagement/vendorProductionFlowFloorPatch.js} `resolveVendorNextFloorKey`.
 */
export const vendorProductionFlowSequence = [
  'secondaryChecking',
  'branding',
  'reBoarding',
  'finalChecking',
  'dispatch',
];

/** Same as {@link vendorProductionFlowSequence} — all floor keys on the document */
export const vendorProductionFloorKeys = [...vendorProductionFlowSequence];

const floorQuantitiesSchema = new mongoose.Schema(
  {
    secondaryChecking: { type: vendorSecondaryCheckingFloorSchema, default: () => ({}) },
    branding: { type: vendorBrandingFloorSchema, default: () => ({}) },
    reBoarding: { type: vendorReBoardingFloorSchema, default: () => ({}) },
    finalChecking: { type: vendorFinalCheckingFloorSchema, default: () => ({}) },
    dispatch: { type: vendorDispatchFloorSchema, default: () => ({}) },
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
    /**
     * Branding method chosen on the Branding floor. Drives floor routing:
     * `Embroidery` → branding → reBoarding → finalChecking;
     * `Heat Transfer` → branding → finalChecking.
     */
    brandingType: {
      type: String,
      enum: ['Heat Transfer', 'Embroidery'],
      required: false,
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
    /** Ledger-only outward tracking for M3 Management (floor qty unchanged on outward) */
    m3Tracking: {
      outwardTotal: { type: Number, default: 0, min: 0 },
    },
    /** Ledger-only outward tracking for M4 Management (floor qty unchanged on outward) */
    m4Tracking: {
      outwardTotal: { type: Number, default: 0, min: 0 },
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
