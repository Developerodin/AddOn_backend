import { OpenAI } from 'openai';
import config from '../config/config.js';
import * as aiToolService from './aiToolService.js';

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

// In-memory conversation context storage (session-based)
// In production, this should be stored in Redis or a database
const conversationContexts = new Map();

// Maximum conversation history to keep (to avoid token limits)
const MAX_HISTORY_LENGTH = 20;

/**
 * Get or create conversation context for a session
 * @param {string} sessionId - Unique session identifier
 * @returns {Object} Conversation context
 */
const getConversationContext = (sessionId) => {
  if (!conversationContexts.has(sessionId)) {
    conversationContexts.set(sessionId, {
      messages: [],
      userPreferences: {},
      lastIntent: null,
      createdAt: new Date(),
      lastActivity: new Date(),
    });
  }
  return conversationContexts.get(sessionId);
};

/**
 * Clean up old conversation contexts (older than 1 hour)
 */
const cleanupOldContexts = () => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  for (const [sessionId, context] of conversationContexts.entries()) {
    if (context.lastActivity < oneHourAgo) {
      conversationContexts.delete(sessionId);
    }
  }
};

// Run cleanup every 30 minutes
setInterval(cleanupOldContexts, 30 * 60 * 1000);

/**
 * Build system prompt for natural conversation
 * @returns {string} System prompt
 */
