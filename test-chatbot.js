/**
 * Test file to demonstrate chatbot functionality
 * This shows how the predefined questions work and what responses you'll get
 */

// Example predefined questions you can test from frontend:

const DEMO_QUESTIONS = [
  // Analytics Questions
  'show me top 5 products',
  'show me top 5 stores', 
  'what are the sales trends',
  'show me store performance',
  'show me product performance',
  'what is the discount impact',
  'show me tax and MRP analytics',
  'show me summary KPIs',
  'show me the analytics dashboard',

  // Product Questions
  'how many products do we have',
  'show me active products',
  'find product by name',
  'show me products by category',

  // Replenishment Questions
  'show me replenishment recommendations',
  'calculate replenishment for store',
  'show me all replenishments',

  // General Questions
  'help',
  'what can you do'
];

console.log('🤖 Chatbot Demo Questions:');
console.log('==========================');
console.log('');

DEMO_QUESTIONS.forEach((question, index) => {
  console.log(`${index + 1}. "${question}"`);
});

console.log('');
console.log('📱 Frontend Integration:');
console.log('=======================');
console.log('');

console.log('1. Send POST request to /api/v1/chatbot/chat');
console.log('   Body: { "message": "show me top 5 products" }');
console.log('');

console.log('2. Get all predefined questions:');
console.log('   GET /api/v1/chatbot/questions');
console.log('');

console.log('3. Get question suggestions by category:');
console.log('   GET /api/v1/chatbot/suggestions?category=analytics');
console.log('');

console.log('4. Get chatbot help:');
console.log('   GET /api/v1/chatbot/help');
console.log('');

console.log('5. Get demo responses:');
console.log('   GET /api/v1/chatbot/demo');
console.log('');

console.log('🔍 How it works:');
console.log('================');
console.log('1. User types a question in frontend');
console.log('2. Frontend sends POST to /chatbot/chat with the message');
console.log('3. Backend matches the question to predefined patterns');
console.log('4. Backend calls appropriate service (analytics, product, replenishment)');
console.log('5. Backend returns formatted response with data');
console.log('6. Frontend displays the response to user');
console.log('');

console.log('💡 Smart Matching:');
console.log('==================');
console.log('- Exact matches work best');
console.log('- Partial matches are supported');
console.log('- Keyword matching for similar questions');
console.log('- Suggestions for unknown questions');
console.log('');

console.log('🚀 Ready to test! Start your backend and try these questions.');
