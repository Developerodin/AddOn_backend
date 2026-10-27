import httpStatus from 'http-status';
import pick from '../utils/pick.js';
import catchAsync from '../utils/catchAsync.js';
import * as taskService from '../services/task.service.js';
import * as taskNotificationService from '../services/taskNotification.service.js';

const createTask = catchAsync(async (req, res) => {
  const task = await taskService.createTask(req.body, req.user);
  res.status(httpStatus.CREATED).send(task);
});

const getTasks = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status', 'priority', 'assignee', 'search', 'scope']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await taskService.queryTasks(filter, options, req.user);
  res.send(result);
});

const getTask = catchAsync(async (req, res) => {
  const task = await taskService.getTaskById(req.params.taskId, req.user);
  res.send(task);
});

const updateTask = catchAsync(async (req, res) => {
  const task = await taskService.updateTask(req.params.taskId, req.body, req.user);
  res.send(task);
});

const addTimeline = catchAsync(async (req, res) => {
  const task = await taskService.addTimelineEntry(req.params.taskId, req.body, req.user);
  res.status(httpStatus.CREATED).send(task);
});

const getNotifications = catchAsync(async (req, res) => {
  const result = await taskNotificationService.listNotifications(req.user, req.query.screen);
  res.send(result);
});

const markNotificationsRead = catchAsync(async (req, res) => {
  const result = await taskNotificationService.markNotificationsRead(req.user, req.body);
  if (!result) {
    return res.status(httpStatus.NOT_FOUND).send({ message: 'Notification not found' });
  }
  res.send(result);
});

export { createTask, getTasks, getTask, updateTask, addTimeline, getNotifications, markNotificationsRead };
