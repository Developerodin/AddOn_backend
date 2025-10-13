import mongoose from 'mongoose';
import { OrderStatus, Priority, LinkingType, ProductionFloor, RepairStatus } from './enums.js';
import ArticleLog from './articleLog.model.js';
import { 
  updateQualityCategories, 
  shiftM2Items, 
  confirmFinalQuality, 
  updateCompletedQuantityWithQuality,
  updateKnittingM4Quantity,
  updateQualityInspection
} from './qualityMethods.js';

/**
 * Article Model
 * Individual articles within production orders
 */
const articleSchema = new mongoose.Schema({
  // Basic identification
  id: {
    type: String,
    required: true,
    unique: true
  },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProductionOrder',
    required: true
  },
  articleNumber: {
    type: String,
    required: true
  },
  
  // Quantity management
  plannedQuantity: {
    type: Number,
    required: true
  },
  
  // Article properties
  linkingType: {
    type: String,
    required: true,
    enum: Object.values(LinkingType)
  },
  priority: {
    type: String,
    required: true,
    enum: Object.values(Priority)
  },
  status: {
    type: String,
    required: true,
    enum: Object.values(OrderStatus),
    default: OrderStatus.PENDING
  },
  progress: {
    type: Number,
    required: true,
    default: 0
  },
  // Removed currentFloor - using flow-based system instead
  // currentFloor: {
  //   type: String,
  //   required: true,
  //   enum: Object.values(ProductionFloor),
  //   default: ProductionFloor.KNITTING
  // },
  
  // General information
  remarks: {
    type: String,
    required: false
  },
  
  // Machine assignment
  machineId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Machine',
    required: false
  },
  
  
  // Floor-specific tracking
  floorQuantities: {
    knitting: {
      received: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      remaining: { type: Number, default: 0 },
      transferred: { type: Number, default: 0 },
      // Quality tracking fields for knitting floor (M4 = defect quantity)
      m4Quantity: { type: Number, default: 0, min: 0 }
    },
    linking: {
      received: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      remaining: { type: Number, default: 0 },
      transferred: { type: Number, default: 0 }
    },
    checking: {
      received: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      remaining: { type: Number, default: 0 },
      transferred: { type: Number, default: 0 },
      // Quality tracking fields for checking floor
      m1Quantity: { type: Number, default: 0, min: 0 },
      m2Quantity: { type: Number, default: 0, min: 0 },
      m3Quantity: { type: Number, default: 0, min: 0 },
      m4Quantity: { type: Number, default: 0, min: 0 },
      // Additive transfer tracking for M1 (like other floors)
      m1Transferred: { type: Number, default: 0, min: 0 },
      m1Remaining: { type: Number, default: 0, min: 0 },
      repairStatus: { 
        type: String, 
        enum: Object.values(RepairStatus), 
        default: RepairStatus.NOT_REQUIRED 
      },
      repairRemarks: { type: String, default: '' }
    },
    washing: {
      received: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      remaining: { type: Number, default: 0 },
      transferred: { type: Number, default: 0 }
    },
    boarding: {
      received: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      remaining: { type: Number, default: 0 },
      transferred: { type: Number, default: 0 }
    },
    finalChecking: {
      received: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      remaining: { type: Number, default: 0 },
      transferred: { type: Number, default: 0 },
      // Quality tracking fields for final checking floor
      m1Quantity: { type: Number, default: 0, min: 0 },
      m2Quantity: { type: Number, default: 0, min: 0 },
      m3Quantity: { type: Number, default: 0, min: 0 },
      m4Quantity: { type: Number, default: 0, min: 0 },
      // Additive transfer tracking for M1 (like other floors)
      m1Transferred: { type: Number, default: 0, min: 0 },
      m1Remaining: { type: Number, default: 0, min: 0 },
      repairStatus: { 
        type: String, 
        enum: Object.values(RepairStatus), 
        default: RepairStatus.NOT_REQUIRED 
      },
      repairRemarks: { type: String, default: '' }
    },
    branding: {
      received: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      remaining: { type: Number, default: 0 },
      transferred: { type: Number, default: 0 }
    },
    warehouse: {
      received: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      remaining: { type: Number, default: 0 },
      transferred: { type: Number, default: 0 }
    },
    dispatch: {
      received: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      remaining: { type: Number, default: 0 },
      transferred: { type: Number, default: 0 }
    }
  },
  
  // Quality fields are now floor-specific only
  // Removed article-level quality fields to prevent conflicts between Checking and Final Checking floors
  finalQualityConfirmed: {
    type: Boolean,
    required: false,
    default: false
  },
  
  // Timestamps
  startedAt: {
    type: Date,
    required: false
  },
  completedAt: {
    type: Date,
    required: false
  }
}, {
  timestamps: true,
  collection: 'articles'
});

// Indexes for performance
articleSchema.index({ articleNumber: 1 });
articleSchema.index({ orderId: 1 });
// Removed currentFloor index - using flow-based system
articleSchema.index({ status: 1 });
articleSchema.index({ priority: 1 });
articleSchema.index({ machineId: 1 });
articleSchema.index({ createdAt: -1 });

// Virtual for progress calculation based on floor quantities
articleSchema.virtual('calculatedProgress').get(function() {
  if (this.plannedQuantity === 0) return 0;
  
  // Calculate total completed across all floors
  const floorOrder = [
    'knitting', 'linking', 'checking', 'washing', 
    'boarding', 'finalChecking', 'branding', 'warehouse', 'dispatch'
  ];
  
  let totalCompleted = 0;
  
  // Calculate progress based on work completed across all floors
  // For checking floors, use M1 quantity as the "good" completed work
  // For other floors, use completed quantity
  
  // Find the last floor that has work completed
  let lastActiveFloor = 'knitting';
  for (let i = floorOrder.length - 1; i >= 0; i--) {
    const floorKey = floorOrder[i];
    const floorData = this.floorQuantities[floorKey];
    
    if (floorData && floorData.completed > 0) {
      lastActiveFloor = floorKey;
      break;
    }
  }
  
  const lastActiveFloorIndex = floorOrder.indexOf(lastActiveFloor);
  
  // Add completed work from all floors up to last active floor
  for (let i = 0; i <= lastActiveFloorIndex; i++) {
    const floorKey = floorOrder[i];
    const floorData = this.floorQuantities[floorKey];
    
    if (floorData) {
      if (floorKey === 'checking' || floorKey === 'finalChecking') {
        // For checking floors, use M1 quantity (good quality items)
        totalCompleted += floorData.m1Quantity || 0;
      } else {
        // For other floors, use completed quantity
        totalCompleted += floorData.completed || 0;
      }
    }
  }
  
  // Cap progress at 100%
  const progress = Math.round((totalCompleted / this.plannedQuantity) * 100);
  return Math.min(progress, 100);
});

