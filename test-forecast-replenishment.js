// Set required environment variables if not present
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

import mongoose from 'mongoose';
import Sales from './src/models/sales.model.js';
import axios from 'axios';
import config from './src/config/config.js';

// Find the highest selling product/store combination
const findTopSellingCombination = async () => {
  console.log('\n🔍 Finding highest selling product/store combination...');
  
  const result = await Sales.aggregate([
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'storeData'
      }
    },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'productData'
      }
    },
    {
      $unwind: '$storeData'
    },
    {
      $unwind: '$productData'
    },
    {
      $group: {
        _id: {
          storeId: '$plant',
          productId: '$materialCode',
          storeName: '$storeData.storeName',
          productName: '$productData.name'
        },
        totalQuantity: { $sum: '$quantity' },
        totalSales: { $sum: '$nsv' },
        recordCount: { $sum: 1 }
      }
    },
    {
      $sort: { totalQuantity: -1 }
    },
    {
      $limit: 1
    }
  ]);

  if (result.length === 0) {
    console.log('❌ No sales data found in database');
    return null;
  }

  const topSeller = result[0];
  console.log('📊 Top selling combination found:');
  console.log('   Store ID:', topSeller._id.storeId);
  console.log('   Store Name:', topSeller._id.storeName);
  console.log('   Product ID:', topSeller._id.productId);
  console.log('   Product Name:', topSeller._id.productName);
  console.log('   Total Quantity Sold:', topSeller.totalQuantity);
  console.log('   Total Sales Value:', topSeller.totalSales);
  console.log('   Number of Records:', topSeller.recordCount);

  return {
    storeId: topSeller._id.storeId.toString(),
    productId: topSeller._id.productId.toString(),
    storeName: topSeller._id.storeName,
    productName: topSeller._id.productName,
    totalQuantity: topSeller.totalQuantity,
    totalSales: topSeller.totalSales
  };
};

// Get recent sales data for the combination
const getRecentSalesData = async (storeId, productId) => {
  console.log('\n📈 Getting recent sales data...');
  
  const sales = await Sales.aggregate([
    {
      $match: {
        plant: mongoose.Types.ObjectId(storeId),
        materialCode: mongoose.Types.ObjectId(productId)
      }
    },
    {
      $addFields: {
        month: { $dateToString: { format: '%Y-%m', date: '$date' } }
      }
    },
    {
      $group: {
        _id: '$month',
        qtySold: { $sum: '$quantity' },
        salesValue: { $sum: '$nsv' },
        recordCount: { $sum: 1 }
      }
    },
    {
      $sort: { _id: -1 }
    },
    {
      $limit: 6
    }
  ]);

  console.log('📊 Recent sales by month:');
  sales.forEach(sale => {
    console.log(`   ${sale._id}: ${sale.qtySold} units, ₹${sale.salesValue}, ${sale.recordCount} records`);
  });

  return sales;
};

// Test forecast generation
const testForecastGeneration = async (storeId, productId, storeName, productName) => {
  console.log('\n🎯 Testing Forecast Generation...');
  
  const testMonth = '2025-01';
  const payload = {
    storeId,
    productId,
    month: testMonth,
    method: 'weighted_average'
  };

  console.log('📤 Sending forecast request:', JSON.stringify(payload, null, 2));

  try {
    const response = await axios.post('http://localhost:4000/v1/forecasts/generate', payload);
    
    console.log('✅ Forecast generated successfully!');
    console.log('📊 Response:');
    console.log('   Forecast ID:', response.data.id);
    console.log('   Store:', response.data.store?.storeName || storeName);
    console.log('   Product:', response.data.product?.name || productName);
    console.log('   Month:', response.data.month);
    console.log('   Forecast Quantity:', response.data.forecastQty);
    console.log('   Method:', response.data.method);
    console.log('   Actual Quantity:', response.data.actualQty);
    console.log('   Accuracy:', response.data.accuracy);

    return response.data;
  } catch (error) {
    console.error('❌ Forecast generation failed:', error.response?.data || error.message);
    return null;
  }
};

// Test replenishment calculation
const testReplenishmentCalculation = async (storeId, productId, storeName, productName) => {
  console.log('\n🔄 Testing Replenishment Calculation...');
  
  const testMonth = '2025-01';
  const currentStock = 50; // Assume current stock
  const payload = {
    storeId,
    productId,
    month: testMonth,
    currentStock,
    variability: 'standard'
  };

  console.log('📤 Sending replenishment request:', JSON.stringify(payload, null, 2));

  try {
    const response = await axios.post('http://localhost:4000/v1/replenishment/calculate', payload);
    
    console.log('✅ Replenishment calculated successfully!');
    console.log('📊 Response:');
    console.log('   Replenishment ID:', response.data.id);
    console.log('   Store:', response.data.store?.storeName || storeName);
    console.log('   Product:', response.data.product?.name || productName);
    console.log('   Month:', response.data.month);
    console.log('   Forecast Quantity:', response.data.forecastQty);
    console.log('   Current Stock:', response.data.currentStock);
    console.log('   Safety Buffer:', response.data.safetyBuffer);
    console.log('   Replenishment Quantity:', response.data.replenishmentQty);
    console.log('   Method:', response.data.method);

    return response.data;
  } catch (error) {
    console.error('❌ Replenishment calculation failed:', error.response?.data || error.message);
    return null;
  }
};

