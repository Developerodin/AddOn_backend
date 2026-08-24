/**
 * Production Dashboard Service
 * Handles all dashboard data aggregation with caching
 */

import { 
  Article, 
  ProductionOrder, 
  ArticleLog, 
  MachineOrderAssignment, 
  FloorStatistics 
} from '../../models/production/index.js';
import Machine from '../../models/machine.model.js';
import { M2Log, M3Log, M4Log, ContainersMaster, DispatchStockTransferNote } from '../../models/production/index.js';
import {
  ALL_FLOOR_NAMES,
  ALL_FLOOR_KEYS,
  QC_FLOOR_KEYS,
  getFloorKeyFromName,
  getFloorNameFromKey,
  getFloorData,
  aggregateFloorStats,
  isQcFloorKey
} from '../../utils/floorLabelMap.js';

/**
 * Simple in-memory TTL cache
 */
const cache = new Map();
const CACHE_TTL = {
  summary: 60 * 1000,      // 60 seconds
  floors: 60 * 1000,       // 60 seconds
  trends: 15 * 60 * 1000,  // 15 minutes
  quality: 2 * 60 * 1000,  // 2 minutes
  machines: 2 * 60 * 1000, // 2 minutes
  people: 5 * 60 * 1000,   // 5 minutes
  ageing: 5 * 60 * 1000,   // 5 minutes
  yarn: 2 * 60 * 1000,     // 2 minutes
  articles: 5 * 60 * 1000, // 5 minutes
  alerts: 2 * 60 * 1000,   // 2 minutes
  exceptions: 2 * 60 * 1000, // 2 minutes
  reconciliation: 5 * 60 * 1000 // 5 minutes
};

/**
 * Get from cache or compute
 */
const getCached = async (key, ttl, computeFn) => {
  const now = Date.now();
  const cached = cache.get(key);
  
  if (cached && (now - cached.timestamp) < ttl) {
    return {
      ...cached.data,
      cached: true,
      cacheAgeMs: now - cached.timestamp
    };
  }
  
  const result = await computeFn();
  cache.set(key, { data: result, timestamp: now });
  
  return {
    ...result,
    cached: false,
    cacheAgeMs: 0
  };
};

/**
 * Generate cache key from filters
 */
const getCacheKey = (prefix, filters) => {
  return `${prefix}:${JSON.stringify(filters)}`;
};

/**
 * Get date range from filters with defaults
 */