// Virtual for quality total validation - removed currentFloor dependency
articleSchema.virtual('qualityTotal').get(function() {
  // Quality validation is now floor-specific and doesn't depend on currentFloor
  // This virtual is kept for backward compatibility but logic moved to individual methods
  return 0;
});

// Pre-save middleware to update progress
articleSchema.pre('save', function(next) {
  if (this.isModified('floorQuantities') || this.isModified('plannedQuantity')) {
    this.progress = this.calculatedProgress;
  }
  next();
});

// Pre-save middleware to validate and fix floor data corruption - flow-based system
articleSchema.pre('save', function(next) {
  // Auto-fix corrupted floor data
  this.fixFloorDataCorruption();
  
  // Flow-based validation: Check each floor independently
  const floors = ['knitting', 'linking', 'checking', 'washing', 'boarding', 'finalChecking', 'branding', 'warehouse', 'dispatch'];
  
  floors.forEach(floorKey => {
    const floorData = this.floorQuantities[floorKey];
    if (!floorData) return;
    
    const received = floorData.received || 0;
    const completed = floorData.completed || 0;
    const transferred = floorData.transferred || 0;
    
    // Basic validation: completed and transferred cannot exceed received
    // EXCEPTION: Knitting floor allows overproduction (completed can exceed received)
    if (completed > received && received > 0 && floorKey !== 'knitting') {
      console.warn(`🚨 ${floorKey}: Completed (${completed}) > Received (${received}). Auto-fixing...`);
      floorData.completed = received;
      floorData.remaining = received - transferred;
    }
    
    // Special handling for knitting floor overproduction
    if (floorKey === 'knitting' && completed > received && received > 0) {
      console.log(`🎯 KNITTING OVERPRODUCTION DETECTED: Completed (${completed}) > Received (${received}). Overproduction: ${completed - received}`);
      // Don't auto-fix knitting overproduction - it's allowed
    }
    
    // Transferred validation: cannot exceed received (except knitting floor)
    if (transferred > received && received > 0 && floorKey !== 'knitting') {
      console.warn(`🚨 ${floorKey}: Transferred (${transferred}) > Received (${received}). Auto-fixing...`);
      floorData.transferred = received;
      floorData.remaining = received - completed;
    }
    
    // Special handling for knitting floor transferred overproduction
    if (floorKey === 'knitting' && transferred > received && received > 0) {
      console.log(`🎯 KNITTING TRANSFERRED OVERPRODUCTION: Transferred (${transferred}) > Received (${received}). This is allowed for knitting floor.`);
      // Don't auto-fix knitting transferred overproduction - it's allowed
    }
    
    // Quality validation for checking floors
    if ((floorKey === 'checking' || floorKey === 'finalChecking') && received > 0) {
      const m1Quantity = floorData.m1Quantity || 0;
      const m2Quantity = floorData.m2Quantity || 0;
      const m3Quantity = floorData.m3Quantity || 0;
      const m4Quantity = floorData.m4Quantity || 0;
      const totalQualityQuantity = m1Quantity + m2Quantity + m3Quantity + m4Quantity;
      
      if (totalQualityQuantity > received) {
        console.warn(`🚨 ${floorKey}: Quality total (${totalQualityQuantity}) > Received (${received}). Auto-fixing...`);
        // Scale down quality quantities proportionally
        const scaleFactor = received / totalQualityQuantity;
        floorData.m1Quantity = Math.round(m1Quantity * scaleFactor);
        floorData.m2Quantity = Math.round(m2Quantity * scaleFactor);
        floorData.m3Quantity = Math.round(m3Quantity * scaleFactor);
        floorData.m4Quantity = Math.round(m4Quantity * scaleFactor);
      }
      
      // For checking floors, transferred should not exceed M1 quantity
      const m1Transferred = floorData.m1Transferred || 0;
      if (m1Transferred > m1Quantity && m1Quantity > 0) {
        console.warn(`🚨 ${floorKey}: M1 Transferred (${m1Transferred}) > M1 Quantity (${m1Quantity}). Auto-fixing...`);
        floorData.m1Transferred = m1Quantity;
        floorData.m1Remaining = 0;
        floorData.remaining = 0;
      }
      
      // Update M1 remaining
      floorData.m1Remaining = Math.max(0, m1Quantity - m1Transferred);
    }
    
    // Knitting floor validation
    if (floorKey === 'knitting' && completed > 0) {
      const m4Quantity = floorData.m4Quantity || 0;
      if (m4Quantity > completed) {
        console.warn(`🚨 ${floorKey}: M4 (${m4Quantity}) > Completed (${completed}). Auto-fixing...`);
        floorData.m4Quantity = completed;
      }
    }
  });
  
  next();
});

// Pre-save middleware to initialize floor quantities for new articles
articleSchema.pre('save', function(next) {
  if (this.isNew) {
    // Initialize floor quantities if not already set
    if (!this.floorQuantities.knitting.received && this.plannedQuantity > 0) {
      this.initializeWithPlannedQuantity();
    }
  }
  next();
});

// Helper method to get floor key from ProductionFloor enum
articleSchema.methods.getFloorKey = function(floor) {
  const floorMap = {
    [ProductionFloor.KNITTING]: 'knitting',
    [ProductionFloor.LINKING]: 'linking',
    [ProductionFloor.CHECKING]: 'checking',
    [ProductionFloor.WASHING]: 'washing',
    [ProductionFloor.BOARDING]: 'boarding',
    [ProductionFloor.FINAL_CHECKING]: 'finalChecking',
    [ProductionFloor.BRANDING]: 'branding',
    [ProductionFloor.WAREHOUSE]: 'warehouse',
    [ProductionFloor.DISPATCH]: 'dispatch'
  };
  return floorMap[floor];
};

