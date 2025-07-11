# File Manager API Documentation

## Overview
The File Manager API provides complete file and folder management functionality with hierarchical organization, search capabilities, and user-specific access control.

**Base URL:** `/v1/file-manager`

**Authentication:** All endpoints require Bearer token authentication

---

## Authentication
All requests must include the Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

---

## Endpoints

### 1. Create Folder

**POST** `/v1/file-manager/folders`

Creates a new folder in the file manager.

#### Request Body
```json
{
  "name": "My New Folder",
  "parentFolder": "507f1f77bcf86cd799439011", // Optional - folder ID
  "description": "Optional folder description", // Optional - can be empty string
  "metadata": {} // Optional - any additional data
}
```

#### cURL Example
```bash
curl -X POST \
  http://localhost:3000/v1/file-manager/folders \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Documents",
    "description": "Important documents folder"
  }'
```

#### Success Response (201 Created)
```json
{
  "id": "507f1f77bcf86cd799439012",
  "type": "folder",
  "folder": {
    "name": "Documents",
    "description": "Important documents folder",
    "parentFolder": null,
    "createdBy": "507f1f77bcf86cd799439013",
    "isRoot": true,
    "path": "/Documents",
    "metadata": {},
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  "isDeleted": false,
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

#### Error Responses

**400 Bad Request - Validation Error**
```json
{
  "code": 400,
  "message": "name is required"
}
```

**400 Bad Request - Name Already Exists**
```json
{
  "code": 400,
  "message": "Folder name already exists in this location"
}
```

---

### 2. Create File

**POST** `/v1/file-manager/files`

Creates a new file entry in the file manager.

#### Request Body
```json
{
  "fileName": "document.pdf",
  "fileUrl": "https://s3.amazonaws.com/bucket/document.pdf",
  "fileKey": "1703123456789-uuid-document.pdf",
  "parentFolder": "507f1f77bcf86cd799439011", // Optional - folder ID
  "fileSize": 1024000, // Optional - file size in bytes
  "mimeType": "application/pdf", // Optional
  "metadata": {} // Optional - any additional data
}
```

#### cURL Example
```bash
curl -X POST \
  http://localhost:3000/v1/file-manager/files \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' \
  -H 'Content-Type: application/json' \
  -d '{
    "fileName": "report.pdf",
    "fileUrl": "https://s3.amazonaws.com/bucket/report.pdf",
    "fileKey": "1703123456789-uuid-report.pdf",
    "fileSize": 2048000,
    "mimeType": "application/pdf"
  }'
