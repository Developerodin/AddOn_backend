# Yarn Catalog API Documentation

Complete API reference for managing yarn catalog entries. Yarn catalogs combine yarn types, count sizes, blends, colors, and other attributes to create comprehensive yarn product definitions.

**Base URL:** `/v1/yarn-management/yarn-catalogs`

**Authentication:** All endpoints require JWT token in Authorization header:
```
Authorization: Bearer {your-jwt-token}
```

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Data Model](#data-model)
3. [CRUD Operations](#crud-operations)
   - [Create Yarn Catalog](#1-create-yarn-catalog)
   - [Get All Yarn Catalogs](#2-get-all-yarn-catalogs)
   - [Get Yarn Catalog by ID](#3-get-yarn-catalog-by-id)
   - [Update Yarn Catalog](#4-update-yarn-catalog)
   - [Delete Yarn Catalog](#5-delete-yarn-catalog)
4. [Bulk Import](#bulk-import)
5. [Embedded Objects](#embedded-objects)
6. [Error Handling](#error-handling)
7. [Best Practices](#best-practices)

---

## Overview

Yarn Catalog is a comprehensive system that stores complete yarn product information by combining:
- **Yarn Type**: The base type of yarn (e.g., "Cotton", "Polyester")
- **Yarn Subtype**: Optional subtype from yarn type details
- **Count Size**: The yarn count/size (e.g., "40s", "60s")
- **Blend**: Yarn blend information
- **Color Family**: Optional color information
- **Additional Attributes**: Pantone shades, season, GST, HSN code, remarks

The system automatically generates a `yarnName` in the format: `count/size-colour-type/sub-type` if not explicitly provided.

**Key Features:**
- Stores embedded objects (not just IDs) for better data integrity
- Frontend can send IDs - backend automatically converts to full objects
- Automatic yarn name generation
- Bulk import support for up to 1000 records
- Comprehensive filtering and pagination

---

## Data Model

### Yarn Catalog Schema

```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "yarnName": "40s-Red-Cotton/Combed",
  "yarnType": {
    "id": "65f1a2b3c4d5e6f7g8h9i0j2",
    "name": "Cotton",
    "status": "active"
  },
  "yarnSubtype": {
    "id": "65f1a2b3c4d5e6f7g8h9i0j3",
    "subtype": "Combed",
    "countSize": [],
    "tearWeight": ""
  },
  "countSize": {
    "id": "65f1a2b3c4d5e6f7g8h9i0j4",
    "name": "40s",
    "status": "active"
  },
  "blend": {
    "id": "65f1a2b3c4d5e6f7g8h9i0j5",
    "name": "Cotton-Polyester",
    "status": "active"
  },
  "colorFamily": {
    "id": "65f1a2b3c4d5e6f7g8h9i0j6",
    "name": "Red",
    "colorCode": "#FF5733",
    "status": "active"
  },
  "pantonShade": "PMS 186 C",
  "pantonName": "Bright Red",
  "season": "Spring 2024",
  "gst": 18,
  "remark": "Premium quality yarn",
  "hsnCode": "52051200",
  "status": "active",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `yarnName` | string | No | Auto-generated name (format: count/size-colour-type/sub-type) |
| `yarnType` | ObjectId/Embedded | Yes | Reference to yarn type (ID accepted, stored as embedded object) |
| `yarnSubtype` | ObjectId/Embedded | No | Reference to yarn subtype from yarn type details |
| `countSize` | ObjectId/Embedded | Yes | Reference to count size (ID accepted, stored as embedded object) |
| `blend` | ObjectId/Embedded | Yes | Reference to blend (ID accepted, stored as embedded object) |
| `colorFamily` | ObjectId/Embedded | No | Reference to color (ID accepted, stored as embedded object) |
| `pantonShade` | string | No | Pantone shade code |
| `pantonName` | string | No | Pantone color name |
| `season` | string | No | Season information |
| `gst` | number | No | GST percentage (0-100) |
| `remark` | string | No | Additional remarks |
| `hsnCode` | string | No | HSN code (automatically uppercased) |
| `status` | string | No | Status: "active", "inactive", or "suspended" (default: "active") |

---

## CRUD Operations

### 1. Create Yarn Catalog

**Endpoint:** `POST /v1/yarn-management/yarn-catalogs`

**Description:** Create a new yarn catalog entry. You can send IDs for references - the system will automatically fetch and store full embedded objects.

**Request Body:**
```json
{
  "yarnType": "65f1a2b3c4d5e6f7g8h9i0j2",
  "yarnSubtype": "65f1a2b3c4d5e6f7g8h9i0j3",
  "countSize": "65f1a2b3c4d5e6f7g8h9i0j4",
  "blend": "65f1a2b3c4d5e6f7g8h9i0j5",
  "colorFamily": "65f1a2b3c4d5e6f7g8h9i0j6",
  "pantonShade": "PMS 186 C",
  "pantonName": "Bright Red",
  "season": "Spring 2024",
  "gst": 18,
  "remark": "Premium quality yarn",
  "hsnCode": "52051200",
  "status": "active"
}
```

**cURL Example:**
```bash
curl -X POST \
  'http://localhost:3000/v1/yarn-management/yarn-catalogs' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "yarnType": "65f1a2b3c4d5e6f7g8h9i0j2",
    "countSize": "65f1a2b3c4d5e6f7g8h9i0j4",
    "blend": "65f1a2b3c4d5e6f7g8h9i0j5",
    "colorFamily": "65f1a2b3c4d5e6f7g8h9i0j6",
    "gst": 18,
    "status": "active"
  }'
```

**Response (201 Created):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "yarnName": "40s-Red-Cotton",
  "yarnType": {
    "id": "65f1a2b3c4d5e6f7g8h9i0j2",
    "name": "Cotton",
    "status": "active"
  },
  "countSize": {
    "id": "65f1a2b3c4d5e6f7g8h9i0j4",
    "name": "40s",
    "status": "active"
  },
  "blend": {
    "id": "65f1a2b3c4d5e6f7g8h9i0j5",
    "name": "Cotton-Polyester",
    "status": "active"
  },
  "colorFamily": {
    "id": "65f1a2b3c4d5e6f7g8h9i0j6",
    "name": "Red",
    "colorCode": "#FF5733",
    "status": "active"
  },
  "gst": 18,
  "status": "active",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

**Error Responses:**
- `400 Bad Request`: Missing required fields (yarnType, countSize, blend)
- `400 Bad Request`: Yarn name already taken (if yarnName provided)
- `400 Bad Request`: Invalid ObjectId format
- `404 Not Found`: Referenced yarn type, count size, blend, or color not found

---

### 2. Get All Yarn Catalogs

**Endpoint:** `GET /v1/yarn-management/yarn-catalogs`

**Description:** Retrieve all yarn catalogs with pagination, filtering, and sorting support.

**Query Parameters:**
- `yarnName` (optional, string): Filter by yarn name (partial match)
- `status` (optional, string): Filter by status ("active", "inactive", "suspended")
- `yarnType` (optional, ObjectId): Filter by yarn type ID
- `countSize` (optional, ObjectId): Filter by count size ID
- `blend` (optional, ObjectId): Filter by blend ID
- `colorFamily` (optional, ObjectId): Filter by color family ID
- `sortBy` (optional, string): Sort field and order (e.g., "yarnName:asc", "createdAt:desc")
- `limit` (optional, number): Number of results per page (default: 10)
- `page` (optional, number): Page number (default: 1)

**cURL Example:**
```bash
curl -X GET \
  'http://localhost:3000/v1/yarn-management/yarn-catalogs?status=active&sortBy=yarnName:asc&limit=20&page=1' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Response (200 OK):**
```json
{
  "results": [
    {
      "id": "65f1a2b3c4d5e6f7g8h9i0j1",
      "yarnName": "40s-Red-Cotton",
      "yarnType": {
        "id": "65f1a2b3c4d5e6f7g8h9i0j2",
        "name": "Cotton",
        "status": "active"
      },
      "countSize": {
        "id": "65f1a2b3c4d5e6f7g8h9i0j4",
        "name": "40s",
        "status": "active"
      },
      "brand": {
        "id": "65f1a2b3c4d5e6f7g8h9i0j5",
        "brandName": "ABC Yarns",
        "status": "active"
      },
      "colorFamily": {
        "id": "65f1a2b3c4d5e6f7g8h9i0j6",
        "name": "Red",
        "colorCode": "#FF5733",
        "status": "active"
      },
      "status": "active",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "page": 1,
  "limit": 20,
  "totalPages": 5,
  "totalResults": 100
}
```

---

### 3. Get Yarn Catalog by ID

**Endpoint:** `GET /v1/yarn-management/yarn-catalogs/:yarnCatalogId`

**Description:** Retrieve a specific yarn catalog by its ID.

**Path Parameters:**
- `yarnCatalogId` (required, ObjectId): The ID of the yarn catalog

**cURL Example:**
```bash
curl -X GET \
  'http://localhost:3000/v1/yarn-management/yarn-catalogs/65f1a2b3c4d5e6f7g8h9i0j1' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Response (200 OK):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "yarnName": "40s-Red-Cotton/Combed",
  "yarnType": {
    "id": "65f1a2b3c4d5e6f7g8h9i0j2",
    "name": "Cotton",
    "status": "active"
  },
  "yarnSubtype": {
    "id": "65f1a2b3c4d5e6f7g8h9i0j3",
    "subtype": "Combed",
    "countSize": [],
    "tearWeight": ""
  },
  "countSize": {
    "id": "65f1a2b3c4d5e6f7g8h9i0j4",
    "name": "40s",
    "status": "active"
  },
  "blend": {
    "id": "65f1a2b3c4d5e6f7g8h9i0j5",
    "name": "Cotton-Polyester",
    "status": "active"
  },
  "colorFamily": {
    "id": "65f1a2b3c4d5e6f7g8h9i0j6",
    "name": "Red",
    "colorCode": "#FF5733",
    "status": "active"
  },
  "pantonShade": "PMS 186 C",
  "pantonName": "Bright Red",
  "season": "Spring 2024",
  "gst": 18,
  "remark": "Premium quality yarn",
  "hsnCode": "52051200",
  "status": "active",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

**Error Responses:**
- `404 Not Found`: Yarn catalog not found
- `400 Bad Request`: Invalid ObjectId format

---

### 4. Update Yarn Catalog

**Endpoint:** `PATCH /v1/yarn-management/yarn-catalogs/:yarnCatalogId`

**Description:** Update an existing yarn catalog. You can update any field(s). Send IDs for references - they will be converted to embedded objects automatically.

**Path Parameters:**
- `yarnCatalogId` (required, ObjectId): The ID of the yarn catalog to update

**Request Body:**
```json
{
  "gst": 20,
  "remark": "Updated premium quality yarn",
  "status": "active"
}
```

**cURL Example:**
```bash
curl -X PATCH \
  'http://localhost:3000/v1/yarn-management/yarn-catalogs/65f1a2b3c4d5e6f7g8h9i0j1' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "gst": 20,
    "remark": "Updated premium quality yarn"
  }'
```

**Response (200 OK):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "yarnName": "40s-Red-Cotton",
  "yarnType": {
    "id": "65f1a2b3c4d5e6f7g8h9i0j2",
    "name": "Cotton",
    "status": "active"
  },
  "countSize": {
    "id": "65f1a2b3c4d5e6f7g8h9i0j4",
    "name": "40s",
    "status": "active"
  },
  "blend": {
    "id": "65f1a2b3c4d5e6f7g8h9i0j5",
    "name": "Cotton-Polyester",
    "status": "active"
  },
  "colorFamily": {
    "id": "65f1a2b3c4d5e6f7g8h9i0j6",
    "name": "Red",
    "colorCode": "#FF5733",
    "status": "active"
  },
  "gst": 20,
  "remark": "Updated premium quality yarn",
  "status": "active",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T11:00:00.000Z"
}
```

**Error Responses:**
- `404 Not Found`: Yarn catalog not found
- `400 Bad Request`: Yarn name already taken (if updating yarnName)
- `400 Bad Request`: Invalid ObjectId format

---

### 5. Delete Yarn Catalog

**Endpoint:** `DELETE /v1/yarn-management/yarn-catalogs/:yarnCatalogId`

**Description:** Delete a yarn catalog by its ID.

**Path Parameters:**
- `yarnCatalogId` (required, ObjectId): The ID of the yarn catalog to delete

**cURL Example:**
```bash
curl -X DELETE \
  'http://localhost:3000/v1/yarn-management/yarn-catalogs/65f1a2b3c4d5e6f7g8h9i0j1' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Response (204 No Content):**
No response body

**Error Responses:**
- `404 Not Found`: Yarn catalog not found
- `400 Bad Request`: Invalid ObjectId format

---

## Bulk Import

**Endpoint:** `POST /v1/yarn-management/yarn-catalogs/bulk-import`

**Description:** Bulk import yarn catalogs with batch processing. Supports creating new records and updating existing ones. Process up to 1000 records per request.

**Request Body:**
```json
{
  "yarnCatalogs": [
    {
      "id": "65f1a2b3c4d5e6f7g8h9i0j1",
      "yarnType": "65f1a2b3c4d5e6f7g8h9i0j2",
      "countSize": "65f1a2b3c4d5e6f7g8h9i0j4",
      "blend": "65f1a2b3c4d5e6f7g8h9i0j5",
      "colorFamily": "65f1a2b3c4d5e6f7g8h9i0j6",
      "gst": 18,
      "status": "active"
    },
    {
      "yarnType": "65f1a2b3c4d5e6f7g8h9i0j2",
      "countSize": "65f1a2b3c4d5e6f7g8h9i0j7",
      "blend": "65f1a2b3c4d5e6f7g8h9i0j5",
      "gst": 18,
      "status": "active"
    }
  ],
  "batchSize": 50
}
```

**Field Descriptions:**
- `yarnCatalogs` (required, array): Array of yarn catalog objects (1-1000 items)
  - `id` (optional, string): MongoDB ObjectId for updating existing yarn catalog
  - `yarnType` (required, ObjectId): Yarn type ID
  - `yarnSubtype` (optional, ObjectId): Yarn subtype ID
  - `countSize` (required, ObjectId): Count size ID
  - `blend` (required, ObjectId): Blend ID
  - `colorFamily` (optional, ObjectId): Color family ID
  - `pantonShade` (optional, string): Pantone shade code
  - `pantonName` (optional, string): Pantone color name
  - `season` (optional, string): Season information
  - `gst` (optional, number): GST percentage (0-100)
  - `remark` (optional, string): Additional remarks
  - `hsnCode` (optional, string): HSN code
  - `status` (optional, string): Status (default: "active")
- `batchSize` (optional, number): Number of records per batch (1-100, default: 50)

**cURL Example:**
```bash
curl -X POST \
  'http://localhost:3000/v1/yarn-management/yarn-catalogs/bulk-import' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "yarnCatalogs": [
      {
        "yarnType": "65f1a2b3c4d5e6f7g8h9i0j2",
        "countSize": "65f1a2b3c4d5e6f7g8h9i0j4",
        "blend": "65f1a2b3c4d5e6f7g8h9i0j5",
        "gst": 18,
        "status": "active"
      }
    ],
    "batchSize": 50
  }'
```

**Response (200 OK / 206 Partial Content / 400 Bad Request):**
```json
{
  "message": "Bulk import completed",
  "summary": {
    "total": 100,
    "created": 80,
    "updated": 15,
    "failed": 5,
    "successRate": "95.00%",
    "processingTime": "1234ms"
  },
  "details": {
    "successful": 95,
    "errors": [
      {
        "index": 10,
        "yarnName": "40s-Red-Cotton",
        "error": "Yarn type is required"
      },
      {
        "index": 25,
        "yarnName": "60s-Blue-Polyester",
        "error": "Invalid yarn catalog ID format"
      }
    ]
  }
}
```

**HTTP Status Codes:**
- `200 OK`: All records processed successfully
- `206 Partial Content`: Some records failed, but some succeeded
- `400 Bad Request`: All records failed or validation error

**Error Handling:**
- Each failed record includes its index, yarnName (if available), and error message
- Processing continues even if individual records fail
- Batch processing ensures optimal performance

---

## Embedded Objects

### How It Works

The Yarn Catalog system uses **embedded objects** instead of just storing IDs. This means:

1. **Frontend sends IDs**: You can send ObjectIds as strings for references
2. **Backend converts automatically**: The system fetches full objects and stores them
3. **Better data integrity**: Even if referenced objects are deleted, the catalog retains the information
4. **No additional queries**: Embedded objects are returned directly, no need for separate lookups

### Example: Creating with IDs

**Request:**
```json
{
  "yarnType": "65f1a2b3c4d5e6f7g8h9i0j2",
  "countSize": "65f1a2b3c4d5e6f7g8h9i0j4",
  "brand": "65f1a2b3c4d5e6f7g8h9i0j5"
}
```

**Stored (automatically converted):**
```json
{
  "yarnType": {
    "_id": "65f1a2b3c4d5e6f7g8h9i0j2",
    "name": "Cotton",
    "status": "active"
  },
  "countSize": {
    "_id": "65f1a2b3c4d5e6f7g8h9i0j4",
    "name": "40s",
    "status": "active"
  },
  "brand": {
    "_id": "65f1a2b3c4d5e6f7g8h9i0j5",
    "brandName": "ABC Yarns",
    "status": "active"
  }
}
```

**Response (with id instead of _id):**
```json
{
  "yarnType": {
    "id": "65f1a2b3c4d5e6f7g8h9i0j2",
    "name": "Cotton",
    "status": "active"
  },
  "countSize": {
    "id": "65f1a2b3c4d5e6f7g8h9i0j4",
    "name": "40s",
    "status": "active"
  },
  "brand": {
    "id": "65f1a2b3c4d5e6f7g8h9i0j5",
    "brandName": "ABC Yarns",
    "status": "active"
  }
}
```

### Deleted References

If a referenced object (yarn type, count size, etc.) is deleted, the catalog stores it with a "deleted" status:

```json
{
  "yarnType": {
    "id": "65f1a2b3c4d5e6f7g8h9i0j2",
    "name": "Unknown",
    "status": "deleted"
  }
}
```

---

## Error Handling

### Common Error Responses

**400 Bad Request:**
```json
{
  "status": "error",
  "statusCode": 400,
  "message": "Yarn type is required"
}
```

**404 Not Found:**
```json
{
  "status": "error",
  "statusCode": 404,
  "message": "Yarn catalog not found"
}
```

**401 Unauthorized:**
```json
{
  "status": "error",
  "statusCode": 401,
  "message": "Please authenticate"
}
```

### Validation Errors

When validation fails, you'll receive detailed error messages:
```json
{
  "status": "error",
  "statusCode": 400,
  "message": "Validation error",
  "errors": [
    {
      "field": "yarnType",
      "message": "Yarn type is required"
    },
    {
      "field": "gst",
      "message": "GST must be between 0 and 100"
    }
  ]
}
```

---

## Best Practices

### 1. Yarn Name Generation

- **Automatic**: If you don't provide `yarnName`, it's auto-generated as: `count/size-colour-type/sub-type`
- **Manual Override**: You can provide a custom `yarnName` if needed
- **Uniqueness**: Yarn names must be unique (if explicitly provided)

### 2. Using IDs vs Embedded Objects

- **Always send IDs**: Frontend should send ObjectId strings for references
- **Backend handles conversion**: Don't send full objects - let the backend convert them
- **Consistent format**: Responses always return embedded objects with `id` field

### 3. Bulk Import Tips

- **Batch size**: Use default batch size (50) for optimal performance
- **Error handling**: Check the `errors` array in response for failed records
- **Update vs Create**: Include `id` field to update existing records
- **Validation**: Validate data before sending to avoid unnecessary failures

### 4. Filtering and Pagination

- **Use filters**: Filter by status, yarnType, blend, etc. to narrow results
- **Pagination**: Always use pagination for large datasets
- **Sorting**: Use `sortBy` parameter for consistent ordering

### 5. Status Management

- **Active**: Normal operational status
- **Inactive**: Temporarily disabled
- **Suspended**: Suspended due to issues

### 6. Required Fields

Always provide:
- `yarnType` (required)
- `countSize` (required)
- `blend` (required)

Optional but recommended:
- `colorFamily` (for colored yarns)
- `yarnSubtype` (for specific subtypes)
- `gst` and `hsnCode` (for tax compliance)

---

## Examples

### Complete Example: Creating a Full Yarn Catalog

```bash
curl -X POST \
  'http://localhost:3000/v1/yarn-management/yarn-catalogs' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "yarnType": "65f1a2b3c4d5e6f7g8h9i0j2",
    "yarnSubtype": "65f1a2b3c4d5e6f7g8h9i0j3",
    "countSize": "65f1a2b3c4d5e6f7g8h9i0j4",
    "blend": "65f1a2b3c4d5e6f7g8h9i0j5",
    "colorFamily": "65f1a2b3c4d5e6f7g8h9i0j6",
    "pantonShade": "PMS 186 C",
    "pantonName": "Bright Red",
    "season": "Spring 2024",
    "gst": 18,
    "remark": "Premium quality combed cotton yarn",
    "hsnCode": "52051200",
    "status": "active"
  }'
```

### Example: Filtering by Blend and Status

```bash
curl -X GET \
  'http://localhost:3000/v1/yarn-management/yarn-catalogs?blend=65f1a2b3c4d5e6f7g8h9i0j5&status=active&sortBy=yarnName:asc&limit=50&page=1' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

### Example: Bulk Import with Updates

```json
{
  "yarnCatalogs": [
    {
      "id": "65f1a2b3c4d5e6f7g8h9i0j1",
      "gst": 20,
      "status": "active"
    },
    {
      "yarnType": "65f1a2b3c4d5e6f7g8h9i0j2",
      "countSize": "65f1a2b3c4d5e6f7g8h9i0j4",
      "blend": "65f1a2b3c4d5e6f7g8h9i0j5",
      "status": "active"
    }
  ]
}
```

---

## Support

For issues or questions:
- Check error messages for detailed validation feedback
- Review embedded object structure in responses
- Ensure all referenced IDs exist before creating catalogs
- Use bulk import for large datasets (up to 1000 records)

---

**Last Updated:** 2024-01-15
**API Version:** 1.0.0