// Helper method to get floor order based on linking type
articleSchema.methods.getFloorOrderByLinkingType = function() {
  if (this.linkingType === LinkingType.AUTO_LINKING) {
    // Auto Linking: Skip linking floor
    return [
      ProductionFloor.KNITTING,
      ProductionFloor.CHECKING,
      ProductionFloor.WASHING,
      ProductionFloor.BOARDING,
      ProductionFloor.FINAL_CHECKING,
      ProductionFloor.BRANDING,
      ProductionFloor.WAREHOUSE,
      ProductionFloor.DISPATCH
    ];
  } else {
    // Hand Linking and Rosso Linking: Include linking floor
    return [
      ProductionFloor.KNITTING,
      ProductionFloor.LINKING,
      ProductionFloor.CHECKING,
      ProductionFloor.WASHING,
      ProductionFloor.BOARDING,
      ProductionFloor.FINAL_CHECKING,
      ProductionFloor.BRANDING,
      ProductionFloor.WAREHOUSE,
      ProductionFloor.DISPATCH
    ];
  }
};

// Method to update completed quantity for any floor with overproduction support
articleSchema.methods.updateCompletedQuantity = async function(floor, newQuantity, userId, floorSupervisorId, remarks, machineId, shiftId) {
  const floorKey = this.getFloorKey(floor);
  const floorData = this.floorQuantities[floorKey];
  
  if (!floorData) {
    throw new Error(`Invalid floor: ${floor}`);
  }
  
  // Special handling for knitting floor - allow overproduction
  if (floor === ProductionFloor.KNITTING) {
    if (newQuantity < 0) {
      throw new Error('Quantity cannot be negative');
    }
    // Allow overproduction in knitting (newQuantity can exceed received)
    // This is normal behavior - machines can produce more than planned
    if (newQuantity > floorData.received) {
      const overproduction = newQuantity - floorData.received;
      console.log(`🎯 KNITTING OVERPRODUCTION: Received ${floorData.received}, Completed ${newQuantity}, Overproduction: ${overproduction}`);
    }
  } else if (floor === ProductionFloor.CHECKING || floor === ProductionFloor.FINAL_CHECKING) {
    // For checking floors, validate against received quantity
    if (newQuantity < 0 || newQuantity > floorData.received) {
      throw new Error(`Invalid quantity: must be between 0 and received quantity (${floorData.received})`);
    }
    // For checking floors, completed quantity should match total quality quantities
    const totalQualityQuantity = (floorData.m1Quantity || 0) + (floorData.m2Quantity || 0) + 
                                 (floorData.m3Quantity || 0) + (floorData.m4Quantity || 0);
    if (totalQualityQuantity > 0 && newQuantity !== totalQualityQuantity) {
      console.warn(`Warning: Completed quantity (${newQuantity}) doesn't match total quality quantities (${totalQualityQuantity})`);
    }
  } else {
    // For other floors, validate against received quantity
    if (newQuantity < 0 || newQuantity > floorData.received) {
      throw new Error(`Invalid quantity: must be between 0 and received quantity (${floorData.received})`);
    }
  }
  
  const previousQuantity = floorData.completed;
  floorData.completed = newQuantity;
  
  // Calculate remaining quantity - handle overproduction
  if (floor === ProductionFloor.KNITTING && newQuantity > floorData.received) {
    // Overproduction scenario: show 0 instead of negative remaining
    floorData.remaining = 0;
    console.log(`🎯 KNITTING OVERPRODUCTION: Remaining set to 0 (overproduction: ${newQuantity - floorData.received})`);
  } else {
    // Normal scenario
    floorData.remaining = Math.max(0, floorData.received - newQuantity);
  }
  
  // Update progress based on floor quantities
  this.progress = this.calculatedProgress;
  
  if (remarks) {
    this.remarks = remarks;
  }
  
  // Create log entry for quantity update
  try {
    await ArticleLog.createLogEntry({
      articleId: this._id.toString(),
      orderId: this.orderId.toString(),
      action: 'Quantity Updated',
      quantity: newQuantity - previousQuantity,
      remarks: remarks || `Completed ${newQuantity} units on ${floor} floor (${floorData.remaining} remaining)`,
      previousValue: previousQuantity,
      newValue: newQuantity,
      changeReason: 'Production progress update',
      userId: userId || 'system',
      floorSupervisorId: floorSupervisorId || 'system',
      machineId,
      shiftId
    });
  } catch (logError) {
    console.error('Error creating quantity update log:', logError);
    // Don't throw error for logging failure, just log it
  }
  
  return {
    floor: floor,
    previousQuantity,
    newQuantity,
    deltaQuantity: newQuantity - previousQuantity,
    remaining: floorData.remaining,
    isOverproduction: floor === ProductionFloor.KNITTING && newQuantity > floorData.received,
    overproductionAmount: floor === ProductionFloor.KNITTING && newQuantity > floorData.received ? newQuantity - floorData.received : 0
  };
};

// Method to update completed quantity with quality tracking for checking floors
articleSchema.methods.updateCompletedQuantityWithQuality = updateCompletedQuantityWithQuality;

// Method to update M4 quantity for knitting floor
articleSchema.methods.updateKnittingM4Quantity = updateKnittingM4Quantity;


// Method to initialize article with planned quantity on first floor
articleSchema.methods.initializeWithPlannedQuantity = function() {
  // Set the planned quantity as received on knitting floor
  this.floorQuantities.knitting.received = this.plannedQuantity;
  this.floorQuantities.knitting.remaining = this.plannedQuantity;
  
  return {
    floor: ProductionFloor.KNITTING,
    received: this.plannedQuantity,
    remaining: this.plannedQuantity
  };
};

