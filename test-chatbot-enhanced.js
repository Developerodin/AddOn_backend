import { processMessage } from './src/services/chatbot.service.js';

// Test the enhanced chatbot with new question types
async function testEnhancedChatbot() {
  console.log('🧪 Testing Enhanced Chatbot Service\n');

  const testQuestions = [
    'what is last month sales status of mumbai, powai store?',
    'which was top performing item in surat',
    'what is the sales forecast for next month',
    'what is the replenishment status',
    'show me sales performance for store',
    'what are the top products in store'
  ];

  for (const question of testQuestions) {
    console.log(`\n📝 Question: "${question}"`);
    console.log('─'.repeat(80));
    
    try {
      const response = await processMessage(question, { debug: true });
      
      console.log(`✅ Response Type: ${response.type}`);
      console.log(`📊 Message: ${response.message}`);
      
      if (response.data) {
        console.log(`📈 Data Available: ${Object.keys(response.data).length} fields`);
      }
      
      if (response.html) {
        console.log(`🌐 HTML Generated: ${response.html.length} characters`);
        // Show first 200 characters of HTML
        console.log(`📄 HTML Preview: ${response.html.substring(0, 200)}...`);
      }
      
      if (response.debug) {
        console.log(`🔍 Debug Info: ${JSON.stringify(response.debug, null, 2)}`);
      }
      
    } catch (error) {
      console.error(`❌ Error processing question: ${error.message}`);
    }
  }
}

// Test specific functionality
async function testStoreSalesFunctionality() {
  console.log('\n🏪 Testing Store Sales Functionality\n');
  
  try {
    // Test store search functionality
    const Store = (await import('./src/models/store.model.js')).default;
    const Sales = (await import('./src/models/sales.model.js')).default;
    
    console.log('✅ Models imported successfully');
    console.log(`📦 Store Model: ${Store.modelName}`);
    console.log(`📦 Sales Model: ${Sales.modelName}`);
    
  } catch (error) {
    console.error(`❌ Error testing store sales functionality: ${error.message}`);
  }
}

// Run tests
async function runTests() {
  try {
    await testEnhancedChatbot();
    await testStoreSalesFunctionality();
    
    console.log('\n🎉 All tests completed!');
    console.log('\n📋 Summary of New Features:');
    console.log('• Store-specific sales analysis (Mumbai, Surat, etc.)');
    console.log('• Sales forecasting capabilities');
    console.log('• Replenishment status overview');
    console.log('• Text-based summaries');
    console.log('• Enhanced keyword matching for locations');
    
  } catch (error) {
    console.error(`❌ Test suite failed: ${error.message}`);
  }
}

// Run the tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests();
}

export { testEnhancedChatbot, testStoreSalesFunctionality, runTests };
