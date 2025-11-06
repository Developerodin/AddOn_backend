import fetch from 'node-fetch';
import config from '../../config/config.js';
import logger from '../../config/logger.js';

/**
 * Fetch orders from Medusa-based website backend
 * @param {Object} options - Fetch options
 * @param {Date} options.startDate - Start date for fetching orders
 * @param {Date} options.endDate - End date for fetching orders
 * @param {number} options.limit - Maximum number of orders to fetch
 * @returns {Promise<Array>} Array of raw order objects from Medusa API
 */
const fetchOrders = async ({ startDate, endDate, limit = 100 }) => {
  try {
    const medusaBaseUrl = process.env.MEDUSA_BACKEND_URL || 'http://localhost:9000';
    const medusaApiKey = process.env.MEDUSA_API_KEY || '';
    
    const url = new URL(`${medusaBaseUrl}/admin/orders`);
    url.searchParams.append('limit', limit.toString());
    if (startDate) {
      url.searchParams.append('created_at[gte]', startDate.toISOString());
    }
    if (endDate) {
      url.searchParams.append('created_at[lte]', endDate.toISOString());
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${medusaApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Medusa API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.orders || [];
  } catch (error) {
    logger.error('Error fetching orders from website:', error);
    throw error;
  }
};

/**
 * Normalize Medusa order to internal schema
 * @param {Object} medusaOrder - Raw order from Medusa API
 * @returns {Object} Normalized order object
 */
const normalizeOrder = (medusaOrder) => {
  const customer = medusaOrder.customer || {};
  const shippingAddress = medusaOrder.shipping_address || {};
  
  return {
    source: 'Website',
    externalOrderId: medusaOrder.id || medusaOrder.display_id?.toString(),
    customer: {
      name: `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Guest',
      phone: customer.phone || shippingAddress.phone || '',
      email: customer.email || medusaOrder.email || '',
      address: {
        street: shippingAddress.address_1 || '',
        city: shippingAddress.city || '',
        state: shippingAddress.province || '',
        country: shippingAddress.country_code || '',
        zipCode: shippingAddress.postal_code || '',
        addressLine1: shippingAddress.address_1 || '',
        addressLine2: shippingAddress.address_2 || '',
      },
    },
    items: (medusaOrder.items || []).map((item) => ({
      sku: item.variant?.sku || item.variant_id || '',
      name: item.title || item.variant?.title || 'Unknown Product',
      quantity: item.quantity || 1,
      price: item.unit_price / 100 || 0, // Medusa stores prices in cents
    })),
    payment: {
      method: medusaOrder.payment_method || 'unknown',
      status: medusaOrder.payment_status === 'captured' ? 'completed' : 'pending',
      amount: medusaOrder.total / 100 || 0,
    },
    logistics: {
      status: getLogisticsStatus(medusaOrder.fulfillment_status),
      trackingId: medusaOrder.fulfillments?.[0]?.tracking_numbers?.[0] || '',
      warehouse: medusaOrder.metadata?.warehouse || '',
      picker: medusaOrder.metadata?.picker || '',
    },
    orderStatus: getOrderStatus(medusaOrder.status),
    timestamps: {
      createdAt: new Date(medusaOrder.created_at),
      updatedAt: new Date(medusaOrder.updated_at || medusaOrder.created_at),
    },
    meta: {
      displayId: medusaOrder.display_id,
      region: medusaOrder.region,
      currency: medusaOrder.currency_code,
      originalData: medusaOrder,
    },
  };
};

/**
 * Map Medusa fulfillment status to logistics status
 */
const getLogisticsStatus = (fulfillmentStatus) => {
  const statusMap = {
    not_fulfilled: 'pending',
    partially_fulfilled: 'picked',
    fulfilled: 'shipped',
    partially_shipped: 'picked',
    shipped: 'shipped',
    partially_returned: 'shipped',
    returned: 'delivered',
    canceled: 'cancelled',
  };
  return statusMap[fulfillmentStatus] || 'pending';
};

/**
 * Map Medusa order status to internal order status
 */
const getOrderStatus = (status) => {
  const statusMap = {
    pending: 'pending',
    completed: 'completed',
    archived: 'completed',
    canceled: 'cancelled',
    requires_action: 'processing',
  };
  return statusMap[status] || 'pending';
};

export { fetchOrders, normalizeOrder };
