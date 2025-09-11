import mongoose from 'mongoose';
import { OrderStatus, Priority, LinkingType, ProductionFloor, RepairStatus } from './enums.js';
import ArticleLog from './articleLog.model.js';

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
    required: true,
    validate: {
      validator: function(v) {
        return /^[A-Z0-9]{4,5}$/.test(v);
      },
      message: 'Article number must be 4-5 alphanumeric characters'
    }
  },
  
  // Quantity management
  plannedQuantity: {
    type: Number,
    required: true,
    min: 1,
    max: 100000,
    validate: {
      validator: function(v) {
        return Number.isInteger(v) && v > 0;
      },
      message: 'Planned quantity must be a positive integer between 1 and 100,000'
    }
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
    default: 0,
    min: 0,
    validate: {
      validator: function(v) {
        return v >= 0;
      },
      message: 'Progress must be 0 or greater'
    }
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
  
  
  // Floor-specific tracking
  floorQuantities: {
    knitting: {
      received: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      remaining: { type: Number, default: 0 },
      transferred: { type: Number, default: 0 }
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
      transferred: { type: Number, default: 0 }
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
      transferred: { type: Number, default: 0 }
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
    }
  },
  
  // Final Checking specific fields
  m1Quantity: {
    type: Number,
    required: false,
    default: 0,
    min: 0
  },
  m2Quantity: {
    type: Number,
    required: false,
    default: 0,
    min: 0
  },
  m3Quantity: {
    type: Number,
    required: false,
    default: 0,
    min: 0
  },
  m4Quantity: {
    type: Number,
    required: false,
    default: 0,
    min: 0
  },
  repairStatus: {
    type: String,
    required: false,
    enum: Object.values(RepairStatus),
    default: RepairStatus.NOT_REQUIRED
  },
  repairRemarks: {
    type: String,
    required: false
  },
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
articleSchema.index({ createdAt: -1 });

// Virtual for progress calculation based on floor quantities
articleSchema.virtual('calculatedProgress').get(function() {
  if (this.plannedQuantity === 0) return 0;
  
  // Calculate total completed across all floors
  const floorOrder = [
    'knitting', 'linking', 'checking', 'washing', 
    'boarding', 'finalChecking', 'branding', 'warehouse'
  ];
  
  let totalCompleted = 0;
  
  // Add completed work from current floor
  const currentFloorKey = this.getFloorKey(this.currentFloor);
  if (this.floorQuantities[currentFloorKey]) {
    totalCompleted += this.floorQuantities[currentFloorKey].completed;
  }
  
  // Add transferred work from previous floors
  const currentFloorIndex = floorOrder.indexOf(currentFloorKey);
  for (let i = 0; i < currentFloorIndex; i++) {
    const floorKey = floorOrder[i];
    if (this.floorQuantities[floorKey]) {
      totalCompleted += this.floorQuantities[floorKey].transferred;
    }
  }
  
  return Math.round((totalCompleted / this.plannedQuantity) * 100);
});

// Virtual for quality total validation
articleSchema.virtual('qualityTotal').get(function() {
  return (this.m1Quantity || 0) + (this.m2Quantity || 0) + (this.m3Quantity || 0) + (this.m4Quantity || 0);
});

// Pre-save middleware to update progress
articleSchema.pre('save', function(next) {
  if (this.isModified('floorQuantities') || this.isModified('plannedQuantity') || this.isModified('currentFloor')) {
    this.progress = this.calculatedProgress;
  }
  next();
});

// Pre-save middleware to validate quality quantities
articleSchema.pre('save', function(next) {
  if (this.currentFloor === ProductionFloor.FINAL_CHECKING) {
    const qualityTotal = this.qualityTotal;
    const currentFloorKey = this.getFloorKey(this.currentFloor);
    const currentFloorCompleted = this.floorQuantities[currentFloorKey]?.completed || 0;
    if (qualityTotal > currentFloorCompleted) {
      return next(new Error('Quality quantities cannot exceed completed quantity on current floor'));
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
    [ProductionFloor.WAREHOUSE]: 'warehouse'
  };
  return floorMap[floor];
};

// Method to update completed quantity for current floor
articleSchema.methods.updateCompletedQuantity = async function(newQuantity, userId, floorSupervisorId, remarks, machineId, shiftId) {
  const floorKey = this.getFloorKey(this.currentFloor);
  const floorData = this.floorQuantities[floorKey];
  
  if (!floorData) {
    throw new Error('Invalid floor for quantity update');
  }
  
  if (newQuantity < 0 || newQuantity > floorData.received) {
    throw new Error(`Invalid quantity: must be between 0 and received quantity (${floorData.received})`);
  }
  
  const previousQuantity = floorData.completed;
  floorData.completed = newQuantity;
  floorData.remaining = floorData.received - newQuantity;
  
  // Update progress based on floor quantities
  this.progress = this.calculatedProgress;
  
  if (remarks) {
    this.remarks = remarks;
  }
  
  // Create log entry for quantity update
  try {
    await ArticleLog.create({
      articleId: this._id,
      orderId: this.orderId,
      action: 'Quantity Updated',
      quantity: newQuantity - previousQuantity,
      remarks: remarks || `Completed ${newQuantity} units on ${this.currentFloor} floor (${floorData.remaining} remaining)`,
      previousValue: previousQuantity,
      newValue: newQuantity,
      changeReason: 'Production progress update',
      userId,
      floorSupervisorId,
      machineId,
      shiftId,
      date: new Date().toISOString().split('T')[0],
      timestamp: new Date().toISOString()
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
    remaining: floorData.remaining
  };
};


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

// Method to transfer to next floor
articleSchema.methods.transferToNextFloor = async function(quantity, userId, floorSupervisorId, remarks, batchNumber) {
  const floorOrder = [
    ProductionFloor.KNITTING,
    ProductionFloor.LINKING,
    ProductionFloor.CHECKING,
    ProductionFloor.WASHING,
    ProductionFloor.BOARDING,
    ProductionFloor.FINAL_CHECKING,
    ProductionFloor.BRANDING,
    ProductionFloor.WAREHOUSE
  ];
  
  const currentIndex = floorOrder.indexOf(this.currentFloor);
  if (currentIndex === -1 || currentIndex === floorOrder.length - 1) {
    throw new Error('Cannot transfer from current floor');
  }
  
  const currentFloorKey = this.getFloorKey(this.currentFloor);
  const currentFloorData = this.floorQuantities[currentFloorKey];
  
  // Validate transfer quantity
  if (quantity > currentFloorData.completed) {
    throw new Error(`Transfer quantity (${quantity}) cannot exceed completed quantity (${currentFloorData.completed}) on ${this.currentFloor} floor`);
  }
  
  if (quantity > currentFloorData.remaining) {
    throw new Error(`Transfer quantity (${quantity}) cannot exceed remaining quantity (${currentFloorData.remaining}) on ${this.currentFloor} floor`);
  }
  
  const nextFloor = floorOrder[currentIndex + 1];
  const nextFloorKey = this.getFloorKey(nextFloor);
  const nextFloorData = this.floorQuantities[nextFloorKey];
  
  // Update current floor: mark as transferred
  currentFloorData.transferred += quantity;
  currentFloorData.remaining -= quantity;
  
  // Update next floor: mark as received
  nextFloorData.received += quantity;
  nextFloorData.remaining += quantity;
  
  // Update current floor to next floor
  this.currentFloor = nextFloor;
  this.quantityFromPreviousFloor = quantity;
  
  if (remarks) {
    this.remarks = remarks;
  }
  
  // Create log entry for floor transfer
  try {
    await ArticleLog.create({
      articleId: this._id,
      orderId: this.orderId,
      action: `Transferred to ${nextFloor}`,
      quantity,
      fromFloor: floorOrder[currentIndex],
      toFloor: nextFloor,
      remarks: remarks || `Article ${this.articleNumber}: ${quantity} units transferred from ${floorOrder[currentIndex]} to ${nextFloor} (${currentFloorData.remaining} remaining on ${floorOrder[currentIndex]})`,
      previousValue: floorOrder[currentIndex],
      newValue: nextFloor,
      changeReason: 'Floor transfer',
      userId,
      floorSupervisorId,
      batchNumber,
      date: new Date().toISOString().split('T')[0],
      timestamp: new Date().toISOString()
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

// Method to update quality categories (Final Checking only)
articleSchema.methods.updateQualityCategories = async function(qualityData, userId, floorSupervisorId) {
  if (this.currentFloor !== ProductionFloor.FINAL_CHECKING) {
    throw new Error('Quality categories can only be updated in Final Checking floor');
  }
  
  const { m1Quantity, m2Quantity, m3Quantity, m4Quantity, repairStatus, repairRemarks } = qualityData;
  
  const currentFloorKey = this.getFloorKey(this.currentFloor);
  const currentFloorCompleted = this.floorQuantities[currentFloorKey]?.completed || 0;
  if (m1Quantity + m2Quantity + m3Quantity + m4Quantity > currentFloorCompleted) {
    throw new Error('Quality quantities cannot exceed completed quantity on current floor');
  }
  
  const previousValues = {
    m1Quantity: this.m1Quantity,
    m2Quantity: this.m2Quantity,
    m3Quantity: this.m3Quantity,
    m4Quantity: this.m4Quantity,
    repairStatus: this.repairStatus
  };
  
  // Create logs for each quality category update
  try {
    if (m1Quantity !== undefined && m1Quantity !== this.m1Quantity) {
      await ArticleLog.create({
        articleId: this._id,
        orderId: this.orderId,
        action: 'M1 Quantity Updated',
        quantity: m1Quantity - this.m1Quantity,
        remarks: `M1 quantity updated to ${m1Quantity} (Good Quality)`,
        previousValue: this.m1Quantity,
        newValue: m1Quantity,
        changeReason: 'Quality inspection',
        userId,
        floorSupervisorId,
        qualityStatus: 'M1 - Good Quality',
        date: new Date().toISOString().split('T')[0],
        timestamp: new Date().toISOString()
      });
    }
    
    if (m2Quantity !== undefined && m2Quantity !== this.m2Quantity) {
      await ArticleLog.create({
        articleId: this._id,
        orderId: this.orderId,
        action: 'M2 Quantity Updated',
        quantity: m2Quantity - this.m2Quantity,
        remarks: `M2 quantity updated to ${m2Quantity} (Needs Repair)`,
        previousValue: this.m2Quantity,
        newValue: m2Quantity,
        changeReason: 'Quality inspection',
        userId,
        floorSupervisorId,
        qualityStatus: 'M2 - Needs Repair',
        date: new Date().toISOString().split('T')[0],
        timestamp: new Date().toISOString()
      });
    }
    
    if (m3Quantity !== undefined && m3Quantity !== this.m3Quantity) {
      await ArticleLog.create({
        articleId: this._id,
        orderId: this.orderId,
        action: 'M3 Quantity Updated',
        quantity: m3Quantity - this.m3Quantity,
        remarks: `M3 quantity updated to ${m3Quantity} (Minor Defects)`,
        previousValue: this.m3Quantity,
        newValue: m3Quantity,
        changeReason: 'Quality inspection',
        userId,
        floorSupervisorId,
        qualityStatus: 'M3 - Minor Defects',
        date: new Date().toISOString().split('T')[0],
        timestamp: new Date().toISOString()
      });
    }
    
    if (m4Quantity !== undefined && m4Quantity !== this.m4Quantity) {
      await ArticleLog.create({
        articleId: this._id,
        orderId: this.orderId,
        action: 'M4 Quantity Updated',
        quantity: m4Quantity - this.m4Quantity,
        remarks: `M4 quantity updated to ${m4Quantity} (Major Defects)`,
        previousValue: this.m4Quantity,
        newValue: m4Quantity,
        changeReason: 'Quality inspection',
        userId,
        floorSupervisorId,
        qualityStatus: 'M4 - Major Defects',
        date: new Date().toISOString().split('T')[0],
        timestamp: new Date().toISOString()
      });
    }
  } catch (logError) {
    console.error('Error creating quality update logs:', logError);
    // Don't throw error for logging failure, just log it
  }
  
  this.m1Quantity = m1Quantity || 0;
  this.m2Quantity = m2Quantity || 0;
  this.m3Quantity = m3Quantity || 0;
  this.m4Quantity = m4Quantity || 0;
  
  if (repairStatus) {
    this.repairStatus = repairStatus;
  }
  if (repairRemarks) {
    this.repairRemarks = repairRemarks;
  }
  
  return previousValues;
};

// Method to shift M2 items to other categories
articleSchema.methods.shiftM2Items = async function(shiftData, userId, floorSupervisorId) {
  if (this.currentFloor !== ProductionFloor.FINAL_CHECKING) {
    throw new Error('M2 shifting can only be done in Final Checking floor');
  }
  
  const { fromM2, toM1, toM3, toM4 } = shiftData;
  
  if (fromM2 > this.m2Quantity) {
    throw new Error('Cannot shift more M2 items than available');
  }
  
  const totalShifted = (toM1 || 0) + (toM3 || 0) + (toM4 || 0);
  if (totalShifted !== fromM2) {
    throw new Error('Total shifted quantity must equal fromM2 quantity');
  }
  
  const previousValues = {
    m1Quantity: this.m1Quantity,
    m2Quantity: this.m2Quantity,
    m3Quantity: this.m3Quantity,
    m4Quantity: this.m4Quantity
  };
  
  // Create logs for M2 shifts
  try {
    // Create individual logs for each shift
    if (toM1 > 0) {
      await ArticleLog.create({
        articleId: this._id,
        orderId: this.orderId,
        action: 'M2 Item Shifted to M1',
        quantity: toM1,
        remarks: `${toM1} M2 items shifted to M1`,
        previousValue: this.m2Quantity,
        newValue: this.m2Quantity - toM1,
        changeReason: 'M2 repair process - items successfully repaired',
        userId,
        floorSupervisorId,
        qualityStatus: 'M1 - Good Quality',
        date: new Date().toISOString().split('T')[0],
        timestamp: new Date().toISOString()
      });
    }
    
    if (toM3 > 0) {
      await ArticleLog.create({
        articleId: this._id,
        orderId: this.orderId,
        action: 'M2 Item Shifted to M3',
        quantity: toM3,
        remarks: `${toM3} M2 items shifted to M3`,
        previousValue: this.m2Quantity,
        newValue: this.m2Quantity - toM3,
        changeReason: 'M2 repair process - items have minor defects',
        userId,
        floorSupervisorId,
        qualityStatus: 'M3 - Minor Defects',
        date: new Date().toISOString().split('T')[0],
        timestamp: new Date().toISOString()
      });
    }
    
    if (toM4 > 0) {
      await ArticleLog.create({
        articleId: this._id,
        orderId: this.orderId,
        action: 'M2 Item Shifted to M4',
        quantity: toM4,
        remarks: `${toM4} M2 items shifted to M4`,
        previousValue: this.m2Quantity,
        newValue: this.m2Quantity - toM4,
        changeReason: 'M2 repair process - items have major defects',
        userId,
        floorSupervisorId,
        qualityStatus: 'M4 - Major Defects',
        date: new Date().toISOString().split('T')[0],
        timestamp: new Date().toISOString()
      });
    }
  } catch (logError) {
    console.error('Error creating M2 shift logs:', logError);
    // Don't throw error for logging failure, just log it
  }
  
  this.m2Quantity -= fromM2;
  this.m1Quantity += toM1 || 0;
  this.m3Quantity += toM3 || 0;
  this.m4Quantity += toM4 || 0;
  
  return {
    previousValues,
    shiftData
  };
};

// Method to confirm final quality
articleSchema.methods.confirmFinalQuality = async function(confirmed, userId, floorSupervisorId, remarks) {
  if (this.currentFloor !== ProductionFloor.FINAL_CHECKING) {
    throw new Error('Final quality confirmation can only be done in Final Checking floor');
  }
  
  const currentFloorKey = this.getFloorKey(this.currentFloor);
  const currentFloorCompleted = this.floorQuantities[currentFloorKey]?.completed || 0;
  if (confirmed && this.qualityTotal !== currentFloorCompleted) {
    throw new Error('All completed quantity must be categorized before final confirmation');
  }
  
  const previousValue = this.finalQualityConfirmed;
  this.finalQualityConfirmed = confirmed;
  
  // Create log entry for final quality confirmation
  try {
    await ArticleLog.create({
      articleId: this._id,
      orderId: this.orderId,
      action: confirmed ? 'Final Quality Confirmed' : 'Final Quality Rejected',
      quantity: this.floorQuantities[this.getFloorKey(this.currentFloor)]?.completed || 0,
      remarks: remarks || `Final quality ${confirmed ? 'confirmed' : 'rejected'} for article ${this.articleNumber}`,
      previousValue: previousValue,
      newValue: confirmed,
      changeReason: 'Final quality inspection',
      userId,
      floorSupervisorId,
      qualityStatus: confirmed ? 'Approved for Warehouse' : 'Rejected',
      date: new Date().toISOString().split('T')[0],
      timestamp: new Date().toISOString()
    });
  } catch (logError) {
    console.error('Error creating final quality confirmation log:', logError);
    // Don't throw error for logging failure, just log it
  }
  
  return {
    previousValue,
    newValue: confirmed
  };
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
  
  return {
    floor,
    received: floorData.received,
    completed: floorData.completed,
    remaining: floorData.remaining,
    transferred: floorData.transferred,
    completionRate: floorData.received > 0 ? Math.round((floorData.completed / floorData.received) * 100) : 0
  };
};

// Method to get all floor statuses
articleSchema.methods.getAllFloorStatuses = function() {
  const floors = Object.values(ProductionFloor);
  return floors.map(floor => this.getFloorStatus(floor)).filter(status => status !== null);
};

// Static method to get articles by order
articleSchema.statics.getArticlesByOrder = function(orderId) {
  return this.find({ orderId }).sort({ createdAt: 1 });
};

export default mongoose.model('Article', articleSchema);