const getDateRange = (filters) => {
  const to = filters.to ? new Date(filters.to) : new Date();
  const from = filters.from ? new Date(filters.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
};

/**
 * Get dashboard summary (Zones A + B)
 */
export const getDashboardSummary = async (filters) => {
  const cacheKey = getCacheKey('summary', filters);
  
  return getCached(cacheKey, CACHE_TTL.summary, async () => {
    const { from, to } = getDateRange(filters);
    const now = new Date();
    
    // Parallel queries for KPIs
    const [
      wipStats,
      orderStats,
      machineStats,
      outputToday,
      dispatchReady
    ] = await Promise.all([
      // WIP by floor
      Article.aggregate([
        {
          $project: {
            plannedQuantity: 1,
            totalWip: {
              $add: ALL_FLOOR_KEYS.map(k => ({ $ifNull: [`$floorQuantities.${k}.remaining`, 0] }))
            },
            totalCompleted: {
              $add: ALL_FLOOR_KEYS.map(k => ({ $ifNull: [`$floorQuantities.${k}.completed`, 0] }))
            },
            dispatchTransferred: { $ifNull: ['$floorQuantities.dispatch.transferred', 0] },
            fcReceived: { $ifNull: ['$floorQuantities.finalChecking.received', 0] },
            fcM1: { $ifNull: ['$floorQuantities.finalChecking.m1Quantity', 0] }
          }
        },
        {
          $group: {
            _id: null,
            totalWipPairs: { $sum: '$totalWip' },
            totalPlanned: { $sum: '$plannedQuantity' },
            totalDispatched: { $sum: '$dispatchTransferred' },
            fcReceived: { $sum: '$fcReceived' },
            fcM1: { $sum: '$fcM1' }
          }
        }
      ]),
      
      // Order status counts
      ProductionOrder.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]),
      
      // Machine utilization
      Machine.aggregate([
        {
          $facet: {
            total: [{ $match: {} }, { $count: 'count' }],
            active: [{ $match: { status: 'Active' } }, { $count: 'count' }],
            idle: [{ $match: { status: 'Idle' } }, { $count: 'count' }],
            maintenance: [{ $match: { status: 'Under Maintenance' } }, { $count: 'count' }]
          }
        }
      ]),
      
      // Output today (STN dispatched)
      DispatchStockTransferNote.aggregate([
        {
          $match: {
            stnDate: {
              $gte: new Date(now.toISOString().split('T')[0]),
              $lt: new Date(now.getTime() + 24 * 60 * 60 * 1000)
            },
            status: { $ne: 'Cancelled' }
          }
        },
        {
          $group: {
            _id: null,
            totalPairs: { $sum: '$totalQty' },
            stnCount: { $sum: 1 }
          }
        }
      ]),
      
      // Ready to dispatch
      Article.aggregate([
        {
          $match: {
            'floorQuantities.dispatch.remaining': { $gt: 0 }
          }
        },
        {
          $group: {
            _id: null,
            totalPairs: { $sum: '$floorQuantities.dispatch.remaining' }
          }
        }
      ])
    ]);
    
    // Process order status
    const orderStatusMap = {};
    orderStats.forEach(s => { orderStatusMap[s._id] = s.count; });
    
    // Calculate First-Pass Yield
    const fpy = wipStats[0]?.fcReceived > 0 
      ? Math.round((wipStats[0].fcM1 / wipStats[0].fcReceived) * 100 * 10) / 10
      : 0;
    
    // Get machines with work
    const machinesWithWork = await MachineOrderAssignment.distinct('machine', {
      isActive: true,
      'productionOrderItems.status': { $nin: ['Completed', 'On Hold', 'Cancelled'] }
    });
    
    const activeMachines = machineStats[0]?.active?.[0]?.count || 0;
    const machineUtil = activeMachines > 0 
      ? Math.round((machinesWithWork.length / activeMachines) * 100)
      : 0;
    
    return {
      data: {
        kpis: {
          wipPairs: {
            value: wipStats[0]?.totalWipPairs || 0,
            kind: 'stock'
          },
          outputToday: {
            value: outputToday[0]?.totalPairs || 0,
            stnCount: outputToday[0]?.stnCount || 0,
            kind: 'flow'
          },
          firstPassYield: {
            value: fpy,
            unit: '%',
            kind: 'flow'
          },
          machineUtilization: {
            value: machineUtil,
            unit: '%',
            machinesWithWork: machinesWithWork.length,
            activeMachines,
            kind: 'stock'
          },
          openOrders: {
            value: (orderStatusMap['Pending'] || 0) + (orderStatusMap['In Progress'] || 0),
            kind: 'stock'
          },
          readyToDispatch: {
            value: dispatchReady[0]?.totalPairs || 0,
            kind: 'stock'
          }
        },
        orderFunnel: {
          pending: orderStatusMap['Pending'] || 0,
          inProgress: orderStatusMap['In Progress'] || 0,
          completed: orderStatusMap['Completed'] || 0,
          onHold: orderStatusMap['On Hold'] || 0,
          shortClose: orderStatusMap['Short Close'] || 0,
          cancelled: orderStatusMap['Cancelled'] || 0
        }
      },
      range: { from, to },
      asOf: now.toISOString()
    };
  });
};

/**
 * Get floor heatstrip data (Zone C)
 */
