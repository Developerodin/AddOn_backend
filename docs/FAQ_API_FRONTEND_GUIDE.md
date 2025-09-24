# FAQ API Frontend Integration Guide

## Overview

The FAQ API provides intelligent question-answering capabilities with two response types:
1. **AI Tool Responses** - Rich HTML content for analytics and data visualization
2. **FAQ Responses** - Text-based answers from the knowledge base

## API Endpoints

### Base URL
```
http://localhost:4000/v1/faq
```

### Available Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/train-faq` | Train FAQ with question and answer |
| `POST` | `/ask` | Ask a question and get response |
| `GET` | `/` | Get all FAQs with pagination |
| `DELETE` | `/:faqId` | Delete specific FAQ |
| `DELETE` | `/` | Clear all FAQs |

## Making API Calls

### 1. Ask a Question (Main Endpoint)

```javascript
// Example: Ask a question
const askQuestion = async (question) => {
  try {
    const response = await fetch('http://localhost:4000/v1/faq/ask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ question })
    });

    const result = await response.json();
    
    if (response.ok) {
      return result.data; // The actual response data
    } else {
      throw new Error(result.message || 'Failed to get answer');
    }
  } catch (error) {
    console.error('Error asking question:', error);
    throw error;
  }
};
```

### 2. Train FAQ

```javascript
// Example: Train FAQ
const trainFAQ = async (question, answer) => {
  try {
    const response = await fetch('http://localhost:4000/v1/faq/train-faq', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ question, answer })
    });

    const result = await response.json();
    
    if (response.ok) {
      return result.data;
    } else {
      throw new Error(result.message || 'Failed to train FAQ');
    }
  } catch (error) {
    console.error('Error training FAQ:', error);
    throw error;
  }
};
```

## Understanding Response Types

### Response Structure

All API responses follow this structure:
```json
{
  "status": "success",
  "data": {
    "type": "ai_tool" | "faq",
    "response": "string",
    "confidence": "number",
    "source": "string",
    // ... additional fields based on type
  }
}
```

### 1. AI Tool Response (`type: "ai_tool"`)

**When it occurs:** User asks for analytics, reports, dashboards, or data visualization

**Response structure:**
```json
{
  "type": "ai_tool",
  "intent": {
    "action": "getTopProducts",
    "description": "Get top products across all stores",
    "confidence": 0.9
  },
  "response": "<html>...</html>",
  "confidence": 0.9,
  "source": "ai_tool_service"
}
```

**Example questions that trigger AI tools:**
- "Show me top products"
- "Generate a sales report"
- "Create an analytics dashboard"
- "What are the top products in Mumbai?"

### 2. FAQ Response (`type: "faq"`)

**When it occurs:** User asks general questions that match the knowledge base

**Response structure:**
```json
{
  "type": "faq",
  "response": "Text answer from knowledge base",
  "confidence": 0.85,
  "source": "faq_vector_search",
  "originalFAQ": {
    "question": "Original question",
    "answer": "Original answer"
  },
  "similarity": 0.85,
  "topMatches": [...]
}
```

**Example questions that trigger FAQ responses:**
- "How do you prevent stockouts?"
- "What analytics do you provide?"
- "How accurate are your forecasts?"

## Frontend Implementation

### 1. React Component Example

```jsx
import React, { useState } from 'react';

const FAQChat = () => {
  const [question, setQuestion] = useState('');
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleAskQuestion = async () => {
    if (!question.trim()) return;
    
    setLoading(true);
    try {
      const result = await askQuestion(question);
      setResponse(result);
    } catch (error) {
      console.error('Error:', error);
      setResponse({
        type: 'error',
        response: 'Sorry, I encountered an error. Please try again.'
      });
    } finally {
      setLoading(false);
    }
  };

  const renderResponse = () => {
    if (!response) return null;

    switch (response.type) {
      case 'ai_tool':
        return (
          <div className="ai-tool-response">
            <div className="response-header">
              <h4>🤖 AI Tool Response</h4>
              <span className="intent-badge">
                {response.intent.description}
              </span>
              <span className="confidence">
                Confidence: {(response.confidence * 100).toFixed(1)}%
              </span>
            </div>
            
            {/* Render HTML content safely */}
            <div 
              className="html-content"
              dangerouslySetInnerHTML={{ __html: response.response }}
            />
          </div>
        );

      case 'faq':
        return (
          <div className="faq-response">
            <div className="response-header">
              <h4>📚 FAQ Response</h4>
              <span className="confidence">
                Similarity: {(response.confidence * 100).toFixed(1)}%
              </span>
            </div>
            
            <div className="answer">
              {response.response}
            </div>
            
            {response.originalFAQ && (
              <div className="original-faq">
                <small>
                  <strong>Original FAQ:</strong> {response.originalFAQ.question}
                </small>
              </div>
            )}
          </div>
        );

      case 'error':
        return (
          <div className="error-response">
            <p>❌ {response.response}</p>
          </div>
        );

      default:
        return (
          <div className="unknown-response">
            <p>❓ Unknown response type: {response.type}</p>
          </div>
        );
    }
  };

  return (
    <div className="faq-chat">
      <div className="chat-container">
        <div className="chat-messages">
          {renderResponse()}
        </div>
        
        <div className="chat-input">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask me anything..."
            onKeyPress={(e) => e.key === 'Enter' && handleAskQuestion()}
          />
          <button 
            onClick={handleAskQuestion}
            disabled={loading}
          >
            {loading ? 'Thinking...' : 'Ask'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FAQChat;
```

