# Seals Excel Master API Documentation

## Overview
The Seals Excel Master API provides endpoints for managing Excel file uploads and tracking their processing status. This API allows you to create, read, update, delete, and bulk import records of uploaded Excel files.

## Base URL
```
http://localhost:3000/v1/seals-excel-master
```

## Authentication
All endpoints require authentication. Include the JWT token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

## Data Models

### SealsExcelMaster Object
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "fileName": "sales_data_2024.xlsx",
  "description": "Monthly sales data for Q1 2024",
  "fileUrl": "https://s3.amazonaws.com/bucket/sales_data_2024.xlsx",
  "fileKey": "sales_data_2024_123456789",
  "data": {
    "sheets": ["Sheet1", "Sheet2"],
    "totalRows": 1500,
    "columns": ["Date", "Product", "Sales", "Region"]
  },
  "uploadedBy": "507f1f77bcf86cd799439012",
  "fileSize": 2048576,
  "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "processingStatus": "completed",
  "errorMessage": null,
  "recordsCount": 1500,
  "isActive": true,
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:35:00.000Z"
}
```

### Processing Status Values
- `pending` - File uploaded, waiting for processing
- `processing` - File is currently being processed
- `completed` - Processing completed successfully
- `failed` - Processing failed with errors

### MIME Types
- `application/vnd.ms-excel` - Old Excel format (.xls)
- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` - New Excel format (.xlsx)
- `text/csv` - CSV files

## API Endpoints

### 1. Create Seals Excel Master Record

**POST** `/seals-excel-master`

Creates a new record for an uploaded Excel file.

#### Request Body
```json
{
  "fileName": "sales_data_2024.xlsx",
  "description": "Monthly sales data for Q1 2024",
  "fileUrl": "https://s3.amazonaws.com/bucket/sales_data_2024.xlsx",
  "fileKey": "sales_data_2024_123456789",
  "data": {
    "sheets": ["Sheet1", "Sheet2"],
    "totalRows": 1500,
    "columns": ["Date", "Product", "Sales", "Region"]
  },
  "uploadedBy": "507f1f77bcf86cd799439012",
  "fileSize": 2048576,
  "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "processingStatus": "pending",
  "recordsCount": 0,
  "isActive": true
}
```

#### Response
```json
{
  "status": "success",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "fileName": "sales_data_2024.xlsx",
    "description": "Monthly sales data for Q1 2024",
    "fileUrl": "https://s3.amazonaws.com/bucket/sales_data_2024.xlsx",
    "fileKey": "sales_data_2024_123456789",
    "data": {
      "sheets": ["Sheet1", "Sheet2"],
      "totalRows": 1500,
      "columns": ["Date", "Product", "Sales", "Region"]
    },
    "uploadedBy": "507f1f77bcf86cd799439012",
    "fileSize": 2048576,
    "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "processingStatus": "pending",
    "errorMessage": null,
    "recordsCount": 0,
    "isActive": true,
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

### 2. Get All Seals Excel Master Records

**GET** `/seals-excel-master`

Retrieves a paginated list of all records with optional filtering.

#### Query Parameters
| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `fileName` | string | Filter by file name | `?fileName=sales` |
| `description` | string | Filter by description | `?description=monthly` |
| `fileKey` | string | Filter by file key | `?fileKey=sales_data` |
| `uploadedBy` | string | Filter by user ID | `?uploadedBy=507f1f77bcf86cd799439012` |
| `processingStatus` | string | Filter by status | `?processingStatus=completed` |
| `mimeType` | string | Filter by file type | `?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| `isActive` | boolean | Filter by active status | `?isActive=true` |
| `sortBy` | string | Sort field and direction | `?sortBy=createdAt:desc` |
| `limit` | number | Number of records per page | `?limit=20` |
| `page` | number | Page number | `?page=1` |
| `populate` | string | Populate related fields | `?populate=uploadedBy` |

#### Example Request
```
GET /seals-excel-master?processingStatus=completed&sortBy=createdAt:desc&limit=10&page=1
```

