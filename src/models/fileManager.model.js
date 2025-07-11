import mongoose from 'mongoose';
import toJSON from './plugins/toJSON.plugin.js';
import paginate from './plugins/paginate.plugin.js';

const fileSchema = mongoose.Schema(
  {
    fileName: {
      type: String,
      required: true,
      trim: true,
    },
    fileUrl: {
      type: String,
      required: true,
      trim: true,
    },
    fileKey: {
      type: String,
      required: true,
      trim: true,
    },
    fileSize: {
      type: Number,
      default: 0,
    },
    mimeType: {
      type: String,
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    parentFolder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FileManager',
      default: null,
    },
  },
  { timestamps: true }
);

const folderSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    parentFolder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FileManager',
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    isRoot: {
      type: Boolean,
      default: false,
    },
    path: {
      type: String,
      required: true,
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

const fileManagerSchema = mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['folder', 'file'],
      required: true,
    },
    folder: {
      type: folderSchema,
      required: false,
      default: undefined,
    },
    file: {
      type: fileSchema,
      required: false,
      default: undefined,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Add plugins
fileManagerSchema.plugin(toJSON);
fileManagerSchema.plugin(paginate);

// Indexes for better performance
fileManagerSchema.index({ 'folder.parentFolder': 1 });
fileManagerSchema.index({ 'folder.createdBy': 1 });
fileManagerSchema.index({ 'file.uploadedBy': 1 });
fileManagerSchema.index({ 'file.parentFolder': 1 });
fileManagerSchema.index({ 'folder.path': 1 });
fileManagerSchema.index({ isDeleted: 1 });

// Virtual for getting full path
fileManagerSchema.virtual('fullPath').get(function() {
  if (this.type === 'folder') {
    return this.folder.path;
  }
  return this.folder.path + '/' + this.file.fileName;
});

// Static method to check if folder name exists in same parent
fileManagerSchema.statics.isFolderNameTaken = async function(name, parentFolder, excludeId = null) {
  const query = {
    type: 'folder',
    'folder.name': name,
    'folder.parentFolder': parentFolder,
    isDeleted: false,
  };
  
  if (excludeId) {
    query._id = { $ne: excludeId };
  }
  
  const folder = await this.findOne(query);
  return !!folder;
};

// Static method to check if file name exists in same folder
fileManagerSchema.statics.isFileNameTaken = async function(fileName, parentFolder, excludeId = null) {
  const query = {
    type: 'file',
    'file.fileName': fileName,
    'file.parentFolder': parentFolder,
    isDeleted: false,
  };
  
  if (excludeId) {
    query._id = { $ne: excludeId };
  }
  
  const file = await this.findOne(query);
  return !!file;
};

// Method to get all children (folders and files)
fileManagerSchema.methods.getChildren = async function() {
  if (this.type !== 'folder') {
    return [];
  }
  
  return await this.constructor.find({
    $or: [
      { 'folder.parentFolder': this._id },
      { 'file.parentFolder': this._id }
    ],
    isDeleted: false,
  }).sort({ type: 1, 'folder.name': 1, 'file.fileName': 1 });
};

// Method to get all descendants (recursive)
fileManagerSchema.methods.getAllDescendants = async function() {
  if (this.type !== 'folder') {
    return [];
  }
  
  const descendants = [];
  const stack = [this._id];
  
  while (stack.length > 0) {
    const currentId = stack.pop();
    const children = await this.constructor.find({
      $or: [
        { 'folder.parentFolder': currentId },
        { 'file.parentFolder': currentId }
      ],
      isDeleted: false,
    });
    
    for (const child of children) {
      descendants.push(child);
      if (child.type === 'folder') {
        stack.push(child._id);
      }
    }
  }
  
  return descendants;
};

/**
 * @typedef FileManager
 */
const FileManager = mongoose.model('FileManager', fileManagerSchema);

export default FileManager; 