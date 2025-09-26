import mongoose from 'mongoose';
import { LogAction } from './enums.js';
import paginate from '../plugins/paginate.plugin.js';

/**
 * Article Log Model
 * Comprehensive logging for all production activities
 */
const articleLogSchema = new mongoose.Schema({
  // Basic identification
  id: {
    type: String,
    required: true,
    unique: true
  },
  
  // Log details
  date: {
    type: Date,
    required: true,
    index: true
  },
  action: {
    type: String,
    required: true,
    enum: Object.values(LogAction),
    index: true
  },
  quantity: {
    type: Number,
    required: true,
    default: 0
  },
  
  // Transfer information
  fromFloor: {
    type: String,
    required: false
  },
  toFloor: {
    type: String,
    required: false
  },
  
  // Additional details
  remarks: {
    type: String,
    required: false
  },
  timestamp: {
    type: Date,
    required: true,
    default: Date.now,
    index: true
  },
  
  // User tracking
  userId: {
    type: String,
    required: true,
    index: true
  },
  floorSupervisorId: {
    type: String,
    required: true,
    index: true
  },
  
  // References
  orderId: {
    type: String,
    required: true,
    index: true
  },
  articleId: {
    type: String,
    required: false,
    index: true
  },
  
  // Change tracking
  previousValue: {
    type: mongoose.Schema.Types.Mixed,
    required: false
  },
  newValue: {
    type: mongoose.Schema.Types.Mixed,
    required: false
  },
  changeReason: {
    type: String,
    required: false
  },
  
  // Quality and operational details
  qualityStatus: {
    type: String,
    required: false
  },
  machineId: {
    type: String,
    required: false
  },
  shiftId: {
    type: String,
    required: false
  },
  batchNumber: {
    type: String,
    required: false
  }
}, {
  timestamps: true,
  collection: 'article_logs'
});

// Indexes for performance
articleLogSchema.index({ articleId: 1, date: 1 });
articleLogSchema.index({ orderId: 1, date: 1 });
articleLogSchema.index({ action: 1, date: 1 });
articleLogSchema.index({ userId: 1, date: 1 });
articleLogSchema.index({ fromFloor: 1, toFloor: 1, date: 1 });

// Apply plugins
articleLogSchema.plugin(paginate);

// Virtual for formatted date
articleLogSchema.virtual('formattedDate').get(function() {
  return this.date.toISOString().split('T')[0];
});

// Static method to create log entry
articleLogSchema.statics.createLog = function(logData) {
  const log = new this({
    id: `LOG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    ...logData,
    date: logData.date || new Date().toISOString().split('T')[0],
    timestamp: logData.timestamp || new Date()
  });
  return log;
};

// Static method to create log entry with proper validation
articleLogSchema.statics.createLogEntry = function(logData) {
  // Validate required fields
  if (!logData.action) {
    throw new Error('Action is required for log entry');
  }
  if (!logData.userId) {
    throw new Error('UserId is required for log entry');
  }
  if (!logData.floorSupervisorId) {
    throw new Error('FloorSupervisorId is required for log entry');
  }
  if (!logData.orderId) {
    throw new Error('OrderId is required for log entry');
  }

  const log = new this({
    id: `LOG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    action: logData.action,
    quantity: logData.quantity || 0,
    fromFloor: logData.fromFloor || null,
    toFloor: logData.toFloor || null,
    remarks: logData.remarks || '',
    userId: logData.userId,
    floorSupervisorId: logData.floorSupervisorId,
    orderId: logData.orderId,
    articleId: logData.articleId ? logData.articleId.toString() : null, // Ensure string format
    previousValue: logData.previousValue || null,
    newValue: logData.newValue || null,
    changeReason: logData.changeReason || '',
    qualityStatus: logData.qualityStatus || null,
    machineId: logData.machineId || null,
    shiftId: logData.shiftId || null,
    batchNumber: logData.batchNumber || null,
    date: logData.date || new Date().toISOString().split('T')[0],
    timestamp: logData.timestamp || new Date()
  });
  
  return log.save();
};

