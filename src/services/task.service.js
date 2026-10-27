import httpStatus from 'http-status';
import ApiError from '../utils/ApiError.js';
import Task from '../models/task.model.js';
import User from '../models/user.model.js';
import { notifyAssigned, notifyCompleted, notifyAssigner } from './taskNotification.service.js';

const STATUS_LABELS = {
  open: 'Open',
  in_progress: 'In progress',
  follow_up: 'Follow up',
  hold: 'Hold',
  done: 'Complete',
  cancelled: 'Cancelled',
};

/**
 * True when the caller may open Task Manager and assign tasks.
 * Missing and legacy boolean true do not grant this. Only the stored flag does.
 * @param {{ navigation?: { Tasks?: boolean | Object } }} user
 * @returns {boolean}
 */
const canManage = (user) => {
  const tasks = user?.navigation?.Tasks;
  return Boolean(tasks && typeof tasks === 'object' && tasks['Task Manager'] === true);
};

/**
 * True when the caller may open My Tasks.
 * Missing and legacy boolean true count as My Tasks. An explicit false does not.
 * @param {{ navigation?: { Tasks?: boolean | Object } }} user
 * @returns {boolean}
 */
const canUseMyTasks = (user) => {
  const tasks = user?.navigation?.Tasks;
  if (tasks === undefined || tasks === true) return true;
  if (tasks === false) return false;
  return Boolean(tasks && typeof tasks === 'object' && tasks['My Tasks'] === true);
};

/**
 * User id from a mongoose doc or a lean auth user.
 * @param {{ id?: string, _id?: unknown }} user
 * @returns {string}
 */
const actorId = (user) => String(user?.id || user?._id || '');

/**
 * Compare two user refs after populate or as raw ids.
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
const sameId = (left, right) => {
  const read = (value) => {
    if (!value) return '';
    if (typeof value === 'object' && value._id) return String(value._id);
    return String(value);
  };
  return read(left) !== '' && read(left) === read(right);
};

/**
 * Attach assignee, assigner, and timeline actors without passwords.
 * @param {import('mongoose').Query} query
 * @returns {import('mongoose').Query}
 */
const withPeople = (query) =>
  query
    .populate('assignee', 'name email')
    .populate('assignedBy', 'name email')
    .populate('timeline.actor', 'name email');

/**
 * Escape user text before it is used in a Mongo regex.
 * @param {string} value
 * @returns {string}
 */
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Scope the list to tasks the caller assigned, or tasks assigned to them.
 * @param {Object} filter
 * @param {{ id?: string }} actor
 * @returns {Object}
 */
const buildFilter = (filter, actor) => {
  if (filter.scope !== 'manager' && filter.scope !== 'my') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Screen scope is required');
  }
  const mongoFilter = filter.scope === 'manager'
    ? { assignedBy: actorId(actor) }
    : { assignee: actorId(actor) };
  if (filter.scope === 'manager' && filter.assignee) mongoFilter.assignee = filter.assignee;
  if (filter.status) mongoFilter.status = filter.status;
  if (filter.priority) mongoFilter.priority = filter.priority;
  if (filter.search) {
    const pattern = new RegExp(escapeRegex(filter.search), 'i');
    mongoFilter.$or = [{ title: pattern }, { description: pattern }];
  }
  return mongoFilter;
};

/**
 * Parse `field:desc` into a mongoose sort object.
 * @param {string | undefined} sortBy
 * @returns {Record<string, 1 | -1>}
 */
const parseSort = (sortBy) => {
  if (!sortBy) return { createdAt: -1 };
  const [field, order] = sortBy.split(':');
  const allowed = ['createdAt', 'dueDate', 'priority', 'status', 'title'];
  if (!allowed.includes(field)) return { createdAt: -1 };
  return { [field]: order === 'asc' ? 1 : -1 };
};

/**
 * Append a status-change timeline row. Hold and Complete need a remark.
 * @param {import('mongoose').Document} task
 * @param {string} status
 * @param {string | undefined} remark
 * @param {{ id?: string }} actor
 */
