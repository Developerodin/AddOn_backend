# Bulk Import API Documentation

Complete API reference for bulk import operations across yarn management resources including blends, colors, count sizes, suppliers, and yarn types.

**Base URL:** `/v1`

**Authentication:** All endpoints require JWT token in Authorization header:
```
Authorization: Bearer {your-jwt-token}
```

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Blends Bulk Import](#blends-bulk-import)
3. [Colors Bulk Import](#colors-bulk-import)
4. [Count Sizes Bulk Import](#count-sizes-bulk-import)
5. [Suppliers Bulk Import](#suppliers-bulk-import)
6. [Yarn Types Bulk Import](#yarn-types-bulk-import)
7. [Common Features](#common-features)
8. [Error Handling](#error-handling)
9. [Best Practices](#best-practices)

---

## Overview

Bulk import APIs allow you to create or update multiple records in a single request. These endpoints support:

- **Batch Processing**: Process records in configurable batches (default: 50)
- **Create or Update**: Include `id` field to update existing records, omit to create new ones
- **Validation**: Comprehensive validation for all fields
- **Error Tracking**: Detailed error messages for failed records
- **Performance**: Optimized for handling up to 1000 records per request

### Common Request Structure

All bulk import endpoints follow this structure:

```json
{
  "{resource}": [
    {
      "id": "optional-mongodb-id-for-updates",
      // ... resource-specific fields
    }
  ],
  "batchSize": 50
}
```

### Common Response Structure

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
        "name": "Example Name",
        "error": "Error message here"
      }
    ]
  }
}
```

### HTTP Status Codes

- `200 OK`: All records processed successfully
- `206 Partial Content`: Some records failed, but some succeeded
- `400 Bad Request`: All records failed or validation error

---

## Blends Bulk Import

**Endpoint:** `POST /v1/blends/bulk-import`

**Description:** Bulk import blends with name and status.

### Request Body

```json
{
  "blends": [
    {
      "id": "65f1a2b3c4d5e6f7g8h9i0j1",
      "name": "Cotton Blend",
      "status": "active"
    },
    {
      "name": "Polyester Blend",
      "status": "active"
    }
  ],
  "batchSize": 50
}
```

### Field Descriptions

- `blends` (required, array): Array of blend objects (1-1000 items)
  - `id` (optional, string): MongoDB ObjectId for updating existing blend
  - `name` (required, string): Blend name (must be unique)
  - `status` (optional, string): "active" or "inactive" (default: "active")
- `batchSize` (optional, number): Number of records per batch (1-100, default: 50)

### cURL Example

```bash
curl -X POST \
  'http://localhost:3000/v1/blends/bulk-import' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "blends": [
      {
        "name": "Cotton Blend",
        "status": "active"
      },
      {
        "name": "Polyester Blend",
        "status": "active"
      }
    ],
    "batchSize": 50
  }'
```

### Response Example

```json
{
  "message": "Bulk import completed",
  "summary": {
    "total": 2,
    "created": 2,
    "updated": 0,
    "failed": 0,
    "successRate": "100.00%",
    "processingTime": "45ms"
  },
  "details": {
    "successful": 2,
    "errors": []
  }
}
```

---

## Colors Bulk Import

**Endpoint:** `POST /v1/colors/bulk-import`

**Description:** Bulk import colors with name, color code, and status.

### Request Body

```json
{
  "colors": [
    {
      "id": "65f1a2b3c4d5e6f7g8h9i0j1",
      "name": "Red",
      "colorCode": "#FF5733",
      "status": "active"
    },
    {
      "name": "Blue",
      "colorCode": "#3498DB",
      "status": "active"
    }
  ],
  "batchSize": 50
}
```

### Field Descriptions

- `colors` (required, array): Array of color objects (1-1000 items)
  - `id` (optional, string): MongoDB ObjectId for updating existing color
  - `name` (required, string): Color name (must be unique)
  - `colorCode` (required, string): Hex color code in format #RRGGBB (e.g., #FF5733)
  - `status` (optional, string): "active" or "inactive" (default: "active")
- `batchSize` (optional, number): Number of records per batch (1-100, default: 50)

### cURL Example

```bash
curl -X POST \
  'http://localhost:3000/v1/colors/bulk-import' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "colors": [
      {
        "name": "Red",
        "colorCode": "#FF5733",
        "status": "active"
      },
      {
        "name": "Blue",
        "colorCode": "#3498DB",
        "status": "active"
      }
    ],
    "batchSize": 50
  }'
```

### Response Example

```json
{
  "message": "Bulk import completed",
  "summary": {
    "total": 2,
    "created": 2,
    "updated": 0,
    "failed": 0,
    "successRate": "100.00%",
    "processingTime": "52ms"
  },
  "details": {
    "successful": 2,
    "errors": []
  }
}
```

---

## Count Sizes Bulk Import

**Endpoint:** `POST /v1/countSizes/bulk-import`

**Description:** Bulk import count sizes with name and status.

### Request Body

```json
{
  "countSizes": [
    {
      "id": "65f1a2b3c4d5e6f7g8h9i0j1",
      "name": "40s",
      "status": "active"
    },
    {
      "name": "60s",
      "status": "active"
    }
  ],
  "batchSize": 50
}
```

### Field Descriptions

- `countSizes` (required, array): Array of count size objects (1-1000 items)
  - `id` (optional, string): MongoDB ObjectId for updating existing count size
  - `name` (required, string): Count size name (must be unique)
  - `status` (optional, string): "active" or "inactive" (default: "active")
- `batchSize` (optional, number): Number of records per batch (1-100, default: 50)

### cURL Example

```bash
curl -X POST \
  'http://localhost:3000/v1/countSizes/bulk-import' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "countSizes": [
      {
        "name": "40s",
        "status": "active"
      },
      {
        "name": "60s",
        "status": "active"
      }
    ],
    "batchSize": 50
  }'
```

### Response Example

```json
{
  "message": "Bulk import completed",
  "summary": {
    "total": 2,
    "created": 2,
    "updated": 0,
    "failed": 0,
    "successRate": "100.00%",
    "processingTime": "38ms"
  },
  "details": {
    "successful": 2,
    "errors": []
  }
}
```

---

## Suppliers Bulk Import

**Endpoint:** `POST /v1/suppliers/bulk-import`

**Description:** Bulk import suppliers with complete information including yarn details.

### Request Body

```json
{
  "suppliers": [
    {
      "id": "65f1a2b3c4d5e6f7g8h9i0j1",
      "brandName": "ABC Yarns",
      "contactPersonName": "John Doe",
      "contactNumber": "+1234567890",
      "email": "contact@abcyarns.com",
      "address": "123 Main Street",
      "city": "Mumbai",
      "state": "Maharashtra",
      "pincode": "400001",
      "country": "India",
      "gstNo": "27ABCDE1234F1Z5",
      "yarnDetails": [
        {
          "yarnType": "65f1a2b3c4d5e6f7g8h9i0j2",
          "yarnsubtype": "65f1a2b3c4d5e6f7g8h9i0j3",
          "color": "65f1a2b3c4d5e6f7g8h9i0j4",
          "shadeNumber": "SH001"
        }
      ],
      "status": "active"
    }
  ],
  "batchSize": 50
}
```

### Field Descriptions

- `suppliers` (required, array): Array of supplier objects (1-1000 items)
  - `id` (optional, string): MongoDB ObjectId for updating existing supplier
  - `brandName` (required, string): Supplier brand name
  - `contactPersonName` (required, string): Contact person's name
  - `contactNumber` (required, string): Contact number (10-15 digits, supports +, spaces, dashes, parentheses)
  - `email` (required, string): Email address (must be unique)
  - `address` (required, string): Street address
  - `city` (required, string): City name
  - `state` (required, string): State name
  - `pincode` (required, string): 6-digit pincode
  - `country` (required, string): Country name
  - `gstNo` (optional, string): GST number (must be unique if provided)
  - `yarnDetails` (optional, array): Array of yarn detail objects
    - `yarnType` (required, string/ObjectId): YarnType ID or embedded object
    - `yarnsubtype` (optional, string/ObjectId): YarnSubtype ID (must exist in YarnType details)
    - `color` (required, string/ObjectId): Color ID or embedded object
    - `shadeNumber` (optional, string): Shade number
  - `status` (optional, string): "active", "inactive", or "suspended" (default: "active")
- `batchSize` (optional, number): Number of records per batch (1-100, default: 50)

### Notes

- Yarn details can be provided as ObjectIds (strings) - they will be automatically converted to embedded objects
- The `yarnsubtype` must exist in the referenced YarnType's details array
- Email and GST number must be unique across all suppliers

### cURL Example

```bash
curl -X POST \
  'http://localhost:3000/v1/suppliers/bulk-import' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "suppliers": [
      {
        "brandName": "ABC Yarns",
        "contactPersonName": "John Doe",
        "contactNumber": "+1234567890",
        "email": "contact@abcyarns.com",
        "address": "123 Main Street",
        "city": "Mumbai",
        "state": "Maharashtra",
        "pincode": "400001",
        "country": "India",
        "gstNo": "27ABCDE1234F1Z5",
        "yarnDetails": [
          {
            "yarnType": "65f1a2b3c4d5e6f7g8h9i0j2",
            "color": "65f1a2b3c4d5e6f7g8h9i0j4",
            "shadeNumber": "SH001"
          }
        ],
        "status": "active"
      }
    ],
    "batchSize": 50
  }'
