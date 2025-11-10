import fetch from 'node-fetch';
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
    // Expand variant details to get SKU information
    url.searchParams.append('expand', 'items.variant');
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
  
  // Handle Medusa v2 structure - total can be in summary.accounting_total or total
  const orderTotal = medusaOrder.summary?.accounting_total || 
                     medusaOrder.summary?.current_order_total || 
                     medusaOrder.total || 0;
  
  // Convert from smallest currency unit (cents/paisa) to dollars
  const totalAmount = typeof orderTotal === 'number' ? orderTotal / 100 : 0;
  
  return {
    source: 'Website',
    externalOrderId: medusaOrder.id || medusaOrder.display_id?.toString(),
    customer: {
      name: `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 
             `${shippingAddress.first_name || ''} ${shippingAddress.last_name || ''}`.trim() || 
             'Guest',
      phone: customer.phone || shippingAddress.phone || medusaOrder.phone || '',
      email: customer.email || medusaOrder.email || '',
      address: {
        street: shippingAddress.address_1 || '',
        city: shippingAddress.city || '',
        state: shippingAddress.province || shippingAddress.state || '',
        country: shippingAddress.country_code || shippingAddress.country || '',
        zipCode: shippingAddress.postal_code || shippingAddress.zip || '',
        addressLine1: shippingAddress.address_1 || '',
        addressLine2: shippingAddress.address_2 || '',
      },
    },
    items: (medusaOrder.items || []).map((item) => {
      // Handle Medusa v2 - SKU can be at item level or in expanded variant
      // Try multiple possible locations for SKU (prefer actual SKU fields)
      let sku = item.variant_sku || 
                item.variant?.sku || 
                item.variant?.product?.variants?.[0]?.sku ||
                item.sku ||
                item.product?.variants?.[0]?.sku;
      
      // If no SKU found, use variant/product IDs as fallback identifiers
      if (!sku || (typeof sku === 'string' && sku.trim() === '')) {
        sku = item.variant_id || 
              item.variant?.id || 
              item.product_id || 
              item.id;
        
        // If still no identifier, generate a unique fallback
        if (!sku || (typeof sku === 'string' && sku.trim() === '')) {
          sku = `FALLBACK-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        }
        
        logger.warn(`Missing SKU for item ${item.id || 'unknown'}, using identifier: ${sku}`);
      }
      
      const itemPrice = item.unit_price || item.price || 0;
      const price = typeof itemPrice === 'number' ? itemPrice / 100 : 0; // Convert cents to dollars
      
      return {
        sku: String(sku).trim(),
        name: item.title || item.product_title || item.variant?.title || 'Unknown Product',
        quantity: item.quantity || 1,
        price,
      };
    }),
    payment: {
      method: medusaOrder.payment_method || 
              medusaOrder.payments?.[0]?.provider_id || 
              'unknown',
      status: getPaymentStatus(medusaOrder.payment_status),
      amount: totalAmount,
    },
    logistics: {
      status: getLogisticsStatus(medusaOrder.fulfillment_status),
      trackingId: medusaOrder.fulfillments?.[0]?.tracking_numbers?.[0] || 
                  medusaOrder.shipments?.[0]?.tracking_number || 
                  '',
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
      currency: medusaOrder.currency_code || medusaOrder.currency || 'USD',
      originalData: medusaOrder,
    },
  };
};

/**
 * Map Medusa payment status to internal payment status
 */
const getPaymentStatus = (paymentStatus) => {
  const statusMap = {
    not_paid: 'pending',
    awaiting: 'pending',
    authorized: 'pending',
    captured: 'completed',
    partially_captured: 'completed',
    partially_refunded: 'completed',
    refunded: 'refunded',
    canceled: 'failed',
    requires_action: 'pending',
  };
  return statusMap[paymentStatus] || 'pending';
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

/**
 * Update the status of a Medusa order via admin endpoints
 * @param {Object} options
 * @param {string} options.orderId - Medusa order id (e.g. order_01K8ZXHQMJRQ9VEBEZPVSX42K0)
 * @param {('cancel'|'complete'|'archive'|'cancelled'|'completed'|'archived')} options.status - Desired status/action
 * @returns {Promise<Object>} Updated Medusa order response
 */
const updateOrderStatus = async ({ orderId, status }) => {
  if (!orderId) {
    throw new Error('orderId is required to update website order status');
  }

  const actionMap = {
    cancel: 'cancel',
    cancelled: 'cancel',
    canceled: 'cancel',
    complete: 'complete',
    completed: 'complete',
    archive: 'archive',
    archived: 'archive',
  };

  const action = actionMap[status];

  if (!action) {
    throw new Error(`Unsupported status update for website order: ${status}`);
  }

  const medusaBaseUrl = process.env.MEDUSA_BACKEND_URL || 'http://localhost:9000';
  const medusaApiKey = process.env.MEDUSA_API_KEY || '';

  const endpoint = `${medusaBaseUrl}/admin/orders/${orderId}/${action}`;

  const requestHeaders = {
    'Authorization': `Bearer ${medusaApiKey}`,
    'Content-Type': 'application/json',
  };

  logger.debug(
    `Sending Medusa order status update ${JSON.stringify({
      orderId,
      requestedStatus: status,
      action,
      endpoint,
      medusaBaseUrl,
      hasApiKey: Boolean(medusaApiKey),
      apiKeyLength: medusaApiKey ? medusaApiKey.length : 0,
      headers: {
        ...requestHeaders,
        Authorization: medusaApiKey ? `Bearer ${medusaApiKey.substring(0, 10)}...` : 'Bearer (missing)',
      },
    })}`
  );

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify({}), // Send empty body as some APIs expect it
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      `Error updating website order status ${JSON.stringify({
        orderId,
        status,
        action,
        statusCode: response.status,
        statusText: response.statusText,
        requestUrl: endpoint,
        responseUrl: response.url,
        body: errorBody,
        headers: Object.fromEntries(response.headers.entries()),
      })}`
    );
    throw new Error(`Failed to update order ${orderId} status to ${status}: ${response.status} ${response.statusText}`);
  }

  const updatedOrder = await response.json();
  logger.debug(
    `Received Medusa order status update response ${JSON.stringify({
      orderId,
      action,
      responseKeys: updatedOrder && typeof updatedOrder === 'object' ? Object.keys(updatedOrder) : null,
    })}`
  );
  logger.info(`Updated website order ${orderId} status via ${action}`);
  return updatedOrder;
};

export { fetchOrders, normalizeOrder, updateOrderStatus };
