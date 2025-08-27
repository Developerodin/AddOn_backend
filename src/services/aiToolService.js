import * as analyticsService from './analytics.service.js';
import * as productService from './product.service.js';
import * as storeService from './store.service.js';
import * as salesService from './sales.service.js';
import * as replenishmentService from './replenishment.service.js';
import * as categoryService from './category.service.js';
import Sales from '../models/sales.model.js';
import Store from '../models/store.model.js';
import Product from '../models/product.model.js';

/**
 * CSS styles for AI tool responses
 */
const AI_TOOL_STYLES = `
<style>
.ai-tool-response {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  margin: 20px 0;
  padding: 20px;
  background-color: #f8f9fa;
  border-radius: 8px;
  border-left: 4px solid #007bff;
}

.ai-tool-response h3 {
  margin: 0 0 15px 0;
  color: #2c3e50;
  font-size: 18px;
  font-weight: 600;
}

.city-info, .report-info {
  background-color: #e9ecef;
  padding: 15px;
  border-radius: 6px;
  margin-bottom: 20px;
}

.city-info p, .report-info p {
  margin: 5px 0;
  color: #495057;
  font-size: 14px;
}

.city-info strong, .report-info strong {
  color: #2c3e50;
}

.table-container {
  margin: 20px 0;
  overflow-x: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  background-color: white;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.data-table th,
.data-table td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid #e1e5e9;
}

.data-table th {
  background-color: #007bff;
  color: white;
  font-weight: 600;
  font-size: 13px;
}

.data-table tr:hover {
  background-color: #f8f9fa;
}

.data-table tr:nth-child(even) {
  background-color: #f8f9fa;
}

.summary-card {
  display: inline-block;
  margin: 10px;
  padding: 20px;
  min-width: 150px;
  text-align: center;
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
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
  color: #007bff;
}

.card-subtitle {
  font-size: 12px;
  color: #6c757d;
}

.summary {
  margin-top: 15px;
  padding: 10px;
  background-color: #d4edda;
  border: 1px solid #c3e6cb;
  border-radius: 4px;
  color: #155724;
  font-size: 14px;
  text-align: center;
}

.response-content {
  background-color: white;
  padding: 15px;
  border-radius: 6px;
  border: 1px solid #dee2e6;
}

.response-content p {
  margin: 8px 0;
  color: #495057;
  line-height: 1.6;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 15px;
  margin: 20px 0;
}

.kpi-item {
  background-color: white;
  padding: 15px;
  border-radius: 6px;
  text-align: center;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
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

.chart-container {
  margin: 20px 0;
  padding: 15px;
  background-color: white;
  border-radius: 6px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.chart-container h4 {
  margin: 0 0 15px 0;
  color: #2c3e50;
  font-size: 16px;
  font-weight: 600;
}
</style>
`;

/**
 * Get top products across all stores or filtered by city using analytics service
 * @param {string} city - Optional city filter
 * @returns {Promise<string>} HTML string with top products data
 */