```

### Response Example

```json
{
  "message": "Bulk import completed",
  "summary": {
    "total": 1,
    "created": 1,
    "updated": 0,
    "failed": 0,
    "successRate": "100.00%",
    "processingTime": "156ms"
  },
  "details": {
    "successful": 1,
    "errors": []
  }
}
```

---

## Yarn Types Bulk Import

**Endpoint:** `POST /v1/yarnTypes/bulk-import`

**Description:** Bulk import yarn types with name, details (subtypes with count sizes), and status.

### Request Body

```json
{
  "yarnTypes": [
    {
      "id": "65f1a2b3c4d5e6f7g8h9i0j1",
      "name": "Cotton",
      "details": [
        {
          "subtype": "Combed",
          "countSize": [
            "65f1a2b3c4d5e6f7g8h9i0j2",
            "65f1a2b3c4d5e6f7g8h9i0j3"
          ],
          "tearWeight": "120g"
        }
      ],
      "status": "active"
    }
  ],
  "batchSize": 50
}
```

### Field Descriptions

- `yarnTypes` (required, array): Array of yarn type objects (1-1000 items)
  - `id` (optional, string): MongoDB ObjectId for updating existing yarn type
  - `name` (required, string): Yarn type name (must be unique)
  - `details` (optional, array): Array of detail objects
    - `subtype` (required, string): Subtype name
    - `countSize` (optional, array): Array of CountSize IDs (strings) - will be converted to embedded objects
    - `tearWeight` (optional, string): Tear weight
  - `status` (optional, string): "active" or "inactive" (default: "active")
- `batchSize` (optional, number): Number of records per batch (1-100, default: 50)

### Notes

- Count sizes can be provided as ObjectIds (strings) - they will be automatically converted to embedded objects
- If a count size ID doesn't exist, it will be stored with status "deleted" and name "Unknown"

### cURL Example

```bash
curl -X POST \
  'http://localhost:3000/v1/yarnTypes/bulk-import' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "yarnTypes": [
      {
        "name": "Cotton",
        "details": [
          {
            "subtype": "Combed",
            "countSize": [
              "65f1a2b3c4d5e6f7g8h9i0j2",
              "65f1a2b3c4d5e6f7g8h9i0j3"
            ],
            "tearWeight": "120g"
          }
        ],
        "status": "active"
      }
    ],
    "batchSize": 50
  }'
