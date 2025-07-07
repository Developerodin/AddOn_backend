# Analytics APIs Complete Reference

## Base URL
```
http://localhost:3000/v1/analytics
```

## Authentication
All endpoints require JWT Bearer token:
```
Authorization: Bearer <your-jwt-token>
```

---

## 📊 1. Time-Based Sales Trends

### Endpoint
```
GET /v1/analytics/time-based-trends
```

### Query Parameters
- `dateFrom` (optional): Start date in ISO format (YYYY-MM-DD)
- `dateTo` (optional): End date in ISO format (YYYY-MM-DD)
- `groupBy` (optional): 'day' or 'month' (default: 'day')

### Example Request
```bash
GET /v1/analytics/time-based-trends?dateFrom=2024-01-01&dateTo=2024-01-31&groupBy=day
```

### Response Fields
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

### Field Descriptions
| Field | Type | Description |
|-------|------|-------------|
| `date` | Date | Aggregated date (daily or monthly) |
| `totalQuantity` | Number | Total quantity sold on this date |
| `totalNSV` | Number | Total Net Sales Value |
| `totalGSV` | Number | Total Gross Sales Value |
| `totalDiscount` | Number | Total discount amount |
| `totalTax` | Number | Total tax collected |
| `recordCount` | Number | Number of sales records for this date |

---

## 🧦 2. Product Performance Analysis

### Endpoint
```
GET /v1/analytics/product-performance
```

### Query Parameters
- `dateFrom` (optional): Start date in ISO format
- `dateTo` (optional): End date in ISO format
- `limit` (optional): Number of products (1-100, default: 10)
- `sortBy` (optional): 'quantity', 'nsv', 'gsv' (default: 'quantity')

### Example Request
```bash
GET /v1/analytics/product-performance?limit=10&sortBy=nsv&dateFrom=2024-01-01
```

