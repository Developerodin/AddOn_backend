import httpStatus from 'http-status';
import ApiError from '../utils/ApiError.js';
import Machine from '../models/machine.model.js';
import Article from '../models/production/article.model.js';
import ProductionOrder from '../models/production/productionOrder.model.js';
import mongoose from 'mongoose';

/**
 * Create a machine
 * @param {Object} machineBody
 * @returns {Promise<Machine>}
 */
const createMachine = async (machineBody) => {
  if (machineBody.machineCode && await Machine.isMachineCodeTaken(machineBody.machineCode)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Machine code already taken');
  }
  
  if (machineBody.machineNumber && await Machine.isMachineNumberTaken(machineBody.machineNumber)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Machine number already taken');
  }

  // Calculate next maintenance date if last maintenance date is provided
  if (machineBody.lastMaintenanceDate && machineBody.maintenanceRequirement) {
    const machine = new Machine(machineBody);
    machineBody.nextMaintenanceDate = machine.calculateNextMaintenanceDate(
      machineBody.lastMaintenanceDate,
      machineBody.maintenanceRequirement
    );
  }

  return Machine.create(machineBody);
};

/**
 * Query for machines
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
const queryMachines = async (filter, options) => {
  const machines = await Machine.paginate(filter, options);
  return machines;
};

/**
 * Get machine by id
 * @param {ObjectId} id
 * @returns {Promise<Machine>}
 */
const getMachineById = async (id) => {
  return Machine.findById(id).populate('assignedSupervisor', 'name email role');
};

/**
 * Get machine by machine code
 * @param {string} machineCode
 * @returns {Promise<Machine>}
 */
const getMachineByCode = async (machineCode) => {
  return Machine.findOne({ machineCode }).populate('assignedSupervisor', 'name email role');
};

/**
 * Get machine by machine number
 * @param {string} machineNumber
 * @returns {Promise<Machine>}
 */
const getMachineByNumber = async (machineNumber) => {
  return Machine.findOne({ machineNumber }).populate('assignedSupervisor', 'name email role');
};

/**
 * Update machine by id
 * @param {ObjectId} machineId
 * @param {Object} updateBody
 * @returns {Promise<Machine>}
 */
const updateMachineById = async (machineId, updateBody) => {
  const machine = await getMachineById(machineId);
  if (!machine) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine not found');
  }
  
  if (updateBody.machineCode && (await Machine.isMachineCodeTaken(updateBody.machineCode, machineId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Machine code already taken');
  }
  
  if (updateBody.machineNumber && (await Machine.isMachineNumberTaken(updateBody.machineNumber, machineId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Machine number already taken');
  }

  // Recalculate next maintenance date if maintenance details are updated
  if (updateBody.lastMaintenanceDate && updateBody.maintenanceRequirement) {
    updateBody.nextMaintenanceDate = machine.calculateNextMaintenanceDate(
      updateBody.lastMaintenanceDate,
      updateBody.maintenanceRequirement
    );
  } else if (updateBody.lastMaintenanceDate && machine.maintenanceRequirement) {
    updateBody.nextMaintenanceDate = machine.calculateNextMaintenanceDate(
      updateBody.lastMaintenanceDate,
      machine.maintenanceRequirement
    );
  } else if (updateBody.maintenanceRequirement && machine.lastMaintenanceDate) {
    updateBody.nextMaintenanceDate = machine.calculateNextMaintenanceDate(
      machine.lastMaintenanceDate,
      updateBody.maintenanceRequirement
    );
  }

  Object.assign(machine, updateBody);
  await machine.save();
  return machine;
};

/**
 * Update machine status
 * @param {ObjectId} machineId
 * @param {Object} statusBody
 * @returns {Promise<Machine>}
 */
const updateMachineStatus = async (machineId, statusBody) => {
  const machine = await getMachineById(machineId);
  if (!machine) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine not found');
  }

  Object.assign(machine, statusBody);
  await machine.save();
  return machine;
};

/**
 * Update machine maintenance
 * @param {ObjectId} machineId
 * @param {Object} maintenanceBody
 * @returns {Promise<Machine>}
 */
const updateMachineMaintenance = async (machineId, maintenanceBody) => {
  const machine = await getMachineById(machineId);
  if (!machine) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine not found');
  }

  // Calculate next maintenance date only if both lastMaintenanceDate and maintenanceRequirement are available
  if (maintenanceBody.lastMaintenanceDate && machine.maintenanceRequirement) {
    const nextMaintenanceDate = machine.calculateNextMaintenanceDate(
      maintenanceBody.lastMaintenanceDate,
      machine.maintenanceRequirement
    );
    Object.assign(machine, {
      ...maintenanceBody,
      nextMaintenanceDate,
    });
  } else {
    Object.assign(machine, maintenanceBody);
  }
  await machine.save();
  return machine;
};

/**
 * Assign supervisor to machine
 * @param {ObjectId} machineId
 * @param {ObjectId} supervisorId
 * @returns {Promise<Machine>}
 */
const assignSupervisor = async (machineId, supervisorId) => {
  const machine = await getMachineById(machineId);
  if (!machine) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine not found');
  }

  machine.assignedSupervisor = supervisorId;
  await machine.save();
  return machine;
};