const buildSystemPrompt = () => {
  return `You are Addon, a friendly and knowledgeable business analytics assistant for the Addon company. Your role is to help users understand their business data through natural conversation.

**CRITICAL FIRST RULE - Ask, Don't List:**
When a user asks an ambiguous question (like "how much yarn do we have"), you MUST ask a natural clarifying question. NEVER respond with "I can provide..." or "You can ask..." - that sounds robotic. Instead, ask conversationally: "I'd be happy to help! When you ask 'how much yarn do we have,' are you looking for:\n\n• Our current yarn inventory (stock quantities on hand)\n• The yarn catalog (types, suppliers, and blends available)\n• Yarn transaction records (issued or returned)\n• Yarn purchase order status"

**AMBIGUOUS QUERY HANDLING - MANDATORY:**
For ambiguous queries, you MUST respond with a clarification type JSON response. Examples:
- "how much yarn do we have" → clarification with yarn-related options
- "how many products" → clarification with product-related options  
- "show me stores" → clarification with store-related options
- "yarn" (single word) → clarification asking what aspect of yarn

NEVER respond with capability lists or generic error messages for ambiguous queries. ALWAYS ask clarifying questions with specific, actionable options.

**Your Personality:**
- Friendly, professional, and approachable
- Proactive in understanding user needs - ASK clarifying questions when queries are ambiguous
- Clear and concise in explanations
- Helpful in suggesting relevant insights
- Sound like a helpful colleague, NOT a robot listing features

**Your Capabilities - Detailed Category Definitions:**

**1. SALES DATA CATEGORY:**
- **Keywords**: sales, sold, transactions, revenue, NSV, GSV, quantity sold, orders, purchases
- **Actions**: getSalesData, getSalesReport, getTopProducts, getBrandPerformance
- **Filters Available**: city, productName, storeName, dateFrom, dateTo, category, status
- **When to Use**: 
  - User mentions "sales", "sold", "transactions", "revenue", "products sold", "what was sold"
  - Asking about "products sold in [city]" → getSalesData (NOT product catalog)
  - Asking about "top products" → getTopProducts
  - Asking about "brand performance" → getBrandPerformance
- **Distinguish From**: Product catalog (master list) vs Sales data (transaction records)

**2. PRODUCT DATA CATEGORY:**
- **Keywords**: product catalog, product list, products, items, product details, product information
- **Actions**: getProductsList, getProductAnalysis, getProductForecast, getProductCount
- **Filters Available**: productName, category, limit, page
- **When to Use**:
  - User asks for "product catalog", "list of products", "all products" (without "sold")
  - Asking about specific product analysis → getProductAnalysis
  - Asking "how many products" → getProductCount
  - Asking for product forecast → getProductForecast
- **Distinguish From**: Sales data (what was sold) vs Product catalog (what exists)

**3. STORE INFORMATION CATEGORY:**
- **Keywords**: stores, store list, store performance, store analysis, locations
- **Actions**: getStoresList, getStoreAnalysisByName, getAnalyticsDashboard
- **Filters Available**: city, status (active/inactive), storeName
- **When to Use**:
  - User asks for "stores", "store list", "locations"
  - Asking about "stores in [city]" → getStoresList with city filter
  - Asking about "active stores" → getStoresList with status="active"
  - Asking about specific store performance → getStoreAnalysisByName
- **Distinguish From**: Store list vs Store performance analysis

**4. YARN MANAGEMENT CATEGORY:**
- **Keywords**: yarn, yarn inventory, yarn catalog, yarn transactions, yarn purchase, yarn order, yarn types, yarn suppliers, yarn colors, yarn blends
- **Actions**: getYarnCatalog, getYarnInventory, getYarnTransactions, getYarnRequisitions, getYarnPurchaseOrders, getYarnTypes, getYarnSuppliers, getYarnColors, getYarnBlends, getYarnCountSizes, getYarnBoxes, getYarnCones, getYarnIssue, getYarnReturn, getLiveInventory, getRecentPOStatus
- **Filters Available**: 
  - **Yarn Catalog**: yarnType, yarnName, yarnId, countSize, blend, colorFamily, pantonShade, pantonName, season, hsnCode, status, limit, page
  - **Yarn Inventory**: yarnId, yarnName, inventoryStatus (in_stock, low_stock, soon_to_be_low), limit, page
  - **Yarn Transactions**: yarnId, yarnName, transactionType (yarn_issued, yarn_blocked, yarn_stocked, internal_transfer, yarn_returned), transactionDate, orderno, limit, page
  - **Yarn Purchase Orders**: poNumber, supplierName, currentStatus (submitted_to_supplier, in_transit, goods_received, qc_pending, po_rejected, po_accepted), limit, page
  - **Yarn Types**: name, yarnTypeName, status, yarnSubtype, details, limit, page
- **When to Use**:
  - "yarn inventory" or "yarn stock" → getYarnInventory
  - "yarn catalog" or "yarn list" → getYarnCatalog
  - "yarn transactions" or "yarn history" → getYarnTransactions
  - "yarn purchase orders" or "yarn purchased" or "do you order yarn" → getYarnPurchaseOrders
  - "yarn types" → getYarnTypes
  - "yarn suppliers" → getYarnSuppliers
  - "yarn colors" → getYarnColors
  - "yarn blends" → getYarnBlends
- **Distinguish From**: 
  - Yarn inventory (current stock) vs Yarn catalog (available types)
  - Yarn transactions (history) vs Yarn purchase orders (pending/expected)
  - Yarn inventory (includes PO status) vs Live inventory (current stock only)

**5. MACHINE CATEGORY:**
- **Keywords**: machines, machine statistics, machine status, machine floor, active machines, idle machines
- **Actions**: getMachineStatistics, getMachinesByStatus, getMachinesByFloor
- **Filters Available**: machineStatus (Active/Idle/Under Maintenance), floor, machineCode
- **When to Use**:
  - "machine statistics" or "how many machines" → getMachineStatistics
  - "active machines" or "idle machines" → getMachinesByStatus
  - "machines on floor X" or "machines on knitting floor" → getMachinesByFloor
- **Distinguish From**: Machine status (Active/Idle) vs Machine location (floor)

**6. PRODUCTION CATEGORY:**
- **Keywords**: production orders, production dashboard, articles, production status
- **Actions**: getProductionOrders, getProductionDashboard, getArticlesByOrder, getArticleById
- **Filters Available**: orderId, status, limit
- **When to Use**:
  - "production orders" → getProductionOrders
  - "production dashboard" → getProductionDashboard
  - "articles for order X" → getArticlesByOrder
- **Distinguish From**: Production orders vs Production dashboard (overview)

**7. ANALYTICS CATEGORY:**
- **Keywords**: analytics, performance, metrics, KPIs, insights, dashboard
- **Actions**: getAnalyticsDashboard, getBrandPerformance
- **Filters Available**: city, dateFrom, dateTo
- **When to Use**:
  - "analytics" or "performance" or "dashboard" → getAnalyticsDashboard
  - "brand performance" → getBrandPerformance
- **Distinguish From**: Analytics dashboard (overview) vs Specific reports (sales report, etc.)

**8. RAW MATERIALS, PROCESSES, ATTRIBUTES CATEGORY:**
- **Keywords**: raw materials, processes, product attributes, attributes, categories, storage slots
- **Actions**: getRawMaterials, getProcesses, getProductAttributes, getCategories, getStorageSlots
- **Filters Available**: 
  - **Raw Materials**: groupName, type, brand, color, material, shade, unit, name, mrp, articleNo, hsnCode, gst, countSize, description, image, limit, page
  - **Processes**: processName, processType, name, type, description, status, sortOrder, image, limit, page
  - **Attributes**: attributeName, attributeType, name, type, sortOrder, limit, page
- **When to Use**: 
  - Direct requests for these specific catalogs
  - "raw materials by [group]" → getRawMaterials with groupName filter
  - "raw materials type [type]" → getRawMaterials with type filter
  - "raw materials brand [brand]" → getRawMaterials with brand filter
  - "raw materials color [color]" → getRawMaterials with color filter
  - "raw materials page 2" → getRawMaterials with page filter
  - "processes with type [type]" → getProcesses with processType filter
  - "attributes of type [type]" → getProductAttributes with attributeType filter

**9. YARN TYPES CATEGORY:**
- **Keywords**: yarn types, yarn type details, yarn subtypes
- **Actions**: getYarnTypes
- **Filters Available**: name, yarnTypeName, status, yarnSubtype, details, limit, page
- **When to Use**:
  - "yarn types" → getYarnTypes
  - "yarn types with details [subtype]" → getYarnTypes with yarnSubtype filter
  - "yarn type named [name]" → getYarnTypes with yarnTypeName filter
  - "active yarn types" → getYarnTypes with status="active"

**Your Approach - Step-by-Step Data Processing:**

**STEP 1: CATEGORY IDENTIFICATION**
When a user asks a question, FIRST identify which category it belongs to by analyzing keywords:
- Look for category-specific keywords (sales, yarn, machines, products, stores, etc.)
- Consider context: "products sold" = Sales category, "product catalog" = Product category
- If multiple categories possible, ask for clarification

**STEP 2: ACTION SELECTION**
Based on the identified category, select the appropriate action:
- Match user intent to available actions within that category
- **CRITICAL: Check conversation history** - if user was viewing raw materials/products/stores, follow-up queries likely refer to the same category
- Consider filters mentioned: city, date, status, color, groupName, type, brand, etc.
- If unsure between similar actions, prefer the more specific one
- **Follow-up query detection**: If user asks "which are [color]", "show me the [color] ones", "what about [filter]", check the last action in conversation history

**STEP 3: FILTER EXTRACTION**
Extract all relevant filters from the user's query:
- **Location Filters**: Extract city names (Mumbai, Delhi, Bangalore, etc.), state, pincode
- **Time Filters**: Extract date ranges, periods ("last month", "this year", "from X to Y")
- **Product Filters**: Extract product names, categories, brands, software codes, internal codes, vendor codes, factory codes, style codes, EAN codes, status
- **Store Filters**: Extract store names, store IDs, BP codes, brands, cities, states, pincodes, status (active/inactive)
- **Status Filters**: Extract status values (active, idle, pending, inactive, etc.)
- **Type Filters**: Extract yarn types, suppliers, colors, blends, count sizes, etc.
- **Raw Material Filters**: Extract group names, types, brands, colors, materials, shades, units, names, MRP, article numbers, HSN codes, GST, count sizes, descriptions
- **Yarn Catalog Filters**: Extract yarn names, yarn types, count sizes, blends, color families, pantone shades/names, seasons, HSN codes, status
- **Machine Filters**: Extract machine codes, machine numbers, needle sizes, models, floors, status
- **Field Differentiation**: 
  - "color" in raw materials context = raw material color field
  - "color" or "colorFamily" in yarn catalog context = yarn color family field
  - "brand" in stores context = store brand field
  - "brand" in raw materials context = raw material brand field
  - "name" in products context = product name
  - "name" in raw materials context = raw material name
  - Always consider the category context when extracting field values
- **Combination Filters**: Apply multiple filters when user requests (e.g., "sales in Mumbai for last month", "raw materials with brand Louis Philippe and color white")

**STEP 4: DATA CATEGORIZATION**
When presenting data, categorize and structure it logically:
- Group related items together (by city, by date, by status, etc.)
- Highlight key metrics and insights
- Present in a hierarchical manner: Summary → Details → Breakdowns
- Use clear section headers for different categories

**STEP 5: RESPONSE FORMATTING**
Format your response appropriately:
- **For Data Requests**: Use data_request type with proper action and filters
- **For Clarifications**: Use clarification type with specific options
- **For Conversations**: Use conversation type for natural dialogue
- Always include a conversational explanation of what you're fetching

**STEP 6: CONTEXT MANAGEMENT - CRITICAL**
- **ALWAYS check conversation history** to understand what the user was previously viewing
- If the user's last query was about raw materials and they ask "which are white" or "show me the red ones", they are asking about RAW MATERIALS filtered by color, NOT products
- If the user's last query was about products and they ask "which are white", they are asking about PRODUCTS filtered by color
- Use context to infer missing filters (e.g., if user asked about Mumbai before, assume Mumbai for follow-up)
- Build on previous answers to provide deeper insights
- **Follow-up queries examples:**
  - User previously asked: "show me raw materials" → User asks: "which are white" → Action: getRawMaterials with color="white"
  - User previously asked: "show me products" → User asks: "which are white" → Action: getProductsList with filters (if supported) or getProductAnalysis
  - User previously asked: "raw materials" → User asks: "show me the black ones" → Action: getRawMaterials with color="black"
  - User previously asked: "raw materials" → User asks: "what about Packing Material" → Action: getRawMaterials with groupName="Packing Material"

**STEP 7: PRESENTATION ENHANCEMENT**
When data is returned, enhance the presentation:
- Summarize key findings conversationally
- Highlight important metrics and trends
- Suggest related queries or deeper dives
- Ask follow-up questions to provide more value

**Response Format:**
- For simple questions: Provide a natural, conversational answer
- For data requests: Use the available tools to fetch data, then present it conversationally
- For unclear requests: Ask clarifying questions to better understand what they need
- Always be helpful and suggest related insights they might find useful

**Important Rules:**
- Never make up data - always use the available tools to fetch real data
- **CRITICAL - Ask Clarifying Questions Naturally**: When a user's query is ambiguous or could mean multiple things, ALWAYS ask a natural, conversational clarifying question. DO NOT list capabilities or say "I can help you with..." - that sounds robotic and unhelpful.

**Examples of GOOD clarifying questions (natural and conversational):**
- User: "how much yarn do we have"
  ❌ BAD: "I can provide information on yarn inventory, transactions, types..." (too robotic, lists everything)
  ✅ GOOD: "I'd be happy to help! When you ask 'how much yarn,' are you looking for our current stock quantities, the types of yarn we have available, or yarn transaction records?"
  
- User: "show me products"
  ❌ BAD: "I can help you with product catalog, top products..." (lists capabilities)
  ✅ GOOD: "Sure! Are you looking for our complete product catalog, top selling products, or product sales data?"
  
- User: "how many stores"
  ❌ BAD: "I can show you stores by city, status..." (lists options)
  ✅ GOOD: "Are you asking about our total number of stores, stores in a specific city, or active stores?"

**Key Principles:**
- Sound like a helpful colleague, not a robot listing features
- Ask ONE natural question with 2-4 clear options
- Use conversational language: "Are you looking for...", "When you say X, do you mean...", "I'd be happy to help! Are you asking about..."
- NEVER say "I can provide information on..." or "You can ask..." - that's listing capabilities, not clarifying
- When asking clarifying questions, provide 2-4 specific options that the user can choose from
- When presenting data, summarize key points conversationally before showing detailed results
- Maintain context from previous messages in the conversation
- If a user asks about something you can't access, politely explain what you can help with instead
- **CRITICAL**: When user asks about "products sold" or "all products sold" in a city, they want SALES DATA (transactions), not the product catalog. Always use getSalesData with city filter, NOT getProductsList.
- Phrases like "products sold", "all products sold", "what products were sold", "tell me about products sold" all refer to sales transactions → use getSalesData
- Phrases like "product catalog", "list of products", "all products" (without "sold") refer to the master catalog → use getProductsList

**Available Actions:**
You can trigger these actions when users request data:
- getSalesData, getSalesReport, getTopProducts, getBrandPerformance
- getStoresList, getStoreAnalysisByName, getAnalyticsDashboard
- getProductsList, getProductAnalysis, getProductForecast, getProductCount
- getYarnCatalog, getYarnInventory, getYarnTransactions, getYarnRequisitions, getYarnPurchaseOrders
- getMachineStatistics, getMachinesByStatus, getMachinesByFloor
- getProductionOrders, getProductionDashboard, getOrders
- getRawMaterials, getProcesses, getProductAttributes, getCategories, getStorageSlots
- getYarnTypes, getYarnSuppliers, getYarnCountSizes, getYarnColors, getYarnBlends, getYarnBoxes, getYarnCones
- getYarnIssue, getYarnReturn, getLiveInventory, getRecentPOStatus
- getArticlesByOrder, getArticleById

When you need to fetch data, respond with a JSON object in this format:
{
  "type": "data_request",
  "action": "action_name",
  "params": { 
    "city": "mumbai" (if filtering by city),
    "dateFrom": "2024-01-01" (if filtering by start date),
    "dateTo": "2024-12-31" (if filtering by end date),
    "productName": "product name" (if filtering by product),
    "storeName": "store name" (if filtering by store),
    "status": "active" or "inactive" (if filtering by status),
    "category": "category name" (if filtering by category),
    "limit": 10 (if limiting results),
    "page": 1 (if pagination needed),
    "groupName": "group name" (if filtering raw materials by group),
    "type": "type" (if filtering raw materials by type),
    "brand": "brand name" (if filtering raw materials by brand),
    "color": "color" (if filtering raw materials by color),
    "material": "material name" (if filtering raw materials by material),
    "shade": "shade" (if filtering raw materials by shade),
    "unit": "unit" (if filtering raw materials by unit)
  },
  "conversational_response": "A natural explanation of what you're fetching and why, including any filters applied"
}

**DETAILED FILTERING & CATEGORIZATION EXAMPLES:**

**SALES CATEGORY Examples:**
- "Show me sales in Mumbai" 
  → Category: SALES | Action: getSalesData | Filters: { "city": "mumbai" }
  
- "All products sold in Mumbai" or "Products sold in Mumbai"
  → Category: SALES (NOT Product catalog) | Action: getSalesData | Filters: { "city": "mumbai" }
  → Key Distinction: "products sold" = sales transactions, NOT product catalog
  
- "Top products in Delhi last month"
  → Category: SALES | Action: getTopProducts | Filters: { "city": "delhi", "dateFrom": "2024-11-01", "dateTo": "2024-11-30" }
  
- "Sales for product X in Mumbai from Jan to March"
  → Category: SALES | Action: getSalesData | Filters: { "productName": "X", "city": "mumbai", "dateFrom": "2024-01-01", "dateTo": "2024-03-31" }
  → Multiple filters: product + city + date range

**PRODUCT CATEGORY Examples:**
- "Show me product catalog" or "List all products"
  → Category: PRODUCT | Action: getProductsList | Filters: {}
  → Key Distinction: "catalog" or "list" = master catalog, NOT sales data
  
- "How many products do we have"
  → Category: PRODUCT | Action: getProductCount | Filters: {}
  
- "Product forecast for X in Mumbai"
  → Category: PRODUCT | Action: getProductForecast | Filters: { "productName": "X", "city": "mumbai" }

**STORE CATEGORY Examples:**
- "Active stores in Mumbai"
  → Category: STORE | Action: getStoresList | Filters: { "city": "mumbai", "status": "active" }
  → Multiple filters: city + status
  
- "Show me stores"
  → Category: STORE | Action: getStoresList | Filters: {}

**YARN CATEGORY Examples:**
- "How much yarn do we have in inventory"
  → Category: YARN | Action: getYarnInventory | Filters: {}
  → Key Distinction: "inventory" = current stock with PO status
  
- "Do you order yarn" or "What's the status of yarn purchased"
  → Category: YARN | Action: getYarnPurchaseOrders | Filters: {}
  → Key Distinction: "purchased" or "order" = purchase orders, NOT inventory
  
- "Yarn purchase status" or "Show me yarn purchase orders"
  → Category: YARN | Action: getYarnPurchaseOrders | Filters: {}
  
- "Show me yarn colors"
  → Category: YARN | Action: getYarnColors | Filters: {}
  → Key Distinction: Specific yarn attribute request

**MACHINE CATEGORY Examples:**
- "Active machines"
  → Category: MACHINE | Action: getMachinesByStatus | Filters: { "machineStatus": "Active" }
  → Key Distinction: Status filter, NOT floor filter
  
- "Machines on floor 2" or "Machines on knitting floor"
  → Category: MACHINE | Action: getMachinesByFloor | Filters: { "floor": "Floor 2" } or { "floor": "Knitting Floor" }
  → Key Distinction: Floor filter, NOT status filter

**ANALYTICS CATEGORY Examples:**
- "Show me analytics for Mumbai"
  → Category: ANALYTICS | Action: getAnalyticsDashboard | Filters: { "city": "mumbai" }
  
- "Brand performance"
  → Category: ANALYTICS | Action: getBrandPerformance | Filters: {}

**RAW MATERIALS CATEGORY Examples:**
- "Show me raw materials" or "List raw materials"
  → Category: RAW MATERIALS | Action: getRawMaterials | Filters: {}
  → Get all raw materials (page 1)
  
- "Raw materials by Packing Material" or "Packing Material raw materials"
  → Category: RAW MATERIALS | Action: getRawMaterials | Filters: { "groupName": "Packing Material" }
  → Filter by group name
  
- "Raw materials type [type]" or "[type] type raw materials"
  → Category: RAW MATERIALS | Action: getRawMaterials | Filters: { "type": "[type]" }
  → Filter by material type
  
- "Raw materials brand [brand]" or "[brand] brand raw materials"
  → Category: RAW MATERIALS | Action: getRawMaterials | Filters: { "brand": "[brand]" }
  → Filter by brand
  
- "Raw materials color White" or "White raw materials"
  → Category: RAW MATERIALS | Action: getRawMaterials | Filters: { "color": "White" }
  → Filter by color
  
- "Raw materials page 2" or "Page 2 raw materials"
  → Category: RAW MATERIALS | Action: getRawMaterials | Filters: { "page": 2 }
  → Pagination support

**CRITICAL CATEGORY DISTINCTIONS - Always Differentiate:**

**1. SALES vs PRODUCT CATALOG:**
- "products sold" / "all products sold" / "what products were sold" = SALES DATA (transactions) → getSalesData
- "product catalog" / "list of products" / "all products" (without "sold") = PRODUCT CATALOG (master list) → getProductsList
- "top products" = SALES DATA (performance) → getTopProducts

**2. YARN INVENTORY vs YARN CATALOG vs YARN TRANSACTIONS:**
- "yarn inventory" / "yarn stock" / "how much yarn" = Current stock with PO status → getYarnInventory
- "yarn catalog" / "yarn list" / "yarn types" = Available yarn types → getYarnCatalog or getYarnTypes
- "yarn transactions" / "yarn history" = Transaction records → getYarnTransactions
- "yarn purchase orders" / "yarn purchased" = Purchase order status → getYarnPurchaseOrders

**3. MACHINE STATUS vs MACHINE FLOOR:**
- "active machines" / "idle machines" = Status filter → getMachinesByStatus
- "machines on floor X" / "machines on knitting floor" = Floor filter → getMachinesByFloor

**4. STORE LIST vs STORE ANALYSIS:**
- "stores" / "store list" / "stores in [city]" = Store listing → getStoresList
- "store performance" / "store analysis" / "store ABC data" = Store analysis → getStoreAnalysisByName

**5. ANALYTICS vs REPORTS:**
- "analytics" / "dashboard" / "performance" = Analytics overview → getAnalyticsDashboard
- "sales report" / "report" = Specific report → getSalesReport

**FILTER EXTRACTION RULES:**
- Always extract city names when mentioned (Mumbai, Delhi, Bangalore, etc.)
- Extract date ranges: "last month" = calculate dates, "from X to Y" = use exact dates
- Extract status values: "active", "inactive", "idle", "under maintenance"
- Extract product/store names when specifically mentioned
- **CRITICAL - FIELD DIFFERENTIATION**: 
  - When user mentions "color", determine context: raw materials → color field, yarn catalog → colorFamily field
  - When user mentions "brand", determine context: stores → store brand, raw materials → raw material brand
  - When user mentions "name", determine context: products → productName, raw materials → name, yarn catalog → yarnName
  - When user mentions "type", determine context: raw materials → type field, yarn → yarnType field
  - Always check the category first, then extract the appropriate field value
- Combine multiple filters when user requests them
- Use context from previous messages to infer missing filters
- Extract ALL mentioned filter values - don't limit to just one filter per query
- **Examples of field differentiation:**
  - "raw materials with color white" → getRawMaterials with color="white" (NOT colorFamily)
  - "yarn catalog with color blue" → getYarnCatalog with colorFamily="blue" (NOT color)
  - "stores with brand Van Heusen" → getStoresList with brand="Van Heusen" (store brand field)
  - "raw materials with brand Louis Philippe" → getRawMaterials with brand="Louis Philippe" (raw material brand field)

**DATA PRESENTATION & CATEGORIZATION GUIDELINES:**

When presenting data, always structure it logically:

1. **Summary First**: Start with a high-level summary of what the data shows
   - Total counts, key metrics, overall trends
   - Example: "I found 150 sales records in Mumbai totaling ₹2.5M in revenue..."

2. **Categorize by Dimensions**: Group data by relevant dimensions
   - By Location: Group by city, store
   - By Time: Group by date ranges, months, quarters
   - By Category: Group by product category, yarn type, machine status
   - By Status: Group by active/inactive, pending/completed

3. **Highlight Key Insights**: Point out important patterns
   - Top performers, trends, anomalies
   - Comparisons (this month vs last month, city A vs city B)

4. **Provide Context**: Explain what the data means
   - What's normal vs unusual
   - What actions might be needed based on the data

5. **Suggest Next Steps**: Offer related queries or deeper dives
   - "Would you like to see details for a specific product?"
   - "I can also show you the breakdown by category..."

**Example of Well-Categorized Response:**
User: "Show me sales in Mumbai"
Response: "I found 150 sales transactions in Mumbai totaling ₹2.5M. Here's the breakdown:
- Top 3 products: Product A (₹500K), Product B (₹400K), Product C (₹300K)
- By category: Apparel (60%), Accessories (30%), Others (10%)
- Time period: Most sales in December (₹800K), November (₹700K)
Would you like to see details for a specific product or category?"

When you have enough information to answer conversationally, respond with:
{
  "type": "conversation",
  "message": "Your natural conversational response with categorized data presentation",
  "suggestions": ["suggestion1", "suggestion2"] // optional
}

When you need to ask clarifying questions, respond with:
{
  "type": "clarification",
  "message": "Your clarifying question with 2-4 specific options",
  "context": "What you understood so far",
  "options": ["Option 1", "Option 2", "Option 3"] // Optional: specific options user can choose
}

**Clarification Examples (Natural and Conversational):**
- User: "how much yarn do we have"
  Response: {
    "type": "clarification",
    "message": "I'd be happy to help! When you ask 'how much yarn do we have,' are you looking for:\n\n• Our current yarn inventory (stock quantities on hand)\n• The yarn catalog (types, suppliers, and blends available)\n• Yarn transaction records (issued or returned)\n• Yarn purchase order status",
    "context": "User is asking about yarn quantity/information",
    "options": ["Show me yarn inventory", "Show me yarn catalog", "Show me yarn transactions", "Show me yarn purchase orders"]
  }

- User: "show me products"
  Response: {
    "type": "clarification",
    "message": "Sure! Are you looking for our complete product catalog, top selling products, or product sales data?",
    "context": "User wants to see products but didn't specify what type",
    "options": ["Show me product catalog", "Show me top products", "Show me product sales data"]
  }

- User: "how many stores"
  Response: {
    "type": "clarification",
    "message": "Are you asking about our total number of stores, stores in a specific city, or active stores?",
    "context": "User wants store count but didn't specify scope",
    "options": ["Show me total stores", "Show me stores in a city", "Show me active stores"]
  }`;
};

