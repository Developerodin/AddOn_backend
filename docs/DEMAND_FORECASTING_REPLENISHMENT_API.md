# Demand Forecasting & Replenishment API Integration Guide

## Overview
This doc explains the backend APIs for demand forecasting and replenishment, ready to integrate into your dashboard. These APIs let you:
- Generate and fetch demand forecasts (per store/product/month)
- Calculate and fetch replenishment recommendations
- Get analytics (accuracy, trends, summary)

---

## API Endpoints

### Forecasting APIs

#### 1. Get Forecasts (Paginated)
`GET /v1/forecasts`
- **Query params:**
  - `store` (ObjectId, optional)
  - `product` (ObjectId, optional)
  - `month` (YYYY-MM, optional)
- **Response:**
```json
{
  "results": [
    {
      "_id": "...",
      "store": { ... },
      "product": { ... },
      "month": "2024-06",
      "forecastQty": 120,
      "actualQty": 110,
      "accuracy": 91.6,
      "method": "moving_average"
    }
  ],
  "page": 1,
  "limit": 10,
  "totalPages": 1,
  "totalResults": 1
}
```

#### 2. Generate Forecast
`POST /v1/forecasts/generate`
- **Body:**
```json
{
  "storeId": "ObjectId",
  "productId": "ObjectId",
  "month": "YYYY-MM",
  "method": "moving_average" // or "weighted_average"
}
```
- **Response:** Forecast object (see above)

#### 3. Get Forecast by Store/Product/Month
`GET /v1/forecasts/:storeId/:productId/:month`
- **Response:** Forecast object

#### 4. Update Forecast (actual sales, accuracy)
`PUT /v1/forecasts/:id`
- **Body:**
```json
{
  "actualQty": 110
}
```
- **Response:** Updated forecast object

---

### Replenishment APIs

#### 1. Get Replenishments (Paginated)
`GET /v1/replenishment`
- **Query params:**
  - `store` (ObjectId, optional)
  - `product` (ObjectId, optional)
  - `month` (YYYY-MM, optional)
- **Response:**
```json
{
  "results": [
    {
      "_id": "...",
      "store": { ... },
      "product": { ... },
      "month": "2024-06",
      "forecastQty": 120,
      "currentStock": 60,
      "safetyBuffer": 15,
      "replenishmentQty": 75,
      "method": "moving_average"
    }
  ],
  ...
}
```

#### 2. Calculate Replenishment
`POST /v1/replenishment/calculate`
- **Body:**
```json
{
  "storeId": "ObjectId",
  "productId": "ObjectId",
  "month": "YYYY-MM",
  "currentStock": 60,
  "variability": "standard" // or "high", "seasonal"
}
```
- **Response:** Replenishment object (see above)

#### 3. Get Replenishment by Store/Product/Month
`GET /v1/replenishment/:storeId/:productId/:month`
- **Response:** Replenishment object

---

### Analytics APIs

#### 1. Get Forecast Accuracy
`GET /v1/analytics/accuracy`
- **Response:**
```json
{
  "accuracy": 87.5,
  "details": []
}
```

#### 2. Get Trends
`GET /v1/analytics/trends`
- **Response:**
```json
{
  "trends": []
}
```

#### 3. Get Summary
`GET /v1/analytics/summary`
- **Response:**
```json
{
  "totalForecasts": 0,
  "avgAccuracy": 0,
  "totalReplenishment": 0
}
```

---

## Frontend Integration Notes

- **Forecast Table:** Use `/forecasts` to show per-store/product/month forecasts. Allow generating new forecasts via `/forecasts/generate`.
- **Replenishment Table:** Use `/replenishment` to show recommendations. Calculate new ones via `/replenishment/calculate`.
- **Charts:** Use analytics endpoints for accuracy, trends, and summary cards.
- **Filters:** All list endpoints support filtering by store, product, and month.
- **Update Actuals:** After sales close, update forecasts with actual sales using `PUT /forecasts/:id` to track accuracy.

---

## Example Usage

**Generate a forecast:**
```js
await axios.post('/v1/forecasts/generate', { storeId, productId, month, method: 'moving_average' });
```

**Calculate replenishment:**
```js
await axios.post('/v1/replenishment/calculate', { storeId, productId, month, currentStock, variability: 'standard' });
```

**Show in dashboard:**
- Use the paginated GET endpoints to populate tables and charts.
- Use analytics endpoints for summary cards and trend graphs.

---

## Notes
- All endpoints require valid ObjectIds for store/product.
- Month format: `YYYY-MM` (e.g., `2024-06`).
- Methods supported: `moving_average`, `weighted_average` (seasonal coming soon).
- Safety buffer and replenishment rules are as per the system design.

---

## Summary of Available Endpoints

### ✅ Implemented & Ready to Use:

**Forecasting:**
- `GET /v1/forecasts` - Get all forecasts (paginated)
- `POST /v1/forecasts/generate` - Generate new forecast
- `GET /v1/forecasts/:storeId/:productId/:month` - Get specific forecast
- `PUT /v1/forecasts/:id` - Update forecast with actual sales

**Replenishment:**
- `GET /v1/replenishment` - Get all replenishments (paginated)
- `POST /v1/replenishment/calculate` - Calculate new replenishment
- `GET /v1/replenishment/:storeId/:productId/:month` - Get specific replenishment

**Analytics:**
- `GET /v1/analytics/accuracy` - Get forecast accuracy metrics
- `GET /v1/analytics/trends` - Get forecast trends
- `GET /v1/analytics/summary` - Get summary statistics

### 🔧 Backend Status:
- ✅ Models: Forecast, Replenishment
- ✅ Services: Forecasting logic, Replenishment calculation
- ✅ Controllers: All endpoints implemented
- ✅ Routes: All registered in `/v1/`
- ✅ Server: Running and responding

---

**Contact backend team for advanced analytics or custom logic.** 