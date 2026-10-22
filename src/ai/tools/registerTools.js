import { defineTool } from '../registry.js';
import { getProductionOrderTool } from './getProductionOrder.js';
import { getWarehouseOrderTool } from './getWarehouseOrder.js';
import { getWarehouseStockTool } from './getWarehouseStock.js';
import { getYarnLiveStockTool } from './getYarnLiveStock.js';

let registered = false;

/**
 * Registers the Phase 0 tool set once per process.
 * @returns {void}
 */
export default function registerTools() {
  if (registered) return;
  defineTool(getProductionOrderTool);
  defineTool(getYarnLiveStockTool);
  defineTool(getWarehouseStockTool);
  defineTool(getWarehouseOrderTool);
  registered = true;
}
