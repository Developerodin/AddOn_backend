import fetch from 'node-fetch';
import logger from '../../config/logger.js';

/**
 * Fetch orders from Blinkit API
 * @param {Object} options - Fetch options
 * @param {Date} options.startDate - Start date for fetching orders
 * @param {Date} options.endDate - End date for fetching orders
 * @param {number} options.limit - Maximum number of orders to fetch
 * @returns {Promise<Array>} Array of raw order objects from Blinkit API
 */
const fetchOrders = async ({ startDate, endDate, limit = 100 }) => {
  try {
    const blinkitConfig = {
      apiKey: process.env.BLINKIT_API_KEY || '',
      baseUrl: process.env.BLINKIT_API_BASE_URL || 'https://api.blinkit.com',
      partnerId: process.env.BLINKIT_PARTNER_ID || '',
    };

    if (!blinkitConfig.apiKey || !blinkitConfig.partnerId) {
      throw new Error('Blinkit API credentials not configured');
    }

    // Blinkit API typically uses API key authentication
    const ordersUrl = `${blinkitConfig.baseUrl}/v1/orders`;
    const params = new URLSearchParams({
      partner_id: blinkitConfig.partnerId,
      start_date: startDate ? startDate.toISOString().split('T')[0] : new Date(Date.now() - 86400000).toISOString().split('T')[0],
      end_date: endDate ? endDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      limit: Math.min(limit, 100).toString(),
    });

    const response = await fetch(`${ordersUrl}?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${blinkitConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Blinkit API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.orders || data.data || [];
  } catch (error) {
    logger.error('Error fetching orders from Blinkit:', error);
    throw error;
  }
};

/**
 * Normalize Blinkit order to internal schema
 * @param {Object} blinkitOrder - Raw order from Blinkit API
 * @returns {Object} Normalized order object
 */
const normalizeOrder = (blinkitOrder) => {
  const deliveryAddress = blinkitOrder.deliveryAddress || blinkitOrder.address || {};
  const customer = blinkitOrder.customer || {};
  
  return {
    source: 'Blinkit',
    externalOrderId: blinkitOrder.orderId || blinkitOrder.id || blinkitOrder.order_id || '',
    customer: {
      name: customer.name || deliveryAddress.name || 'Blinkit Customer',
      phone: customer.phone || deliveryAddress.phone || blinkitOrder.customerPhone || '',
      email: customer.email || '',
      address: {
        street: deliveryAddress.street || deliveryAddress.addressLine1 || '',
        city: deliveryAddress.city || '',
        state: deliveryAddress.state || '',
        country: deliveryAddress.country || 'India',
        zipCode: deliveryAddress.pincode || deliveryAddress.zipCode || deliveryAddress.postalCode || '',
        addressLine1: deliveryAddress.addressLine1 || deliveryAddress.street || '',
        addressLine2: deliveryAddress.addressLine2 || '',
      },
    },
    items: (blinkitOrder.items || blinkitOrder.orderItems || []).map((item) => ({
      sku: item.sku || item.productId || '',
      name: item.name || item.productName || 'Unknown Product',
      quantity: parseInt(item.quantity || 1, 10),
      price: parseFloat(item.price || item.unitPrice || 0),
    })),
    payment: {
      method: blinkitOrder.paymentMethod || 'Blinkit Payment',
      status: blinkitOrder.paymentStatus === 'PAID' || blinkitOrder.paymentStatus === 'SUCCESS' ? 'completed' : 'pending',
      amount: parseFloat(blinkitOrder.totalAmount || blinkitOrder.orderValue || blinkitOrder.total || 0),
    },
    logistics: {
      status: getLogisticsStatus(blinkitOrder.status),
      trackingId: blinkitOrder.trackingId || blinkitOrder.trackingNumber || '',
      warehouse: blinkitOrder.warehouse || blinkitOrder.storeId || '',
      picker: blinkitOrder.deliveryPartner || '',
    },
    orderStatus: getOrderStatus(blinkitOrder.status),
    timestamps: {
      createdAt: new Date(blinkitOrder.createdAt || blinkitOrder.orderDate || blinkitOrder.created_at),
      updatedAt: new Date(blinkitOrder.updatedAt || blinkitOrder.lastUpdated || blinkitOrder.updated_at || blinkitOrder.createdAt),
    },
    meta: {
      slotTime: blinkitOrder.slotTime,
      deliverySlot: blinkitOrder.deliverySlot,
      originalData: blinkitOrder,
    },
  };
};

/**
 * Map Blinkit order status to logistics status
 */
const getLogisticsStatus = (status) => {
  const statusMap = {
    PENDING: 'pending',
    CONFIRMED: 'picked',
    PACKED: 'packed',
    OUT_FOR_DELIVERY: 'shipped',
    DELIVERED: 'delivered',
    CANCELLED: 'cancelled',
    RETURNED: 'delivered',
  };
  return statusMap[status?.toUpperCase()] || 'pending';
};

/**
 * Map Blinkit order status to internal order status
 */
const getOrderStatus = (status) => {
  const statusMap = {
    PENDING: 'pending',
    CONFIRMED: 'processing',
    PACKED: 'processing',
    OUT_FOR_DELIVERY: 'processing',
    DELIVERED: 'completed',
    CANCELLED: 'cancelled',
    RETURNED: 'refunded',
  };
  return statusMap[status?.toUpperCase()] || 'pending';
};

export { fetchOrders, normalizeOrder };
