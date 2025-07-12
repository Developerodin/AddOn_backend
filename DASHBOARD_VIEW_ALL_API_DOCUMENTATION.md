# Dashboard View All APIs Documentation

This document describes the new "View All" APIs that return unlimited data for dashboard exploration. These APIs are designed to be used when users click "Explore" or "View All" buttons on the frontend to see complete datasets.

## Base URL
```
http://localhost:3002/v1/dashboard/
```

## Authentication
All endpoints require authentication. Include the JWT token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

## Complete API Routes Overview

### Limited Data APIs (Dashboard Summary)
| Endpoint | Method | Description | Filters |
|----------|--------|-------------|---------|
| `/` | GET | Dashboard overview data | `period` (week/month/quarter) |
| `/sales-analytics` | GET | Sales analytics | `period`, `startDate`, `endDate` |
| `/store-performance` | GET | Top stores performance | `limit` (1-50, default: 5) |
| `/category-analytics` | GET | Category analytics | `period` (week/month/quarter) |
| `/city-performance` | GET | City performance | None |
| `/demand-forecast` | GET | Demand forecasting | `period` (week/month/quarter) |
| `/top-products` | GET | Top products performance | `limit` (1-50, default: 5), `period` |

### Unlimited Data APIs (View All)
| Endpoint | Method | Description | Filters |
|----------|--------|-------------|---------|
| `/all-stores-performance` | GET | All stores performance data | `startDate`, `endDate` |
| `/all-products-performance` | GET | All products performance data | `period`, `startDate`, `endDate` |
| `/all-sales-data` | GET | All sales transactions | `startDate`, `endDate` |
| `/all-categories-analytics` | GET | All categories analytics | `period`, `startDate`, `endDate` |
| `/all-cities-performance` | GET | All cities performance data | `startDate`, `endDate` |

## API Endpoints

### 1. Get All Stores Performance
Returns performance data for all stores without any limit. Supports date range filtering.

**Endpoint:** `GET http://localhost:3002/v1/dashboard/all-stores-performance`

**Query Parameters:**
- `startDate` (optional): Start date for filtering (ISO format: YYYY-MM-DD)
- `endDate` (optional): End date for filtering (ISO format: YYYY-MM-DD)

**Example Requests:**
```
# All stores (no date filter)
GET http://localhost:3002/v1/dashboard/all-stores-performance

# Stores for specific date range
GET http://localhost:3002/v1/dashboard/all-stores-performance?startDate=2024-01-01&endDate=2024-12-31

# Stores for last quarter
GET http://localhost:3002/v1/dashboard/all-stores-performance?startDate=2024-10-01&endDate=2024-12-31
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "stores": [
      {
        "_id": "store_id",
        "storeName": "Store Name",
        "storeId": "STORE001",
        "city": "City Name",
        "totalNSV": 1500000,
        "totalQuantity": 5000,
        "totalOrders": 250,
        "avgOrderValue": 6000
      }
    ],
    "dateRange": {
      "startDate": "2024-01-01",
      "endDate": "2024-12-31"
    },
    "totalCount": 25
  }
}
```

**Use Case:** When user clicks "View All Stores" on the dashboard to see complete store performance data for a specific time period.

---

### 2. Get All Products Performance
Returns performance data for all products without any limit. Supports both period and custom date range filtering.

**Endpoint:** `GET http://localhost:3002/v1/dashboard/all-products-performance`

**Query Parameters:**
- `period` (optional): Time period for analysis (ignored if startDate/endDate provided)
  - Values: `week`, `month`, `quarter`
  - Default: `month`
- `startDate` (optional): Start date for filtering (ISO format: YYYY-MM-DD)
- `endDate` (optional): End date for filtering (ISO format: YYYY-MM-DD)

**Example Requests:**
```
# Products for current month (default)
GET http://localhost:3002/v1/dashboard/all-products-performance

# Products for specific period
GET http://localhost:3002/v1/dashboard/all-products-performance?period=quarter

# Products for custom date range
GET http://localhost:3002/v1/dashboard/all-products-performance?startDate=2024-01-01&endDate=2024-03-31

# Products for last year
GET http://localhost:3002/v1/dashboard/all-products-performance?startDate=2023-01-01&endDate=2023-12-31
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "period": "custom",
    "products": [
      {
        "_id": "product_id",
        "productName": "Product Name",
        "productCode": "PROD001",
        "categoryName": "Category Name",
        "categoryId": "category_id",
        "totalNSV": 800000,
        "totalQuantity": 2000,
        "totalOrders": 150,
        "avgOrderValue": 5333.33,
        "avgQuantity": 13.33
      }
    ],
    "dateRange": {
      "startDate": "2024-01-01",
      "endDate": "2024-03-31"
    },
    "totalCount": 150
  }
}
```