### 2. Vue.js Component Example

```vue
<template>
  <div class="faq-chat">
    <div class="chat-container">
      <div class="chat-messages">
        <div v-if="response" :class="getResponseClass()">
          <!-- AI Tool Response -->
          <div v-if="response.type === 'ai_tool'" class="ai-tool-response">
            <div class="response-header">
              <h4>🤖 AI Tool Response</h4>
              <span class="intent-badge">
                {{ response.intent.description }}
              </span>
              <span class="confidence">
                Confidence: {{ (response.confidence * 100).toFixed(1) }}%
              </span>
            </div>
            
            <div 
              class="html-content"
              v-html="response.response"
            ></div>
          </div>

          <!-- FAQ Response -->
          <div v-else-if="response.type === 'faq'" class="faq-response">
            <div class="response-header">
              <h4>📚 FAQ Response</h4>
              <span class="confidence">
                Similarity: {{ (response.confidence * 100).toFixed(1) }}%
              </span>
            </div>
            
            <div class="answer">
              {{ response.response }}
            </div>
            
            <div v-if="response.originalFAQ" class="original-faq">
              <small>
                <strong>Original FAQ:</strong> {{ response.originalFAQ.question }}
              </small>
            </div>
          </div>

          <!-- Error Response -->
          <div v-else-if="response.type === 'error'" class="error-response">
            <p>❌ {{ response.response }}</p>
          </div>
        </div>
      </div>
      
      <div class="chat-input">
        <input
          v-model="question"
          type="text"
          placeholder="Ask me anything..."
          @keyup.enter="handleAskQuestion"
        />
        <button 
          @click="handleAskQuestion"
          :disabled="loading"
        >
          {{ loading ? 'Thinking...' : 'Ask' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'FAQChat',
  data() {
    return {
      question: '',
      response: null,
      loading: false
    };
  },
  methods: {
    async handleAskQuestion() {
      if (!this.question.trim()) return;
      
      this.loading = true;
      try {
        const result = await this.askQuestion(this.question);
        this.response = result;
      } catch (error) {
        console.error('Error:', error);
        this.response = {
          type: 'error',
          response: 'Sorry, I encountered an error. Please try again.'
        };
      } finally {
        this.loading = false;
      }
    },

    async askQuestion(question) {
      const response = await fetch('http://localhost:4000/v1/faq/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question })
      });

      const result = await response.json();
      
      if (response.ok) {
        return result.data;
      } else {
        throw new Error(result.message || 'Failed to get answer');
      }
    },

    getResponseClass() {
      if (!this.response) return '';
      
      switch (this.response.type) {
        case 'ai_tool': return 'ai-tool-response';
        case 'faq': return 'faq-response';
        case 'error': return 'error-response';
        default: return 'unknown-response';
      }
    }
  }
};
</script>
```

### 3. Vanilla JavaScript Example

```javascript
class FAQChat {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.questionInput = null;
    this.askButton = null;
    this.messagesContainer = null;
    
    this.init();
  }

  init() {
    this.render();
    this.bindEvents();
  }

  render() {
    this.container.innerHTML = `
      <div class="faq-chat">
        <div class="chat-container">
          <div class="chat-messages" id="messages"></div>
          
          <div class="chat-input">
            <input 
              type="text" 
              id="questionInput" 
              placeholder="Ask me anything..."
            />
            <button id="askButton">Ask</button>
          </div>
        </div>
      </div>
    `;

    this.questionInput = document.getElementById('questionInput');
    this.askButton = document.getElementById('askButton');
    this.messagesContainer = document.getElementById('messages');
  }

  bindEvents() {
    this.askButton.addEventListener('click', () => this.handleAskQuestion());
    this.questionInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleAskQuestion();
    });
  }

  async handleAskQuestion() {
    const question = this.questionInput.value.trim();
    if (!question) return;

    this.askButton.textContent = 'Thinking...';
    this.askButton.disabled = true;

    try {
      const result = await this.askQuestion(question);
      this.displayResponse(result);
    } catch (error) {
      console.error('Error:', error);
      this.displayResponse({
        type: 'error',
        response: 'Sorry, I encountered an error. Please try again.'
      });
    } finally {
      this.askButton.textContent = 'Ask';
      this.askButton.disabled = false;
      this.questionInput.value = '';
    }
  }

  async askQuestion(question) {
    const response = await fetch('http://localhost:4000/v1/faq/ask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ question })
    });

    const result = await response.json();
    
    if (response.ok) {
      return result.data;
    } else {
      throw new Error(result.message || 'Failed to get answer');
    }
  }

  displayResponse(response) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `response-message ${response.type}-response`;

    switch (response.type) {
      case 'ai_tool':
        messageDiv.innerHTML = `
          <div class="response-header">
            <h4>🤖 AI Tool Response</h4>
            <span class="intent-badge">${response.intent.description}</span>
            <span class="confidence">Confidence: ${(response.confidence * 100).toFixed(1)}%</span>
          </div>
          <div class="html-content">${response.response}</div>
        `;
        break;

      case 'faq':
        messageDiv.innerHTML = `
          <div class="response-header">
            <h4>📚 FAQ Response</h4>
            <span class="confidence">Similarity: ${(response.confidence * 100).toFixed(1)}%</span>
          </div>
          <div class="answer">${response.response}</div>
          ${response.originalFAQ ? `
            <div class="original-faq">
              <small><strong>Original FAQ:</strong> ${response.originalFAQ.question}</small>
            </div>
          ` : ''}
        `;
        break;

      case 'error':
        messageDiv.innerHTML = `<p>❌ ${response.response}</p>`;
        break;

      default:
        messageDiv.innerHTML = `<p>❓ Unknown response type: ${response.type}</p>`;
    }

    this.messagesContainer.appendChild(messageDiv);
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }
}

// Usage
const chat = new FAQChat('faq-chat-container');
```