// Static method to get logs by article
articleLogSchema.statics.getLogsByArticle = function(articleId, options = {}) {
  const query = { articleId };
  
  if (options.dateFrom) {
    query.date = { ...query.date, $gte: new Date(options.dateFrom) };
  }
  if (options.dateTo) {
    query.date = { ...query.date, $lte: new Date(options.dateTo) };
  }
  if (options.action) {
    query.action = options.action;
  }
  
  return this.find(query)
    .sort({ timestamp: -1 })
    .limit(options.limit || 100)
    .skip(options.offset || 0);
};

// Static method to get logs by order
articleLogSchema.statics.getLogsByOrder = function(orderId, options = {}) {
  const query = { orderId };
  
  if (options.dateFrom) {
    query.date = { ...query.date, $gte: new Date(options.dateFrom) };
  }
  if (options.dateTo) {
    query.date = { ...query.date, $lte: new Date(options.dateTo) };
  }
  if (options.action) {
    query.action = options.action;
  }
  if (options.floor) {
    query.$or = [
      { fromFloor: options.floor },
      { toFloor: options.floor }
    ];
  }
  
  return this.find(query)
    .sort({ timestamp: -1 })
    .limit(options.limit || 100)
    .skip(options.offset || 0);
};

// Static method to get logs by floor
articleLogSchema.statics.getLogsByFloor = function(floor, options = {}) {
  const query = {
    $or: [
      { fromFloor: floor },
      { toFloor: floor }
    ]
  };
  
  if (options.dateFrom) {
    query.date = { ...query.date, $gte: new Date(options.dateFrom) };
  }
  if (options.dateTo) {
    query.date = { ...query.date, $lte: new Date(options.dateTo) };
  }
  if (options.action) {
    query.action = options.action;
  }
  if (options.userId) {
    query.userId = options.userId;
  }
  
  return this.find(query)
    .sort({ timestamp: -1 })
    .limit(options.limit || 100)
    .skip(options.offset || 0);
};

// Static method to get logs by user
articleLogSchema.statics.getLogsByUser = function(userId, options = {}) {
  const query = { userId };
  
  if (options.dateFrom) {
    query.date = { ...query.date, $gte: new Date(options.dateFrom) };
  }
  if (options.dateTo) {
    query.date = { ...query.date, $lte: new Date(options.dateTo) };
  }
  if (options.action) {
    query.action = options.action;
  }
  if (options.floor) {
    query.$or = [
      { fromFloor: options.floor },
      { toFloor: options.floor }
    ];
  }
  
  return this.find(query)
    .sort({ timestamp: -1 })
    .limit(options.limit || 100)
    .skip(options.offset || 0);
};

// Static method to get log statistics
articleLogSchema.statics.getLogStatistics = function(options = {}) {
  const matchQuery = {};
  
  if (options.dateFrom) {
    matchQuery.date = { ...matchQuery.date, $gte: new Date(options.dateFrom) };
  }
  if (options.dateTo) {
    matchQuery.date = { ...matchQuery.date, $lte: new Date(options.dateTo) };
  }
  if (options.floor) {
    matchQuery.$or = [
      { fromFloor: options.floor },
      { toFloor: options.floor }
    ];
  }
  if (options.action) {
    matchQuery.action = options.action;
  }
  
  const groupBy = options.groupBy || 'day';
  let dateFormat;
  
  switch (groupBy) {
    case 'day':
      dateFormat = '%Y-%m-%d';
      break;
    case 'week':
      dateFormat = '%Y-%U';
      break;
    case 'month':
      dateFormat = '%Y-%m';
      break;
    default:
      dateFormat = '%Y-%m-%d';
  }
  
  return this.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: dateFormat, date: '$date' } },
          action: '$action'
        },
        count: { $sum: 1 },
        totalQuantity: { $sum: '$quantity' }
      }
    },
    {
      $sort: { '_id.date': -1, '_id.action': 1 }
    }
  ]);
};

export default mongoose.model('ArticleLog', articleLogSchema);
