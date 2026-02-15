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
 * Normalize a single machine row (e.g. from Excel) into API shape.
 * Handles flat Excel columns like "Needles Config 1", "Needles Config Cutoff 1" ... "Needles Config 5", "Needles Config Cutoff 5".
 * @param {Object} row - Raw row (API shape or Excel flat keys)
 * @returns {Object} - Normalized machine body for create
 */
const normalizeMachineImportRow = (row) => {
  const needleSizeConfig = [];
  if (Array.isArray(row.needleSizeConfig) && row.needleSizeConfig.length > 0) {
    row.needleSizeConfig.forEach((item) => {
      if (item && (item.needleSize != null && item.needleSize !== '')) {
        needleSizeConfig.push({
          needleSize: String(item.needleSize).trim(),
          cutoffQuantity: Number(item.cutoffQuantity) || 0,
        });
      }
    });
  } else {
    for (let i = 1; i <= 5; i++) {
      const sizeKey = `Needles Config ${i}`;
      const cutoffKey = `Needles Config Cutoff ${i}`;
      const size = row[sizeKey] != null ? String(row[sizeKey]).trim() : '';
      const cutoff = row[cutoffKey] != null ? Number(row[cutoffKey]) : 0;
      if (size !== '') {
        needleSizeConfig.push({ needleSize: size, cutoffQuantity: isNaN(cutoff) ? 0 : cutoff });
      }
    }
  }

  const parseDate = (v) => {
    if (v == null || v === '') return undefined;
    if (v instanceof Date) return v;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };

  const str = (v) => (v != null && v !== '' ? String(v).trim() : undefined);
  const num = (v) => (v != null && v !== '' ? Number(v) : undefined);
  const statusVal = row.status || row['Status'];
  const validStatus = statusVal && ['Active', 'Under Maintenance', 'Idle'].includes(String(statusVal).trim());

  const body = {
    machineCode: str(row.machineCode ?? row['Machine Code']),
    machineNumber: str(row.machineNumber ?? row['Machine Number']),
    model: str(row.model ?? row['Model']),
    floor: str(row.floor ?? row['Floor']),
    company: str(row.company),
    machineType: str(row.machineType ?? row['Company Machine Type']),
    status: validStatus ? String(statusVal).trim() : 'Idle',
    assignedSupervisor:
      (row.assignedSupervisor ?? row['Assigned Supervisor']) && mongoose.Types.ObjectId.isValid(String(row.assignedSupervisor ?? row['Assigned Supervisor']).trim())
        ? String(row.assignedSupervisor ?? row['Assigned Supervisor']).trim()
        : undefined,
    capacityPerShift: num(row.capacityPerShift ?? row['Capacity Per Shift']),
    capacityPerDay: num(row.capacityPerDay ?? row['Capacity Per Day']),
    installationDate: parseDate(row.installationDate ?? row['Installation Date']),
    maintenanceRequirement: str(row.maintenanceRequirement ?? row['Maintenance Requirement']),
    lastMaintenanceDate: parseDate(row.lastMaintenanceDate ?? row['Last Maintenance Date']),
    nextMaintenanceDate: parseDate(row.nextMaintenanceDate ?? row['Next Maintenance Date']),
    maintenanceNotes: str(row.maintenanceNotes ?? row['Maintenance Notes']) ?? undefined,
    isActive: row.isActive !== false,
  };
  if (needleSizeConfig.length > 0) body.needleSizeConfig = needleSizeConfig;
  return body;
};

/**
 * Extract machine ID from row (Excel "ID" column or API "id" / "_id").
 * @param {Object} row
 * @returns {string|undefined} - Valid ObjectId string or undefined
 */
const getMachineIdFromRow = (row) => {
  const raw = row.id ?? row._id ?? row.ID ?? row['ID'];
  if (raw == null || raw === '') return undefined;
  const str = String(raw).trim();
  return mongoose.Types.ObjectId.isValid(str) ? str : undefined;
};

