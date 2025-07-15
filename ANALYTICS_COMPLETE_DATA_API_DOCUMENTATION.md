# Analytics Complete Data APIs Documentation

This document provides comprehensive documentation for all the complete data analytics APIs that return full datasets without pagination or limits.

## Base URL
```
GET /v1/analytics/{endpoint}/complete
```

## Authentication
All endpoints require authentication. Include the authorization header:
```
Authorization: Bearer <your-jwt-token>
```

---

## 1. Complete Time-Based Sales Trends

### Endpoint
```
GET /v1/analytics/time-based-trends/complete
```

### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dateFrom` | string | No | Start date (YYYY-MM-DD) |
| `dateTo` | string | No | End date (YYYY-MM-DD) |
| `groupBy` | string | No | Grouping: 'day' (default) or 'month' |

### Response Fields
| Field | Type | Description |
|-------|------|-------------|
| `date` | string | Date in YYYY-MM-DD format |
| `totalQuantity` | number | Total quantity sold |
| `totalNSV` | number | Total Net Sales Value |
| `totalGSV` | number | Total Gross Sales Value |
| `totalDiscount` | number | Total discount amount |
| `totalTax` | number | Total tax amount |
| `recordCount` | number | Number of records for this date |
| `allRecords` | array | Complete transaction records for this date |

### Example Response
```json
[
  {
    "date": "2024-01-15",
    "totalQuantity": 1250,
    "totalNSV": 45000.50,
    "totalGSV": 50000.00,
    "totalDiscount": 5000.00,
    "totalTax": 2500.00,
    "recordCount": 45,
    "allRecords": [
      {
        "_id": "...",
        "date": "2024-01-15T10:30:00Z",
        "quantity": 10,
        "nsv": 450.00,
        "gsv": 500.00,
        "discount": 50.00,
        "totalTax": 25.00,
        "plant": "...",
        "materialCode": "..."
      }
    ]
  }
]
```

---

## 2. Complete Product Performance Analysis

### Endpoint
```
GET /v1/analytics/product-performance/complete
```

### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dateFrom` | string | No | Start date (YYYY-MM-DD) |
| `dateTo` | string | No | End date (YYYY-MM-DD) |
| `sortBy` | string | No | Sort field: 'quantity', 'nsv', 'gsv' (default: 'quantity') |

### Response Fields
| Field | Type | Description |
|-------|------|-------------|
| `_id` | string | Product ID |
| `productName` | string | Product name |
| `productCode` | string | Product software code |
| `categoryName` | string | Category name |
| `totalQuantity` | number | Total quantity sold |
| `totalNSV` | number | Total Net Sales Value |
| `totalGSV` | number | Total Gross Sales Value |
| `totalDiscount` | number | Total discount amount |
| `recordCount` | number | Number of transactions |
| `allRecords` | array | Complete transaction records |

### Example Response
```json
[
  {
    "_id": "507f1f77bcf86cd799439011",
    "productName": "Product A",
    "productCode": "PROD001",
    "categoryName": "Category 1",
    "totalQuantity": 5000,
    "totalNSV": 150000.00,
    "totalGSV": 175000.00,
    "totalDiscount": 25000.00,
    "recordCount": 200,
    "allRecords": [
      {
        "_id": "...",
        "date": "2024-01-15T10:30:00Z",
        "quantity": 10,
        "nsv": 450.00,
        "gsv": 500.00,
        "discount": 50.00,
        "materialCode": "507f1f77bcf86cd799439011"
      }
    ]
  }
]
```

---

## 3. Complete Store Performance Analysis

### Endpoint
```
GET /v1/analytics/store-performance/complete
```

### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dateFrom` | string | No | Start date (YYYY-MM-DD) |
| `dateTo` | string | No | End date (YYYY-MM-DD) |
| `sortBy` | string | No | Sort field: 'nsv', 'quantity', 'gsv' (default: 'nsv') |

