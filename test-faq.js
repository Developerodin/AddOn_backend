import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:4000/v1/faq';

// Test datas
const faqData = [
  {
    question: "What are your capabilities?",
    answer: "I can forecast sales per product per store, provide in-depth analytics on store performance, deliver detailed insights on individual products, forecast raw material consumption, and answer questions about your current inventory status."
  },
  {
    question: "How can you help me avoid stockouts?",
    answer: "By forecasting demand at the store and product level, I alert you in advance about low stock and suggest replenishment quantities."
  },
  {
    question: "Can you optimise inventory across multiple stores?",
    answer: "Yes. I compare sales velocity and inventory across stores, then recommend stock transfers or replenishment orders to balance inventory levels."
  },
  {
    question: "What analytics do you provide?",
    answer: "I provide comprehensive analytics including sales trends, product performance, store performance, brand analysis, discount impact, and demand forecasting."
  },
  {
    question: "How accurate are your forecasts?",
    answer: "My forecasts use historical sales data and machine learning algorithms. Accuracy typically ranges from 75-90% depending on data quality and market stability."
  }
];

// Test AI tool-calling questions
const aiToolQuestions = [
  "Show me top products",
  "How many products do we have?",
  "What are the top products in Mumbai?",
  "Show me top products in Delhi",
  "Generate a sales report",
  "What are our best selling products?",
  "Show me product inventory summary",
  "Create an analytics dashboard",
  "Show me store performance analysis",
  "What's the sales trend for last month?",
  "Get me top stores by performance",
  "Show me brand performance data"
];

// Test FAQ questions
const faqQuestions = [
  "How do you prevent stockouts?",
  "Can you help with inventory optimization?",
  "What kind of analytics do you offer?",
  "How accurate are your predictions?",
  "What's your forecast accuracy?",
  "Do you provide store analytics?",
  "Can you analyze product performance?"
];

// Test capability questions (should go to AI tools)
const capabilityQuestions = [
  "What can you do?",
  "What are your capabilities?",
  "How can you help me?",
  "What do you do?"
];

/**
 * Test FAQ training
 */
async function testFAQTraining() {
  console.log('\n🚀 Testing FAQ Training...');
  
  try {
    for (const faq of faqData) {
      const response = await fetch(`${BASE_URL}/train-faq`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(faq),
      });
      
      const result = await response.json();
      
      if (response.ok) {
        console.log(`✅ FAQ trained: ${faq.question.substring(0, 50)}...`);
      } else {
        console.log(`❌ FAQ training failed: ${result.message}`);
      }
    }
  } catch (error) {
    console.error('❌ FAQ training error:', error.message);
  }
}

/**
 * Test AI Tool-Calling functionality
 */
async function testAIToolCalling() {
  console.log('\n🤖 Testing AI Tool-Calling...');
  
  let successCount = 0;
  let totalCount = aiToolQuestions.length;
  
  for (const question of aiToolQuestions) {
    try {
      console.log(`\n🔍 Testing: "${question}"`);
      
      const response = await fetch(`${BASE_URL}/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question }),
      });
      
      const result = await response.json();
      
      if (response.ok) {
        if (result.data.type === 'ai_tool') {
          console.log(`✅ AI Tool Response (${result.data.intent.action}):`);
          console.log(`   Intent: ${result.data.intent.description}`);
          console.log(`   Confidence: ${result.data.confidence}`);
          console.log(`   Response Length: ${result.data.response.length} characters`);
          successCount++;
        } else if (result.data.type === 'faq') {
          console.log(`⚠️  FAQ Fallback Response:`);
          console.log(`   Confidence: ${result.data.confidence}`);
          console.log(`   Source: ${result.data.source}`);
        } else {
          console.log(`❓ Unknown Response Type: ${result.data.type}`);
        }
      } else {
        console.log(`❌ Request failed: ${result.message}`);
      }
      
      // Add delay between requests
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error(`❌ Error testing "${question}":`, error.message);
    }
  }
  
  console.log(`\n📊 AI Tool-Calling Results: ${successCount}/${totalCount} successful`);
  return successCount / totalCount;
}

/**
 * Test FAQ Vector Search
 */
async function testFAQSearch() {
  console.log('\n🔍 Testing FAQ Vector Search...');
  
  let successCount = 0;
  let totalCount = faqQuestions.length;
  
  for (const question of faqQuestions) {
    try {
      console.log(`\n🔍 Testing: "${question}"`);
      
      const response = await fetch(`${BASE_URL}/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question }),
      });
      
      const result = await response.json();
      
      if (response.ok) {
        if (result.data.type === 'faq') {
          console.log(`✅ FAQ Response:`);
          console.log(`   Confidence: ${result.data.confidence}`);
          console.log(`   Source: ${result.data.source}`);
          console.log(`   Response: ${result.data.response.substring(0, 100)}...`);
          
          if (result.data.originalFAQ) {
            console.log(`   Original FAQ: ${result.data.originalFAQ.question}`);
          }
          
          if (result.data.similarity) {
            console.log(`   Similarity Score: ${(result.data.similarity * 100).toFixed(1)}%`);
          }
          
          successCount++;
        } else if (result.data.type === 'ai_tool') {
          console.log(`⚠️  AI Tool Response (unexpected for FAQ question):`);
          console.log(`   Intent: ${result.data.intent.description}`);
        } else {
          console.log(`❓ Unknown Response Type: ${result.data.type}`);
        }
      } else {
        console.log(`❌ Request failed: ${result.message}`);
      }
      
      // Add delay between requests
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error(`❌ Error testing "${question}":`, error.message);
    }
  }
  
  console.log(`\n📊 FAQ Search Results: ${successCount}/${totalCount} successful`);
  return successCount / totalCount;
}