```

### Response Example

```json
{
  "message": "Bulk import completed",
  "summary": {
    "total": 1,
    "created": 1,
    "updated": 0,
    "failed": 0,
    "successRate": "100.00%",
    "processingTime": "89ms"
  },
  "details": {
    "successful": 1,
    "errors": []
  }
}
```

---

## Common Features

### Create vs Update

- **Create**: Omit the `id` field to create a new record
- **Update**: Include the `id` field to update an existing record

### Batch Processing

Records are processed in batches to optimize performance and memory usage:

- Default batch size: 50 records
- Configurable range: 1-100 records per batch
- Larger batches = faster processing but higher memory usage
- Smaller batches = slower processing but lower memory usage

### Validation

All endpoints perform comprehensive validation:

- **Required fields**: All required fields must be present
- **Format validation**: Email, phone, pincode, GST, color code formats
- **Uniqueness**: Name, email, GST number uniqueness checks
- **Reference validation**: ObjectId references (yarnType, color, countSize, etc.)

### Error Handling

Each failed record includes detailed error information:

```json
{
  "index": 5,
  "name": "Example Name",
  "error": "Blend name 'Example Name' already taken"
}
```

Error fields vary by resource type:
- **Blends/CountSizes/YarnTypes**: `name`, `error`
- **Colors**: `name`, `colorCode`, `error`
- **Suppliers**: `brandName`, `email`, `error`

---

## Error Handling

### Common Error Scenarios

1. **Missing Required Fields**
   ```json
   {
     "index": 0,
     "name": "N/A",
     "error": "Missing required fields: name"
   }
   ```

2. **Duplicate Values**
   ```json
   {
     "index": 2,
     "name": "Cotton Blend",
     "error": "Blend name 'Cotton Blend' already taken"
   }
   ```

3. **Invalid Format**
   ```json
   {
     "index": 1,
     "name": "Red",
     "colorCode": "FF5733",
     "error": "Invalid color code format. Must be a valid hex color (e.g., #FF5733)"
   }
   ```

4. **Invalid Reference**
   ```json
   {
     "index": 3,
     "brandName": "ABC Yarns",
     "email": "contact@abcyarns.com",
     "error": "Invalid yarnsubtype - does not exist in YarnType details"
   }
   ```

5. **Record Not Found (for updates)**
   ```json
   {
     "index": 4,
     "name": "N/A",
     "error": "Blend with ID 65f1a2b3c4d5e6f7g8h9i0j1 not found"
   }
   ```

### Partial Success Response

When some records succeed and some fail:

```json
{
  "message": "Bulk import completed",
  "summary": {
    "total": 10,
    "created": 7,
    "updated": 1,
    "failed": 2,
    "successRate": "80.00%",
    "processingTime": "234ms"
  },
  "details": {
    "successful": 8,
    "errors": [
      {
        "index": 3,
        "name": "Duplicate Blend",
        "error": "Blend name 'Duplicate Blend' already taken"
      },
      {
        "index": 7,
        "name": "Invalid Color",
        "colorCode": "INVALID",
        "error": "Invalid color code format. Must be a valid hex color (e.g., #FF5733)"
      }
    ]
  }
}
```

---

## Best Practices

### 1. Batch Size Selection

- **Small datasets (< 100 records)**: Use default batch size (50)
- **Medium datasets (100-500 records)**: Use batch size 50-75
- **Large datasets (500-1000 records)**: Use batch size 75-100

### 2. Error Handling

- Always check the `failed` count in the response
- Review error details to identify patterns
- Fix errors and retry only the failed records

### 3. Performance Optimization

- Process records in batches of 50-100 for optimal performance
- Avoid mixing create and update operations in the same request when possible
- Pre-validate data on the client side before sending

### 4. Data Preparation

- Ensure all required fields are present
- Validate formats (email, phone, pincode, etc.) before sending
- Check for duplicate names/emails/GST numbers
- Verify ObjectId references exist before including them

### 5. Update Operations

- Always verify the `id` exists before including it in update requests
- Include all fields you want to update (partial updates are supported)
- Be aware that updates will replace entire embedded objects (for suppliers/yarnTypes)

### 6. Embedded Objects

For **Suppliers** and **YarnTypes**:
- You can send ObjectIds (strings) - they will be automatically converted
- Missing references will be stored with status "deleted"
- For suppliers, ensure yarnsubtype exists in the referenced YarnType

### 7. Rate Limiting

- Bulk import endpoints have a 5-minute timeout
- Maximum 1000 records per request
- Consider splitting very large imports into multiple requests

### 8. Monitoring

- Check `processingTime` to monitor performance
- Review `successRate` to gauge data quality
- Use error details to improve data preparation processes

---

## API Endpoints Summary

| Resource | Endpoint | Max Records | Default Batch Size |
|----------|----------|-------------|-------------------|
| Blends | `POST /v1/blends/bulk-import` | 1000 | 50 |
| Colors | `POST /v1/colors/bulk-import` | 1000 | 50 |
| Count Sizes | `POST /v1/countSizes/bulk-import` | 1000 | 50 |
| Suppliers | `POST /v1/suppliers/bulk-import` | 1000 | 50 |
| Yarn Types | `POST /v1/yarnTypes/bulk-import` | 1000 | 50 |

---

## Support

For issues or questions regarding bulk import APIs, please contact the development team or refer to the main API documentation.

**Last Updated:** 2024