### Response Fields
| Field | Type | Description |
|-------|------|-------------|
| `_id` | string | Store ID |
| `storeName` | string | Store name |
| `storeId` | string | Store identifier |
| `city` | string | Store city |
| `state` | string | Store state |
| `totalQuantity` | number | Total quantity sold |
| `totalNSV` | number | Total Net Sales Value |
| `totalGSV` | number | Total Gross Sales Value |
| `totalDiscount` | number | Total discount amount |
| `totalTax` | number | Total tax amount |
| `recordCount` | number | Number of transactions |
| `allRecords` | array | Complete transaction records |

### Example Response
```json
[
  {
    "_id": "507f1f77bcf86cd799439012",
    "storeName": "Store A",
    "storeId": "STORE001",
    "city": "Mumbai",
    "state": "Maharashtra",
    "totalQuantity": 8000,
    "totalNSV": 240000.00,
    "totalGSV": 280000.00,
    "totalDiscount": 40000.00,
    "totalTax": 20000.00,
    "recordCount": 350,
    "allRecords": [
      {
        "_id": "...",
        "date": "2024-01-15T10:30:00Z",
        "quantity": 10,
        "nsv": 450.00,
        "gsv": 500.00,
        "discount": 50.00,
        "totalTax": 25.00,
        "plant": "507f1f77bcf86cd799439012"
      }
    ]
  }
]
```

---

## 4. Complete Store Heatmap Data

### Endpoint
```
GET /v1/analytics/store-heatmap/complete
```

### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dateFrom` | string | No | Start date (YYYY-MM-DD) |
| `dateTo` | string | No | End date (YYYY-MM-DD) |

### Response Fields
| Field | Type | Description |
|-------|------|-------------|
| `_id` | string | Store ID |
| `storeName` | string | Store name |
| `storeId` | string | Store identifier |
| `city` | string | Store city |
| `state` | string | Store state |
| `latitude` | number | Store latitude |
| `longitude` | number | Store longitude |
| `totalQuantity` | number | Total quantity sold |
| `totalNSV` | number | Total Net Sales Value |
| `totalGSV` | number | Total Gross Sales Value |
| `totalDiscount` | number | Total discount amount |
| `totalTax` | number | Total tax amount |
| `recordCount` | number | Number of transactions |
| `allRecords` | array | Complete transaction records |

### Example Response
```json
[
  {
    "_id": "507f1f77bcf86cd799439012",
    "storeName": "Store A",
    "storeId": "STORE001",
    "city": "Mumbai",
    "state": "Maharashtra",
    "latitude": 19.0760,
    "longitude": 72.8777,
    "totalQuantity": 8000,
    "totalNSV": 240000.00,
    "totalGSV": 280000.00,
    "totalDiscount": 40000.00,
    "totalTax": 20000.00,
    "recordCount": 350,
    "allRecords": [...]
  }
]
```

---

## 5. Complete Brand Performance Analysis

### Endpoint
```
GET /v1/analytics/brand-performance/complete
```

### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dateFrom` | string | No | Start date (YYYY-MM-DD) |
| `dateTo` | string | No | End date (YYYY-MM-DD) |

### Response Fields
| Field | Type | Description |
|-------|------|-------------|
| `_id` | string | Brand name |
| `brandName` | string | Brand name |
| `totalQuantity` | number | Total quantity sold |
| `totalNSV` | number | Total Net Sales Value |
| `totalGSV` | number | Total Gross Sales Value |
| `totalDiscount` | number | Total discount amount |
| `totalTax` | number | Total tax amount |
| `recordCount` | number | Number of transactions |
| `allRecords` | array | Complete transaction records |

### Example Response
```json
[
  {
    "_id": "Brand A",
    "brandName": "Brand A",
    "totalQuantity": 15000,
    "totalNSV": 450000.00,
    "totalGSV": 525000.00,
    "totalDiscount": 75000.00,
    "totalTax": 37500.00,
    "recordCount": 600,
    "allRecords": [...]
  }
]
```

---

## 6. Complete Discount Impact Analysis

### Endpoint
```
GET /v1/analytics/discount-impact/complete
```

### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dateFrom` | string | No | Start date (YYYY-MM-DD) |
| `dateTo` | string | No | End date (YYYY-MM-DD) |

