import fetch from 'node-fetch';
import crypto from 'crypto';
import logger from '../../config/logger.js';

/**
 * Fetch orders from Amazon Seller Partner API
 * @param {Object} options - Fetch options
 * @param {Date} options.startDate - Start date for fetching orders
 * @param {Date} options.endDate - End date for fetching orders
 * @param {number} options.limit - Maximum number of orders to fetch
 * @returns {Promise<Array>} Array of raw order objects from Amazon API
 */
const fetchOrders = async ({ startDate, endDate, limit = 100 }) => {
  try {
    const amazonConfig = {
      marketplaceId: process.env.AMAZON_MARKETPLACE_ID || '',
      accessKey: process.env.AMAZON_ACCESS_KEY || '',
      secretKey: process.env.AMAZON_SECRET_KEY || '',
      sellerId: process.env.AMAZON_SELLER_ID || '',
      region: process.env.AMAZON_REGION || 'us-east-1',
    };

    if (!amazonConfig.accessKey || !amazonConfig.secretKey) {
      throw new Error('Amazon API credentials not configured');
    }

    // Amazon SP-API requires OAuth 2.0 or IAM authentication
    // This is a simplified version - in production, use AWS SDK or proper OAuth flow
    const endpoint = `https://sellingpartnerapi-${amazonConfig.region}.amazon.com/orders/v0/orders`;
    
    const params = new URLSearchParams({
      MarketplaceIds: amazonConfig.marketplaceId,
      CreatedAfter: startDate ? startDate.toISOString() : new Date(Date.now() - 86400000).toISOString(),
      CreatedBefore: endDate ? endDate.toISOString() : new Date().toISOString(),
      MaxResultsPerPage: Math.min(limit, 100).toString(),
    });

    // For production, implement proper AWS Signature Version 4 signing
    // This is a placeholder that shows the structure
    const url = `${endpoint}?${params.toString()}`;
    
    // NOTE: In production, you need to:
    // 1. Get LWA (Login with Amazon) access token
    // 2. Sign the request with AWS Signature Version 4
    // 3. Use AWS SDK or a library like amazon-sp-api
    
    logger.warn('Amazon API integration requires proper OAuth and AWS signing. Using mock data structure.');
    
    // Placeholder - replace with actual API call
    return [];
  } catch (error) {
    logger.error('Error fetching orders from Amazon:', error);
    throw error;
  }
};

/**
 * Normalize Amazon order to internal schema
 * @param {Object} amazonOrder - Raw order from Amazon API
 * @returns {Object} Normalized order object
 */
const normalizeOrder = (amazonOrder) => {
  const shippingAddress = amazonOrder.ShippingAddress || {};
  const buyerInfo = amazonOrder.BuyerInfo || {};
  
  return {
    source: 'Amazon',
    externalOrderId: amazonOrder.AmazonOrderId || '',
    customer: {
      name: buyerInfo.BuyerName || shippingAddress.Name || 'Amazon Customer',
      phone: buyerInfo.BuyerPhone || shippingAddress.Phone || '',
      email: buyerInfo.BuyerEmail || '',
      address: {
        street: shippingAddress.AddressLine1 || '',
        city: shippingAddress.City || '',
        state: shippingAddress.StateOrRegion || '',
        country: shippingAddress.CountryCode || '',
        zipCode: shippingAddress.PostalCode || '',
        addressLine1: shippingAddress.AddressLine1 || '',
        addressLine2: shippingAddress.AddressLine2 || '',
      },
    },
    items: (amazonOrder.OrderItems || []).map((item) => ({
      sku: item.SellerSKU || item.ASIN || '',
      name: item.Title || 'Unknown Product',
      quantity: parseInt(item.QuantityOrdered || 1, 10),
      price: parseFloat(item.ItemPrice?.Amount || 0),
    })),
    payment: {
      method: 'Amazon Pay',
      status: amazonOrder.OrderStatus === 'Shipped' || amazonOrder.OrderStatus === 'Delivered' ? 'completed' : 'pending',
      amount: parseFloat(amazonOrder.OrderTotal?.Amount || 0),
    },
    logistics: {
      status: getLogisticsStatus(amazonOrder.OrderStatus),
      trackingId: amazonOrder.EasyShipShipmentStatus?.TrackingId || '',
      warehouse: amazonOrder.FulfillmentChannel === 'AFN' ? 'Amazon FBA' : 'Merchant',
      picker: '',
    },
    orderStatus: getOrderStatus(amazonOrder.OrderStatus),
    timestamps: {
      createdAt: new Date(amazonOrder.PurchaseDate),
      updatedAt: new Date(amazonOrder.LastUpdateDate || amazonOrder.PurchaseDate),
    },
    meta: {
      marketplaceId: amazonOrder.MarketplaceId,
      fulfillmentChannel: amazonOrder.FulfillmentChannel,
      orderType: amazonOrder.OrderType,
      originalData: amazonOrder,
    },
  };
};

/**
 * Map Amazon order status to logistics status
 */
const getLogisticsStatus = (orderStatus) => {
  const statusMap = {
    Pending: 'pending',
    Unshipped: 'pending',
    PartiallyShipped: 'picked',
    Shipped: 'shipped',
    Delivered: 'delivered',
    Canceled: 'cancelled',
    Unfulfillable: 'cancelled',
  };
  return statusMap[orderStatus] || 'pending';
};

/**
 * Map Amazon order status to internal order status
 */
const getOrderStatus = (status) => {
  const statusMap = {
    Pending: 'pending',
    Unshipped: 'processing',
    PartiallyShipped: 'processing',
    Shipped: 'processing',
    Delivered: 'completed',
    Canceled: 'cancelled',
    Unfulfillable: 'cancelled',
  };
  return statusMap[status] || 'pending';
};

export { fetchOrders, normalizeOrder };
