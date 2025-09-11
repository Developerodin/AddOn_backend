import mongoose from 'mongoose';
import { ProductionFloor } from './enums.js';

/**
 * Floor Statistics Model
 * Real-time statistics for each production floor
 */
const floorStatisticsSchema = new mongoose.Schema({
  // Basic identification
  id: {
    type: String,
    required: true,
    unique: true
  },
  floor: {
    type: String,
    required: true,
    enum: Object.values(ProductionFloor),
    index: true
  },
  date: {
    type: Date,
    required: true,
    index: true
  },
  
  // Order counts
  activeOrders: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  completedToday: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  pendingOrders: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  onHoldOrders: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  
  // Quantity metrics
  totalQuantity: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  completedQuantity: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  
  // Performance metrics
  efficiency: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
    max: 100,
    validate: {
      validator: function(v) {
        return v >= 0 && v <= 100;
      },
      message: 'Efficiency must be between 0 and 100'
    }
  },
  averageProcessingTime: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
    validate: {
      validator: function(v) {
        return v >= 0;
      },
      message: 'Average processing time must be non-negative'
    }
  },
  
  // Quality metrics (for Final Checking floor)
  qualityMetrics: {
    m1Quantity: {
      type: Number,
      default: 0,
      min: 0
    },
    m2Quantity: {
      type: Number,
      default: 0,
      min: 0
    },
    m3Quantity: {
      type: Number,
      default: 0,
      min: 0
    },
    m4Quantity: {
      type: Number,
      default: 0,
      min: 0
    },
    repairCompleted: {
      type: Number,
      default: 0,
      min: 0
    },
    repairRejected: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  
  // Time-based metrics
  averageWaitTime: {
    type: Number,
    default: 0,
    min: 0
  },
  peakHour: {
    type: String,
    required: false
  },
  downtime: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Additional metrics
  machineUtilization: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  workerProductivity: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Metadata
  lastUpdated: {
    type: Date,
    required: true,
    default: Date.now
  },
  updateCount: {
    type: Number,
    default: 0,
    min: 0
  }
}, {
  timestamps: true,
  collection: 'floor_statistics'
});

// Compound index for unique floor-date combination
floorStatisticsSchema.index({ floor: 1, date: 1 }, { unique: true });

// Indexes for performance
floorStatisticsSchema.index({ date: -1 });
floorStatisticsSchema.index({ floor: 1, date: -1 });
floorStatisticsSchema.index({ efficiency: -1 });
floorStatisticsSchema.index({ lastUpdated: -1 });

// Virtual for completion rate
floorStatisticsSchema.virtual('completionRate').get(function() {
  if (this.totalQuantity === 0) return 0;
  return Math.round((this.completedQuantity / this.totalQuantity) * 100);
});

// Virtual for quality rate (Final Checking only)
floorStatisticsSchema.virtual('qualityRate').get(function() {
  if (this.floor !== ProductionFloor.FINAL_CHECKING) return null;
  
  const totalQuality = this.qualityMetrics.m1Quantity + 
                      this.qualityMetrics.m2Quantity + 
                      this.qualityMetrics.m3Quantity + 
                      this.qualityMetrics.m4Quantity;
  
  if (totalQuality === 0) return 0;
  
  return Math.round((this.qualityMetrics.m1Quantity / totalQuality) * 100);
});

// Virtual for repair success rate
floorStatisticsSchema.virtual('repairSuccessRate').get(function() {
  if (this.floor !== ProductionFloor.FINAL_CHECKING) return null;
  
  const totalRepairs = this.qualityMetrics.repairCompleted + this.qualityMetrics.repairRejected;
  if (totalRepairs === 0) return 0;
  
  return Math.round((this.qualityMetrics.repairCompleted / totalRepairs) * 100);
});

// Method to update statistics
floorStatisticsSchema.methods.updateStatistics = function(newData) {
  const previousData = {
    activeOrders: this.activeOrders,
    completedToday: this.completedToday,
    pendingOrders: this.pendingOrders,
    onHoldOrders: this.onHoldOrders,
    totalQuantity: this.totalQuantity,
    completedQuantity: this.completedQuantity,
    efficiency: this.efficiency,
    averageProcessingTime: this.averageProcessingTime
  };
  
  // Update basic metrics
  if (newData.activeOrders !== undefined) this.activeOrders = newData.activeOrders;
  if (newData.completedToday !== undefined) this.completedToday = newData.completedToday;
  if (newData.pendingOrders !== undefined) this.pendingOrders = newData.pendingOrders;
  if (newData.onHoldOrders !== undefined) this.onHoldOrders = newData.onHoldOrders;
  if (newData.totalQuantity !== undefined) this.totalQuantity = newData.totalQuantity;
  if (newData.completedQuantity !== undefined) this.completedQuantity = newData.completedQuantity;
  if (newData.efficiency !== undefined) this.efficiency = newData.efficiency;
  if (newData.averageProcessingTime !== undefined) this.averageProcessingTime = newData.averageProcessingTime;
  
  // Update quality metrics if provided
  if (newData.qualityMetrics) {
    Object.keys(newData.qualityMetrics).forEach(key => {
      if (this.qualityMetrics[key] !== undefined) {
        this.qualityMetrics[key] = newData.qualityMetrics[key];
      }
    });
  }
  
  // Update additional metrics
  if (newData.averageWaitTime !== undefined) this.averageWaitTime = newData.averageWaitTime;
  if (newData.peakHour !== undefined) this.peakHour = newData.peakHour;
  if (newData.downtime !== undefined) this.downtime = newData.downtime;
  if (newData.machineUtilization !== undefined) this.machineUtilization = newData.machineUtilization;
  if (newData.workerProductivity !== undefined) this.workerProductivity = newData.workerProductivity;
  
  this.lastUpdated = new Date();
  this.updateCount += 1;
  
  return {
    previousData,
    newData,
    changes: this.getChanges(previousData, newData)
  };
};