/**
 * Bulk import machines with batch processing.
 * - If row has ID (Excel "ID" or API "id"/"_id") and that machine exists → UPDATE.
 * - Otherwise → CREATE.
 * @param {Array} machines - Array of machine objects (API or Excel row shape)
 * @param {number} batchSize - Number of machines per batch
 * @returns {Promise<Object>} - { total, created, updated, failed, errors, processingTime }
 */
const bulkImportMachines = async (machines, batchSize = 50) => {
  const results = {
    total: machines.length,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
    processingTime: 0,
  };
  const startTime = Date.now();

  if (machines.length > 10000) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Maximum 10000 machines allowed per request');
  }

  for (let i = 0; i < machines.length; i += batchSize) {
    const batch = machines.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (row, batchIndex) => {
        const globalIndex = i + batchIndex + 1;
        try {
          const machineId = getMachineIdFromRow(row);
          const body = normalizeMachineImportRow(row);

          if (machineId) {
            const existing = await Machine.findById(machineId);
            if (!existing) {
              results.failed += 1;
              results.errors.push({
                row: globalIndex,
                message: 'Machine not found for given ID',
                machineId,
                machineCode: row.machineCode ?? row['Machine Code'],
                machineNumber: row.machineNumber ?? row['Machine Number'],
              });
              return;
            }
            if (body.machineCode && (await Machine.isMachineCodeTaken(body.machineCode, machineId))) {
              throw new ApiError(httpStatus.BAD_REQUEST, 'Machine code already taken');
            }
            if (body.machineNumber && (await Machine.isMachineNumberTaken(body.machineNumber, machineId))) {
              throw new ApiError(httpStatus.BAD_REQUEST, 'Machine number already taken');
            }
            if (body.lastMaintenanceDate && (body.maintenanceRequirement || existing.maintenanceRequirement)) {
              body.nextMaintenanceDate = existing.calculateNextMaintenanceDate(
                body.lastMaintenanceDate,
                body.maintenanceRequirement || existing.maintenanceRequirement
              );
            } else if (body.maintenanceRequirement && existing.lastMaintenanceDate) {
              body.nextMaintenanceDate = existing.calculateNextMaintenanceDate(
                existing.lastMaintenanceDate,
                body.maintenanceRequirement
              );
            }
            Object.assign(existing, body);
            await existing.save();
            results.updated += 1;
          } else {
            if (!body.machineCode && !body.machineNumber) {
              results.failed += 1;
              results.errors.push({ row: globalIndex, message: 'machineCode or machineNumber is required' });
              return;
            }
            await createMachine(body);
            results.created += 1;
          }
        } catch (err) {
          results.failed += 1;
          results.errors.push({
            row: globalIndex,
            message: err.message || 'Unknown error',
            machineCode: row.machineCode ?? row['Machine Code'],
            machineNumber: row.machineNumber ?? row['Machine Number'],
          });
        }
      })
    );
  }

  results.processingTime = Date.now() - startTime;
  return results;
};

/**
 * Query for machines
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @param {string} [options.search] - Search term to search across machineCode, machineNumber, and model
 * @returns {Promise<QueryResult>}
 */
const queryMachines = async (filter, options) => {
  // Only return active machines by default, unless isActive is explicitly set in filter
  const activeFilter = filter.hasOwnProperty('isActive') 
    ? filter 
    : { ...filter, isActive: true };
  
  // Handle search parameter - search across machineCode, machineNumber, and model
  if (options.search) {
    const searchRegex = { $regex: options.search, $options: 'i' };
    // Remove machineCode, machineNumber, and model from filter if search is provided to avoid conflicts
    const { machineCode, machineNumber, model, ...restFilter } = activeFilter;
    const finalFilter = {
      ...restFilter,
      $or: [
        { machineCode: searchRegex },
        { machineNumber: searchRegex },
        { model: searchRegex },
      ],
    };
    // Remove search from options as it's not a pagination option
    const { search, ...restOptions } = options;
    const machines = await Machine.paginate(finalFilter, restOptions);
    return machines;
  }
  
  const machines = await Machine.paginate(activeFilter, options);
  return machines;
};

