import fetch from 'node-fetch';
import logger from '../../config/logger.js';

/**
 * Fetch orders from Flipkart Seller API
 * @param {Object} options - Fetch options
 * @param {Date} options.startDate - Start date for fetching orders
 * @param {Date} options.endDate - End date for fetching orders
 * @param {number} options.limit - Maximum number of orders to fetch
 * @returns {Promise<Array>} Array of raw order objects from Flipkart API
 */
const fetchOrders = async ({ startDate, endDate, limit = 100 }) => {
  try {
    const flipkartConfig = {
      clientId: process.env.FLIPKART_CLIENT_ID || '',
      clientSecret: process.env.FLIPKART_CLIENT_SECRET || '',
      baseUrl: process.env.FLIPKART_API_BASE_URL || 'https://api.flipkart.net',
    };

    if (!flipkartConfig.clientId || !flipkartConfig.clientSecret) {
      throw new Error('Flipkart API credentials not configured');
    }

    // Flipkart API requires OAuth 2.0 authentication
    // First, get access token
    const tokenUrl = `${flipkartConfig.baseUrl}/oauth/token`;
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'Seller_Api',
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(`Flipkart token error: ${tokenResponse.status}`);
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Fetch orders using the access token
    const ordersUrl = `${flipkartConfig.baseUrl}/v2/orders`;
    const params = new URLSearchParams({
      startDate: startDate ? startDate.toISOString().split('T')[0] : new Date(Date.now() - 86400000).toISOString().split('T')[0],
      endDate: endDate ? endDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      limit: Math.min(limit, 100).toString(),
    });

    const response = await fetch(`${ordersUrl}?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Flipkart API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.orderItems || [];
  } catch (error) {
    logger.error('Error fetching orders from Flipkart:', error);
    throw error;
  }
};

/**
 * Normalize Flipkart order to internal schema
 * @param {Object} flipkartOrder - Raw order from Flipkart API
 * @returns {Object} Normalized order object
 */
const normalizeOrder = (flipkartOrder) => {
  const shippingAddress = flipkartOrder.shippingAddress || {};
  const customerDetails = flipkartOrder.customerDetails || {};
  
  return {
    source: 'Flipkart',
    externalOrderId: flipkartOrder.orderId || flipkartOrder.id || '',
    customer: {
      name: customerDetails.name || shippingAddress.name || 'Flipkart Customer',
      phone: customerDetails.phone || shippingAddress.phone || '',
      email: customerDetails.email || '',
      address: {
        street: shippingAddress.addressLine1 || '',
        city: shippingAddress.city || '',
        state: shippingAddress.state || '',
        country: shippingAddress.country || 'India',
        zipCode: shippingAddress.pincode || shippingAddress.zipCode || '',
        addressLine1: shippingAddress.addressLine1 || '',
        addressLine2: shippingAddress.addressLine2 || '',
      },
    },
    items: (flipkartOrder.orderItems || [flipkartOrder]).map((item) => ({
      sku: item.sellerSku || item.sku || '',
      name: item.productTitle || item.title || 'Unknown Product',
      quantity: parseInt(item.quantity || 1, 10),
      price: parseFloat(item.price || item.sellingPrice || 0),
    })),
    payment: {
      method: 'Flipkart Payment',
      status: flipkartOrder.paymentStatus === 'PAID' ? 'completed' : 'pending',
      amount: parseFloat(flipkartOrder.totalAmount || flipkartOrder.orderValue || 0),
    },
    logistics: {
      status: getLogisticsStatus(flipkartOrder.status),
      trackingId: flipkartOrder.trackingId || flipkartOrder.awbNumber || '',
      warehouse: flipkartOrder.warehouse || '',
      picker: flipkartOrder.pickerId || '',
    },
    orderStatus: getOrderStatus(flipkartOrder.status),
    timestamps: {
      createdAt: new Date(flipkartOrder.orderDate || flipkartOrder.createdAt),
      updatedAt: new Date(flipkartOrder.lastUpdated || flipkartOrder.updatedAt || flipkartOrder.orderDate),
    },
    meta: {
      orderType: flipkartOrder.orderType,
      fulfillmentType: flipkartOrder.fulfillmentType,
      originalData: flipkartOrder,
    },
  };
};

/**
 * Map Flipkart order status to logistics status
 */
const getLogisticsStatus = (status) => {
  const statusMap = {
    PENDING: 'pending',
    CONFIRMED: 'picked',
    PACKED: 'packed',
    SHIPPED: 'shipped',
    DELIVERED: 'delivered',
    CANCELLED: 'cancelled',
    RETURNED: 'delivered',
  };
  return statusMap[status?.toUpperCase()] || 'pending';
};

/**
 * Map Flipkart order status to internal order status
 */
const getOrderStatus = (status) => {
  const statusMap = {
    PENDING: 'pending',
    CONFIRMED: 'processing',
    PACKED: 'processing',
    SHIPPED: 'processing',
    DELIVERED: 'completed',
    CANCELLED: 'cancelled',
    RETURNED: 'refunded',
  };
  return statusMap[status?.toUpperCase()] || 'pending';
};

export { fetchOrders, normalizeOrder };