/**
 * Test specific AI tool functions
 */
async function testSpecificAITools() {
  console.log('\n🎯 Testing Specific AI Tools...');
  
  const specificTests = [
    {
      name: "Top Products",
      question: "Show me the top 5 products by sales",
      expectedIntent: "getTopProducts"
    },
    {
      name: "Product Count",
      question: "How many products are in our inventory?",
      expectedIntent: "getProductCount"
    },
    {
      name: "City-specific Products",
      question: "What are the best selling products in Bangalore?",
      expectedIntent: "getTopProductsInCity"
    },
    {
      name: "Sales Report",
      question: "Generate a sales report for this month",
      expectedIntent: "getSalesReport"
    },
    {
      name: "Analytics Dashboard",
      question: "Show me the business analytics dashboard",
      expectedIntent: "getAnalyticsDashboard"
    }
  ];
  
  let successCount = 0;
  
  for (const test of specificTests) {
    try {
      console.log(`\n🎯 Testing: ${test.name}`);
      
      const response = await fetch(`${BASE_URL}/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question: test.question }),
      });
      
      const result = await response.json();
      
      if (response.ok && result.data.type === 'ai_tool') {
        if (result.data.intent.action === test.expectedIntent) {
          console.log(`✅ ${test.name}: Correct intent detected`);
          console.log(`   Action: ${result.data.intent.action}`);
          console.log(`   Description: ${result.data.intent.description}`);
          successCount++;
        } else {
          console.log(`❌ ${test.name}: Wrong intent detected`);
          console.log(`   Expected: ${test.expectedIntent}`);
          console.log(`   Got: ${result.data.intent.action}`);
        }
      } else {
        console.log(`❌ ${test.name}: Failed to get AI tool response`);
        if (result.data.type === 'faq') {
          console.log(`   Got FAQ response instead`);
        }
      }
      
      // Add delay between requests
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error(`❌ Error testing ${test.name}:`, error.message);
    }
  }
  
  console.log(`\n📊 Specific AI Tool Tests: ${successCount}/${specificTests.length} successful`);
  return successCount / specificTests.length;
}

/**
 * Test error handling and edge cases
 */
async function testErrorHandling() {
  console.log('\n⚠️  Testing Error Handling...');
  
  const errorTests = [
    {
      name: "Empty Question",
      question: "",
      expectedError: true
    },
    {
      name: "Very Long Question",
      question: "A".repeat(1000),
      expectedError: false
    },
    {
      name: "Special Characters",
      question: "What's the @#$%^&*() status?",
      expectedError: false
    },
    {
      name: "Numbers Only",
      question: "12345",
      expectedError: false
    }
  ];
  
  let successCount = 0;
  
  for (const test of errorTests) {
    try {
      console.log(`\n⚠️  Testing: ${test.name}`);
      
      const response = await fetch(`${BASE_URL}/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question: test.question }),
      });
      
      const result = await response.json();
      
      if (test.expectedError) {
        if (!response.ok) {
          console.log(`✅ ${test.name}: Correctly handled error`);
          successCount++;
        } else {
          console.log(`❌ ${test.name}: Should have failed but didn't`);
        }
      } else {
        if (response.ok) {
          console.log(`✅ ${test.name}: Handled correctly`);
          successCount++;
        } else {
          console.log(`❌ ${test.name}: Unexpectedly failed`);
        }
      }
      
      // Add delay between requests
      await new Promise(resolve => setTimeout(resolve, 300));
      
    } catch (error) {
      console.error(`❌ Error testing ${test.name}:`, error.message);
    }
  }
  
  console.log(`\n📊 Error Handling Tests: ${successCount}/${errorTests.length} successful`);
  return successCount / errorTests.length;
}

/**
 * Main test runner
 */
async function runAllTests() {
  console.log('🚀 Starting Comprehensive FAQ and AI Tool Testing...\n');
  
  const startTime = Date.now();
  
  try {
    // Test FAQ training
    await testFAQTraining();
    
    // Wait a bit for training to complete
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test AI tool calling
    const aiToolScore = await testAIToolCalling();
    
    // Test FAQ search
    const faqScore = await testFAQSearch();
    
    // Test specific AI tools
    const specificToolScore = await testSpecificAITools();
    
    // Test error handling
    const errorHandlingScore = await testErrorHandling();
    
    // Calculate overall score
    const overallScore = (aiToolScore + faqScore + specificToolScore + errorHandlingScore) / 4;
    
    const endTime = Date.now();
    const totalTime = (endTime - startTime) / 1000;
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 FINAL TEST RESULTS');
    console.log('='.repeat(60));
    console.log(`⏱️  Total Test Time: ${totalTime.toFixed(2)} seconds`);
    console.log(`🤖 AI Tool-Calling: ${(aiToolScore * 100).toFixed(1)}%`);
    console.log(`🔍 FAQ Vector Search: ${(faqScore * 100).toFixed(1)}%`);
    console.log(`🎯 Specific AI Tools: ${(specificToolScore * 100).toFixed(1)}%`);
    console.log(`⚠️  Error Handling: ${(errorHandlingScore * 100).toFixed(1)}%`);
    console.log(`📈 Overall Score: ${(overallScore * 100).toFixed(1)}%`);
    
    if (overallScore >= 0.8) {
      console.log('\n🎉 EXCELLENT! All systems are working perfectly!');
    } else if (overallScore >= 0.6) {
      console.log('\n✅ GOOD! Most systems are working well.');
    } else {
      console.log('\n⚠️  NEEDS ATTENTION! Some systems have issues.');
    }
    
  } catch (error) {
    console.error('\n❌ Test suite failed:', error.message);
  }
}

// Run the tests
runAllTests().catch(console.error);
