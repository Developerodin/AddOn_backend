import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';
import YarnCatalog from '../yarnManagement/yarnCatalog.model.js';
import YarnInventory from './yarnInventory.model.js';
import YarnBox from './yarnBox.model.js';
import { computeLtRemainingBoxWeight } from '../../services/yarnManagement/yarnBoxLtRemaining.helper.js';

export const yarnConeIssueStatuses = ['issued', 'not_issued', 'used', 'returned_to_vendor'];
export const yarnConeReturnStatuses = ['returned', 'not_returned'];

/**
 * Issue statuses that exclude a cone from the short-term inventory pool:
 * issued (floor), used (empty), returned_to_vendor (shipped back to supplier).
 */
export const yarnConeUnavailableIssueStatuses = ['issued', 'used', 'returned_to_vendor'];

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
    /** Canonical YarnCatalog reference. */
    yarnCatalogId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'YarnCatalog',
    },
    shadeCode: {
      type: String,
      trim: true,
    },
    // Optional reference to production order for which this cone is issued
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProductionOrder',
      required: false,
    },
    // Optional reference to article for which this cone is issued
    articleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Article',
      required: false,
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
    /** Set when stock is returned to supplier — row kept for audit; excluded from active stock queries. */
    returnedToVendorAt: { type: Date, default: null },
    vendorReturnId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'YarnPoVendorReturn',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Pre-save hook for YarnCone.
 *
 * Behavior:
 *  - Syncs yarnName from YarnCatalog when yarnCatalogId changes / yarnName is missing.
 *  - When returnStatus === 'returned' (transient flag set by the return service),
 *    classify the return based on remaining weight:
 *      - empty return  (coneWeight is 0 or null) -> issueStatus = 'used'
 *      - partial return (coneWeight > 0)         -> issueStatus = 'not_issued' (back to pool)
 *    In both cases reset returnStatus to 'not_returned' and clear orderId/articleId.
 *  - If the cone has no weight, also clear coneStorageId so it does not appear in any slot.
 */
yarnConeSchema.pre('save', async function (next) {
  if (this.yarnCatalogId && (this.isModified('yarnCatalogId') || !this.yarnName)) {
    try {
      const cat = await YarnCatalog.findById(this.yarnCatalogId).select('yarnName').lean();
      if (cat?.yarnName) this.yarnName = cat.yarnName;
    } catch (e) {
      console.error('[YarnCone] yarnName sync from catalog:', e.message);
    }
  }
  if (this.returnStatus === 'returned') {
    const isEmptyReturn = this.coneWeight == null || Number(this.coneWeight) <= 0;
    this.issueStatus = isEmptyReturn ? 'used' : 'not_issued';
    this.returnStatus = 'not_returned';
    this.orderId = undefined;
    this.articleId = undefined;
  }
  if (this.coneWeight === 0 || this.coneWeight == null) {
    this.coneStorageId = undefined;
  }
  next();
});

/**
 * Post-save hook: Automatically sync cone to inventory when stored in short-term storage
 * (Any non-empty coneStorageId = cone is in short-term / slot storage.)
 */
