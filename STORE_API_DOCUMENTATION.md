# Store API Documentation

## Base URL
```
http://localhost:3000/v1/stores
```

## Authentication
All endpoints require proper authentication headers:
```javascript
const headers = {
  'Content-Type': 'application/json',
  'Authorization': 'Bearer your-token-here'
};
```

---

## 📋 API Endpoints

### 1. Create Store
**POST** `/v1/stores`

**Request Body:**
```json
{
  "storeId": "STORE001",
  "storeName": "Main Street Store",
  "city": "Mumbai",
  "addressLine1": "123 Main Street",
  "addressLine2": "Building A",
  "storeNumber": "A101",
  "pincode": "400001",
  "contactPerson": "John Doe",
  "contactEmail": "john.doe@store.com",
  "contactPhone": "+91-9876543210",
  "creditRating": "A+",
  "isActive": true
}
```

**Response (201 Created):**
```json
{
  "id": "507f1f77bcf86cd799439011",
  "storeId": "STORE001",
  "storeName": "Main Street Store",
  "city": "Mumbai",
  "addressLine1": "123 Main Street",
  "addressLine2": "Building A",
  "storeNumber": "A101",
  "pincode": "400001",
  "contactPerson": "John Doe",
  "contactEmail": "john.doe@store.com",
  "contactPhone": "+91-9876543210",
  "creditRating": "A+",
  "isActive": true,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

---

### 2. Get All Stores
**GET** `/v1/stores`

**Query Parameters:**
| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `limit` | number | Results per page (default: 10) | `?limit=20` |
| `page` | number | Page number (default: 1) | `?page=2` |
| `sortBy` | string | Sort field:direction | `?sortBy=createdAt:desc` |
| `storeId` | string | Filter by store ID | `?storeId=STORE001` |
| `storeName` | string | Filter by store name | `?storeName=Main` |
| `city` | string | Filter by city | `?city=Mumbai` |
| `contactPerson` | string | Filter by contact person | `?contactPerson=John` |
| `contactEmail` | string | Filter by email | `?contactEmail=john@store.com` |
| `creditRating` | string | Filter by rating | `?creditRating=A+` |
| `isActive` | boolean | Filter by status | `?isActive=true` |

**Example URLs:**
```
GET /v1/stores?limit=20&page=1&sortBy=createdAt:desc
GET /v1/stores?city=Mumbai&isActive=true
GET /v1/stores?creditRating=A+&sortBy=storeName:asc
```

**Response (200 OK):**
```json
{
  "results": [
    {
      "id": "507f1f77bcf86cd799439011",
      "storeId": "STORE001",
      "storeName": "Main Street Store",
      "city": "Mumbai",
      "addressLine1": "123 Main Street",
      "addressLine2": "Building A",
      "storeNumber": "A101",
      "pincode": "400001",
      "contactPerson": "John Doe",
      "contactEmail": "john.doe@store.com",
      "contactPhone": "+91-9876543210",
      "creditRating": "A+",
      "isActive": true,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "page": 1,
  "limit": 10,
  "totalPages": 5,
  "totalResults": 50,
  "hasNextPage": true,
  "hasPrevPage": false
}
```

---

### 3. Get Store by ID
**GET** `/v1/stores/{storeId}`

**Example:**
```
GET /v1/stores/507f1f77bcf86cd799439011
```

**Response (200 OK):**
```json
{
  "id": "507f1f77bcf86cd799439011",
  "storeId": "STORE001",
  "storeName": "Main Street Store",
  "city": "Mumbai",
  "addressLine1": "123 Main Street",
  "addressLine2": "Building A",
  "storeNumber": "A101",
  "pincode": "400001",
  "contactPerson": "John Doe",
  "contactEmail": "john.doe@store.com",
  "contactPhone": "+91-9876543210",
  "creditRating": "A+",
  "isActive": true,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

---

### 4. Update Store
**PATCH** `/v1/stores/{storeId}`

**Example:**
```
PATCH /v1/stores/507f1f77bcf86cd799439011
```

**Request Body:**
```json
{
  "storeName": "Updated Store Name",
  "creditRating": "A",
  "isActive": false
}
```

**Response (200 OK):**
```json
{
  "id": "507f1f77bcf86cd799439011",
  "storeId": "STORE001",
  "storeName": "Updated Store Name",
  "city": "Mumbai",
  "addressLine1": "123 Main Street",
  "addressLine2": "Building A",
  "storeNumber": "A101",
  "pincode": "400001",
  "contactPerson": "John Doe",
  "contactEmail": "john.doe@store.com",
  "contactPhone": "+91-9876543210",
  "creditRating": "A",
  "isActive": false,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T12:00:00.000Z"
}
```

---

### 5. Delete Store
**DELETE** `/v1/stores/{storeId}`

**Example:**
```
DELETE /v1/stores/507f1f77bcf86cd799439011
```

**Response (204 No Content):**
No response body

---

### 6. Bulk Import Stores
**POST** `/v1/stores/bulk-import`

**Request Body:**
```json
{
  "stores": [
    {
      "storeId": "STORE002",
      "storeName": "Downtown Store",
      "city": "Delhi",
      "addressLine1": "456 Downtown Ave",
      "storeNumber": "B202",
      "pincode": "110001",
      "contactPerson": "Jane Smith",
      "contactEmail": "jane.smith@store.com",
      "contactPhone": "+91-9876543211",
      "creditRating": "B+"
    },
    {
      "storeId": "STORE003",
      "storeName": "Uptown Store",
      "city": "Bangalore",
      "addressLine1": "789 Uptown Blvd",
      "storeNumber": "C303",
      "pincode": "560001",
      "contactPerson": "Bob Johnson",
      "contactEmail": "bob.johnson@store.com",
      "contactPhone": "+91-9876543212",
      "creditRating": "A-"
    }
  ],
  "batchSize": 50
}
```

**Response (200 OK):**
```json
{
  "message": "Bulk import completed",
  "results": {
    "total": 100,
    "created": 95,
    "updated": 3,
    "failed": 2,
    "errors": [
      {
        "index": 45,
        "storeId": "STORE045",
        "error": "Store ID already exists"
      }
    ],
    "processingTime": 1250
  }
}
```

---

### 7. Debug Query
**GET** `/v1/stores/debug`

**Example:**
```
GET /v1/stores/debug?test=value&filter=active
```

**Response (200 OK):**
```json
{
  "message": "Debug query parameters",
  "query": {
    "test": "value",
    "filter": "active"
  },
  "headers": {},
  "url": "/v1/stores/debug",
  "method": "GET"
}
```

---

## 📊 Data Models

### Store Object
```typescript
interface Store {
  id: string;                    // MongoDB ObjectId
  storeId: string;              // Unique store identifier
  storeName: string;            // Store name
  city: string;                 // City name
  addressLine1: string;         // Primary address
  addressLine2?: string;        // Secondary address (optional)
  storeNumber: string;          // Store number
  pincode: string;              // 6-digit pincode
  contactPerson: string;        // Contact person name
  contactEmail: string;         // Contact email
  contactPhone: string;         // Contact phone number
  creditRating: CreditRating;   // Credit rating
  isActive: boolean;            // Active status
  createdAt: string;            // ISO date string
  updatedAt: string;            // ISO date string
}
```

### Credit Rating Enum
```typescript
type CreditRating = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D' | 'F';
```

### Paginated Response
```typescript
interface PaginatedResponse<T> {
  results: T[];
  page: number;
  limit: number;
  totalPages: number;
  totalResults: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}
```

---

## 🚀 Frontend Integration Examples

### JavaScript/TypeScript

```javascript
class StoreAPI {
  constructor(baseURL = 'http://localhost:3000/v1/stores') {
    this.baseURL = baseURL;
    this.headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer your-token-here'
    };
  }

  // Get all stores with filters
  async getStores(filters = {}) {
    const params = new URLSearchParams(filters);
    const response = await fetch(`${this.baseURL}?${params}`, {
      headers: this.headers
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return response.json();
  }

  // Get store by ID
  async getStore(storeId) {
    const response = await fetch(`${this.baseURL}/${storeId}`, {
      headers: this.headers
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return response.json();
  }

  // Create store
  async createStore(storeData) {
    const response = await fetch(this.baseURL, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(storeData)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return response.json();
  }

  // Update store
  async updateStore(storeId, updateData) {
    const response = await fetch(`${this.baseURL}/${storeId}`, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify(updateData)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return response.json();
  }

  // Delete store
  async deleteStore(storeId) {
    const response = await fetch(`${this.baseURL}/${storeId}`, {
      method: 'DELETE',
      headers: this.headers
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return response.status === 204;
  }

  // Bulk import stores
  async bulkImportStores(stores, batchSize = 50) {
    const response = await fetch(`${this.baseURL}/bulk-import`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ stores, batchSize })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return response.json();
  }
}
```

### React Hook Example

```javascript
import { useState, useEffect } from 'react';

const useStores = () => {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({});

  const storeAPI = new StoreAPI();

  const fetchStores = async (filters = {}) => {
    setLoading(true);
    setError(null);
    
    try {
      const data = await storeAPI.getStores(filters);
      setStores(data.results);
      setPagination({
        page: data.page,
        limit: data.limit,
        totalPages: data.totalPages,
        totalResults: data.totalResults,
        hasNextPage: data.hasNextPage,
        hasPrevPage: data.hasPrevPage
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const createStore = async (storeData) => {
    try {
      const newStore = await storeAPI.createStore(storeData);
      setStores(prev => [newStore, ...prev]);
      return newStore;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const updateStore = async (storeId, updateData) => {
    try {
      const updatedStore = await storeAPI.updateStore(storeId, updateData);
      setStores(prev => prev.map(store => 
        store.id === storeId ? updatedStore : store
      ));
      return updatedStore;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const deleteStore = async (storeId) => {
    try {
      await storeAPI.deleteStore(storeId);
      setStores(prev => prev.filter(store => store.id !== storeId));
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  return {
    stores,
    loading,
    error,
    pagination,
    fetchStores,
    createStore,
    updateStore,
    deleteStore
  };
};
```

### Axios Example

```javascript
import axios from 'axios';

const storeAPI = axios.create({
  baseURL: 'http://localhost:3000/v1/stores',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-token-here'
  }
});

// Get all stores
const getStores = (params) => storeAPI.get('/', { params });

// Get store by ID
const getStore = (storeId) => storeAPI.get(`/${storeId}`);

// Create store
const createStore = (data) => storeAPI.post('/', data);

// Update store
const updateStore = (storeId, data) => storeAPI.patch(`/${storeId}`, data);

// Delete store
const deleteStore = (storeId) => storeAPI.delete(`/${storeId}`);

// Bulk import
const bulkImport = (data) => storeAPI.post('/bulk-import', data);
```

---

## ⚠️ Error Handling

### Common Error Responses

**400 Bad Request:**
```json
{
  "code": 400,
  "message": "Store ID already taken"
}
```

**404 Not Found:**
```json
{
  "code": 404,
  "message": "Store not found"
}
```

**422 Validation Error:**
```json
{
  "code": 422,
  "message": "Validation Error",
  "details": [
    {
      "field": "pincode",
      "message": "Pincode must be exactly 6 digits"
    }
  ]
}
```

---

## 🔧 Validation Rules

- **storeId**: Required, unique, uppercase
- **storeName**: Required, trimmed
- **city**: Required, trimmed
- **addressLine1**: Required, trimmed
- **addressLine2**: Optional, trimmed
- **storeNumber**: Required, trimmed
- **pincode**: Required, exactly 6 digits
- **contactPerson**: Required, trimmed
- **contactEmail**: Required, valid email format, lowercase
- **contactPhone**: Required, valid phone format (10-15 digits with optional +, spaces, dashes, parentheses)
- **creditRating**: Required, enum values: A+, A, A-, B+, B, B-, C+, C, C-, D, F
- **isActive**: Optional, boolean, default: true

---

## 📝 Notes

- All timestamps are in ISO 8601 format
- Store IDs are automatically converted to uppercase
- Email addresses are automatically converted to lowercase
- Phone numbers support international format with + prefix
- Bulk import supports up to 1000 stores per request
- Pagination is 1-based (page 1, 2, 3...)
- Sort format: `field:direction` (e.g., `createdAt:desc`, `storeName:asc`) 