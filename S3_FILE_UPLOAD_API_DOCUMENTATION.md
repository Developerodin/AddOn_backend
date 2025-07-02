# S3 File Upload API Documentation

## Base URL
```
http://localhost:3000/v1
```
*Replace `localhost:3000` with your actual domain and port in production*

## Authentication
All endpoints require authentication. Include the JWT token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

## Endpoints Overview

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/common/upload` | Upload a file to S3 | ✅ |
| DELETE | `/common/files/:key` | Delete a file from S3 | ✅ |

---

## 1. Upload File to S3

### **POST** `/v1/common/upload`

Uploads a file to AWS S3 bucket and returns the file URL and metadata.

#### **Request**

**Headers:**
```
Content-Type: multipart/form-data
Authorization: Bearer <your-jwt-token>
```

**Body (Form Data):**
- `file` (required): The file to upload
  - Maximum size: 5MB
  - Any file type supported

#### **Response**

**Success (200 OK):**
```json
{
  "success": true,
  "message": "File uploaded successfully",
  "data": {
    "url": "https://your-bucket.s3.amazonaws.com/1703123456789-abcd1234-ef56-7890-gh12-ijklmnopqrst.jpg",
    "key": "1703123456789-abcd1234-ef56-7890-gh12-ijklmnopqrst.jpg",
    "originalName": "my-image.jpg",
    "mimeType": "image/jpeg",
    "size": 245760
  }
}
```

**Error (400 Bad Request):**
```json
{
  "success": false,
  "message": "No file uploaded"
}
```

**Error (401 Unauthorized):**
```json
{
  "success": false,
  "message": "Unauthorized"
}
```

**Error (413 Payload Too Large):**
```json
{
  "success": false,
  "message": "File too large. Maximum size is 5MB"
}
```

#### **cURL Example**
```bash
curl -X POST \
  http://localhost:3000/v1/common/upload \
  -H "Authorization: Bearer your-jwt-token-here" \
  -F "file=@/path/to/your/file.jpg"
```

#### **JavaScript Example (Fetch API)**
```javascript
const uploadFile = async (file, token) => {
  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch('http://localhost:3000/v1/common/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    const result = await response.json();
    
    if (result.success) {
      console.log('File uploaded:', result.data.url);
      return result.data;
    } else {
      throw new Error(result.message);
    }
  } catch (error) {
    console.error('Upload failed:', error);
    throw error;
  }
};
```

#### **React Example with File Input**
```javascript
import React, { useState } from 'react';

const FileUpload = ({ authToken }) => {
  const [uploading, setUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setUploading(true);
    
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('http://localhost:3000/v1/common/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        body: formData
      });

      const result = await response.json();
      
      if (result.success) {
        setUploadedFile(result.data);
        alert('File uploaded successfully!');
      } else {
        alert('Upload failed: ' + result.message);
      }
    } catch (error) {
      alert('Upload error: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <input 
        type="file" 
        onChange={handleFileUpload} 
        disabled={uploading}
      />
      {uploading && <p>Uploading...</p>}
      {uploadedFile && (
        <div>
          <p>File uploaded: {uploadedFile.originalName}</p>
          <p>URL: <a href={uploadedFile.url} target="_blank" rel="noopener noreferrer">{uploadedFile.url}</a></p>
          <p>Key: {uploadedFile.key}</p>
        </div>
      )}
    </div>
  );
};

export default FileUpload;
```

---

## 2. Delete File from S3

### **DELETE** `/v1/common/files/:key`

Deletes a file from AWS S3 bucket using the file key.

#### **Request**

**Headers:**
```
Authorization: Bearer <your-jwt-token>
```

**Path Parameters:**
- `key` (required): The S3 file key obtained from the upload response

#### **Response**

**Success (200 OK):**
```json
{
  "success": true,
  "message": "File deleted successfully"
}
```

**Error (400 Bad Request):**
```json
{
  "success": false,
  "message": "File key is required"
}
```

**Error (401 Unauthorized):**
```json
{
  "success": false,
  "message": "Unauthorized"
}
```

#### **cURL Example**
```bash
curl -X DELETE \
  http://localhost:3000/v1/common/files/1703123456789-abcd1234-ef56-7890-gh12-ijklmnopqrst.jpg \
  -H "Authorization: Bearer your-jwt-token-here"
```

#### **JavaScript Example**
```javascript
const deleteFile = async (fileKey, token) => {
  try {
    const response = await fetch(`http://localhost:3000/v1/common/files/${fileKey}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const result = await response.json();
    
    if (result.success) {
      console.log('File deleted successfully');
      return true;
    } else {
      throw new Error(result.message);
    }
  } catch (error) {
    console.error('Delete failed:', error);
    throw error;
  }
};
```

---

## File Upload Specifications

### **File Size Limit**
- Maximum file size: **5MB**
- Files exceeding this limit will be rejected with a 413 status code

### **File Types**
- All file types are currently supported
- No specific file type restrictions implemented

### **File Naming**
- Original filenames are preserved in the response metadata
- Actual S3 keys use a unique naming format: `{timestamp}-{uuid}{extension}`
- Example: `1703123456789-abcd1234-ef56-7890-gh12-ijklmnopqrst.jpg`

### **Storage Configuration**
- Files are stored using AWS S3
- Memory storage used for upload processing (no temporary local files)
- Automatic cleanup of memory after upload completion

---

## Environment Variables Required

Make sure these environment variables are configured:

```env
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_REGION=your-aws-region
AWS_BUCKET_NAME=your-s3-bucket-name
```

---

## Error Handling

### Common Error Responses

| Status Code | Description | Possible Causes |
|-------------|-------------|-----------------|
| 400 | Bad Request | Missing file, invalid file key |
| 401 | Unauthorized | Missing or invalid JWT token |
| 413 | Payload Too Large | File exceeds 5MB limit |
| 500 | Internal Server Error | AWS configuration issues, network problems |

### Error Response Format
```json
{
  "success": false,
  "message": "Error description"
}
```

---

## Security Considerations

1. **Authentication Required**: All endpoints require valid JWT tokens
2. **File Size Limits**: 5MB maximum to prevent abuse
3. **Memory Management**: Files processed in memory (no disk storage)
4. **Unique Naming**: Generated file keys prevent conflicts and enhance security

---

## Best Practices

1. **Always validate file types** on the client-side before uploading
2. **Store the file key** returned from upload for future deletion operations
3. **Handle upload progress** for better user experience with large files
4. **Implement retry logic** for failed uploads due to network issues
5. **Validate file size** on client-side before attempting upload

---

## Rate Limiting

- No specific rate limiting implemented for file operations
- General API rate limiting may apply based on your authentication endpoints configuration

---

*Last updated: December 2024* 