// Method to transfer from any floor to next floor - flow-based system
articleSchema.methods.transferFromFloor = async function(fromFloor, quantity, userId, floorSupervisorId, remarks, batchNumber) {
  // Get floor order based on linking type
  const floorOrder = this.getFloorOrderByLinkingType();
  
  const fromFloorIndex = floorOrder.indexOf(fromFloor);
  if (fromFloorIndex === -1 || fromFloorIndex === floorOrder.length - 1) {
    throw new Error(`Cannot transfer from ${fromFloor} floor`);
  }
  
  const fromFloorKey = this.getFloorKey(fromFloor);
  const fromFloorData = this.floorQuantities[fromFloorKey];
  
  if (!fromFloorData) {
    throw new Error(`No data found for ${fromFloor} floor`);
  }
  
  // Validate transfer quantity based on floor type
  if (fromFloor === ProductionFloor.KNITTING) {
    // For knitting, allow transfer up to completed quantity (including overproduction)
    if (quantity > fromFloorData.completed) {
      throw new Error(`Transfer quantity (${quantity}) cannot exceed completed quantity (${fromFloorData.completed}) on ${fromFloor} floor`);
    }
    // Note: Transfer quantity can exceed received quantity due to overproduction - this is normal
    console.log(`🎯 KNITTING TRANSFER: Transferring ${quantity} units (completed: ${fromFloorData.completed}, received: ${fromFloorData.received})`);
  } else if (fromFloor === ProductionFloor.CHECKING || fromFloor === ProductionFloor.FINAL_CHECKING) {
    // For checking floors, validate against M1 quantity (good quality items)
    const m1Quantity = fromFloorData.m1Quantity || 0;
    const m1Transferred = fromFloorData.m1Transferred || 0;
    const m1Remaining = m1Quantity - m1Transferred;
    
    if (quantity > m1Remaining) {
      throw new Error(`Transfer quantity (${quantity}) cannot exceed remaining M1 quantity (${m1Remaining}) on ${fromFloor} floor`);
    }
    
    // If no quantity specified, transfer all remaining M1 quantity
    if (!quantity) {
      quantity = m1Remaining;
    }
    
    // Additional validation: Ensure quality inspection has been completed
    const m2Quantity = fromFloorData.m2Quantity || 0;
    const m3Quantity = fromFloorData.m3Quantity || 0;
    const m4Quantity = fromFloorData.m4Quantity || 0;
    const totalQualityQuantity = m1Quantity + m2Quantity + m3Quantity + m4Quantity;
    
    // If quality quantities don't match completed quantity, require quality inspection first
    if (totalQualityQuantity !== fromFloorData.completed && fromFloorData.completed > 0) {
      throw new Error(`Quality inspection incomplete. Completed: ${fromFloorData.completed}, Quality total: ${totalQualityQuantity}. Please complete quality inspection before transfer.`);
    }
    
    // Warn about defects that won't be transferred
    const totalDefects = m2Quantity + m3Quantity + m4Quantity;
    
    if (totalDefects > 0) {
      console.warn(`Transferring ${quantity} good quality items from ${fromFloor} floor. ${totalDefects} defective items (M2: ${m2Quantity}, M3: ${m3Quantity}, M4: ${m4Quantity}) will remain for repair/rejection`);
    }
  } else {
    // For other floors, validate against completed quantity
    if (quantity > fromFloorData.completed) {
      throw new Error(`Transfer quantity (${quantity}) cannot exceed completed quantity (${fromFloorData.completed}) on ${fromFloor} floor`);
    }
    
    if (quantity > fromFloorData.remaining) {
      throw new Error(`Transfer quantity (${quantity}) cannot exceed remaining quantity (${fromFloorData.remaining}) on ${fromFloor} floor`);
    }
  }
  
  const nextFloor = floorOrder[fromFloorIndex + 1];
  const nextFloorKey = this.getFloorKey(nextFloor);
  const nextFloorData = this.floorQuantities[nextFloorKey];
  
  // Update from floor: mark as transferred (additive for checking floors)
  if (fromFloor === ProductionFloor.CHECKING || fromFloor === ProductionFloor.FINAL_CHECKING) {
    // For checking floors, update M1 transferred additively
    fromFloorData.m1Transferred = (fromFloorData.m1Transferred || 0) + quantity;
    fromFloorData.m1Remaining = Math.max(0, (fromFloorData.m1Quantity || 0) - fromFloorData.m1Transferred);
    
    // Also update general transferred field additively
    fromFloorData.transferred = (fromFloorData.transferred || 0) + quantity;
  } else {
    // For other floors, update transferred additively
    fromFloorData.transferred += quantity;
  }
  
  // Calculate remaining - handle overproduction for knitting floor
  if (fromFloor === ProductionFloor.KNITTING) {
    // For knitting floor, remaining should never go negative due to overproduction
    // If completed > received (overproduction), remaining should be 0
    fromFloorData.remaining = Math.max(0, fromFloorData.received - fromFloorData.transferred);
    console.log(`🎯 KNITTING REMAINING: Received ${fromFloorData.received}, Transferred ${fromFloorData.transferred}, Remaining ${fromFloorData.remaining}`);
  } else if (fromFloor === ProductionFloor.CHECKING || fromFloor === ProductionFloor.FINAL_CHECKING) {
    // For checking floors, remaining is based on M1 remaining
    fromFloorData.remaining = fromFloorData.m1Remaining;
  } else {
    // For other floors, normal calculation
    fromFloorData.remaining -= quantity;
  }
  
  // For checking and finalChecking floors, ensure completed equals transferred
  // This fixes the issue where items are transferred without being marked as completed
  if (fromFloor === ProductionFloor.CHECKING || fromFloor === ProductionFloor.FINAL_CHECKING) {
    if (fromFloorData.completed < fromFloorData.transferred) {
      fromFloorData.completed = fromFloorData.transferred;
    }
  }
  
  // Update next floor: mark as received
  // For knitting floor overproduction, transfer the full completed amount (including excess)
  if (fromFloor === ProductionFloor.KNITTING) {
    // KNITTING OVERPRODUCTION: Transfer full completed amount (including overproduction)
    nextFloorData.received = fromFloorData.completed;
    console.log(`🎯 KNITTING MODEL TRANSFER: Transferring ${fromFloorData.completed} units (including overproduction) to ${nextFloor}`);
  } else {
    // Other floors: normal additive transfer
    nextFloorData.received += quantity;
  }
  nextFloorData.remaining = nextFloorData.received - (nextFloorData.completed || 0);
  
  // Ensure next floor quantities are consistent
  if (nextFloorData.completed > nextFloorData.received) {
    nextFloorData.completed = nextFloorData.received;
  }
  
  if (remarks) {
    this.remarks = remarks;
  }
  
  // Create log entry for floor transfer
  try {
    let transferRemarks = remarks || `Article ${this.articleNumber}: ${quantity} units transferred from ${fromFloor} to ${nextFloor} (${fromFloorData.remaining} remaining on ${fromFloor})`;
    
    // Add quality information for checking floor transfers
    if (fromFloor === ProductionFloor.CHECKING || fromFloor === ProductionFloor.FINAL_CHECKING) {
      const m1Quantity = fromFloorData.m1Quantity || 0;
      const m1Transferred = fromFloorData.m1Transferred || 0;
      const m1Remaining = fromFloorData.m1Remaining || 0;
      const m2Quantity = fromFloorData.m2Quantity || 0;
      const m3Quantity = fromFloorData.m3Quantity || 0;
      const m4Quantity = fromFloorData.m4Quantity || 0;
      const totalDefects = m2Quantity + m3Quantity + m4Quantity;
      
      transferRemarks += ` | Quality: M1 Total: ${m1Quantity}, M1 Transferred: ${m1Transferred}, M1 Remaining: ${m1Remaining}, Defects: M2: ${m2Quantity}, M3: ${m3Quantity}, M4: ${m4Quantity}`;
    }
    
    await ArticleLog.createLogEntry({
      articleId: this._id.toString(),
      orderId: this.orderId.toString(),
      action: `Transferred from ${fromFloor} to ${nextFloor}`,
      quantity,
      fromFloor: fromFloor,
      toFloor: nextFloor,
      remarks: transferRemarks,
      previousValue: fromFloor,
      newValue: nextFloor,
      changeReason: 'Floor transfer',
      userId: userId || 'system',
      floorSupervisorId: floorSupervisorId || 'system',
      batchNumber
    });
  } catch (logError) {
    console.error('Error creating transfer log:', logError);
    // Don't throw error for logging failure, just log it
  }
  
  return {
    fromFloor: fromFloor,
    toFloor: nextFloor,
    quantity,
    fromFloorRemaining: fromFloorData.remaining,
    nextFloorReceived: nextFloorData.received
  };
};