### Response Fields
| Field | Type | Description |
|-------|------|-------------|
| `_id.productId` | string | Product ID |
| `_id.storeId` | string | Store ID |
| `productName` | string | Product name |
| `productCode` | string | Product software code |
| `storeName` | string | Store name |
| `storeId` | string | Store identifier |
| `totalQuantity` | number | Total quantity sold |
| `totalNSV` | number | Total Net Sales Value |
| `totalGSV` | number | Total Gross Sales Value |
| `totalDiscount` | number | Total discount amount |
| `discountPercentage` | number | Average discount percentage |
| `recordCount` | number | Number of transactions |
| `allRecords` | array | Complete transaction records |

### Example Response
```json
[
  {
    "_id": {
      "productId": "507f1f77bcf86cd799439011",
      "storeId": "507f1f77bcf86cd799439012"
    },
    "productName": "Product A",
    "productCode": "PROD001",
    "storeName": "Store A",
    "storeId": "STORE001",
    "totalQuantity": 1000,
    "totalNSV": 45000.00,
    "totalGSV": 50000.00,
    "totalDiscount": 5000.00,
    "discountPercentage": 10.0,
    "recordCount": 50,
    "allRecords": [...]
  }
]
```

---

## 7. Complete Tax and MRP Analytics

### Endpoint
```
GET /v1/analytics/tax-mrp-analytics/complete
```

### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dateFrom` | string | No | Start date (YYYY-MM-DD) |
| `dateTo` | string | No | End date (YYYY-MM-DD) |

### Response Fields
| Field | Type | Description |
|-------|------|-------------|
| `_id.productId` | string | Product ID |
| `_id.storeId` | string | Store ID |
| `productName` | string | Product name |
| `productCode` | string | Product software code |
| `mrp` | number | Maximum Retail Price |
| `storeName` | string | Store name |
| `storeId` | string | Store identifier |
| `totalQuantity` | number | Total quantity sold |
| `totalNSV` | number | Total Net Sales Value |
| `totalGSV` | number | Total Gross Sales Value |
| `totalTax` | number | Total tax amount |
| `totalMRP` | number | Total MRP value |
| `taxPercentage` | number | Average tax percentage |
| `recordCount` | number | Number of transactions |
| `allRecords` | array | Complete transaction records |

### Example Response
```json
[
  {
    "_id": {
      "productId": "507f1f77bcf86cd799439011",
      "storeId": "507f1f77bcf86cd799439012"
    },
    "productName": "Product A",
    "productCode": "PROD001",
    "mrp": 100.00,
    "storeName": "Store A",
    "storeId": "STORE001",
    "totalQuantity": 1000,
    "totalNSV": 45000.00,
    "totalGSV": 50000.00,
    "totalTax": 2500.00,
    "totalMRP": 100000.00,
    "taxPercentage": 5.0,
    "recordCount": 50,
    "allRecords": [...]
  }
]
```

---

## 8. Complete Summary KPIs Data

### Endpoint
```
GET /v1/analytics/summary-kpis/complete
```

### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dateFrom` | string | No | Start date (YYYY-MM-DD) |
| `dateTo` | string | No | End date (YYYY-MM-DD) |

### Response Fields
| Field | Type | Description |
|-------|------|-------------|
| `totalQuantity` | number | Total quantity sold |
| `totalNSV` | number | Total Net Sales Value |
| `totalGSV` | number | Total Gross Sales Value |
| `totalDiscount` | number | Total discount amount |
| `totalTax` | number | Total tax amount |
| `recordCount` | number | Total number of transactions |
| `uniqueProductCount` | number | Number of unique products |
| `uniqueStoreCount` | number | Number of unique stores |
| `averageOrderValue` | number | Average order value (NSV/recordCount) |
| `discountPercentage` | number | Overall discount percentage |
| `taxPercentage` | number | Overall tax percentage |
| `allRecords` | array | Complete transaction records |

### Example Response
```json
[
  {
    "totalQuantity": 50000,
    "totalNSV": 1500000.00,
    "totalGSV": 1750000.00,
    "totalDiscount": 250000.00,
    "totalTax": 125000.00,
    "recordCount": 2000,
    "uniqueProductCount": 150,
    "uniqueStoreCount": 25,
    "averageOrderValue": 750.00,
    "discountPercentage": 14.29,
    "taxPercentage": 7.14,
    "allRecords": [...]
  }
]
```