/**
 * Get machines by status
 * @param {string} status
 * @param {Object} options
 * @returns {Promise<QueryResult>}
 */
const getMachinesByStatus = async (status, options = {}) => {
  const filter = { status, isActive: true };
  return Machine.paginate(filter, options);
};

/**
 * Get machines by floor
 * @param {string} floor
 * @param {Object} options
 * @returns {Promise<QueryResult>}
 */
const getMachinesByFloor = async (floor, options = {}) => {
  const filter = { floor, isActive: true };
  return Machine.paginate(filter, options);
};

/**
 * Get machines needing maintenance
 * @param {Object} options
 * @returns {Promise<QueryResult>}
 */
const getMachinesNeedingMaintenance = async (options = {}) => {
  const filter = {
    isActive: true,
    nextMaintenanceDate: { $lte: new Date() },
  };
  return Machine.paginate(filter, options);
};

/**
 * Get machines by supervisor
 * @param {ObjectId} supervisorId
 * @param {Object} options
 * @returns {Promise<QueryResult>}
 */
const getMachinesBySupervisor = async (supervisorId, options = {}) => {
  const filter = { assignedSupervisor: supervisorId, isActive: true };
  return Machine.paginate(filter, options);
};

/**
 * Get machine statistics
 * @returns {Promise<Object>}
 */
const getMachineStatistics = async () => {
  const totalMachines = await Machine.countDocuments({ isActive: true });
  const activeMachines = await Machine.countDocuments({ status: 'Active', isActive: true });
  const maintenanceMachines = await Machine.countDocuments({ status: 'Under Maintenance', isActive: true });
  const idleMachines = await Machine.countDocuments({ status: 'Idle', isActive: true });
  const maintenanceDue = await Machine.countDocuments({
    isActive: true,
    nextMaintenanceDate: { $lte: new Date() },
  });

  return {
    totalMachines,
    activeMachines,
    maintenanceMachines,
    idleMachines,
    maintenanceDue,
  };
};

/**
 * Delete machine by id
 * @param {ObjectId} machineId
 * @returns {Promise<Machine>}
 */
const deleteMachineById = async (machineId) => {
  const machine = await getMachineById(machineId);
  if (!machine) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine not found');
  }
  
  // Soft delete by setting isActive to false
  machine.isActive = false;
  await machine.save();
  return machine;
};

/**
 * Get machine usage analytics
 * @param {ObjectId} machineId
 * @param {Object} options
 * @returns {Promise<Object>}
 */
