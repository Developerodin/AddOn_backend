import httpStatus from 'http-status';
import pick from '../utils/pick.js';
import catchAsync from '../utils/catchAsync.js';
import * as fileManagerService from '../services/fileManager.service.js';

/**
 * Create a folder
 * @route POST /v1/file-manager/folders
 * @access Private
 */
const createFolder = catchAsync(async (req, res) => {
  const folderBody = {
    ...req.body,
    createdBy: req.user.id,
  };
  
  const folder = await fileManagerService.createFolder(folderBody);
  res.status(httpStatus.CREATED).send(folder);
});

/**
 * Create a file
 * @route POST /v1/file-manager/files
 * @access Private
 */
const createFile = catchAsync(async (req, res) => {
  const fileBody = {
    ...req.body,
    uploadedBy: req.user.id,
  };
  
  const file = await fileManagerService.createFile(fileBody);
  res.status(httpStatus.CREATED).send(file);
});

/**
 * Get folder by id
 * @route GET /v1/file-manager/folders/:folderId
 * @access Private
 */
const getFolder = catchAsync(async (req, res) => {
  const folder = await fileManagerService.getFolderById(req.params.folderId);
  res.send(folder);
});

/**
 * Get file by id
 * @route GET /v1/file-manager/files/:fileId
 * @access Private
 */
const getFile = catchAsync(async (req, res) => {
  const file = await fileManagerService.getFileById(req.params.fileId);
  res.send(file);
});

/**
 * Get folder contents
 * @route GET /v1/file-manager/folders/:folderId/contents
 * @access Private
 */
const getFolderContents = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await fileManagerService.getFolderContents(req.params.folderId, options);
  res.send(result);
});

/**
 * Get root folders for current user
 * @route GET /v1/file-manager/root-folders
 * @access Private
 */
const getRootFolders = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await fileManagerService.getRootFolders(req.user.id, options);
  res.send(result);
});

/**
 * Get folder tree for current user
 * @route GET /v1/file-manager/folder-tree
 * @access Private
 */
const getFolderTree = catchAsync(async (req, res) => {
  const { rootFolderId } = req.query;
  const tree = await fileManagerService.getFolderTree(req.user.id, rootFolderId);
  res.send(tree);
});

/**
 * Update folder
 * @route PATCH /v1/file-manager/folders/:folderId
 * @access Private
 */
const updateFolder = catchAsync(async (req, res) => {
  const folder = await fileManagerService.updateFolder(req.params.folderId, req.body);
  res.send(folder);
});

/**
 * Update file
 * @route PATCH /v1/file-manager/files/:fileId
 * @access Private
 */
const updateFile = catchAsync(async (req, res) => {
  const file = await fileManagerService.updateFile(req.params.fileId, req.body);
  res.send(file);
});

/**
 * Delete folder
 * @route DELETE /v1/file-manager/folders/:folderId
 * @access Private
 */
const deleteFolder = catchAsync(async (req, res) => {
  const result = await fileManagerService.deleteFolder(req.params.folderId);
  res.status(httpStatus.NO_CONTENT).send(result);
});

/**
 * Delete file
 * @route DELETE /v1/file-manager/files/:fileId
 * @access Private
 */
const deleteFile = catchAsync(async (req, res) => {
  const file = await fileManagerService.deleteFile(req.params.fileId);
  res.status(httpStatus.NO_CONTENT).send(file);
});

/**
 * Delete multiple items
 * @route DELETE /v1/file-manager/items
 * @access Private
 */
const deleteMultipleItems = catchAsync(async (req, res) => {
  const { itemIds } = req.body;
  
  if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
    res.status(httpStatus.BAD_REQUEST).send({
      code: httpStatus.BAD_REQUEST,
      message: 'itemIds array is required and must not be empty',
    });
    return;
  }
  
  const result = await fileManagerService.deleteMultipleItems(itemIds);
  res.status(httpStatus.OK).send(result);
});

/**
 * Search files and folders
 * @route GET /v1/file-manager/search
 * @access Private
 */
const searchItems = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['query', 'type', 'userId']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  
  // If no userId specified, use current user's items
  if (!filter.userId) {
    filter.userId = req.user.id;
  }
  
  const result = await fileManagerService.searchItems(filter, options);
  res.send(result);
});

/**
 * Get user's file manager dashboard
 * @route GET /v1/file-manager/dashboard
 * @access Private
 */
const getDashboard = catchAsync(async (req, res) => {
  const options = pick(req.query, ['limit']);
  
  // Get root folders
  const rootFolders = await fileManagerService.getRootFolders(req.user.id, { ...options, limit: 5 });
  
  // Get recent files
  const recentFiles = await fileManagerService.searchItems(
    { userId: req.user.id, type: 'file' },
    { ...options, limit: 10, sortBy: 'createdAt:desc' }
  );
  
  // Get folder tree for navigation
  const folderTree = await fileManagerService.getFolderTree(req.user.id);
  
  res.send({
    rootFolders: rootFolders.results,
    recentFiles: recentFiles.results,
    folderTree,
    stats: {
      totalFolders: rootFolders.totalResults,
      totalFiles: recentFiles.totalResults,
    },
  });
});

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