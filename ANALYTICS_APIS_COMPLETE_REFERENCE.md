# Analytics APIs Complete Reference

## Base URL
```
GET /v1/analytics
```

## Authentication
All endpoints require authentication. Include the JWT token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

## Common Query Parameters
- `dateFrom` (optional): Start date in ISO format (YYYY-MM-DD)
- `dateTo` (optional): End date in ISO format (YYYY-MM-DD)
- `limit` (optional): Number of records to return (default: 10, max: 100)
- `sortBy` (optional): Field to sort by (varies by endpoint)

---

## 1. Time-Based Sales Trends
**Endpoint:** `GET /v1/analytics/time-based-trends`

**Query Parameters:**
- `dateFrom` (optional): Start date
- `dateTo` (optional): End date
- `groupBy` (optional): Grouping interval - 'day' or 'month' (default: 'day')

**Response:**
```json
[
  {
    "date": "2024-01-01T00:00:00.000Z",
    "totalQuantity": 150,
    "totalNSV": 15000.50,
    "totalGSV": 18000.00,
    "totalDiscount": 3000.00,
    "totalTax": 1500.00,
    "recordCount": 25
  }
]
```

---

## 2. Product Performance Analysis
**Endpoint:** `GET /v1/analytics/product-performance`

**Query Parameters:**
- `dateFrom` (optional): Start date
- `dateTo` (optional): End date
- `limit` (optional): Number of products (default: 10, max: 100)
- `sortBy` (optional): Sort field - 'quantity', 'nsv', 'gsv' (default: 'quantity')

**Response:**
```json
[
  {
    "productId": "507f1f77bcf86cd799439011",
    "productName": "Premium Cotton T-Shirt",
    "productCode": "TSH001",
    "categoryName": "Apparel",
    "totalQuantity": 500,
    "totalNSV": 50000.00,
    "totalGSV": 60000.00,
    "totalDiscount": 10000.00,
    "recordCount": 50
  }
]
```

---

## 3. Store Performance Analysis
**Endpoint:** `GET /v1/analytics/store-performance`

**Query Parameters:**
- `dateFrom` (optional): Start date
- `dateTo` (optional): End date
- `sortBy` (optional): Sort field - 'quantity', 'nsv', 'gsv', 'discount', 'tax' (default: 'nsv')

**Response:**
```json
[
  {
    "storeId": "507f1f77bcf86cd799439011",
    "storeName": "Mumbai Central Store",
    "storeCode": "MUM001",
    "city": "Mumbai",
    "state": "Maharashtra",
    "totalQuantity": 1000,
    "totalNSV": 100000.00,
    "totalGSV": 120000.00,
    "totalDiscount": 20000.00,
    "totalTax": 10000.00,
    "recordCount": 100
  }
]
```

---

## 4. Store Heatmap Data
**Endpoint:** `GET /v1/analytics/store-heatmap`

**Query Parameters:**
- `dateFrom` (optional): Start date
- `dateTo` (optional): End date

**Response:**
```json
[
  {
    "storeId": "507f1f77bcf86cd799439011",
    "storeName": "Mumbai Central Store",
    "date": "2024-01-01T00:00:00.000Z",
    "totalNSV": 5000.00,
    "totalQuantity": 50
  }
]
```

---

## 5. Brand Performance Analysis
**Endpoint:** `GET /v1/analytics/brand-performance`

**Query Parameters:**
- `dateFrom` (optional): Start date
- `dateTo` (optional): End date

**Response:**
```json
[
  {
    "brandId": "Premium",
    "brandName": "Premium",
    "totalQuantity": 2000,
    "totalNSV": 200000.00,
    "totalGSV": 240000.00,
    "totalDiscount": 40000.00,
    "recordCount": 200
  }
]
```

---

## 6. Discount Impact Analysis
**Endpoint:** `GET /v1/analytics/discount-impact`

**Query Parameters:**
- `dateFrom` (optional): Start date
- `dateTo` (optional): End date

**Response:**
```json
[
  {
    "date": "2024-01-01T00:00:00.000Z",
    "avgDiscountPercentage": 15.5,
    "totalDiscount": 5000.00,
    "totalNSV": 45000.00,
    "totalTax": 4500.00,
    "recordCount": 30
  }
]
```

---

## 7. Tax and MRP Analytics
**Endpoint:** `GET /v1/analytics/tax-mrp-analytics`

**Query Parameters:**
- `dateFrom` (optional): Start date
- `dateTo` (optional): End date

