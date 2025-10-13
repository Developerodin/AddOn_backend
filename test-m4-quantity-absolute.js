#!/usr/bin/env node

/**
 * Test script to verify that m4Quantity updates are now absolute (replace) for Knitting floor
 * This tests the PATCH endpoint: /v1/production/floors/Knitting/orders/{orderId}/articles/{articleId}
 */

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3003/v1';
const TEST_ORDER_ID = '68ec88f937d75f269bfef31b';
const TEST_ARTICLE_ID = '68ec88f937d75f269bfef31a';

async function testM4QuantityUpdate() {
  console.log('🧪 Testing Knitting Floor M4Quantity Update (Absolute Behavior)');
  console.log('=' .repeat(60));
  
  try {
    // First, get the current article data to see existing m4Quantity
    console.log('📊 Getting current article data...');
    const getResponse = await fetch(`${BASE_URL}/production/orders/${TEST_ORDER_ID}`);
    
    if (!getResponse.ok) {
      throw new Error(`Failed to get order: ${getResponse.status} ${getResponse.statusText}`);
    }
    
    const orderData = await getResponse.json();
    const article = orderData.articles.find(a => a._id === TEST_ARTICLE_ID);
    
    if (!article) {
      throw new Error('Article not found');
    }
    
    const knittingData = article.floorQuantities?.knitting;
    if (!knittingData) {
      throw new Error('Knitting floor data not found');
    }
    
    console.log(`📈 Current Knitting Floor Data:`);
    console.log(`   - Received: ${knittingData.received}`);
    console.log(`   - Completed: ${knittingData.completed}`);
    console.log(`   - M4Quantity: ${knittingData.m4Quantity || 0}`);
    
    const currentM4Quantity = knittingData.m4Quantity || 0;
    const testM4Quantity = 17; // This should REPLACE the existing m4Quantity
    
    console.log(`\n🎯 Testing absolute m4Quantity update:`);
    console.log(`   - Current m4Quantity: ${currentM4Quantity}`);
    console.log(`   - New m4Quantity: ${testM4Quantity}`);
    console.log(`   - Expected result: ${testM4Quantity} (should replace, not add)`);
    
    // Now test the PATCH request
    const updateData = {
      completedQuantity: 100,
      remarks: "sdfdf",
      m4Quantity: testM4Quantity
    };
    
    console.log(`\n📤 Sending PATCH request...`);
    console.log(`   URL: ${BASE_URL}/production/floors/Knitting/orders/${TEST_ORDER_ID}/articles/${TEST_ARTICLE_ID}`);
    console.log(`   Data:`, JSON.stringify(updateData, null, 2));
    
    const patchResponse = await fetch(
      `${BASE_URL}/production/floors/Knitting/orders/${TEST_ORDER_ID}/articles/${TEST_ARTICLE_ID}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          // Note: You'll need to add authentication headers here
          // 'Authorization': 'Bearer YOUR_JWT_TOKEN'
        },
        body: JSON.stringify(updateData)
      }
    );
    
    if (!patchResponse.ok) {
      const errorText = await patchResponse.text();
      throw new Error(`PATCH request failed: ${patchResponse.status} ${patchResponse.statusText}\nResponse: ${errorText}`);
    }
    
    const updatedArticle = await patchResponse.json();
    const updatedKnittingData = updatedArticle.floorQuantities?.knitting;
    
    console.log(`\n✅ Update successful!`);
    console.log(`📊 Updated Knitting Floor Data:`);
    console.log(`   - Received: ${updatedKnittingData.received}`);
    console.log(`   - Completed: ${updatedKnittingData.completed}`);
    console.log(`   - M4Quantity: ${updatedKnittingData.m4Quantity || 0}`);
    
    // Verify the m4Quantity result
    if (updatedKnittingData.m4Quantity === testM4Quantity) {
      console.log(`\n🎉 SUCCESS: M4Quantity was correctly replaced!`);
      console.log(`   Expected: ${testM4Quantity}`);
      console.log(`   Actual: ${updatedKnittingData.m4Quantity}`);
      console.log(`   Previous value (${currentM4Quantity}) was replaced, not added to.`);
    } else {
      console.log(`\n❌ FAILURE: M4Quantity was not replaced correctly!`);
      console.log(`   Expected: ${testM4Quantity}`);
      console.log(`   Actual: ${updatedKnittingData.m4Quantity}`);
      console.log(`   This suggests the old additive behavior is still active.`);
    }
    
    // Verify completedQuantity behavior (should still be additive)
    const expectedCompleted = knittingData.completed + updateData.completedQuantity;
    if (updatedKnittingData.completed === expectedCompleted) {
      console.log(`\n✅ BONUS: CompletedQuantity still works additively!`);
      console.log(`   Previous: ${knittingData.completed}`);
      console.log(`   Added: ${updateData.completedQuantity}`);
      console.log(`   New total: ${updatedKnittingData.completed}`);
    } else {
      console.log(`\n⚠️  WARNING: CompletedQuantity behavior may have changed!`);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testM4QuantityUpdate();