// Method to transfer M1 quantity from checking floors - additive transfers
articleSchema.methods.transferM1FromFloor = async function(fromFloor, quantity, userId, floorSupervisorId, remarks, batchNumber) {
  if (fromFloor !== ProductionFloor.CHECKING && fromFloor !== ProductionFloor.FINAL_CHECKING) {
    throw new Error('M1 transfer is only available for Checking and Final Checking floors');
  }
  
  const fromFloorKey = this.getFloorKey(fromFloor);
  const fromFloorData = this.floorQuantities[fromFloorKey];
  
  if (!fromFloorData) {
    throw new Error(`No data found for ${fromFloor} floor`);
  }
  
  const m1Quantity = fromFloorData.m1Quantity || 0;
  const m1Transferred = fromFloorData.m1Transferred || 0;
  const m1Remaining = m1Quantity - m1Transferred;
  
  // Validate transfer quantity
  if (quantity > m1Remaining) {
    throw new Error(`Transfer quantity (${quantity}) cannot exceed remaining M1 quantity (${m1Remaining}) on ${fromFloor} floor`);
  }
  
  // If no quantity specified, transfer all remaining M1 quantity
  if (!quantity) {
    quantity = m1Remaining;
  }
  
  // Get floor order based on linking type
  const floorOrder = this.getFloorOrderByLinkingType();
  const fromFloorIndex = floorOrder.indexOf(fromFloor);
  
  if (fromFloorIndex === -1 || fromFloorIndex === floorOrder.length - 1) {
    throw new Error(`Cannot transfer from ${fromFloor} floor`);
  }
  
  const nextFloor = floorOrder[fromFloorIndex + 1];
  const nextFloorKey = this.getFloorKey(nextFloor);
  const nextFloorData = this.floorQuantities[nextFloorKey];
  
  // Update from floor: mark M1 as transferred (additive)
  fromFloorData.m1Transferred = m1Transferred + quantity;
  fromFloorData.m1Remaining = Math.max(0, m1Quantity - fromFloorData.m1Transferred);
  
  // Also update general transferred field (additive)
  fromFloorData.transferred = (fromFloorData.transferred || 0) + quantity;
  
  // Update remaining quantity
  fromFloorData.remaining = fromFloorData.m1Remaining;
  
  // Update next floor: mark as received (additive)
  nextFloorData.received = (nextFloorData.received || 0) + quantity;
  nextFloorData.remaining = nextFloorData.received - (nextFloorData.completed || 0);
  
  if (remarks) {
    this.remarks = remarks;
  }
  
  // Create log entry for M1 transfer
  try {
    const transferRemarks = remarks || `Article ${this.articleNumber}: ${quantity} M1 units transferred from ${fromFloor} to ${nextFloor} (${fromFloorData.m1Remaining} M1 remaining on ${fromFloor})`;
    
    await ArticleLog.createLogEntry({
      articleId: this._id.toString(),
      orderId: this.orderId.toString(),
      action: `M1 Transferred from ${fromFloor} to ${nextFloor}`,
      quantity,
      fromFloor: fromFloor,
      toFloor: nextFloor,
      remarks: transferRemarks,
      previousValue: m1Transferred,
      newValue: fromFloorData.m1Transferred,
      changeReason: 'M1 quality transfer',
      userId: userId || 'system',
      floorSupervisorId: floorSupervisorId || 'system',
      batchNumber
    });
  } catch (logError) {
    console.error('Error creating M1 transfer log:', logError);
    // Don't throw error for logging failure, just log it
  }
  
  return {
    fromFloor: fromFloor,
    toFloor: nextFloor,
    quantity,
    m1Transferred: fromFloorData.m1Transferred,
    m1Remaining: fromFloorData.m1Remaining,
    nextFloorReceived: nextFloorData.received
  };
};

