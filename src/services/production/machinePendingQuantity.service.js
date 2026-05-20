import httpStatus from 'http-status';
import mongoose from 'mongoose';
import ApiError from '../../utils/ApiError.js';
import Machine from '../../models/machine.model.js';
import MachineOrderAssignment from '../../models/production/machineOrderAssignment.model.js';
import { OrderStatus } from '../../models/production/enums.js';

/** Queue item statuses excluded from pending workload (same as top-items). */
const EXCLUDED_ITEM_STATUSES = [OrderStatus.COMPLETED, OrderStatus.ON_HOLD, OrderStatus.CANCELLED];

const toNumber = (v) => Number(v ?? 0);

/**
 * Resolve Mongo id from populated or raw ref.
 * @param {unknown} ref
 * @returns {string}
 */
const refId = (ref) => {
  if (ref == null) return '';
  if (typeof ref === 'object' && (ref._id || ref.id)) {
    return String(ref._id ?? ref.id);
  }
  return String(ref);
};

/**
 * Knitting units still pending for one article document.
 * @param {Record<string, unknown>|null|undefined} article
 * @returns {number}
 */
export const resolveArticleKnittingPendingQuantity = (article) => {
  if (!article || typeof article !== 'object') return 0;
  const planned = toNumber(article.plannedQuantity);
  const knitting = article.floorQuantities?.knitting;
  if (knitting && knitting.remaining != null && !Number.isNaN(Number(knitting.remaining))) {
    return Math.max(0, toNumber(knitting.remaining));
  }
  const completed = toNumber(knitting?.completed);
  if (planned > 0) {
    return Math.max(0, planned - completed);
  }
  return 0;
};

/**
 * Whether a machine-queue row still contributes to pending workload.
 * @param {{ status?: string }} item
 * @returns {boolean}
 */
const isActiveQueueItem = (item) => {
  const st = String(item?.status ?? OrderStatus.PENDING);
  return !EXCLUDED_ITEM_STATUSES.includes(st);
};

/**
 * Sum pending knitting quantity for one assignment document.
 * @param {Record<string, unknown>|null|undefined} assignment
 * @returns {{ pendingQuantity: number, activeItemCount: number }}
 */
export const sumPendingQuantityFromAssignment = (assignment) => {
  if (!assignment) {
    return { pendingQuantity: 0, activeItemCount: 0 };
  }
  let pendingQuantity = 0;
  let activeItemCount = 0;
  const items = assignment.productionOrderItems || [];
  for (const item of items) {
    if (!isActiveQueueItem(item)) continue;
    activeItemCount += 1;
    const art = item.article;
    pendingQuantity += resolveArticleKnittingPendingQuantity(
      typeof art === 'object' && art ? art : null
    );
  }
  return { pendingQuantity, activeItemCount };
};

/**
 * Pending knitting quantity for a single machine (active assignment queue only).
 * @param {import('mongoose').Types.ObjectId|string} machineId
 * @returns {Promise<{
 *   machineId: string,
 *   machineCode: string|null,
 *   activeNeedle: string|null,
 *   pendingQuantity: number,
 *   activeItemCount: number,
 *   generatedAt: string
 * }>}
 */
export const getMachinePendingQuantityById = async (machineId) => {
  if (!mongoose.Types.ObjectId.isValid(machineId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid machine id');
  }

  const [machine, assignment] = await Promise.all([
    Machine.findById(machineId).select('machineCode activeNeedle').lean(),
    MachineOrderAssignment.findOne({ machine: machineId, isActive: true })
      .populate('productionOrderItems.article')
      .lean(),
  ]);

  if (!machine) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine not found');
  }

  const { pendingQuantity, activeItemCount } = sumPendingQuantityFromAssignment(assignment);

  return {
    machineId: String(machineId),
    machineCode: machine.machineCode ?? null,
    activeNeedle: assignment?.activeNeedle ?? machine.activeNeedle ?? null,
    pendingQuantity,
    activeItemCount,
    generatedAt: new Date().toISOString(),
  };
};

/**
 * Pending knitting quantities for multiple machines (drawer / batch lookup).
 * @param {Array<import('mongoose').Types.ObjectId|string>} machineIds
 * @returns {Promise<{
 *   generatedAt: string,
 *   results: Array<{
 *     machineId: string,
 *     machineCode: string|null,
 *     activeNeedle: string|null,
 *     pendingQuantity: number,
 *     activeItemCount: number
 *   }>
 * }>}
 */
export const getMachinePendingQuantitiesByIds = async (machineIds) => {
  const uniqueIds = [...new Set((machineIds || []).map((id) => String(id).trim()).filter(Boolean))];
  if (uniqueIds.length === 0) {
    return { generatedAt: new Date().toISOString(), results: [] };
  }

  const invalid = uniqueIds.filter((id) => !mongoose.Types.ObjectId.isValid(id));
  if (invalid.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Invalid machine id(s): ${invalid.join(', ')}`);
  }

  const objectIds = uniqueIds.map((id) => new mongoose.Types.ObjectId(id));

  const [machines, assignments] = await Promise.all([
    Machine.find({ _id: { $in: objectIds } }).select('machineCode activeNeedle').lean(),
    MachineOrderAssignment.find({ machine: { $in: objectIds }, isActive: true })
      .populate('productionOrderItems.article')
      .lean(),
  ]);

  /** @type {Map<string, Record<string, unknown>>} */
  const machineById = new Map(machines.map((m) => [String(m._id), m]));
  /** @type {Map<string, Record<string, unknown>>} */
  const assignmentByMachineId = new Map(assignments.map((a) => [refId(a.machine), a]));

  const results = uniqueIds.map((machineId) => {
    const machine = machineById.get(machineId);
    const assignment = assignmentByMachineId.get(machineId);
    const { pendingQuantity, activeItemCount } = sumPendingQuantityFromAssignment(assignment);
    return {
      machineId,
      machineCode: machine?.machineCode ?? null,
      activeNeedle: assignment?.activeNeedle ?? machine?.activeNeedle ?? null,
      pendingQuantity,
      activeItemCount,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    results,
  };
};
