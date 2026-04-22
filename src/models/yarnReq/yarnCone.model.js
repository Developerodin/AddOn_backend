import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';
import YarnCatalog from '../yarnManagement/yarnCatalog.model.js';
import YarnInventory from './yarnInventory.model.js';
import YarnBox from './yarnBox.model.js';

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
  },
  {
    timestamps: true,
  }
);

/**
 * Pre-save hook: When a yarn cone is returned (returnStatus set to 'returned'), set issueStatus to not_issued
 * and returnStatus to not_returned so the cone is back in pool / available again.
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
    this.issueStatus = 'not_issued';
    this.returnStatus = 'not_returned';
    // Clear linkage to order/article so cone can be issued again
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
  const hasStorage = doc.coneStorageId != null && String(doc.coneStorageId).trim() !== '';
  const isNotIssued = doc.issueStatus !== 'issued';
  const hasWeight = doc.coneWeight && doc.coneWeight > 0;

  if (!hasStorage || !isNotIssued || !hasWeight) {
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
      issueStatus: { $ne: 'issued' },
      yarnCatalogId: yarnCatalog._id,
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
        const box = await YarnBox.findOne({ boxId: doc.boxId });
        if (box) {
          const conesInST = await mongoose.model('YarnCone').find({
            boxId: doc.boxId,
            coneStorageId: { $exists: true, $nin: [null, ''] },
          }).lean();
          const totalConesInST = conesInST.length;
          const totalConeWeight = conesInST.reduce((sum, c) => sum + (c.coneWeight || 0), 0);
          const initial = box.initialBoxWeight != null ? Number(box.initialBoxWeight) : 0;
          const boxWeightNow = Number(box.boxWeight ?? 0);
          // For legacy boxes (initialBoxWeight missing), treat current boxWeight as the original LT weight.
          // Only if boxWeightNow looks like an already-decremented remaining weight (rare), infer base as remaining + moved.
          const inferredBase =
            boxWeightNow >= totalConeWeight ? boxWeightNow : boxWeightNow + totalConeWeight;
          const baseWeight = initial > 0 ? initial : inferredBase;
          const remaining = Math.max(0, baseWeight - (totalConeWeight || 0));
          const fullyTransferred = totalConesInST > 0 && remaining <= 0.001;

          // Keep initialBoxWeight stable once inferred.
          if (box.initialBoxWeight == null || Number(box.initialBoxWeight) <= 0) {
            box.initialBoxWeight = baseWeight;
          }
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

yarnConeSchema.plugin(toJSON);
yarnConeSchema.plugin(paginate);

const YarnCone = mongoose.model('YarnCone', yarnConeSchema);

export default YarnCone;


