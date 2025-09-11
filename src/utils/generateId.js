/**
 * Generate unique order number
 * @returns {Promise<string>}
 */
export const generateOrderNumber = async () => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 7);
  return `ORD-${timestamp}-${random}`.toUpperCase();
};

/**
 * Generate unique article number
 * @returns {Promise<string>}
 */
export const generateArticleNumber = async () => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 5);
  return `ART${timestamp}${random}`.toUpperCase();
};

/**
 * Generate unique supervisor ID
 * @returns {Promise<string>}
 */
export const generateSupervisorId = async () => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `SUP-${timestamp}-${random}`.toUpperCase();
};