### Response Fields
```json
[
  {
    "_id": "507f1f77bcf86cd799439011",
    "productName": "Premium Cotton Socks",
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

### Field Descriptions
| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | Product ID |
| `productName` | String | Name of the product |
| `productCode` | String | Product software code |
| `categoryName` | String | Product category name |
| `totalQuantity` | Number | Total quantity sold |
| `totalNSV` | Number | Total Net Sales Value |
| `totalGSV` | Number | Total Gross Sales Value |
| `totalDiscount` | Number | Total discount amount |
| `recordCount` | Number | Number of sales records |

---

## 🏪 3. Store Performance Analysis

### Endpoint
```
GET /v1/analytics/store-performance
```

### Query Parameters
- `dateFrom` (optional): Start date in ISO format
- `dateTo` (optional): End date in ISO format
- `sortBy` (optional): 'quantity', 'nsv', 'gsv', 'discount', 'tax' (default: 'nsv')

### Example Request
```bash
GET /v1/analytics/store-performance?sortBy=quantity&dateFrom=2024-01-01&dateTo=2024-01-31
```

### Response Fields
```json
[
  {
    "_id": "507f1f77bcf86cd799439012",
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

### Field Descriptions
| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | Store ID |
| `storeName` | String | Name of the store |
| `storeId` | String | Store identifier code |
| `city` | String | Store city location |
| `state` | String | Store state location |
| `totalQuantity` | Number | Total quantity sold |
| `totalNSV` | Number | Total Net Sales Value |
| `totalGSV` | Number | Total Gross Sales Value |
| `totalDiscount` | Number | Total discount amount |
| `totalTax` | Number | Total tax collected |
| `recordCount` | Number | Number of sales records |

---

## 🏪 4. Store Heatmap Data

### Endpoint
```
GET /v1/analytics/store-heatmap
```

### Query Parameters
- `dateFrom` (optional): Start date in ISO format
- `dateTo` (optional): End date in ISO format

### Example Request
```bash
GET /v1/analytics/store-heatmap?dateFrom=2024-01-01&dateTo=2024-01-31
```

### Response Fields
```json
[
  {
    "storeId": "507f1f77bcf86cd799439012",
    "storeName": "Mumbai Central Store",
    "date": "2024-01-01T00:00:00.000Z",
    "totalNSV": 50000,
    "totalQuantity": 1000
  }
]
```

### Field Descriptions
| Field | Type | Description |
|-------|------|-------------|
| `storeId` | ObjectId | Store ID |
| `storeName` | String | Name of the store |
| `date` | Date | Sales date |
| `totalNSV` | Number | Total Net Sales Value for this store on this date |
| `totalQuantity` | Number | Total quantity sold for this store on this date |

---

## 🏷️ 5. Brand Performance Analysis

### Endpoint
```
GET /v1/analytics/brand-performance
```

### Query Parameters
- `dateFrom` (optional): Start date in ISO format
- `dateTo` (optional): End date in ISO format

### Example Request
```bash
GET /v1/analytics/brand-performance?dateFrom=2024-01-01&dateTo=2024-01-31
```

### Response Fields
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

### Field Descriptions
| Field | Type | Description |
|-------|------|-------------|
| `_id` | String | Brand name (used as ID) |
| `brandName` | String | Name of the brand |
| `totalQuantity` | Number | Total quantity sold for this brand |
| `totalNSV` | Number | Total Net Sales Value |
| `totalGSV` | Number | Total Gross Sales Value |
| `totalDiscount` | Number | Total discount amount |
| `recordCount` | Number | Number of sales records |

---

## 💰 6. Discount Impact Analysis

### Endpoint
```
GET /v1/analytics/discount-impact
```

### Query Parameters
- `dateFrom` (optional): Start date in ISO format
- `dateTo` (optional): End date in ISO format

### Example Request
```bash
GET /v1/analytics/discount-impact?dateFrom=2024-01-01&dateTo=2024-01-31
```

### Response Fields
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

### Field Descriptions
| Field | Type | Description |
|-------|------|-------------|
| `date` | Date | Sales date |
| `avgDiscountPercentage` | Number | Average discount percentage (rounded to 2 decimal places) |
| `totalDiscount` | Number | Total discount amount |
| `totalNSV` | Number | Total Net Sales Value |
| `totalTax` | Number | Total tax collected |
| `recordCount` | Number | Number of sales records |

---

## 📈 7. Tax & MRP Analytics

### Endpoint
```
GET /v1/analytics/tax-mrp-analytics
```

### Query Parameters
- `dateFrom` (optional): Start date in ISO format
- `dateTo` (optional): End date in ISO format

### Example Request
```bash
GET /v1/analytics/tax-mrp-analytics?dateFrom=2024-01-01&dateTo=2024-01-31
```

### Response Fields
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
    },
    {
      "_id": 200,
      "count": 300,
      "avgNSV": 180.00
    },
    {
      "_id": "Above 5000",
      "count": 50,
      "avgNSV": 4500.00
    }
  ]
}
```

### Field Descriptions

#### dailyTaxData Array
| Field | Type | Description |
|-------|------|-------------|
| `date` | Date | Sales date |
| `totalTax` | Number | Total tax collected on this date |
| `avgMRP` | Number | Average MRP (rounded to 2 decimal places) |
| `recordCount` | Number | Number of sales records |

#### mrpDistribution Array
| Field | Type | Description |
|-------|------|-------------|
| `_id` | Number/String | MRP range boundary or "Above 5000" |
| `count` | Number | Number of products in this MRP range |
| `avgNSV` | Number | Average NSV for products in this range |

---

## ✅ 8. Summary KPIs

### Endpoint
```
GET /v1/analytics/summary-kpis
```

### Query Parameters
- `dateFrom` (optional): Start date in ISO format
- `dateTo` (optional): End date in ISO format

### Example Request
```bash
GET /v1/analytics/summary-kpis?dateFrom=2024-01-01&dateTo=2024-01-31
```

### Response Fields
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
    "_id": "507f1f77bcf86cd799439011",
    "productName": "Premium Cotton Socks",
    "totalQuantity": 5000,
    "totalNSV": 250000
  }
}
```

### Field Descriptions
| Field | Type | Description |
|-------|------|-------------|
| `totalQuantity` | Number | Total quantity sold in date range |
| `totalNSV` | Number | Total Net Sales Value |
| `totalGSV` | Number | Total Gross Sales Value |
| `totalDiscount` | Number | Total discount amount |
| `totalTax` | Number | Total tax collected |
| `recordCount` | Number | Total number of sales records |
| `avgDiscountPercentage` | Number | Average discount percentage (rounded to 2 decimal places) |
| `topSellingSKU` | Object | Top-selling product details |