```

#### Success Response (201 Created)
```json
{
  "id": "507f1f77bcf86cd799439014",
  "type": "file",
  "file": {
    "fileName": "report.pdf",
    "fileUrl": "https://s3.amazonaws.com/bucket/report.pdf",
    "fileKey": "1703123456789-uuid-report.pdf",
    "fileSize": 2048000,
    "mimeType": "application/pdf",
    "metadata": {},
    "uploadedBy": "507f1f77bcf86cd799439013",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  "isDeleted": false,
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

#### Error Responses

**400 Bad Request - Validation Error**
```json
{
  "code": 400,
  "message": "fileName is required"
}
```

**400 Bad Request - Name Already Exists**
```json
{
  "code": 400,
  "message": "File name already exists in this folder"
}
```

---

### 3. Get Dashboard

**GET** `/v1/file-manager/dashboard`

Gets the user's file manager dashboard with root folders, recent files, and folder tree.

#### Query Parameters
- `limit` (optional): Number of items to return (default: 10, max: 50)

#### cURL Example
```bash
curl -X GET \
  'http://localhost:3000/v1/file-manager/dashboard?limit=10' \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

#### Success Response (200 OK)
```json
{
  "rootFolders": [
    {
      "id": "507f1f77bcf86cd799439012",
      "type": "folder",
      "folder": {
        "name": "Documents",
        "description": "Important documents",
        "parentFolder": null,
        "createdBy": {
          "id": "507f1f77bcf86cd799439013",
          "name": "John Doe",
          "email": "john@example.com"
        },
        "isRoot": true,
        "path": "/Documents",
        "metadata": {},
        "createdAt": "2024-01-15T10:30:00.000Z",
        "updatedAt": "2024-01-15T10:30:00.000Z"
      },
      "isDeleted": false,
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "recentFiles": [
    {
      "id": "507f1f77bcf86cd799439014",
      "type": "file",
      "file": {
        "fileName": "report.pdf",
        "fileUrl": "https://s3.amazonaws.com/bucket/report.pdf",
        "fileKey": "1703123456789-uuid-report.pdf",
        "fileSize": 2048000,
        "mimeType": "application/pdf",
        "metadata": {},
        "uploadedBy": {
          "id": "507f1f77bcf86cd799439013",
          "name": "John Doe",
          "email": "john@example.com"
        },
        "createdAt": "2024-01-15T10:30:00.000Z",
        "updatedAt": "2024-01-15T10:30:00.000Z"
      },
      "isDeleted": false,
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "folderTree": [
    {
      "id": "507f1f77bcf86cd799439012",
      "name": "Documents",
      "path": "/Documents",
      "children": [
        {
          "id": "507f1f77bcf86cd799439015",
          "name": "Work",
          "path": "/Documents/Work",
          "children": []
        }
      ]
    }
  ],
  "stats": {
    "totalFolders": 5,
    "totalFiles": 25
  }
}
```

---

### 4. Get Root Folders

**GET** `/v1/file-manager/root-folders`

Gets all root folders for the current user.

#### Query Parameters
- `sortBy` (optional): Sort criteria (e.g., "folder.name:asc")
- `limit` (optional): Number of items per page (default: 10, max: 100)
- `page` (optional): Page number (default: 1)

#### cURL Example
```bash
curl -X GET \
  'http://localhost:3000/v1/file-manager/root-folders?limit=10&page=1' \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

#### Success Response (200 OK)
```json
{
  "results": [
    {
      "id": "507f1f77bcf86cd799439012",
      "type": "folder",
      "folder": {
        "name": "Documents",
        "description": "Important documents",
        "parentFolder": null,
        "createdBy": {
          "id": "507f1f77bcf86cd799439013",
          "name": "John Doe",
          "email": "john@example.com"
        },
        "isRoot": true,
        "path": "/Documents",
        "metadata": {},
        "createdAt": "2024-01-15T10:30:00.000Z",
        "updatedAt": "2024-01-15T10:30:00.000Z"
      },
      "isDeleted": false,
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "page": 1,
  "limit": 10,
  "totalPages": 1,
  "totalResults": 1
}
```

---

### 5. Get Folder Tree

**GET** `/v1/file-manager/folder-tree`

Gets the complete folder tree for the current user.

#### Query Parameters
- `rootFolderId` (optional): Specific root folder ID to start from

#### cURL Example
```bash
curl -X GET \
  'http://localhost:3000/v1/file-manager/folder-tree' \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

#### Success Response (200 OK)
```json
[
  {
    "id": "507f1f77bcf86cd799439012",
    "name": "Documents",
    "path": "/Documents",
    "children": [
      {
        "id": "507f1f77bcf86cd799439015",
        "name": "Work",
        "path": "/Documents/Work",
        "children": [
          {
            "id": "507f1f77bcf86cd799439016",
            "name": "Reports",
            "path": "/Documents/Work/Reports",
            "children": []
          }
        ]
      },
      {
        "id": "507f1f77bcf86cd799439017",
        "name": "Personal",
        "path": "/Documents/Personal",
        "children": []
      }
    ]
  }
]
```

---

### 6. Get Folder Contents

**GET** `/v1/file-manager/folders/:folderId/contents`

Gets all files and subfolders within a specific folder.

#### URL Parameters
- `folderId`: The ID of the folder to get contents for

#### Query Parameters
- `sortBy` (optional): Sort criteria (e.g., "type:asc,folder.name:asc")
- `limit` (optional): Number of items per page (default: 10, max: 100)
- `page` (optional): Page number (default: 1)

#### cURL Example
```bash
curl -X GET \
  'http://localhost:3000/v1/file-manager/folders/507f1f77bcf86cd799439012/contents?limit=20' \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

#### Success Response (200 OK)
```json
{
  "folder": {
    "id": "507f1f77bcf86cd799439012",
    "type": "folder",
    "folder": {
      "name": "Documents",
      "description": "Important documents",
      "parentFolder": null,
      "createdBy": {
        "id": "507f1f77bcf86cd799439013",
        "name": "John Doe",
        "email": "john@example.com"
      },
      "isRoot": true,
      "path": "/Documents",
      "metadata": {},
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    },
    "isDeleted": false,
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  "contents": {
    "results": [
      {
        "id": "507f1f77bcf86cd799439015",
        "type": "folder",
        "folder": {
          "name": "Work",
          "description": "Work related files",
          "parentFolder": "507f1f77bcf86cd799439012",
          "createdBy": {
            "id": "507f1f77bcf86cd799439013",
            "name": "John Doe",
            "email": "john@example.com"
          },
          "isRoot": false,
          "path": "/Documents/Work",
          "metadata": {},
          "createdAt": "2024-01-15T10:30:00.000Z",
          "updatedAt": "2024-01-15T10:30:00.000Z"
        },
        "isDeleted": false,
        "createdAt": "2024-01-15T10:30:00.000Z",
        "updatedAt": "2024-01-15T10:30:00.000Z"
      },
      {
        "id": "507f1f77bcf86cd799439014",
        "type": "file",
        "file": {
          "fileName": "report.pdf",
          "fileUrl": "https://s3.amazonaws.com/bucket/report.pdf",
          "fileKey": "1703123456789-uuid-report.pdf",
          "fileSize": 2048000,
          "mimeType": "application/pdf",
          "metadata": {},
          "uploadedBy": {
            "id": "507f1f77bcf86cd799439013",
            "name": "John Doe",
            "email": "john@example.com"
          },
          "createdAt": "2024-01-15T10:30:00.000Z",
          "updatedAt": "2024-01-15T10:30:00.000Z"
        },
        "isDeleted": false,
        "createdAt": "2024-01-15T10:30:00.000Z",
        "updatedAt": "2024-01-15T10:30:00.000Z"
      }
    ],
    "page": 1,
    "limit": 20,
    "totalPages": 1,
    "totalResults": 2
  }
}
```

---

### 7. Search Files and Folders

**GET** `/v1/file-manager/search`

Searches for files and folders by name.

#### Query Parameters
- `query` (required): Search term
- `type` (optional): Filter by type ("folder" or "file")
- `userId` (optional): Filter by user ID
- `sortBy` (optional): Sort criteria
- `limit` (optional): Number of items per page (default: 10, max: 100)
- `page` (optional): Page number (default: 1)

#### cURL Example
```bash
curl -X GET \
  'http://localhost:3000/v1/file-manager/search?query=report&type=file&limit=10' \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

#### Success Response (200 OK)
```json
{
  "results": [
    {
      "id": "507f1f77bcf86cd799439014",
      "type": "file",
      "file": {
        "fileName": "report.pdf",
        "fileUrl": "https://s3.amazonaws.com/bucket/report.pdf",
        "fileKey": "1703123456789-uuid-report.pdf",
        "fileSize": 2048000,
        "mimeType": "application/pdf",
        "metadata": {},
        "uploadedBy": {
          "id": "507f1f77bcf86cd799439013",
          "name": "John Doe",
          "email": "john@example.com"
        },
        "createdAt": "2024-01-15T10:30:00.000Z",
        "updatedAt": "2024-01-15T10:30:00.000Z"
      },
      "isDeleted": false,
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "page": 1,
  "limit": 10,
  "totalPages": 1,
  "totalResults": 1
}
```

---

### 8. Update Folder

**PATCH** `/v1/file-manager/folders/:folderId`

Updates a folder's properties.

#### URL Parameters
- `folderId`: The ID of the folder to update

#### Request Body
```json
{
  "name": "Updated Folder Name", // Optional
  "description": "Updated description", // Optional - can be empty string
  "metadata": {} // Optional
}
```

#### cURL Example
```bash
curl -X PATCH \
  http://localhost:3000/v1/file-manager/folders/507f1f77bcf86cd799439012 \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Updated Documents",
    "description": "Updated description"
  }'
```

#### Success Response (200 OK)
```json
{
  "id": "507f1f77bcf86cd799439012",
  "type": "folder",
  "folder": {
    "name": "Updated Documents",
    "description": "Updated description",
    "parentFolder": null,
    "createdBy": "507f1f77bcf86cd799439013",
    "isRoot": true,
    "path": "/Updated Documents",
    "metadata": {},
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:35:00.000Z"
  },
  "isDeleted": false,
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:35:00.000Z"
}
```

---

### 9. Update File

**PATCH** `/v1/file-manager/files/:fileId`

Updates a file's properties.

#### URL Parameters
- `fileId`: The ID of the file to update

#### Request Body
```json
{
  "fileName": "updated-file.pdf", // Optional
  "fileUrl": "https://s3.amazonaws.com/bucket/updated-file.pdf", // Optional
  "fileKey": "1703123456789-uuid-updated-file.pdf", // Optional
  "fileSize": 3072000, // Optional
  "mimeType": "application/pdf", // Optional
  "metadata": {} // Optional
}
```

#### cURL Example
```bash
curl -X PATCH \
  http://localhost:3000/v1/file-manager/files/507f1f77bcf86cd799439014 \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' \
  -H 'Content-Type: application/json' \
  -d '{
    "fileName": "updated-report.pdf",
    "fileSize": 3072000
  }'
```

#### Success Response (200 OK)
```json
{
  "id": "507f1f77bcf86cd799439014",
  "type": "file",
  "file": {
    "fileName": "updated-report.pdf",
    "fileUrl": "https://s3.amazonaws.com/bucket/report.pdf",
    "fileKey": "1703123456789-uuid-report.pdf",
    "fileSize": 3072000,
    "mimeType": "application/pdf",
    "metadata": {},
    "uploadedBy": "507f1f77bcf86cd799439013",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:35:00.000Z"
  },
  "isDeleted": false,
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:35:00.000Z"
}
```

---

### 10. Delete Folder

**DELETE** `/v1/file-manager/folders/:folderId`

Deletes a folder and all its contents recursively.

#### URL Parameters
- `folderId`: The ID of the folder to delete

#### cURL Example
```bash
curl -X DELETE \
  http://localhost:3000/v1/file-manager/folders/507f1f77bcf86cd799439012 \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

#### Success Response (204 No Content)
Empty response body

---

### 11. Delete File

**DELETE** `/v1/file-manager/files/:fileId`

Deletes a file.

#### URL Parameters
- `fileId`: The ID of the file to delete

#### cURL Example
```bash
curl -X DELETE \
  http://localhost:3000/v1/file-manager/files/507f1f77bcf86cd799439014 \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

#### Success Response (204 No Content)
Empty response body

---

### 12. Delete Multiple Items

**DELETE** `/v1/file-manager/items`

Deletes multiple files and folders at once.

#### Request Body
```json
{
  "itemIds": [
    "507f1f77bcf86cd799439012",
    "507f1f77bcf86cd799439014",
    "507f1f77bcf86cd799439015"
  ]
}
```

#### cURL Example
```bash
curl -X DELETE \
  http://localhost:3000/v1/file-manager/items \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' \
  -H 'Content-Type: application/json' \
  -d '{
    "itemIds": [
      "507f1f77bcf86cd799439012",
      "507f1f77bcf86cd799439014"
    ]
  }'
```

#### Success Response (200 OK)
```json
{
  "deletedFolders": [
    {
      "deletedFolder": {
        "id": "507f1f77bcf86cd799439012",
        "type": "folder",
        "folder": {
          "name": "Documents",
          "description": "Important documents",
          "parentFolder": null,
          "createdBy": "507f1f77bcf86cd799439013",
          "isRoot": true,
          "path": "/Documents",
          "metadata": {},
          "createdAt": "2024-01-15T10:30:00.000Z",
          "updatedAt": "2024-01-15T10:30:00.000Z"
        },
        "isDeleted": true,
        "createdAt": "2024-01-15T10:30:00.000Z",
        "updatedAt": "2024-01-15T10:30:00.000Z"
      },
      "deletedItems": 3
    }
  ],
  "deletedFiles": [
    {
      "id": "507f1f77bcf86cd799439014",
      "type": "file",
      "file": {
        "fileName": "report.pdf",
        "fileUrl": "https://s3.amazonaws.com/bucket/report.pdf",
        "fileKey": "1703123456789-uuid-report.pdf",
        "fileSize": 2048000,
        "mimeType": "application/pdf",
        "metadata": {},
        "uploadedBy": "507f1f77bcf86cd799439013",
        "createdAt": "2024-01-15T10:30:00.000Z",
        "updatedAt": "2024-01-15T10:30:00.000Z"
      },
      "isDeleted": true,
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "totalDeleted": 2
}
```

---

## Frontend Integration Examples

### React Component for File Upload
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
    
    try {
      // First upload to S3 using common route
      const formData = new FormData();
      formData.append('file', file);

      const uploadResponse = await fetch('/v1/common/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: formData
      });

      const uploadResult = await uploadResponse.json();
      
      if (uploadResult.success) {
        // Then create file entry in file manager
        const fileEntryResponse = await fetch('/v1/file-manager/files', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            fileName: file.name,
            fileUrl: uploadResult.data.url,
            fileKey: uploadResult.data.key,
            fileSize: uploadResult.data.size,
            mimeType: uploadResult.data.mimeType
          })
        });

        const fileEntryResult = await fileEntryResponse.json();
        
        if (fileEntryResponse.ok) {
          setUploadedFile(fileEntryResult);
        }
      }
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploading(false);
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
          <p>File uploaded: {uploadedFile.file.fileName}</p>
          <a href={uploadedFile.file.fileUrl} target="_blank" rel="noopener noreferrer">
            View File
          </a>
        </div>
      )}
    </div>
  );
};

export default FileUpload;
```

### React Component for Folder Management
```jsx
import React, { useState, useEffect } from 'react';

const FolderManager = () => {
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderDescription, setNewFolderDescription] = useState('');

  useEffect(() => {
    fetchRootFolders();
  }, []);

  const fetchRootFolders = async () => {
    try {
      const response = await fetch('/v1/file-manager/root-folders', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      const result = await response.json();
      setFolders(result.results);
    } catch (error) {
      console.error('Failed to fetch folders:', error);
    } finally {
      setLoading(false);
    }
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;

    try {
      const response = await fetch('/v1/file-manager/folders', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: newFolderName,
          description: newFolderDescription
        })
      });

      if (response.ok) {
        setNewFolderName('');
        setNewFolderDescription('');
        fetchRootFolders(); // Refresh the list
      }
    } catch (error) {
      console.error('Failed to create folder:', error);
    }
  };

  const deleteFolder = async (folderId) => {
    if (!confirm('Are you sure you want to delete this folder and all its contents?')) return;

    try {
      const response = await fetch(`/v1/file-manager/folders/${folderId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        fetchRootFolders(); // Refresh the list
      }
    } catch (error) {
      console.error('Failed to delete folder:', error);
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h2>Folder Manager</h2>
      
      {/* Create Folder Form */}
      <div>
        <h3>Create New Folder</h3>
        <input
          type="text"
          placeholder="Folder name"
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
        />
        <input
          type="text"
          placeholder="Description (optional)"
          value={newFolderDescription}
          onChange={(e) => setNewFolderDescription(e.target.value)}
        />
        <button onClick={createFolder}>Create Folder</button>
      </div>

      {/* Folders List */}
      <div>
        <h3>Your Folders</h3>
        {folders.map(folder => (
          <div key={folder.id}>
            <h4>{folder.folder.name}</h4>
            {folder.folder.description && (
              <p>{folder.folder.description}</p>
            )}
            <p>Created: {new Date(folder.createdAt).toLocaleDateString()}</p>
            <button onClick={() => deleteFolder(folder.id)}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FolderManager;
```

---

## Error Handling

### Common Error Responses

**400 Bad Request - Validation Error**
```json
{
  "code": 400,
  "message": "name is required"
}
```

**401 Unauthorized**
```json
{
  "code": 401,
  "message": "Please authenticate"
}
```

**403 Forbidden**
```json
{
  "code": 403,
  "message": "Forbidden"
}
```

**404 Not Found**
```json
{
  "code": 404,
  "message": "Folder not found"
}
```

**500 Internal Server Error**
```json
{
  "code": 500,
  "message": "Internal server error"
}
```

---

## Important Notes

1. **Authentication**: All endpoints require a valid JWT token
2. **File Upload Flow**: 
   - First upload file to S3 using `/v1/common/upload`
   - Then create file entry using `/v1/file-manager/files`
3. **Soft Delete**: Files and folders are soft deleted (marked as deleted but not removed from database)
4. **Hierarchical Structure**: Folders can contain other folders and files
5. **User Isolation**: Users can only access their own files and folders
6. **File Size Limit**: 5MB per file (enforced by common upload endpoint)
7. **Pagination**: Most list endpoints support pagination with `limit` and `page` parameters
8. **Search**: Case-insensitive search by file/folder name
9. **Metadata**: Both files and folders support custom metadata objects 