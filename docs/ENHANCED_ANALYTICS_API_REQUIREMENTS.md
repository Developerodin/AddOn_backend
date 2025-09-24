# Enhanced Analytics API Requirements for Replenishment Dashboard

## Overview
This document outlines the additional analytics endpoints needed to support comprehensive chart visualizations in the replenishment dashboard. These endpoints will provide data for Forecast vs Actual Trends and Accuracy Distribution charts.

---

## Required New Endpoints

### 1. Enhanced Trends API
**Purpose:** Provide monthly aggregated data for Forecast vs Actual Trends chart

**Endpoint:** `GET /v1/analytics/trends`
**Query Parameters:**
- `startMonth` (YYYY-MM, optional) - Start month for trend analysis
- `endMonth` (YYYY-MM, optional) - End month for trend analysis
- `store` (ObjectId, optional) - Filter by specific store
- `product` (ObjectId, optional) - Filter by specific product

**Response:**
```json
{
  "trends": [
    {
      "month": "2024-01",
      "totalForecastQty": 1500,
      "totalActualQty": 1450,
      "avgForecastQty": 150.0,
      "avgActualQty": 145.0,
      "accuracy": 96.7,
      "forecastCount": 10,
      "deviation": -3.3
    },
    {
      "month": "2024-02",
      "totalForecastQty": 1600,
      "totalActualQty": 1550,
      "avgForecastQty": 160.0,
      "avgActualQty": 155.0,
      "accuracy": 96.9,
      "forecastCount": 10,
      "deviation": -3.1
    }
  ],
  "summary": {
    "totalMonths": 12,
    "avgAccuracy": 87.5,
    "trendDirection": "improving",
    "totalForecasts": 120,
    "totalDeviation": -2.5
  }
}
```

**Data Aggregation Logic:**
- Group forecasts by month
- Calculate total and average forecast/actual quantities
- Compute accuracy: `(1 - |actual - forecast| / forecast) * 100`
- Calculate deviation: `((actual - forecast) / forecast) * 100`

---

### 2. Accuracy Distribution API
**Purpose:** Provide accuracy distribution data for pie/donut charts

**Endpoint:** `GET /v1/analytics/accuracy-distribution`
**Query Parameters:**
- `store` (ObjectId, optional) - Filter by specific store
- `product` (ObjectId, optional) - Filter by specific product
- `month` (YYYY-MM, optional) - Filter by specific month

**Response:**
```json
{
  "overallAccuracy": 87.5,
  "distribution": [
    {
      "range": "90-100%",
      "label": "Excellent",
      "count": 45,
      "percentage": 30.0,
      "forecastIds": ["forecast_id_1", "forecast_id_2"],
      "color": "#10B981"
    },
    {
      "range": "80-89%",
      "label": "Good", 
      "count": 60,
      "percentage": 40.0,
      "forecastIds": ["forecast_id_3", "forecast_id_4"],
      "color": "#F59E0B"
    },
    {
      "range": "70-79%",
      "label": "Fair",
      "count": 30,
      "percentage": 20.0,
      "forecastIds": ["forecast_id_5"],
      "color": "#EF4444"
    },
    {
      "range": "<70%",
      "label": "Poor",
      "count": 15,
      "percentage": 10.0,
      "forecastIds": ["forecast_id_6"],
      "color": "#DC2626"
    }
  ],
  "totalForecasts": 150,
  "summary": {
    "excellentCount": 45,
    "goodCount": 60,
    "fairCount": 30,
    "poorCount": 15
  }
}
```

**Accuracy Range Logic:**
- 90-100%: Excellent (Green)
- 80-89%: Good (Yellow)
- 70-79%: Fair (Orange)
- <70%: Poor (Red)

---

### 3. Performance Analytics API
**Purpose:** Provide store and product performance metrics

**Endpoint:** `GET /v1/analytics/performance`
**Query Parameters:**
- `type` (string, required) - "store" or "product"
- `limit` (number, optional) - Number of results (default: 10)
- `month` (YYYY-MM, optional) - Filter by specific month

**Response for Store Performance:**
```json
{
  "type": "store",
  "performance": [
    {
      "storeId": "store_1",
      "storeName": "Store A",
      "storeCode": "STORE-A",
      "city": "Mumbai",
      "avgAccuracy": 92.5,
      "forecastCount": 25,
      "totalForecastQty": 2500,
      "totalActualQty": 2350,
      "avgDeviation": -6.0,
      "trend": "improving"
    },
    {
      "storeId": "store_2", 
      "storeName": "Store B",
      "storeCode": "STORE-B",
      "city": "Delhi",
      "avgAccuracy": 88.3,
      "forecastCount": 30,
      "totalForecastQty": 3000,
      "totalActualQty": 2850,
      "avgDeviation": -5.0,
      "trend": "stable"
    }
  ],
  "summary": {
    "totalStores": 50,
    "avgStoreAccuracy": 87.5,
    "bestPerformingStore": "store_1",
    "worstPerformingStore": "store_25"
  }
}
```

