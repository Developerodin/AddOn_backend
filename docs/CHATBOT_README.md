# 🤖 Chatbot API Documentation

## Overview
The chatbot system provides an intelligent interface for users to query analytics, product, and replenishment data using natural language. It uses predefined question patterns to match user input and return relevant data from your existing APIs.

## 🚀 Quick Start

### 1. Start your backend server
```bash
npm start
# or
node src/index.js
```

### 2. Test the chatbot
```bash
# Test a simple question
curl -X POST http://localhost:3000/api/v1/chatbot/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "show me top 5 products"}'
```

## 📍 API Endpoints

### Main Chat Endpoint
- **POST** `/api/v1/chatbot/chat`
- **Body**: `{"message": "your question here"}`
- **Response**: Processed response with data

### Utility Endpoints
- **GET** `/api/v1/chatbot/questions` - Get all predefined questions
- **GET** `/api/v1/chatbot/suggestions?category=analytics` - Get questions by category
- **GET** `/api/v1/chatbot/help` - Get chatbot help
- **GET** `/api/v1/chatbot/demo` - Get demo responses

## 🔧 HTML Template Generation (FIXED)

### What Was Fixed
The chatbot now uses **smart field extractors** that automatically detect and extract field values from your data, regardless of the field names used by your services.

### Smart Field Detection
- **Labels**: Automatically finds name, title, or identifier fields
- **Values**: Intelligently extracts numeric data for charts and KPIs
- **Tables**: Dynamically determines columns and formats data appropriately
- **Fallbacks**: Handles edge cases and missing data gracefully

### Field Extraction Priority
```javascript
// Label fields (in order of preference)
['name', 'productName', 'storeName', 'categoryName', 'title', 'product', 'store', 'category']

// Value fields (in order of preference)  
['sales', 'revenue', 'quantity', 'amount', 'total', 'count', 'value', 'price']
```

### Data Structure Handling
The chatbot now handles multiple data structures:
- `data.results` - Standard response format
- `data.data` - Alternative response format
- `data.products`, `data.stores`, etc. - Direct array fields
- Direct array responses
- Nested object structures

## 💬 Predefined Questions

### Analytics Questions
| Question | Description | Response |
|----------|-------------|----------|
| `show me top 5 products` | Get top 5 performing products | Product performance data |
| `show me top 5 stores` | Get top 5 performing stores | Store performance data |
| `what are the sales trends` | Get sales trends over time | Time-based sales data |
| `show me store performance` | Get overall store performance | Store analytics |
| `show me product performance` | Get overall product performance | Product analytics |
| `what is the discount impact` | Analyze discount impact | Discount analysis data |
| `show me tax and MRP analytics` | Get tax and MRP data | Tax/MRP analytics |
| `show me summary KPIs` | Get key performance indicators | Summary KPIs |
| `show me the analytics dashboard` | Get comprehensive dashboard | Full analytics data |

### Product Questions
| Question | Description | Response |
|----------|-------------|----------|
| `how many products do we have` | Get total product count | Product count |
| `show me active products` | Get all active products | Active products list |
| `find product by name` | Search product by name | Product search results |
| `show me products by category` | Filter products by category | Category products |

### Replenishment Questions
| Question | Description | Response |
|----------|-------------|----------|
| `show me replenishment recommendations` | Get replenishment suggestions | Replenishment data |
| `calculate replenishment for store` | Calculate for specific store | Replenishment calculation |
| `show me all replenishments` | Get all replenishment records | All replenishments |

### General Questions
| Question | Description | Response |
|----------|-------------|----------|
| `help` | Show available commands | Help information |
| `what can you do` | Show chatbot capabilities | Capabilities list |

## 🔍 How It Works

### 1. Message Processing
```
User Input → Normalize → Pattern Matching → Action Execution → Data Preprocessing → HTML Generation → Response
```

### 2. Smart Data Processing
- **Field Detection**: Automatically identifies relevant fields
- **Data Normalization**: Handles different response structures
- **Type Formatting**: Formats numbers, dates, and booleans appropriately
- **Error Handling**: Graceful fallbacks for missing or malformed data

### 3. HTML Generation
- **Dynamic Templates**: Adapts to available data
- **Responsive Design**: Mobile-friendly charts and tables
- **Chart.js Integration**: Interactive visualizations
- **Smart Styling**: Consistent, professional appearance

## 🐛 Debugging & Troubleshooting

### Enable Debug Mode
```javascript
// Send message with debug enabled
const response = await fetch('/api/v1/chatbot/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    message: 'show me top 5 products',
    debug: true 
  })
});

// Response includes debug information
console.log('Debug info:', response.debug);
```

### Data Structure Analysis
```javascript
// Analyze your data structure
import { analyzeDataStructure } from './chatbot.service.js';

const analysis = analyzeDataStructure(yourData);
console.log('Data Analysis:', analysis);
```

### Test HTML Generation
```javascript
// Test specific templates
import { testHTMLGeneration } from './chatbot.service.js';

const html = testHTMLGeneration('dataTable', sampleData);
console.log('Generated HTML:', html);
```

### Common Issues & Solutions

#### Issue: Empty charts or tables
**Solution**: Check data structure with debug mode
```bash
curl -X POST http://localhost:3000/api/v1/chatbot/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "show me top 5 products", "debug": true}'
```

#### Issue: Wrong field values
**Solution**: The smart extractors should handle this automatically, but you can verify with:
```javascript
// Check what fields are available
const analysis = analyzeDataStructure(data);
console.log('Available fields:', analysis.keys);
```

#### Issue: HTML not rendering
**Solution**: Check browser console for JavaScript errors and ensure Chart.js is loaded

## 📱 Frontend Integration

