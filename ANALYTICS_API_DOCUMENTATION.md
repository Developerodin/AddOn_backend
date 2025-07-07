# Analytics API Documentation

This document provides comprehensive information about the Analytics API endpoints for sales data visualization and analysis.

## Base URL
```
GET /v1/analytics
```

## Authentication
All endpoints require authentication. Include the JWT token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

## Query Parameters
Most endpoints support the following common query parameters:
- `dateFrom` (optional): Start date in ISO format (YYYY-MM-DD)
- `dateTo` (optional): End date in ISO format (YYYY-MM-DD)

---

## 📊 1. Time-Based Sales Trends

### Endpoint
```
GET /v1/analytics/time-based-trends
```

### Description
Track performance over time with daily and monthly aggregation options.

### Query Parameters
- `dateFrom` (optional): Start date in ISO format
- `dateTo` (optional): End date in ISO format  
- `groupBy` (optional): Grouping level - 'day' or 'month' (default: 'day')

### Example Request
```bash
GET /v1/analytics/time-based-trends?dateFrom=2024-01-01&dateTo=2024-01-31&groupBy=day
```

### Response Format
```json
[
  {
    "date": "2024-01-01T00:00:00.000Z",
    "totalQuantity": 1500,
    "totalNSV": 75000,
    "totalGSV": 85000,
    "totalDiscount": 10000,
    "totalTax": 5000,
    "recordCount": 25
  }
]
```

---

## 🧦 2. Product Performance Analysis

### Endpoint
```
GET /v1/analytics/product-performance
```

### Description
Identify top-selling products with performance metrics.

### Query Parameters
- `dateFrom` (optional): Start date in ISO format
- `dateTo` (optional): End date in ISO format
- `limit` (optional): Number of top products to return (1-100, default: 10)
- `sortBy` (optional): Sort criteria - 'quantity', 'nsv', 'gsv' (default: 'quantity')

### Example Request
```bash
GET /v1/analytics/product-performance?limit=10&sortBy=nsv&dateFrom=2024-01-01
```

### Response Format
```json
[
  {
    "_id": "product_id",
    "productName": "Premium Socks",
    "productCode": "SOCKS001",
    "categoryName": "Socks",
    "totalQuantity": 5000,
    "totalNSV": 250000,
    "totalGSV": 300000,
    "totalDiscount": 50000,
    "recordCount": 150
  }
]
```

---

## 🏪 3. Store/Plant-wise Performance

### Endpoint
```
GET /v1/analytics/store-performance
```

### Description
Compare sales performance across different store locations.

### Query Parameters
- `dateFrom` (optional): Start date in ISO format
- `dateTo` (optional): End date in ISO format
- `sortBy` (optional): Sort criteria - 'quantity', 'nsv', 'gsv', 'discount', 'tax' (default: 'nsv')

### Example Request
```bash
GET /v1/analytics/store-performance?sortBy=quantity&dateFrom=2024-01-01&dateTo=2024-01-31
```

### Response Format
```json
[
  {
    "_id": "store_id",
    "storeName": "Mumbai Central Store",
    "storeId": "MUM001",
    "city": "Mumbai",
    "state": "Maharashtra",
    "totalQuantity": 10000,
    "totalNSV": 500000,
    "totalGSV": 600000,
    "totalDiscount": 100000,
    "totalTax": 25000,
    "recordCount": 300
  }
]
```

---

## 🏪 4. Store Heatmap Data

### Endpoint
```
GET /v1/analytics/store-heatmap
```

### Description
Get data for store performance heatmap visualization.

### Query Parameters
- `dateFrom` (optional): Start date in ISO format
- `dateTo` (optional): End date in ISO format

### Example Request
```bash
GET /v1/analytics/store-heatmap?dateFrom=2024-01-01&dateTo=2024-01-31
```

### Response Format
```json
[
  {
    "storeId": "store_id",
    "storeName": "Mumbai Central Store",
    "date": "2024-01-01T00:00:00.000Z",
    "totalNSV": 50000,
    "totalQuantity": 1000
  }
]
```

---

## 🏷️ 5. Brand/Division Performance

### Endpoint
```
GET /v1/analytics/brand-performance
```

### Description
Track brand-wise sales performance.

### Query Parameters
- `dateFrom` (optional): Start date in ISO format
- `dateTo` (optional): End date in ISO format

### Example Request
```bash
GET /v1/analytics/brand-performance?dateFrom=2024-01-01&dateTo=2024-01-31
```

