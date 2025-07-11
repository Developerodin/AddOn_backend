import mongoose from 'mongoose';
import httpStatus from 'http-status';
import ApiError from '../utils/ApiError.js';
import FileManager from '../models/fileManager.model.js';
import { deleteFileFromS3 } from '../controllers/common.controller.js';

/**
 * Create a folder
 * @param {Object} folderBody
 * @returns {Promise<FileManager>}
 */
const createFolder = async (folderBody) => {
  const { name, parentFolder, createdBy, description, metadata } = folderBody;
  
  // Check if folder name already exists in the same parent
  const isNameTaken = await FileManager.isFolderNameTaken(name, parentFolder);
  if (isNameTaken) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Folder name already exists in this location');
  }

  // Build path
  let path = name;
  if (parentFolder) {
    const parent = await FileManager.findById(parentFolder);
    if (!parent || parent.type !== 'folder') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Parent folder not found');
    }
    path = parent.folder.path + '/' + name;
  }

  const folder = await FileManager.create({
    type: 'folder',
    folder: {
      name,
      description,
      parentFolder,
      createdBy,
      isRoot: !parentFolder,
      path,
      metadata: metadata || {},
    },
  });

  return folder;
};

/**
 * Create a file
 * @param {Object} fileBody
 * @returns {Promise<FileManager>}
 */
const createFile = async (fileBody) => {
  const { fileName, fileUrl, fileKey, parentFolder, uploadedBy, fileSize, mimeType, metadata } = fileBody;

  // Check if file name already exists in the same folder
  const isNameTaken = await FileManager.isFileNameTaken(fileName, parentFolder);
  if (isNameTaken) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'File name already exists in this folder');
  }

  // Get parent folder path
  let path = '';
  if (parentFolder) {
    const parent = await FileManager.findById(parentFolder);
    if (!parent || parent.type !== 'folder') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Parent folder not found');
    }
    path = parent.folder.path;
  }

  const file = await FileManager.create({
    type: 'file',
    file: {
      fileName,
      fileUrl,
      fileKey,
      fileSize: fileSize || 0,
      mimeType,
      metadata: metadata || {},
      uploadedBy,
      parentFolder, // Add parentFolder to file schema
    },
  });

  return file;
};

/**
 * Get folder by id
 * @param {ObjectId} id
 * @returns {Promise<FileManager>}
 */
const getFolderById = async (id) => {
  const folder = await FileManager.findOne({
    _id: id,
    type: 'folder',
    isDeleted: false,
  }).populate('folder.createdBy', 'name email');
  
  if (!folder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Folder not found');
  }
  
  return folder;
};

/**
 * Get file by id
 * @param {ObjectId} id
 * @returns {Promise<FileManager>}
 */
const getFileById = async (id) => {
  const file = await FileManager.findOne({
    _id: id,
    type: 'file',
    isDeleted: false,
  }).populate('file.uploadedBy', 'name email');
  
  if (!file) {
    throw new ApiError(httpStatus.NOT_FOUND, 'File not found');
  }
  
  return file;
};

/**
 * Get folder contents (subfolders and files)
 * @param {ObjectId} folderId
 * @param {Object} options
 * @returns {Promise<Object>}
 */