**Use Case:** When user clicks "View All Products" to see complete product performance data for any time period.

---

### 3. Get All Sales Data
Returns all sales transactions with detailed information. Supports date range filtering.

**Endpoint:** `GET http://localhost:3002/v1/dashboard/all-sales-data`

**Query Parameters:**
- `startDate` (optional): Start date for filtering (ISO format: YYYY-MM-DD)
- `endDate` (optional): End date for filtering (ISO format: YYYY-MM-DD)

**Example Requests:**
```
# All sales (no date filter)
GET http://localhost:3002/v1/dashboard/all-sales-data

# Sales for specific date range
GET http://localhost:3002/v1/dashboard/all-sales-data?startDate=2024-01-01&endDate=2024-12-31

# Sales for last week
GET http://localhost:3002/v1/dashboard/all-sales-data?startDate=2024-12-16&endDate=2024-12-22
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "sales": [
      {
        "_id": "sale_id",
        "date": "2024-01-15T10:30:00.000Z",
        "nsv": 5000,
        "gsv": 6000,
        "quantity": 10,
        "storeName": "Store Name",
        "storeId": "STORE001",
        "storeCity": "City Name",
        "productName": "Product Name",
        "productCode": "PROD001",
        "categoryName": "Category Name"
      }
    ],
    "totalCount": 1500,
    "dateRange": {
      "startDate": "2024-01-01",
      "endDate": "2024-12-31"
    }
  }
}
```

**Use Case:** When user clicks "View All Sales" to see complete sales transaction data for any time period.

---

### 4. Get All Categories Analytics
Returns analytics data for all categories without any limit. Supports both period and custom date range filtering.

**Endpoint:** `GET http://localhost:3002/v1/dashboard/all-categories-analytics`

**Query Parameters:**
- `period` (optional): Time period for analysis (ignored if startDate/endDate provided)
  - Values: `week`, `month`, `quarter`
  - Default: `month`
- `startDate` (optional): Start date for filtering (ISO format: YYYY-MM-DD)
- `endDate` (optional): End date for filtering (ISO format: YYYY-MM-DD)

**Example Requests:**
```
# Categories for current month (default)
GET http://localhost:3002/v1/dashboard/all-categories-analytics

# Categories for specific period
GET http://localhost:3002/v1/dashboard/all-categories-analytics?period=quarter

# Categories for custom date range
GET http://localhost:3002/v1/dashboard/all-categories-analytics?startDate=2024-06-01&endDate=2024-08-31
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "period": "custom",
    "categories": [
      {
        "_id": "category_id",
        "categoryName": "Category Name",
        "totalNSV": 1200000,
        "totalQuantity": 3000,
        "totalOrders": 200,
        "avgOrderValue": 6000,
        "productCount": 25
      }
    ],
    "dateRange": {
      "startDate": "2024-06-01",
      "endDate": "2024-08-31"
    },
    "totalCount": 15
  }
}
```

**Use Case:** When user clicks "View All Categories" to see complete category analytics data for any time period.

---

### 5. Get All Cities Performance
Returns performance data for all cities without any limit. Supports date range filtering.

**Endpoint:** `GET http://localhost:3002/v1/dashboard/all-cities-performance`

**Query Parameters:**
- `startDate` (optional): Start date for filtering (ISO format: YYYY-MM-DD)
- `endDate` (optional): End date for filtering (ISO format: YYYY-MM-DD)

**Example Requests:**
```
# All cities (no date filter)
GET http://localhost:3002/v1/dashboard/all-cities-performance

# Cities for specific date range
GET http://localhost:3002/v1/dashboard/all-cities-performance?startDate=2024-01-01&endDate=2024-12-31

# Cities for last month
GET http://localhost:3002/v1/dashboard/all-cities-performance?startDate=2024-11-01&endDate=2024-11-30
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "cities": [
      {
        "_id": "City Name",
        "totalNSV": 2500000,
        "totalQuantity": 8000,
        "totalOrders": 400,
        "storeCount": 5,
        "stores": ["Store 1", "Store 2", "Store 3"],
        "avgOrderValue": 6250
      }
    ],
    "dateRange": {
      "startDate": "2024-01-01",
      "endDate": "2024-12-31"
    },
    "totalCount": 12
  }
}
```

