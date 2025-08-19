import { processMessage } from './src/services/chatbot.service.js';

async function testLocationExtraction() {
  console.log('🧪 Testing Location Extraction...\n');

  const testQuestions = [
    'which was top performing item in Chandigarh',
    'which was top performing item in Mumbai',
    'which was top performing item in Delhi',
    'which was top performing item in Bangalore',
    'top performing item in Chennai'
  ];

  for (const question of testQuestions) {
    console.log(`📍 Testing: "${question}"`);
    try {
      const response = await processMessage(question);
      console.log(`✅ Response Type: ${response.type}`);
      console.log(`✅ Action: ${response.question?.action}`);
      console.log(`✅ Location: ${response.question?.parameters?.location}`);
      console.log(`✅ Description: ${response.question?.description}`);
      console.log('---');
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
      console.log('---');
    }
  }
}

// Run the test
testLocationExtraction().catch(console.error);