export const getFloorHeatstrip = async (filters) => {
  const cacheKey = getCacheKey('floors', filters);
  
  return getCached(cacheKey, CACHE_TTL.floors, async () => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // Get all articles with any floor data
    const articles = await Article.find({}).select('floorQuantities plannedQuantity').lean();
    
    // Get in-transit containers
    const containersInTransit = await ContainersMaster.aggregate([
      {
        $match: {
          status: 'Active',
          'activeItems.article': { $exists: true, $ne: null }
        }
      },
      {
        $unwind: '$activeItems'
      },
      {
        $match: {
          'activeItems.article': { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: '$activeFloor',
          inTransitPairs: { $sum: '$activeItems.quantity' },
          containerCount: { $sum: 1 }
        }
      }
    ]);
    
    const transitByFloor = {};
    containersInTransit.forEach(c => {
      const floorKey = getFloorKeyFromName(c._id);
      if (floorKey) transitByFloor[floorKey] = c;
    });
    
    // Get 7-day throughput for backlog calculation
    const throughputByFloor = {};
    for (const floorKey of ALL_FLOOR_KEYS) {
      const throughput = await ArticleLog.aggregate([
        {
          $match: {
            toFloor: getFloorNameFromKey(floorKey),
            action: { $in: ['TRANSFERRED_TO_NEXT_FLOOR', 'WORK_COMPLETED'] },
            timestamp: { $gte: sevenDaysAgo }
          }
        },
        {
          $group: {
            _id: null,
            totalCompleted: { $sum: '$quantity' }
          }
        }
      ]);
      throughputByFloor[floorKey] = (throughput[0]?.totalCompleted || 0) / 7;
    }
    
    // Build floor data
    const floors = ALL_FLOOR_KEYS.map(floorKey => {
      const floorName = getFloorNameFromKey(floorKey);
      const stats = aggregateFloorStats(articles, floorKey);
      const transit = transitByFloor[floorKey] || { inTransitPairs: 0, containerCount: 0 };
      const avgDailyThroughput = throughputByFloor[floorKey] || 0;
      
      const backlogDays = avgDailyThroughput > 0 
        ? Math.round((stats.totalRemaining / avgDailyThroughput) * 10) / 10
        : 0;
      
      return {
        floor: floorName,
        floorKey,
        inTransit: transit.inTransitPairs,
        received: stats.totalReceived,
        wip: stats.totalRemaining,
        completed: stats.totalCompleted,
        transferred: stats.totalTransferred,
        articleCount: stats.articlesWithWip,
        backlogDays,
        avgDailyThroughput: Math.round(avgDailyThroughput),
        // QC metrics
        ...(isQcFloorKey(floorKey) ? {
          m1: stats.m1Total,
          m2: stats.m2Total,
          m3: stats.m3Total,
          m4: stats.m4Total
        } : {})
      };
    });
    
    // Find bottleneck
    const bottleneck = floors.reduce((worst, floor) => {
      if (!worst || floor.backlogDays > worst.backlogDays) return floor;
      return worst;
    }, null);
    
    return {
      data: {
        floors,
        bottleneck: bottleneck ? {
          floor: bottleneck.floor,
          floorKey: bottleneck.floorKey,
          backlogDays: bottleneck.backlogDays,
          wipPairs: bottleneck.wip
        } : null
      },
      asOf: now.toISOString(),
      warnings: []
    };
  });
};

/**
 * Get quality metrics (Zone E)
 */
export const getQualityMetrics = async (filters, qcFloor) => {
  const cacheKey = getCacheKey('quality', { ...filters, qcFloor });
  
  return getCached(cacheKey, CACHE_TTL.quality, async () => {
    const { from, to } = getDateRange(filters);
    const now = new Date();
    
    const targetFloorKey = qcFloor ? getFloorKeyFromName(qcFloor) : 'finalChecking';
    
    // Get articles with QC data
    const articles = await Article.find({
      [`floorQuantities.${targetFloorKey}.received`]: { $gt: 0 },
      updatedAt: { $gte: from, $lte: to }
    }).select('floorQuantities').lean();
    
    // Aggregate quality stats
    const stats = aggregateFloorStats(articles, targetFloorKey);
    
    // Calculate FPY for all QC floors
    const qcStats = {};
    for (const floorKey of QC_FLOOR_KEYS) {
      const floorStats = aggregateFloorStats(articles, floorKey);
      qcStats[floorKey] = {
        received: floorStats.totalReceived,
        m1: floorStats.m1Total,
        m2: floorStats.m2Total,
        m3: floorStats.m3Total,
        m4: floorStats.m4Total,
        fpy: floorStats.totalReceived > 0 
          ? Math.round((floorStats.m1Total / floorStats.totalReceived) * 100 * 10) / 10
          : 0
      };
    }
    
    // Calculate Rolled Throughput Yield
    const rty = Object.values(qcStats).reduce((acc, floor) => {
      return acc * (floor.fpy / 100);
    }, 1) * 100;
    
    // Get M2 recovery stats
    const m2Stats = await M2Log.aggregate([
      {
        $match: {
          timestamp: { $gte: from, $lte: to }
        }
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          quantity: { $sum: '$originalQuantity' }
        }
      }
    ]);
    
    const m2ByType = {};
    m2Stats.forEach(s => { m2ByType[s._id] = s; });
    
    const entryQty = m2ByType['ENTRY']?.quantity || 0;
    const mergedQty = m2ByType['MERGE_TO_M1']?.quantity || 0;
    const recoveryRate = entryQty > 0 ? Math.round((mergedQty / entryQty) * 100) : 0;
    
    // Open M2 count
    const openM2 = await M2Log.aggregate([
      {
        $match: {
          type: 'ENTRY',
          status: { $in: ['OPEN', 'PARTIAL'] }
        }
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          pairs: { $sum: '$remainingQuantity' }
        }
      }
    ]);
    
    return {
      data: {
        targetFloor: targetFloorKey,
        firstPassYield: stats.totalReceived > 0 
          ? Math.round((stats.m1Total / stats.totalReceived) * 100 * 10) / 10
          : 0,
        rolledThroughputYield: Math.round(rty * 10) / 10,
        qcFloorStats: qcStats,
        mMix: {
          m1: stats.m1Total,
          m2: stats.m2Total,
          m3: stats.m3Total,
          m4: stats.m4Total,
          total: stats.m1Total + stats.m2Total + stats.m3Total + stats.m4Total
        },
        m2Recovery: {
          entryCount: m2ByType['ENTRY']?.count || 0,
          entryQuantity: entryQty,
          mergedQuantity: mergedQty,
          recoveryRate,
          toM3: m2ByType['TRANSFER_TO_M3']?.quantity || 0,
          toM4: m2ByType['TRANSFER_TO_M4']?.quantity || 0
        },
        openM2: {
          count: openM2[0]?.count || 0,
          pairs: openM2[0]?.pairs || 0
        }
      },
      asOf: now.toISOString()
    };
  });
};