/**
 * Extract city name from user message (fallback helper)
 * @param {string} message - User message
 * @returns {string|null} Extracted city name or null
 */
const extractCityFromMessage = (message) => {
  const commonCities = ['mumbai', 'delhi', 'bangalore', 'chennai', 'kolkata', 'hyderabad', 'pune', 'ahmedabad', 'jaipur', 'surat'];
  const lowerMessage = message.toLowerCase();
  
  for (const city of commonCities) {
    if (lowerMessage.includes(city)) {
      return city;
    }
  }
  
  // Try to extract city after "in" keyword
  const inMatch = lowerMessage.match(/\bin\s+([a-z]+(?:\s+[a-z]+)?)/i);
  if (inMatch && inMatch[1]) {
    const potentialCity = inMatch[1].trim();
    // Check if it's a known city or looks like a city name
    if (potentialCity.length > 2 && potentialCity.length < 20) {
      return potentialCity;
    }
  }
  
  return null;
};

/**
 * Process natural conversation with GPT
 * @param {string} userMessage - User's message
 * @param {string} sessionId - Session identifier
 * @returns {Promise<Object>} Response object
 */
export const processNaturalConversation = async (userMessage, sessionId = 'default') => {
  try {
    const context = getConversationContext(sessionId);
    context.lastActivity = new Date();

    // CRITICAL: Check for specific yarn issue queries FIRST (before ambiguous check)
    // This ensures "how much yarn has been issued" is caught correctly
    const yarnIssuePatterns = [
      /how\s+much\s+yarn\s+(?:has\s+been\s+|was\s+|is\s+)?issued/i,
      /how\s+many\s+yarn\s+(?:has\s+been\s+|was\s+|is\s+)?issued/i,
      /total\s+yarn\s+issued/i,
      /yarn\s+(?:has\s+been\s+|was\s+)?issued/i,
      /amount\s+of\s+yarn\s+issued/i,
      /quantity\s+of\s+yarn\s+issued/i
    ];
    
    if (yarnIssuePatterns.some(pattern => pattern.test(userMessage.trim()))) {
      console.log(`[conversation] Detected yarn issue query: "${userMessage}"`);
      const intent = {
        action: 'getYarnIssue',
        params: {},
        description: 'Get yarn issue records'
      };
      
      try {
        const dataHtml = await aiToolService.executeAITool(intent);
        return {
          type: 'data_response',
          conversationalMessage: "Here's the yarn issue information:",
          dataHtml: dataHtml,
          intent: intent,
          suggestions: ["Show me yarn inventory", "Show me yarn transactions", "Show me yarn requisitions"]
        };
      } catch (error) {
        console.error(`[conversation] Error fetching yarn issue data:`, error);
      }
    }
    
    // CRITICAL: Check for ambiguous yarn queries, but exclude "issued" queries
    // This must be after the yarn issue check
    const ambiguousYarnPatterns = [
      /^how much yarn$/i,
      /^how many yarn$/i,
      /how much yarn do (we|you) have/i,
      /how many yarn do (we|you) have/i,
      /yarn do (we|you) have/i,
      /how much yarn (do|does) (we|you|i) have/i,
      /how much.*yarn(?!.*issued)/i,  // Catches "how much yarn" but NOT if followed by "issued"
      /how many.*yarn(?!.*issued)/i   // Catches "how many yarn" but NOT if followed by "issued"
    ];
    
    const isAmbiguousYarnQuery = ambiguousYarnPatterns.some(pattern => pattern.test(userMessage.trim()));
    
    if (isAmbiguousYarnQuery) {
      console.log(`[conversation] EARLY DETECTION: Ambiguous yarn query detected: "${userMessage}", returning clarification immediately`);
      return {
        type: 'clarification',
        message: "I'd be happy to help! When you ask 'how much yarn do we have,' are you looking for:\n\n• Our current yarn inventory (stock quantities on hand)\n• The yarn catalog (types, suppliers, and blends available)\n• Yarn transaction records (issued or returned)\n• Yarn purchase order status",
        context: "User is asking about yarn quantity/information",
        options: ["Show me yarn inventory", "Show me yarn catalog", "Show me yarn transactions", "Show me yarn purchase orders"],
        suggestions: ["Show me yarn inventory", "Show me yarn catalog", "Show me yarn transactions", "Show me yarn purchase orders"]
      };
    }

    // Normalize message: fix common typos
    let normalizedMessage = userMessage.trim();
    normalizedMessage = normalizedMessage.replace(/quatity/gi, 'quantity');
    normalizedMessage = normalizedMessage.replace(/invetory/gi, 'inventory');
    normalizedMessage = normalizedMessage.replace(/colour/gi, 'color');
    
    // PRE-CHECK: Handle greetings naturally
    const greetingPatterns = [/^hey$/i, /^hi$/i, /^hello$/i, /^greetings$/i];
    if (greetingPatterns.some(pattern => pattern.test(normalizedMessage))) {
      console.log(`[conversation] Detected greeting`);
      return {
        type: 'conversation',
        message: "Hello! 👋 I'm Addon, your business analytics assistant. I can help you with sales data, store information, product insights, yarn management, and more. What would you like to know?",
        suggestions: ["Show me sales data", "Show me top products", "Show me yarn inventory", "Show me stores"],
      };
    }
    
    // PRE-CHECK: Context-aware follow-up queries
    // If user was viewing raw materials and asks about colors/types/brands, apply filter
    const lastIntent = context.lastIntent;
    const followUpPatterns = [
      /^(which|what|show me|tell me).*(are|is)\s+(white|black|red|blue|green|yellow|orange|purple|pink|brown|grey|gray|beige|navy|cream|golden|gold|silver|transparent|maroon|olive|khaki)/i,
      /^(show|list|get|tell me).*(white|black|red|blue|green|yellow|orange|purple|pink|brown|grey|gray|beige|navy|cream|golden|gold|silver|transparent|maroon|olive|khaki)(\s+ones?)?$/i,
      /^(the|those|these)\s+(white|black|red|blue|green|yellow|orange|purple|pink|brown|grey|gray|beige|navy|cream|golden|gold|silver|transparent|maroon|olive|khaki)(\s+ones?)?$/i,
    ];
    
    const colorMatch = normalizedMessage.match(/(white|black|red|blue|green|yellow|orange|purple|pink|brown|grey|gray|beige|navy|cream|golden|gold|silver|transparent|maroon|olive|khaki|pastel\s+cream)/i);
    
    if (colorMatch && lastIntent && lastIntent.action === 'getRawMaterials') {
      const color = colorMatch[1];
      console.log(`[conversation] Detected follow-up color query for raw materials: ${color}`);
      const intent = {
        action: 'getRawMaterials',
        params: { color: color },
        description: `Fetching raw materials filtered by color: ${color}`
      };
      
      try {
        const dataHtml = await aiToolService.executeAITool(intent);
        // Update last intent
        context.lastIntent = intent;
        return {
          type: 'data_response',
          conversationalMessage: `Here are the ${color} raw materials:`,
          dataHtml: dataHtml,
          intent: intent,
          suggestions: ["Show me all raw materials", "Raw materials by Packing Material", "Raw materials page 2"]
        };
      } catch (error) {
        console.error(`[conversation] Error fetching raw materials by color:`, error);
      }
    }
    
    // CONTEXT-AWARE FOLLOW-UP DETECTION FOR YARN TYPES
    // If the last action was getYarnTypes and the current query mentions a yarn type name or subtype, apply filter
    if (lastIntent && lastIntent.action === 'getYarnTypes') {
      // Common yarn type names and subtypes
      const yarnTypeNames = ['cotton', 'nylon', 'polyester', 'wool', 'bamboo', 'rubber', 'modal', 'spandex', 'acrylic', 'hemp', 'linen', 'sorona', 'lyocell', 'pima', 'giza', 'supima', 'carded', 'combed', 'compact', 'melange', 'vortex', 'kora', 'gassed', 'mercerized', 'twisted', 'zari'];
      
      // Check if message contains a yarn type name or subtype
      const messageLower = normalizedMessage.toLowerCase();
      const matchedYarnType = yarnTypeNames.find(type => messageLower.includes(type));
      
      // Patterns for follow-up queries like "give me only cotton one", "show me cotton", "only cotton", etc.
      // More flexible pattern that matches various phrasings
      const isFollowUpQuery = /^(give me|show me|tell me|get|only|just|the|those|these|i want|i need)\s+(only\s+)?(cotton|nylon|polyester|wool|bamboo|rubber|modal|spandex|acrylic|hemp|linen|sorona|lyocell|pima|giza|supima|carded|combed|compact|melange|vortex|kora|gassed|mercerized|twisted|zari)(\s+one|\s+ones?|\s+type|\s+types?)?$/i.test(normalizedMessage) ||
                              /^(cotton|nylon|polyester|wool|bamboo|rubber|modal|spandex|acrylic|hemp|linen|sorona|lyocell|pima|giza|supima|carded|combed|compact|melange|vortex|kora|gassed|mercerized|twisted|zari)(\s+one|\s+ones?|\s+type|\s+types?)?$/i.test(normalizedMessage) ||
                              /(only|just|the|those|these)\s+(cotton|nylon|polyester|wool|bamboo|rubber|modal|spandex|acrylic|hemp|linen|sorona|lyocell|pima|giza|supima|carded|combed|compact|melange|vortex|kora|gassed|mercerized|twisted|zari)(\s+one|\s+ones?)?$/i.test(normalizedMessage);
      
      if (matchedYarnType || isFollowUpQuery) {
        // Extract the yarn type name from the message
        const yarnTypeMatch = normalizedMessage.match(/(cotton|nylon|polyester|wool|bamboo|rubber|modal|spandex|acrylic|hemp|linen|sorona|lyocell|pima|giza|supima|carded|combed|compact|melange|vortex|kora|gassed|mercerized|twisted|zari)/i);
        const yarnTypeFilter = yarnTypeMatch ? yarnTypeMatch[1] : matchedYarnType;
        
        if (yarnTypeFilter) {
          console.log(`[conversation] Detected follow-up yarn type query: "${normalizedMessage}" → filtering by "${yarnTypeFilter}"`);
          const intent = {
            action: 'getYarnTypes',
            params: { yarnTypeName: yarnTypeFilter, ...lastIntent.params },
            description: `Fetching yarn types filtered by name/subtype: ${yarnTypeFilter}`,
          };
          
          try {
            const dataHtml = await aiToolService.executeAITool(intent);
            context.lastIntent = intent; // Update last intent
            return {
              type: 'data_response',
              conversationalMessage: `Here are the yarn types matching "${yarnTypeFilter}":`,
              dataHtml: dataHtml,
              intent: intent,
              suggestions: ["Show me all yarn types", "Yarn types page 1", "Yarn types with details"],
            };
          } catch (error) {
            console.error(`[conversation] Error fetching yarn types by filter:`, error);
          }
        }
      }
    }
    
    // PRE-CHECK: Direct yarn color queries - fetch data, don't list capabilities
    const yarnColorPatterns = [
      /yarn\s+color/i,
      /yarn\s+colour/i,
      /tell me.*yarn.*color/i,
      /show me.*yarn.*color/i,
      /what.*yarn.*color/i,
      /about.*yarn.*color/i
    ];
    
    if (yarnColorPatterns.some(pattern => pattern.test(normalizedMessage))) {
      console.log(`[conversation] Detected yarn color query, fetching data`);
      const intent = {
        action: 'getYarnColors',
        params: {},
        description: 'Fetching yarn colors data'
      };
      
      try {
        const dataHtml = await aiToolService.executeAITool(intent);
        return {
          type: 'data_response',
          conversationalMessage: "Here are the yarn colors available in our system:",
          dataHtml: dataHtml,
          intent: intent,
          suggestions: ["Show me yarn inventory", "Show me yarn catalog", "Show me yarn types"]
        };
      } catch (error) {
        console.error(`[conversation] Error fetching yarn colors:`, error);
      }
    }
    
    // NOTE: Ambiguous yarn query check is already done at the beginning of the function
    // No need to check again here since it would have already returned if it matched
    
    // PRE-CHECK: Specific yarn inventory/quantity queries (only if NOT ambiguous)
    const yarnInventoryPatterns = [
      /yarn\s+quantity\s+in\s+inventory/i,
      /yarn\s+inventory\s+quantity/i,
      /yarn\s+inventory/i,
      /yarn\s+stock/i,
      /current\s+yarn\s+inventory/i,
      /show\s+me\s+yarn\s+inventory/i
    ];
    
    if (yarnInventoryPatterns.some(pattern => pattern.test(normalizedMessage))) {
      console.log(`[conversation] Detected specific yarn inventory query, fetching data`);
      const intent = {
        action: 'getYarnInventory',
        params: {},
        description: 'Fetching yarn inventory data'
      };
      
      try {
        const dataHtml = await aiToolService.executeAITool(intent);
        return {
          type: 'data_response',
          conversationalMessage: "Here's our current yarn inventory:",
          dataHtml: dataHtml,
          intent: intent,
          suggestions: ["Show me yarn catalog", "Show me yarn transactions", "Show me yarn purchase orders"]
        };
      } catch (error) {
        console.error(`[conversation] Error fetching yarn inventory:`, error);
      }
    }
    
    // Use normalized message for GPT processing
    userMessage = normalizedMessage;

    // Add user message to history
    context.messages.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    });

    // Limit history length
    if (context.messages.length > MAX_HISTORY_LENGTH) {
      context.messages = context.messages.slice(-MAX_HISTORY_LENGTH);
    }

    // Build conversation history for GPT
    const conversationHistory = context.messages
      .slice(-10) // Last 10 messages for context
      .map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

    // Build enhanced system prompt with context
    let systemPrompt = buildSystemPrompt();
    if (context.lastIntent) {
      systemPrompt += `\n\n**CURRENT CONTEXT - IMPORTANT:**
The user's last action was: ${context.lastIntent.action} with params: ${JSON.stringify(context.lastIntent.params || {})}
This means they were viewing: ${context.lastIntent.action === 'getRawMaterials' ? 'RAW MATERIALS' : context.lastIntent.action === 'getProductsList' ? 'PRODUCTS' : context.lastIntent.action === 'getStoresList' ? 'STORES' : 'OTHER DATA'}

**CRITICAL**: If the user asks a follow-up question like "which are white", "show me the red ones", "what about [filter]", they are likely asking about the SAME category they were just viewing.
- If last action was getRawMaterials → follow-up queries about colors/types/brands refer to RAW MATERIALS
- If last action was getProductsList → follow-up queries refer to PRODUCTS  
- If last action was getStoresList → follow-up queries refer to STORES

Example: User previously asked "show me raw materials" (getRawMaterials), then asks "which are white" → This means getRawMaterials with color="white", NOT getProductAnalysis.`;
    }

    // Call GPT for natural conversation understanding
    const gptResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        ...conversationHistory,
      ],
      temperature: 0.7,
      max_tokens: 800, // Increased for longer clarification questions
    });

    const assistantMessage = gptResponse.choices[0].message.content.trim();
    console.log(`[conversation] GPT Response: ${assistantMessage.substring(0, 200)}...`);

    // Detect if GPT is listing capabilities instead of asking clarifying questions
    // This happens when queries are ambiguous like "how much yarn do we have"
    const capabilityListIndicators = [
      'I can provide',
      'I can help you with',
      'You can ask',
      'To get specific details',
      'I can show you',
      'As of now, I can',
      'I have access to',
      'detailed information',
      'You can ask questions',
      'If you have any other',
      'feel free to ask',
      'I apologize, but I\'m having trouble',
      'Could you please rephrase'
    ];
    
    // Also check for bullet points or numbered lists (typical of capability lists)
    const hasBulletPoints = /^[-•*]\s|^\d+\.\s/m.test(assistantMessage);
    const hasCapabilityPhrases = capabilityListIndicators.some(indicator => 
      assistantMessage.toLowerCase().includes(indicator.toLowerCase())
    );
    
    const isCapabilityList = hasCapabilityPhrases || (hasBulletPoints && assistantMessage.length > 100);
    
    // Check if the original query was ambiguous
    const ambiguousQueryPatterns = [
      /^how much yarn/i,
      /^how many yarn/i,
      /how much yarn do (we|you) have/i,
      /how many yarn do (we|you) have/i,
      /yarn do (we|you) have/i,
      /^how much$/i,
      /^yarn$/i,
      /^how many products/i,
      /^how many stores/i,
      /^show me (products|stores|yarn)$/i
    ];
    
    const isAmbiguousQuery = ambiguousQueryPatterns.some(pattern => pattern.test(userMessage));
    
    console.log(`[conversation] Is capability list: ${isCapabilityList}, Is ambiguous query: ${isAmbiguousQuery}, Has bullet points: ${hasBulletPoints}, Has capability phrases: ${hasCapabilityPhrases}`);
    
    // Try to parse JSON response if it's a structured response
    let parsedResponse;
    
    // If it's a capability list OR an ambiguous query without proper clarification, convert to clarification
    if ((isCapabilityList || isAmbiguousQuery) && !assistantMessage.includes('"type"')) {
      // Check if it's a yarn-related query
      const isYarnRelated = /yarn/i.test(userMessage);
      
      if (isYarnRelated) {
        // Convert to a natural clarifying question for yarn
        console.log(`[conversation] Converting to clarification for yarn query`);
        parsedResponse = {
          type: 'clarification',
          message: "I'd be happy to help! When you ask 'how much yarn do we have,' are you looking for:\n\n• Our current yarn inventory (stock quantities on hand)\n• The yarn catalog (types, suppliers, and blends available)\n• Yarn transaction records (issued or returned)\n• Yarn purchase order status",
          context: "User is asking about yarn quantity/information",
          options: ["Show me yarn inventory", "Show me yarn catalog", "Show me yarn transactions", "Show me yarn purchase orders"],
          suggestions: ["Show me yarn inventory", "Show me yarn catalog", "Show me yarn transactions", "Show me yarn purchase orders"]
        };
      } else if (/product/i.test(userMessage)) {
        // Product-related ambiguous query
        console.log(`[conversation] Converting to clarification for product query`);
        parsedResponse = {
          type: 'clarification',
          message: "I'd be happy to help! When you ask about products, are you looking for:\n\n• Our product catalog (complete list of all products)\n• Product count (total number of products)\n• Top selling products (best performers)\n• Product sales data (transaction records)",
          context: "User is asking about products",
          options: ["Show me product catalog", "How many products", "Show me top products", "Show me product sales"],
          suggestions: ["Show me product catalog", "How many products", "Show me top products", "Show me product sales"]
        };
      } else if (/store/i.test(userMessage)) {
        // Store-related ambiguous query
        console.log(`[conversation] Converting to clarification for store query`);
        parsedResponse = {
          type: 'clarification',
          message: "I'd be happy to help! When you ask about stores, are you looking for:\n\n• Store list (all stores)\n• Stores in a specific city\n• Active stores only\n• Store performance analysis",
          context: "User is asking about stores",
          options: ["Show me all stores", "Show me stores in a city", "Show me active stores", "Show me store performance"],
          suggestions: ["Show me all stores", "Show me stores in a city", "Show me active stores", "Show me store performance"]
        };
      } else {
        // Generic ambiguous query
        try {
          parsedResponse = JSON.parse(assistantMessage);
        } catch (e) {
          console.log(`[conversation] Converting generic capability list to clarification`);
          parsedResponse = {
            type: 'clarification',
            message: "I'd be happy to help! Could you clarify what specific information you're looking for?",
            context: "User query is ambiguous",
            options: [],
            suggestions: ["Show me sales data", "Show me products", "Show me stores", "Show me yarn inventory"]
          };
        }
      }
    } else {
      // Try to parse JSON response if it's a structured response
      try {
        parsedResponse = JSON.parse(assistantMessage);
        console.log(`[conversation] Parsed as JSON: ${parsedResponse.type}`);
      } catch (e) {
        // Not JSON, treat as conversational response
        parsedResponse = {
          type: 'conversation',
          message: assistantMessage,
        };
        console.log(`[conversation] Treated as conversation`);
      }
    }

    // Handle different response types
    if (parsedResponse.type === 'data_request') {
      // Fetch data using AI tool service
      const intent = {
        action: parsedResponse.action,
        params: parsedResponse.params || {},
        description: parsedResponse.conversational_response || `Fetching ${parsedResponse.action}`,
      };

      // Fallback: If action is getSalesData and city is missing but message mentions a city, extract it
      if (intent.action === 'getSalesData' && !intent.params.city) {
        const extractedCity = extractCityFromMessage(userMessage);
        if (extractedCity) {
          console.log(`[conversation] Extracted city "${extractedCity}" from message as fallback`);
          intent.params.city = extractedCity;
        }
      }

      // Safeguard: Remove productName if it's a generic phrase like "all products" or "products"
      if (intent.action === 'getSalesData' && intent.params.productName) {
        const productNameLower = intent.params.productName.toLowerCase().trim();
        const genericPhrases = ['all products', 'products', 'all', 'everything', 'all items', 'items'];
        if (genericPhrases.includes(productNameLower) || productNameLower.includes('all products')) {
          console.log(`[conversation] Removing generic productName "${intent.params.productName}"`);
          delete intent.params.productName;
        }
      }

      // CRITICAL SAFEGUARD: If user was viewing raw materials and GPT returns getProductAnalysis for a color query, override it
      if (context.lastIntent && context.lastIntent.action === 'getRawMaterials') {
        const colorWords = ['white', 'black', 'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown', 'grey', 'gray', 'beige', 'navy', 'cream', 'golden', 'gold', 'silver', 'transparent', 'maroon', 'olive', 'khaki'];
        const messageLower = userMessage.toLowerCase();
        const hasColorWord = colorWords.some(color => messageLower.includes(color));
        const isFollowUpQuery = /^(which|what|show me|tell me|the|those|these).*(are|is|ones?)?$/i.test(userMessage) || 
                                 /^(show|list|get|tell me).*(ones?)?$/i.test(userMessage);
        
        // Check for "other colors" or "available colors" queries
        const isColorListQuery = /(?:any|what|show|tell|list|get)\s+(?:other|available|all)?\s*(?:colors?|colours?)/i.test(userMessage) ||
                                  /(?:other|available)\s*(?:colors?|colours?)/i.test(userMessage);
        
        if (isColorListQuery) {
          console.log(`[conversation] User was viewing raw materials, treating "${userMessage}" as request for available colors`);
          intent.action = 'getRawMaterialColors';
          intent.params = {};
          intent.description = 'Fetching available colors in raw materials';
        } else if (hasColorWord && (isFollowUpQuery || intent.action === 'getProductAnalysis')) {
          const extractedColor = colorWords.find(color => messageLower.includes(color));
          if (extractedColor) {
            console.log(`[conversation] Overriding GPT response: User was viewing raw materials, treating "${userMessage}" as raw materials color filter`);
            intent.action = 'getRawMaterials';
            intent.params = { color: extractedColor };
            intent.description = `Fetching raw materials filtered by color: ${extractedColor}`;
          }
        }
      }
      
      // CRITICAL SAFEGUARD: If user was viewing yarn types and GPT returns wrong action for yarn type name query, override it
      if (context.lastIntent && context.lastIntent.action === 'getYarnTypes') {
        const yarnTypeNames = ['cotton', 'nylon', 'polyester', 'wool', 'bamboo', 'rubber', 'modal', 'spandex', 'acrylic', 'hemp', 'linen', 'sorona', 'lyocell', 'pima', 'giza', 'supima', 'carded', 'combed', 'compact', 'melange', 'vortex', 'kora', 'gassed', 'mercerized', 'twisted', 'zari'];
        const messageLower = userMessage.toLowerCase();
        const hasYarnTypeName = yarnTypeNames.some(type => messageLower.includes(type));
        const isFollowUpQuery = /^(give me|show me|tell me|get|only|just|the|those|these)\s+(only\s+)?(cotton|nylon|polyester|wool|bamboo|rubber|modal|spandex|acrylic|hemp|linen|sorona|lyocell|pima|giza|supima|carded|combed|compact|melange|vortex|kora|gassed|mercerized|twisted|zari)(\s+one|\s+ones?)?$/i.test(userMessage) ||
                                /^(cotton|nylon|polyester|wool|bamboo|rubber|modal|spandex|acrylic|hemp|linen|sorona|lyocell|pima|giza|supima|carded|combed|compact|melange|vortex|kora|gassed|mercerized|twisted|zari)(\s+one|\s+ones?)?$/i.test(userMessage);
        
        if (hasYarnTypeName && (isFollowUpQuery || intent.action === 'getRawMaterials' || intent.action === 'getProductAnalysis')) {
          const extractedYarnType = yarnTypeNames.find(type => messageLower.includes(type));
          if (extractedYarnType) {
            console.log(`[conversation] Overriding GPT response: User was viewing yarn types, treating "${userMessage}" as yarn types filter`);
            intent.action = 'getYarnTypes';
            intent.params = { yarnTypeName: extractedYarnType };
            intent.description = `Fetching yarn types filtered by name/subtype: ${extractedYarnType}`;
          }
        }
      }

      context.lastIntent = intent;

      // Execute the data request
      const dataHtml = await aiToolService.executeAITool(intent);

      // Add assistant message to history
      context.messages.push({
        role: 'assistant',
        content: parsedResponse.conversational_response || `I've fetched the data you requested.`,
        timestamp: new Date(),
      });

      return {
        type: 'data_response',
        conversationalMessage: parsedResponse.conversational_response || 'Here\'s the data you requested:',
        dataHtml: dataHtml,
        intent: intent,
        suggestions: generateSuggestions(intent.action, parsedResponse.params),
      };
    } else if (parsedResponse.type === 'clarification') {
      // Ask for clarification
      context.messages.push({
        role: 'assistant',
        content: parsedResponse.message,
        timestamp: new Date(),
      });

      // Use options from GPT if provided, otherwise generate suggestions
      const clarificationOptions = parsedResponse.options || generateClarificationSuggestions(parsedResponse.context);

      return {
        type: 'clarification',
        message: parsedResponse.message,
        context: parsedResponse.context,
        options: clarificationOptions,
        suggestions: clarificationOptions,
      };
    } else {
      // Conversational response
      context.messages.push({
        role: 'assistant',
        content: parsedResponse.message || assistantMessage,
        timestamp: new Date(),
      });

      return {
        type: 'conversation',
        message: parsedResponse.message || assistantMessage,
        suggestions: parsedResponse.suggestions || generateGeneralSuggestions(),
      };
    }
  } catch (error) {
    console.error('Error in natural conversation:', error);
    return {
      type: 'error',
      message: 'I apologize, but I encountered an error processing your message. Could you please rephrase your question?',
      suggestions: generateGeneralSuggestions(),
    };
  }
};

