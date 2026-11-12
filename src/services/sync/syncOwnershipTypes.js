/**
 * Entity and event types for the ownership apply set (pure constants, no I/O).
 *
 * Factory → cloud only: floor moves (transfer + container receive), yarn cone create/issue/return, warehouse
 * inventory create/update, vendor production transfer. The cloud never captures these, and a receiver applies them
 * only when they come from the factory site.
 *
 * Both directions: category, product (item), style code, yarn catalog creates. Insert-if-absent by source _id.
 */

export const OWNERSHIP_ENTITY_TYPES = Object.freeze({
  YARN_CONE: 'yarnCone',
  WAREHOUSE_INVENTORY: 'warehouseInventory',
  CATEGORY: 'category',
  PRODUCT: 'product',
  STYLE_CODE: 'styleCode',
  YARN_CATALOG: 'yarnCatalog',
});

export const OWNERSHIP_EVENT_TYPES = Object.freeze({
  /** Container accept on the next floor (updateArticleFloorReceivedData). Entity productionOrder, aggregate = order id. */
  ARTICLE_FLOOR_RECEIVE: 'productionArticleFloorReceive',
  YARN_CONE_CREATED: 'yarnConeCreated',
  YARN_CONE_FLOOR_ISSUED: 'yarnConeFloorIssued',
  /** Production yarn-issue screen: transaction row, then the cone is marked issued. */
  YARN_TRANSACTION_ISSUED: 'yarnTransactionIssued',
  YARN_CONE_PRODUCTION_ISSUED: 'yarnConeProductionIssued',
  YARN_CONE_RETURNED: 'yarnConeReturned',
  WAREHOUSE_INVENTORY_CREATED: 'warehouseInventoryCreated',
  WAREHOUSE_INVENTORY_UPDATED: 'warehouseInventoryUpdated',
  CATEGORY_CREATED: 'categoryCreated',
  PRODUCT_CREATED: 'productCreated',
  STYLE_CODE_CREATED: 'styleCodeCreated',
  YARN_CATALOG_CREATED: 'yarnCatalogCreated',
});

/** Master entity types synced both ways. Their payload is the flat document, so the conflict detector compares fields. */
export const MASTER_ENTITY_TYPES = Object.freeze([
  OWNERSHIP_ENTITY_TYPES.CATEGORY,
  OWNERSHIP_ENTITY_TYPES.PRODUCT,
  OWNERSHIP_ENTITY_TYPES.STYLE_CODE,
  OWNERSHIP_ENTITY_TYPES.YARN_CATALOG,
]);