const getFolderContents = async (folderId, options = {}) => {
  const folder = await getFolderById(folderId);
  
  // First, let's test a direct query to see what's in the database
  console.log('🔍 getFolderContents - Testing direct query...');
  const directQuery = await FileManager.findOne({ 
    type: 'file', 
    'file.parentFolder': folderId,
    isDeleted: false 
  });
  console.log('🔍 getFolderContents - Direct query result:', JSON.stringify(directQuery, null, 2));
  
  const filter = {
    $or: [
      { 'folder.parentFolder': folderId },
      { 'file.parentFolder': folderId }
    ],
    isDeleted: false,
  };

  console.log('🔍 getFolderContents - Filter:', JSON.stringify(filter, null, 2));

  // Try a direct query instead of paginate to debug the issue
  console.log('🔍 getFolderContents - Using direct query instead of paginate...');
  
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  
  const countPromise = FileManager.countDocuments(filter);
  const docsPromise = FileManager.find(filter)
    .populate('folder.createdBy', 'name email')
    .populate('file.uploadedBy', 'name email')
    .sort(options.sortBy || 'type:asc,folder.name:asc,file.fileName:asc')
    .skip(skip)
    .limit(limit)
    .lean(); // Use lean() to get plain objects
  
  const [totalResults, results] = await Promise.all([countPromise, docsPromise]);
  const totalPages = Math.ceil(totalResults / limit);
  
  const result = {
    results,
    page,
    limit,
    totalPages,
    totalResults,
  };

  console.log('📊 getFolderContents - Raw result from paginate:', JSON.stringify(result, null, 2));
  
  // Log each result item individually
  if (result.results && result.results.length > 0) {
    console.log('📋 getFolderContents - Individual results:');
    result.results.forEach((item, index) => {
      console.log(`  Item ${index + 1}:`);
      console.log(`    Type: ${item.type}`);
      console.log(`    ID: ${item.id}`);
      console.log(`    File object:`, JSON.stringify(item.file, null, 4));
      console.log(`    Folder object:`, JSON.stringify(item.folder, null, 4));
      console.log(`    Raw item:`, JSON.stringify(item, null, 4));
    });
  }

  const response = {
    folder,
    contents: result,
  };

  console.log('🚀 getFolderContents - Final response:', JSON.stringify(response, null, 2));

  return response;
};

/**
 * Get root folders for a user
 * @param {ObjectId} userId
 * @param {Object} options
 * @returns {Promise<Object>}
 */
const getRootFolders = async (userId, options = {}) => {
  const filter = {
    type: 'folder',
    'folder.createdBy': userId,
    'folder.isRoot': true,
    isDeleted: false,
  };

  const result = await FileManager.paginate(filter, {
    ...options,
    populate: 'folder.createdBy',
    sortBy: options.sortBy || 'folder.name:asc',
  });

  return result;
};

/**
 * Update folder
 * @param {ObjectId} folderId
 * @param {Object} updateBody
 * @returns {Promise<FileManager>}
 */
const updateFolder = async (folderId, updateBody) => {
  const folder = await getFolderById(folderId);
  
  const { name, description, metadata } = updateBody;
  
  // Check if new name conflicts with existing folder
  if (name && name !== folder.folder.name) {
    const isNameTaken = await FileManager.isFolderNameTaken(name, folder.folder.parentFolder, folderId);
    if (isNameTaken) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Folder name already exists in this location');
    }
  }

  // Update folder
  Object.assign(folder.folder, {
    name: name || folder.folder.name,
    description: description !== undefined ? description : folder.folder.description,
    metadata: metadata || folder.folder.metadata,
  });

  await folder.save();
  return folder;
};

/**
 * Update file
 * @param {ObjectId} fileId
 * @param {Object} updateBody
 * @returns {Promise<FileManager>}
 */
const updateFile = async (fileId, updateBody) => {
  const file = await getFileById(fileId);
  
  const { fileName, fileUrl, fileKey, fileSize, mimeType, metadata } = updateBody;
  
  // Check if new name conflicts with existing file
  if (fileName && fileName !== file.file.fileName) {
    const isNameTaken = await FileManager.isFileNameTaken(fileName, file.file.parentFolder, fileId);
    if (isNameTaken) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'File name already exists in this folder');
    }
  }

  // Update file
  Object.assign(file.file, {
    fileName: fileName || file.file.fileName,
    fileUrl: fileUrl || file.file.fileUrl,
    fileKey: fileKey || file.file.fileKey,
    fileSize: fileSize !== undefined ? fileSize : file.file.fileSize,
    mimeType: mimeType || file.file.mimeType,
    metadata: metadata || file.file.metadata,
  });

  await file.save();
  return file;
};

/**
 * Delete folder and all its contents recursively
 * @param {ObjectId} folderId
 * @returns {Promise<Object>}
 */