const applyStatus = (task, status, remark, actor) => {
  if (task.status === status) return;
  const note = (remark || '').trim();
  if ((status === 'hold' || status === 'done') && !note) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A remark is required');
  }
  const fromStatus = task.status;
  task.status = status;
  const fromLabel = STATUS_LABELS[fromStatus] || fromStatus;
  const toLabel = STATUS_LABELS[status] || status;
  task.timeline.push({
    type: 'status_change',
    message: note
      ? `Status changed from ${fromLabel} to ${toLabel}. Remark: ${note}`
      : `Status changed from ${fromLabel} to ${toLabel}`,
    actor: actorId(actor),
    at: new Date(),
    fromStatus,
    toStatus: status,
  });
};

/**
 * Assignee or the person who assigned the task may open it.
 * @param {import('mongoose').Document} task
 * @param {{ id?: string }} actor
 */
const assertCanView = (task, actor) => {
  const me = actorId(actor);
  if (sameId(task.assignee, me) || sameId(task.assignedBy, me)) return;
  throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
};

/**
 * Status, notes, and files belong to the assignee.
 * @param {import('mongoose').Document} task
 * @param {{ id?: string }} actor
 */
const assertCanEdit = (task, actor) => {
  if (sameId(task.assignee, actorId(actor))) return;
  throw new ApiError(httpStatus.FORBIDDEN, 'Only the assignee can update this task');
};

/**
 * "2 images and 1 file" for timeline rows and the assigner bell.
 * @param {number} imageCount
 * @param {number} fileCount
 * @returns {string}
 */
const fileSummary = (imageCount, fileCount) => {
  const parts = [];
  if (imageCount) parts.push(`${imageCount} image${imageCount === 1 ? '' : 's'}`);
  if (fileCount) parts.push(`${fileCount} file${fileCount === 1 ? '' : 's'}`);
  return parts.join(' and ');
};

/**
 * Push uploaded files onto the task and write one timeline row.
 * @param {import('mongoose').Document} task
 * @param {Object[]} images
 * @param {Object[]} attachments
 * @param {{ id?: string }} actor
 */
const pushFiles = (task, images, attachments, actor) => {
  const imageCount = images.length;
  const fileCount = attachments.length;
  if (imageCount) task.images.push(...images);
  if (fileCount) task.attachments.push(...attachments);
  if (!imageCount && !fileCount) return;
  task.timeline.push({
    type: 'attachment',
    message: `Added ${fileSummary(imageCount, fileCount)}`,
    actor: actorId(actor),
    at: new Date(),
  });
};

/**
 * Bell the assigner when status actually changed. Complete keeps its own note.
 * @param {import('mongoose').Document} task
 * @param {string} previousStatus
 * @param {string | undefined} remark
 * @param {{ id?: string, name?: string }} actor
 */
const notifyStatusChange = async (task, previousStatus, remark, actor) => {
  if (task.status === previousStatus || sameId(task.assignedBy, actorId(actor))) return;
  try {
    if (task.status === 'done') {
      await notifyCompleted(task, actor);
      return;
    }
    const fromLabel = STATUS_LABELS[previousStatus] || previousStatus;
    const toLabel = STATUS_LABELS[task.status] || task.status;
    const name = actor.name || 'Someone';
    let message = `${name} changed status from ${fromLabel} to ${toLabel}`;
    const note = (remark || '').trim();
    if (note) message += `. ${note.slice(0, 140)}`;
    await notifyAssigner(task, 'status', message);
  } catch (error) {
    console.error('Task status notification failed', error);
  }
};

/**
 * One bell item for a note, files, or both. Silent when the assigner is the actor.
 * @param {import('mongoose').Document} task
 * @param {string} comment
 * @param {Object[]} images
 * @param {Object[]} attachments
 * @param {{ id?: string, name?: string }} actor
 */
const notifyTimeline = async (task, comment, images, attachments, actor) => {
  if (sameId(task.assignedBy, actorId(actor))) return;
  const name = actor.name || 'Someone';
  const files = fileSummary(images.length, attachments.length);
  const type = comment ? 'comment' : 'attachment';
  const message = comment && files
    ? `${name} added a note and ${files}`
    : comment
      ? `${name} added a note`
      : `${name} added ${files}`;
  try {
    await notifyAssigner(task, type, message);
  } catch (error) {
    console.error('Task timeline notification failed', error);
  }
};

/**
 * Create a task. Allowed for anyone with Task Manager access, including self-assign.
 * @param {Object} body
 * @param {{ id?: string, name?: string, navigation?: Object }} actor
 * @returns {Promise<import('mongoose').Document>}
 */
