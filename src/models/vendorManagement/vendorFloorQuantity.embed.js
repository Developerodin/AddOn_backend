import mongoose from 'mongoose';
import { RepairStatus } from '../production/enums.js';

/**
 * Embedded shapes aligned with {@link ../production/article.model.js} `floorQuantities`.
 * Vendor flow is fixed: secondaryChecking → washing → boarding → branding → finalChecking → dispatch
 * (see {@link ./vendorProductionFlow.model.js} `vendorProductionFlowSequence`).
 * Secondary + final checking floors track M1, M2, M4 only (no M3 on vendor).
 */

export const receivedDataEntrySchema = new mongoose.Schema(
  {
    receivedStatusFromPreviousFloor: { type: String, default: '' },
    receivedInContainerId: { type: mongoose.Schema.Types.ObjectId, ref: 'ContainersMaster', default: null },
    receivedTimestamp: { type: Date, default: null },
  },
  { _id: false }
);

export const receivedDataBrandingEntrySchema = new mongoose.Schema(
  {
    receivedStatusFromPreviousFloor: { type: String, default: '' },
    receivedInContainerId: { type: mongoose.Schema.Types.ObjectId, ref: 'ContainersMaster', default: null },
    receivedTimestamp: { type: Date, default: null },
    transferred: { type: Number, default: 0 },
    styleCode: { type: String, default: '' },
    brand: { type: String, default: '' },
  },
  { _id: false }
);

export const transferredDataEntrySchema = new mongoose.Schema(
  {
    transferred: { type: Number, required: true, min: 0 },
    styleCode: { type: String, default: '' },
    brand: { type: String, default: '' },
  },
  { _id: false }
);

/** Washing / boarding style (no M1–M4) */
export const vendorStandardFloorSchema = new mongoose.Schema(
  {
    received: { type: Number, default: 0 },
    completed: { type: Number, default: 0 },
    remaining: { type: Number, default: 0 },
    transferred: { type: Number, default: 0 },
    repairReceived: { type: Number, default: 0, min: 0 },
    receivedData: { type: [receivedDataEntrySchema], default: [] },
  },
  { _id: false }
);

export const vendorBrandingFloorSchema = new mongoose.Schema(
  {
    received: { type: Number, default: 0 },
    completed: { type: Number, default: 0 },
    remaining: { type: Number, default: 0 },
    transferred: { type: Number, default: 0 },
    repairReceived: { type: Number, default: 0, min: 0 },
    transferredData: { type: [transferredDataEntrySchema], default: [] },
    receivedData: { type: [receivedDataBrandingEntrySchema], default: [] },
  },
  { _id: false }
);

export const vendorFinalCheckingFloorSchema = new mongoose.Schema(
  {
    received: { type: Number, default: 0 },
    completed: { type: Number, default: 0 },
    remaining: { type: Number, default: 0 },
    transferred: { type: Number, default: 0 },
    m1Quantity: { type: Number, default: 0, min: 0 },
    m2Quantity: { type: Number, default: 0, min: 0 },
    m4Quantity: { type: Number, default: 0, min: 0 },
    m1Transferred: { type: Number, default: 0, min: 0 },
    m1Remaining: { type: Number, default: 0, min: 0 },
    m2Transferred: { type: Number, default: 0, min: 0 },
    m2Remaining: { type: Number, default: 0, min: 0 },
    repairStatus: {
      type: String,
      enum: Object.values(RepairStatus),
      default: RepairStatus.NOT_REQUIRED,
    },
    repairRemarks: { type: String, default: '' },
    transferredData: { type: [transferredDataEntrySchema], default: [] },
    receivedData: {
      type: [
        new mongoose.Schema(
          {
            receivedStatusFromPreviousFloor: { type: String, default: '' },
            receivedInContainerId: { type: mongoose.Schema.Types.ObjectId, ref: 'ContainersMaster', default: null },
            receivedTimestamp: { type: Date, default: null },
            transferred: { type: Number, default: 0 },
            styleCode: { type: String, default: '' },
            brand: { type: String, default: '' },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
  },
  { _id: false }
);

/** Secondary checking: same quantities as checking + placeholder for external sync */
export const vendorSecondaryCheckingFloorSchema = new mongoose.Schema(
  {
    received: { type: Number, default: 0 },
    completed: { type: Number, default: 0 },
    remaining: { type: Number, default: 0 },
    transferred: { type: Number, default: 0 },
    m1Quantity: { type: Number, default: 0, min: 0 },
    m2Quantity: { type: Number, default: 0, min: 0 },
    m4Quantity: { type: Number, default: 0, min: 0 },
    m1Transferred: { type: Number, default: 0, min: 0 },
    m1Remaining: { type: Number, default: 0, min: 0 },
    m2Transferred: { type: Number, default: 0, min: 0 },
    m2Remaining: { type: Number, default: 0, min: 0 },
    repairStatus: {
      type: String,
      enum: Object.values(RepairStatus),
      default: RepairStatus.NOT_REQUIRED,
    },
    repairRemarks: { type: String, default: '' },
    receivedData: { type: [receivedDataEntrySchema], default: [] },
    /** Filled later by another system / job */
    externalSource: {
      pending: { type: Boolean, default: true },
      lastSyncedAt: { type: Date },
      sourceRef: { type: String, trim: true },
      notes: { type: String, trim: true },
    },
  },
  { _id: false }
);
