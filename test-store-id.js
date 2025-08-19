import { processMessage } from './src/services/chatbot.service.js';

// Test store ID functionality
async function testStoreIDFunctionality() {
  console.log('🏪 Testing Store ID Functionality\n');

  const testQuestions = [
    'what are the top products in store LUC-66',
    'what are the top products in store SUR-5',
    'what are the top products in store 20004',
    'show me top products in store',
    'top products in store'
  ];

  for (const question of testQuestions) {
    console.log(`\n📝 Question: "${question}"`);
    console.log('─'.repeat(80));
    
    try {
      const response = await processMessage(question, { debug: true });
      
      console.log(`✅ Response Type: ${response.type}`);
      console.log(`📊 Message: ${response.message}`);
      
      if (response.data) {
        if (response.data.error) {
          console.log(`❌ Error: ${response.data.error}`);
          console.log(`📝 Message: ${response.data.message}`);
          if (response.data.suggestions) {
            console.log(`💡 Suggestions: ${response.data.suggestions.join(', ')}`);
          }
        } else {
          console.log(`📈 Data Available: ${Object.keys(response.data).length} fields`);
          
          if (response.data.store) {
            console.log(`🏪 Store Found: ${response.data.store.name} (${response.data.store.storeId})`);
            console.log(`📍 Location: ${response.data.store.city}`);
          }
          
          if (response.data.topProducts) {
            console.log(`📦 Top Products: ${response.data.topProducts.length} products found`);
            if (response.data.topProducts.length > 0) {
              console.log(`🥇 Top Product: ${response.data.topProducts[0].name}`);
              console.log(`💰 Sales: $${response.data.topProducts[0].sales.toLocaleString()}`);
            }
          }
        }
      }
      
      if (response.html) {
        console.log(`🌐 HTML Generated: ${response.html.length} characters`);
        // Check if it's a proper response or error
        if (response.html.includes('error') || response.html.includes('Error')) {
          console.log(`⚠️  HTML contains error message`);
        } else {
          console.log(`✅ HTML looks good`);
        }
      }
      
      if (response.question) {
        console.log(`🔍 Question Type: ${response.question.type}`);
        console.log(`🔍 Action: ${response.question.action}`);
        console.log(`🔍 Parameters: ${JSON.stringify(response.question.parameters)}`);
      }
      
    } catch (error) {
      console.error(`❌ Error processing question: ${error.message}`);
    }
  }
}

// Test specific store search patterns
async function testStoreSearchPatterns() {
  console.log('\n🔍 Testing Store Search Patterns\n');
  
  try {
    // Test different store ID formats
    const storePatterns = [
      'LUC-66',
      'SUR-5', 
      '20004',
      'Store SUR-5',
      'Store LUC-66'
    ];
    
    for (const pattern of storePatterns) {
      console.log(`\n🔍 Testing pattern: "${pattern}"`);
      
      const response = await processMessage(`what are the top products in store ${pattern}`);
      
      if (response.data && !response.data.error) {
        console.log(`✅ Found store: ${response.data.store?.name} (${response.data.store?.storeId})`);
      } else {
        console.log(`❌ No store found for pattern: ${pattern}`);
      }
    }
    
  } catch (error) {
    console.error(`❌ Error testing patterns: ${error.message}`);
  }
}

// Run tests
async function runTests() {
  try {
    await testStoreIDFunctionality();
    await testStoreSearchPatterns();
    
    console.log('\n🎉 Store ID tests completed!');
    console.log('\n📋 What Should Work Now:');
    console.log('• Store ID queries: "what are the top products in store LUC-66"');
    console.log('• Store ID queries: "what are the top products in store SUR-5"');
    console.log('• Store ID queries: "what are the top products in store 20004"');
    console.log('• Generic queries: "what are the top products in store" (with input prompt)');
    console.log('• Enhanced store search by ID, name, city, and address');
    
  } catch (error) {
    console.error(`❌ Tests failed: ${error.message}`);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests();
}

export { testStoreIDFunctionality, testStoreSearchPatterns, runTests };
