# Enhanced Analytics API Implementation

## Overview
This document provides comprehensive documentation for the enhanced analytics APIs implemented for the replenishment dashboard. These APIs provide data for chart visualizations including Forecast vs Actual Trends, Accuracy Distribution, Performance Analytics, and Replenishment Analytics.

---

## API Endpoints

### 1. Enhanced Trends API
**Endpoint:** `GET /v1/analytics/trends`

**Purpose:** Provides monthly aggregated data for Forecast vs Actual Trends chart

**Query Parameters:**
- `startMonth` (YYYY-MM, optional) - Start month for trend analysis
- `endMonth` (YYYY-MM, optional) - End month for trend analysis  
- `store` (ObjectId, optional) - Filter by specific store
- `product` (ObjectId, optional) - Filter by specific product

**Response Example:**
```json
{
  "trends": [
    {
      "month": "2025-01",
      "totalForecastQty": 3.9,
      "totalActualQty": 11,
      "avgForecastQty": 1.95,
      "avgActualQty": 5.5,
      "accuracy": -82.05,
      "forecastCount": 2,
      "deviation": 182.05
    }
  ],
  "summary": {
    "totalMonths": 4,
    "avgAccuracy": -8.01,
    "trendDirection": "improving",
    "totalForecasts": 6,
    "totalDeviation": 83.01
  }
}
```

**Data Aggregation Logic:**
- Groups forecasts by month
- Calculates total and average forecast/actual quantities
- Computes accuracy: `(1 - |actual - forecast| / forecast) * 100`
- Calculates deviation: `((actual - forecast) / forecast) * 100`
- Determines trend direction based on recent vs older accuracy

---

### 2. Accuracy Distribution API
**Endpoint:** `GET /v1/analytics/accuracy-distribution`

**Purpose:** Provides accuracy distribution data for pie/donut charts

**Query Parameters:**
- `store` (ObjectId, optional) - Filter by specific store
- `product` (ObjectId, optional) - Filter by specific product
- `month` (YYYY-MM, optional) - Filter by specific month

**Response Example:**
```json
{
  "overallAccuracy": 14.53,
  "distribution": [
    {
      "range": "90-100%",
      "label": "Excellent",
      "count": 1,
      "percentage": 33.33,
      "forecastIds": ["forecast_id_1"],
      "color": "#10B981"
    },
    {
      "range": "80-89%",
      "label": "Good",
      "count": 0,
      "percentage": 0,
      "forecastIds": [],
      "color": "#F59E0B"
    },
    {
      "range": "70-79%",
      "label": "Fair",
      "count": 0,
      "percentage": 0,
      "forecastIds": [],
      "color": "#EF4444"
    },
    {
      "range": "<70%",
      "label": "Poor",
      "count": 2,
      "percentage": 66.67,
      "forecastIds": ["forecast_id_2", "forecast_id_3"],
      "color": "#DC2626"
    }
  ],
  "totalForecasts": 3,
  "summary": {
    "excellentCount": 1,
    "goodCount": 0,
    "fairCount": 0,
    "poorCount": 2
  }
}
```

