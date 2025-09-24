# Common Route API Documentation

## Overview
The Common Route provides file management functionality for uploading and deleting files to/from AWS S3. All endpoints require authentication.

**Base URL:** `/v1/common`

---

## Endpoints

### 1. Upload File to S3

**POST** `/v1/common/upload`

Uploads a file to AWS S3 and returns the file URL and metadata.

#### Authentication
- **Required:** Yes
- **Type:** Bearer Token

#### Request Headers
```
Authorization: Bearer <your_jwt_token>
Content-Type: multipart/form-data
```

#### Request Body
- **Type:** `multipart/form-data`
- **Field Name:** `file`
- **File Size Limit:** 5MB
- **Supported Formats:** All file types

#### cURL Example
```bash
curl -X POST \
  http://localhost:3000/v1/common/upload \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' \
  -F 'file=@/path/to/your/file.pdf'
```

#### JavaScript/Fetch Example
```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);

const response = await fetch('/v1/common/upload', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + token
  },
  body: formData
});

const result = await response.json();
```

#### Success Response (200 OK)
```json
{
  "success": true,
  "message": "File uploaded successfully",
  "data": {
    "url": "https://your-bucket.s3.amazonaws.com/1703123456789-uuid-filename.pdf",
    "key": "1703123456789-uuid-filename.pdf",
    "originalName": "document.pdf",
    "mimeType": "application/pdf",
    "size": 1024000
  }
}
```

#### Error Responses

**400 Bad Request - No file uploaded**
```json
{
  "success": false,
  "message": "No file uploaded"
}
```

**401 Unauthorized**
```json
{
  "success": false,
  "message": "Please authenticate"
}
```

**413 Payload Too Large**
```json
{
  "success": false,
  "message": "File too large"
}
```

**500 Internal Server Error**
```json
{
  "success": false,
  "message": "Internal server error"
}
```

---

### 2. Delete File from S3

**DELETE** `/v1/common/files/:key`

Deletes a file from AWS S3 using the file key.

#### Authentication
- **Required:** Yes
- **Type:** Bearer Token

#### URL Parameters
- `key` (string, required): The S3 file key to delete

#### Request Headers
```
Authorization: Bearer <your_jwt_token>
```

#### cURL Example
```bash
curl -X DELETE \
  http://localhost:3000/v1/common/files/1703123456789-uuid-filename.pdf \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

#### JavaScript/Fetch Example
```javascript
const fileKey = '1703123456789-uuid-filename.pdf';

const response = await fetch(`/v1/common/files/${fileKey}`, {
  method: 'DELETE',
  headers: {
    'Authorization': 'Bearer ' + token
  }
});

const result = await response.json();
```

#### Success Response (200 OK)
```json
{
  "success": true,
  "message": "File deleted successfully"
}
```

#### Error Responses

**400 Bad Request - Missing file key**
```json
{
  "success": false,
  "message": "File key is required"
}
```

**401 Unauthorized**
```json
{
  "success": false,
  "message": "Please authenticate"
}
```

**404 Not Found**
```json
{
  "success": false,
  "message": "File not found"
}
```

**500 Internal Server Error**
```json
{
  "success": false,
  "message": "Internal server error"
}
```

---

## File Management Utilities

### File Key Format
Files are stored with a unique naming convention:
```
{timestamp}-{uuid}{file_extension}
```

Example: `1703123456789-550e8400-e29b-41d4-a716-446655440000.pdf`

### File Size Limits
- **Maximum file size:** 5MB
- **Storage:** AWS S3
- **Content-Type:** Automatically detected from file

### Security Features
- **Authentication required** for all endpoints
- **Unique file names** prevent conflicts
- **UUID-based naming** ensures security
- **File type validation** (configurable)

---

## Integration Examples

### React Component Example
```jsx
import React, { useState } from 'react';

const FileUpload = () => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/v1/common/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: formData
      });

      const result = await response.json();
      
      if (result.success) {
        setUploadedFile(result.data);
      }
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (key) => {
    try {
      const response = await fetch(`/v1/common/files/${key}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      const result = await response.json();
      
      if (result.success) {
        setUploadedFile(null);
      }
    } catch (error) {
      console.error('Delete failed:', error);
    }
  };

  return (
    <div>
      <input type="file" onChange={handleFileChange} />
      <button onClick={handleUpload} disabled={!file || uploading}>
        {uploading ? 'Uploading...' : 'Upload'}
      </button>
      
      {uploadedFile && (
        <div>
          <p>File uploaded: {uploadedFile.originalName}</p>
          <a href={uploadedFile.url} target="_blank" rel="noopener noreferrer">
            View File
          </a>
          <button onClick={() => handleDelete(uploadedFile.key)}>
            Delete File
          </button>
        </div>
      )}
    </div>
  );
};

export default FileUpload;
```

### Node.js/Express Example
```javascript
const express = require('express');
const multer = require('multer');
const axios = require('axios');

const app = express();

// Upload file to S3 via API
app.post('/upload-file', upload.single('file'), async (req, res) => {
  try {
    const formData = new FormData();
    formData.append('file', req.file.buffer, req.file.originalname);

    const response = await axios.post('http://localhost:3000/v1/common/upload', formData, {
      headers: {
        'Authorization': `Bearer ${req.headers.authorization}`,
        'Content-Type': 'multipart/form-data'
      }
    });

    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete file from S3 via API
app.delete('/delete-file/:key', async (req, res) => {
  try {
    const response = await axios.delete(
      `http://localhost:3000/v1/common/files/${req.params.key}`,
      {
        headers: {
          'Authorization': `Bearer ${req.headers.authorization}`
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

---

## Error Handling

### Common Error Scenarios
1. **Authentication failures** - Check token validity
2. **File size exceeded** - Ensure file is under 5MB
3. **Network issues** - Handle connection timeouts
4. **S3 service errors** - AWS service unavailable

### Best Practices
- Always handle both success and error responses
- Implement retry logic for network failures
- Validate file types on client-side before upload
- Store file keys for future deletion operations
- Implement proper loading states during operations

---

## Configuration

### AWS S3 Configuration
The service requires the following AWS configuration:
```javascript
{
  aws: {
    accessKeyId: 'YOUR_ACCESS_KEY',
    secretAccessKey: 'YOUR_SECRET_KEY',
    region: 'us-east-1',
    s3: {
      bucket: 'your-bucket-name'
    }
  }
}
```

### Environment Variables
```bash
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-bucket-name
``` 