import { processMessage } from './src/services/chatbot.service.js';

// Simple test for chatbot without follow-up functionality
async function testSimpleChatbot() {
  console.log('🧪 Testing Simple Chatbot Service (No Follow-up)\n');

  const testQuestions = [
    'what is last month sales status of mumbai, powai store?',
    'which was top performing item in surat',
    'what is the sales forecast for next month',
    'what is the replenishment status'
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
        // Show first 300 characters of HTML
        console.log(`📄 HTML Preview: ${response.html.substring(0, 300)}...`);
        
        // Check if follow-up buttons are present
        if (response.html.includes('follow-up') || response.html.includes('btn-yes') || response.html.includes('btn-no')) {
          console.log(`⚠️  WARNING: Follow-up buttons found in HTML!`);
        } else {
          console.log(`✅ No follow-up buttons found - Clean HTML`);
        }
      }
      
    } catch (error) {
      console.error(`❌ Error processing question: ${error.message}`);
    }
  }
}

// Run test
async function runTest() {
  try {
    await testSimpleChatbot();
    
    console.log('\n🎉 Test completed!');
    console.log('\n📋 Current Features:');
    console.log('• Store-specific sales analysis');
    console.log('• Sales forecasting');
    console.log('• Replenishment status');
    console.log('• Text-based summaries (NO follow-up buttons)');
    console.log('• Clean, simple HTML output');
    
  } catch (error) {
    console.error(`❌ Test failed: ${error.message}`);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTest();
}

export { testSimpleChatbot, runTest };
