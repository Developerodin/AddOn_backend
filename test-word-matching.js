import * as chatbotService from './src/services/chatbot.service.js';

// Test the enhanced word matching functionality
async function testWordMatching() {
  console.log('🧪 Testing Enhanced Word Matching\n');
  
  const testMessages = [
    // Exact matches
    'show me top 5 products',
    'help',
    
    // Partial matches
    'top products',
    'sales trends',
    'store performance',
    'replenishment',
    'analytics dashboard',
    
    // Similar words
    'product performance',
    'store analytics',
    'sales data',
    'inventory replenishment',
    
    // Mixed matches
    'what are the top performing stores',
    'show me product analytics',
    'get sales performance data',
    'replenishment recommendations for stores',
    
    // Unrelated queries
    'what is the weather like',
    'how to cook pasta',
    'random question'
  ];
  
  for (const message of testMessages) {
    console.log(`📝 User Message: "${message}"`);
    
    try {
      const response = await chatbotService.processMessage(message);
      
      if (response.type === 'success') {
        console.log(`✅ Matched: "${response.question.description}"`);
        console.log(`   Action: ${response.question.action}`);
        console.log(`   Type: ${response.question.type}`);
      } else {
        console.log(`❌ No match found`);
        console.log(`   Suggestions: ${response.suggestions.join(', ')}`);
      }
      
      console.log('---');
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
      console.log('---');
    }
  }
  
  // Test word similarity function
  console.log('\n🔍 Testing Word Similarity Function\n');
  
  const wordPairs = [
    ['product', 'products'],
    ['store', 'stores'],
    ['sales', 'sale'],
    ['replenishment', 'replenish'],
    ['analytics', 'analytic'],
    ['performance', 'perform'],
    ['trend', 'trends'],
    ['dashboard', 'dash'],
    ['recommendation', 'recommend'],
    ['hello', 'world']
  ];
  
  wordPairs.forEach(([word1, word2]) => {
    const similarity = chatbotService.getWordSimilarity(word1, word2);
    console.log(`"${word1}" vs "${word2}": ${(similarity * 100).toFixed(1)}% similar`);
  });
  
  // Test suggestions for unmatched queries
  console.log('\n💡 Testing Smart Suggestions\n');
  
  const unmatchedQueries = [
    'product information',
    'store data',
    'sales report',
    'inventory management',
    'business analytics'
  ];
  
  unmatchedQueries.forEach(query => {
    const suggestions = chatbotService.getSuggestions(query);
    console.log(`Query: "${query}"`);
    console.log(`Suggestions: ${suggestions.join(', ')}`);
    console.log('---');
  });
}

// Run the test
testWordMatching().catch(console.error);