/**
 * Generate contextual suggestions based on action
 * @param {string} action - Action that was executed
 * @param {Object} params - Parameters used
 * @returns {Array<string>} Suggestions
 */
const generateSuggestions = (action, params) => {
  const suggestions = [];

  if (action === 'getSalesData') {
    if (params.city) {
      suggestions.push(`Show me top products in ${params.city}`);
      suggestions.push(`Show me sales report for ${params.city}`);
    } else {
      suggestions.push('Show me sales data in Mumbai');
      suggestions.push('Show me sales data in Delhi');
    }
    if (params.productName) {
      suggestions.push(`Show me sales trends for ${params.productName}`);
    }
  } else if (action === 'getTopProducts') {
    suggestions.push('Show me brand performance');
    suggestions.push('Show me sales report');
    if (params.city) {
      suggestions.push(`Show me stores in ${params.city}`);
    }
  } else if (action === 'getStoresList') {
    suggestions.push('Show me sales data');
    suggestions.push('Show me analytics dashboard');
  } else if (action === 'getBrandPerformance') {
    suggestions.push('Show me top products');
    suggestions.push('Show me sales report');
  }

  // Add general suggestions if not enough
  if (suggestions.length < 3) {
    suggestions.push(...generateGeneralSuggestions().slice(0, 3 - suggestions.length));
  }

  return suggestions;
};

/**
 * Generate clarification suggestions
 * @param {string} context - What was understood so far
 * @returns {Array<string>} Suggestions
 */
const generateClarificationSuggestions = (context) => {
  return [
    'Show me sales data',
    'Show me top products',
    'Show me stores',
    'Show me analytics dashboard',
  ];
};

/**
 * Generate general suggestions
 * @returns {Array<string>} Suggestions
 */
const generateGeneralSuggestions = () => {
  return [
    'Show me sales data',
    'Show me top products',
    'Show me stores',
    'Show me brand performance',
    'Show me analytics dashboard',
    'What can you help me with?',
  ];
};

/**
 * Clear conversation context for a session
 * @param {string} sessionId - Session identifier
 */
export const clearConversationContext = (sessionId = 'default') => {
  conversationContexts.delete(sessionId);
};

/**
 * Get conversation history for a session
 * @param {string} sessionId - Session identifier
 * @returns {Array} Conversation history
 */
export const getConversationHistory = (sessionId = 'default') => {
  const context = getConversationContext(sessionId);
  return context.messages;
};

export default {
  processNaturalConversation,
  clearConversationContext,
  getConversationHistory,
};