**Response:**
```json
{
  "dailyTaxData": [
    {
      "date": "2024-01-01T00:00:00.000Z",
      "totalTax": 2500.00,
      "avgMRP": 120.50,
      "recordCount": 25
    }
  ],
  "mrpDistribution": [
    {
      "_id": "0-100",
      "count": 50,
      "avgNSV": 80.00
    }
  ]
}
```

---

## 8. Summary KPIs
**Endpoint:** `GET /v1/analytics/summary-kpis`

**Query Parameters:**
- `dateFrom` (optional): Start date
- `dateTo` (optional): End date

**Response:**
```json
{
  "totalQuantity": 5000,
  "totalNSV": 500000.00,
  "totalGSV": 600000.00,
  "totalDiscount": 100000.00,
  "totalTax": 50000.00,
  "recordCount": 500,
  "avgDiscountPercentage": 16.67,
  "topSellingSKU": {
    "productId": "507f1f77bcf86cd799439011",
    "productName": "Premium Cotton T-Shirt",
    "totalQuantity": 500,
    "totalNSV": 50000.00
  }
}
```

---

## 9. Analytics Dashboard
**Endpoint:** `GET /v1/analytics/dashboard`

**Query Parameters:**
- `dateFrom` (optional): Start date
- `dateTo` (optional): End date

**Response:**
```json
{
  "timeBasedTrends": [...],
  "productPerformance": [...],
  "storePerformance": [...],
  "brandPerformance": [...],
  "discountImpact": [...],
  "taxAndMRP": {...},
  "summaryKPIs": {...}
}
```

---

## 10. Individual Store Analysis
**Endpoint:** `GET /v1/analytics/store-analysis`

**Query Parameters:**
- `storeId` (required): Store ID
- `dateFrom` (optional): Start date
- `dateTo` (optional): End date

**Response:**
```json
{
  "storeInfo": {
    "storeId": "MUM001",
    "storeName": "Mumbai Central Store",
    "address": "123 Main St, Mumbai, Maharashtra",
    "contactPerson": "John Doe",
    "grossLTV": 500000,
    "currentMonthTrend": 15,
    "norms": 10000,
    "totalOrders": 500,
    "totalQuantity": 5000
  },
  "monthlySalesAnalysis": [
    {
      "month": "2024-01-01T00:00:00.000Z",
      "totalNSV": 50000.00,
      "totalQuantity": 500,
      "totalOrders": 50
    }
  ],
  "productSalesAnalysis": [
    {
      "productId": "507f1f77bcf86cd799439011",
      "productName": "Premium Cotton T-Shirt",
      "productCode": "TSH001",
      "totalNSV": 25000.00,
      "totalQuantity": 250,
      "totalOrders": 25
    }
  ],
  "salesEntries": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "date": "2024-01-01T00:00:00.000Z",
      "quantity": 10,
      "mrp": 120.00,
      "discount": 20.00,
      "gsv": 1200.00,
      "nsv": 1000.00,
      "totalTax": 100.00,
      "productName": "Premium Cotton T-Shirt",
      "productCode": "TSH001"
    }
  ]
}
```

---

## 11. Individual Product Analysis
**Endpoint:** `GET /v1/analytics/product-analysis`

**Query Parameters:**
- `productId` (required): Product ID
- `dateFrom` (optional): Start date
- `dateTo` (optional): End date

**Response:**
```json
{
  "productInfo": {
    "productId": "507f1f77bcf86cd799439011",
    "productName": "Premium Cotton T-Shirt",
    "productCode": "TSH001",
    "description": "High-quality cotton t-shirt",
    "totalQuantity": 1000,
    "totalUnits": 1000,
    "currentTrend": 12
  },
  "monthlySalesAnalysis": [
    {
      "month": "2024-01-01T00:00:00.000Z",
      "totalNSV": 50000.00,
      "totalQuantity": 500
    }
  ],
  "storeWiseSalesAnalysis": [
    {
      "storeId": "507f1f77bcf86cd799439011",
      "storeName": "Mumbai Central Store",
      "storeCode": "MUM001",
      "totalNSV": 25000.00,
      "totalQuantity": 250
    }
  ],
  "salesEntries": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "date": "2024-01-01T00:00:00.000Z",
      "quantity": 10,
      "mrp": 120.00,
      "discount": 20.00,
      "gsv": 1200.00,
      "nsv": 1000.00,
      "totalTax": 100.00,
      "storeName": "Mumbai Central Store",
      "storeId": "MUM001"
    }
  ]
}
```

---

## 12. Store Demand Forecasting
**Endpoint:** `GET /v1/analytics/store-forecasting`

