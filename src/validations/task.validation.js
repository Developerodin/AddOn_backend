import Joi from 'joi';
import { objectId } from './custom.validation.js';

const statuses = ['open', 'in_progress', 'follow_up', 'hold', 'done', 'cancelled'];
const priorities = ['low', 'medium', 'high'];

const fileRef = Joi.object().keys({
  url: Joi.string().required(),
  key: Joi.string().allow('', null),
  name: Joi.string().required(),
  mimeType: Joi.string().allow('', null),
  size: Joi.number().min(0),
});

const createTask = {
  body: Joi.object().keys({
    title: Joi.string().trim().min(1).max(200).required(),
    description: Joi.string().allow('').max(5000),
    assignee: Joi.string().custom(objectId).required(),
    priority: Joi.string().valid(...priorities),
    dueDate: Joi.date().allow(null),
    images: Joi.array().items(fileRef).max(10),
    attachments: Joi.array().items(fileRef).max(10),
  }),
};

const getTasks = {
  query: Joi.object().keys({
    status: Joi.string().valid(...statuses),
    priority: Joi.string().valid(...priorities),
    assignee: Joi.string().custom(objectId),
    search: Joi.string().allow(''),
    scope: Joi.string().valid('manager', 'my').required(),
    sortBy: Joi.string(),
    limit: Joi.number().integer().min(1).max(100),
    page: Joi.number().integer().min(1),
  }),
};

const getTask = {
  params: Joi.object().keys({
    taskId: Joi.string().custom(objectId).required(),
  }),
};

const updateTask = {
  params: Joi.object().keys({
    taskId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      status: Joi.string().valid(...statuses).required(),
      remark: Joi.string().allow('').max(2000),
    }),
};

const addTimeline = {
  params: Joi.object().keys({
    taskId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      comment: Joi.string().allow('').max(2000),
      images: Joi.array().items(fileRef).max(10),
      attachments: Joi.array().items(fileRef).max(10),
    })
    .or('comment', 'images', 'attachments'),
};

const getNotifications = {
  query: Joi.object().keys({
    screen: Joi.string().valid('manager', 'my').required(),
  }),
};

const markNotificationsRead = {
  body: Joi.object()
    .keys({
      id: Joi.string().custom(objectId),
      screen: Joi.string().valid('manager', 'my'),
      all: Joi.boolean(),
    })
    .or('id', 'all'),
};

export { createTask, getTasks, getTask, updateTask, addTimeline, getNotifications, markNotificationsRead };