// Method to update quality categories (Checking and Final Checking floors)
articleSchema.methods.updateQualityCategories = updateQualityCategories;

// Method to shift M2 items to other categories
articleSchema.methods.shiftM2Items = shiftM2Items;

// Method to confirm final quality
articleSchema.methods.confirmFinalQuality = confirmFinalQuality;

// Method to update quality inspection (bulk quality update)
articleSchema.methods.updateQualityInspection = updateQualityInspection;

// Method to fix completion status for checking floors
articleSchema.methods.fixCompletionStatus = function() {
  const floorsToFix = ['checking', 'finalChecking'];
  let fixed = false;
  
  floorsToFix.forEach(floorKey => {
    const floorData = this.floorQuantities[floorKey];
    if (floorData && floorData.transferred > 0 && floorData.completed < floorData.transferred) {
      floorData.completed = floorData.transferred;
      fixed = true;
      console.log(`Fixed completion status for ${floorKey}: completed=${floorData.completed}, transferred=${floorData.transferred}`);
    }
  });
  
  if (fixed) {
    // Update progress after fixing
    this.progress = this.calculatedProgress;
  }
  
  return fixed;
};

// Method to fix data inconsistencies in checking floor transfers
articleSchema.methods.fixCheckingFloorDataConsistency = function() {
  const checkingFloorData = this.floorQuantities.checking;
  if (!checkingFloorData) {
    return { fixed: false, message: 'No checking floor data found' };
  }
  
  const m1Quantity = checkingFloorData.m1Quantity || 0;
  const transferred = checkingFloorData.transferred || 0;
  const completed = checkingFloorData.completed || 0;
  const received = checkingFloorData.received || 0;
  
  let fixes = [];
  
  // Fix 1: If transferred > M1, adjust transferred to M1
  if (transferred > m1Quantity && m1Quantity > 0) {
    const oldTransferred = transferred;
    checkingFloorData.transferred = m1Quantity;
    checkingFloorData.remaining = received - checkingFloorData.transferred;
    fixes.push(`Reduced transferred from ${oldTransferred} to ${m1Quantity} (M1 quantity)`);
  }
  
  // Fix 2: If completed < transferred, set completed = transferred
  if (completed < checkingFloorData.transferred) {
    const oldCompleted = completed;
    checkingFloorData.completed = checkingFloorData.transferred;
    fixes.push(`Updated completed from ${oldCompleted} to ${checkingFloorData.transferred}`);
  }
  
  // Fix 3: If received doesn't match expected (should be from previous floor transfer)
  const knittingTransferred = this.floorQuantities.knitting?.transferred || 0;
  if (received !== knittingTransferred && knittingTransferred > 0) {
    const oldReceived = received;
    checkingFloorData.received = knittingTransferred;
    checkingFloorData.remaining = checkingFloorData.received - checkingFloorData.transferred;
    fixes.push(`Fixed received from ${oldReceived} to ${knittingTransferred} (from knitting transfer)`);
  }
  
  // Fix 4: If quality quantities don't match completed, warn
  const m2Quantity = checkingFloorData.m2Quantity || 0;
  const m3Quantity = checkingFloorData.m3Quantity || 0;
  const m4Quantity = checkingFloorData.m4Quantity || 0;
  const totalQualityQuantity = m1Quantity + m2Quantity + m3Quantity + m4Quantity;
  
  if (totalQualityQuantity !== checkingFloorData.completed && checkingFloorData.completed > 0) {
    fixes.push(`WARNING: Quality quantities (${totalQualityQuantity}) don't match completed (${checkingFloorData.completed}). Quality inspection may be incomplete.`);
  }
  
  if (fixes.length > 0) {
    // Update progress after fixing
    this.progress = this.calculatedProgress;
    return { 
      fixed: true, 
      fixes,
      updatedData: {
        received: checkingFloorData.received,
        transferred: checkingFloorData.transferred,
        completed: checkingFloorData.completed,
        remaining: checkingFloorData.remaining
      }
    };
  }
  
  return { fixed: false, message: 'No inconsistencies found' };
};

// Method to fix floor data corruption automatically
articleSchema.methods.fixFloorDataCorruption = function() {
  const floors = ['knitting', 'linking', 'checking', 'washing', 'boarding', 'finalChecking', 'branding', 'warehouse', 'dispatch'];
  let fixes = [];
  
  // Fix each floor's data consistency
  floors.forEach(floorKey => {
    const floorData = this.floorQuantities[floorKey];
    if (!floorData) return;
    
    const received = floorData.received || 0;
    const completed = floorData.completed || 0;
    const transferred = floorData.transferred || 0;
    const remaining = floorData.remaining || 0;
    
    // Fix 1: Transferred cannot exceed received (except knitting floor)
    if (transferred > received && received > 0 && floorKey !== 'knitting') {
      const oldTransferred = transferred;
      floorData.transferred = received;
      floorData.remaining = received - completed;
      fixes.push(`${floorKey}: reduced transferred from ${oldTransferred} to ${received}`);
    }
    
    // Special handling for knitting floor transferred overproduction in corruption fix
    if (floorKey === 'knitting' && transferred > received && received > 0) {
      console.log(`🎯 KNITTING TRANSFERRED OVERPRODUCTION IN CORRUPTION FIX: Transferred (${transferred}) > Received (${received}). This is allowed for knitting floor.`);
      // Don't fix knitting transferred overproduction - it's allowed
    }
    
    // Fix 2: Completed cannot exceed received (except knitting floor)
    if (completed > received && received > 0 && floorKey !== 'knitting') {
      const oldCompleted = completed;
      floorData.completed = received;
      floorData.remaining = received - transferred;
      fixes.push(`${floorKey}: reduced completed from ${oldCompleted} to ${received}`);
    }
    
    // Special handling for knitting floor overproduction in corruption fix
    if (floorKey === 'knitting' && completed > received && received > 0) {
      console.log(`🎯 KNITTING OVERPRODUCTION IN CORRUPTION FIX: Completed (${completed}) > Received (${received}). Overproduction: ${completed - received}. Allowing overproduction.`);
      // Don't fix knitting overproduction - it's allowed
    }
    
    // Fix 3: Remaining calculation - handle overproduction for knitting floor
    let expectedRemaining;
    if (floorKey === 'knitting') {
      // For knitting floor, remaining should never go negative due to overproduction
      expectedRemaining = Math.max(0, received - completed);
    } else {
      // For other floors, normal calculation
      expectedRemaining = Math.max(0, received - completed);
    }
    
    if (floorData.remaining !== expectedRemaining) {
      const oldRemaining = floorData.remaining;
      floorData.remaining = expectedRemaining;
      fixes.push(`${floorKey}: fixed remaining from ${oldRemaining} to ${expectedRemaining}`);
    }
    
    // Fix 4: For checking floors, ensure quality quantities don't exceed received
    if ((floorKey === 'checking' || floorKey === 'finalChecking') && received > 0) {
      const m1Quantity = floorData.m1Quantity || 0;
      const m2Quantity = floorData.m2Quantity || 0;
      const m3Quantity = floorData.m3Quantity || 0;
      const m4Quantity = floorData.m4Quantity || 0;
      const totalQuality = m1Quantity + m2Quantity + m3Quantity + m4Quantity;
      
      if (totalQuality > received) {
        // Scale down quality quantities proportionally
        const scaleFactor = received / totalQuality;
        floorData.m1Quantity = Math.round(m1Quantity * scaleFactor);
        floorData.m2Quantity = Math.round(m2Quantity * scaleFactor);
        floorData.m3Quantity = Math.round(m3Quantity * scaleFactor);
        floorData.m4Quantity = Math.round(m4Quantity * scaleFactor);
        fixes.push(`${floorKey}: scaled down quality quantities to fit received quantity`);
      }
    }
  });
  
  if (fixes.length > 0) {
    console.log(`🔧 Auto-fixed floor data corruption: ${fixes.join(', ')}`);
    // Update progress after fixing
    this.progress = this.calculatedProgress;
  }
  
  return fixes.length > 0;
};

