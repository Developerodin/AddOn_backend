import Joi from 'joi';
import { objectId } from './custom.validation.js';

const createFolder = {
  body: Joi.object().keys({
    name: Joi.string().required().trim().min(1).max(255),
    parentFolder: Joi.string().custom(objectId).optional(),
    description: Joi.string().trim().max(1000).allow('').optional(),
    metadata: Joi.object().optional(),
  }),
};

const createFile = {
  body: Joi.object().keys({
    fileName: Joi.string().required().trim().min(1).max(255),
    fileUrl: Joi.string().required().uri().trim(),
    fileKey: Joi.string().required().trim().min(1),
    parentFolder: Joi.string().custom(objectId).optional(),
    fileSize: Joi.number().integer().min(0).optional(),
    mimeType: Joi.string().trim().optional(),
    metadata: Joi.object().optional(),
  }),
};

const getFolder = {
  params: Joi.object().keys({
    folderId: Joi.string().custom(objectId).required(),
  }),
};

const getFile = {
  params: Joi.object().keys({
    fileId: Joi.string().custom(objectId).required(),
  }),
};

const getFolderContents = {
  params: Joi.object().keys({
    folderId: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    sortBy: Joi.string().optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
    page: Joi.number().integer().min(1).optional(),
  }),
};

const getRootFolders = {
  query: Joi.object().keys({
    sortBy: Joi.string().optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
    page: Joi.number().integer().min(1).optional(),
  }),
};

const getFolderTree = {
  query: Joi.object().keys({
    rootFolderId: Joi.string().custom(objectId).optional(),
  }),
};

const updateFolder = {
  params: Joi.object().keys({
    folderId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    name: Joi.string().trim().min(1).max(255).optional(),
    description: Joi.string().trim().max(1000).allow('').optional(),
    metadata: Joi.object().optional(),
  }),
};

const updateFile = {
  params: Joi.object().keys({
    fileId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    fileName: Joi.string().trim().min(1).max(255).optional(),
    fileUrl: Joi.string().uri().trim().optional(),
    fileKey: Joi.string().trim().min(1).optional(),
    fileSize: Joi.number().integer().min(0).optional(),
    mimeType: Joi.string().trim().optional(),
    metadata: Joi.object().optional(),
  }),
};

const deleteFolder = {
  params: Joi.object().keys({
    folderId: Joi.string().custom(objectId).required(),
  }),
};

const deleteFile = {
  params: Joi.object().keys({
    fileId: Joi.string().custom(objectId).required(),
  }),
};

const deleteMultipleItems = {
  body: Joi.object().keys({
    itemIds: Joi.array().items(Joi.string().custom(objectId)).min(1).required(),
  }),
};

const searchItems = {
  query: Joi.object().keys({
    query: Joi.string().required().trim().min(1),
    type: Joi.string().valid('folder', 'file').optional(),
    userId: Joi.string().custom(objectId).optional(),
    sortBy: Joi.string().optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
    page: Joi.number().integer().min(1).optional(),
  }),
};

const getDashboard = {
  query: Joi.object().keys({
    limit: Joi.number().integer().min(1).max(50).optional(),
  }),
};

export {
  createFolder,
  createFile,
  getFolder,
  getFile,
  getFolderContents,
  getRootFolders,
  getFolderTree,
  updateFolder,
  updateFile,
  deleteFolder,
  deleteFile,
  deleteMultipleItems,
  searchItems,
  getDashboard,
}; 