const getMachineUsageAnalytics = async (machineId, options = {}) => {
  const machine = await getMachineById(machineId);
  if (!machine) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine not found');
  }

  const { startDate, endDate, period = 'daily' } = options;
  
  // Build date filter
  const dateFilter = {};
  if (startDate && endDate) {
    dateFilter.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }

  // Get articles using this machine
  const articles = await Article.find({
    machineId: new mongoose.Types.ObjectId(machineId),
    ...dateFilter
  }).populate('orderId', 'orderNumber customerName priority status');

  // Calculate usage metrics first
  const totalCompletedQuantity = articles.reduce((sum, a) => {
    // Sum completed quantities from all floors
    let totalCompleted = 0;
    Object.values(a.floorQuantities || {}).forEach(floor => {
      totalCompleted += floor.completed || 0;
    });
    return sum + totalCompleted;
  }, 0);

  const totalPlannedQuantity = articles.reduce((sum, a) => sum + (a.plannedQuantity || 0), 0);
  const averageProgress = articles.length > 0 ? 
    Math.round(articles.reduce((sum, a) => sum + (a.progress || 0), 0) / articles.length) : 0;

  // Calculate analytics
  const analytics = {
    machine: {
      id: machine._id,
      machineCode: machine.machineCode,
      machineNumber: machine.machineNumber,
      model: machine.model,
      floor: machine.floor,
      status: machine.status,
      capacityPerShift: machine.capacityPerShift,
      capacityPerDay: machine.capacityPerDay,
      assignedSupervisor: machine.assignedSupervisor
    },
    usage: {
      totalArticles: articles.length,
      totalOrders: new Set(articles.map(a => a.orderId?._id?.toString())).size,
      totalPlannedQuantity,
      totalCompletedQuantity,
      averageProgress
    },
    capacity: {
      dailyCapacity: machine.capacityPerDay || 0,
      shiftCapacity: machine.capacityPerShift || 0,
      dailyUtilization: machine.capacityPerDay ? 
        Math.round((totalCompletedQuantity / machine.capacityPerDay) * 100) : 0,
      shiftUtilization: machine.capacityPerShift ? 
        Math.round((totalCompletedQuantity / machine.capacityPerShift) * 100) : 0
    },
    orders: articles.map(article => ({
      orderId: article.orderId?._id,
      orderNumber: article.orderId?.orderNumber,
      customerName: article.orderId?.customerName,
      articleId: article._id,
      articleNumber: article.articleNumber,
      plannedQuantity: article.plannedQuantity,
      progress: article.progress,
      status: article.status,
      priority: article.priority,
      startedAt: article.startedAt,
      completedAt: article.completedAt
    })),
    period: period,
    dateRange: {
      startDate: startDate || null,
      endDate: endDate || null
    }
  };

  return analytics;
};

/**
 * Get machine current status
 * @param {ObjectId} machineId
 * @returns {Promise<Object>}
 */