// Test getting forecasts
const testGetForecasts = async () => {
  console.log('\n📋 Testing Get Forecasts...');
  
  try {
    const response = await axios.get('http://localhost:4000/v1/forecasts');
    
    console.log('✅ Get forecasts successful!');
    console.log('📊 Response:');
    console.log('   Total Results:', response.data.totalResults);
    console.log('   Page:', response.data.page);
    console.log('   Total Pages:', response.data.totalPages);
    console.log('   Results Count:', response.data.results.length);
    
    if (response.data.results.length > 0) {
      const firstForecast = response.data.results[0];
      console.log('   First Forecast:');
      console.log('     Store:', firstForecast.store?.storeName || firstForecast.store);
      console.log('     Product:', firstForecast.product?.name || firstForecast.product);
      console.log('     Month:', firstForecast.month);
      console.log('     Forecast Qty:', firstForecast.forecastQty);
    }

    return response.data;
  } catch (error) {
    console.error('❌ Get forecasts failed:', error.response?.data || error.message);
    return null;
  }
};

// Test getting replenishments
const testGetReplenishments = async () => {
  console.log('\n📦 Testing Get Replenishments...');
  
  try {
    const response = await axios.get('http://localhost:4000/v1/replenishment');
    
    console.log('✅ Get replenishments successful!');
    console.log('📊 Response:');
    console.log('   Total Results:', response.data.totalResults);
    console.log('   Page:', response.data.page);
    console.log('   Total Pages:', response.data.totalPages);
    console.log('   Results Count:', response.data.results.length);
    
    if (response.data.results.length > 0) {
      const firstReplenishment = response.data.results[0];
      console.log('   First Replenishment:');
      console.log('     Store:', firstReplenishment.store?.storeName || firstReplenishment.store);
      console.log('     Product:', firstReplenishment.product?.name || firstReplenishment.product);
      console.log('     Month:', firstReplenishment.month);
      console.log('     Replenishment Qty:', firstReplenishment.replenishmentQty);
    }

    return response.data;
  } catch (error) {
    console.error('❌ Get replenishments failed:', error.response?.data || error.message);
    return null;
  }
};

// Main test function
const runTests = async () => {
  console.log('🚀 Starting Forecast & Replenishment API Tests\n');
  
  // Connect to MongoDB using the same config as the app
  try {
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    console.log('✅ Connected to MongoDB using app config');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
  
  // Find top selling combination
  const topSeller = await findTopSellingCombination();
  if (!topSeller) {
    console.log('❌ No data to test with. Exiting.');
    process.exit(1);
  }
  
  // Get recent sales data
  await getRecentSalesData(topSeller.storeId, topSeller.productId);
  
  // Test forecast generation
  const forecast = await testForecastGeneration(
    topSeller.storeId, 
    topSeller.productId, 
    topSeller.storeName, 
    topSeller.productName
  );
  
  // Test replenishment calculation
  const replenishment = await testReplenishmentCalculation(
    topSeller.storeId, 
    topSeller.productId, 
    topSeller.storeName, 
    topSeller.productName
  );
  
  // Test get forecasts
  await testGetForecasts();
  
  // Test get replenishments
  await testGetReplenishments();
  
  console.log('\n🎉 All tests completed!');
  console.log('\n📋 Summary:');
  console.log('   Store Used:', topSeller.storeName);
  console.log('   Product Used:', topSeller.productName);
  console.log('   Store ID:', topSeller.storeId);
  console.log('   Product ID:', topSeller.productId);
  console.log('   Total Historical Sales:', topSeller.totalQuantity, 'units');
  
  if (forecast) {
    console.log('   ✅ Forecast API: Working');
    console.log('   📊 Forecast Quantity:', forecast.forecastQty);
  } else {
    console.log('   ❌ Forecast API: Failed');
  }
  
  if (replenishment) {
    console.log('   ✅ Replenishment API: Working');
    console.log('   📦 Replenishment Quantity:', replenishment.replenishmentQty);
  } else {
    console.log('   ❌ Replenishment API: Failed');
  }
  
  // Disconnect from MongoDB
  await mongoose.disconnect();
  console.log('\n👋 Disconnected from MongoDB');
};

// Run the tests
runTests().catch(console.error); 