/**
 * Get machine by id
 * @param {ObjectId} id
 * @returns {Promise<Machine>}
 */
const getMachineById = async (id) => {
  return Machine.findOne({ _id: id, isActive: true }).populate('assignedSupervisor', 'name email role');
};

/**
 * Get machine by machine code
 * @param {string} machineCode
 * @returns {Promise<Machine>}
 */
const getMachineByCode = async (machineCode) => {
  return Machine.findOne({ machineCode, isActive: true }).populate('assignedSupervisor', 'name email role');
};

/**
 * Get machine by machine number
 * @param {string} machineNumber
 * @returns {Promise<Machine>}
 */
const getMachineByNumber = async (machineNumber) => {
  return Machine.findOne({ machineNumber, isActive: true }).populate('assignedSupervisor', 'name email role');
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
 * Delete machine by id (permanent deletion)
 * @param {ObjectId} machineId
 * @returns {Promise<Machine>}
 */
const deleteMachineById = async (machineId) => {
  // Check if machine exists (without isActive filter for hard delete)
  const machine = await Machine.findById(machineId).populate('assignedSupervisor', 'name email role');
  if (!machine) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine not found');
  }
  
  // Check if machine is being used by any articles
  const articlesUsingMachine = await Article.countDocuments({ machineId });
  if (articlesUsingMachine > 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot delete machine. It is currently assigned to ${articlesUsingMachine} article(s). Please remove machine assignment from articles first.`
    );
  }
  
  // Permanently delete the machine from database
  const deletedMachine = await Machine.findByIdAndDelete(machineId);
  
  if (!deletedMachine) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine not found');
  }
  
  return deletedMachine;
};

/**
 * Bulk delete machines by ids (permanent deletion)
 * @param {Array<ObjectId>} machineIds - Array of machine IDs to delete
 * @returns {Promise<Object>} - Results of the bulk delete operation
 */
const bulkDeleteMachines = async (machineIds) => {
  if (!Array.isArray(machineIds) || machineIds.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Machine IDs array is required and cannot be empty');
  }

  // Validate all IDs are valid ObjectIds
  const validIds = machineIds.filter(id => mongoose.Types.ObjectId.isValid(id));
  if (validIds.length !== machineIds.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid machine ID(s) provided');
  }

  // Check if all machines exist (without isActive filter for hard delete)
  const existingMachines = await Machine.find({
    _id: { $in: validIds }
  });

  if (existingMachines.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, 'No machines found with the provided IDs');
  }

  if (existingMachines.length !== validIds.length) {
    const foundIds = existingMachines.map(m => m._id.toString());
    const notFoundIds = validIds.filter(id => !foundIds.includes(id.toString()));
    throw new ApiError(
      httpStatus.NOT_FOUND,
      `Some machines not found: ${notFoundIds.join(', ')}`
    );
  }

  // Check if any machines are being used by articles
  const machinesInUse = await Article.distinct('machineId', {
    machineId: { $in: validIds }
  });

  if (machinesInUse.length > 0) {
    const machineCodes = existingMachines
      .filter(m => machinesInUse.some(id => id.toString() === m._id.toString()))
      .map(m => m.machineCode || m.machineNumber || m._id.toString());
    
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot delete machine(s): ${machineCodes.join(', ')}. They are currently assigned to articles. Please remove machine assignment from articles first.`
    );
  }

  // Perform permanent bulk delete
  const result = await Machine.deleteMany({
    _id: { $in: validIds }
  });

  return {
    success: true,
    deletedCount: result.deletedCount,
    totalRequested: validIds.length,
    message: `Successfully deleted ${result.deletedCount} machine(s)`
  };
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
  bulkImportMachines,
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
  bulkDeleteMachines,
};