export const getTopProducts = async (city = null) => {
  try {
    let filter = {};
    let storeFilter = {};
    
    if (city) {
      storeFilter.city = { $regex: city, $options: 'i' };
    }
    
    // Get stores based on filter
    const stores = await Store.find(storeFilter).select('_id storeName city').lean();
    if (stores.length === 0) {
      return generateHTMLResponse('No stores found', 'No stores available for the specified criteria.');
    }
    
    const storeIds = stores.map(store => store._id);
    
    // Use analytics service for better data
    const productPerformance = await analyticsService.getProductPerformanceAnalysis({
      limit: 10,
      sortBy: 'nsv',
      dateFrom: city ? null : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days for city-specific
      dateTo: city ? null : new Date()
    });
    
    if (!productPerformance || productPerformance.length === 0) {
      return generateHTMLResponse('No sales data found', 'No sales transactions found for the specified criteria.');
    }
    
    // Generate HTML table
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🏆 Top Products ${city ? `in ${city}` : 'Across All Stores'}</h3>
        ${city ? `<div class="city-info"><p><strong>City:</strong> ${city}</p><p><strong>Stores:</strong> ${stores.length}</p></div>` : ''}
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Product Name</th>
                <th>Code</th>
                <th>Category</th>
                <th>Quantity Sold</th>
                <th>Total NSV (₹)</th>
                <th>Total GSV (₹)</th>
                <th>Discount (₹)</th>
                <th>Orders</th>
              </tr>
            </thead>
            <tbody>
              ${productPerformance.map((product, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td>${product.productName || 'Unknown'}</td>
                  <td>${product.productCode || 'N/A'}</td>
                  <td>${product.categoryName || 'Unknown'}</td>
                  <td>${product.totalQuantity.toLocaleString()}</td>
                  <td>₹${product.totalNSV.toLocaleString()}</td>
                  <td>₹${product.totalGSV.toLocaleString()}</td>
                  <td>₹${product.totalDiscount.toLocaleString()}</td>
                  <td>${product.recordCount}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <p class="summary">Found ${productPerformance.length} top performing products ${city ? `in ${city}` : 'across all stores'}.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getTopProducts:', error);
    return generateHTMLResponse('Error', `Failed to retrieve top products: ${error.message}`);
  }
};

/**
 * Get total product count using product service
 * @returns {Promise<string>} HTML string with product count
 */
export const getProductCount = async () => {
  try {
    const products = await productService.queryProducts({}, { limit: 1 });
    const totalProducts = products.totalResults || 0;
    
    // Get additional product statistics
    const activeProducts = await productService.queryProducts({ status: 'active' }, { limit: 1 });
    const activeCount = activeProducts.totalResults || 0;
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📦 Product Inventory Summary</h3>
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Products</div>
            <div class="kpi-value">${totalProducts.toLocaleString()}</div>
            <div class="kpi-change">Available in System</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Active Products</div>
            <div class="kpi-value">${activeCount.toLocaleString()}</div>
            <div class="kpi-change">Currently Active</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Inactive Products</div>
            <div class="kpi-value">${(totalProducts - activeCount).toLocaleString()}</div>
            <div class="kpi-change">Not Active</div>
          </div>
        </div>
        <p class="summary">Your inventory currently contains ${totalProducts.toLocaleString()} products with ${activeCount.toLocaleString()} active items.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getProductCount:', error);
    return generateHTMLResponse('Error', `Failed to retrieve product count: ${error.message}`);
  }
};

/**
 * Get top products in a specific city using analytics service
 * @param {string} city - City name
 * @returns {Promise<string>} HTML string with top products in city
 */
export const getTopProductsInCity = async (city) => {
  try {
    if (!city) {
      return generateHTMLResponse('City Required', 'Please specify a city to get top products.');
    }
    
    // Find stores in the city
    const stores = await Store.find({ 
      city: { $regex: city, $options: 'i' } 
    }).select('_id storeName city').lean();
    
    if (stores.length === 0) {
      return generateHTMLResponse('No Stores Found', `No stores found in ${city}. Please check the city name.`);
    }
    
    const storeIds = stores.map(store => store._id);
    
    // Get sales data for top products in the city using analytics service
    const salesData = await Sales.aggregate([
      { $match: { plant: { $in: storeIds } } },
      {
        $lookup: {
          from: 'products',
          localField: 'materialCode',
          foreignField: '_id',
          as: 'productData'
        }
      },
      { $unwind: '$productData' },
      {
        $lookup: {
          from: 'categories',
          localField: 'productData.category',
          foreignField: '_id',
          as: 'categoryData'
        }
      },
      {
        $unwind: {
          path: '$categoryData',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $group: {
          _id: '$materialCode',
          productName: { $first: '$productData.name' },
          softwareCode: { $first: '$productData.softwareCode' },
          categoryName: { $first: '$categoryData.name' },
          totalQuantity: { $sum: '$quantity' },
          totalSales: { $sum: '$gsv' },
          totalRevenue: { $sum: '$nsv' },
          totalDiscount: { $sum: '$discount' },
          storeCount: { $addToSet: '$plant' }
        }
      },
      {
        $addFields: {
          storeCount: { $size: '$storeCount' }
        }
      },
      { $sort: { totalSales: -1 } },
      { $limit: 10 }
    ]);
    
    if (salesData.length === 0) {
      return generateHTMLResponse('No Sales Data', `No sales transactions found for stores in ${city}.`);
    }
    
    // Generate HTML table
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🏆 Top Products in ${city}</h3>
        <div class="city-info">
          <p><strong>City:</strong> ${city}</p>
          <p><strong>Stores:</strong> ${stores.length}</p>
        </div>
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Product Name</th>
                <th>Code</th>
                <th>Category</th>
                <th>Quantity Sold</th>
                <th>Total Sales (₹)</th>
                <th>Revenue (₹)</th>
                <th>Discount (₹)</th>
                <th>Stores Selling</th>
              </tr>
            </thead>
            <tbody>
              ${salesData.map((product, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td>${product.productName || 'Unknown'}</td>
                  <td>${product.softwareCode || 'N/A'}</td>
                  <td>${product.categoryName || 'Unknown'}</td>
                  <td>${product.totalQuantity.toLocaleString()}</td>
                  <td>₹${product.totalSales.toLocaleString()}</td>
                  <td>₹${product.totalRevenue.toLocaleString()}</td>
                  <td>₹${product.totalDiscount.toLocaleString()}</td>
                  <td>${product.storeCount}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <p class="summary">Found ${salesData.length} top performing products in ${city} across ${stores.length} stores.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getTopProductsInCity:', error);
    return generateHTMLResponse('Error', `Failed to retrieve top products in ${city}: ${error.message}`);
  }
};

/**
 * Get sales report with various parameters using analytics service
 * @param {Object} params - Report parameters
 * @returns {Promise<string>} HTML string with sales report
 */
export const getSalesReport = async (params = {}) => {
  try {
    const { 
      dateFrom, 
      dateTo, 
      city, 
      category, 
      limit = 20,
      groupBy = 'product'
    } = params;
    
    // Build filter
    let filter = {};
    let storeFilter = {};
    
    if (city) {
      storeFilter.city = { $regex: city, $options: 'i' };
    }
    
    if (dateFrom || dateTo) {
      filter.dateFrom = dateFrom;
      filter.dateTo = dateTo;
    }
    
    // Get stores if city filter is applied
    let storeIds = null;
    if (Object.keys(storeFilter).length > 0) {
      const stores = await Store.find(storeFilter).select('_id').lean();
      if (stores.length === 0) {
        return generateHTMLResponse('No Stores Found', `No stores found matching the criteria.`);
      }
      storeIds = stores.map(store => store._id);
      filter.storeId = storeIds[0]; // For analytics service
    }
    
    let reportData = null;
    let columns = [];
    let tableData = [];
    
    // Use appropriate analytics service based on groupBy
    if (groupBy === 'product') {
      reportData = await analyticsService.getProductPerformanceAnalysis({
        ...filter,
        limit: parseInt(limit)
      });
      
      columns = ['Rank', 'Product Name', 'Code', 'Category', 'Quantity', 'NSV (₹)', 'GSV (₹)', 'Discount (₹)', 'Orders'];
      tableData = reportData.map((item, index) => [
        index + 1,
        item.productName || 'Unknown',
        item.productCode || 'N/A',
        item.categoryName || 'Unknown',
        item.totalQuantity.toLocaleString(),
        `₹${item.totalNSV.toLocaleString()}`,
        `₹${item.totalGSV.toLocaleString()}`,
        `₹${item.totalDiscount.toLocaleString()}`,
        item.recordCount
      ]);
      
    } else if (groupBy === 'store') {
      reportData = await analyticsService.getStorePerformanceAnalysis(filter);
      
      columns = ['Rank', 'Store Name', 'Store ID', 'City', 'Quantity', 'NSV (₹)', 'GSV (₹)', 'Discount (₹)', 'Tax (₹)', 'Orders'];
      tableData = reportData.map((item, index) => [
        index + 1,
        item.storeName || 'Unknown',
        item.storeId || 'N/A',
        item.city || 'Unknown',
        item.totalQuantity.toLocaleString(),
        `₹${item.totalNSV.toLocaleString()}`,
        `₹${item.totalGSV.toLocaleString()}`,
        `₹${item.totalDiscount.toLocaleString()}`,
        `₹${item.totalTax.toLocaleString()}`,
        item.recordCount
      ]);
      
    } else if (groupBy === 'date') {
      reportData = await analyticsService.getTimeBasedSalesTrends(filter);
      
      columns = ['Rank', 'Date', 'Quantity', 'NSV (₹)', 'GSV (₹)', 'Discount (₹)', 'Tax (₹)', 'Orders'];
      tableData = reportData.map((item, index) => [
        index + 1,
        new Date(item.date).toLocaleDateString(),
        item.totalQuantity.toLocaleString(),
        `₹${item.totalNSV.toLocaleString()}`,
        `₹${item.totalGSV.toLocaleString()}`,
        `₹${item.totalDiscount.toLocaleString()}`,
        `₹${item.totalTax.toLocaleString()}`,
        item.recordCount
      ]);
    }
    
    if (!reportData || reportData.length === 0) {
      return generateHTMLResponse('No Sales Data', 'No sales data found matching the specified criteria.');
    }
    
    // Generate table HTML
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📊 Sales Report</h3>
        <div class="report-info">
          <p><strong>Grouped by:</strong> ${groupBy}</p>
          ${city ? `<p><strong>City:</strong> ${city}</p>` : ''}
          ${category ? `<p><strong>Category:</strong> ${category}</p>` : ''}
          ${dateFrom || dateTo ? `<p><strong>Date Range:</strong> ${dateFrom || 'Start'} to ${dateTo || 'End'}</p>` : ''}
          <p><strong>Results:</strong> ${reportData.length} records</p>
        </div>
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                ${columns.map(col => `<th>${col}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${tableData.map(row => `
                <tr>
                  ${row.map(cell => `<td>${cell}</td>`).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <p class="summary">Sales report generated successfully with ${reportData.length} records.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getSalesReport:', error);
    return generateHTMLResponse('Error', `Failed to generate sales report: ${error.message}`);
  }
};

/**
 * Get comprehensive analytics dashboard using analytics service
 * @param {Object} params - Dashboard parameters
 * @returns {Promise<string>} HTML string with analytics dashboard
 */
export const getAnalyticsDashboard = async (params = {}) => {
  try {
    const { dateFrom, dateTo, city } = params;
    
    let filter = {};
    if (dateFrom || dateTo) {
      filter.dateFrom = dateFrom;
      filter.dateTo = dateTo;
    }
    
    // Get dashboard data using analytics service
    const dashboardData = await analyticsService.getAnalyticsDashboard(filter);
    
    if (!dashboardData) {
      return generateHTMLResponse('No Data Available', 'Analytics dashboard data not available.');
    }
    
    // Generate comprehensive dashboard HTML
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📊 Analytics Dashboard</h3>
        
        <!-- Summary KPIs -->
        ${dashboardData.summaryKPIs ? `
          <div class="kpi-grid">
            <div class="kpi-item">
              <div class="kpi-label">Total Quantity</div>
              <div class="kpi-value">${dashboardData.summaryKPIs.totalQuantity?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Total NSV</div>
              <div class="kpi-value">₹${dashboardData.summaryKPIs.totalNSV?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Total GSV</div>
              <div class="kpi-value">₹${dashboardData.summaryKPIs.totalGSV?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Total Discount</div>
              <div class="kpi-value">₹${dashboardData.summaryKPIs.totalDiscount?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Total Tax</div>
              <div class="kpi-value">₹${dashboardData.summaryKPIs.totalTax?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Orders</div>
              <div class="kpi-value">${dashboardData.summaryKPIs.recordCount?.toLocaleString() || '0'}</div>
            </div>
          </div>
        ` : ''}
        
        <!-- Top Products -->
        ${dashboardData.productPerformance && dashboardData.productPerformance.length > 0 ? `
          <div class="chart-container">
            <h4>🏆 Top Products</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Product Name</th>
                    <th>Code</th>
                    <th>Category</th>
                    <th>Quantity</th>
                    <th>NSV (₹)</th>
                    <th>GSV (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  ${dashboardData.productPerformance.slice(0, 5).map((product, index) => `
                    <tr>
                      <td>${index + 1}</td>
                      <td>${product.productName || 'Unknown'}</td>
                      <td>${product.productCode || 'N/A'}</td>
                      <td>${product.categoryName || 'Unknown'}</td>
                      <td>${product.totalQuantity.toLocaleString()}</td>
                      <td>₹${product.totalNSV.toLocaleString()}</td>
                      <td>₹${product.totalGSV.toLocaleString()}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        
        <!-- Top Stores -->
        ${dashboardData.storePerformance && dashboardData.storePerformance.length > 0 ? `
          <div class="chart-container">
            <h4>🏪 Top Stores</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Store Name</th>
                    <th>Store ID</th>
                    <th>City</th>
                    <th>Quantity</th>
                    <th>NSV (₹)</th>
                    <th>GSV (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  ${dashboardData.storePerformance.slice(0, 5).map((store, index) => `
                    <tr>
                      <td>${index + 1}</td>
                      <td>${store.storeName || 'Unknown'}</td>
                      <td>${store.storeId || 'N/A'}</td>
                      <td>${store.city || 'Unknown'}</td>
                      <td>${store.totalQuantity.toLocaleString()}</td>
                      <td>₹${store.totalNSV.toLocaleString()}</td>
                      <td>₹${store.totalGSV.toLocaleString()}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        
        <!-- Brand Performance -->
        ${dashboardData.brandPerformance && dashboardData.brandPerformance.length > 0 ? `
          <div class="chart-container">
            <h4>🏷️ Brand Performance</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Brand</th>
                    <th>Quantity</th>
                    <th>NSV (₹)</th>
                    <th>GSV (₹)</th>
                    <th>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  ${dashboardData.brandPerformance.slice(0, 5).map((brand, index) => `
                    <tr>
                      <td>${index + 1}</td>
                      <td>${brand.brandName || 'Unknown'}</td>
                      <td>${brand.totalQuantity.toLocaleString()}</td>
                      <td>₹${brand.totalNSV.toLocaleString()}</td>
                      <td>₹${brand.totalGSV.toLocaleString()}</td>
                      <td>${brand.recordCount}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        
        <p class="summary">Analytics dashboard generated successfully with comprehensive business insights.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getAnalyticsDashboard:', error);
    return generateHTMLResponse('Error', `Failed to generate analytics dashboard: ${error.message}`);
  }
};

/**
 * Get store performance analysis using analytics service
 * @param {Object} params - Store analysis parameters
 * @returns {Promise<string>} HTML string with store analysis
 */
export const getStoreAnalysis = async (params = {}) => {
  try {
    const { storeId, storeName, city, dateFrom, dateTo } = params;
    
    let filter = {};
    if (dateFrom || dateTo) {
      filter.dateFrom = dateFrom;
      filter.dateTo = dateTo;
    }
    
    let storeData = null;
    
    // Find store by ID, name, or city
    if (storeId) {
      storeData = await analyticsService.getIndividualStoreAnalysis({ ...filter, storeId });
    } else if (storeName || city) {
      const storeFilter = {};
      if (storeName) storeFilter.storeName = { $regex: storeName, $options: 'i' };
      if (city) storeFilter.city = { $regex: city, $options: 'i' };
      
      const stores = await Store.find(storeFilter).limit(1).lean();
      if (stores.length > 0) {
        storeData = await analyticsService.getIndividualStoreAnalysis({ ...filter, storeId: stores[0]._id });
      }
    }
    
    if (!storeData) {
      return generateHTMLResponse('Store Not Found', 'No store found matching the specified criteria.');
    }
    
    // Generate store analysis HTML
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🏪 Store Performance Analysis</h3>
        
        <!-- Store Info -->
        <div class="city-info">
          <p><strong>Store:</strong> ${storeData.storeInfo.storeName}</p>
          <p><strong>Store ID:</strong> ${storeData.storeInfo.storeId}</p>
          <p><strong>Address:</strong> ${storeData.storeInfo.address}</p>
          <p><strong>Contact:</strong> ${storeData.storeInfo.contactPerson}</p>
          <p><strong>Gross LTV:</strong> ₹${storeData.storeInfo.grossLTV.toLocaleString()}</p>
          <p><strong>Current Month Trend:</strong> ${storeData.storeInfo.currentMonthTrend}%</p>
        </div>
        
        <!-- Monthly Sales Analysis -->
        ${storeData.monthlySalesAnalysis && storeData.monthlySalesAnalysis.length > 0 ? `
          <div class="chart-container">
            <h4>📈 Monthly Sales Analysis</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>NSV (₹)</th>
                    <th>Quantity</th>
                    <th>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  ${storeData.monthlySalesAnalysis.slice(0, 6).map((month) => `
                    <tr>
                      <td>${new Date(month.month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</td>
                      <td>₹${month.totalNSV.toLocaleString()}</td>
                      <td>${month.totalQuantity.toLocaleString()}</td>
                      <td>${month.totalOrders}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        
        <!-- Top Products in Store -->
        ${storeData.productSalesAnalysis && storeData.productSalesAnalysis.length > 0 ? `
          <div class="chart-container">
            <h4>📦 Top Products in Store</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Product Name</th>
                    <th>Code</th>
                    <th>NSV (₹)</th>
                    <th>Quantity</th>
                    <th>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  ${storeData.productSalesAnalysis.slice(0, 5).map((product, index) => `
                    <tr>
                      <td>${index + 1}</td>
                      <td>${product.productName || 'Unknown'}</td>
                      <td>${product.productCode || 'N/A'}</td>
                      <td>₹${product.totalNSV.toLocaleString()}</td>
                      <td>${product.totalQuantity.toLocaleString()}</td>
                      <td>${product.totalOrders}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        
        <p class="summary">Store analysis completed for ${storeData.storeInfo.storeName}.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getStoreAnalysis:', error);
    return generateHTMLResponse('Error', `Failed to generate store analysis: ${error.message}`);
  }
};

/**
 * Generate HTML response wrapper
 * @param {string} title - Response title
 * @param {string} content - Response content
 * @returns {string} Formatted HTML
 */
const generateHTMLResponse = (title, content) => {
  return AI_TOOL_STYLES + `
    <div class="ai-tool-response">
      <h3>${title}</h3>
      <div class="response-content">
        <p>${content}</p>
      </div>
    </div>
  `;
};

/**
 * Enhanced intent detection for AI tool calling
 * @param {string} question - User's question
 * @returns {Object|null} Intent object or null if no match
 */
export const detectIntent = (question) => {
  const normalizedQuestion = question.toLowerCase().trim();
  
  // Intent patterns
  const intents = [
    {
      pattern: /top\s+products\s+(?:in\s+)?([a-zA-Z\s,]+)/i,
      action: 'getTopProductsInCity',
      extractParams: (match) => ({ city: match[1].trim() }),
      description: 'Get top products in a specific city'
    },
    {
      pattern: /top\s+\d*\s*products/i,
      action: 'getTopProducts',
      extractParams: () => ({}),
      description: 'Get top products across all stores'
    },
    {
      pattern: /how\s+many\s+products|product\s+count|total\s+products/i,
      action: 'getProductCount',
      extractParams: () => ({}),
      description: 'Get total product count'
    },
    {
      pattern: /sales\s+report|sales\s+data|sales\s+summary/i,
      action: 'getSalesReport',
      extractParams: () => ({}),
      description: 'Get sales report'
    },
    {
      pattern: /analytics\s+dashboard|dashboard|business\s+insights/i,
      action: 'getAnalyticsDashboard',
      extractParams: () => ({}),
      description: 'Get comprehensive analytics dashboard'
    },
    {
      pattern: /store\s+analysis|store\s+performance|store\s+report/i,
      action: 'getStoreAnalysis',
      extractParams: () => ({}),
      description: 'Get store performance analysis'
    },
    {
      pattern: /products\s+in\s+([a-zA-Z\s,]+)/i,
      action: 'getTopProductsInCity',
      extractParams: (match) => ({ city: match[1].trim() }),
      description: 'Get products in a specific city'
    },
    {
      pattern: /best\s+selling\s+products/i,
      action: 'getTopProducts',
      extractParams: () => ({}),
      description: 'Get best selling products'
    },
    {
      pattern: /inventory\s+summary|product\s+inventory/i,
      action: 'getProductCount',
      extractParams: () => ({}),
      description: 'Get product inventory summary'
    },
    {
      pattern: /sales\s+trend|trend\s+for|monthly\s+sales/i,
      action: 'getSalesReport',
      extractParams: () => ({}),
      description: 'Get sales trend analysis'
    },
    {
      pattern: /top\s+stores|stores\s+by\s+performance|store\s+ranking/i,
      action: 'getStoreAnalysis',
      extractParams: () => ({}),
      description: 'Get top stores by performance'
    },
    {
      pattern: /brand\s+performance|brand\s+data|brand\s+analysis/i,
      action: 'getAnalyticsDashboard',
      extractParams: () => ({}),
      description: 'Get brand performance analysis'
    }
  ];
  
  // Check each intent pattern
  for (const intent of intents) {
    const match = normalizedQuestion.match(intent.pattern);
    if (match) {
      return {
        action: intent.action,
        params: intent.extractParams(match),
        description: intent.description,
        confidence: 0.9
      };
    }
  }
  
  return null;
};

/**
 * Execute AI tool based on detected intent
 * @param {Object} intent - Detected intent object
 * @returns {Promise<string>} HTML response
 */
export const executeAITool = async (intent) => {
  try {
    switch (intent.action) {
      case 'getTopProducts':
        return await getTopProducts(intent.params.city);
      case 'getProductCount':
        return await getProductCount();
      case 'getTopProductsInCity':
        return await getTopProductsInCity(intent.params.city);
      case 'getSalesReport':
        return await getSalesReport(intent.params);
      case 'getAnalyticsDashboard':
        return await getAnalyticsDashboard(intent.params);
      case 'getStoreAnalysis':
        return await getStoreAnalysis(intent.params);
      default:
        throw new Error(`Unknown action: ${intent.action}`);
    }
  } catch (error) {
    console.error('Error executing AI tool:', error);
    return generateHTMLResponse('Error', `Failed to execute ${intent.action}: ${error.message}`);
  }
};

export default {
  getTopProducts,
  getProductCount,
  getTopProductsInCity,
  getSalesReport,
  getAnalyticsDashboard,
  getStoreAnalysis,
  detectIntent,
  executeAITool
};
