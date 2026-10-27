import TaskNotification from '../models/taskNotification.model.js';

/**
 * User id from a mongoose doc or auth user.
 * @param {{ id?: string, _id?: unknown }} user
 * @returns {string}
 */
const actorId = (user) => String(user?.id || user?._id || '');

/**
 * Tell the assignee a task was given to them.
 * @param {{ _id: unknown, title: string }} task
 * @param {{ id?: string, name?: string }} actor
 */
const notifyAssigned = async (task, actor) => {
  await TaskNotification.create({
    user: task.assignee,
    task: task._id,
    type: 'assigned',
    title: task.title,
    message: `${actor.name || 'Someone'} assigned you a task`,
    readAt: null,
  });
};

/** Types that belong on the Task Manager bell. */
const MANAGER_TYPES = ['completed', 'status', 'comment', 'attachment'];

/**
 * Bell filter for one screen. Manager sees assigner notes. My Tasks sees assignments.
 * @param {'manager' | 'my'} screen
 * @returns {string | { $in: string[] }}
 */
const typeForScreen = (screen) => (screen === 'manager' ? { $in: MANAGER_TYPES } : 'assigned');

/**
 * Tell the assigner their task was completed.
 * @param {{ _id: unknown, title: string, assignedBy: unknown }} task
 * @param {{ id?: string, name?: string }} actor
 */
const notifyCompleted = async (task, actor) => {
  await TaskNotification.create({
    user: task.assignedBy,
    task: task._id,
    type: 'completed',
    title: task.title,
    message: `${actor.name || 'Someone'} completed this task`,
    readAt: null,
  });
};

/**
 * Tell the assigner about a status change, note, or file upload.
 * @param {{ _id: unknown, title: string, assignedBy: unknown }} task
 * @param {'status' | 'comment' | 'attachment'} type
 * @param {string} message
 */
const notifyAssigner = async (task, type, message) => {
  await TaskNotification.create({
    user: task.assignedBy,
    task: task._id,
    type,
    title: task.title,
    message,
    readAt: null,
  });
};

/**
 * Notifications for one bell. Manager sees assigner activity. My Tasks sees assignments.
 * @param {{ id?: string }} actor
 * @param {'manager' | 'my'} screen
 */
const listNotifications = async (actor, screen) => {
  const type = typeForScreen(screen);
  const filter = { user: actorId(actor), type };
  const [results, unreadCount] = await Promise.all([
    TaskNotification.find(filter).sort({ createdAt: -1 }).limit(30),
    TaskNotification.countDocuments({ ...filter, readAt: null }),
  ]);
  return { results, unreadCount };
};

/**
 * Mark one notification, or every unread note on a screen.
 * @param {{ id?: string }} actor
 * @param {{ id?: string, screen?: 'manager' | 'my', all?: boolean }} body
 */
const markNotificationsRead = async (actor, body) => {
  const now = new Date();
  if (body.all && body.screen) {
    const type = typeForScreen(body.screen);
    await TaskNotification.updateMany(
      { user: actorId(actor), type, readAt: null },
      { $set: { readAt: now } }
    );
    return listNotifications(actor, body.screen);
  }
  const note = await TaskNotification.findOne({ _id: body.id, user: actorId(actor) });
  if (!note) return null;
  note.readAt = now;
  await note.save();
  return note;
};

export { notifyAssigned, notifyCompleted, notifyAssigner, listNotifications, markNotificationsRead };