### Basic Chat Implementation
```javascript
// Send message to chatbot
const sendMessage = async (message, debug = false) => {
  try {
    const response = await fetch('/api/v1/chatbot/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, debug })
    });
    
    const data = await response.json();
    
    // Display the HTML response with charts and tables
    if (data.html) {
      document.getElementById('chatContainer').innerHTML = data.html;
      
      // Re-execute Chart.js scripts if they exist
      const scripts = document.getElementById('chatContainer').getElementsByTagName('script');
      for (let script of scripts) {
        eval(script.innerHTML);
      }
    }
    
    // Debug information if enabled
    if (data.debug) {
      console.log('Debug Info:', data.debug);
    }
    
    return data;
  } catch (error) {
    console.error('Chat error:', error);
  }
};

// Example usage
sendMessage('show me top 5 products', true).then(response => {
  console.log('Chat response:', response);
  // HTML will be automatically rendered in chatContainer
});
```

### Get Predefined Questions
```javascript
// Get all available questions for UI suggestions
const getQuestions = async () => {
  const response = await fetch('/api/v1/chatbot/questions');
  const data = await response.json();
  return data.data;
};
```

## 🧪 Testing

### Using Postman
1. Import the `chatbot.postman_collection.json` file
2. Set your `baseUrl` variable
3. Test different predefined questions
4. Enable debug mode by adding `"debug": true` to request body

### Using cURL
```bash
# Test analytics with debug
curl -X POST http://localhost:3000/api/v1/chatbot/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "show me top 5 stores", "debug": true}'

# Test products
curl -X POST http://localhost:3000/api/v1/chatbot/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "how many products do we have"}'

# Test replenishment
curl -X POST http://localhost:3000/api/v1/chatbot/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "show me replenishment recommendations"}'
```

### Using the Demo Endpoint
```bash
# Get demo responses for all common questions
curl http://localhost:3000/api/v1/chatbot/demo
```

## 🎯 Response Format

### Success Response
```json
{
  "success": true,
  "type": "success",
  "message": "Here's what I found for: \"show me top 5 products\"",
  "data": {
    // Actual data from your services
  },
  "question": {
    "type": "analytics",
    "action": "getTopProducts",
    "description": "Get top 5 performing products"
  },
  "html": "<div class='chart-container'>...</div>",
  "debug": {
    "rawData": {...},
    "question": {...},
    "htmlLength": 1234
  }
}
```

### HTML Response Types
The chatbot now generates rich HTML responses with:

- **📊 Charts**: Bar charts, line charts, pie charts using Chart.js
- **📋 Tables**: Responsive data tables with sorting and formatting
- **🎯 KPI Cards**: Summary cards with metrics and trends
- **📈 Dashboards**: Comprehensive visualizations
- **🎨 Styled Components**: Beautiful, responsive UI elements

### Error Response
```json
{
  "success": true,
  "type": "error",
  "message": "I'm not sure how to help with that. Try asking for \"help\" to see what I can do.",
  "suggestions": [
    "Try: \"show me top 5 products\"",
    "Try: \"what are the sales trends\""
  ]
}
```

## 🔧 Customization

### Adding New Questions
1. Add to `PREDEFINED_QUESTIONS` in `chatbot.service.js`
2. Implement corresponding action in `executeAction` functions
3. Add validation if needed

### Modifying Responses
- Edit the service functions to change data processing
- Modify response formatting in the controller
- Add new response types as needed

### Custom Field Extractors
The smart field extractors can be customized in `FIELD_EXTRACTORS`:
```javascript
// Add custom field priorities
const customLabelFields = ['customName', 'displayName', ...FIELD_EXTRACTORS.getLabelField.priorityFields];
```

## 📊 Performance Tips

1. **Caching**: Consider caching frequent responses
2. **Rate Limiting**: Implement rate limiting for chat endpoints
3. **Error Handling**: Graceful fallbacks for service failures
4. **Logging**: Log user interactions for improvement
5. **Debug Mode**: Use sparingly in production

## 🚨 Troubleshooting

### Common Issues
1. **Service not found**: Check if all services are properly imported
2. **Database connection**: Ensure MongoDB connection is active
3. **Validation errors**: Check request body format
4. **Service errors**: Verify service functions exist and work
5. **HTML generation issues**: Use debug mode to inspect data structure

### Debug Mode
```bash
# Check if chatbot routes are loaded
curl http://localhost:3000/api/v1/chatbot/help

# Test with debug enabled
curl -X POST http://localhost:3000/api/v1/chatbot/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "help", "debug": true}'
```

## 🎉 Demo for Clients

### Quick Demo Questions
1. `show me top 5 products` - Shows product performance
2. `show me top 5 stores` - Shows store performance  
3. `what are the sales trends` - Shows sales analytics
4. `help` - Shows all available commands
5. `what can you do` - Shows chatbot capabilities

### Demo Response Endpoint
Use `/api/v1/chatbot/demo` to get responses for all demo questions at once.

### HTML Demo
Open `chatbot-demo.html` in your browser to see the chatbot HTML responses in action with:
- Interactive charts and graphs
- Responsive data tables
- KPI dashboards
- Beautiful styling and animations

---

**✅ HTML Template Generation Issues Fixed! 🚀**

The chatbot now intelligently extracts field values from any data structure, automatically formats data appropriately, and handles edge cases gracefully. The smart field extractors ensure that charts, tables, and KPIs always display meaningful data regardless of your service response format.

**Key Improvements:**
- 🔍 **Smart Field Detection**: Automatically finds relevant fields
- 📊 **Dynamic Data Processing**: Handles multiple data structures
- 🎨 **Improved Formatting**: Better number, date, and boolean handling
- 🐛 **Debug Mode**: Built-in troubleshooting capabilities
- 🚀 **Robust Fallbacks**: Graceful handling of missing or malformed data