// Method to get changes between previous and new data
floorStatisticsSchema.methods.getChanges = function(previousData, newData) {
  const changes = {};
  Object.keys(newData).forEach(key => {
    if (previousData[key] !== newData[key]) {
      changes[key] = {
        from: previousData[key],
        to: newData[key],
        delta: newData[key] - previousData[key]
      };
    }
  });
  return changes;
};

// Method to reset daily statistics
floorStatisticsSchema.methods.resetDailyStatistics = function() {
  this.completedToday = 0;
  this.activeOrders = 0;
  this.pendingOrders = 0;
  this.onHoldOrders = 0;
  this.totalQuantity = 0;
  this.completedQuantity = 0;
  this.efficiency = 0;
  this.averageProcessingTime = 0;
  
  // Reset quality metrics
  this.qualityMetrics.m1Quantity = 0;
  this.qualityMetrics.m2Quantity = 0;
  this.qualityMetrics.m3Quantity = 0;
  this.qualityMetrics.m4Quantity = 0;
  this.qualityMetrics.repairCompleted = 0;
  this.qualityMetrics.repairRejected = 0;
  
  this.lastUpdated = new Date();
  this.updateCount = 0;
  
  return this;
};

// Static method to get statistics by floor
floorStatisticsSchema.statics.getByFloor = function(floor, options = {}) {
  const query = { floor };
  
  if (options.dateFrom) {
    query.date = { ...query.date, $gte: new Date(options.dateFrom) };
  }
  if (options.dateTo) {
    query.date = { ...query.date, $lte: new Date(options.dateTo) };
  }
  
  return this.find(query)
    .sort({ date: -1 })
    .limit(options.limit || 30)
    .skip(options.offset || 0);
};

// Static method to get current statistics for all floors
floorStatisticsSchema.statics.getCurrentStatistics = function() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  return this.find({ date: today }).sort({ floor: 1 });
};

// Static method to get statistics summary
floorStatisticsSchema.statics.getStatisticsSummary = function(options = {}) {
  const matchQuery = {};
  
  if (options.dateFrom) {
    matchQuery.date = { ...matchQuery.date, $gte: new Date(options.dateFrom) };
  }
  if (options.dateTo) {
    matchQuery.date = { ...matchQuery.date, $lte: new Date(options.dateTo) };
  }
  if (options.floor) {
    matchQuery.floor = options.floor;
  }
  
  return this.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: '$floor',
        totalActiveOrders: { $sum: '$activeOrders' },
        totalCompletedToday: { $sum: '$completedToday' },
        totalPendingOrders: { $sum: '$pendingOrders' },
        totalOnHoldOrders: { $sum: '$onHoldOrders' },
        totalQuantity: { $sum: '$totalQuantity' },
        totalCompletedQuantity: { $sum: '$completedQuantity' },
        averageEfficiency: { $avg: '$efficiency' },
        averageProcessingTime: { $avg: '$averageProcessingTime' },
        recordCount: { $sum: 1 }
      }
    },
    {
      $sort: { '_id': 1 }
    }
  ]);
};

// Static method to get efficiency trends
floorStatisticsSchema.statics.getEfficiencyTrends = function(floor, days = 30) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return this.find({
    floor,
    date: { $gte: startDate, $lte: endDate }
  })
  .sort({ date: 1 })
  .select('date efficiency averageProcessingTime');
};

// Static method to create or update daily statistics
floorStatisticsSchema.statics.createOrUpdateDaily = function(floor, statisticsData) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  return this.findOneAndUpdate(
    { floor, date: today },
    {
      $set: {
        ...statisticsData,
        lastUpdated: new Date()
      },
      $inc: { updateCount: 1 }
    },
    { 
      upsert: true, 
      new: true,
      setDefaultsOnInsert: true
    }
  );
};

export default mongoose.model('FloorStatistics', floorStatisticsSchema);
