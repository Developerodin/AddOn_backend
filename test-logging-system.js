/**
 * Test script to verify logging system functionality
 * This script tests all the logging functions to ensure they work correctly
 */

import mongoose from 'mongoose';
import { ArticleLog } from './src/models/production/index.js';
import { 
  createProductionLog,
  createQuantityUpdateLog,
  createTransferLog,
  createQualityInspectionLog,
  createQualityCategoryLog,
  createProgressUpdateLog,
  createRemarksUpdateLog,
  createFinalQualityLog,
  getLogStatistics
} from './src/utils/loggingHelper.js';

// Test configuration
const TEST_CONFIG = {
  orderId: 'TEST-ORDER-001',
  articleId: 'TEST-ARTICLE-001',
  userId: 'TEST-USER-001',
  floorSupervisorId: 'TEST-SUPERVISOR-001'
};

/**
 * Test basic log creation
 */
async function testBasicLogCreation() {
  console.log('🧪 Testing basic log creation...');
  
  try {
    const log = await createProductionLog({
      action: 'Order Created',
      orderId: TEST_CONFIG.orderId,
      userId: TEST_CONFIG.userId,
      floorSupervisorId: TEST_CONFIG.floorSupervisorId,
      remarks: 'Test order created for logging system verification'
    });
    
    console.log('✅ Basic log creation successful:', log.id);
    return log;
  } catch (error) {
    console.error('❌ Basic log creation failed:', error.message);
    throw error;
  }
}

/**
 * Test quantity update logging
 */
async function testQuantityUpdateLogging() {
  console.log('🧪 Testing quantity update logging...');
  
  try {
    const log = await createQuantityUpdateLog({
      articleId: TEST_CONFIG.articleId,
      orderId: TEST_CONFIG.orderId,
      floor: 'Knitting',
      previousQuantity: 100,
      newQuantity: 150,
      userId: TEST_CONFIG.userId,
      floorSupervisorId: TEST_CONFIG.floorSupervisorId,
      remarks: 'Test quantity update from 100 to 150',
      machineId: 'MACHINE-001',
      shiftId: 'SHIFT-001'
    });
    
    console.log('✅ Quantity update logging successful:', log.id);
    return log;
  } catch (error) {
    console.error('❌ Quantity update logging failed:', error.message);
    throw error;
  }
}

/**
 * Test transfer logging
 */
async function testTransferLogging() {
  console.log('🧪 Testing transfer logging...');
  
  try {
    const log = await createTransferLog({
      articleId: TEST_CONFIG.articleId,
      orderId: TEST_CONFIG.orderId,
      fromFloor: 'Knitting',
      toFloor: 'Checking',
      quantity: 50,
      userId: TEST_CONFIG.userId,
      floorSupervisorId: TEST_CONFIG.floorSupervisorId,
      remarks: 'Test transfer of 50 units from Knitting to Checking',
      batchNumber: 'BATCH-001'
    });
    
    console.log('✅ Transfer logging successful:', log.id);
    return log;
  } catch (error) {
    console.error('❌ Transfer logging failed:', error.message);
    throw error;
  }
}

/**
 * Test quality inspection logging
 */
async function testQualityInspectionLogging() {
  console.log('🧪 Testing quality inspection logging...');
  
  try {
    const log = await createQualityInspectionLog({
      articleId: TEST_CONFIG.articleId,
      orderId: TEST_CONFIG.orderId,
      floor: 'Checking',
      inspectedQuantity: 50,
      m1Quantity: 40,
      m2Quantity: 5,
      m3Quantity: 3,
      m4Quantity: 2,
      userId: TEST_CONFIG.userId,
      floorSupervisorId: TEST_CONFIG.floorSupervisorId,
      remarks: 'Test quality inspection with M1:40, M2:5, M3:3, M4:2',
      machineId: 'MACHINE-002',
      shiftId: 'SHIFT-002'
    });
    
    console.log('✅ Quality inspection logging successful:', log.id);
    return log;
  } catch (error) {
    console.error('❌ Quality inspection logging failed:', error.message);
    throw error;
  }
}

/**
 * Test quality category logging
 */
async function testQualityCategoryLogging() {
  console.log('🧪 Testing quality category logging...');
  
  try {
    const log = await createQualityCategoryLog({
      articleId: TEST_CONFIG.articleId,
      orderId: TEST_CONFIG.orderId,
      floor: 'Checking',
      category: 'M1',
      previousQuantity: 40,
      newQuantity: 45,
      userId: TEST_CONFIG.userId,
      floorSupervisorId: TEST_CONFIG.floorSupervisorId,
      remarks: 'Test M1 quantity update from 40 to 45'
    });
    
    console.log('✅ Quality category logging successful:', log.id);
    return log;
  } catch (error) {
    console.error('❌ Quality category logging failed:', error.message);
    throw error;
  }
}

/**
 * Test progress update logging
 */
