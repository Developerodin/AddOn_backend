/**
 * Canonical yarnName for YarnCatalog: countSize-colorFamily-pantonName-yarnType/subtype
 * (pantonName segment omitted when empty). Must stay in sync with yarnCatalog.model.js pre-save.
 *
 * @param {object} doc - Plain object or mongoose doc with embedded countSize, colorFamily, pantonName, yarnType, yarnSubtype
 * @returns {string|null}
 */
export function buildYarnCatalogYarnName(doc) {
  if (!doc || typeof doc !== 'object') return null;

  const parts = [];
  if (doc.countSize && doc.countSize.name) parts.push(String(doc.countSize.name).trim());
  if (doc.colorFamily && doc.colorFamily.name) parts.push(String(doc.colorFamily.name).trim());
  if (doc.pantonName && String(doc.pantonName).trim()) parts.push(String(doc.pantonName).trim());
  if (doc.yarnType && doc.yarnType.name) {
    let typePart = String(doc.yarnType.name).trim();
    if (doc.yarnSubtype && doc.yarnSubtype.subtype) {
      typePart += `/${String(doc.yarnSubtype.subtype).trim()}`;
    }
    parts.push(typePart);
  }

  return parts.length > 0 ? parts.join('-') : null;
}