#### topSellingSKU Object
| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | Product ID |
| `productName` | String | Name of the top-selling product |
| `totalQuantity` | Number | Total quantity sold |
| `totalNSV` | Number | Total Net Sales Value |

---

## 📊 9. Comprehensive Analytics Dashboard

### Endpoint
```
GET /v1/analytics/dashboard
```

### Query Parameters
- `dateFrom` (optional): Start date in ISO format
- `dateTo` (optional): End date in ISO format

### Example Request
```bash
GET /v1/analytics/dashboard?dateFrom=2024-01-01&dateTo=2024-01-31
```

### Response Fields
```json
{
  "timeBasedTrends": [
    {
      "date": "2024-01-01T00:00:00.000Z",
      "totalQuantity": 1500,
      "totalNSV": 75000,
      "totalGSV": 85000,
      "totalDiscount": 10000,
      "totalTax": 5000,
      "recordCount": 25
    }
  ],
  "productPerformance": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "productName": "Premium Cotton Socks",
      "productCode": "SOCKS001",
      "categoryName": "Socks",
      "totalQuantity": 5000,
      "totalNSV": 250000,
      "totalGSV": 300000,
      "totalDiscount": 50000,
      "recordCount": 150
    }
  ],
  "storePerformance": [
    {
      "_id": "507f1f77bcf86cd799439012",
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
  ],
  "brandPerformance": [
    {
      "_id": "Louis Philippe",
      "brandName": "Louis Philippe",
      "totalQuantity": 15000,
      "totalNSV": 750000,
      "totalGSV": 900000,
      "totalDiscount": 150000,
      "recordCount": 450
    }
  ],
  "discountImpact": [
    {
      "date": "2024-01-01T00:00:00.000Z",
      "avgDiscountPercentage": 12.5,
      "totalDiscount": 50000,
      "totalNSV": 400000,
      "totalTax": 20000,
      "recordCount": 100
    }
  ],
  "taxAndMRP": {
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
  },
  "summaryKPIs": {
    "totalQuantity": 50000,
    "totalNSV": 2500000,
    "totalGSV": 3000000,
    "totalDiscount": 500000,
    "totalTax": 250000,
    "recordCount": 1500,
    "avgDiscountPercentage": 16.67,
    "topSellingSKU": {
      "_id": "507f1f77bcf86cd799439011",
      "productName": "Premium Cotton Socks",
      "totalQuantity": 5000,
      "totalNSV": 250000
    }
  }
}
```

### Field Descriptions
| Field | Type | Description |
|-------|------|-------------|
| `timeBasedTrends` | Array | Time-based sales trends data |
| `productPerformance` | Array | Top 10 product performance data |
| `storePerformance` | Array | Store-wise performance data |
| `brandPerformance` | Array | Brand-wise performance data |
| `discountImpact` | Array | Discount impact analysis data |
| `taxAndMRP` | Object | Tax and MRP analytics data |
| `summaryKPIs` | Object | Summary key performance indicators |

---

## Error Response Format

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

## Data Types Reference

| Type | Description | Example |
|------|-------------|---------|
| `ObjectId` | MongoDB ObjectId (24-character hex string) | `"507f1f77bcf86cd799439011"` |
| `Date` | ISO 8601 date string | `"2024-01-01T00:00:00.000Z"` |
| `Number` | Numeric value (integer or float) | `1500`, `75000.50` |
| `String` | Text value | `"Premium Cotton Socks"` |
| `Array` | Array of objects | `[{...}, {...}]` |
| `Object` | Object with nested properties | `{"key": "value"}` |

---

## Common Query Parameters

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `dateFrom` | String | No | Start date (YYYY-MM-DD) | `"2024-01-01"` |
| `dateTo` | String | No | End date (YYYY-MM-DD) | `"2024-01-31"` |
| `limit` | Number | No | Number of records to return | `10` |
| `sortBy` | String | No | Sort criteria | `"nsv"`, `"quantity"` |
| `groupBy` | String | No | Grouping level | `"day"`, `"month"` |

---

## Performance Notes

- All endpoints use MongoDB aggregation pipelines for optimal performance
- Date filtering is applied at the database level
- Results are sorted and limited as specified in query parameters
- Large date ranges may impact performance - consider limiting to reasonable periods
- The dashboard endpoint combines multiple queries - use individual endpoints for specific data needs 