async function testProgressUpdateLogging() {
  console.log('🧪 Testing progress update logging...');
  
  try {
    const log = await createProgressUpdateLog({
      articleId: TEST_CONFIG.articleId,
      orderId: TEST_CONFIG.orderId,
      previousProgress: 25,
      newProgress: 50,
      userId: TEST_CONFIG.userId,
      floorSupervisorId: TEST_CONFIG.floorSupervisorId,
      remarks: 'Test progress update from 25% to 50%'
    });
    
    console.log('✅ Progress update logging successful:', log.id);
    return log;
  } catch (error) {
    console.error('❌ Progress update logging failed:', error.message);
    throw error;
  }
}

/**
 * Test remarks update logging
 */
async function testRemarksUpdateLogging() {
  console.log('🧪 Testing remarks update logging...');
  
  try {
    const log = await createRemarksUpdateLog({
      articleId: TEST_CONFIG.articleId,
      orderId: TEST_CONFIG.orderId,
      previousRemarks: 'Old remarks',
      newRemarks: 'Updated remarks for testing',
      userId: TEST_CONFIG.userId,
      floorSupervisorId: TEST_CONFIG.floorSupervisorId
    });
    
    console.log('✅ Remarks update logging successful:', log.id);
    return log;
  } catch (error) {
    console.error('❌ Remarks update logging failed:', error.message);
    throw error;
  }
}

/**
 * Test final quality logging
 */
async function testFinalQualityLogging() {
  console.log('🧪 Testing final quality logging...');
  
  try {
    const log = await createFinalQualityLog({
      articleId: TEST_CONFIG.articleId,
      orderId: TEST_CONFIG.orderId,
      confirmed: true,
      userId: TEST_CONFIG.userId,
      floorSupervisorId: TEST_CONFIG.floorSupervisorId,
      remarks: 'Test final quality confirmation'
    });
    
    console.log('✅ Final quality logging successful:', log.id);
    return log;
  } catch (error) {
    console.error('❌ Final quality logging failed:', error.message);
    throw error;
  }
}

/**
 * Test log statistics
 */
async function testLogStatistics() {
  console.log('🧪 Testing log statistics...');
  
  try {
    const stats = await getLogStatistics({
      orderId: TEST_CONFIG.orderId,
      dateFrom: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
      dateTo: new Date()
    });
    
    console.log('✅ Log statistics successful:', {
      totalLogs: stats.totalLogs,
      totalQuantity: stats.totalQuantity,
      actionCount: stats.statistics.length
    });
    return stats;
  } catch (error) {
    console.error('❌ Log statistics failed:', error.message);
    throw error;
  }
}

/**
 * Test log retrieval
 */
async function testLogRetrieval() {
  console.log('🧪 Testing log retrieval...');
  
  try {
    const logs = await ArticleLog.find({
      orderId: TEST_CONFIG.orderId
    }).sort({ timestamp: -1 }).limit(10);
    
    console.log('✅ Log retrieval successful:', {
      totalLogs: logs.length,
      sampleLog: logs[0] ? {
        id: logs[0].id,
        action: logs[0].action,
        quantity: logs[0].quantity,
        timestamp: logs[0].timestamp
      } : 'No logs found'
    });
    return logs;
  } catch (error) {
    console.error('❌ Log retrieval failed:', error.message);
    throw error;
  }
}

/**
 * Test error handling
 */
async function testErrorHandling() {
  console.log('🧪 Testing error handling...');
  
  try {
    // Test with missing required fields
    const log = await createProductionLog({
      action: 'Test Action',
      // Missing orderId, userId, floorSupervisorId
      remarks: 'This should fail'
    });
    
    console.log('❌ Error handling test failed - should have thrown error');
    return false;
  } catch (error) {
    console.log('✅ Error handling successful - caught expected error:', error.message);
    return true;
  }
}

/**
 * Clean up test data
 */
async function cleanupTestData() {
  console.log('🧹 Cleaning up test data...');
  
  try {
    const result = await ArticleLog.deleteMany({
      orderId: TEST_CONFIG.orderId
    });
    
    console.log('✅ Cleanup successful:', {
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('❌ Cleanup failed:', error.message);
  }
}

/**
 * Main test function
 */
async function runLoggingTests() {
  console.log('🚀 Starting logging system tests...\n');
  
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/addon_production');
    console.log('✅ Connected to MongoDB\n');
    
    // Run all tests
    await testBasicLogCreation();
    await testQuantityUpdateLogging();
    await testTransferLogging();
    await testQualityInspectionLogging();
    await testQualityCategoryLogging();
    await testProgressUpdateLogging();
    await testRemarksUpdateLogging();
    await testFinalQualityLogging();
    await testLogStatistics();
    await testLogRetrieval();
    await testErrorHandling();
    
    console.log('\n🎉 All logging tests passed successfully!');
    
  } catch (error) {
    console.error('\n💥 Logging tests failed:', error.message);
    process.exit(1);
  } finally {
    // Clean up test data
    await cleanupTestData();
    
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed');
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runLoggingTests();
}

export {
  runLoggingTests,
  testBasicLogCreation,
  testQuantityUpdateLogging,
  testTransferLogging,
  testQualityInspectionLogging,
  testQualityCategoryLogging,
  testProgressUpdateLogging,
  testRemarksUpdateLogging,
  testFinalQualityLogging,
  testLogStatistics,
  testLogRetrieval,
  testErrorHandling,
  cleanupTestData
};