// Method to fix all floor data inconsistencies
articleSchema.methods.fixAllFloorDataConsistency = function() {
  const floors = ['knitting', 'linking', 'checking', 'washing', 'boarding', 'finalChecking', 'branding', 'warehouse', 'dispatch'];
  let allFixes = [];
  let totalFixed = 0;
  
  // Fix checking floor first (most critical)
  const checkingFix = this.fixCheckingFloorDataConsistency();
  if (checkingFix.fixed) {
    allFixes.push(`Checking Floor: ${checkingFix.fixes.join(', ')}`);
    totalFixed++;
  }
  
  // Fix washing floor data corruption
  const washingFloorData = this.floorQuantities.washing;
  const checkingFloorData = this.floorQuantities.checking;
  if (washingFloorData && checkingFloorData) {
    const washingReceived = washingFloorData.received || 0;
    const checkingTransferred = checkingFloorData.transferred || 0;
    const washingCompleted = washingFloorData.completed || 0;
    const washingTransferred = washingFloorData.transferred || 0;
    const washingRemaining = washingFloorData.remaining || 0;
    
    let washingFixes = [];
    
    // CRITICAL FIX: If washing received more than checking transferred, it's corruption
    if (washingReceived > checkingTransferred && checkingTransferred > 0) {
      const oldWashingReceived = washingReceived;
      washingFloorData.received = checkingTransferred;
      washingFloorData.remaining = washingFloorData.received - washingTransferred;
      washingFixes.push(`🚨 CRITICAL: Fixed washing received from ${oldWashingReceived} to ${checkingTransferred} (checking transferred)`);
    }
    
    // Fix: If completed > received, set completed = received
    if (washingCompleted > washingFloorData.received && washingFloorData.received > 0) {
      washingFloorData.completed = washingFloorData.received;
      washingFloorData.remaining = washingFloorData.received - washingTransferred;
      washingFixes.push(`Fixed completed from ${washingCompleted} to ${washingFloorData.received}`);
    }
    
    // Fix: If remaining calculation is wrong, recalculate
    const expectedRemaining = washingFloorData.received - washingTransferred;
    if (washingFloorData.remaining !== expectedRemaining) {
      washingFloorData.remaining = expectedRemaining;
      washingFixes.push(`Fixed remaining from ${washingRemaining} to ${expectedRemaining}`);
    }
    
    // Fix: If transferred > received, adjust transferred
    if (washingTransferred > washingFloorData.received && washingFloorData.received > 0) {
      washingFloorData.transferred = washingFloorData.received;
      washingFloorData.remaining = 0;
      washingFixes.push(`Reduced transferred from ${washingTransferred} to ${washingFloorData.received}`);
    }
    
    if (washingFixes.length > 0) {
      allFixes.push(`Washing Floor: ${washingFixes.join(', ')}`);
      totalFixed++;
    }
  }
  
  // Flow-based validation: Ensure data consistency between floors
  const knittingTransferred = this.floorQuantities.knitting?.transferred || 0;
  const checkingReceived = this.floorQuantities.checking?.received || 0;
  
  if (knittingTransferred > 0 && checkingReceived !== knittingTransferred) {
    // Fix checking floor received to match knitting transferred
    const oldCheckingReceived = checkingReceived;
    this.floorQuantities.checking.received = knittingTransferred;
    this.floorQuantities.checking.remaining = knittingTransferred - (this.floorQuantities.checking.transferred || 0);
    allFixes.push(`Fixed checking received from ${oldCheckingReceived} to ${knittingTransferred} (from knitting transfer)`);
    totalFixed++;
  }
  
  if (allFixes.length > 0) {
    // Update progress after fixing
    this.progress = this.calculatedProgress;
    return { 
      fixed: true, 
      totalFixed,
      fixes: allFixes,
      updatedData: {
        checking: this.floorQuantities.checking,
        washing: this.floorQuantities.washing
      }
    };
  }
  
  return { fixed: false, message: 'No inconsistencies found' };
};