const deleteFolder = async (folderId) => {
  const folder = await getFolderById(folderId);
  
  // Get all descendants
  const descendants = await folder.getAllDescendants();
  
  // Soft delete all descendants
  const descendantIds = descendants.map(item => item._id);
  descendantIds.push(folderId);
  
  await FileManager.updateMany(
    { _id: { $in: descendantIds } },
    { isDeleted: true }
  );

  return {
    deletedFolder: folder,
    deletedItems: descendants.length + 1,
  };
};

/**
 * Delete file
 * @param {ObjectId} fileId
 * @returns {Promise<FileManager>}
 */
const deleteFile = async (fileId) => {
  const file = await getFileById(fileId);
  const fileKey = file.file?.fileKey;
  file.isDeleted = true;
  await file.save();
  if (fileKey) {
    try {
      await deleteFileFromS3(fileKey);
      console.log(`S3 file deleted: ${fileKey}`);
    } catch (err) {
      console.error(`Failed to delete S3 file: ${fileKey}`, err);
    }
  }
  return file;
};

/**
 * Delete multiple items
 * @param {Array<ObjectId>} itemIds
 * @returns {Promise<Object>}
 */
const deleteMultipleItems = async (itemIds) => {
  const items = await FileManager.find({
    _id: { $in: itemIds },
    isDeleted: false,
  });

  if (items.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, 'No items found to delete');
  }

  const foldersToDelete = [];
  const filesToDelete = [];

  // Separate folders and files
  for (const item of items) {
    if (item.type === 'folder') {
      foldersToDelete.push(item);
    } else {
      filesToDelete.push(item);
    }
  }

  // Delete folders recursively
  const deletedFolders = [];
  for (const folder of foldersToDelete) {
    const result = await deleteFolder(folder._id);
    deletedFolders.push(result);
  }

  // Delete files
  const deletedFiles = [];
  for (const file of filesToDelete) {
    const result = await deleteFile(file._id);
    deletedFiles.push(result);
  }

  return {
    deletedFolders,
    deletedFiles,
    totalDeleted: items.length,
  };
};

/**
 * Search files and folders
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<Object>}
 */
const searchItems = async (filter, options = {}) => {
  const searchFilter = {
    isDeleted: false,
    $or: [
      { 'folder.name': { $regex: filter.query, $options: 'i' } },
      { 'file.fileName': { $regex: filter.query, $options: 'i' } },
    ],
  };

  if (filter.type) {
    searchFilter.type = filter.type;
  }

  if (filter.userId) {
    searchFilter.$or = [
      { 'folder.createdBy': filter.userId },
      { 'file.uploadedBy': filter.userId },
    ];
  }

  const result = await FileManager.paginate(searchFilter, {
    ...options,
    populate: 'folder.createdBy,file.uploadedBy',
    sortBy: options.sortBy || 'type:asc,folder.name:asc,file.fileName:asc',
  });

  return result;
};

/**
 * Get folder tree structure
 * @param {ObjectId} userId
 * @param {ObjectId} rootFolderId
 * @returns {Promise<Object>}
 */
const getFolderTree = async (userId, rootFolderId = null) => {
  const buildTree = async (parentId) => {
    const children = await FileManager.find({
      type: 'folder',
      'folder.parentFolder': parentId,
      'folder.createdBy': userId,
      isDeleted: false,
    }).populate('folder.createdBy', 'name email');

    const tree = [];
    for (const child of children) {
      const node = {
        id: child._id,
        name: child.folder.name,
        path: child.folder.path,
        description: child.folder.description,
        createdBy: child.folder.createdBy,
        createdAt: child.createdAt,
        updatedAt: child.updatedAt,
        children: await buildTree(child._id),
      };
      tree.push(node);
    }

    return tree;
  };

  const tree = await buildTree(rootFolderId);
  return tree;
};

export {
  createFolder,
  createFile,
  getFolderById,
  getFileById,
  getFolderContents,
  getRootFolders,
  updateFolder,
  updateFile,
  deleteFolder,
  deleteFile,
  deleteMultipleItems,
  searchItems,
  getFolderTree,
}; 