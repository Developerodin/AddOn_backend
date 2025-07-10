# Dashboard API Documentation

## Base URL
```
GET /v1/dashboard
```

## Authentication
All endpoints require authentication token in header:
```
Authorization: Bearer <token>
```

---

## 1. Get Dashboard Overview
**GET** `/v1/dashboard`

### Query Parameters
- `period` (optional): `week` | `month` | `quarter` (default: `week`)

### Response
```json
{
  "status": "success",
  "data": {
    "overview": {
      "totalSales": {
        "totalNSV": 1500000,
        "totalGSV": 1800000
      },
      "totalOrders": 1250,
      "salesChange": 12.5,
      "period": "week"
    },
    "topStores": [
      {
        "_id": "store_id",
        "storeName": "Store A",
        "totalNSV": 250000,
        "totalQuantity": 500
      }
    ],
    "monthlyTrends": [
      {
        "_id": {
          "year": 2024,
          "month": 1
        },
        "totalNSV": 500000,
        "totalQuantity": 1000,
        "totalOrders": 500
      }
    ],
    "categoryAnalytics": {
      "period": "month",
      "categories": [
        {
          "_id": "category_id",
          "categoryName": "Category A",
          "totalNSV": 300000,
          "totalQuantity": 600,
          "totalOrders": 300,
          "avgOrderValue": 1000
        }
      ]
    },
    "cityPerformance": [
      {
        "_id": "Mumbai",
        "totalNSV": 400000,
        "totalQuantity": 800,
        "totalOrders": 400,
        "storeCount": 5,
        "avgOrderValue": 1000
      }
    ]
  }
}
```

---

## 2. Get Sales Analytics
**GET** `/v1/dashboard/sales-analytics`

### Query Parameters
- `period` (optional): `week` | `month` | `quarter` (default: `week`)
- `startDate` (optional): ISO date string
- `endDate` (optional): ISO date string

### Response
```json
{
  "status": "success",
  "data": {
    "period": "week",
    "dateRange": {
      "start": "2024-01-01T00:00:00.000Z",
      "end": "2024-01-07T23:59:59.999Z"
    },
    "sales": [
      {
        "_id": {
          "date": "2024-01-01",
          "store": "Store A"
        },
        "totalNSV": 50000,
        "totalQuantity": 100,
        "totalOrders": 25
      }
    ]
  }
}
```

---

## 3. Get Store Performance
**GET** `/v1/dashboard/store-performance`

### Query Parameters
- `limit` (optional): Number 1-50 (default: 5)

### Response
```json
{
  "status": "success",
  "data": [
    {
      "_id": "store_id",
      "storeName": "Store A",
      "storeId": "STORE001",
      "city": "Mumbai",
      "totalNSV": 250000,
      "totalQuantity": 500,
      "totalOrders": 125,
      "avgOrderValue": 2000
    }
  ]
}
```

---

## 4. Get Category Analytics
**GET** `/v1/dashboard/category-analytics`

### Query Parameters
- `period` (optional): `week` | `month` | `quarter` (default: `month`)

### Response
```json
{
  "status": "success",
  "data": {
    "period": "month",
    "categories": [
      {
        "_id": "category_id",
        "categoryName": "Category A",
        "totalNSV": 300000,
        "totalQuantity": 600,
        "totalOrders": 300,
        "avgOrderValue": 1000
      }
    ]
  }
}
```

---

## 5. Get City Performance
**GET** `/v1/dashboard/city-performance`

### Response
```json
{
  "status": "success",
  "data": [
    {
      "_id": "Mumbai",
      "totalNSV": 400000,
      "totalQuantity": 800,
      "totalOrders": 400,
      "storeCount": 5,
      "avgOrderValue": 1000
    }
  ]
}
```

---

## 6. Get Demand Forecast
**GET** `/v1/dashboard/demand-forecast`

### Query Parameters
- `period` (optional): `week` | `month` | `quarter` (default: `month`)

### Response
```json
{
  "status": "success",
  "data": {
    "period": "month",
    "actualDemand": [
      {
        "_id": "product_id",
        "productName": "Product A",
        "actualQuantity": 1000,
        "actualNSV": 50000
      }
    ],
    "forecast": [
      {
        "productId": "product_id",
        "productName": "Product A",
        "forecastedQuantity": 1100,
        "forecastedNSV": 55000,
        "confidence": 0.85
      }
    ]
  }
}
```

---

## 7. Get Top Products
**GET** `/v1/dashboard/top-products`

### Query Parameters
- `limit` (optional): Number 1-50 (default: 5)
- `period` (optional): `week` | `month` | `quarter` (default: `month`)

### Response
```json
{
  "status": "success",
  "data": {
    "period": "month",
    "products": [
      {
        "_id": "product_id",
        "productName": "Product A",
        "productCode": "PROD001",
        "categoryName": "Category A",
        "totalNSV": 150000,
        "totalQuantity": 300,
        "totalOrders": 75,
        "avgOrderValue": 2000,
        "avgQuantity": 4
      }
    ]
  }
}
```

---

## Error Responses

### 401 Unauthorized
```json
{
  "code": 401,
  "message": "Please authenticate"
}
```

### 400 Bad Request
```json
{
  "code": 400,
  "message": "Validation error",
  "details": [
    {
      "field": "period",
      "message": "period must be one of [week, month, quarter]"
    }
  ]
}
```

### 500 Internal Server Error
```json
{
  "code": 500,
  "message": "Internal server error"
}
``` 