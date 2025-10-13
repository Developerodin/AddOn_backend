#!/usr/bin/env node

/**
 * Test script to verify that Knitting floor quantity updates are now additive
 * This tests the PATCH endpoint: /v1/production/floors/Knitting/orders/{orderId}/articles/{articleId}
 */

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3003/v1';
const TEST_ORDER_ID = '68ec88f937d75f269bfef31b';
const TEST_ARTICLE_ID = '68ec88f937d75f269bfef31a';

async function testKnittingQuantityUpdate() {
  console.log('🧪 Testing Knitting Floor Quantity Update (Additive Behavior)');
  console.log('=' .repeat(60));
  
  try {
    // First, get the current article data to see existing quantities
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
    
    const knittingData = article.floorQuantities?.Knitting;
    if (!knittingData) {
      throw new Error('Knitting floor data not found');
    }
    
    console.log(`📈 Current Knitting Floor Data:`);
    console.log(`   - Received: ${knittingData.received}`);
    console.log(`   - Completed: ${knittingData.completed}`);
    console.log(`   - Remaining: ${knittingData.remaining}`);
    
    const currentCompleted = knittingData.completed;
    const testQuantity = 1000; // This should be ADDED to existing quantity
    const expectedNewQuantity = currentCompleted + testQuantity;
    
    console.log(`\n🎯 Testing additive update:`);
    console.log(`   - Current completed: ${currentCompleted}`);
    console.log(`   - Adding quantity: ${testQuantity}`);
    console.log(`   - Expected new total: ${expectedNewQuantity}`);
    
    // Now test the PATCH request
    const updateData = {
      completedQuantity: testQuantity,
      remarks: "Test additive update",
      m4Quantity: 10
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
    const updatedKnittingData = updatedArticle.floorQuantities?.Knitting;
    
    console.log(`\n✅ Update successful!`);
    console.log(`📊 Updated Knitting Floor Data:`);
    console.log(`   - Received: ${updatedKnittingData.received}`);
    console.log(`   - Completed: ${updatedKnittingData.completed}`);
    console.log(`   - Remaining: ${updatedKnittingData.remaining}`);
    
    // Verify the result
    if (updatedKnittingData.completed === expectedNewQuantity) {
      console.log(`\n🎉 SUCCESS: Quantity was correctly added!`);
      console.log(`   Expected: ${expectedNewQuantity}`);
      console.log(`   Actual: ${updatedKnittingData.completed}`);
    } else {
      console.log(`\n❌ FAILURE: Quantity was not added correctly!`);
      console.log(`   Expected: ${expectedNewQuantity}`);
      console.log(`   Actual: ${updatedKnittingData.completed}`);
      console.log(`   This suggests the old absolute behavior is still active.`);
    }
    
    // Check for overproduction
    if (updatedKnittingData.completed > updatedKnittingData.received) {
      const overproduction = updatedKnittingData.completed - updatedKnittingData.received;
      console.log(`\n📈 OVERPRODUCTION DETECTED:`);
      console.log(`   - Overproduction amount: ${overproduction}`);
      console.log(`   - Remaining should be 0: ${updatedKnittingData.remaining === 0 ? '✅' : '❌'}`);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testKnittingQuantityUpdate();
