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

/**
 * Pre-save hook: When a yarn cone is returned (returnStatus set to 'returned'), set issueStatus to not_issued
 * and returnStatus to not_returned so the cone is back in pool / available again.
 */
yarnConeSchema.pre('save', function (next) {
  if (this.returnStatus === 'returned') {
    this.issueStatus = 'not_issued';
    this.returnStatus = 'not_returned';
  }
  if (this.coneWeight === 0 || this.coneWeight == null) {
    this.coneStorageId = undefined;
  }
  next();
});

/**
 * Post-save hook: Automatically sync cone to inventory when stored in short-term storage
 * This ensures inventory is updated automatically when cones are created/stored
 */
yarnConeSchema.post('save', async function (doc) {
  // Only process if cone is stored in short-term storage
  const isShortTermStorage = doc.coneStorageId && /^ST-/i.test(doc.coneStorageId);
  const isNotIssued = doc.issueStatus !== 'issued';
  const hasWeight = doc.coneWeight && doc.coneWeight > 0;

  // Check if conditions are met
  if (!isShortTermStorage || !isNotIssued || !hasWeight) {
    return; // Skip if conditions not met
  }

  // Only trigger if coneStorageId or coneWeight changed, or if it's a new document
  const isNewOrRelevantFieldModified = doc.isNew || doc.isModified('coneStorageId') || doc.isModified('coneWeight') || doc.isModified('issueStatus');
  if (!isNewOrRelevantFieldModified) {
    return;
  }

  try {
    // Find matching yarn catalog
    let yarnCatalog = null;
    if (doc.yarn) {
      yarnCatalog = await YarnCatalog.findById(doc.yarn);
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
    
    let inventory = await YarnInventory.findOne({ yarn: yarnCatalog._id });
    
    if (!inventory) {
      inventory = new YarnInventory({
        yarn: yarnCatalog._id,
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
      coneStorageId: { $regex: /^ST-/i },
      issueStatus: { $ne: 'issued' },
      yarn: yarnCatalog._id,
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

    // If cone is in ST storage and has a boxId, check if box should be removed from LT
    // When cones are extracted from a box and stored in ST, the box is empty and should be removed from LT
    if (doc.boxId && isShortTermStorage) {
      try {
        const box = await YarnBox.findOne({ boxId: doc.boxId });
        if (box) {
          // Check if cones exist in ST for this box
          const totalConesInST = await mongoose.model('YarnCone').countDocuments({
            boxId: doc.boxId,
            coneStorageId: { $regex: /^ST-/i },
          });
          
          // If cones exist in ST for this box, remove box from LT storage
          // Box is now empty (cones extracted), so it should not be counted in LT inventory
          if (totalConesInST > 0) {
            // Remove box from LT storage
            box.storageLocation = null; // Box is no longer in storage
            box.storedStatus = false; // Box is not stored anymore (empty)
            
            // Update cone data
            if (!box.coneData) {
              box.coneData = {};
            }
            box.coneData.conesIssued = true;
            box.coneData.numberOfCones = totalConesInST;
            box.coneData.coneIssueDate = doc.createdAt || new Date();
            
            await box.save();
            console.log(`[YarnCone] Removed box ${doc.boxId} from LT storage - ${totalConesInST} cones now in ST`);
          }
        }
      } catch (boxError) {
        // Log error but don't throw - don't break cone save operation
        console.error(`[YarnCone] Error removing box ${doc.boxId} from LT storage:`, boxError.message);
      }
    }
  } catch (error) {
    // Log error but don't throw - don't break cone save operation
    console.error(`[YarnCone] Error auto-syncing cone ${doc.barcode} to inventory:`, error.message);
  }
});

yarnConeSchema.plugin(toJSON);
yarnConeSchema.plugin(paginate);

const YarnCone = mongoose.model('YarnCone', yarnConeSchema);

export default YarnCone;