#### Response
```json
{
  "status": "success",
  "data": {
    "results": [
      {
        "_id": "507f1f77bcf86cd799439011",
        "fileName": "sales_data_2024.xlsx",
        "description": "Monthly sales data for Q1 2024",
        "fileUrl": "https://s3.amazonaws.com/bucket/sales_data_2024.xlsx",
        "fileKey": "sales_data_2024_123456789",
        "data": {
          "sheets": ["Sheet1", "Sheet2"],
          "totalRows": 1500,
          "columns": ["Date", "Product", "Sales", "Region"]
        },
        "uploadedBy": {
          "_id": "507f1f77bcf86cd799439012",
          "name": "John Doe",
          "email": "john@example.com"
        },
        "fileSize": 2048576,
        "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "processingStatus": "completed",
        "errorMessage": null,
        "recordsCount": 1500,
        "isActive": true,
        "createdAt": "2024-01-15T10:30:00.000Z",
        "updatedAt": "2024-01-15T10:35:00.000Z"
      }
    ],
    "page": 1,
    "limit": 10,
    "totalPages": 5,
    "totalResults": 50,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

### 3. Get Single Record

**GET** `/seals-excel-master/:sealsExcelId`

Retrieves a specific record by ID.

#### Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| `sealsExcelId` | string | The ID of the record |

#### Example Request
```
GET /seals-excel-master/507f1f77bcf86cd799439011
```

#### Response
```json
{
  "status": "success",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "fileName": "sales_data_2024.xlsx",
    "description": "Monthly sales data for Q1 2024",
    "fileUrl": "https://s3.amazonaws.com/bucket/sales_data_2024.xlsx",
    "fileKey": "sales_data_2024_123456789",
    "data": {
      "sheets": ["Sheet1", "Sheet2"],
      "totalRows": 1500,
      "columns": ["Date", "Product", "Sales", "Region"]
    },
    "uploadedBy": {
      "_id": "507f1f77bcf86cd799439012",
      "name": "John Doe",
      "email": "john@example.com"
    },
    "fileSize": 2048576,
    "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "processingStatus": "completed",
    "errorMessage": null,
    "recordsCount": 1500,
    "isActive": true,
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:35:00.000Z"
  }
}
```

### 4. Update Record

**PATCH** `/seals-excel-master/:sealsExcelId`

Updates a specific record.

#### Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| `sealsExcelId` | string | The ID of the record |

#### Request Body
```json
{
  "description": "Updated description for the file",
  "processingStatus": "completed",
  "recordsCount": 1500,
  "errorMessage": null
}
```

#### Response
```json
{
  "status": "success",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "fileName": "sales_data_2024.xlsx",
    "description": "Updated description for the file",
    "fileUrl": "https://s3.amazonaws.com/bucket/sales_data_2024.xlsx",
    "fileKey": "sales_data_2024_123456789",
    "data": {
      "sheets": ["Sheet1", "Sheet2"],
      "totalRows": 1500,
      "columns": ["Date", "Product", "Sales", "Region"]
    },
    "uploadedBy": {
      "_id": "507f1f77bcf86cd799439012",
      "name": "John Doe",
      "email": "john@example.com"
    },
    "fileSize": 2048576,
    "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "processingStatus": "completed",
    "errorMessage": null,
    "recordsCount": 1500,
    "isActive": true,
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:40:00.000Z"
  }
}
```

### 5. Delete Record

**DELETE** `/seals-excel-master/:sealsExcelId`

Deletes a specific record.

#### Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| `sealsExcelId` | string | The ID of the record |

#### Example Request
```
DELETE /seals-excel-master/507f1f77bcf86cd799439011
```

#### Response
```json
{
  "status": "success",
  "message": "Record deleted successfully"
}
```

### 6. Get Recent Uploads

**GET** `/seals-excel-master/recent`

Retrieves the most recent uploads.

#### Query Parameters
| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `limit` | number | Number of records to return | 10 |

#### Example Request
```
GET /seals-excel-master/recent?limit=5
```

#### Response
```json
{
  "status": "success",
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "fileName": "sales_data_2024.xlsx",
      "description": "Monthly sales data for Q1 2024",
      "fileUrl": "https://s3.amazonaws.com/bucket/sales_data_2024.xlsx",
      "fileKey": "sales_data_2024_123456789",
      "uploadedBy": {
        "_id": "507f1f77bcf86cd799439012",
        "name": "John Doe",
        "email": "john@example.com"
      },
      "processingStatus": "completed",
      "recordsCount": 1500,
      "createdAt": "2024-01-15T10:30:00.000Z"
    }
  ]
}
```

### 7. Get User's Uploads

**GET** `/seals-excel-master/user/:userId?`

Retrieves all uploads by a specific user. If no userId is provided, uses the authenticated user's ID.

#### Path Parameters
| Parameter | Type | Description | Required |
|-----------|------|-------------|----------|
| `userId` | string | The ID of the user | No |

#### Query Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| `sortBy` | string | Sort field and direction |
| `limit` | number | Number of records per page |
| `page` | number | Page number |
| `populate` | string | Populate related fields |

#### Example Request
```
GET /seals-excel-master/user/507f1f77bcf86cd799439012?sortBy=createdAt:desc&limit=20
```

#### Response
```json
{
  "status": "success",
  "data": {
    "results": [
      {
        "_id": "507f1f77bcf86cd799439011",
        "fileName": "sales_data_2024.xlsx",
        "description": "Monthly sales data for Q1 2024",
        "fileUrl": "https://s3.amazonaws.com/bucket/sales_data_2024.xlsx",
        "fileKey": "sales_data_2024_123456789",
        "processingStatus": "completed",
        "recordsCount": 1500,
        "createdAt": "2024-01-15T10:30:00.000Z"
      }
    ],
    "page": 1,
    "limit": 20,
    "totalPages": 3,
    "totalResults": 45,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

### 8. Update Processing Status

**PATCH** `/seals-excel-master/:sealsExcelId/status`

Updates the processing status of a specific record.

#### Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| `sealsExcelId` | string | The ID of the record |

#### Request Body
```json
{
  "status": "completed",
  "errorMessage": null
}
```

#### Response
```json
{
  "status": "success",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "fileName": "sales_data_2024.xlsx",
    "processingStatus": "completed",
    "errorMessage": null,
    "updatedAt": "2024-01-15T10:45:00.000Z"
  }
}
```

### 9. Bulk Import

**POST** `/seals-excel-master/bulk-import`

Bulk imports multiple records with batch processing.

#### Request Body
```json
{
  "records": [
    {
      "fileName": "sales_data_2024.xlsx",
      "description": "Monthly sales data for Q1 2024",
      "fileUrl": "https://s3.amazonaws.com/bucket/sales_data_2024.xlsx",
      "fileKey": "sales_data_2024_123456789",
      "data": {
        "sheets": ["Sheet1", "Sheet2"],
        "totalRows": 1500,
        "columns": ["Date", "Product", "Sales", "Region"]
      },
      "uploadedBy": "507f1f77bcf86cd799439012",
      "fileSize": 2048576,
      "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "processingStatus": "pending",
      "recordsCount": 0,
      "isActive": true
    }
  ],
  "batchSize": 50
}
```

#### Response
```json
{
  "status": "success",
  "message": "Bulk import completed",
  "results": {
    "total": 1,
    "created": 1,
    "updated": 0,
    "failed": 0,
    "errors": [],
    "processingTime": 150
  }
}
```

## Error Responses

### 400 Bad Request
```json
{
  "status": "error",
  "message": "File key already taken",
  "code": 400
}
```

### 401 Unauthorized
```json
{
  "status": "error",
  "message": "Please authenticate",
  "code": 401
}
```

### 404 Not Found
```json
{
  "status": "error",
  "message": "Seals Excel Master record not found",
  "code": 404
}
```

### 422 Validation Error
```json
{
  "status": "error",
  "message": "Validation Error",
  "code": 422,
  "errors": [
    {
      "field": "fileName",
      "message": "fileName is required"
    }
  ]
}
```

## Frontend Integration Examples

### JavaScript/TypeScript Examples

#### Create a new record
```javascript
const createRecord = async (recordData) => {
  try {
    const response = await fetch('/v1/seals-excel-master', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(recordData)
    });
    
    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error creating record:', error);
    throw error;
  }
};
```

#### Get paginated records with filters
```javascript
const getRecords = async (filters = {}, options = {}) => {
  try {
    const queryParams = new URLSearchParams({
      ...filters,
      ...options
    });
    
    const response = await fetch(`/v1/seals-excel-master?${queryParams}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error fetching records:', error);
    throw error;
  }
};