const getMachineCurrentStatus = async (machineId) => {
  const machine = await getMachineById(machineId);
  if (!machine) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine not found');
  }

  // Get currently active articles (in progress)
  const activeArticles = await Article.find({
    machineId: new mongoose.Types.ObjectId(machineId),
    status: { $in: ['In Progress', 'Pending'] },
    progress: { $gt: 0, $lt: 100 }
  }).populate('orderId', 'orderNumber customerName priority');

  // Get recent articles (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const recentArticles = await Article.find({
    machineId: new mongoose.Types.ObjectId(machineId),
    createdAt: { $gte: sevenDaysAgo }
  }).populate('orderId', 'orderNumber customerName priority');

  // Calculate current workload
  const currentWorkload = activeArticles.reduce((sum, article) => {
    return sum + (article.plannedQuantity || 0);
  }, 0);

  const status = {
    machine: {
      id: machine._id,
      machineCode: machine.machineCode,
      machineNumber: machine.machineNumber,
      model: machine.model,
      floor: machine.floor,
      status: machine.status,
      capacityPerShift: machine.capacityPerShift,
      capacityPerDay: machine.capacityPerDay,
      assignedSupervisor: machine.assignedSupervisor,
      installationDate: machine.installationDate,
      lastMaintenanceDate: machine.lastMaintenanceDate,
      nextMaintenanceDate: machine.nextMaintenanceDate,
      needsMaintenance: machine.needsMaintenance()
    },
    currentWorkload: {
      activeArticles: activeArticles.length,
      totalPlannedQuantity: currentWorkload,
      capacityUtilization: machine.capacityPerDay ? 
        Math.round((currentWorkload / machine.capacityPerDay) * 100) : 0
    },
    activeArticles: activeArticles.map(article => ({
      articleId: article._id,
      articleNumber: article.articleNumber,
      orderId: article.orderId?._id,
      orderNumber: article.orderId?.orderNumber,
      customerName: article.orderId?.customerName,
      plannedQuantity: article.plannedQuantity,
      progress: article.progress,
      priority: article.priority,
      startedAt: article.startedAt,
      currentFloor: article.getCurrentActiveFloor()
    })),
    recentActivity: {
      totalArticles: recentArticles.length,
      completedArticles: recentArticles.filter(a => a.progress === 100).length,
      averageProgress: recentArticles.length > 0 ? 
        Math.round(recentArticles.reduce((sum, a) => sum + (a.progress || 0), 0) / recentArticles.length) : 0
    },
    lastUpdated: new Date()
  };

  return status;
};

/**
 * Get machine workload for a specific date
 * @param {ObjectId} machineId
 * @param {string} date
 * @returns {Promise<Object>}
 */
const getMachineWorkload = async (machineId, date = null) => {
  const machine = await getMachineById(machineId);
  if (!machine) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine not found');
  }

  const targetDate = date ? new Date(date) : new Date();
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  // Get articles worked on this machine on the target date
  const articles = await Article.find({
    machineId: new mongoose.Types.ObjectId(machineId),
    $or: [
      { createdAt: { $gte: startOfDay, $lte: endOfDay } },
      { startedAt: { $gte: startOfDay, $lte: endOfDay } },
      { completedAt: { $gte: startOfDay, $lte: endOfDay } }
    ]
  }).populate('orderId', 'orderNumber customerName priority');

  // Calculate workload metrics
  const totalPlannedQuantity = articles.reduce((sum, a) => sum + (a.plannedQuantity || 0), 0);
  const totalCompletedQuantity = articles.reduce((sum, a) => {
    let completed = 0;
    Object.values(a.floorQuantities || {}).forEach(floor => {
      completed += floor.completed || 0;
    });
    return sum + completed;
  }, 0);

  const workload = {
    machine: {
      id: machine._id,
      machineCode: machine.machineCode,
      machineNumber: machine.machineNumber,
      floor: machine.floor,
      capacityPerShift: machine.capacityPerShift,
      capacityPerDay: machine.capacityPerDay
    },
    date: targetDate.toISOString().split('T')[0],
    workload: {
      totalArticles: articles.length,
      totalPlannedQuantity,
      totalCompletedQuantity,
      remainingQuantity: totalPlannedQuantity - totalCompletedQuantity,
      completionRate: totalPlannedQuantity > 0 ? 
        Math.round((totalCompletedQuantity / totalPlannedQuantity) * 100) : 0
    },
    capacity: {
      dailyCapacity: machine.capacityPerDay || 0,
      shiftCapacity: machine.capacityPerShift || 0,
      dailyUtilization: machine.capacityPerDay ? 
        Math.round((totalCompletedQuantity / machine.capacityPerDay) * 100) : 0,
      shiftUtilization: machine.capacityPerShift ? 
        Math.round((totalCompletedQuantity / machine.capacityPerShift) * 100) : 0,
      capacityAvailable: machine.capacityPerDay ? 
        Math.max(0, machine.capacityPerDay - totalCompletedQuantity) : 0
    },
    articles: articles.map(article => ({
      articleId: article._id,
      articleNumber: article.articleNumber,
      orderId: article.orderId?._id,
      orderNumber: article.orderId?.orderNumber,
      customerName: article.orderId?.customerName,
      plannedQuantity: article.plannedQuantity,
      progress: article.progress,
      priority: article.priority,
      status: article.status
    }))
  };

  return workload;
};