const createTask = async (body, actor) => {
  if (!canManage(actor)) throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  const assignee = await User.findById(body.assignee);
  if (!assignee) throw new ApiError(httpStatus.BAD_REQUEST, 'Assignee not found');
  const task = await Task.create({
    title: body.title,
    description: body.description || '',
    assignee: assignee._id,
    assignedBy: actorId(actor),
    priority: body.priority || 'medium',
    status: 'open',
    dueDate: body.dueDate || null,
    images: body.images || [],
    attachments: body.attachments || [],
    timeline: [
      {
        type: 'created',
        message: `Task assigned to ${assignee.name}`,
        actor: actorId(actor),
        at: new Date(),
      },
    ],
  });
  if (!sameId(assignee._id, actorId(actor))) {
    try {
      await notifyAssigned(task, actor);
    } catch (error) {
      console.error('Task assignment notification failed', error);
    }
  }
  return withPeople(Task.findById(task._id));
};

/**
 * Page tasks visible to the caller.
 * @param {Object} filter
 * @param {{ sortBy?: string, limit?: number, page?: number }} options
 * @param {{ id?: string, role?: string }} actor
 * @returns {Promise<{ results: unknown[], page: number, limit: number, totalPages: number, totalResults: number }>}
 */
const queryTasks = async (filter, options, actor) => {
  if (filter.scope === 'manager' && !canManage(actor)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  }
  if (filter.scope === 'my' && !canUseMyTasks(actor)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  }
  const mongoFilter = buildFilter(filter, actor);
  const limit = options.limit && Number(options.limit) > 0 ? Number(options.limit) : 20;
  const page = options.page && Number(options.page) > 0 ? Number(options.page) : 1;
  const skip = (page - 1) * limit;
  const [totalResults, results] = await Promise.all([
    Task.countDocuments(mongoFilter),
    withPeople(Task.find(mongoFilter).sort(parseSort(options.sortBy)).skip(skip).limit(limit)),
  ]);
  return {
    results,
    page,
    limit,
    totalPages: Math.ceil(totalResults / limit) || 1,
    totalResults,
  };
};

/**
 * Load one task when the caller is allowed to see it.
 * @param {string} taskId
 * @param {{ id?: string, role?: string }} actor
 * @returns {Promise<import('mongoose').Document>}
 */
const getTaskById = async (taskId, actor) => {
  const task = await withPeople(Task.findById(taskId));
  if (!task) throw new ApiError(httpStatus.NOT_FOUND, 'Task not found');
  assertCanView(task, actor);
  return task;
};

/**
 * Assignee changes status. Hold and Complete require a remark.
 * @param {string} taskId
 * @param {{ status?: string, remark?: string }} body
 * @param {{ id?: string, name?: string }} actor
 * @returns {Promise<import('mongoose').Document>}
 */
const updateTask = async (taskId, body, actor) => {
  const task = await Task.findById(taskId);
  if (!task) throw new ApiError(httpStatus.NOT_FOUND, 'Task not found');
  assertCanEdit(task, actor);
  if (!body.status) throw new ApiError(httpStatus.BAD_REQUEST, 'Status is required');
  const previousStatus = task.status;
  applyStatus(task, body.status, body.remark, actor);
  await task.save();
  await notifyStatusChange(task, previousStatus, body.remark, actor);
  return withPeople(Task.findById(task._id));
};

/**
 * Add a comment and/or uploaded files to the timeline.
 * @param {string} taskId
 * @param {{ comment?: string, images?: Object[], attachments?: Object[] }} body
 * @param {{ id?: string, role?: string }} actor
 * @returns {Promise<import('mongoose').Document>}
 */
const addTimelineEntry = async (taskId, body, actor) => {
  const task = await Task.findById(taskId);
  if (!task) throw new ApiError(httpStatus.NOT_FOUND, 'Task not found');
  assertCanEdit(task, actor);
  const comment = (body.comment || '').trim();
  const images = body.images || [];
  const attachments = body.attachments || [];
  if (!comment && images.length === 0 && attachments.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Comment or file is required');
  }
  if (comment) {
    task.timeline.push({
      type: 'comment',
      message: comment,
      actor: actorId(actor),
      at: new Date(),
    });
  }
  pushFiles(task, images, attachments, actor);
  await task.save();
  await notifyTimeline(task, comment, images, attachments, actor);
  return withPeople(Task.findById(task._id));
};

export { createTask, queryTasks, getTaskById, updateTask, addTimelineEntry };