/**
 * Get machine utilization data (Zone F)
 */
export const getMachineUtilization = async (filters, options = {}) => {
  const cacheKey = getCacheKey('machines', { ...filters, ...options });
  
  return getCached(cacheKey, CACHE_TTL.machines, async () => {
    const now = new Date();
    const { status, limit = 20 } = options;
    
    // Get machines with queue data
    const machineQuery = status ? { status } : {};
    const machines = await Machine.find(machineQuery)
      .select('machineCode machineNumber status capacityPerDay nextMaintenanceDate')
      .lean();
    
    // Get queue data for each machine
    const assignments = await MachineOrderAssignment.find({ isActive: true })
      .select('machine productionOrderItems activeNeedle')
      .populate('productionOrderItems.article', 'plannedQuantity floorQuantities')
      .lean();
    
    const queueByMachine = {};
    assignments.forEach(a => {
      const machineId = a.machine?.toString();
      if (!machineId) return;
      
      if (!queueByMachine[machineId]) {
        queueByMachine[machineId] = {
          rows: 0,
          pendingPairs: 0,
          completedPairs: 0,
          needle: a.activeNeedle
        };
      }
      
      a.productionOrderItems?.forEach(item => {
        if (['Completed', 'On Hold', 'Cancelled'].includes(item.status)) return;
        queueByMachine[machineId].rows++;
        const pending = item.article?.plannedQuantity - (item.article?.floorQuantities?.knitting?.completed || 0);
        queueByMachine[machineId].pendingPairs += Math.max(0, pending || 0);
      });
    });
    
    // Build machine data with load info
    const machineData = machines.map(m => {
      const queue = queueByMachine[m._id.toString()] || { rows: 0, pendingPairs: 0, needle: null };
      const capacity = m.capacityPerDay || 500;
      const daysOfQueue = capacity > 0 ? Math.round((queue.pendingPairs / capacity) * 10) / 10 : 0;
      
      return {
        id: m._id,
        machineCode: m.machineCode,
        machineNumber: m.machineNumber,
        status: m.status,
        capacity,
        queueRows: queue.rows,
        pendingPairs: queue.pendingPairs,
        daysOfQueue,
        activeNeedle: queue.needle,
        maintenanceDue: m.nextMaintenanceDate,
        isOverloaded: daysOfQueue > 7,
        isStarved: m.status === 'Active' && queue.rows === 0
      };
    });
    
    // Sort by pending pairs descending
    machineData.sort((a, b) => b.pendingPairs - a.pendingPairs);
    
    // Status breakdown
    const statusCounts = {
      active: machines.filter(m => m.status === 'Active').length,
      idle: machines.filter(m => m.status === 'Idle').length,
      maintenance: machines.filter(m => m.status === 'Under Maintenance').length
    };
    
    // Machines with work
    const machinesWithWork = machineData.filter(m => m.queueRows > 0).length;
    
    return {
      data: {
        machines: machineData.slice(0, limit),
        totalMachines: machines.length,
        statusBreakdown: statusCounts,
        utilization: statusCounts.active > 0 
          ? Math.round((machinesWithWork / statusCounts.active) * 100)
          : 0,
        starvedCount: machineData.filter(m => m.isStarved).length,
        overloadedCount: machineData.filter(m => m.isOverloaded).length,
        maintenanceDueCount: machines.filter(m => 
          m.nextMaintenanceDate && new Date(m.nextMaintenanceDate) <= new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        ).length
      },
      asOf: now.toISOString()
    };
  });
};