**Use Case:** When user clicks "View All Cities" to see complete city performance data for any time period.

---

## Limited Data APIs (For Reference)

### Dashboard Overview
**Endpoint:** `GET http://localhost:3002/v1/dashboard/`
**Filters:** `period` (week/month/quarter, default: week)

### Sales Analytics
**Endpoint:** `GET http://localhost:3002/v1/dashboard/sales-analytics`
**Filters:** `period`, `startDate`, `endDate`

### Store Performance (Limited)
**Endpoint:** `GET http://localhost:3002/v1/dashboard/store-performance`
**Filters:** `limit` (1-50, default: 5)

### Category Analytics (Limited)
**Endpoint:** `GET http://localhost:3002/v1/dashboard/category-analytics`
**Filters:** `period` (week/month/quarter, default: month)

### City Performance (Limited)
**Endpoint:** `GET http://localhost:3002/v1/dashboard/city-performance`
**Filters:** None

### Demand Forecast
**Endpoint:** `GET http://localhost:3002/v1/dashboard/demand-forecast`
**Filters:** `period` (week/month/quarter, default: month)

### Top Products (Limited)
**Endpoint:** `GET http://localhost:3002/v1/dashboard/top-products`
**Filters:** `limit` (1-50, default: 5), `period` (week/month/quarter, default: month)

---

## Frontend Integration Examples

### React Example
```javascript
// Function to fetch all stores data
const fetchAllStores = async (startDate, endDate) => {
  try {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);

    const response = await fetch(`http://localhost:3002/v1/dashboard/all-stores-performance?${params}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error fetching all stores:', error);
  }
};

// Function to fetch all products data
const fetchAllProducts = async (period = 'month', startDate, endDate) => {
  try {
    const params = new URLSearchParams();
    if (period) params.append('period', period);
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);

    const response = await fetch(`http://localhost:3002/v1/dashboard/all-products-performance?${params}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    return data.data.products;
  } catch (error) {
    console.error('Error fetching all products:', error);
  }
};

// Function to fetch all cities data
const fetchAllCities = async (startDate, endDate) => {
  try {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);

    const response = await fetch(`http://localhost:3002/v1/dashboard/all-cities-performance?${params}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error fetching all cities:', error);
  }
};
```

### Button Click Handlers
```javascript
// Store performance "View All" button
const handleViewAllStores = () => {
  fetchAllStores().then(stores => {
    // Navigate to stores page or open modal with all data
    setAllStoresData(stores.stores);
    setDateRange(stores.dateRange);
    setShowStoresModal(true);
  });
};

// Products performance "View All" button
const handleViewAllProducts = () => {
  fetchAllProducts().then(products => {
    // Navigate to products page or open modal with all data
    setAllProductsData(products);
    setShowProductsModal(true);
  });
};

// Cities performance "View All" button
const handleViewAllCities = () => {
  fetchAllCities().then(cities => {
    // Navigate to cities page or open modal with all data
    setAllCitiesData(cities.cities);
    setDateRange(cities.dateRange);
    setShowCitiesModal(true);
  });
};
```

### Axios Example
```javascript
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3002/v1/dashboard',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});

// Fetch all data functions
const getAllStores = (startDate, endDate) => api.get('/all-stores-performance', { params: { startDate, endDate } });
const getAllProducts = (period, startDate, endDate) => api.get('/all-products-performance', { params: { period, startDate, endDate } });
const getAllSales = (startDate, endDate) => api.get('/all-sales-data', { params: { startDate, endDate } });
const getAllCategories = (period, startDate, endDate) => api.get('/all-categories-analytics', { params: { period, startDate, endDate } });
const getAllCities = (startDate, endDate) => api.get('/all-cities-performance', { params: { startDate, endDate } });