// Usage
const records = await getRecords(
  { processingStatus: 'completed' },
  { sortBy: 'createdAt:desc', limit: 20, page: 1 }
);
```

#### Update processing status
```javascript
const updateStatus = async (recordId, status, errorMessage = null) => {
  try {
    const response = await fetch(`/v1/seals-excel-master/${recordId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ status, errorMessage })
    });
    
    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error updating status:', error);
    throw error;
  }
};
```

#### Get user's uploads
```javascript
const getUserUploads = async (userId = null, options = {}) => {
  try {
    const url = userId 
      ? `/v1/seals-excel-master/user/${userId}`
      : '/v1/seals-excel-master/user';
    
    const queryParams = new URLSearchParams(options);
    const response = await fetch(`${url}?${queryParams}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error fetching user uploads:', error);
    throw error;
  }
};
```

### React Hook Example
```javascript
import { useState, useEffect } from 'react';

const useSealsExcelMaster = () => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchRecords = async (filters = {}, options = {}) => {
    setLoading(true);
    setError(null);
    
    try {
      const queryParams = new URLSearchParams({
        ...filters,
        ...options
      });
      
      const response = await fetch(`/v1/seals-excel-master?${queryParams}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      const result = await response.json();
      
      if (result.status === 'success') {
        setRecords(result.data.results);
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const createRecord = async (recordData) => {
    try {
      const response = await fetch('/v1/seals-excel-master', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(recordData)
      });
      
      const result = await response.json();
      
      if (result.status === 'success') {
        // Refresh the list
        await fetchRecords();
        return result.data;
      } else {
        throw new Error(result.message);
      }
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  return {
    records,
    loading,
    error,
    fetchRecords,
    createRecord
  };
};
```

## Notes

1. **File Key Uniqueness**: The `fileKey` field must be unique across all records. This is typically a combination of filename and timestamp or a UUID.

2. **Processing Status Flow**: The typical flow is `pending` → `processing` → `completed` or `failed`.

3. **Data Field**: The `data` field can contain any JSON structure representing the parsed Excel data.

4. **File Size**: The `fileSize` field should be in bytes.

5. **Pagination**: All list endpoints support pagination with `limit` and `page` parameters.

6. **Filtering**: Use query parameters to filter results by various fields.

7. **Sorting**: Use `sortBy` parameter with format `field:direction` (e.g., `createdAt:desc`).

8. **Bulk Import**: Limited to 1000 records per request with configurable batch size.

9. **Error Handling**: Always check the response status and handle errors appropriately.

10. **Authentication**: All endpoints require a valid JWT token in the Authorization header. 