### Response Format
```json
[
  {
    "_id": "Louis Philippe",
    "brandName": "Louis Philippe",
    "totalQuantity": 15000,
    "totalNSV": 750000,
    "totalGSV": 900000,
    "totalDiscount": 150000,
    "recordCount": 450
  }
]
```

---

## 💰 6. Discount Impact Analysis

### Endpoint
```
GET /v1/analytics/discount-impact
```

### Description
Understand how discounts affect sales performance.

### Query Parameters
- `dateFrom` (optional): Start date in ISO format
- `dateTo` (optional): End date in ISO format

### Example Request
```bash
GET /v1/analytics/discount-impact?dateFrom=2024-01-01&dateTo=2024-01-31
```

### Response Format
```json
[
  {
    "date": "2024-01-01T00:00:00.000Z",
    "avgDiscountPercentage": 12.5,
    "totalDiscount": 50000,
    "totalNSV": 400000,
    "totalTax": 20000,
    "recordCount": 100
  }
]
```

---

## 📈 7. Tax & MRP Analytics

### Endpoint
```
GET /v1/analytics/tax-mrp-analytics
```

### Description
Get insights on taxation and pricing patterns.

### Query Parameters
- `dateFrom` (optional): Start date in ISO format
- `dateTo` (optional): End date in ISO format

### Example Request
```bash
GET /v1/analytics/tax-mrp-analytics?dateFrom=2024-01-01&dateTo=2024-01-31
```

### Response Format
```json
{
  "dailyTaxData": [
    {
      "date": "2024-01-01T00:00:00.000Z",
      "totalTax": 25000,
      "avgMRP": 150.50,
      "recordCount": 100
    }
  ],
  "mrpDistribution": [
    {
      "_id": 100,
      "count": 500,
      "avgNSV": 95.00
    }
  ]
}
```

---

## ✅ 8. Summary KPIs

### Endpoint
```
GET /v1/analytics/summary-kpis
```

### Description
Get top-level key performance indicators.

### Query Parameters
- `dateFrom` (optional): Start date in ISO format
- `dateTo` (optional): End date in ISO format

### Example Request
```bash
GET /v1/analytics/summary-kpis?dateFrom=2024-01-01&dateTo=2024-01-31
```

### Response Format
```json
{
  "totalQuantity": 50000,
  "totalNSV": 2500000,
  "totalGSV": 3000000,
  "totalDiscount": 500000,
  "totalTax": 250000,
  "recordCount": 1500,
  "avgDiscountPercentage": 16.67,
  "topSellingSKU": {
    "_id": "product_id",
    "productName": "Premium Socks",
    "totalQuantity": 5000,
    "totalNSV": 250000
  }
}
```

---

## 📊 9. Comprehensive Analytics Dashboard

### Endpoint
```
GET /v1/analytics/dashboard
```

### Description
Get all analytics data in a single request for dashboard rendering.

### Query Parameters
- `dateFrom` (optional): Start date in ISO format
- `dateTo` (optional): End date in ISO format

### Example Request
```bash
GET /v1/analytics/dashboard?dateFrom=2024-01-01&dateTo=2024-01-31
```

### Response Format
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

## Error Responses

### 400 Bad Request
```json
{
  "code": 400,
  "message": "Validation error",
  "details": "Invalid date format"
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

## Usage Examples

### Frontend Integration Examples

#### React Hook Example
```javascript
const useAnalytics = (endpoint, params = {}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
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

#### Chart.js Integration Example
```javascript
// Time-based trends chart
const { data: trendsData } = useAnalytics('time-based-trends', {
  dateFrom: '2024-01-01',
  dateTo: '2024-01-31',
  groupBy: 'day'
});

const chartData = {
  labels: trendsData?.map(item => new Date(item.date).toLocaleDateString()),
  datasets: [{
    label: 'Total NSV',
    data: trendsData?.map(item => item.totalNSV),
    borderColor: 'rgb(75, 192, 192)',
    tension: 0.1
  }]
};
```

---

## Performance Considerations

1. **Date Range Limits**: For large datasets, consider limiting date ranges to improve performance
2. **Caching**: Implement client-side caching for frequently accessed data
3. **Pagination**: Use the `limit` parameter for product performance to avoid loading too much data
4. **Batch Requests**: Use the dashboard endpoint for comprehensive data instead of multiple individual requests

---

## Rate Limiting

- Standard rate limiting applies to all analytics endpoints
- Consider implementing request caching for dashboard data
- Monitor API usage for performance optimization

---

## Support

For technical support or questions about the Analytics API, please refer to the main API documentation or contact the development team. 