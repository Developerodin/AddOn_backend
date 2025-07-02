import express from 'express';
import { upload, uploadFile, deleteFile } from '../../controllers/common.controller.js';
import auth from '../../middlewares/auth.js';

const router = express.Router();

/**
 * POST /v1/common/upload - Upload a file to S3
 * @access Private - requires authentication
 */
router.post('/upload', upload.single('file'), uploadFile);

/**
 * DELETE /v1/common/files/:key - Delete a file from S3
 * @access Private - requires authentication
 */
router.delete('/files/:key', deleteFile);

export default router; 