// Method to get the current active floor based on work progress - flow-based system
articleSchema.methods.getCurrentActiveFloor = function() {
  const floorOrder = this.getFloorOrderByLinkingType();
  
  // Find the last floor that has work in progress (completed > 0)
  for (let i = floorOrder.length - 1; i >= 0; i--) {
    const floor = floorOrder[i];
    const floorKey = this.getFloorKey(floor);
    const floorData = this.floorQuantities[floorKey];
    
    if (floorData && floorData.completed > 0) {
      return floor;
    }
  }
  
  // If no work completed, return knitting floor
  return ProductionFloor.KNITTING;
};

// Emergency method to fix transferred quantity corruption
articleSchema.methods.fixTransferredQuantityCorruption = function() {
  const checkingFloorData = this.floorQuantities.checking;
  if (!checkingFloorData) {
    return { fixed: false, message: 'No checking floor data found' };
  }
  
  const m1Quantity = checkingFloorData.m1Quantity || 0;
  const transferredQuantity = checkingFloorData.transferred || 0;
  const receivedQuantity = checkingFloorData.received || 0;
  
  let fixes = [];
  
  // Fix 1: If transferred > M1, set transferred = M1
  if (transferredQuantity > m1Quantity && m1Quantity > 0) {
    const oldTransferred = transferredQuantity;
    checkingFloorData.transferred = m1Quantity;
    checkingFloorData.remaining = receivedQuantity - m1Quantity;
    fixes.push(`🚨 CRITICAL FIX: Reduced transferred from ${oldTransferred} to ${m1Quantity} (M1 quantity)`);
  }
  
  // Fix 2: If transferred > received, set transferred = received
  if (checkingFloorData.transferred > receivedQuantity && receivedQuantity > 0) {
    const oldTransferred = checkingFloorData.transferred;
    checkingFloorData.transferred = receivedQuantity;
    checkingFloorData.remaining = 0;
    fixes.push(`🚨 CRITICAL FIX: Reduced transferred from ${oldTransferred} to ${receivedQuantity} (received quantity)`);
  }
  
  // Fix 3: Ensure completed >= transferred
  if (checkingFloorData.completed < checkingFloorData.transferred) {
    const oldCompleted = checkingFloorData.completed;
    checkingFloorData.completed = checkingFloorData.transferred;
    fixes.push(`Fixed completed from ${oldCompleted} to ${checkingFloorData.transferred}`);
  }
  
  // Fix 4: Recalculate remaining
  const expectedRemaining = receivedQuantity - checkingFloorData.transferred;
  if (checkingFloorData.remaining !== expectedRemaining) {
    const oldRemaining = checkingFloorData.remaining;
    checkingFloorData.remaining = expectedRemaining;
    fixes.push(`Fixed remaining from ${oldRemaining} to ${expectedRemaining}`);
  }
  
  if (fixes.length > 0) {
    // Update progress after fixing
    this.progress = this.calculatedProgress;
    return { 
      fixed: true, 
      fixes,
      corruptionDetected: true,
      updatedData: {
        received: checkingFloorData.received,
        transferred: checkingFloorData.transferred,
        completed: checkingFloorData.completed,
        remaining: checkingFloorData.remaining,
        m1Quantity: checkingFloorData.m1Quantity
      }
    };
  }
  
  return { fixed: false, message: 'No corruption found' };
};

// Static method to get articles by floor - flow-based system
articleSchema.statics.getArticlesByFloor = function(floor, options = {}) {
  // Since we removed currentFloor, we need to find articles that have work on the specified floor
  const query = {};
  
  // Check if the floor has any work (received, completed, or transferred > 0)
  const floorKey = this.prototype.getFloorKey(floor);
  query[`floorQuantities.${floorKey}.received`] = { $gt: 0 };
  
  if (options.status) {
    query.status = options.status;
  }
  if (options.priority) {
    query.priority = options.priority;
  }
  if (options.search) {
    query.$or = [
      { articleNumber: { $regex: options.search, $options: 'i' } },
      { remarks: { $regex: options.search, $options: 'i' } }
    ];
  }
  
  return this.find(query)
    .sort({ priority: 1, createdAt: -1 })
    .limit(options.limit || 50)
    .skip(options.offset || 0);
};

// Method to get floor-specific status
articleSchema.methods.getFloorStatus = function(floor) {
  const floorKey = this.getFloorKey(floor);
  const floorData = this.floorQuantities[floorKey];
  
  if (!floorData) {
    return null;
  }
  
  const status = {
    floor,
    received: floorData.received,
    completed: floorData.completed,
    remaining: floorData.remaining,
    transferred: floorData.transferred,
    completionRate: floorData.received > 0 ? Math.round((floorData.completed / floorData.received) * 100) : 0
  };
  
  // Add M4 quantity for knitting floor
  if (floor === ProductionFloor.KNITTING && floorData.m4Quantity !== undefined) {
    status.m4Quantity = floorData.m4Quantity;
    status.goodQuantity = floorData.completed - (floorData.m4Quantity || 0);
  }
  
  return status;
};

// Method to get all floor statuses
articleSchema.methods.getAllFloorStatuses = function() {
  const floors = Object.values(ProductionFloor);
  return floors.map(floor => this.getFloorStatus(floor)).filter(status => status !== null);
};

// Static method to get articles by order
articleSchema.statics.getArticlesByOrder = function(orderId) {
  return this.find({ orderId })
    .populate('machineId', 'machineCode machineNumber model floor status capacityPerShift capacityPerDay assignedSupervisor')
    .sort({ createdAt: 1 });
};

// Static method to get articles by machine - flow-based system
articleSchema.statics.getArticlesByMachine = function(machineId, options = {}) {
  const query = { machineId };
  
  if (options.status) {
    query.status = options.status;
  }
  if (options.floor) {
    // Check if the floor has any work (received, completed, or transferred > 0)
    const floorKey = this.prototype.getFloorKey(options.floor);
    query[`floorQuantities.${floorKey}.received`] = { $gt: 0 };
  }
  if (options.priority) {
    query.priority = options.priority;
  }
  
  return this.find(query)
    .populate('machineId', 'machineCode machineNumber model floor status capacityPerShift capacityPerDay assignedSupervisor')
    .sort({ priority: 1, createdAt: -1 })
    .limit(options.limit || 50)
    .skip(options.offset || 0);
};

export default mongoose.model('Article', articleSchema);