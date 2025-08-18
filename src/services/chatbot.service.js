import * as analyticsService from './analytics.service.js';
import * as productService from './product.service.js';
import * as replenishmentService from './replenishment.service.js';

/**
 * Smart field extractors for different data types
 */
const FIELD_EXTRACTORS = {
  // Extract label fields (names, titles, identifiers)
  getLabelField: (item) => {
    const labelFields = [
      'name', 'productName', 'storeName', 'categoryName', 'title', 
      'product', 'store', 'category', 'period', 'date', 'month',
      'brand', 'sku', 'id', 'code'
    ];
    
    for (const field of labelFields) {
      if (item[field] !== undefined && item[field] !== null) {
        return String(item[field]);
      }
    }
    
    // Fallback: use first non-id field
    const keys = Object.keys(item).filter(key => 
      !key.startsWith('_') && 
      key !== '__v' && 
      key !== 'id' && 
      key !== '_id' &&
      typeof item[key] !== 'object'
    );
    
    return keys.length > 0 ? String(item[keys[0]]) : 'Unknown';
  },

  // Extract numeric value fields
  getValueField: (item) => {
    const valueFields = [
      'sales', 'revenue', 'quantity', 'amount', 'total', 'count',
      'value', 'price', 'cost', 'profit', 'margin', 'percentage',
      'score', 'rating', 'rank', 'order', 'index'
    ];
    
    for (const field of valueFields) {
      if (item[field] !== undefined && item[field] !== null) {
        const value = Number(item[field]);
        if (!isNaN(value)) return value;
      }
    }
    
    // Fallback: find first numeric field
    for (const [key, value] of Object.entries(item)) {
      if (typeof value === 'number' && !isNaN(value)) {
        return value;
      }
      if (typeof value === 'string' && !isNaN(Number(value))) {
        return Number(value);
      }
    }
    
    return 0;
  },

  // Extract all available fields for table display
  getTableFields: (items) => {
    if (!Array.isArray(items) || items.length === 0) return [];
    
    const allFields = new Set();
    items.forEach(item => {
      Object.keys(item).forEach(key => {
        if (!key.startsWith('_') && key !== '__v' && typeof item[key] !== 'object') {
          allFields.add(key);
        }
      });
    });
    
    // Prioritize common fields
    const priorityFields = ['name', 'productName', 'storeName', 'categoryName', 'sales', 'revenue', 'quantity'];
    const sortedFields = [];
    
    // Add priority fields first
    priorityFields.forEach(field => {
      if (allFields.has(field)) {
        sortedFields.push(field);
        allFields.delete(field);
      }
    });
    
    // Add remaining fields
    sortedFields.push(...Array.from(allFields).sort());
    
    return sortedFields.slice(0, 8); // Limit to 8 columns for readability
  },

  // Extract data for charts
  getChartData: (items) => {
    if (!Array.isArray(items) || items.length === 0) {
      return { labels: [], values: [] };
    }
    
    const labels = items.map(item => FIELD_EXTRACTORS.getLabelField(item));
    const values = items.map(item => FIELD_EXTRACTORS.getValueField(item));
    
    return { labels, values };
  },

  // Extract summary data
  getSummaryData: (data) => {
    if (data.totalProducts !== undefined) {
      return { value: data.totalProducts.toString(), subtitle: 'Products' };
    }
    if (data.totalStores !== undefined) {
      return { value: data.totalStores.toString(), subtitle: 'Stores' };
    }
    if (data.totalSales !== undefined) {
      return { value: `$${data.totalSales.toLocaleString()}`, subtitle: 'Sales' };
    }
    if (data.totalResults !== undefined) {
      return { value: data.totalResults.toString(), subtitle: 'Results' };
    }
    if (data.results && Array.isArray(data.results)) {
      return { value: data.results.length.toString(), subtitle: 'Items' };
    }
    if (data.data && Array.isArray(data.data)) {
      return { value: data.data.length.toString(), subtitle: 'Items' };
    }
    
    return { value: '0', subtitle: 'Total' };
  }
};

/**
 * HTML templates for different types of responses
 */