---

## 9. Complete Analytics Dashboard Data

### Endpoint
```
GET /v1/analytics/dashboard/complete
```

### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dateFrom` | string | No | Start date (YYYY-MM-DD) |
| `dateTo` | string | No | End date (YYYY-MM-DD) |

### Response Fields
| Field | Type | Description |
|-------|------|-------------|
| `timeBasedTrends` | array | Complete time-based trends data |
| `productPerformance` | array | Complete product performance data |
| `storePerformance` | array | Complete store performance data |
| `brandPerformance` | array | Complete brand performance data |
| `summaryKPIs` | array | Complete summary KPIs data |
| `generatedAt` | string | Timestamp when data was generated |
| `allRecords` | object | All records organized by category |

### Example Response
```json
{
  "timeBasedTrends": [...],
  "productPerformance": [...],
  "storePerformance": [...],
  "brandPerformance": [...],
  "summaryKPIs": [...],
  "generatedAt": "2024-01-15T10:30:00.000Z",
  "allRecords": {
    "timeBasedTrends": [...],
    "productPerformance": [...],
    "storePerformance": [...],
    "brandPerformance": [...],
    "summaryKPIs": [...]
  }
}
```

---

## 10. Complete Individual Store Analysis

### Endpoint
```
GET /v1/analytics/store-analysis/complete
```

### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `storeId` | string | Yes | Store ID |
| `dateFrom` | string | No | Start date (YYYY-MM-DD) |
| `dateTo` | string | No | End date (YYYY-MM-DD) |

### Response Fields
| Field | Type | Description |
|-------|------|-------------|
| `_id.date` | string | Date in YYYY-MM-DD format |
| `_id.productId` | string | Product ID |
| `productName` | string | Product name |
| `productCode` | string | Product software code |
| `storeName` | string | Store name |
| `storeId` | string | Store identifier |
| `quantity` | number | Quantity sold |
| `nsv` | number | Net Sales Value |
| `gsv` | number | Gross Sales Value |
| `discount` | number | Discount amount |
| `tax` | number | Tax amount |
| `recordCount` | number | Number of transactions |
| `allRecords` | array | Complete transaction records |

### Example Response
```json
[
  {
    "_id": {
      "date": "2024-01-15",
      "productId": "507f1f77bcf86cd799439011"
    },
    "productName": "Product A",
    "productCode": "PROD001",
    "storeName": "Store A",
    "storeId": "STORE001",
    "quantity": 100,
    "nsv": 4500.00,
    "gsv": 5000.00,
    "discount": 500.00,
    "tax": 250.00,
    "recordCount": 5,
    "allRecords": [...]
  }
]
```

---

## 11. Complete Individual Product Analysis

### Endpoint
```
GET /v1/analytics/product-analysis/complete
```

### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `productId` | string | Yes | Product ID |
| `dateFrom` | string | No | Start date (YYYY-MM-DD) |
| `dateTo` | string | No | End date (YYYY-MM-DD) |

### Response Fields
| Field | Type | Description |
|-------|------|-------------|
| `_id.date` | string | Date in YYYY-MM-DD format |
| `_id.storeId` | string | Store ID |
| `productName` | string | Product name |
| `productCode` | string | Product software code |
| `storeName` | string | Store name |
| `storeId` | string | Store identifier |
| `quantity` | number | Quantity sold |
| `nsv` | number | Net Sales Value |
| `gsv` | number | Gross Sales Value |
| `discount` | number | Discount amount |
| `tax` | number | Tax amount |
| `recordCount` | number | Number of transactions |
| `allRecords` | array | Complete transaction records |

### Example Response
```json
[
  {
    "_id": {
      "date": "2024-01-15",
      "storeId": "507f1f77bcf86cd799439012"
    },
    "productName": "Product A",
    "productCode": "PROD001",
    "storeName": "Store A",
    "storeId": "STORE001",
    "quantity": 100,
    "nsv": 4500.00,
    "gsv": 5000.00,
    "discount": 500.00,
    "tax": 250.00,
    "recordCount": 5,
    "allRecords": [...]
  }
]
```

