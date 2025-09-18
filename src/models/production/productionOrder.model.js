import mongoose from 'mongoose';
import { OrderStatus, Priority, ProductionFloor } from './enums.js';
import { toJSON, paginate } from '../plugins/index.js';

/**
 * Production Order Model
 * Main production orders containing multiple articles
 */
const productionOrderSchema = new mongoose.Schema({
  // Basic identification - using MongoDB's default _id instead of custom id
  // id: {
  //   type: String,
  //   required: true,
  //   unique: true
  // },
  orderNumber: {
    type: String,
    unique: true,
    required: false // Will be auto-generated, not required from frontend
  },
  
  // Order properties
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
  
  // Articles reference
  articles: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Article'
  }],
  
  // Current floor (highest progress)
  currentFloor: {
    type: String,
    required: true,
    enum: Object.values(ProductionFloor),
    default: ProductionFloor.KNITTING
  },
  
  // Order notes
  orderNote: {
    type: String,
    required: false
  },
  
  // User tracking
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false // Will be set by middleware
  },
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false // Will be set by middleware
  }
}, {
  timestamps: true,
  collection: 'production_orders'
});

// Add plugins
productionOrderSchema.plugin(toJSON);
productionOrderSchema.plugin(paginate);

// Indexes for performance
productionOrderSchema.index({ orderNumber: 1 });
productionOrderSchema.index({ status: 1 });
productionOrderSchema.index({ priority: 1 });
productionOrderSchema.index({ currentFloor: 1 });
productionOrderSchema.index({ createdAt: -1 });
productionOrderSchema.index({ createdBy: 1 });
productionOrderSchema.index({ lastModifiedBy: 1 });
productionOrderSchema.index({ customerId: 1 });
productionOrderSchema.index({ plannedStartDate: 1 });
productionOrderSchema.index({ plannedEndDate: 1 });

// Virtual for total planned quantity
productionOrderSchema.virtual('totalPlannedQuantity').get(function() {
  return this.articles.reduce((total, article) => {
    return total + (article.plannedQuantity || 0);
  }, 0);
});

// Virtual for total completed quantity
productionOrderSchema.virtual('totalCompletedQuantity').get(function() {
  return this.articles.reduce((total, article) => {
    return total + (article.completedQuantity || 0);
  }, 0);
});

// Virtual for overall progress
productionOrderSchema.virtual('overallProgress').get(function() {
  if (this.articles.length === 0) return 0;
  
  const totalPlanned = this.totalPlannedQuantity;
  if (totalPlanned === 0) return 0;
  
  const totalCompleted = this.totalCompletedQuantity;
  return Math.round((totalCompleted / totalPlanned) * 100);
});

// Virtual for articles by floor
productionOrderSchema.virtual('articlesByFloor').get(function() {
  const floorGroups = {};
  this.articles.forEach(article => {
    const floor = article.currentFloor;
    if (!floorGroups[floor]) {
      floorGroups[floor] = [];
    }
    floorGroups[floor].push(article);
  });
  return floorGroups;
});

// Pre-save middleware to handle user fields and order number
productionOrderSchema.pre('save', async function(next) {
  // Set createdBy and lastModifiedBy if not provided
  if (this.isNew && !this.createdBy) {
    // Try to get from context or use a default user
    this.createdBy = this.createdBy || new mongoose.Types.ObjectId();
  }
  if (!this.lastModifiedBy) {
    this.lastModifiedBy = this.createdBy || new mongoose.Types.ObjectId();
  }

  // Generate order number if not provided
  if (!this.orderNumber) {
    // Generate order number in format ORD-XXXXXX
    const count = await this.constructor.countDocuments();
    this.orderNumber = `ORD-${String(count + 1).padStart(6, '0')}`;
  }
  next();
});

// Pre-save middleware to update current floor based on articles
productionOrderSchema.pre('save', async function(next) {
  if (this.articles && this.articles.length > 0) {
    // Get the highest floor among all articles
    const floorOrder = [
      ProductionFloor.KNITTING,
      ProductionFloor.LINKING,
      ProductionFloor.CHECKING,
      ProductionFloor.WASHING,
      ProductionFloor.BOARDING,
      ProductionFloor.BRANDING,
      ProductionFloor.FINAL_CHECKING,
      ProductionFloor.WAREHOUSE
    ];
    
    let highestFloorIndex = 0;
    for (const article of this.articles) {
      const articleFloorIndex = floorOrder.indexOf(article.currentFloor);
      if (articleFloorIndex > highestFloorIndex) {
        highestFloorIndex = articleFloorIndex;
      }
    }
    
    this.currentFloor = floorOrder[highestFloorIndex];
  }
  next();
});

// Pre-save middleware to update order status based on articles
productionOrderSchema.pre('save', async function(next) {
  if (this.articles && this.articles.length > 0) {
    const allCompleted = this.articles.every(article => 
      article.status === OrderStatus.COMPLETED
    );
    const anyInProgress = this.articles.some(article => 
      article.status === OrderStatus.IN_PROGRESS
    );
    const anyOnHold = this.articles.some(article => 
      article.status === OrderStatus.ON_HOLD
    );
    const anyCancelled = this.articles.some(article => 
      article.status === OrderStatus.CANCELLED
    );
    
    if (anyCancelled) {
      this.status = OrderStatus.CANCELLED;
    } else if (allCompleted) {
      this.status = OrderStatus.COMPLETED;
      this.actualEndDate = new Date();
    } else if (anyOnHold) {
      this.status = OrderStatus.ON_HOLD;
    } else if (anyInProgress) {
      this.status = OrderStatus.IN_PROGRESS;
      if (!this.actualStartDate) {
        this.actualStartDate = new Date();
      }
    }
  }
  next();
});