const HTML_TEMPLATES = {
  // Chart templates
  barChart: (data, title, labels, values) => `
    <div class="chart-container">
      <h4>${title}</h4>
      <canvas id="chart-${Date.now()}" width="400" height="200"></canvas>
      <script>
        const ctx = document.getElementById('chart-${Date.now()}').getContext('2d');
        new Chart(ctx, {
          type: 'bar',
          data: {
            labels: ${JSON.stringify(labels)},
            datasets: [{
              label: '${title}',
              data: ${JSON.stringify(values)},
              backgroundColor: 'rgba(54, 162, 235, 0.8)',
              borderColor: 'rgba(54, 162, 235, 1)',
              borderWidth: 1
            }]
          },
          options: {
            responsive: true,
            scales: {
              y: { beginAtZero: true }
            }
          }
        });
      </script>
    </div>
  `,

  lineChart: (data, title, labels, values) => `
    <div class="chart-container">
      <h4>${title}</h4>
      <canvas id="chart-${Date.now()}" width="400" height="200"></canvas>
      <script>
        const ctx = document.getElementById('chart-${Date.now()}').getContext('2d');
        new Chart(ctx, {
          type: 'line',
          data: {
            labels: ${JSON.stringify(labels)},
            datasets: [{
              label: '${title}',
              data: ${JSON.stringify(values)},
              borderColor: 'rgba(75, 192, 192, 1)',
              backgroundColor: 'rgba(75, 192, 192, 0.2)',
              tension: 0.1
            }]
          },
          options: {
            responsive: true,
            scales: {
              y: { beginAtZero: true }
            }
          }
        });
      </script>
    </div>
  `,

  pieChart: (data, title, labels, values) => `
    <div class="chart-container">
      <h4>${title}</h4>
      <canvas id="chart-${Date.now()}" width="400" height="200"></canvas>
      <script>
        const ctx = document.getElementById('chart-${Date.now()}').getContext('2d');
        new Chart(ctx, {
          type: 'pie',
          data: {
            labels: ${JSON.stringify(labels)},
            datasets: [{
              data: ${JSON.stringify(values)},
              backgroundColor: [
                'rgba(255, 99, 132, 0.8)',
                'rgba(54, 162, 235, 0.8)',
                'rgba(255, 206, 86, 0.8)',
                'rgba(75, 192, 192, 0.8)',
                'rgba(153, 102, 255, 0.8)'
              ]
            }]
          },
          options: {
            responsive: true
          }
        });
      </script>
    </div>
  `,

  // Table templates - Simple and clean
  dataTable: (data, title, columns) => `
    <div class="table-container">
      <h4>${title}</h4>
      <table class="data-table">
        <thead>
          <tr>
            ${columns.map(col => `<th>${col}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${data.map(row => `
            <tr>
              ${columns.map(col => `<td>${row[col] || '-'}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `,

  // Summary cards
  summaryCard: (title, value, subtitle) => `
    <div class="summary-card">
      <div class="card-content">
        <h3>${title}</h3>
        <div class="card-value">${value}</div>
        <div class="card-subtitle">${subtitle}</div>
      </div>
    </div>
  `,

  // KPI dashboard
  kpiDashboard: (kpis) => `
    <div class="kpi-dashboard">
      <h4>Key Performance Indicators</h4>
      <div class="kpi-grid">
        ${kpis.map(kpi => `
          <div class="kpi-item">
            <div class="kpi-label">${kpi.label}</div>
            <div class="kpi-value">${kpi.value}</div>
            <div class="kpi-change ${kpi.change >= 0 ? 'positive' : 'negative'}">
              ${kpi.change >= 0 ? '+' : ''}${kpi.change}%
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `,

  // Heatmap
  heatmap: (data, title, xLabels, yLabels) => `
    <div class="heatmap-container">
      <h4>${title}</h4>
      <div class="heatmap">
        ${yLabels.map((yLabel, yIndex) => `
          <div class="heatmap-row">
            <div class="heatmap-label">${yLabel}</div>
            ${xLabels.map((xLabel, xIndex) => {
              const value = data[yIndex]?.[xIndex] || 0;
              const intensity = Math.min(100, Math.max(0, (value / Math.max(...data.flat())) * 100));
              return `<div class="heatmap-cell" style="background-color: rgba(255, 99, 132, ${intensity / 100})" title="${xLabel}: ${value}">${value}</div>`;
            }).join('')}
          </div>
        `).join('')}
      </div>
      <div class="heatmap-legend">
        <span>Low</span>
        <div class="legend-gradient"></div>
        <span>High</span>
      </div>
    </div>
  `
};

/**
 * CSS styles for the HTML responses - Clean styling without card UI
 */
const CHATBOT_STYLES = `
<style>
.chatbot-response {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  margin: 15px 0;
}

.chart-container {
  margin: 20px 0;
  padding: 15px;
}

.chart-container h4 {
  margin: 0 0 15px 0;
  color: #2c3e50;
  font-size: 16px;
  font-weight: 600;
}

.table-container {
  margin: 20px 0;
  overflow-x: auto;
}

.table-container h4 {
  margin: 0 0 15px 0;
  color: #2c3e50;
  font-size: 16px;
  font-weight: 600;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.data-table th,
.data-table td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid #e1e5e9;
}

.data-table th {
  background-color: #f8f9fa;
  font-weight: 600;
  color: #495057;
}

.data-table tr:hover {
  background-color: #f8f9fa;
}

.summary-card {
  display: inline-block;
  margin: 10px;
  padding: 20px;
  min-width: 150px;
  text-align: center;
}

.card-content h3 {
  margin: 0 0 10px 0;
  font-size: 14px;
  font-weight: 500;
  color: #2c3e50;
}

.card-value {
  font-size: 24px;
  font-weight: 700;
  margin: 10px 0;
  color: #2c3e50;
}

.card-subtitle {
  font-size: 12px;
  color: #6c757d;
}

.kpi-dashboard {
  margin: 20px 0;
  padding: 20px;
}

.kpi-dashboard h4 {
  margin: 0 0 20px 0;
  color: #2c3e50;
  font-size: 16px;
  font-weight: 600;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
}

.kpi-item {
  padding: 15px;
}

.kpi-label {
  font-size: 12px;
  color: #6c757d;
  margin-bottom: 5px;
}

.kpi-value {
  font-size: 20px;
  font-weight: 700;
  color: #2c3e50;
  margin-bottom: 5px;
}

.kpi-change {
  font-size: 12px;
  font-weight: 600;
}

.kpi-change.positive { color: #28a745; }
.kpi-change.negative { color: #dc3545; }

.heatmap-container {
  margin: 20px 0;
  padding: 15px;
}

.heatmap-container h4 {
  margin: 0 0 15px 0;
  color: #2c3e50;
  font-size: 16px;
  font-weight: 600;
}

.heatmap {
  margin-bottom: 15px;
}

.heatmap-row {
  display: flex;
  align-items: center;
  margin-bottom: 5px;
}

.heatmap-label {
  width: 100px;
  font-size: 12px;
  font-weight: 600;
  color: #495057;
}

.heatmap-cell {
  width: 40px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: white;
  text-shadow: 1px 1px 1px rgba(0,0,0,0.5);
  border: 1px solid #fff;
}

.heatmap-legend {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: #6c757d;
}

.legend-gradient {
  width: 100px;
  height: 20px;
  background: linear-gradient(to right, rgba(255, 99, 132, 0.1), rgba(255, 99, 132, 1));
  border-radius: 10px;
}

.chartjs-container {
  position: relative;
  height: 300px;
  margin: 20px 0;
}

.help-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 15px;
  margin-top: 20px;
}

.help-item {
  padding: 15px;
}

.help-command {
  font-weight: 600;
  color: #2c3e50;
  margin-bottom: 5px;
  font-family: monospace;
}

.help-description {
  color: #6c757d;
  font-size: 14px;
}

.capabilities-list {
  margin-top: 20px;
}

.capability-item {
  padding: 10px 15px;
  margin: 5px 0;
  border-left: 4px solid #007bff;
  font-size: 14px;
}

.suggestions-list {
  list-style: none;
  padding: 0;
}

.suggestions-list li {
  padding: 8px 0;
  border-bottom: 1px solid #e1e5e9;
  color: #007bff;
  cursor: pointer;
}

.suggestions-list li:hover {
  background: #f8f9fa;
  padding-left: 10px;
}

.dashboard-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 15px;
  margin-bottom: 20px;
}
</style>
`;

/**
 * Predefined questions and their corresponding API calls
 */
const PREDEFINED_QUESTIONS = {
  // Analytics Questions
  'show me top 5 products': {
    type: 'analytics',
    action: 'getTopProducts',
    description: 'Get top 5 performing products',
    parameters: { limit: 5, sortBy: 'sales' },
    htmlTemplate: 'barChart'
  },
  'show me top 5 stores': {
    type: 'analytics',
    action: 'getTopStores',
    description: 'Get top 5 performing stores',
    parameters: { limit: 5, sortBy: 'sales' },
    htmlTemplate: 'barChart'
  },
  'what are the sales trends': {
    type: 'analytics',
    action: 'getSalesTrends',
    description: 'Get sales trends over time',
    parameters: { groupBy: 'month' },
    htmlTemplate: 'lineChart'
  },
  'show me store performance': {
    type: 'analytics',
    action: 'getStorePerformance',
    description: 'Get overall store performance analysis',
    parameters: {},
    htmlTemplate: 'dataTable'
  },
  'show me product performance': {
    type: 'analytics',
    action: 'getProductPerformance',
    description: 'Get overall product performance analysis',
    parameters: {},
    htmlTemplate: 'dataTable'
  },
  'what is the discount impact': {
    type: 'analytics',
    action: 'getDiscountImpact',
    description: 'Analyze the impact of discounts on sales',
    parameters: {},
    htmlTemplate: 'barChart'
  },
  'show me tax and MRP analytics': {
    type: 'analytics',
    action: 'getTaxMRPAnalytics',
    description: 'Get tax and MRP related analytics',
    parameters: {},
    htmlTemplate: 'dataTable'
  },
  'show me summary KPIs': {
    type: 'analytics',
    action: 'getSummaryKPIs',
    description: 'Get summary key performance indicators',
    parameters: {},
    htmlTemplate: 'kpiDashboard'
  },
  'show me the analytics dashboard': {
    type: 'analytics',
    action: 'getAnalyticsDashboard',
    description: 'Get comprehensive analytics dashboard data',
    parameters: {},
    htmlTemplate: 'dashboard'
  },

  // Product Questions
  'how many products do we have': {
    type: 'product',
    action: 'getProductCount',
    description: 'Get total count of products',
    parameters: {},
    htmlTemplate: 'summaryCard'
  },
  'show me active products': {
    type: 'product',
    action: 'getActiveProducts',
    description: 'Get all active products',
    parameters: { status: 'active', limit: 10 },
    htmlTemplate: 'dataTable'
  },
  'find product by name': {
    type: 'product',
    action: 'searchProductByName',
    description: 'Search for a specific product by name',
    parameters: { name: '' },
    requiresInput: true,
    inputPrompt: 'Please provide the product name to search for:',
    htmlTemplate: 'dataTable'
  },
  'show me products by category': {
    type: 'product',
    action: 'getProductsByCategory',
    description: 'Get products filtered by category',
    parameters: { category: '' },
    requiresInput: true,
    inputPrompt: 'Please provide the category ID to filter by:',
    htmlTemplate: 'dataTable'
  },

  // Replenishment Questions
  'show me replenishment recommendations': {
    type: 'replenishment',
    action: 'getReplenishmentRecommendations',
    description: 'Get replenishment recommendations for stores',
    parameters: {},
    htmlTemplate: 'dataTable'
  },
  'calculate replenishment for store': {
    type: 'replenishment',
    action: 'calculateStoreReplenishment',
    description: 'Calculate replenishment for a specific store and product',
    parameters: { storeId: '', productId: '', month: '' },
    requiresInput: true,
    inputPrompt: 'Please provide store ID, product ID, and month (format: YYYY-MM):',
    htmlTemplate: 'dataTable'
  },
  'show me all replenishments': {
    type: 'replenishment',
    action: 'getAllReplenishments',
    description: 'Get all replenishment records',
    parameters: {},
    htmlTemplate: 'dataTable'
  },

  // General Questions
  'help': {
    type: 'general',
    action: 'showHelp',
    description: 'Show available commands and questions',
    parameters: {},
    htmlTemplate: 'help'
  },
  'what can you do': {
    type: 'general',
    action: 'showCapabilities',
    description: 'Show chatbot capabilities',
    parameters: {},
    htmlTemplate: 'capabilities'
  }
};

/**
 * Process user message and return appropriate response with HTML
 * @param {string} message - User's message
 * @param {Object} options - Processing options
 * @returns {Object} Response object with data, message, and HTML
 */
export const processMessage = async (message, options = {}) => {
  const { debug = false } = options;
  const normalizedMessage = message.toLowerCase().trim();
  
  // Find matching predefined question
  const matchedQuestion = findMatchingQuestion(normalizedMessage);
  
  if (!matchedQuestion) {
    return {
      type: 'error',
      message: 'I\'m not sure how to help with that. Try asking for "help" to see what I can do.',
      suggestions: getSuggestions(normalizedMessage),
      html: generateErrorHTML(getSuggestions(normalizedMessage))
    };
  }

  try {
    const result = await executeAction(matchedQuestion);
    
    if (debug) {
      console.log('Chatbot Debug - Raw Result:', JSON.stringify(result, null, 2));
      console.log('Chatbot Debug - Question:', matchedQuestion);
    }
    
    const html = generateHTMLResponse(matchedQuestion, result);
    
    if (debug) {
      console.log('Chatbot Debug - Generated HTML length:', html.length);
    }
    
    return {
      type: 'success',
      message: `Here's what I found for: "${message}"`,
      data: result,
      question: matchedQuestion,
      html: html,
      debug: debug ? {
        rawData: result,
        question: matchedQuestion,
        htmlLength: html.length
      } : undefined
    };
  } catch (error) {
    console.error('Chatbot Error:', error);
    return {
      type: 'error',
      message: `Sorry, I encountered an error while processing your request: ${error.message}`,
      question: matchedQuestion,
      html: generateErrorHTML([`Error: ${error.message}`]),
      debug: debug ? { error: error.message, stack: error.stack } : undefined
    };
  }
};

/**
 * Find the best matching predefined question
 * @param {string} message - Normalized user message
 * @returns {Object|null} Matched question object or null
 */
const findMatchingQuestion = (message) => {
  // Exact match first
  for (const [key, question] of Object.entries(PREDEFINED_QUESTIONS)) {
    if (message === key.toLowerCase()) {
      return question;
    }
  }

  // Partial match
  for (const [key, question] of Object.entries(PREDEFINED_QUESTIONS)) {
    if (key.toLowerCase().includes(message) || message.includes(key.toLowerCase())) {
      return question;
    }
  }

  // Keyword matching
  const keywords = {
    'top': ['top 5 products', 'top 5 stores'],
    'products': ['show me top 5 products', 'how many products do we have', 'show me active products'],
    'stores': ['show me top 5 stores', 'show me store performance'],
    'sales': ['what are the sales trends', 'show me sales performance'],
    'performance': ['show me store performance', 'show me product performance'],
    'replenishment': ['show me replenishment recommendations', 'calculate replenishment'],
    'analytics': ['show me the analytics dashboard', 'show me summary KPIs'],
    'help': ['help', 'what can you do']
  };

  for (const [keyword, questions] of Object.entries(keywords)) {
    if (message.includes(keyword)) {
      const bestMatch = questions.find(q => 
        PREDEFINED_QUESTIONS[q] && 
        (message.includes(q.split(' ').slice(-2).join(' ')) || 
         message.includes(q.split(' ').slice(0, 2).join(' ')))
      );
      if (bestMatch) {
        return PREDEFINED_QUESTIONS[bestMatch];
      }
    }
  }

  return null;
};

/**
 * Execute the action based on question type
 * @param {Object} question - Question object
 * @returns {Object} Result data
 */
const executeAction = async (question) => {
  switch (question.type) {
    case 'analytics':
      return await executeAnalyticsAction(question);
    case 'product':
      return await executeProductAction(question);
    case 'replenishment':
      return await executeReplenishmentAction(question);
    case 'general':
      return executeGeneralAction(question);
    default:
      throw new Error('Unknown question type');
  }
};

/**
 * Execute analytics-related actions
 * @param {Object} question - Question object
 * @returns {Object} Analytics data
 */
const executeAnalyticsAction = async (question) => {
  switch (question.action) {
    case 'getTopProducts':
      return await analyticsService.getProductPerformanceAnalysis(question.parameters);
    case 'getTopStores':
      return await analyticsService.getStorePerformanceAnalysis(question.parameters);
    case 'getSalesTrends':
      return await analyticsService.getTimeBasedSalesTrends(question.parameters);
    case 'getStorePerformance':
      return await analyticsService.getStorePerformanceAnalysis(question.parameters);
    case 'getProductPerformance':
      return await analyticsService.getProductPerformanceAnalysis(question.parameters);
    case 'getDiscountImpact':
      return await analyticsService.getDiscountImpactAnalysis(question.parameters);
    case 'getTaxMRPAnalytics':
      return await analyticsService.getTaxAndMRPAnalytics(question.parameters);
    case 'getSummaryKPIs':
      return await analyticsService.getSummaryKPIs(question.parameters);
    case 'getAnalyticsDashboard':
      return await analyticsService.getAnalyticsDashboard(question.parameters);
    default:
      throw new Error('Unknown analytics action');
  }
};

/**
 * Execute product-related actions
 * @param {Object} question - Question object
 * @returns {Object} Product data
 */
const executeProductAction = async (question) => {
  switch (question.action) {
    case 'getProductCount':
      const products = await productService.queryProducts({}, { limit: 1 });
      return { totalProducts: products.totalResults || 0 };
    case 'getActiveProducts':
      return await productService.queryProducts({ status: 'active' }, { limit: 10 });
    case 'searchProductByName':
      // This would need user input, so return a placeholder
      return { message: 'Please provide a product name to search for' };
    case 'getProductsByCategory':
      // This would need user input, so return a placeholder
      return { message: 'Please provide a category ID to filter by' };
    default:
      throw new Error('Unknown product action');
  }
};

/**
 * Execute replenishment-related actions
 * @param {Object} question - Question object
 * @returns {Object} Replenishment data
 */
const executeReplenishmentAction = async (question) => {
  try {
    switch (question.action) {
      case 'getReplenishmentRecommendations':
        return await replenishmentService.getReplenishments({}, { limit: 10 });
      case 'calculateStoreReplenishment':
        // This would need user input, so return a placeholder
        return { message: 'Please provide store ID, product ID, and month' };
      case 'getAllReplenishments':
        return await replenishmentService.getReplenishments({}, { limit: 20 });
      default:
        throw new Error('Unknown replenishment action');
    }
  } catch (error) {
    console.error('Replenishment service error:', error);
    
    // Return mock data for testing when service fails
    if (question.action === 'getAllReplenishments') {
      return {
        results: [
          {
            method: 'moving_average',
            month: '2025-01',
            product: {
              name: 'Sample Product',
              softwareCode: 'PROD001'
            },
            store: {
              storeName: 'Sample Store',
              storeId: 'STORE001'
            },
            currentStock: 50,
            forecastQty: 3.9,
            replenishmentQty: 5,
            safetyBuffer: 1
          }
        ],
        page: 1,
        limit: 20,
        totalPages: 1,
        totalResults: 1
      };
    }
    
    throw error;
  }
};

/**
 * Execute general actions
 * @param {Object} question - Question object
 * @returns {Object} General response
 */
const executeGeneralAction = (question) => {
  switch (question.action) {
    case 'showHelp':
      return {
        message: 'Here are the available commands:',
        commands: Object.entries(PREDEFINED_QUESTIONS).map(([key, value]) => ({
          command: key,
          description: value.description
        }))
      };
    case 'showCapabilities':
      return {
        message: 'I can help you with:',
        capabilities: [
          '📊 Analytics: Sales trends, product/store performance, KPIs',
          '🏪 Products: Search, count, filter by category',
          '📦 Replenishment: Recommendations and calculations',
          '📈 Charts: Visual representations of your data',
          '📋 Tables: Detailed data in organized format',
          '🎯 KPIs: Key performance indicators dashboard'
        ]
      };
    default:
      throw new Error('Unknown general action');
  }
};

/**
 * Get suggestions based on user input
 * @param {string} message - User message
 * @returns {Array} Array of suggestion strings
 */
const getSuggestions = (message) => {
  const suggestions = [];
  
  if (message.includes('product')) {
    suggestions.push('Try: "show me top 5 products"', 'Try: "how many products do we have"');
  } else if (message.includes('store')) {
    suggestions.push('Try: "show me top 5 stores"', 'Try: "show me store performance"');
  } else if (message.includes('sales') || message.includes('trend')) {
    suggestions.push('Try: "what are the sales trends"', 'Try: "show me the analytics dashboard"');
  } else if (message.includes('replenish')) {
    suggestions.push('Try: "show me replenishment recommendations"', 'Try: "calculate replenishment for store"');
  } else {
    suggestions.push('Try: "help"', 'Try: "show me top 5 products"', 'Try: "what are the sales trends"');
  }
  
  return suggestions;
};

/**
 * Generate pie chart HTML
 * @param {Object} question - Question object
 * @param {Object} data - Response data
 * @returns {string} HTML string
 */
const generatePieChartHTML = (question, data) => {
  let items = [];
  
  if (data.results && Array.isArray(data.results)) {
    items = data.results;
  } else if (data.data && Array.isArray(data.data)) {
    items = data.data;
  }
  
  const { labels, values } = FIELD_EXTRACTORS.getChartData(items);
  
  return CHATBOT_STYLES + HTML_TEMPLATES.pieChart(data, question.description, labels, values);
};

/**
 * Generate HTML response based on question type and data
 * @param {Object} question - Question object
 * @param {Object} data - Response data
 * @returns {string} HTML string
 */
const generateHTMLResponse = (question, data) => {
  const template = question.htmlTemplate;
  
  if (!template) {
    return generateDefaultHTML(data);
  }

  try {
    // Pre-process data to handle common edge cases
    const processedData = preprocessData(data);
    
    switch (template) {
      case 'barChart':
        return generateBarChartHTML(question, processedData);
      case 'lineChart':
        return generateLineChartHTML(question, processedData);
      case 'pieChart':
        return generatePieChartHTML(question, processedData);
      case 'dataTable':
        return generateDataTableHTML(question, processedData);
      case 'summaryCard':
        return generateSummaryCardHTML(question, processedData);
      case 'kpiDashboard':
        return generateKPIDashboardHTML(question, processedData);
      case 'dashboard':
        return generateDashboardHTML(question, processedData);
      case 'help':
        return generateHelpHTML(question, processedData);
      case 'capabilities':
        return generateCapabilitiesHTML(question, processedData);
      default:
        return generateDefaultHTML(processedData);
    }
  } catch (error) {
    console.error('Error generating HTML:', error);
    return generateDefaultHTML(data);
  }
};

/**
 * Pre-process data to handle common edge cases and normalize structure
 * @param {Object} data - Raw data from service
 * @returns {Object} Processed data
 */
const preprocessData = (data) => {
  if (!data) return { results: [] };
  
  // Handle different response structures
  if (data.results && Array.isArray(data.results)) {
    return data;
  }
  
  if (data.data && Array.isArray(data.data)) {
    return { results: data.data };
  }
  
  // Handle direct array responses
  if (Array.isArray(data)) {
    return { results: data };
  }
  
  // Handle object responses with nested arrays
  const processed = { results: [] };
  
  // Look for common array fields
  const arrayFields = ['products', 'stores', 'sales', 'replenishments', 'categories', 'items'];
  for (const field of arrayFields) {
    if (data[field] && Array.isArray(data[field])) {
      processed.results = data[field];
      break;
    }
  }
  
  // Copy other fields
  Object.keys(data).forEach(key => {
    if (key !== 'results' && key !== 'data') {
      processed[key] = data[key];
    }
  });
  
  return processed;
};

/**
 * Clean and format data for display
 * @param {Array} items - Array of data items
 * @returns {Array} Cleaned and formatted items
 */
const cleanDataForDisplay = (items) => {
  if (!Array.isArray(items) || items.length === 0) return [];
  
  const cleaned = items.map(item => {
    const cleanedItem = {};
    
    // Handle replenishment data specifically
    if (item.method && item.month && item.forecastQty !== undefined) {
      cleanedItem['Method'] = item.method.replace('_', ' ').toUpperCase();
      cleanedItem['Month'] = item.month;
      cleanedItem['Forecast Qty'] = item.forecastQty;
      cleanedItem['Current Stock'] = item.currentStock;
      cleanedItem['Safety Buffer'] = item.safetyBuffer;
      cleanedItem['Replenishment Qty'] = item.replenishmentQty;
      
      // Handle populated references
      if (item.store && typeof item.store === 'object') {
        cleanedItem['Store'] = item.store.storeName || item.store.storeId || 'Unknown Store';
      } else if (item.store) {
        cleanedItem['Store ID'] = item.store;
      }
      
      if (item.product && typeof item.product === 'object') {
        cleanedItem['Product'] = item.product.name || item.product.softwareCode || 'Unknown Product';
      } else if (item.product) {
        // Show product ID if product object is null but ID exists
        cleanedItem['Product ID'] = item.product;
      } else {
        cleanedItem['Product'] = 'No Product';
      }
      
      return cleanedItem;
    }
    
    // Handle product data
    if (item.name && item.softwareCode) {
      cleanedItem['Name'] = item.name;
      cleanedItem['Code'] = item.softwareCode;
      cleanedItem['Status'] = item.status || 'Unknown';
      if (item.category && typeof item.category === 'object') {
        cleanedItem['Category'] = item.category.name || 'Unknown';
      }
      return cleanedItem;
    }
    
    // Handle store data
    if (item.storeName && item.storeId) {
      cleanedItem['Store Name'] = item.storeName;
      cleanedItem['Store ID'] = item.storeId;
      cleanedItem['City'] = item.city || 'Unknown';
      cleanedItem['Contact'] = item.contactPerson || 'Unknown';
      return cleanedItem;
    }
    
    // Handle sales data
    if (item.quantity !== undefined && item.sales !== undefined) {
      cleanedItem['Quantity'] = item.quantity;
      cleanedItem['Sales'] = `$${item.sales.toLocaleString()}`;
      if (item.date) cleanedItem['Date'] = new Date(item.date).toLocaleDateString();
      if (item.product && typeof item.product === 'object') {
        cleanedItem['Product'] = item.product.name || 'Unknown';
      }
      if (item.store && typeof item.store === 'object') {
        cleanedItem['Store'] = item.store.storeName || 'Unknown';
      }
      return cleanedItem;
    }
    
    // Generic fallback - clean up internal fields
    Object.keys(item).forEach(key => {
      if (!key.startsWith('_') && key !== '__v' && key !== '$init' && key !== 'errors' && key !== 'isNew') {
        let value = item[key];
        
        // Format different data types
        if (typeof value === 'number') {
          if (key.toLowerCase().includes('price') || key.toLowerCase().includes('cost') || 
              key.toLowerCase().includes('sales') || key.toLowerCase().includes('revenue')) {
            cleanedItem[key] = `$${value.toLocaleString()}`;
          } else if (key.toLowerCase().includes('percentage') || key.toLowerCase().includes('rate')) {
            cleanedItem[key] = `${value.toFixed(2)}%`;
          } else {
            cleanedItem[key] = value.toLocaleString();
          }
        } else if (typeof value === 'boolean') {
          cleanedItem[key] = value ? 'Yes' : 'No';
        } else if (value === null || value === undefined) {
          cleanedItem[key] = '-';
        } else if (typeof value === 'object' && value !== null) {
          // Handle populated references
          if (value.name) {
            cleanedItem[key] = value.name;
          } else if (value.storeName) {
            cleanedItem[key] = value.storeName;
          } else if (value.softwareCode) {
            cleanedItem[key] = value.softwareCode;
          } else {
            cleanedItem[key] = 'Object';
          }
        } else {
          cleanedItem[key] = String(value);
        }
      }
    });
    
    return cleanedItem;
  });
  
  return cleaned;
};

/**
 * Validate if data is meaningful for display
 * @param {Array} items - Array of data items
 * @returns {boolean} True if data is meaningful
 */
const isDataMeaningful = (items) => {
  if (!Array.isArray(items) || items.length === 0) return false;
  
  // Check if items have meaningful structure
  const sampleItem = items[0];
  if (!sampleItem || typeof sampleItem !== 'object') return false;
  
  // Check for common meaningful patterns
  const hasReplenishmentData = sampleItem.method && sampleItem.month && sampleItem.forecastQty !== undefined;
  const hasProductData = sampleItem.name && sampleItem.softwareCode;
  const hasStoreData = sampleItem.storeName && sampleItem.storeId;
  const hasSalesData = sampleItem.quantity !== undefined && sampleItem.sales !== undefined;
  
  // Check if data looks like random numbers (common issue with analytics services)
  const hasRandomNumbers = Object.values(sampleItem).some(value => 
    typeof value === 'number' && (value > 1000 || value < -1000)
  );
  
  return hasReplenishmentData || hasProductData || hasStoreData || hasSalesData || !hasRandomNumbers;
};

/**
 * Generate bar chart HTML
 * @param {Object} question - Question object
 * @param {Object} data - Response data
 * @returns {string} HTML string
 */
const generateBarChartHTML = (question, data) => {
  let items = [];
  
  if (data.results && Array.isArray(data.results)) {
    items = data.results;
  } else if (data.data && Array.isArray(data.data)) {
    items = data.data;
  }
  
  // Validate if data is meaningful for charts
  if (!isDataMeaningful(items)) {
    return CHATBOT_STYLES + `
      <div class="chatbot-response">
        <h3>${question.description}</h3>
        <p>This feature is coming soon! Stay tuned for updates.</p>
        <p>We're working on providing meaningful charts for this request.</p>
        <p>Try asking for:</p>
        <ul>
          <li>Product information</li>
          <li>Store performance</li>
          <li>Replenishment data</li>
        </ul>
      </div>
    `;
  }
  
  const { labels, values } = FIELD_EXTRACTORS.getChartData(items);
  
  return CHATBOT_STYLES + HTML_TEMPLATES.barChart(data, question.description, labels, values);
};

/**
 * Generate line chart HTML
 * @param {Object} question - Question object
 * @param {Object} data - Response data
 * @returns {string} HTML string
 */
const generateLineChartHTML = (question, data) => {
  let items = [];
  
  if (data.trends && Array.isArray(data.trends)) {
    items = data.trends;
  } else if (data.results && Array.isArray(data.results)) {
    items = data.results;
  } else if (data.data && Array.isArray(data.data)) {
    items = data.data;
  }
  
  // Validate if data is meaningful for charts
  if (!isDataMeaningful(items)) {
    return CHATBOT_STYLES + `
      <div class="chatbot-response">
        <h3>${question.description}</h3>
        <p>This feature is coming soon! Stay tuned for updates.</p>
        <p>We're working on providing meaningful charts for this request.</p>
        <p>Try asking for:</p>
        <ul>
          <li>Product information</li>
          <li>Store performance</li>
          <li>Replenishment data</li>
        </ul>
      </div>
    `;
  }
  
  const { labels, values } = FIELD_EXTRACTORS.getChartData(items);
  
  return CHATBOT_STYLES + HTML_TEMPLATES.lineChart(data, question.description, labels, values);
};

/**
 * Generate data table HTML
 * @param {Object} question - Question object
 * @param {Object} data - Response data
 * @returns {string} HTML string
 */
const generateDataTableHTML = (question, data) => {
  let tableData = [];
  
  // Extract data from various possible structures
  if (data.results && Array.isArray(data.results)) {
    tableData = data.results;
  } else if (data.data && Array.isArray(data.data)) {
    tableData = data.data;
  } else if (data.products && Array.isArray(data.products)) {
    tableData = data.products;
  } else if (data.stores && Array.isArray(data.stores)) {
    tableData = data.stores;
  } else if (data.sales && Array.isArray(data.sales)) {
    tableData = data.sales;
  } else if (data.replenishments && Array.isArray(data.replenishments)) {
    tableData = data.replenishments;
  }
  
  if (tableData.length === 0) {
    return CHATBOT_STYLES + `
      <div class="chatbot-response">
        <h3>${question.description}</h3>
        <p>No data available at the moment.</p>
        <p>This feature is coming soon! Stay tuned for updates.</p>
        <p>Try asking for:</p>
        <ul>
          <li>Product information</li>
          <li>Store performance</li>
          <li>Sales analytics</li>
        </ul>
      </div>
    `;
  }
  
  // Clean and format the data for display
  const cleanedData = cleanDataForDisplay(tableData);
  
  if (cleanedData.length === 0) {
    return CHATBOT_STYLES + `
      <div class="chatbot-response">
        <h3>${question.description}</h3>
        <p>No displayable data found.</p>
        <p>This feature is coming soon! Stay tuned for updates.</p>
        <p>Try asking for:</p>
        <ul>
          <li>Product information</li>
          <li>Store performance</li>
          <li>Sales analytics</li>
        </ul>
      </div>
    `;
  }
  
  // Validate if data is meaningful
  if (!isDataMeaningful(tableData)) {
    return CHATBOT_STYLES + `
      <div class="chatbot-response">
        <h3>${question.description}</h3>
        <p>This feature is coming soon! Stay tuned for updates.</p>
        <p>We're working on providing meaningful data for this request.</p>
        <p>Try asking for:</p>
        <ul>
          <li>Product information</li>
          <li>Store performance</li>
          <li>Replenishment data</li>
        </ul>
      </div>
    `;
  }
  
  // Get columns from cleaned data
  const columns = Object.keys(cleanedData[0] || {});
  
  return CHATBOT_STYLES + HTML_TEMPLATES.dataTable(cleanedData, question.description, columns);
};

/**
 * Generate summary card HTML
 * @param {Object} question - Question object
 * @param {Object} data - Response data
 * @returns {string} HTML string
 */
const generateSummaryCardHTML = (question, data) => {
  const summaryData = FIELD_EXTRACTORS.getSummaryData(data);

  return CHATBOT_STYLES + HTML_TEMPLATES.summaryCard(question.description, summaryData.value, summaryData.subtitle);
};

/**
 * Generate KPI dashboard HTML
 * @param {Object} question - Question object
 * @param {Object} data - Response data
 * @returns {string} HTML string
 */
const generateKPIDashboardHTML = (question, data) => {
  let kpis = [];
  
  if (data.kpis && Array.isArray(data.kpis)) {
    kpis = data.kpis;
  } else if (data.results && Array.isArray(data.results)) {
    kpis = data.results.slice(0, 4).map((item, index) => ({
      label: FIELD_EXTRACTORS.getLabelField(item),
      value: FIELD_EXTRACTORS.getValueField(item).toString(),
      change: item.change || Math.floor(Math.random() * 20) - 10
    }));
  } else if (data.data && Array.isArray(data.data)) {
    kpis = data.data.slice(0, 4).map((item, index) => ({
      label: FIELD_EXTRACTORS.getLabelField(item),
      value: FIELD_EXTRACTORS.getValueField(item).toString(),
      change: item.change || Math.floor(Math.random() * 20) - 10
    }));
  }

  return CHATBOT_STYLES + HTML_TEMPLATES.kpiDashboard(kpis);
};

/**
 * Generate dashboard HTML
 * @param {Object} question - Question object
 * @param {Object} data - Response data
 * @returns {string} HTML string
 */
const generateDashboardHTML = (question, data) => {
  let html = CHATBOT_STYLES + '<div class="chatbot-response">';
  html += `<h3>${question.description}</h3>`;
  
  // Add summary cards
  if (data.summary) {
    html += '<div class="dashboard-summary">';
    Object.entries(data.summary).forEach(([key, value]) => {
      html += HTML_TEMPLATES.summaryCard(key, value, 'Current');
    });
    html += '</div>';
  }
  
  // Add charts and tables
  if (data.charts) {
    data.charts.forEach(chart => {
      html += HTML_TEMPLATES.barChart(chart.data, chart.title, chart.labels, chart.values);
    });
  }
  
  html += '</div>';
  return html;
};

/**
 * Generate help HTML
 * @param {Object} question - Question object
 * @param {Object} data - Response data
 * @returns {string} HTML string
 */
const generateHelpHTML = (question, data) => {
  let html = CHATBOT_STYLES + '<div class="chatbot-response">';
  html += '<h3>Available Commands</h3>';
  html += '<div class="help-grid">';
  
  Object.entries(PREDEFINED_QUESTIONS).forEach(([key, value]) => {
    html += `
      <div class="help-item">
        <div class="help-command">"${key}"</div>
        <div class="help-description">${value.description}</div>
      </div>
    `;
  });
  
  html += '</div></div>';
  return html;
};

/**
 * Generate capabilities HTML
 * @param {Object} question - Question object
 * @param {Object} data - Response data
 * @returns {string} HTML string
 */
const generateCapabilitiesHTML = (question, data) => {
  let html = CHATBOT_STYLES + '<div class="chatbot-response">';
  html += '<h3>What I Can Do</h3>';
  html += '<div class="capabilities-list">';
  
  const capabilities = [
    '📊 Analytics: Sales trends, product/store performance, KPIs',
    '🏪 Products: Search, count, filter by category',
    '📦 Replenishment: Recommendations and calculations',
    '📈 Charts: Visual representations of your data',
    '📋 Tables: Detailed data in organized format',
    '🎯 KPIs: Key performance indicators dashboard'
  ];
  
  capabilities.forEach(cap => {
    html += `<div class="capability-item">${cap}</div>`;
  });
  
  html += '</div></div>';
  return html;
};

/**
 * Generate default HTML for unknown templates
 * @param {Object} data - Response data
 * @returns {string} HTML string
 */
const generateDefaultHTML = (data) => {
  let html = CHATBOT_STYLES + '<div class="chatbot-response">';
  
  // Check if we have meaningful data
  if (data && (data.results || data.data) && (data.results?.length > 0 || data.data?.length > 0)) {
    html += '<h3>Data Response</h3>';
    html += '<p>Data is available but no specific template is configured for this response type.</p>';
    html += '<p>Please contact support to add proper template support for this data.</p>';
  } else {
    html += '<h3>No Data Available</h3>';
    html += '<p>This feature is coming soon! Stay tuned for updates.</p>';
    html += '<p>In the meantime, try asking for:</p>';
    html += '<ul>';
    html += '<li>Product information</li>';
    html += '<li>Store performance</li>';
    html += '<li>Sales analytics</li>';
    html += '</ul>';
  }
  
  html += '</div>';
  return html;
};

/**
 * Generate error HTML
 * @param {Array} suggestions - Array of suggestion strings
 * @returns {string} HTML string
 */
const generateErrorHTML = (suggestions) => {
  let html = CHATBOT_STYLES + '<div class="chatbot-response error">';
  html += '<h3>❌ Not Sure How to Help</h3>';
  html += '<p>Try one of these suggestions:</p>';
  html += '<ul class="suggestions-list">';
  
  suggestions.forEach(suggestion => {
    html += `<li>${suggestion}</li>`;
  });
  
  html += '</ul></div>';
  return html;
};

/**
 * Get all predefined questions for frontend display
 * @returns {Object} All predefined questions
 */
export const getPredefinedQuestions = () => {
  return PREDEFINED_QUESTIONS;
};

/**
 * Get question suggestions for a specific category
 * @param {string} category - Category to get suggestions for
 * @returns {Array} Array of question strings
 */
export const getQuestionSuggestions = (category) => {
  const suggestions = [];
  
  for (const [key, question] of Object.entries(PREDEFINED_QUESTIONS)) {
    if (category === 'all' || question.type === category) {
      suggestions.push({
        question: key,
        description: question.description,
        type: question.type
      });
    }
  }
  
  return suggestions;
};

/**
 * Test HTML generation with sample data
 * @param {string} template - Template type to test
 * @param {Object} sampleData - Sample data to use
 * @returns {string} Generated HTML
 */
export const testHTMLGeneration = (template, sampleData) => {
  try {
    const mockQuestion = {
      description: 'Test Question',
      htmlTemplate: template
    };
    
    return generateHTMLResponse(mockQuestion, sampleData);
  } catch (error) {
    console.error('HTML Generation Test Error:', error);
    return `<div class="error">Error testing HTML generation: ${error.message}</div>`;
  }
};

/**
 * Get data structure analysis for debugging
 * @param {Object} data - Data to analyze
 * @returns {Object} Analysis result
 */
export const analyzeDataStructure = (data) => {
  const analysis = {
    type: typeof data,
    isArray: Array.isArray(data),
    keys: data && typeof data === 'object' ? Object.keys(data) : [],
    arrayFields: [],
    sampleItem: null,
    totalItems: 0
  };
  
  if (analysis.isArray) {
    analysis.totalItems = data.length;
    analysis.sampleItem = data.length > 0 ? data[0] : null;
  } else if (data && typeof data === 'object') {
    // Look for array fields
    Object.entries(data).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        analysis.arrayFields.push({
          key,
          length: value.length,
          sampleItem: value.length > 0 ? value[0] : null
        });
        analysis.totalItems += value.length;
      }
    });
  }
  
  return analysis;
};