**Accuracy Range Logic:**
- 90-100%: Excellent (Green #10B981)
- 80-89%: Good (Yellow #F59E0B)
- 70-79%: Fair (Orange #EF4444)
- <70%: Poor (Red #DC2626)

---

### 3. Performance Analytics API
**Endpoint:** `GET /v1/analytics/performance`

**Purpose:** Provides store and product performance metrics

**Query Parameters:**
- `type` (string, required) - "store" or "product"
- `limit` (number, optional) - Number of results (default: 10)
- `month` (YYYY-MM, optional) - Filter by specific month

**Store Performance Response Example:**
```json
{
  "type": "store",
  "performance": [
    {
      "storeId": "store_1",
      "storeName": "Store AHM-10",
      "storeCode": "AHM-10",
      "city": "Ahmedabad",
      "avgAccuracy": 50,
      "forecastCount": 2,
      "totalForecastQty": 2,
      "totalActualQty": 3,
      "avgDeviation": 50,
      "trend": "stable"
    }
  ],
  "summary": {
    "totalStores": 6,
    "avgStoreAccuracy": -2.14,
    "bestPerformingStore": "store_1",
    "worstPerformingStore": "store_3"
  }
}
```

**Product Performance Response Example:**
```json
{
  "type": "product",
  "performance": [
    {
      "productId": "product_1",
      "productName": "Van Heusen Mens Ankle Length Socks - White",
      "styleCode": "VH-SOCKS-001",
      "category": "Socks",
      "avgAccuracy": 50,
      "forecastCount": 2,
      "totalForecastQty": 2,
      "totalActualQty": 3,
      "avgDeviation": 50,
      "trend": "stable"
    }
  ],
  "summary": {
    "totalProducts": 6,
    "avgProductAccuracy": -1.6,
    "bestPerformingProduct": "product_1",
    "worstPerformingProduct": "product_4"
  }
}
```

---

### 4. Replenishment Analytics API
**Endpoint:** `GET /v1/analytics/replenishment`

**Purpose:** Provides replenishment-specific analytics

**Query Parameters:**
- `store` (ObjectId, optional) - Filter by specific store
- `product` (ObjectId, optional) - Filter by specific product
- `month` (YYYY-MM, optional) - Filter by specific month

**Response Example:**
```json
{
  "summary": {
    "totalReplenishments": 1,
    "avgReplenishmentQty": 5,
    "totalReplenishmentValue": 5,
    "avgSafetyBuffer": 1
  },
  "monthlyTrends": [
    {
      "month": "2025-01",
      "totalReplenishmentQty": 5,
      "avgReplenishmentQty": 5,
      "replenishmentCount": 1,
      "avgSafetyBuffer": 1
    }
  ],
  "storeReplenishment": [
    {
      "storeId": "store_1",
      "storeName": "Store DEL-129",
      "totalReplenishmentQty": 5,
      "avgReplenishmentQty": 5,
      "replenishmentCount": 1
    }
  ],
  "productReplenishment": [
    {
      "productId": "product_1",
      "productName": "Van Heusen Mens Ankle Length Socks - White",
      "totalReplenishmentQty": 5,
      "avgReplenishmentQty": 5,
      "replenishmentCount": 1
    }
  ]
}
```

---

## Implementation Details

### Database Queries
The APIs use MongoDB aggregation pipelines to efficiently process large datasets:

1. **Enhanced Trends API:**
   - Groups forecasts by month
   - Calculates totals and averages
   - Computes accuracy and deviation metrics
   - Sorts by month for chronological order

2. **Accuracy Distribution API:**
   - Calculates accuracy for each forecast
   - Groups forecasts into accuracy ranges
   - Provides color coding for visualization

3. **Performance Analytics API:**
   - Joins with store/product collections
   - Groups by store/product
   - Calculates performance metrics
   - Limits results for performance

4. **Replenishment Analytics API:**
   - Aggregates replenishment data
   - Provides monthly trends
   - Shows store and product breakdowns

### Performance Optimizations
- Database indexes on: `month`, `store`, `product`, `forecastQty`, `actualQty`
- Efficient aggregation pipelines
- Result limiting for large datasets
- Proper error handling and validation

### Error Handling
- Returns 400 for invalid parameters
- Returns 404 for non-existent resources
- Returns 500 for aggregation failures
- Includes detailed error messages

---

## Frontend Integration

### Chart Data Mapping

1. **Forecast vs Actual Trends Chart:**
   ```javascript
   // X-axis: trends[].month
   // Y-axis: trends[].avgForecastQty and trends[].avgActualQty
   // Tooltip: Show accuracy and deviation
   const chartData = {
     labels: trends.map(t => t.month),
     datasets: [
       { label: 'Forecast', data: trends.map(t => t.avgForecastQty) },
       { label: 'Actual', data: trends.map(t => t.avgActualQty) }
     ]
   };
   ```

2. **Accuracy Distribution Chart:**
   ```javascript
   // Data: distribution[].percentage
   // Labels: distribution[].label
   // Colors: distribution[].color
   const pieData = {
     labels: distribution.map(d => d.label),
     datasets: [{
       data: distribution.map(d => d.percentage),
       backgroundColor: distribution.map(d => d.color)
     }]
   };
   ```

3. **Performance Charts:**
   ```javascript
   // Bar chart: performance[].avgAccuracy
   // Labels: performance[].storeName or performance[].productName
   const barData = {
     labels: performance.map(p => p.storeName),
     datasets: [{
       label: 'Accuracy %',
       data: performance.map(p => p.avgAccuracy)
     }]
   };
   ```

### API Integration Example
```javascript
// Example usage in frontend
const fetchAnalyticsData = async () => {
  try {
    const [trends, distribution, performance, replenishment] = await Promise.all([
      fetch('/v1/analytics/trends?startMonth=2024-01&endMonth=2024-12'),
      fetch('/v1/analytics/accuracy-distribution'),
      fetch('/v1/analytics/performance?type=store&limit=10'),
      fetch('/v1/analytics/replenishment')
    ]);

    const trendsData = await trends.json();
    const distributionData = await distribution.json();
    const performanceData = await performance.json();
    const replenishmentData = await replenishment.json();

    // Update charts with data
    updateTrendsChart(trendsData);
    updateAccuracyChart(distributionData);
    updatePerformanceChart(performanceData);
    updateReplenishmentChart(replenishmentData);
  } catch (error) {
    console.error('Error fetching analytics data:', error);
  }
};
```

---

## Testing

### Test Script
A comprehensive test script (`test-enhanced-analytics.js`) is provided to verify all endpoints:

```bash
node test-enhanced-analytics.js
```

### Test Results
All APIs are working correctly with the following results:
- ✅ Enhanced Trends API: Working (4 months of data)
- ✅ Accuracy Distribution API: Working (3 forecasts analyzed)
- ✅ Performance Analytics API: Working (3 stores, 4 products)
- ✅ Replenishment Analytics API: Working (1 replenishment record)

---

## Security & Authentication

All endpoints require proper authentication and authorization:
- JWT token validation
- Role-based access control
- Rate limiting protection
- Input validation and sanitization

---

## Future Enhancements

### Phase 2 Features:
1. **Advanced Filtering:**
   - Date range filters
   - Category-based filtering
   - Custom accuracy thresholds

2. **Export Functionality:**
   - CSV/Excel export
   - PDF reports
   - Scheduled reports

3. **Real-time Analytics:**
   - WebSocket updates
   - Live dashboard refresh
   - Real-time notifications

4. **Advanced Metrics:**
   - Seasonal analysis
   - Trend prediction
   - Anomaly detection

---

## Support

For technical support or questions about the enhanced analytics APIs:
- Check the API documentation
- Review the test script for usage examples
- Monitor server logs for error details
- Contact the development team for issues

---

**Note:** These APIs are designed to work with the existing forecast and replenishment data models. Ensure that the database contains sufficient test data for meaningful analytics results. 