// Method to add article to order
productionOrderSchema.methods.addArticle = function(articleData, userId) {
  const article = {
    id: `ART-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    ...articleData,
    orderId: this.id
  };
  
  this.articles.push(article);
  this.lastModifiedBy = new mongoose.Types.ObjectId(userId);
  
  return article;
};

// Method to remove article from order
productionOrderSchema.methods.removeArticle = function(articleId, userId) {
  const articleIndex = this.articles.findIndex(article => article.id === articleId);
  if (articleIndex === -1) {
    throw new Error('Article not found in order');
  }
  
  const removedArticle = this.articles.splice(articleIndex, 1)[0];
  this.lastModifiedBy = new mongoose.Types.ObjectId(userId);
  
  return removedArticle;
};

// Method to update order status
productionOrderSchema.methods.updateStatus = function(newStatus, userId, reason) {
  const previousStatus = this.status;
  this.status = newStatus;
  this.lastModifiedBy = new mongoose.Types.ObjectId(userId);
  
  if (newStatus === OrderStatus.IN_PROGRESS && !this.actualStartDate) {
    this.actualStartDate = new Date();
  }
  
  if (newStatus === OrderStatus.COMPLETED) {
    this.actualEndDate = new Date();
  }
  
  return {
    previousStatus,
    newStatus,
    reason
  };
};

// Method to update order priority
productionOrderSchema.methods.updatePriority = function(newPriority, userId, reason) {
  const previousPriority = this.priority;
  this.priority = newPriority;
  this.lastModifiedBy = new mongoose.Types.ObjectId(userId);
  
  return {
    previousPriority,
    newPriority,
    reason
  };
};

// Method to check if order can be forwarded to warehouse
productionOrderSchema.methods.canForwardToWarehouse = function() {
  if (this.currentFloor !== ProductionFloor.FINAL_CHECKING) {
    return false;
  }
  
  return this.articles.every(article => 
    article.finalQualityConfirmed === true
  );
};

// Method to forward to warehouse
productionOrderSchema.methods.forwardToWarehouse = function(userId, remarks) {
  if (!this.canForwardToWarehouse()) {
    throw new Error('Order cannot be forwarded to warehouse - quality not confirmed for all articles');
  }
  
  this.forwardedToBranding = true;
  this.lastModifiedBy = new mongoose.Types.ObjectId(userId);
  
  if (remarks) {
    this.orderNote = this.orderNote ? `${this.orderNote}\n${remarks}` : remarks;
  }
  
  return {
    forwarded: true,
    remarks
  };
};

// Static method to get orders by floor
productionOrderSchema.statics.getOrdersByFloor = function(floor, options = {}) {
  const query = { currentFloor: floor };
  
  if (options.status) {
    query.status = options.status;
  }
  if (options.priority) {
    query.priority = options.priority;
  }
  if (options.search) {
    query.$or = [
      { orderNumber: { $regex: options.search, $options: 'i' } },
      { customerName: { $regex: options.search, $options: 'i' } },
      { customerOrderNumber: { $regex: options.search, $options: 'i' } }
    ];
  }
  if (options.dateFrom) {
    query.createdAt = { ...query.createdAt, $gte: new Date(options.dateFrom) };
  }
  if (options.dateTo) {
    query.createdAt = { ...query.createdAt, $lte: new Date(options.dateTo) };
  }
  
  return this.find(query)
    .populate('articles')
    .populate('createdBy', 'name email')
    .populate('lastModifiedBy', 'name email')
    .sort({ priority: 1, createdAt: -1 })
    .limit(options.limit || 50)
    .skip(options.offset || 0);
};

// Static method to get orders by status
productionOrderSchema.statics.getOrdersByStatus = function(status, options = {}) {
  const query = { status };
  
  if (options.priority) {
    query.priority = options.priority;
  }
  if (options.floor) {
    query.currentFloor = options.floor;
  }
  if (options.search) {
    query.$or = [
      { orderNumber: { $regex: options.search, $options: 'i' } },
      { customerName: { $regex: options.search, $options: 'i' } }
    ];
  }
  
  return this.find(query)
    .populate('articles')
    .populate('createdBy', 'name email')
    .populate('lastModifiedBy', 'name email')
    .sort({ priority: 1, createdAt: -1 })
    .limit(options.limit || 50)
    .skip(options.offset || 0);
};

// Static method to generate next order number
productionOrderSchema.statics.generateNextOrderNumber = async function() {
  const count = await this.countDocuments();
  return `ORD-${String(count + 1).padStart(6, '0')}`;
};

// Static method to get order statistics
productionOrderSchema.statics.getOrderStatistics = function(options = {}) {
  const matchQuery = {};
  
  if (options.dateFrom) {
    matchQuery.createdAt = { ...matchQuery.createdAt, $gte: new Date(options.dateFrom) };
  }
  if (options.dateTo) {
    matchQuery.createdAt = { ...matchQuery.createdAt, $lte: new Date(options.dateTo) };
  }
  if (options.floor) {
    matchQuery.currentFloor = options.floor;
  }
  
  return this.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: {
          status: '$status',
          priority: '$priority',
          floor: '$currentFloor'
        },
        count: { $sum: 1 },
        totalArticles: { $sum: { $size: '$articles' } }
      }
    },
    {
      $sort: { '_id.status': 1, '_id.priority': 1 }
    }
  ]);
};

export default mongoose.model('ProductionOrder', productionOrderSchema);