---

## 12. Complete Store Demand Forecasting

### Endpoint
```
GET /v1/analytics/store-forecasting/complete
```

### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `storeId` | string | No | Store ID (optional, forecasts all stores if not provided) |
| `months` | number | No | Number of months to forecast (default: 3) |

### Response Fields
| Field | Type | Description |
|-------|------|-------------|
| `forecastData` | array | Array of forecast data |
| `forecastPeriod` | number | Number of months forecasted |
| `generatedAt` | string | Timestamp when forecast was generated |
| `allRecords` | array | Historical data used for forecasting |

#### Forecast Data Fields
| Field | Type | Description |
|-------|------|-------------|
| `forecastMonth` | string | Forecast month (YYYY-MM-DD) |
| `storeId` | string | Store ID |
| `storeName` | string | Store name |
| `storeCode` | string | Store identifier |
| `forecastedQuantity` | number | Forecasted quantity |
| `forecastedNSV` | number | Forecasted Net Sales Value |
| `confidence` | number | Confidence level (0-1) |
| `historicalData` | array | Historical data used for this forecast |

### Example Response
```json
{
  "forecastData": [
    {
      "forecastMonth": "2024-04-01",
      "storeId": "507f1f77bcf86cd799439012",
      "storeName": "Store A",
      "storeCode": "STORE001",
      "forecastedQuantity": 8000,
      "forecastedNSV": 240000.00,
      "confidence": 0.85,
      "historicalData": [...]
    }
  ],
  "forecastPeriod": 3,
  "generatedAt": "2024-01-15T10:30:00.000Z",
  "allRecords": [...]
}
```

---

## 13. Complete Product Demand Forecasting

### Endpoint
```
GET /v1/analytics/product-forecasting/complete
```

### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `productId` | string | No | Product ID (optional, forecasts all products if not provided) |
| `months` | number | No | Number of months to forecast (default: 3) |

### Response Fields
| Field | Type | Description |
|-------|------|-------------|
| `forecastData` | array | Array of forecast data |
| `forecastPeriod` | number | Number of months forecasted |
| `generatedAt` | string | Timestamp when forecast was generated |
| `allRecords` | array | Historical data used for forecasting |

#### Forecast Data Fields
| Field | Type | Description |
|-------|------|-------------|
| `forecastMonth` | string | Forecast month (YYYY-MM-DD) |
| `productId` | string | Product ID |
| `productName` | string | Product name |
| `productCode` | string | Product software code |
| `forecastedQuantity` | number | Forecasted quantity |
| `forecastedNSV` | number | Forecasted Net Sales Value |
| `confidence` | number | Confidence level (0-1) |
| `historicalData` | array | Historical data used for this forecast |

### Example Response
```json
{
  "forecastData": [
    {
      "forecastMonth": "2024-04-01",
      "productId": "507f1f77bcf86cd799439011",
      "productName": "Product A",
      "productCode": "PROD001",
      "forecastedQuantity": 5000,
      "forecastedNSV": 150000.00,
      "confidence": 0.82,
      "historicalData": [...]
    }
  ],
  "forecastPeriod": 3,
  "generatedAt": "2024-01-15T10:30:00.000Z",
  "allRecords": [...]
}
```

---

## 14. Complete Store Replenishment Data

### Endpoint
```
GET /v1/analytics/store-replenishment/complete
```

### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `storeId` | string | No | Store ID (optional, analyzes all stores if not provided) |

### Response Fields
| Field | Type | Description |
|-------|------|-------------|
| `recommendations` | array | Array of replenishment recommendations |
| `storeNorms` | number | Store norms value |
| `analysisPeriod` | string | Analysis period (e.g., "30 days") |
| `generatedAt` | string | Timestamp when analysis was generated |
| `allRecords` | array | Sales data used for analysis |

#### Recommendation Fields
| Field | Type | Description |
|-------|------|-------------|
| `productId` | string | Product ID |
| `productName` | string | Product name |
| `productCode` | string | Product software code |
| `currentDailySales` | number | Current daily sales rate |
| `monthlyProjection` | number | Monthly sales projection |
| `recommendedStock` | number | Recommended stock level |
| `reorderPoint` | number | Reorder point |
| `priority` | string | Priority level (High/Medium/Low) |
| `recommendation` | string | Recommendation text |
| `allRecords` | array | Sales records for this product |