/**
 * Get machine performance metrics
 * @param {ObjectId} machineId
 * @param {Object} options
 * @returns {Promise<Object>}
 */
const getMachinePerformanceMetrics = async (machineId, options = {}) => {
  const machine = await getMachineById(machineId);
  if (!machine) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine not found');
  }

  const { startDate, endDate } = options;
  
  // Build date filter
  const dateFilter = {};
  if (startDate && endDate) {
    dateFilter.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }

  // Get all articles for this machine in the period
  const articles = await Article.find({
    machineId: new mongoose.Types.ObjectId(machineId),
    ...dateFilter
  }).populate('orderId', 'orderNumber customerName priority');

  // Calculate performance metrics
  const totalArticles = articles.length;
  const completedArticles = articles.filter(a => a.progress === 100).length;
  const totalPlannedQuantity = articles.reduce((sum, a) => sum + (a.plannedQuantity || 0), 0);
  const totalCompletedQuantity = articles.reduce((sum, a) => {
    let completed = 0;
    Object.values(a.floorQuantities || {}).forEach(floor => {
      completed += floor.completed || 0;
    });
    return sum + completed;
  }, 0);

  // Calculate average processing time
  const articlesWithTimes = articles.filter(a => a.startedAt && a.completedAt);
  const averageProcessingTime = articlesWithTimes.length > 0 ? 
    articlesWithTimes.reduce((sum, a) => {
      const processingTime = new Date(a.completedAt) - new Date(a.startedAt);
      return sum + processingTime;
    }, 0) / articlesWithTimes.length : 0;

  const metrics = {
    machine: {
      id: machine._id,
      machineCode: machine.machineCode,
      machineNumber: machine.machineNumber,
      floor: machine.floor,
      capacityPerShift: machine.capacityPerShift,
      capacityPerDay: machine.capacityPerDay
    },
    period: {
      startDate: startDate || null,
      endDate: endDate || null,
      duration: startDate && endDate ? 
        Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) : null
    },
    performance: {
      totalArticles,
      completedArticles,
      completionRate: totalArticles > 0 ? 
        Math.round((completedArticles / totalArticles) * 100) : 0,
      totalPlannedQuantity,
      totalCompletedQuantity,
      throughput: totalCompletedQuantity,
      averageProcessingTime: Math.round(averageProcessingTime / (1000 * 60 * 60)), // in hours
      averageProgress: totalArticles > 0 ? 
        Math.round(articles.reduce((sum, a) => sum + (a.progress || 0), 0) / totalArticles) : 0
    },
    efficiency: {
      dailyCapacity: machine.capacityPerDay || 0,
      shiftCapacity: machine.capacityPerShift || 0,
      dailyUtilization: machine.capacityPerDay ? 
        Math.round((totalCompletedQuantity / machine.capacityPerDay) * 100) : 0,
      shiftUtilization: machine.capacityPerShift ? 
        Math.round((totalCompletedQuantity / machine.capacityPerShift) * 100) : 0,
      capacityEfficiency: machine.capacityPerDay ? 
        Math.round((totalCompletedQuantity / machine.capacityPerDay) * 100) : 0
    },
    quality: {
      totalDefects: articles.reduce((sum, a) => {
        let defects = 0;
        Object.values(a.floorQuantities || {}).forEach(floor => {
          defects += (floor.m2Quantity || 0) + (floor.m3Quantity || 0) + (floor.m4Quantity || 0);
        });
        return sum + defects;
      }, 0),
      defectRate: totalCompletedQuantity > 0 ? 
        Math.round((articles.reduce((sum, a) => {
          let defects = 0;
          Object.values(a.floorQuantities || {}).forEach(floor => {
            defects += (floor.m2Quantity || 0) + (floor.m3Quantity || 0) + (floor.m4Quantity || 0);
          });
          return sum + defects;
        }, 0) / totalCompletedQuantity) * 100) : 0
    }
  };

  return metrics;
};