yarnConeSchema.post('save', async function (doc) {
  if (doc.returnedToVendorAt != null) {
    return;
  }
  const hasStorage = doc.coneStorageId != null && String(doc.coneStorageId).trim() !== '';
  const isAvailable = !yarnConeUnavailableIssueStatuses.includes(doc.issueStatus);
  const hasWeight = doc.coneWeight && doc.coneWeight > 0;

  if (!hasStorage || !isAvailable || !hasWeight) {
    return;
  }

  // NOTE: Avoid checking doc.isModified(...) here.
  // In a post('save') hook, Mongoose clears modification flags after persistence,
  // so isModified() is usually false and we would skip required recomputations.

  try {
    // Find matching yarn catalog
    let yarnCatalog = null;
    if (doc.yarnCatalogId) {
      yarnCatalog = await YarnCatalog.findById(doc.yarnCatalogId);
    } else if (doc.yarnName) {
      // Try exact match first
      yarnCatalog = await YarnCatalog.findOne({
        yarnName: doc.yarnName.trim(),
        status: { $ne: 'deleted' },
      });

      // Try case-insensitive match if exact match failed
      if (!yarnCatalog) {
        yarnCatalog = await YarnCatalog.findOne({
          yarnName: { $regex: new RegExp(`^${doc.yarnName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
          status: { $ne: 'deleted' },
        });
      }
    }

    if (!yarnCatalog) {
      // No matching catalog found - skip silently
      return;
    }

    // Calculate net weight
    const netWeight = (doc.coneWeight || 0) - (doc.tearWeight || 0);
    if (netWeight <= 0) {
      return;
    }

    // Update inventory directly (cones in ST storage)
    const toNumber = (value) => Math.max(0, Number(value ?? 0));
    
    let inventory = await YarnInventory.findOne({ yarnCatalogId: yarnCatalog._id });
    
    if (!inventory) {
      inventory = new YarnInventory({
        yarnCatalogId: yarnCatalog._id,
        yarnName: yarnCatalog.yarnName,
        totalInventory: { totalWeight: 0, totalTearWeight: 0, totalNetWeight: 0, numberOfCones: 0 },
        longTermInventory: { totalWeight: 0, totalTearWeight: 0, totalNetWeight: 0, numberOfCones: 0 },
        shortTermInventory: { totalWeight: 0, totalTearWeight: 0, totalNetWeight: 0, numberOfCones: 0 },
        blockedNetWeight: 0,
        inventoryStatus: 'in_stock',
        overbooked: false,
      });
    }

    // Ensure buckets exist
    if (!inventory.shortTermInventory) {
      inventory.shortTermInventory = { totalWeight: 0, totalTearWeight: 0, totalNetWeight: 0, numberOfCones: 0 };
    }
    if (!inventory.longTermInventory) {
      inventory.longTermInventory = { totalWeight: 0, totalTearWeight: 0, totalNetWeight: 0, numberOfCones: 0 };
    }
    if (!inventory.totalInventory) {
      inventory.totalInventory = { totalWeight: 0, totalTearWeight: 0, totalNetWeight: 0, numberOfCones: 0 };
    }

    // Recalculate short-term inventory from all available cones
    // This ensures we always have accurate counts
    const allSTCones = await mongoose.model('YarnCone').find({
      coneStorageId: { $exists: true, $nin: [null, ''] },
      issueStatus: { $nin: yarnConeUnavailableIssueStatuses },
      yarnCatalogId: yarnCatalog._id,
      returnedToVendorAt: null,
    }).lean();

    let stTotalWeight = 0;
    let stTotalTearWeight = 0;
    let stTotalNetWeight = 0;
    let stConeCount = 0;

    for (const cone of allSTCones) {
      const coneNetWeight = (cone.coneWeight || 0) - (cone.tearWeight || 0);
      stTotalWeight += cone.coneWeight || 0;
      stTotalTearWeight += cone.tearWeight || 0;
      stTotalNetWeight += coneNetWeight;
      stConeCount += 1;
    }

    // Update short-term inventory
    const st = inventory.shortTermInventory;
    st.totalWeight = toNumber(stTotalWeight);
    st.totalTearWeight = toNumber(stTotalTearWeight);
    st.totalNetWeight = toNumber(stTotalNetWeight);
    st.numberOfCones = toNumber(stConeCount);

    // Recalculate total inventory
    const lt = inventory.longTermInventory;
    const total = inventory.totalInventory;
    total.totalWeight = toNumber(lt.totalWeight) + toNumber(st.totalWeight);
    total.totalTearWeight = toNumber(lt.totalTearWeight) + toNumber(st.totalTearWeight);
    total.totalNetWeight = toNumber(lt.totalNetWeight) + toNumber(st.totalNetWeight);
    total.numberOfCones = toNumber(lt.numberOfCones) + toNumber(st.numberOfCones);

    // Update status
    const totalNet = toNumber(total.totalNetWeight);
    const minQty = toNumber(yarnCatalog?.minQuantity);
    if (minQty > 0) {
      if (totalNet <= minQty) {
        inventory.inventoryStatus = 'low_stock';
      } else if (totalNet <= minQty * 1.2) {
        inventory.inventoryStatus = 'soon_to_be_low';
      } else {
        inventory.inventoryStatus = 'in_stock';
      }
    }

    await inventory.save();

    // If cone has storage and has a boxId, reduce LT remaining weight and possibly mark box as fully transferred.
    if (doc.boxId && hasStorage) {
      try {
        const box = await YarnBox.findOne({ boxId: doc.boxId, returnedToVendorAt: null });
        if (box) {
          const conesInST = await mongoose.model('YarnCone').find({
            boxId: doc.boxId,
            coneStorageId: { $exists: true, $nin: [null, ''] },
            returnedToVendorAt: null,
          }).lean();
          const conesReturnedVendor = await mongoose.model('YarnCone').find({
            boxId: doc.boxId,
            returnedToVendorAt: { $exists: true, $ne: null },
          }).lean();
          const totalConesInST = conesInST.length;
          const { remaining, fullyTransferred } = computeLtRemainingBoxWeight(
            box,
            conesInST,
            conesReturnedVendor
          );

          box.boxWeight = remaining;
          if (fullyTransferred) {
            box.storageLocation = undefined; // unset so field is removed from document
            box.storedStatus = false;
            if (!box.coneData) box.coneData = {};
            box.coneData.conesIssued = true;
            box.coneData.numberOfCones = totalConesInST;
            box.coneData.coneIssueDate = doc.createdAt || new Date();
            console.log(`[YarnCone] Box ${doc.boxId} fully transferred to ST cones (remaining=0).`);
          }
          await box.save();
        }
      } catch (boxError) {
        console.error(`[YarnCone] Error resetting box ${doc.boxId}:`, boxError.message);
      }
    }
  } catch (error) {
    // Log error but don't throw - don't break cone save operation
    console.error(`[YarnCone] Error auto-syncing cone ${doc.barcode} to inventory:`, error.message);
  }
});

yarnConeSchema.index({ coneStorageId: 1, issueStatus: 1 });
yarnConeSchema.index({ yarnName: 1, coneStorageId: 1 });
yarnConeSchema.index({ boxId: 1, coneStorageId: 1 });
yarnConeSchema.index({ yarnCatalogId: 1, coneStorageId: 1, issueStatus: 1 });
yarnConeSchema.index({ poNumber: 1, returnedToVendorAt: 1 });

yarnConeSchema.plugin(toJSON);
yarnConeSchema.plugin(paginate);

const YarnCone = mongoose.model('YarnCone', yarnConeSchema);

export default YarnCone;


