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
  currentFloor: {
    type: String,
    required: true,
    enum: Object.values(ProductionFloor),
    default: ProductionFloor.KNITTING
  },
  
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
articleSchema.index({ currentFloor: 1 });
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
  
  // FIXED: Calculate progress based on work completed across all floors
  // For checking floors, use M1 quantity as the "good" completed work
  // For other floors, use completed quantity
  
  const currentFloorKey = this.getFloorKey(this.currentFloor);
  const currentFloorIndex = floorOrder.indexOf(currentFloorKey);
  
  // Add completed work from all floors up to current floor
  for (let i = 0; i <= currentFloorIndex; i++) {
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

// Virtual for quality total validation
articleSchema.virtual('qualityTotal').get(function() {
  const floorKey = this.getFloorKey(this.currentFloor);
  const floorData = this.floorQuantities[floorKey];
  
  if (floorData && (this.currentFloor === ProductionFloor.KNITTING)) {
    // For knitting floor, only track M4 (defect quantity)
    return (floorData.m4Quantity || 0);
  }
  
  if (floorData && (this.currentFloor === ProductionFloor.CHECKING || this.currentFloor === ProductionFloor.FINAL_CHECKING)) {
    return (floorData.m1Quantity || 0) + (floorData.m2Quantity || 0) + (floorData.m3Quantity || 0) + (floorData.m4Quantity || 0);
  }
  
  // No fallback needed - quality fields are now floor-specific only
  return 0;
});

// Pre-save middleware to update progress
articleSchema.pre('save', function(next) {
  if (this.isModified('floorQuantities') || this.isModified('plannedQuantity') || this.isModified('currentFloor')) {
    this.progress = this.calculatedProgress;
  }
  next();
});

// Pre-save middleware to validate and fix floor data corruption
articleSchema.pre('save', function(next) {
  // Auto-fix corrupted floor data
  this.fixFloorDataCorruption();
  
  // Only validate if we're modifying quality-related fields
  const isModifyingQualityFields = this.isModified('floorQuantities.knitting.m4Quantity') ||
                                  this.isModified('floorQuantities.checking.m1Quantity') ||
                                  this.isModified('floorQuantities.checking.m2Quantity') ||
                                  this.isModified('floorQuantities.checking.m3Quantity') ||
                                  this.isModified('floorQuantities.checking.m4Quantity') ||
                                  this.isModified('floorQuantities.finalChecking.m1Quantity') ||
                                  this.isModified('floorQuantities.finalChecking.m2Quantity') ||
                                  this.isModified('floorQuantities.finalChecking.m3Quantity') ||
                                  this.isModified('floorQuantities.finalChecking.m4Quantity');
  
  if (!isModifyingQualityFields) {
    return next(); // Skip validation if not modifying quality fields
  }
  
  if (this.currentFloor === ProductionFloor.KNITTING) {
    const currentFloorKey = this.getFloorKey(this.currentFloor);
    const currentFloorData = this.floorQuantities[currentFloorKey];
    const m4Quantity = currentFloorData?.m4Quantity || 0;
    const completedQuantity = currentFloorData?.completed || 0;
    
    // M4 (defect) quantity cannot exceed completed quantity
    if (m4Quantity > completedQuantity) {
      return next(new Error('M4 (defect) quantity cannot exceed completed quantity on knitting floor'));
    }
  }
  
  if (this.currentFloor === ProductionFloor.CHECKING || this.currentFloor === ProductionFloor.FINAL_CHECKING) {
    const qualityTotal = this.qualityTotal;
    const currentFloorKey = this.getFloorKey(this.currentFloor);
    const currentFloorReceived = this.floorQuantities[currentFloorKey]?.received || 0;
    if (qualityTotal > currentFloorReceived) {
      return next(new Error('Quality quantities cannot exceed received quantity on current floor'));
    }
  }
  
  // Additional validation: Check quality quantities against Checking floor received quantity
  // This handles cases where article is on a later floor but quality inspection updates Checking floor
  const checkingFloorKey = this.getFloorKey(ProductionFloor.CHECKING);
  const checkingFloorData = this.floorQuantities[checkingFloorKey];
  if (checkingFloorData) {
    const checkingQualityTotal = (checkingFloorData.m1Quantity || 0) + 
                                 (checkingFloorData.m2Quantity || 0) + 
                                 (checkingFloorData.m3Quantity || 0) + 
                                 (checkingFloorData.m4Quantity || 0);
    const checkingFloorReceived = checkingFloorData.received || 0;
    
    if (checkingQualityTotal > checkingFloorReceived) {
      return next(new Error('Quality quantities cannot exceed received quantity on Checking floor'));
    }
    
    // Additional validation: Check if transferred quantity exceeds M1 quantity
    const m1Quantity = checkingFloorData.m1Quantity || 0;
    const transferredQuantity = checkingFloorData.transferred || 0;
    
    if (transferredQuantity > m1Quantity && m1Quantity > 0) {
      // Emergency fix: Auto-correct the data corruption
      console.warn(`🚨 DATA CORRUPTION DETECTED: Transferred (${transferredQuantity}) > M1 (${m1Quantity}). Auto-fixing...`);
      checkingFloorData.transferred = m1Quantity;
      checkingFloorData.remaining = checkingFloorData.received - checkingFloorData.transferred;
      
      // Log the auto-fix
      console.log(`✅ Auto-fixed: transferred=${m1Quantity}, remaining=${checkingFloorData.remaining}`);
      
      // Continue instead of throwing error
      return next();
    }
  }
  
  // NEW VALIDATION: Check for washing floor data corruption
  const washingFloorData = this.floorQuantities.washing;
  const knittingFloorData = this.floorQuantities.knitting;
  if (washingFloorData && knittingFloorData) {
    const washingReceived = washingFloorData.received || 0;
    const knittingTransferred = knittingFloorData.transferred || 0;
    
    // If washing received more than knitting transferred, it's corruption
    if (washingReceived > knittingTransferred && knittingTransferred > 0) {
      console.warn(`🚨 WASHING FLOOR CORRUPTION DETECTED: Received (${washingReceived}) > Knitting transferred (${knittingTransferred}). Auto-fixing...`);
      washingFloorData.received = knittingTransferred;
      washingFloorData.remaining = washingFloorData.received - (washingFloorData.transferred || 0);
      
      console.log(`✅ Auto-fixed washing floor: received=${knittingTransferred}, remaining=${washingFloorData.remaining}`);
      
      return next();
    }
  }
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

// Method to update completed quantity for current floor with overproduction support
articleSchema.methods.updateCompletedQuantity = async function(newQuantity, userId, floorSupervisorId, remarks, machineId, shiftId) {
  const floorKey = this.getFloorKey(this.currentFloor);
  const floorData = this.floorQuantities[floorKey];
  
  if (!floorData) {
    throw new Error('Invalid floor for quantity update');
  }
  
  // Special handling for knitting floor - allow overproduction
  if (this.currentFloor === ProductionFloor.KNITTING) {
    if (newQuantity < 0) {
      throw new Error('Quantity cannot be negative');
    }
    // Allow overproduction in knitting (newQuantity can exceed received)
  } else if (this.currentFloor === ProductionFloor.CHECKING || this.currentFloor === ProductionFloor.FINAL_CHECKING) {
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
  if (this.currentFloor === ProductionFloor.KNITTING && newQuantity > floorData.received) {
    // Overproduction scenario: negative remaining indicates overproduction
    floorData.remaining = floorData.received - newQuantity;
  } else {
    // Normal scenario
    floorData.remaining = floorData.received - newQuantity;
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
      remarks: remarks || `Completed ${newQuantity} units on ${this.currentFloor} floor (${floorData.remaining} remaining)`,
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
    floor: this.currentFloor,
    previousQuantity,
    newQuantity,
    deltaQuantity: newQuantity - previousQuantity,
    remaining: floorData.remaining,
    isOverproduction: this.currentFloor === ProductionFloor.KNITTING && newQuantity > floorData.received
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
  
  // Set current floor to knitting if not already set
  if (!this.currentFloor || this.currentFloor === ProductionFloor.KNITTING) {
    this.currentFloor = ProductionFloor.KNITTING;
  }
  
  return {
    floor: ProductionFloor.KNITTING,
    received: this.plannedQuantity,
    remaining: this.plannedQuantity
  };
};

// Method to transfer to next floor with linking type logic
articleSchema.methods.transferToNextFloor = async function(quantity, userId, floorSupervisorId, remarks, batchNumber) {
  // Get floor order based on linking type
  const floorOrder = this.getFloorOrderByLinkingType();
  
  const currentIndex = floorOrder.indexOf(this.currentFloor);
  if (currentIndex === -1 || currentIndex === floorOrder.length - 1) {
    throw new Error('Cannot transfer from current floor');
  }
  
  const currentFloorKey = this.getFloorKey(this.currentFloor);
  const currentFloorData = this.floorQuantities[currentFloorKey];
  
  // Validate transfer quantity - allow overproduction from knitting
  if (this.currentFloor === ProductionFloor.KNITTING) {
    // For knitting, allow transfer up to completed quantity (including overproduction)
    if (quantity > currentFloorData.completed) {
      throw new Error(`Transfer quantity (${quantity}) cannot exceed completed quantity (${currentFloorData.completed}) on ${this.currentFloor} floor`);
    }
  } else {
    // For other floors, validate against completed quantity
    if (quantity > currentFloorData.completed) {
      throw new Error(`Transfer quantity (${quantity}) cannot exceed completed quantity (${currentFloorData.completed}) on ${this.currentFloor} floor`);
    }
    
    if (quantity > currentFloorData.remaining) {
      throw new Error(`Transfer quantity (${quantity}) cannot exceed remaining quantity (${currentFloorData.remaining}) on ${this.currentFloor} floor`);
    }
  }
  
  // Special handling for knitting floor - allow transfer of excess quantity
  if (this.currentFloor === ProductionFloor.KNITTING) {
    const m4Quantity = currentFloorData.m4Quantity || 0;
    const goodQuantity = currentFloorData.completed - m4Quantity;
    
    // Warn if transferring more than good quantity (excluding defects)
    if (quantity > goodQuantity) {
      console.warn(`Transferring ${quantity} units from knitting, but only ${goodQuantity} are good quality (excluding ${m4Quantity} defects)`);
    }
  }
  
  // Special handling for checking floor - only transfer good quality items (M1)
  if (this.currentFloor === ProductionFloor.CHECKING) {
    const m1Quantity = currentFloorData.m1Quantity || 0;
    
    // If quantity is specified, validate it doesn't exceed M1 quantity
    if (quantity > m1Quantity) {
      throw new Error(`Transfer quantity (${quantity}) cannot exceed good quality quantity (M1: ${m1Quantity}) on checking floor`);
    }
    
    // If no quantity specified, transfer all M1 quantity
    if (!quantity) {
      quantity = m1Quantity;
    }
    
    // Additional validation: Ensure quality inspection has been completed
    const m2Quantity = currentFloorData.m2Quantity || 0;
    const m3Quantity = currentFloorData.m3Quantity || 0;
    const m4Quantity = currentFloorData.m4Quantity || 0;
    const totalQualityQuantity = m1Quantity + m2Quantity + m3Quantity + m4Quantity;
    
    // If quality quantities don't match completed quantity, require quality inspection first
    if (totalQualityQuantity !== currentFloorData.completed && currentFloorData.completed > 0) {
      throw new Error(`Quality inspection incomplete. Completed: ${currentFloorData.completed}, Quality total: ${totalQualityQuantity}. Please complete quality inspection before transfer.`);
    }
    
    // Warn about defects that won't be transferred
    const totalDefects = m2Quantity + m3Quantity + m4Quantity;
    
    if (totalDefects > 0) {
      console.warn(`Transferring ${quantity} good quality items from checking floor. ${totalDefects} defective items (M2: ${m2Quantity}, M3: ${m3Quantity}, M4: ${m4Quantity}) will remain for repair/rejection`);
    }
  }
  
  const nextFloor = floorOrder[currentIndex + 1];
  const nextFloorKey = this.getFloorKey(nextFloor);
  const nextFloorData = this.floorQuantities[nextFloorKey];
  
  // Update current floor: mark as transferred
  currentFloorData.transferred += quantity;
  currentFloorData.remaining -= quantity;
  
  // For checking and finalChecking floors, ensure completed equals transferred
  // This fixes the issue where items are transferred without being marked as completed
  if (this.currentFloor === ProductionFloor.CHECKING || this.currentFloor === ProductionFloor.FINAL_CHECKING) {
    if (currentFloorData.completed < currentFloorData.transferred) {
      currentFloorData.completed = currentFloorData.transferred;
    }
  }
  
  // Update next floor: mark as received
  nextFloorData.received += quantity;
  nextFloorData.remaining += quantity;
  
  // Ensure next floor quantities are consistent
  if (nextFloorData.completed > nextFloorData.received) {
    nextFloorData.completed = nextFloorData.received;
  }
  
  // Update current floor to next floor
  this.currentFloor = nextFloor;
  this.quantityFromPreviousFloor = quantity;
  
  if (remarks) {
    this.remarks = remarks;
  }
  
  // Create log entry for floor transfer
  try {
    let transferRemarks = remarks || `Article ${this.articleNumber}: ${quantity} units transferred from ${floorOrder[currentIndex]} to ${nextFloor} (${currentFloorData.remaining} remaining on ${floorOrder[currentIndex]})`;
    
    // Add quality information for checking floor transfers
    if (this.currentFloor === ProductionFloor.CHECKING) {
      const m1Quantity = currentFloorData.m1Quantity || 0;
      const m2Quantity = currentFloorData.m2Quantity || 0;
      const m3Quantity = currentFloorData.m3Quantity || 0;
      const m4Quantity = currentFloorData.m4Quantity || 0;
      const totalDefects = m2Quantity + m3Quantity + m4Quantity;
      
      transferRemarks += ` | Quality: M1: ${m1Quantity} (transferred), M2: ${m2Quantity}, M3: ${m3Quantity}, M4: ${m4Quantity} (defects remain)`;
    }
    
    await ArticleLog.createLogEntry({
      articleId: this._id.toString(),
      orderId: this.orderId.toString(),
      action: `Transferred to ${nextFloor}`,
      quantity,
      fromFloor: floorOrder[currentIndex],
      toFloor: nextFloor,
      remarks: transferRemarks,
      previousValue: floorOrder[currentIndex],
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
    fromFloor: floorOrder[currentIndex],
    toFloor: nextFloor,
    quantity,
    currentFloorRemaining: currentFloorData.remaining,
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
    
    // Fix 1: Transferred cannot exceed received
    if (transferred > received && received > 0) {
      const oldTransferred = transferred;
      floorData.transferred = received;
      floorData.remaining = received - completed;
      fixes.push(`${floorKey}: reduced transferred from ${oldTransferred} to ${received}`);
    }
    
    // Fix 2: Completed cannot exceed received
    if (completed > received && received > 0) {
      const oldCompleted = completed;
      floorData.completed = received;
      floorData.remaining = received - transferred;
      fixes.push(`${floorKey}: reduced completed from ${oldCompleted} to ${received}`);
    }
    
    // Fix 3: Remaining calculation
    const expectedRemaining = Math.max(0, received - completed);
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
  
  // Fix current floor mismatch
  const knittingTransferred = this.floorQuantities.knitting?.transferred || 0;
  const checkingReceived = this.floorQuantities.checking?.received || 0;
  
  if (knittingTransferred > 0 && checkingReceived > 0 && this.currentFloor === 'Knitting') {
    // Article should be on checking floor if knitting has transferred
    this.currentFloor = 'Checking';
    allFixes.push(`Fixed current floor from Knitting to Checking (knitting has transferred ${knittingTransferred})`);
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
        currentFloor: this.currentFloor,
        checking: this.floorQuantities.checking,
        washing: this.floorQuantities.washing
      }
    };
  }
  
  return { fixed: false, message: 'No inconsistencies found' };
};

// Method to validate and fix current floor status
articleSchema.methods.validateAndFixCurrentFloor = function() {
  const floorOrder = this.getFloorOrderByLinkingType();
  let expectedFloor = ProductionFloor.KNITTING; // Default starting floor
  
  // Find the last floor that has transferred items
  for (let i = 0; i < floorOrder.length; i++) {
    const floor = floorOrder[i];
    const floorKey = this.getFloorKey(floor);
    const floorData = this.floorQuantities[floorKey];
    
    if (floorData && floorData.transferred > 0) {
      // This floor has transferred items, so the article should be on the next floor
      if (i < floorOrder.length - 1) {
        expectedFloor = floorOrder[i + 1];
      } else {
        // Last floor, article should be completed
        expectedFloor = floor;
      }
    }
  }
  
  // Check if current floor matches expected floor
  if (this.currentFloor !== expectedFloor) {
    const oldFloor = this.currentFloor;
    this.currentFloor = expectedFloor;
    return {
      fixed: true,
      message: `Fixed current floor from ${oldFloor} to ${expectedFloor}`,
      oldFloor,
      newFloor: expectedFloor
    };
  }
  
  return { fixed: false, message: 'Current floor is correct' };
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

// Static method to get articles by floor
articleSchema.statics.getArticlesByFloor = function(floor, options = {}) {
  const query = { currentFloor: floor };
  
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

// Static method to get articles by machine
articleSchema.statics.getArticlesByMachine = function(machineId, options = {}) {
  const query = { machineId };
  
  if (options.status) {
    query.status = options.status;
  }
  if (options.currentFloor) {
    query.currentFloor = options.currentFloor;
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