/**
 * Get alerts (Zone 0)
 */
export const getAlerts = async (filters, options = {}) => {
  const cacheKey = getCacheKey('alerts', { ...filters, ...options });
  
  return getCached(cacheKey, CACHE_TTL.alerts, async () => {
    const now = new Date();
    const alerts = [];
    
    // 1. Floor backlog alerts
    const floorData = await getFloorHeatstrip(filters);
    floorData.data.floors.forEach(floor => {
      if (floor.backlogDays > 3) {
        alerts.push({
          id: `backlog-${floor.floorKey}`,
          severity: floor.backlogDays > 7 ? 'critical' : 'warning',
          category: 'throughput',
          title: `${floor.floor} has ${floor.backlogDays} days of backlog`,
          value: floor.backlogDays,
          valueLabel: `${floor.wip.toLocaleString()} pairs queued`,
          href: `/production/floor-supervisor/${floor.floorKey}`
        });
      }
    });
    
    // 2. Machine alerts
    const machineData = await getMachineUtilization(filters, { limit: 100 });
    if (machineData.data.starvedCount > 0) {
      alerts.push({
        id: 'machines-starved',
        severity: 'warning',
        category: 'machine',
        title: `${machineData.data.starvedCount} machines idle with no queue`,
        value: machineData.data.starvedCount,
        valueLabel: 'machines',
        href: '/production/floor-supervisor/knitting'
      });
    }
    
    // 3. Open M2 alert
    const qualityData = await getQualityMetrics(filters);
    if (qualityData.data.openM2.pairs > 500) {
      alerts.push({
        id: 'open-m2',
        severity: 'warning',
        category: 'quality',
        title: `${qualityData.data.openM2.count} open M2 entries`,
        value: qualityData.data.openM2.count,
        valueLabel: `${qualityData.data.openM2.pairs.toLocaleString()} pairs in repair`,
        href: '/production/m2-management'
      });
    }
    
    // Filter by severity/category if specified
    let filteredAlerts = alerts;
    if (options.severity) {
      filteredAlerts = filteredAlerts.filter(a => options.severity.includes(a.severity));
    }
    if (options.category) {
      filteredAlerts = filteredAlerts.filter(a => options.category.includes(a.category));
    }
    
    // Sort by severity
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    filteredAlerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
    
    return {
      data: {
        alerts: filteredAlerts,
        summary: {
          critical: filteredAlerts.filter(a => a.severity === 'critical').length,
          warning: filteredAlerts.filter(a => a.severity === 'warning').length,
          info: filteredAlerts.filter(a => a.severity === 'info').length
        }
      },
      asOf: now.toISOString()
    };
  });
};

/**
 * Get throughput trends (Zone D)
 */
