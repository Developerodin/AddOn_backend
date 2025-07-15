import mongoose from 'mongoose';
import axios from 'axios';
import config from './src/config/config.js';

// Connect to MongoDB using the same config as the app
const connectDB = async () => {
  try {
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    console.log('✅ Connected to MongoDB using app config');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Test Enhanced Trends API
const testEnhancedTrends = async () => {
  console.log('\n📈 Testing Enhanced Trends API...');
  
  try {
    const response = await axios.get('http://localhost:3002/v1/analytics/trends');
    
    console.log('✅ Enhanced Trends API successful!');
    console.log('📊 Response:');
    console.log('   Total Months:', response.data.summary.totalMonths);
    console.log('   Average Accuracy:', response.data.summary.avgAccuracy + '%');
    console.log('   Trend Direction:', response.data.summary.trendDirection);
    console.log('   Total Forecasts:', response.data.summary.totalForecasts);
    console.log('   Trends Count:', response.data.trends.length);
    
    if (response.data.trends.length > 0) {
      const firstTrend = response.data.trends[0];
      console.log('   First Trend:');
      console.log('     Month:', firstTrend.month);
      console.log('     Avg Forecast Qty:', firstTrend.avgForecastQty);
      console.log('     Avg Actual Qty:', firstTrend.avgActualQty);
      console.log('     Accuracy:', firstTrend.accuracy + '%');
    }

    return response.data;
  } catch (error) {
    console.error('❌ Enhanced Trends API failed:', error.response?.data || error.message);
    return null;
  }
};

// Test Accuracy Distribution API
const testAccuracyDistribution = async () => {
  console.log('\n🎯 Testing Accuracy Distribution API...');
  
  try {
    const response = await axios.get('http://localhost:3002/v1/analytics/accuracy-distribution');
    
    console.log('✅ Accuracy Distribution API successful!');
    console.log('📊 Response:');
    console.log('   Overall Accuracy:', response.data.overallAccuracy + '%');
    console.log('   Total Forecasts:', response.data.totalForecasts);
    console.log('   Distribution:');
    
    response.data.distribution.forEach(d => {
      console.log(`     ${d.label} (${d.range}): ${d.count} forecasts (${d.percentage}%)`);
    });

    return response.data;
  } catch (error) {
    console.error('❌ Accuracy Distribution API failed:', error.response?.data || error.message);
    return null;
  }
};

// Test Performance Analytics API
const testPerformanceAnalytics = async () => {
  console.log('\n🏆 Testing Performance Analytics API...');
  
  try {
    // Test store performance
    const storeResponse = await axios.get('http://localhost:3002/v1/analytics/performance?type=store&limit=5');
    
    console.log('✅ Store Performance API successful!');
    console.log('📊 Store Performance:');
    console.log('   Total Stores:', storeResponse.data.summary.totalStores);
    console.log('   Average Store Accuracy:', storeResponse.data.summary.avgStoreAccuracy + '%');
    console.log('   Performance Count:', storeResponse.data.performance.length);
    
    if (storeResponse.data.performance.length > 0) {
      const bestStore = storeResponse.data.performance[0];
      console.log('   Best Performing Store:');
      console.log('     Name:', bestStore.storeName);
      console.log('     Accuracy:', bestStore.avgAccuracy + '%');
      console.log('     Forecast Count:', bestStore.forecastCount);
    }

    // Test product performance
    const productResponse = await axios.get('http://localhost:3002/v1/analytics/performance?type=product&limit=5');
    
    console.log('\n📦 Product Performance:');
    console.log('   Total Products:', productResponse.data.summary.totalProducts);
    console.log('   Average Product Accuracy:', productResponse.data.summary.avgProductAccuracy + '%');
    console.log('   Performance Count:', productResponse.data.performance.length);
    
    if (productResponse.data.performance.length > 0) {
      const bestProduct = productResponse.data.performance[0];
      console.log('   Best Performing Product:');
      console.log('     Name:', bestProduct.productName);
      console.log('     Accuracy:', bestProduct.avgAccuracy + '%');
      console.log('     Forecast Count:', bestProduct.forecastCount);
    }

    return { store: storeResponse.data, product: productResponse.data };
  } catch (error) {
    console.error('❌ Performance Analytics API failed:', error.response?.data || error.message);
    return null;
  }
};

// Test Replenishment Analytics API
const testReplenishmentAnalytics = async () => {
  console.log('\n🔄 Testing Replenishment Analytics API...');
  
  try {
    const response = await axios.get('http://localhost:3002/v1/analytics/replenishment');
    
    console.log('✅ Replenishment Analytics API successful!');
    console.log('📊 Response:');
    console.log('   Summary:');
    console.log('     Total Replenishments:', response.data.summary.totalReplenishments);
    console.log('     Avg Replenishment Qty:', response.data.summary.avgReplenishmentQty);
    console.log('     Total Replenishment Value:', response.data.summary.totalReplenishmentValue);
    console.log('     Avg Safety Buffer:', response.data.summary.avgSafetyBuffer);
    
    console.log('   Monthly Trends Count:', response.data.monthlyTrends.length);
    console.log('   Store Replenishment Count:', response.data.storeReplenishment.length);
    console.log('   Product Replenishment Count:', response.data.productReplenishment.length);
    
    if (response.data.storeReplenishment.length > 0) {
      const topStore = response.data.storeReplenishment[0];
      console.log('   Top Store by Replenishment:');
      console.log('     Name:', topStore.storeName);
      console.log('     Total Qty:', topStore.totalReplenishmentQty);
      console.log('     Avg Qty:', topStore.avgReplenishmentQty);
    }

    return response.data;
  } catch (error) {
    console.error('❌ Replenishment Analytics API failed:', error.response?.data || error.message);
    return null;
  }
};

// Main test function
const runTests = async () => {
  console.log('🚀 Starting Enhanced Analytics API Tests\n');
  
  await connectDB();
  
  // Test all enhanced analytics endpoints
  const trends = await testEnhancedTrends();
  const distribution = await testAccuracyDistribution();
  const performance = await testPerformanceAnalytics();
  const replenishment = await testReplenishmentAnalytics();
  
  console.log('\n🎉 All Enhanced Analytics Tests Completed!');
  console.log('\n📋 Summary:');
  console.log('   ✅ Enhanced Trends API:', trends ? 'Working' : 'Failed');
  console.log('   ✅ Accuracy Distribution API:', distribution ? 'Working' : 'Failed');
  console.log('   ✅ Performance Analytics API:', performance ? 'Working' : 'Failed');
  console.log('   ✅ Replenishment Analytics API:', replenishment ? 'Working' : 'Failed');
  
  if (trends) {
    console.log('   📊 Trends Data Available:', trends.trends.length, 'months');
  }
  
  if (distribution) {
    console.log('   🎯 Distribution Data Available:', distribution.totalForecasts, 'forecasts');
  }
  
  if (performance) {
    console.log('   🏆 Performance Data Available:', performance.store.performance.length, 'stores,', performance.product.performance.length, 'products');
  }
  
  if (replenishment) {
    console.log('   🔄 Replenishment Data Available:', replenishment.summary.totalReplenishments, 'replenishments');
  }
  
  await mongoose.disconnect();
  console.log('\n👋 Disconnected from MongoDB');
};

// Run the tests
runTests().catch(console.error); 