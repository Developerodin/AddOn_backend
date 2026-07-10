/** Required Trade client fields for a complete website-linked profile. */
export const TRADE_REQUIRED_WEB_SYNC_FIELDS = Object.freeze([
  'retailerName',
  'mobilePhone',
  'email',
  'gstin',
  'address',
  'city',
  'state',
  'zipCode',
]);

/**
 * Normalize a string field from website payload.
 * @param {unknown} value
 * @returns {string}
 */
const str = (value) => String(value ?? '').trim();

/**
 * Build Trade client root fields from a website customer payload.
 * @param {object} customer
 * @returns {Record<string, string>}
 */
export const buildClientPatchFromWebsite = (customer) => {
  const opencartCustomerId = Number(customer?.opencartCustomerId) || 0;
  const companyName = str(customer?.companyName || customer?.retailerName);
  const email = str(customer?.email).toLowerCase();

  return {
    retailerName: companyName,
    contactPerson: str(customer?.contactPerson),
    mobilePhone: str(customer?.telephone || customer?.mobilePhone),
    email,
    address: str(customer?.address1 || customer?.address || customer?.shippingAddress1),
    city: str(customer?.city || customer?.shippingCity),
    zipCode: str(customer?.postcode || customer?.zipCode || customer?.shippingPostcode),
    state: str(customer?.zone || customer?.state || customer?.shippingZone),
    gstin: str(customer?.gstin),
    parentKeyCode: opencartCustomerId ? `OC-${opencartCustomerId}` : '',
  };
};

/**
 * List missing required Trade fields on a client document or plain object.
 * @param {object} client
 * @returns {string[]}
 */
export const getTradeClientIncompleteFields = (client) => {
  if (!client) return [...TRADE_REQUIRED_WEB_SYNC_FIELDS];
  const missing = [];
  for (const key of TRADE_REQUIRED_WEB_SYNC_FIELDS) {
    const val = str(client[key]);
    if (!val) missing.push(key);
  }
  return missing;
};

/**
 * Merge non-empty website values into empty client fields (does not overwrite existing data).
 * @param {import('mongoose').Document} client
 * @param {Record<string, string>} patch
 * @returns {boolean} whether any field changed
 */
export const mergeWebsiteFieldsIntoClient = (client, patch) => {
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (!value) continue;
    const current = str(client[key]);
    if (!current) {
      client[key] = value;
      changed = true;
    }
  }
  return changed;
};

/**
 * Build client meta for addonweb-sourced Trade clients.
 * @param {object} customer
 * @param {boolean} autoCreated
 * @param {string[]} incompleteFields
 * @returns {object}
 */
export const buildWebsiteClientMeta = (customer, autoCreated, incompleteFields) => ({
  source: 'addonweb',
  opencartCustomerId: Number(customer?.opencartCustomerId) || null,
  autoCreated,
  incompleteFields,
  lastSyncedAt: new Date(),
});