export const getThroughputTrends = async (filters, granularity = 'daily') => {
  const { from, to } = getDateRange(filters);
  const cacheKey = getCacheKey('trends', { ...filters, granularity });
  
  return getCached(cacheKey, CACHE_TTL.trends, async () => {
    const dailyOutput = await DispatchStockTransferNote.aggregate([
      {
        $match: {
          stnDate: { $gte: from, $lte: to },
          status: { $ne: 'Cancelled' }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$stnDate' } },
          output: { $sum: '$totalQty' },
          stnCount: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    return {
      data: {
        output: dailyOutput.map(d => ({
          date: d._id,
          output: d.output,
          stnCount: d.stnCount
        })),
        granularity
      },
      range: { from, to }
    };
  });
};

/**
 * Get people metrics (Zone G)
 */
export const getPeopleMetrics = async (filters, groupBy = 'supervisor') => {
  const { from, to } = getDateRange(filters);
  const cacheKey = getCacheKey('people', { ...filters, groupBy });
  
  return getCached(cacheKey, CACHE_TTL.people, async () => {
    const groupField = groupBy === 'supervisor' ? '$floorSupervisorId' : '$shiftId';
    
    const metrics = await ArticleLog.aggregate([
      {
        $match: {
          timestamp: { $gte: from, $lte: to },
          action: { $in: ['WORK_COMPLETED', 'QUANTITY_UPDATED', 'TRANSFERRED_TO_NEXT_FLOOR'] }
        }
      },
      {
        $group: {
          _id: groupField,
          totalOutput: { $sum: '$quantity' },
          actionCount: { $sum: 1 }
        }
      },
      { $sort: { totalOutput: -1 } },
      { $limit: 20 }
    ]);
    
    return {
      data: {
        metrics,
        groupBy
      },
      range: { from, to }
    };
  });
};

/**
 * Get order ageing (Zone H)
 */
export const getOrderAgeing = async (filters, type = 'orders') => {
  const cacheKey = getCacheKey('ageing', { ...filters, type });
  
  return getCached(cacheKey, CACHE_TTL.ageing, async () => {
    const now = new Date();
    
    if (type === 'orders') {
      const orders = await ProductionOrder.aggregate([
        {
          $match: {
            status: { $in: ['Pending', 'In Progress'] }
          }
        },
        {
          $project: {
            orderNumber: 1,
            status: 1,
            ageDays: {
              $divide: [
                { $subtract: [now, '$updatedAt'] },
                1000 * 60 * 60 * 24
              ]
            }
          }
        },
        {
          $bucket: {
            groupBy: '$ageDays',
            boundaries: [0, 7, 15, 30, Infinity],
            default: '30+',
            output: {
              count: { $sum: 1 },
              orders: { $push: { orderNumber: '$orderNumber', ageDays: '$ageDays' } }
            }
          }
        }
      ]);
      
      return {
        data: {
          buckets: orders,
          type
        },
        asOf: now.toISOString()
      };
    }
    
    return { data: { buckets: [], type }, asOf: now.toISOString() };
  });
};

/**
 * Get yarn readiness (Zone I)
 */
export const getYarnReadiness = async (filters) => {
  const cacheKey = getCacheKey('yarn', filters);
  
  return getCached(cacheKey, CACHE_TTL.yarn, async () => {
    const now = new Date();
    
    const yarnBlocked = await MachineOrderAssignment.aggregate([
      {
        $match: {
          isActive: true
        }
      },
      { $unwind: '$productionOrderItems' },
      {
        $match: {
          'productionOrderItems.yarnIssueStatus': { $ne: 'Completed' },
          'productionOrderItems.status': { $nin: ['Completed', 'On Hold', 'Cancelled'] }
        }
      },
      {
        $group: {
          _id: null,
          blockedRows: { $sum: 1 }
        }
      }
    ]);
    
    return {
      data: {
        blockedRows: yarnBlocked[0]?.blockedRows || 0
      },
      asOf: now.toISOString()
    };
  });
};

/**
 * Get article performance (Zone J)
 */
export const getArticlePerformance = async (filters, options = {}) => {
  const { from, to } = getDateRange(filters);
  const { sortBy = 'volume', limit = 20 } = options;
  const cacheKey = getCacheKey('articles', { ...filters, sortBy, limit });
  
  return getCached(cacheKey, CACHE_TTL.articles, async () => {
    const sortField = sortBy === 'volume' ? 'dispatchTransferred' : 'defectRate';
    
    const articles = await Article.aggregate([
      {
        $match: {
          updatedAt: { $gte: from, $lte: to }
        }
      },
      {
        $project: {
          articleNumber: 1,
          dispatchTransferred: { $ifNull: ['$floorQuantities.dispatch.transferred', 0] },
          fcReceived: { $ifNull: ['$floorQuantities.finalChecking.received', 0] },
          fcM1: { $ifNull: ['$floorQuantities.finalChecking.m1Quantity', 0] }
        }
      },
      {
        $group: {
          _id: '$articleNumber',
          totalDispatched: { $sum: '$dispatchTransferred' },
          totalReceived: { $sum: '$fcReceived' },
          totalM1: { $sum: '$fcM1' }
        }
      },
      {
        $addFields: {
          defectRate: {
            $cond: [
              { $gt: ['$totalReceived', 0] },
              { $multiply: [{ $divide: [{ $subtract: ['$totalReceived', '$totalM1'] }, '$totalReceived'] }, 100] },
              0
            ]
          }
        }
      },
      { $sort: { [sortField]: -1 } },
      { $limit: limit }
    ]);
    
    return {
      data: {
        articles,
        sortBy
      },
      range: { from, to }
    };
  });
};

/**
 * Get exceptions (Zone K)
 */
export const getExceptions = async (filters, options = {}) => {
  const { type, page = 1, limit = 20 } = options;
  const cacheKey = getCacheKey('exceptions', { ...filters, type, page, limit });
  
  return getCached(cacheKey, CACHE_TTL.exceptions, async () => {
    const now = new Date();
    let items = [];
    let total = 0;
    
    switch (type) {
      case 'stalled-orders': {
        const stalledDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        items = await ProductionOrder.find({
          status: { $in: ['Pending', 'In Progress'] },
          updatedAt: { $lt: stalledDate }
        })
          .sort({ updatedAt: 1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .select('orderNumber status priority updatedAt')
          .lean();
        
        total = await ProductionOrder.countDocuments({
          status: { $in: ['Pending', 'In Progress'] },
          updatedAt: { $lt: stalledDate }
        });
        break;
      }
      
      case 'idle-machines': {
        const activeMachines = await Machine.find({ status: 'Active' })
          .select('_id machineCode machineNumber model floor')
          .lean();
        const machinesWithQueue = await MachineOrderAssignment.distinct('machine', { isActive: true });
        const machineIdsWithQueue = new Set(machinesWithQueue.map(m => m.toString()));
        
        const idleMachines = activeMachines.filter(m => !machineIdsWithQueue.has(m._id.toString()));
        total = idleMachines.length;
        items = idleMachines.slice((page - 1) * limit, page * limit);
        break;
      }
      
      case 'yarn-blocked': {
        const assignments = await MachineOrderAssignment.find({
          isActive: true,
          'productionOrderItems.yarnIssueStatus': 'Pending'
        })
          .populate('machine', 'machineCode machineNumber')
          .populate('productionOrderItems.article', 'articleNumber plannedQuantity')
          .sort({ createdAt: 1 })
          .lean();
        
        const yarnBlockedItems = [];
        for (const assignment of assignments) {
          for (const item of assignment.productionOrderItems || []) {
            if (item.yarnIssueStatus === 'Pending' && item.article) {
              yarnBlockedItems.push({
                _id: `${assignment._id}-${item.article._id}`,
                articleCode: item.article.articleNumber,
                machineCode: assignment.machine?.machineCode || assignment.machine?.machineNumber,
                quantity: item.article.plannedQuantity || 0,
                status: item.yarnIssueStatus
              });
            }
          }
        }
        
        total = yarnBlockedItems.length;
        items = yarnBlockedItems.slice((page - 1) * limit, page * limit);
        break;
      }
      
      case 'open-m2-aged': {
        const agedDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const articlesWithM2 = await Article.find({
          $or: [
            { 'floorQuantities.checking.m2Remaining': { $gt: 0 } },
            { 'floorQuantities.secondaryChecking.m2Remaining': { $gt: 0 } },
            { 'floorQuantities.finalChecking.m2Remaining': { $gt: 0 } }
          ],
          updatedAt: { $lt: agedDate }
        })
          .select('_id articleNumber floorQuantities updatedAt')
          .sort({ updatedAt: 1 })
          .lean();
        
        const m2Items = articlesWithM2.map(a => {
          const m2Qty = (a.floorQuantities?.checking?.m2Remaining || 0) +
            (a.floorQuantities?.secondaryChecking?.m2Remaining || 0) +
            (a.floorQuantities?.finalChecking?.m2Remaining || 0);
          const status = a.floorQuantities?.checking?.repairStatus ||
            a.floorQuantities?.secondaryChecking?.repairStatus ||
            a.floorQuantities?.finalChecking?.repairStatus || 'Pending';
          return {
            _id: a._id,
            articleCode: a.articleNumber,
            repairStatus: status,
            quantity: m2Qty,
            updatedAt: a.updatedAt
          };
        });
        
        total = m2Items.length;
        items = m2Items.slice((page - 1) * limit, page * limit);
        break;
      }
      
      case 'data-integrity': {
        const articles = await Article.find({})
          .select('_id articleNumber plannedQuantity floorQuantities')
          .lean();
        
        const dataIssues = articles.filter(a => {
          const planned = a.plannedQuantity || 0;
          const dispatched = a.floorQuantities?.dispatch?.transferred || 0;
          const wip = ALL_FLOOR_KEYS.reduce((sum, k) => 
            sum + (a.floorQuantities?.[k]?.remaining || 0), 0);
          const accounted = dispatched + wip;
          const diff = Math.abs(planned - accounted);
          return diff > planned * 0.1 && diff > 10;
        }).map(a => ({
          _id: a._id,
          articleCode: a.articleNumber,
          planned: a.plannedQuantity,
          accounted: (a.floorQuantities?.dispatch?.transferred || 0) + 
            ALL_FLOOR_KEYS.reduce((sum, k) => sum + (a.floorQuantities?.[k]?.remaining || 0), 0),
          difference: Math.abs((a.plannedQuantity || 0) - 
            ((a.floorQuantities?.dispatch?.transferred || 0) + 
            ALL_FLOOR_KEYS.reduce((sum, k) => sum + (a.floorQuantities?.[k]?.remaining || 0), 0)))
        }));
        
        total = dataIssues.length;
        items = dataIssues.slice((page - 1) * limit, page * limit);
        break;
      }
      
      default:
        break;
    }
    
    return {
      data: { items, type },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      asOf: now.toISOString()
    };
  });
};

/**
 * Get reconciliation (Zone L)
 */
export const getReconciliation = async (filters) => {
  const cacheKey = getCacheKey('reconciliation', filters);
  
  return getCached(cacheKey, CACHE_TTL.reconciliation, async () => {
    const now = new Date();
    
    const totals = await Article.aggregate([
      {
        $project: {
          planned: '$plannedQuantity',
          dispatched: { $ifNull: ['$floorQuantities.dispatch.transferred', 0] },
          wip: {
            $add: ALL_FLOOR_KEYS.map(k => ({ $ifNull: [`$floorQuantities.${k}.remaining`, 0] }))
          },
          m3Out: { $ifNull: ['$m3Tracking.outwardTotal', 0] },
          m4Out: { $ifNull: ['$m4Tracking.outwardTotal', 0] }
        }
      },
      {
        $group: {
          _id: null,
          totalPlanned: { $sum: '$planned' },
          totalDispatched: { $sum: '$dispatched' },
          totalWip: { $sum: '$wip' },
          totalM3Out: { $sum: '$m3Out' },
          totalM4Out: { $sum: '$m4Out' }
        }
      }
    ]);
    
    const t = totals[0] || { totalPlanned: 0, totalDispatched: 0, totalWip: 0, totalM3Out: 0, totalM4Out: 0 };
    const accounted = t.totalDispatched + t.totalWip + t.totalM3Out + t.totalM4Out;
    const unaccounted = t.totalPlanned - accounted;
    const unaccountedPct = t.totalPlanned > 0 ? Math.round((unaccounted / t.totalPlanned) * 100 * 10) / 10 : 0;
    
    return {
      data: {
        planned: t.totalPlanned,
        dispatched: t.totalDispatched,
        wip: t.totalWip,
        m3Out: t.totalM3Out,
        m4Out: t.totalM4Out,
        unaccounted,
        unaccountedPct,
        isHealthy: Math.abs(unaccountedPct) < 0.5
      },
      asOf: now.toISOString()
    };
  });
};

/**
 * Export dashboard (placeholder)
 */
export const exportDashboard = async (filters, options = {}) => {
  return { buffer: Buffer.from('Export not implemented') };
};

export default {
  getDashboardSummary,
  getFloorHeatstrip,
  getQualityMetrics,
  getMachineUtilization,
  getAlerts,
  getThroughputTrends,
  getPeopleMetrics,
  getOrderAgeing,
  getYarnReadiness,
  getArticlePerformance,
  getExceptions,
  getReconciliation,
  exportDashboard
};
