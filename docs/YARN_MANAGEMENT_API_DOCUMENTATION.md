# Yarn Management API Documentation

Complete API reference for managing yarn-related resources including colors, count sizes, yarn types, and suppliers.

**Base URL:** `/v1/yarn-management`

**Authentication:** All endpoints require JWT token in Authorization header:
```
Authorization: Bearer {your-jwt-token}
```

---

## 📋 Table of Contents

1. [Colors API](#colors-api)
   - [Create Color](#1-create-color)
   - [Get All Colors](#2-get-all-colors)
   - [Get Color by ID](#3-get-color-by-id)
   - [Update Color](#4-update-color)
   - [Delete Color](#5-delete-color)

2. [Count Sizes API](#count-sizes-api)
   - [Create Count Size](#1-create-count-size)
   - [Get All Count Sizes](#2-get-all-count-sizes)
   - [Get Count Size by ID](#3-get-count-size-by-id)
   - [Update Count Size](#4-update-count-size)
   - [Delete Count Size](#5-delete-count-size)

3. [Blends API](#blends-api)
   - [Create Blend](#1-create-blend)
   - [Get All Blends](#2-get-all-blends)
   - [Get Blend by ID](#3-get-blend-by-id)
   - [Update Blend](#4-update-blend)
   - [Delete Blend](#5-delete-blend)

4. [Yarn Types API](#yarn-types-api)
   - [Create Yarn Type](#1-create-yarn-type)
   - [Get All Yarn Types](#2-get-all-yarn-types)
   - [Get Yarn Type by ID](#3-get-yarn-type-by-id)
   - [Update Yarn Type](#4-update-yarn-type)
   - [Delete Yarn Type](#5-delete-yarn-type)

4. [Suppliers API](#suppliers-api)
   - [Create Supplier](#1-create-supplier)
   - [Get All Suppliers](#2-get-all-suppliers)
   - [Get Supplier by ID](#3-get-supplier-by-id)
   - [Update Supplier](#4-update-supplier)
   - [Delete Supplier](#5-delete-supplier)

---

## Colors API

**Base Path:** `/v1/yarn-management/colors`

### 1. Create Color

**Endpoint:** `POST /v1/yarn-management/colors`

**Description:** Create a new color entry with name and hex color code.

**Request Body:**
```json
{
  "name": "Red",
  "colorCode": "#FF5733",
  "status": "active"
}
```

**Field Descriptions:**
- `name` (required, string): Color name (must be unique)
- `colorCode` (required, string): Hex color code in format #RRGGBB (e.g., #FF5733)
- `status` (optional, string): Status - "active" or "inactive" (default: "active")

**cURL Example:**
```bash
curl -X POST \
  'http://localhost:3000/v1/yarn-management/colors' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "name": "Red",
    "colorCode": "#FF5733",
    "status": "active"
  }'
```

**Response (201 Created):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "name": "Red",
  "colorCode": "#FF5733",
  "status": "active",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

**Error Responses:**
- `400 Bad Request`: Color name or color code already taken
- `400 Bad Request`: Invalid color code format

---

### 2. Get All Colors

**Endpoint:** `GET /v1/yarn-management/colors`

**Description:** Retrieve all colors with pagination, filtering, and sorting support.

**Query Parameters:**
- `name` (optional, string): Filter by color name
- `status` (optional, string): Filter by status ("active" or "inactive")
- `sortBy` (optional, string): Sort field and order (e.g., "name:asc", "createdAt:desc")
- `limit` (optional, number): Number of results per page (default: 10)
- `page` (optional, number): Page number (default: 1)

**cURL Example:**
```bash
curl -X GET \
  'http://localhost:3000/v1/yarn-management/colors?status=active&sortBy=name:asc&limit=20&page=1' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Response (200 OK):**
```json
{
  "results": [
    {
      "id": "65f1a2b3c4d5e6f7g8h9i0j1",
      "name": "Red",
      "colorCode": "#FF5733",
      "status": "active",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    },
    {
      "id": "65f1a2b3c4d5e6f7g8h9i0j2",
      "name": "Blue",
      "colorCode": "#3366FF",
      "status": "active",
      "createdAt": "2024-01-15T10:31:00.000Z",
      "updatedAt": "2024-01-15T10:31:00.000Z"
    }
  ],
  "page": 1,
  "limit": 20,
  "totalPages": 1,
  "totalResults": 2
}
```

---

### 3. Get Color by ID

**Endpoint:** `GET /v1/yarn-management/colors/:colorId`

**Description:** Retrieve a specific color by its ID.

**Path Parameters:**
- `colorId` (required, string): MongoDB ObjectId of the color

**cURL Example:**
```bash
curl -X GET \
  'http://localhost:3000/v1/yarn-management/colors/65f1a2b3c4d5e6f7g8h9i0j1' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Response (200 OK):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "name": "Red",
  "colorCode": "#FF5733",
  "status": "active",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

**Error Responses:**
- `404 Not Found`: Color not found
- `400 Bad Request`: Invalid color ID format

---

### 4. Update Color

**Endpoint:** `PATCH /v1/yarn-management/colors/:colorId`

**Description:** Update a color's information. All fields are optional.

**Path Parameters:**
- `colorId` (required, string): MongoDB ObjectId of the color

**Request Body:**
```json
{
  "name": "Crimson Red",
  "colorCode": "#DC143C",
  "status": "inactive"
}
```

**Field Descriptions:**
- `name` (optional, string): Updated color name (must be unique if changed)
- `colorCode` (optional, string): Updated hex color code
- `status` (optional, string): Updated status - "active" or "inactive"

**cURL Example:**
```bash
curl -X PATCH \
  'http://localhost:3000/v1/yarn-management/colors/65f1a2b3c4d5e6f7g8h9i0j1' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "name": "Crimson Red",
    "colorCode": "#DC143C"
  }'
```

**Response (200 OK):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "name": "Crimson Red",
  "colorCode": "#DC143C",
  "status": "active",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T11:45:00.000Z"
}
```

**Error Responses:**
- `404 Not Found`: Color not found
- `400 Bad Request`: Color name or color code already taken
- `400 Bad Request`: Invalid color code format

---

### 5. Delete Color

**Endpoint:** `DELETE /v1/yarn-management/colors/:colorId`

**Description:** Delete a color from the system.

**Path Parameters:**
- `colorId` (required, string): MongoDB ObjectId of the color

**cURL Example:**
```bash
curl -X DELETE \
  'http://localhost:3000/v1/yarn-management/colors/65f1a2b3c4d5e6f7g8h9i0j1' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Response (204 No Content):**
No response body

**Error Responses:**
- `404 Not Found`: Color not found
- `400 Bad Request`: Invalid color ID format

---

## Count Sizes API

**Base Path:** `/v1/yarn-management/count-sizes`

### 1. Create Count Size

**Endpoint:** `POST /v1/yarn-management/count-sizes`

**Description:** Create a new count size entry.

**Request Body:**
```json
{
  "name": "40s",
  "status": "active"
}
```

**Field Descriptions:**
- `name` (required, string): Count size name (must be unique)
- `status` (optional, string): Status - "active" or "inactive" (default: "active")

**cURL Example:**
```bash
curl -X POST \
  'http://localhost:3000/v1/yarn-management/count-sizes' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "name": "40s",
    "status": "active"
  }'
```

**Response (201 Created):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "name": "40s",
  "status": "active",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

**Error Responses:**
- `400 Bad Request`: Count size name already taken

---

### 2. Get All Count Sizes

**Endpoint:** `GET /v1/yarn-management/count-sizes`

**Description:** Retrieve all count sizes with pagination, filtering, and sorting support.

**Query Parameters:**
- `name` (optional, string): Filter by count size name
- `status` (optional, string): Filter by status ("active" or "inactive")
- `sortBy` (optional, string): Sort field and order (e.g., "name:asc", "createdAt:desc")
- `limit` (optional, number): Number of results per page (default: 10)
- `page` (optional, number): Page number (default: 1)

**cURL Example:**
```bash
curl -X GET \
  'http://localhost:3000/v1/yarn-management/count-sizes?status=active&sortBy=name:asc&limit=20&page=1' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Response (200 OK):**
```json
{
  "results": [
    {
      "id": "65f1a2b3c4d5e6f7g8h9i0j1",
      "name": "40s",
      "status": "active",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    },
    {
      "id": "65f1a2b3c4d5e6f7g8h9i0j2",
      "name": "60s",
      "status": "active",
      "createdAt": "2024-01-15T10:31:00.000Z",
      "updatedAt": "2024-01-15T10:31:00.000Z"
    }
  ],
  "page": 1,
  "limit": 20,
  "totalPages": 1,
  "totalResults": 2
}
```

---

### 3. Get Count Size by ID

**Endpoint:** `GET /v1/yarn-management/count-sizes/:countSizeId`

**Description:** Retrieve a specific count size by its ID.

**Path Parameters:**
- `countSizeId` (required, string): MongoDB ObjectId of the count size

**cURL Example:**
```bash
curl -X GET \
  'http://localhost:3000/v1/yarn-management/count-sizes/65f1a2b3c4d5e6f7g8h9i0j1' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Response (200 OK):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "name": "40s",
  "status": "active",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

**Error Responses:**
- `404 Not Found`: Count size not found
- `400 Bad Request`: Invalid count size ID format

---

### 4. Update Count Size

**Endpoint:** `PATCH /v1/yarn-management/count-sizes/:countSizeId`

**Description:** Update a count size's information. All fields are optional.

**Path Parameters:**
- `countSizeId` (required, string): MongoDB ObjectId of the count size

**Request Body:**
```json
{
  "name": "40/2",
  "status": "inactive"
}
```

**Field Descriptions:**
- `name` (optional, string): Updated count size name (must be unique if changed)
- `status` (optional, string): Updated status - "active" or "inactive"

**cURL Example:**
```bash
curl -X PATCH \
  'http://localhost:3000/v1/yarn-management/count-sizes/65f1a2b3c4d5e6f7g8h9i0j1' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "name": "40/2",
    "status": "inactive"
  }'
```

**Response (200 OK):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "name": "40/2",
  "status": "inactive",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T11:45:00.000Z"
}
```

**Error Responses:**
- `404 Not Found`: Count size not found
- `400 Bad Request`: Count size name already taken

---

### 5. Delete Count Size

**Endpoint:** `DELETE /v1/yarn-management/count-sizes/:countSizeId`

**Description:** Delete a count size from the system.

**Path Parameters:**
- `countSizeId` (required, string): MongoDB ObjectId of the count size

**cURL Example:**
```bash
curl -X DELETE \
  'http://localhost:3000/v1/yarn-management/count-sizes/65f1a2b3c4d5e6f7g8h9i0j1' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Response (204 No Content):**
No response body

**Error Responses:**
- `404 Not Found`: Count size not found
- `400 Bad Request`: Invalid count size ID format

---

## Blends API

**Base Path:** `/v1/yarn-management/blends`

### 1. Create Blend

**Endpoint:** `POST /v1/yarn-management/blends`

**Description:** Create a new blend entry.

**Request Body:**
```json
{
  "name": "Cotton-Polyester",
  "status": "active"
}
```

**Field Descriptions:**
- `name` (required, string): Blend name (must be unique)
- `status` (optional, string): Status - "active" or "inactive" (default: "active")

**cURL Example:**
```bash
curl -X POST \
  'http://localhost:3000/v1/yarn-management/blends' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "name": "Cotton-Polyester",
    "status": "active"
  }'
```

**Response (201 Created):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "name": "Cotton-Polyester",
  "status": "active",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

**Error Responses:**
- `400 Bad Request`: Blend name already taken

---

### 2. Get All Blends

**Endpoint:** `GET /v1/yarn-management/blends`

**Description:** Retrieve all blends with pagination, filtering, and sorting support.

**Query Parameters:**
- `name` (optional, string): Filter by blend name
- `status` (optional, string): Filter by status ("active" or "inactive")
- `sortBy` (optional, string): Sort field and order (e.g., "name:asc", "createdAt:desc")
- `limit` (optional, number): Number of results per page (default: 10)
- `page` (optional, number): Page number (default: 1)

**cURL Example:**
```bash
curl -X GET \
  'http://localhost:3000/v1/yarn-management/blends?status=active&sortBy=name:asc&limit=20&page=1' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Response (200 OK):**
```json
{
  "results": [
    {
      "id": "65f1a2b3c4d5e6f7g8h9i0j1",
      "name": "Cotton-Polyester",
      "status": "active",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    },
    {
      "id": "65f1a2b3c4d5e6f7g8h9i0j2",
      "name": "Wool-Cashmere",
      "status": "active",
      "createdAt": "2024-01-15T10:31:00.000Z",
      "updatedAt": "2024-01-15T10:31:00.000Z"
    }
  ],
  "page": 1,
  "limit": 20,
  "totalPages": 1,
  "totalResults": 2
}
```

**Error Responses:**
- `400 Bad Request`: Invalid query parameters

---

### 3. Get Blend by ID

**Endpoint:** `GET /v1/yarn-management/blends/:blendId`

**Description:** Retrieve a specific blend by its ID.

**Path Parameters:**
- `blendId` (required, string): MongoDB ObjectId of the blend

**cURL Example:**
```bash
curl -X GET \
  'http://localhost:3000/v1/yarn-management/blends/65f1a2b3c4d5e6f7g8h9i0j1' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Response (200 OK):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "name": "Cotton-Polyester",
  "status": "active",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

**Error Responses:**
- `404 Not Found`: Blend not found
- `400 Bad Request`: Invalid blend ID format

---

### 4. Update Blend

**Endpoint:** `PATCH /v1/yarn-management/blends/:blendId`

**Description:** Update a blend's information. All fields are optional.

**Path Parameters:**
- `blendId` (required, string): MongoDB ObjectId of the blend

**Request Body:**
```json
{
  "name": "Cotton-Polyester 60/40",
  "status": "inactive"
}
```

**Field Descriptions:**
- `name` (optional, string): Updated blend name (must be unique if changed)
- `status` (optional, string): Updated status - "active" or "inactive"

**cURL Example:**
```bash
curl -X PATCH \
  'http://localhost:3000/v1/yarn-management/blends/65f1a2b3c4d5e6f7g8h9i0j1' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "name": "Cotton-Polyester 60/40",
    "status": "inactive"
  }'
```

**Response (200 OK):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "name": "Cotton-Polyester 60/40",
  "status": "inactive",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T11:45:00.000Z"
}
```

**Error Responses:**
- `404 Not Found`: Blend not found
- `400 Bad Request`: Blend name already taken

---

### 5. Delete Blend

**Endpoint:** `DELETE /v1/yarn-management/blends/:blendId`

**Description:** Delete a blend from the system.

**Path Parameters:**
- `blendId` (required, string): MongoDB ObjectId of the blend

**cURL Example:**
```bash
curl -X DELETE \
  'http://localhost:3000/v1/yarn-management/blends/65f1a2b3c4d5e6f7g8h9i0j1' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Response (204 No Content):**
No response body

**Error Responses:**
- `404 Not Found`: Blend not found
- `400 Bad Request`: Invalid blend ID format

---

## Yarn Types API

**Base Path:** `/v1/yarn-management/yarn-types`

### 1. Create Yarn Type

**Endpoint:** `POST /v1/yarn-management/yarn-types`

**Description:** Create a new yarn type with optional details including subtypes, count sizes, and weights.

**Request Body:**
```json
{
  "name": "Cotton",
  "details": [
    {
      "subtype": "Combed Cotton",
      "countSize": ["40s", "60s"],
      "weight": "Light"
    },
    {
      "subtype": "Carded Cotton",
      "countSize": ["30s", "40s"],
      "weight": "Medium"
    }
  ],
  "status": "active"
}
```

**Field Descriptions:**
- `name` (required, string): Yarn type name (must be unique)
- `details` (optional, array): Array of yarn type detail objects
  - `subtype` (required, string): Subtype name
  - `countSize` (optional, array of strings): Available count sizes
  - `weight` (optional, string): Weight classification
- `status` (optional, string): Status - "active" or "inactive" (default: "active")

**cURL Example:**
```bash
curl -X POST \
  'http://localhost:3000/v1/yarn-management/yarn-types' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "name": "Cotton",
    "details": [
      {
        "subtype": "Combed Cotton",
        "countSize": ["40s", "60s"],
        "weight": "Light"
      }
    ],
    "status": "active"
  }'
```

**Response (201 Created):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "name": "Cotton",
  "details": [
    {
      "subtype": "Combed Cotton",
      "countSize": ["40s", "60s"],
      "weight": "Light"
    }
  ],
  "status": "active",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

**Error Responses:**
- `400 Bad Request`: Yarn type name already taken

---

### 2. Get All Yarn Types

**Endpoint:** `GET /v1/yarn-management/yarn-types`

**Description:** Retrieve all yarn types with pagination, filtering, and sorting support.

**Query Parameters:**
- `name` (optional, string): Filter by yarn type name
- `status` (optional, string): Filter by status ("active" or "inactive")
- `sortBy` (optional, string): Sort field and order (e.g., "name:asc", "createdAt:desc")
- `limit` (optional, number): Number of results per page (default: 10)
- `page` (optional, number): Page number (default: 1)

**cURL Example:**
```bash
curl -X GET \
  'http://localhost:3000/v1/yarn-management/yarn-types?status=active&sortBy=name:asc&limit=20&page=1' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Response (200 OK):**
```json
{
  "results": [
    {
      "id": "65f1a2b3c4d5e6f7g8h9i0j1",
      "name": "Cotton",
      "details": [
        {
          "subtype": "Combed Cotton",
          "countSize": ["40s", "60s"],
          "weight": "Light"
        }
      ],
      "status": "active",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "page": 1,
  "limit": 20,
  "totalPages": 1,
  "totalResults": 1
}
```

---

### 3. Get Yarn Type by ID

**Endpoint:** `GET /v1/yarn-management/yarn-types/:yarnTypeId`

**Description:** Retrieve a specific yarn type by its ID.

**Path Parameters:**
- `yarnTypeId` (required, string): MongoDB ObjectId of the yarn type

**cURL Example:**
```bash
curl -X GET \
  'http://localhost:3000/v1/yarn-management/yarn-types/65f1a2b3c4d5e6f7g8h9i0j1' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Response (200 OK):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "name": "Cotton",
  "details": [
    {
      "subtype": "Combed Cotton",
      "countSize": ["40s", "60s"],
      "weight": "Light"
    }
  ],
  "status": "active",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

**Error Responses:**
- `404 Not Found`: Yarn type not found
- `400 Bad Request`: Invalid yarn type ID format

---

### 4. Update Yarn Type

**Endpoint:** `PATCH /v1/yarn-management/yarn-types/:yarnTypeId`

**Description:** Update a yarn type's information. All fields are optional.

**Path Parameters:**
- `yarnTypeId` (required, string): MongoDB ObjectId of the yarn type

**Request Body:**
```json
{
  "name": "Premium Cotton",
  "details": [
    {
      "subtype": "Combed Cotton",
      "countSize": ["40s", "60s", "80s"],
      "weight": "Light"
    }
  ],
  "status": "inactive"
}
```

**Field Descriptions:**
- `name` (optional, string): Updated yarn type name (must be unique if changed)
- `details` (optional, array): Updated array of yarn type detail objects
- `status` (optional, string): Updated status - "active" or "inactive"

**cURL Example:**
```bash
curl -X PATCH \
  'http://localhost:3000/v1/yarn-management/yarn-types/65f1a2b3c4d5e6f7g8h9i0j1' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "name": "Premium Cotton",
    "details": [
      {
        "subtype": "Combed Cotton",
        "countSize": ["40s", "60s", "80s"],
        "weight": "Light"
      }
    ]
  }'
```

**Response (200 OK):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "name": "Premium Cotton",
  "details": [
    {
      "subtype": "Combed Cotton",
      "countSize": ["40s", "60s", "80s"],
      "weight": "Light"
    }
  ],
  "status": "active",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T11:45:00.000Z"
}
```

**Error Responses:**
- `404 Not Found`: Yarn type not found
- `400 Bad Request`: Yarn type name already taken

---

### 5. Delete Yarn Type

**Endpoint:** `DELETE /v1/yarn-management/yarn-types/:yarnTypeId`

**Description:** Delete a yarn type from the system.

**Path Parameters:**
- `yarnTypeId` (required, string): MongoDB ObjectId of the yarn type

**cURL Example:**
```bash
curl -X DELETE \
  'http://localhost:3000/v1/yarn-management/yarn-types/65f1a2b3c4d5e6f7g8h9i0j1' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Response (204 No Content):**
No response body

**Error Responses:**
- `404 Not Found`: Yarn type not found
- `400 Bad Request`: Invalid yarn type ID format

---

## Suppliers API

**Base Path:** `/v1/yarn-management/suppliers`

### 1. Create Supplier

**Endpoint:** `POST /v1/yarn-management/suppliers`

**Description:** Create a new supplier with contact information and yarn details.

**Request Body:**
```json
{
  "brandName": "ABC Yarn Suppliers",
  "contactPersonName": "John Doe",
  "contactNumber": "+1234567890",
  "email": "contact@abcyarn.com",
  "address": "123 Yarn Street, Textile City, TC 12345",
  "gstNo": "27AABCU9603R1ZX",
  "yarnDetails": [
    {
      "yarnType": "Cotton",
      "color": "Red",
      "shadeNumber": "RD-001"
    },
    {
      "yarnType": "Polyester",
      "color": "Blue",
      "shadeNumber": "BL-002"
    }
  ],
  "status": "active"
}
```

**Field Descriptions:**
- `brandName` (required, string): Supplier brand/company name
- `contactPersonName` (required, string): Contact person's name
- `contactNumber` (required, string): Contact number (10-15 digits, may include +, spaces, dashes, parentheses)
- `email` (required, string): Email address (must be unique, will be converted to lowercase)
- `address` (required, string): Supplier address
- `gstNo` (optional, string): GST number (must be valid format if provided, must be unique)
- `yarnDetails` (optional, array): Array of yarn detail objects
  - `yarnType` (required, string): Type of yarn
  - `color` (required, string): Color name
  - `shadeNumber` (required, string): Shade number/code
- `status` (optional, string): Status - "active", "inactive", or "suspended" (default: "active")

**cURL Example:**
```bash
curl -X POST \
  'http://localhost:3000/v1/yarn-management/suppliers' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "brandName": "ABC Yarn Suppliers",
    "contactPersonName": "John Doe",
    "contactNumber": "+1234567890",
    "email": "contact@abcyarn.com",
    "address": "123 Yarn Street, Textile City, TC 12345",
    "gstNo": "27AABCU9603R1ZX",
    "yarnDetails": [
      {
        "yarnType": "Cotton",
        "color": "Red",
        "shadeNumber": "RD-001"
      }
    ],
    "status": "active"
  }'
```

**Response (201 Created):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "brandName": "ABC Yarn Suppliers",
  "contactPersonName": "John Doe",
  "contactNumber": "+1234567890",
  "email": "contact@abcyarn.com",
  "address": "123 Yarn Street, Textile City, TC 12345",
  "gstNo": "27AABCU9603R1ZX",
  "yarnDetails": [
    {
      "yarnType": "Cotton",
      "color": "Red",
      "shadeNumber": "RD-001"
    }
  ],
  "status": "active",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

**Error Responses:**
- `400 Bad Request`: Email already taken
- `400 Bad Request`: GST number already taken
- `400 Bad Request`: Invalid email format
- `400 Bad Request`: Invalid contact number format
- `400 Bad Request`: Invalid GST number format

---

### 2. Get All Suppliers

**Endpoint:** `GET /v1/yarn-management/suppliers`

**Description:** Retrieve all suppliers with pagination, filtering, and sorting support.

**Query Parameters:**
- `brandName` (optional, string): Filter by brand name
- `email` (optional, string): Filter by email
- `status` (optional, string): Filter by status ("active", "inactive", or "suspended")
- `sortBy` (optional, string): Sort field and order (e.g., "brandName:asc", "createdAt:desc")
- `limit` (optional, number): Number of results per page (default: 10)
- `page` (optional, number): Page number (default: 1)

**cURL Example:**
```bash
curl -X GET \
  'http://localhost:3000/v1/yarn-management/suppliers?status=active&sortBy=brandName:asc&limit=20&page=1' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Response (200 OK):**
```json
{
  "results": [
    {
      "id": "65f1a2b3c4d5e6f7g8h9i0j1",
      "brandName": "ABC Yarn Suppliers",
      "contactPersonName": "John Doe",
      "contactNumber": "+1234567890",
      "email": "contact@abcyarn.com",
      "address": "123 Yarn Street, Textile City, TC 12345",
      "gstNo": "27AABCU9603R1ZX",
      "yarnDetails": [
        {
          "yarnType": "Cotton",
          "color": "Red",
          "shadeNumber": "RD-001"
        }
      ],
      "status": "active",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "page": 1,
  "limit": 20,
  "totalPages": 1,
  "totalResults": 1
}
```

---

### 3. Get Supplier by ID

**Endpoint:** `GET /v1/yarn-management/suppliers/:supplierId`

**Description:** Retrieve a specific supplier by its ID.

**Path Parameters:**
- `supplierId` (required, string): MongoDB ObjectId of the supplier

**cURL Example:**
```bash
curl -X GET \
  'http://localhost:3000/v1/yarn-management/suppliers/65f1a2b3c4d5e6f7g8h9i0j1' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Response (200 OK):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "brandName": "ABC Yarn Suppliers",
  "contactPersonName": "John Doe",
  "contactNumber": "+1234567890",
  "email": "contact@abcyarn.com",
  "address": "123 Yarn Street, Textile City, TC 12345",
  "gstNo": "27AABCU9603R1ZX",
  "yarnDetails": [
    {
      "yarnType": "Cotton",
      "color": "Red",
      "shadeNumber": "RD-001"
    }
  ],
  "status": "active",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

**Error Responses:**
- `404 Not Found`: Supplier not found
- `400 Bad Request`: Invalid supplier ID format

---

### 4. Update Supplier

**Endpoint:** `PATCH /v1/yarn-management/suppliers/:supplierId`

**Description:** Update a supplier's information. All fields are optional.

**Path Parameters:**
- `supplierId` (required, string): MongoDB ObjectId of the supplier

**Request Body:**
```json
{
  "brandName": "ABC Yarn Suppliers Ltd",
  "contactPersonName": "Jane Smith",
  "contactNumber": "+1987654321",
  "email": "newemail@abcyarn.com",
  "address": "456 New Street, Textile City, TC 12345",
  "gstNo": "27AABCU9603R1ZX",
  "yarnDetails": [
    {
      "yarnType": "Cotton",
      "color": "Red",
      "shadeNumber": "RD-001"
    },
    {
      "yarnType": "Polyester",
      "color": "Blue",
      "shadeNumber": "BL-002"
    }
  ],
  "status": "suspended"
}
```

**Field Descriptions:**
- `brandName` (optional, string): Updated brand name
- `contactPersonName` (optional, string): Updated contact person name
- `contactNumber` (optional, string): Updated contact number
- `email` (optional, string): Updated email (must be unique if changed)
- `address` (optional, string): Updated address
- `gstNo` (optional, string): Updated GST number (must be unique if changed)
- `yarnDetails` (optional, array): Updated array of yarn detail objects
- `status` (optional, string): Updated status - "active", "inactive", or "suspended"

**cURL Example:**
```bash
curl -X PATCH \
  'http://localhost:3000/v1/yarn-management/suppliers/65f1a2b3c4d5e6f7g8h9i0j1' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -d '{
    "brandName": "ABC Yarn Suppliers Ltd",
    "contactPersonName": "Jane Smith",
    "status": "suspended"
  }'
```

**Response (200 OK):**
```json
{
  "id": "65f1a2b3c4d5e6f7g8h9i0j1",
  "brandName": "ABC Yarn Suppliers Ltd",
  "contactPersonName": "Jane Smith",
  "contactNumber": "+1234567890",
  "email": "contact@abcyarn.com",
  "address": "123 Yarn Street, Textile City, TC 12345",
  "gstNo": "27AABCU9603R1ZX",
  "yarnDetails": [
    {
      "yarnType": "Cotton",
      "color": "Red",
      "shadeNumber": "RD-001"
    }
  ],
  "status": "suspended",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T11:45:00.000Z"
}
```

**Error Responses:**
- `404 Not Found`: Supplier not found
- `400 Bad Request`: Email already taken
- `400 Bad Request`: GST number already taken
- `400 Bad Request`: Invalid email format
- `400 Bad Request`: Invalid contact number format
- `400 Bad Request`: Invalid GST number format

---

### 5. Delete Supplier

**Endpoint:** `DELETE /v1/yarn-management/suppliers/:supplierId`

**Description:** Delete a supplier from the system.

**Path Parameters:**
- `supplierId` (required, string): MongoDB ObjectId of the supplier

**cURL Example:**
```bash
curl -X DELETE \
  'http://localhost:3000/v1/yarn-management/suppliers/65f1a2b3c4d5e6f7g8h9i0j1' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Response (204 No Content):**
No response body

**Error Responses:**
- `404 Not Found`: Supplier not found
- `400 Bad Request`: Invalid supplier ID format

---

## Common Error Responses

All endpoints may return the following common errors:

- **401 Unauthorized**: Missing or invalid JWT token
- **403 Forbidden**: Insufficient permissions
- **500 Internal Server Error**: Server error

## Notes

1. **Pagination**: All "Get All" endpoints support pagination with `limit` and `page` query parameters. Default limit is 10 items per page.

2. **Sorting**: Use `sortBy` query parameter with format `field:order` (e.g., `name:asc`, `createdAt:desc`).

3. **Filtering**: Filter parameters are case-insensitive and support partial matching where applicable.

4. **Validation**: All request bodies are validated before processing. Invalid data will return `400 Bad Request` with error details.

5. **Uniqueness**: Names, emails, color codes, and GST numbers must be unique. Attempting to create or update with duplicate values will return `400 Bad Request`.

6. **Status Values**:
   - Colors, Count Sizes, Yarn Types: `"active"` or `"inactive"`
   - Suppliers: `"active"`, `"inactive"`, or `"suspended"`

