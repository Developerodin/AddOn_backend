import Product from '../../models/product.model.js';

/**
 * Resolve product name and image by SKU (softwareCode or internalCode)
 * @param {string} sku
 * @returns {Promise<{ name: string, image?: string, softwareCode?: string }|null>}
 */
export const resolveProductBySku = async (sku) => {
  if (!sku) return null;
  const product = await Product.findOne({
    $or: [{ softwareCode: sku }, { internalCode: sku }],
    status: 'active',
  }).select('name image softwareCode internalCode');
  if (!product) return null;
  return {
    name: product.name,
    image: product.image,
    softwareCode: product.softwareCode || product.internalCode,
  };
};

/**
 * Resolve product by id
 * @param {mongoose.Types.ObjectId} productId
 * @returns {Promise<{ name: string, image?: string, softwareCode?: string }|null>}
 */
export const resolveProductById = async (productId) => {
  if (!productId) return null;
  const product = await Product.findById(productId).select('name image softwareCode internalCode');
  if (!product) return null;
  return {
    name: product.name,
    image: product.image,
    softwareCode: product.softwareCode || product.internalCode,
  };
};

/**
 * Enrich items with product name/image (items have sku or productId)
 * @param {Array<{ sku?: string, productId?: string, name?: string, image?: string }>} items
 * @returns {Promise<Array>}
 */
export const enrichItemsWithProduct = async (items) => {
  if (!items || !items.length) return items;
  const enriched = await Promise.all(
    items.map(async (item) => {
      let resolved = null;
      if (item.productId) resolved = await resolveProductById(item.productId);
      if (!resolved && item.sku) resolved = await resolveProductBySku(item.sku);
      return {
        ...item,
        name: resolved?.name ?? item.name ?? item.sku,
        ...(resolved?.image && { image: resolved.image }),
      };
    })
  );
  return enriched;
};