/**
 * Get all machines usage overview
 * @param {Object} options
 * @returns {Promise<Object>}
 */
const getAllMachinesUsageOverview = async (options = {}) => {
  const { floor, status } = options;
  
  // Build filter for machines
  const machineFilter = { isActive: true };
  if (floor) machineFilter.floor = floor;
  if (status) machineFilter.status = status;

  const machines = await Machine.find(machineFilter).populate('assignedSupervisor', 'name email');

  const overview = await Promise.all(machines.map(async (machine) => {
    // Get active articles for this machine
    const activeArticles = await Article.find({
      machineId: machine._id,
      status: { $in: ['In Progress', 'Pending'] },
      progress: { $gt: 0, $lt: 100 }
    });

    // Get recent articles (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentArticles = await Article.find({
      machineId: machine._id,
      createdAt: { $gte: sevenDaysAgo }
    });

    const currentWorkload = activeArticles.reduce((sum, a) => sum + (a.plannedQuantity || 0), 0);
    const recentCompleted = recentArticles.reduce((sum, a) => {
      let completed = 0;
      Object.values(a.floorQuantities || {}).forEach(floor => {
        completed += floor.completed || 0;
      });
      return sum + completed;
    }, 0);

    return {
      machine: {
        id: machine._id,
        machineCode: machine.machineCode,
        machineNumber: machine.machineNumber,
        model: machine.model,
        floor: machine.floor,
        status: machine.status,
        capacityPerShift: machine.capacityPerShift,
        capacityPerDay: machine.capacityPerDay,
        assignedSupervisor: machine.assignedSupervisor,
        needsMaintenance: machine.needsMaintenance()
      },
      usage: {
        activeArticles: activeArticles.length,
        currentWorkload,
        recentCompleted,
        capacityUtilization: machine.capacityPerDay ? 
          Math.round((recentCompleted / machine.capacityPerDay) * 100) : 0,
        isOverloaded: machine.capacityPerDay ? currentWorkload > machine.capacityPerDay : false
      }
    };
  }));

  // Sort by utilization (highest first)
  overview.sort((a, b) => b.usage.capacityUtilization - a.usage.capacityUtilization);

  return {
    totalMachines: overview.length,
    activeMachines: overview.filter(m => m.machine.status === 'Active').length,
    overloadedMachines: overview.filter(m => m.usage.isOverloaded).length,
    machinesNeedingMaintenance: overview.filter(m => m.machine.needsMaintenance).length,
    averageUtilization: overview.length > 0 ? 
      Math.round(overview.reduce((sum, m) => sum + m.usage.capacityUtilization, 0) / overview.length) : 0,
    machines: overview
  };
};

export {
  createMachine,
  queryMachines,
  getMachineById,
  getMachineByCode,
  getMachineByNumber,
  updateMachineById,
  updateMachineStatus,
  updateMachineMaintenance,
  assignSupervisor,
  getMachinesByStatus,
  getMachinesByFloor,
  getMachinesNeedingMaintenance,
  getMachinesBySupervisor,
  getMachineStatistics,
  getMachineUsageAnalytics,
  getMachineCurrentStatus,
  getMachineWorkload,
  getMachinePerformanceMetrics,
  getAllMachinesUsageOverview,
  deleteMachineById,
};