// Limited data functions
const getDashboardData = (period) => api.get('/', { params: { period } });
const getSalesAnalytics = (period, startDate, endDate) => api.get('/sales-analytics', { params: { period, startDate, endDate } });
const getStorePerformance = (limit) => api.get('/store-performance', { params: { limit } });
const getCategoryAnalytics = (period) => api.get('/category-analytics', { params: { period } });
const getCityPerformance = () => api.get('/city-performance');
const getDemandForecast = (period) => api.get('/demand-forecast', { params: { period } });
const getTopProducts = (limit, period) => api.get('/top-products', { params: { limit, period } });
```

## Date Range Usage Examples

### Frontend Date Picker Integration
```javascript
// Example with date picker
const handleDateRangeChange = (startDate, endDate) => {
  const start = startDate.toISOString().split('T')[0]; // YYYY-MM-DD
  const end = endDate.toISOString().split('T')[0];     // YYYY-MM-DD
  
  fetchAllStores(start, end).then(data => {
    setStoresData(data.stores);
    setDateRange(data.dateRange);
  });
};

// Fetch function with date range
const fetchAllStores = async (startDate, endDate) => {
  const params = new URLSearchParams();
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  
  const response = await fetch(`http://localhost:3002/v1/dashboard/all-stores-performance?${params}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return response.json();
};
```

### Common Date Range Patterns
```javascript
// Last 7 days
const lastWeek = {
  startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  endDate: new Date().toISOString().split('T')[0]
};

// Last 30 days
const lastMonth = {
  startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  endDate: new Date().toISOString().split('T')[0]
};

// Current quarter
const currentQuarter = {
  startDate: '2024-10-01',
  endDate: '2024-12-31'
};

// Last year
const lastYear = {
  startDate: '2023-01-01',
  endDate: '2023-12-31'
};
```

### Quick Date Range Buttons
```javascript
// Predefined date range buttons
const quickDateRanges = {
  today: () => {
    const today = new Date().toISOString().split('T')[0];
    return { startDate: today, endDate: today };
  },
  yesterday: () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    return { startDate: yesterday, endDate: yesterday };
  },
  last7Days: () => {
    const end = new Date().toISOString().split('T')[0];
    const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    return { startDate: start, endDate: end };
  },
  last30Days: () => {
    const end = new Date().toISOString().split('T')[0];
    const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    return { startDate: start, endDate: end };
  },
  thisMonth: () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const end = new Date().toISOString().split('T')[0];
    return { startDate: start, endDate: end };
  },
  lastMonth: () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
    const end = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];
    return { startDate: start, endDate: end };
  }
};

// Usage example
const handleQuickDateRange = (rangeType) => {
  const { startDate, endDate } = quickDateRanges[rangeType]();
  fetchAllStores(startDate, endDate);
};
```

### Advanced Date Filtering
```javascript
// Date range with validation
const validateAndFetchData = (startDate, endDate) => {
  // Validate dates
  if (!startDate || !endDate) {
    alert('Please select both start and end dates');
    return;
  }
  
  if (new Date(startDate) > new Date(endDate)) {
    alert('Start date cannot be after end date');
    return;
  }
  
  // Check if date range is too large (e.g., more than 2 years)
  const daysDiff = (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24);
  if (daysDiff > 730) {
    if (!confirm('Large date range selected. This may take longer to load. Continue?')) {
      return;
    }
  }
  
  // Fetch data
  fetchAllStores(startDate, endDate);
};

// Date range with loading states
const fetchDataWithLoading = async (startDate, endDate) => {
  setLoading(true);
  try {
    const data = await fetchAllStores(startDate, endDate);
    setStoresData(data.stores);
    setDateRange(data.dateRange);
    setTotalCount(data.totalCount);
  } catch (error) {
    setError('Failed to fetch data');
    console.error('Error:', error);
  } finally {
    setLoading(false);
  }
};
```

## Error Handling

All endpoints return standard error responses:

**400 Bad Request:**
```json
{
  "status": "error",
  "message": "Validation error",
  "errors": [...]
}
```

**401 Unauthorized:**
```json
{
  "status": "error",
  "message": "Please authenticate"
}
```

**500 Internal Server Error:**
```json
{
  "status": "error",
  "message": "Internal server error"
}
```

## Performance Considerations

1. **Large Datasets:** These endpoints return unlimited data, so they may return large datasets. Consider implementing pagination on the frontend if needed.

2. **Caching:** Consider implementing caching strategies for frequently accessed data.

3. **Loading States:** Implement proper loading states on the frontend as these requests may take longer due to larger datasets.

4. **Error Boundaries:** Implement error boundaries to handle potential timeout or memory issues with large datasets.

5. **Progressive Loading:** For very large datasets, consider implementing virtual scrolling or infinite scroll.

## Usage Guidelines

1. **Use for Exploration:** These APIs are designed for data exploration, not for regular dashboard display.

2. **Filtering:** Use query parameters to filter data when possible to reduce response size.

3. **Progressive Loading:** Consider implementing progressive loading or virtual scrolling for large datasets.

4. **Export Functionality:** These APIs are perfect for implementing "Export to Excel/CSV" functionality.

5. **Search and Sort:** Implement client-side search and sorting for better user experience with large datasets.

## Migration from Limited APIs

If you're currently using the limited APIs and want to switch to unlimited data:

**Before (Limited):**
```javascript
// Returns only top 5 stores
const response = await fetch('http://localhost:3002/v1/dashboard/store-performance?limit=5');

// Returns only top 5 products
const response = await fetch('http://localhost:3002/v1/dashboard/top-products?limit=5');
```

**After (Unlimited):**
```javascript
// Returns all stores
const response = await fetch('http://localhost:3002/v1/dashboard/all-stores-performance');

// Returns all products
const response = await fetch('http://localhost:3002/v1/dashboard/all-products-performance');
```

## Testing the APIs

You can test these endpoints using curl or Postman:

```bash
# Test all stores performance (no date filter)
curl -X GET "http://localhost:3002/v1/dashboard/all-stores-performance" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Test all stores with date range
curl -X GET "http://localhost:3002/v1/dashboard/all-stores-performance?startDate=2024-01-01&endDate=2024-12-31" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Test all products with period filter
curl -X GET "http://localhost:3002/v1/dashboard/all-products-performance?period=month" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Test all products with custom date range
curl -X GET "http://localhost:3002/v1/dashboard/all-products-performance?startDate=2024-10-01&endDate=2024-12-31" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Test all sales with date range
curl -X GET "http://localhost:3002/v1/dashboard/all-sales-data?startDate=2024-12-01&endDate=2024-12-31" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Test all categories with period
curl -X GET "http://localhost:3002/v1/dashboard/all-categories-analytics?period=quarter" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Test all categories with custom date range
curl -X GET "http://localhost:3002/v1/dashboard/all-categories-analytics?startDate=2024-06-01&endDate=2024-08-31" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Test all cities performance (no date filter)
curl -X GET "http://localhost:3002/v1/dashboard/all-cities-performance" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Test all cities with date range
curl -X GET "http://localhost:3002/v1/dashboard/all-cities-performance?startDate=2024-11-01&endDate=2024-11-30" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Test limited APIs for comparison
curl -X GET "http://localhost:3002/v1/dashboard/store-performance?limit=5" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

curl -X GET "http://localhost:3002/v1/dashboard/top-products?limit=10&period=month" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Postman Collection Example
```json
{
  "info": {
    "name": "Dashboard View All APIs",
    "description": "APIs for viewing all dashboard data with date range filtering",
    "baseUrl": "http://localhost:3002/v1/dashboard"
  },
  "item": [
    {
      "name": "Get All Stores Performance",
      "request": {
        "method": "GET",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer YOUR_JWT_TOKEN"
          }
        ],
        "url": {
          "raw": "{{baseUrl}}/all-stores-performance?startDate=2024-01-01&endDate=2024-12-31",
          "host": ["{{baseUrl}}"],
          "path": ["all-stores-performance"],
          "query": [
            {
              "key": "startDate",
              "value": "2024-01-01"
            },
            {
              "key": "endDate",
              "value": "2024-12-31"
            }
          ]
        }
      }
    },
    {
      "name": "Get All Products Performance",
      "request": {
        "method": "GET",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer YOUR_JWT_TOKEN"
          }
        ],
        "url": {
          "raw": "{{baseUrl}}/all-products-performance?period=month&startDate=2024-10-01&endDate=2024-12-31",
          "host": ["{{baseUrl}}"],
          "path": ["all-products-performance"],
          "query": [
            {
              "key": "period",
              "value": "month"
            },
            {
              "key": "startDate",
              "value": "2024-10-01"
            },
            {
              "key": "endDate",
              "value": "2024-12-31"
            }
          ]
        }
      }
    }
  ]
}
```

This provides a seamless way to give users access to complete datasets while maintaining the performance-optimized limited views for the main dashboard. 