## CSS Styling

```css
.faq-chat {
  max-width: 800px;
  margin: 0 auto;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.chat-container {
  border: 1px solid #e1e5e9;
  border-radius: 8px;
  overflow: hidden;
}

.chat-messages {
  height: 400px;
  overflow-y: auto;
  padding: 20px;
  background-color: #f8f9fa;
}

.chat-input {
  display: flex;
  padding: 15px;
  background-color: white;
  border-top: 1px solid #e1e5e9;
}

.chat-input input {
  flex: 1;
  padding: 10px 15px;
  border: 1px solid #ddd;
  border-radius: 4px;
  margin-right: 10px;
}

.chat-input button {
  padding: 10px 20px;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.chat-input button:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
}

/* Response Styling */
.response-message {
  margin-bottom: 20px;
  padding: 15px;
  border-radius: 8px;
  background-color: white;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.response-header {
  margin-bottom: 15px;
  padding-bottom: 10px;
  border-bottom: 1px solid #e1e5e9;
}

.response-header h4 {
  margin: 0 0 10px 0;
  color: #2c3e50;
}

.intent-badge {
  display: inline-block;
  padding: 4px 8px;
  background-color: #28a745;
  color: white;
  border-radius: 12px;
  font-size: 12px;
  margin-right: 10px;
}

.confidence {
  color: #6c757d;
  font-size: 14px;
}

/* AI Tool Response */
.ai-tool-response {
  border-left: 4px solid #007bff;
}

.html-content {
  background-color: #f8f9fa;
  padding: 15px;
  border-radius: 6px;
  overflow-x: auto;
}

/* FAQ Response */
.faq-response {
  border-left: 4px solid #28a745;
}

.answer {
  line-height: 1.6;
  color: #2c3e50;
}

.original-faq {
  margin-top: 10px;
  padding: 10px;
  background-color: #e9ecef;
  border-radius: 4px;
  color: #6c757d;
}

/* Error Response */
.error-response {
  border-left: 4px solid #dc3545;
  color: #dc3545;
}

/* Loading State */
.loading {
  text-align: center;
  color: #6c757d;
  font-style: italic;
}
```

## Key Points for Frontend Developers

### 1. **Response Type Detection**
- Always check `response.type` first
- `ai_tool` = HTML content, `faq` = text content

### 2. **HTML Content Handling**
- Use `dangerouslySetInnerHTML` (React) or `v-html` (Vue) for AI tool responses
- The HTML is pre-styled and ready for display
- No need to parse or modify the HTML content

### 3. **Confidence Display**
- AI tools: Show intent description and confidence
- FAQ responses: Show similarity score and original question

### 4. **Error Handling**
- Always wrap API calls in try-catch
- Show user-friendly error messages
- Handle network errors gracefully

### 5. **Loading States**
- Show loading indicators during API calls
- Disable input while processing
- Provide visual feedback

### 6. **Response Formatting**
- AI tool responses are rich HTML with charts/tables
- FAQ responses are plain text with metadata
- Both include confidence scores for user trust

## Testing the API

You can test the API endpoints using the provided test file:

```bash
node test-faq.js
```

This will test all functionality and show you the expected response formats.

## Production Considerations

1. **Environment Variables**: Use different base URLs for dev/staging/prod
2. **Error Logging**: Implement proper error logging and monitoring
3. **Rate Limiting**: Handle API rate limiting gracefully
4. **Caching**: Consider caching FAQ responses for better performance
5. **Security**: Validate and sanitize user inputs before sending to API

The API is designed to be frontend-friendly with clear response types and comprehensive metadata for optimal user experience.
