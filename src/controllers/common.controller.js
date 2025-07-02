import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import AWS from 'aws-sdk';
import config from '../config/config.js';
import catchAsync from '../utils/catchAsync.js';
import httpStatus from 'http-status';

// Configure AWS
const s3Config = new AWS.S3({
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey,
    region: config.aws.region,
    signatureVersion: 'v4'
});

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        // Add file type validation if needed
        cb(null, true);
    }
});

/**
 * Utility function to upload a file to S3
 * @param {Object} file - The file object from multer
 * @returns {Promise<{url: string, key: string}>} - Returns the file URL and key
 */
const uploadFileToS3 = async (file) => {
    try {
        if (!file) {
            throw new Error('No file provided');
        }

        const uniqueFileName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
        
        const params = {
            Bucket: config.aws.s3.bucket,
            Key: uniqueFileName,
            Body: file.buffer,
            ContentType: file.mimetype
        };

        const uploadResult = await s3Config.upload(params).promise();
        
        return {
            url: uploadResult.Location,
            key: uploadResult.Key
        };
    } catch (error) {
        throw error;
    }
};

/**
 * Utility function to delete a file from S3
 * @param {string} key - The file key in S3
 * @returns {Promise<void>}
 */
const deleteFileFromS3 = async (key) => {
    try {
        if (!key) {
            throw new Error('File key is required');
        }

        await s3Config.deleteObject({
            Bucket: config.aws.s3.bucket,
            Key: key
        }).promise();
    } catch (error) {
        throw error;
    }
};

/**
 * Upload file to S3
 */
const uploadFile = catchAsync(async (req, res) => {
    if (!req.file) {
        return res.status(httpStatus.BAD_REQUEST).json({
            success: false,
            message: 'No file uploaded'
        });
    }

    const { url, key } = await uploadFileToS3(req.file);

    res.status(httpStatus.OK).json({
        success: true,
        message: 'File uploaded successfully',
        data: {
            url,
            key,
            originalName: req.file.originalname,
            mimeType: req.file.mimetype,
            size: req.file.size
        }
    });
});

/**
 * Delete file from S3
 */
const deleteFile = catchAsync(async (req, res) => {
    const { key } = req.params;

    if (!key) {
        return res.status(httpStatus.BAD_REQUEST).json({
            success: false,
            message: 'File key is required'
        });
    }

    await deleteFileFromS3(key);

    res.status(httpStatus.OK).json({
        success: true,
        message: 'File deleted successfully'
    });
});

export {
    upload,
    uploadFile,
    deleteFile,
    uploadFileToS3,
    deleteFileFromS3
}; 