**Query Parameters:**
- `storeId` (optional): Store ID (if not provided, forecasts for all stores)
- `months` (optional): Number of months to forecast (1-12, default: 6)

**Response:**
```json
{
  "forecastData": [
    {
      "forecastMonth": "2024-07-01",
      "productId": "507f1f77bcf86cd799439011",
      "productName": "Premium Cotton T-Shirt",
      "productCode": "TSH001",
      "forecastedQuantity": 500,
      "forecastedNSV": 50000.00,
      "confidence": 0.85
    }
  ],
  "forecastPeriod": 6,
  "generatedAt": "2024-01-01T00:00:00.000Z"
}
```

---

## 13. Product Demand Forecasting
**Endpoint:** `GET /v1/analytics/product-forecasting`

**Query Parameters:**
- `productId` (optional): Product ID (if not provided, forecasts for all products)
- `months` (optional): Number of months to forecast (1-12, default: 6)

**Response:**
```json
{
  "forecastData": [
    {
      "forecastMonth": "2024-07-01",
      "storeId": "507f1f77bcf86cd799439011",
      "storeName": "Mumbai Central Store",
      "storeCode": "MUM001",
      "forecastedQuantity": 250,
      "forecastedNSV": 25000.00,
      "confidence": 0.85
    }
  ],
  "forecastPeriod": 6,
  "generatedAt": "2024-01-01T00:00:00.000Z"
}
```

---

## 14. Store Replenishment Recommendations
**Endpoint:** `GET /v1/analytics/store-replenishment`

**Query Parameters:**
- `storeId` (optional): Store ID (if not provided, recommendations for all stores)

**Response:**
```json
{
  "recommendations": [
    {
      "productId": "507f1f77bcf86cd799439011",
      "productName": "Premium Cotton T-Shirt",
      "productCode": "TSH001",
      "currentDailySales": 16,
      "monthlyProjection": 480,
      "recommendedStock": 720,
      "reorderPoint": 240,
      "priority": "High",
      "recommendation": "Increase stock levels"
    }
  ],
  "storeNorms": 10000,
  "analysisPeriod": "30 days",
  "generatedAt": "2024-01-01T00:00:00.000Z"
}
```

---

## 15. Product Replenishment Recommendations
**Endpoint:** `GET /v1/analytics/product-replenishment`

**Query Parameters:**
- `productId` (optional): Product ID (if not provided, recommendations for all products)

**Response:**
```json
{
  "recommendations": [
    {
      "storeId": "507f1f77bcf86cd799439011",
      "storeName": "Mumbai Central Store",
      "storeCode": "MUM001",
      "currentDailySales": 8,
      "monthlyProjection": 240,
      "recommendedStock": 360,
      "reorderPoint": 120,
      "storeNorms": 10000,
      "priority": "Medium",
      "recommendation": "Maintain current levels"
    }
  ],
  "analysisPeriod": "30 days",
  "generatedAt": "2024-01-01T00:00:00.000Z"
}
```

---

## Error Responses

All endpoints return standard HTTP status codes:

- `200 OK`: Success
- `400 Bad Request`: Invalid parameters
- `401 Unauthorized`: Missing or invalid authentication
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Server error

**Error Response Format:**
```json
{
  "code": 400,
  "message": "Validation error",
  "details": [
    {
      "field": "dateFrom",
      "message": "Date must be in ISO format"
    }
  ]
}
```

---

## Notes

1. **Date Format**: All dates should be in ISO format (YYYY-MM-DD)
2. **Rounding**: All monetary values are rounded to 2 decimal places
3. **Pagination**: Some endpoints support pagination via `limit` parameter
4. **Authentication**: All endpoints require valid JWT token
5. **Rate Limiting**: Endpoints are rate-limited to prevent abuse
6. **Caching**: Responses may be cached for performance optimization

---

## Frontend Integration Examples

### React Hook Example
```javascript
const useAnalytics = (endpoint, params = {}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const queryString = new URLSearchParams(params).toString();
        const response = await fetch(`/v1/analytics/${endpoint}?${queryString}`, {
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

    fetchData();
  }, [endpoint, JSON.stringify(params)]);

  return { data, loading, error };
};
```

### Usage Example
```javascript
// Get store analysis
const { data: storeAnalysis, loading, error } = useAnalytics('store-analysis', {
  storeId: '507f1f77bcf86cd799439011',
  dateFrom: '2024-01-01',
  dateTo: '2024-01-31'
});

// Get demand forecasting
const { data: forecasting } = useAnalytics('store-forecasting', {
  storeId: '507f1f77bcf86cd799439011',
  months: 6
});
``` 