### Example Response
```json
{
  "recommendations": [
    {
      "productId": "507f1f77bcf86cd799439011",
      "productName": "Product A",
      "productCode": "PROD001",
      "currentDailySales": 33,
      "monthlyProjection": 990,
      "recommendedStock": 1485,
      "reorderPoint": 495,
      "priority": "High",
      "recommendation": "Increase stock levels",
      "allRecords": [...]
    }
  ],
  "storeNorms": 1000,
  "analysisPeriod": "30 days",
  "generatedAt": "2024-01-15T10:30:00.000Z",
  "allRecords": [...]
}
```

---

## 15. Complete Product Replenishment Data

### Endpoint
```
GET /v1/analytics/product-replenishment/complete
```

### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `productId` | string | No | Product ID (optional, analyzes all products if not provided) |

### Response Fields
| Field | Type | Description |
|-------|------|-------------|
| `recommendations` | array | Array of replenishment recommendations |
| `analysisPeriod` | string | Analysis period (e.g., "30 days") |
| `generatedAt` | string | Timestamp when analysis was generated |
| `allRecords` | array | Sales data used for analysis |

#### Recommendation Fields
| Field | Type | Description |
|-------|------|-------------|
| `storeId` | string | Store ID |
| `storeName` | string | Store name |
| `storeCode` | string | Store identifier |
| `currentDailySales` | number | Current daily sales rate |
| `monthlyProjection` | number | Monthly sales projection |
| `recommendedStock` | number | Recommended stock level |
| `reorderPoint` | number | Reorder point |
| `storeNorms` | number | Store norms value |
| `priority` | string | Priority level (High/Medium/Low) |
| `recommendation` | string | Recommendation text |
| `allRecords` | array | Sales records for this store |

### Example Response
```json
{
  "recommendations": [
    {
      "storeId": "507f1f77bcf86cd799439012",
      "storeName": "Store A",
      "storeCode": "STORE001",
      "currentDailySales": 33,
      "monthlyProjection": 990,
      "recommendedStock": 1485,
      "reorderPoint": 495,
      "storeNorms": 1000,
      "priority": "High",
      "recommendation": "Increase stock levels",
      "allRecords": [...]
    }
  ],
  "analysisPeriod": "30 days",
  "generatedAt": "2024-01-15T10:30:00.000Z",
  "allRecords": [...]
}
```

---

## Error Responses

All endpoints may return the following error responses:

### 400 Bad Request
```json
{
  "code": 400,
  "message": "Validation error",
  "details": [
    {
      "field": "dateFrom",
      "message": "Invalid date format"
    }
  ]
}
```

### 401 Unauthorized
```json
{
  "code": 401,
  "message": "Please authenticate"
}
```

### 500 Internal Server Error
```json
{
  "code": 500,
  "message": "Internal server error"
}
```

---

## Integration Notes

1. **Authentication**: All endpoints require a valid JWT token in the Authorization header
2. **Date Format**: Use ISO 8601 format (YYYY-MM-DD) for date parameters
3. **Pagination**: Complete data endpoints return all records without pagination
4. **Performance**: These endpoints may take longer to respond due to large datasets
5. **Caching**: Consider implementing client-side caching for better performance
6. **Export**: The `allRecords` field contains complete transaction data suitable for export

## Frontend Integration Examples

### React Hook Example
```javascript
const useAnalyticsCompleteData = (endpoint, params = {}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const queryString = new URLSearchParams(params).toString();
      const response = await fetch(`/v1/analytics/${endpoint}/complete?${queryString}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) throw new Error('Failed to fetch data');
      
      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return { data, loading, error, fetchData };
};
```

### Usage Example
```javascript
const { data, loading, error, fetchData } = useAnalyticsCompleteData('product-performance', {
  dateFrom: '2024-01-01',
  dateTo: '2024-12-31',
  sortBy: 'nsv'
});

useEffect(() => {
  fetchData();
}, []);
``` 