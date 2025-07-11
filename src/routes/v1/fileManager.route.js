import express from 'express';
import auth from '../../middlewares/auth.js';
import validate from '../../middlewares/validate.js';
import * as fileManagerValidation from '../../validations/fileManager.validation.js';
import * as fileManagerController from '../../controllers/fileManager.controller.js';

const router = express.Router();

// All routes require authentication
router.use(auth());

// Dashboard
router
  .route('/dashboard')
  .get(
    validate(fileManagerValidation.getDashboard),
    fileManagerController.getDashboard
  );

// Root folders
router
  .route('/root-folders')
  .get(
    validate(fileManagerValidation.getRootFolders),
    fileManagerController.getRootFolders
  );

// Folder tree
router
  .route('/folder-tree')
  .get(
    validate(fileManagerValidation.getFolderTree),
    fileManagerController.getFolderTree
  );

// Search
router
  .route('/search')
  .get(
    validate(fileManagerValidation.searchItems),
    fileManagerController.searchItems
  );

// Folders
router
  .route('/folders')
  .post(
    validate(fileManagerValidation.createFolder),
    fileManagerController.createFolder
  );

router
  .route('/folders/:folderId')
  .get(
    validate(fileManagerValidation.getFolder),
    fileManagerController.getFolder
  )
  .patch(
    validate(fileManagerValidation.updateFolder),
    fileManagerController.updateFolder
  )
  .delete(
    validate(fileManagerValidation.deleteFolder),
    fileManagerController.deleteFolder
  );

router
  .route('/folders/:folderId/contents')
  .get(
    validate(fileManagerValidation.getFolderContents),
    fileManagerController.getFolderContents
  );

// Files
router
  .route('/files')
  .post(
    validate(fileManagerValidation.createFile),
    fileManagerController.createFile
  );

router
  .route('/files/:fileId')
  .get(
    validate(fileManagerValidation.getFile),
    fileManagerController.getFile
  )
  .patch(
    validate(fileManagerValidation.updateFile),
    fileManagerController.updateFile
  )
  .delete(
    validate(fileManagerValidation.deleteFile),
    fileManagerController.deleteFile
  );

// Bulk operations
router
  .route('/items')
  .delete(
    validate(fileManagerValidation.deleteMultipleItems),
    fileManagerController.deleteMultipleItems
  );

export default router; 