**Response for Product Performance:**
```json
{
  "type": "product",
  "performance": [
    {
      "productId": "product_1",
      "productName": "Product A",
      "styleCode": "STYLE-001",
      "category": "Socks",
      "avgAccuracy": 88.3,
      "forecastCount": 30,
      "totalForecastQty": 1500,
      "totalActualQty": 1425,
      "avgDeviation": -5.0,
      "trend": "improving"
    }
  ],
  "summary": {
    "totalProducts": 100,
    "avgProductAccuracy": 85.2,
    "bestPerformingProduct": "product_1",
    "worstPerformingProduct": "product_50"
  }
}
```

---

### 4. Replenishment Analytics API
**Purpose:** Provide replenishment-specific analytics

**Endpoint:** `GET /v1/analytics/replenishment`
**Query Parameters:**
- `store` (ObjectId, optional) - Filter by specific store
- `product` (ObjectId, optional) - Filter by specific product
- `month` (YYYY-MM, optional) - Filter by specific month

**Response:**
```json
{
  "summary": {
    "totalReplenishments": 150,
    "avgReplenishmentQty": 75.5,
    "totalReplenishmentValue": 112500,
    "avgSafetyBuffer": 15.2
  },
  "monthlyTrends": [
    {
      "month": "2024-01",
      "totalReplenishmentQty": 1500,
      "avgReplenishmentQty": 150.0,
      "replenishmentCount": 10,
      "avgSafetyBuffer": 15.0
    }
  ],
  "storeReplenishment": [
    {
      "storeId": "store_1",
      "storeName": "Store A",
      "totalReplenishmentQty": 500,
      "avgReplenishmentQty": 100.0,
      "replenishmentCount": 5
    }
  ],
  "productReplenishment": [
    {
      "productId": "product_1",
      "productName": "Product A",
      "totalReplenishmentQty": 300,
      "avgReplenishmentQty": 75.0,
      "replenishmentCount": 4
    }
  ]
}
```

---

## Implementation Notes

### Database Queries Required:
1. **Trends API:**
   ```javascript
   // Aggregate forecasts by month
   db.forecasts.aggregate([
     { $match: { /* filters */ } },
     { $group: { 
       _id: "$month",
       totalForecastQty: { $sum: "$forecastQty" },
       totalActualQty: { $sum: "$actualQty" },
       avgForecastQty: { $avg: "$forecastQty" },
       avgActualQty: { $avg: "$actualQty" },
       forecastCount: { $sum: 1 }
     }}
   ])
   ```

2. **Accuracy Distribution API:**
   ```javascript
   // Group forecasts by accuracy ranges
   db.forecasts.aggregate([
     { $match: { /* filters */ } },
     { $addFields: { 
       accuracy: { 
         $multiply: [
           { $subtract: [1, { $divide: [{ $abs: { $subtract: ["$actualQty", "$forecastQty"] }}, "$forecastQty"] }] },
           100 
         ]
       }
     }},
     { $bucket: {
       groupBy: "$accuracy",
       boundaries: [0, 70, 80, 90, 100],
       default: "other",
       output: { count: { $sum: 1 }, forecastIds: { $push: "$_id" } }
     }}
   ])
   ```

### Performance Considerations:
- Add database indexes on: `month`, `store`, `product`, `forecastQty`, `actualQty`
- Implement caching for analytics data (TTL: 1 hour)
- Use pagination for large datasets
- Consider materialized views for complex aggregations

### Error Handling:
- Return 400 for invalid date formats
- Return 404 for non-existent stores/products
- Return 500 for aggregation failures
- Include error messages in response

---

## Frontend Integration

### Chart Data Mapping:
1. **Forecast vs Actual Trends Chart:**
   - X-axis: `trends[].month`
   - Y-axis: `trends[].avgForecastQty` and `trends[].avgActualQty`
   - Tooltip: Show accuracy and deviation

2. **Accuracy Distribution Chart:**
   - Data: `distribution[].percentage`
   - Labels: `distribution[].label`
   - Colors: `distribution[].color`

3. **Performance Charts:**
   - Bar chart: `performance[].avgAccuracy`
   - Labels: `performance[].storeName` or `performance[].productName`

### API Integration:
```javascript
// Example usage in frontend
const trendsData = await fetch('/v1/analytics/trends?startMonth=2024-01&endMonth=2024-12');
const accuracyData = await fetch('/v1/analytics/accuracy-distribution');
const performanceData = await fetch('/v1/analytics/performance?type=store&limit=10');
```

---

## Testing Requirements

### Unit Tests:
- Test accuracy calculation logic
- Test aggregation queries
- Test filtering by store/product/month
- Test edge cases (zero values, null data)

### Integration Tests:
- Test API endpoints with real data
- Test performance with large datasets
- Test caching behavior
- Test error scenarios

---

## Timeline & Priority

### Phase 1 (High Priority):
1. Enhanced Trends API
2. Accuracy Distribution API

### Phase 2 (Medium Priority):
3. Performance Analytics API
4. Replenishment Analytics API

### Phase 3 (Low Priority):
5. Advanced filtering options
6. Export functionality
7. Real-time analytics

---

**Note:** These endpoints should be implemented with proper authentication and authorization. All responses should follow the existing API response format and error handling patterns. 