import { jest } from "@jest/globals"; // eslint-disable-line import/no-extraneous-dependencies
import mongoose from "mongoose";
import { executeTool } from "../../../src/ai/registry.js";
import registerTools from "../../../src/ai/tools/registerTools.js";
import { runGetYarnLiveStock } from "../../../src/ai/tools/getYarnLiveStock.js";
import YarnCatalog from "../../../src/models/yarnManagement/yarnCatalog.model.js";
import {
  getInventoryBreakdownForCatalogIds,
  resetSlotBarcodeCache,
} from "../../../src/services/yarnManagement/yarnInventory.service.js";
import { EVAL_YARNS, insertEvalYarnStock } from "../../evals/fixtures/yarnStock.js";
import setupTestDB from "../../utils/setupTestDB.js";

setupTestDB();

const GIZA_ID = EVAL_YARNS[0].id;
const COMBED_ID = EVAL_YARNS[1].id;
const RUBBER_ID = EVAL_YARNS[4].id;

/**
 * Screen breakdown for one seeded catalog id.
 * @param {string} id
 * @returns {Promise<object>}
 */
async function screenRow(id) {
  const map = await getInventoryBreakdownForCatalogIds([id]);
  return map.get(String(id));
}

describe("getYarnLiveStock", () => {
  beforeEach(async () => {
    resetSlotBarcodeCache();
    await insertEvalYarnStock();
  });

  afterEach(() => {
    resetSlotBarcodeCache();
  });

  test("exact name matches the screen breakdown", async () => {
    const row = await runGetYarnLiveStock({ query: "110/70-Navy-Navy-Rubber/Rubber" });
    const screen = await screenRow(RUBBER_ID);
    expect(row.yarnCatalogId).toBe(RUBBER_ID);
    expect(row.unit).toBe("kg");
    expect(row.totalKg).toBe(screen.totalStockKg);
    expect(row.availableKg).toBe(screen.availableKg);
    expect(row.longTermKg).toBe(screen.longTermKg);
    expect(row.blockedKg).toBe(screen.blockedKg);
    expect(row.cones).toBe(screen.cones);
    expect(row.availableKg).toBe(4.5);
  });

  test("token search of cotton 40s black is ambiguous and the combined kg is the sum", async () => {
    const row = await runGetYarnLiveStock({ query: "cotton 40s black" });
    const giza = await screenRow(GIZA_ID);
    const combed = await screenRow(COMBED_ID);
    expect(row.error).toBe("AMBIGUOUS");
    expect(row.candidates).toHaveLength(2);
    expect(row.combinedTotalKg).toBeCloseTo(giza.totalStockKg + combed.totalStockKg, 3);
    expect(row.combinedAvailableKg).toBeCloseTo(giza.availableKg + combed.availableKg, 3);
    expect(row.combinedTotalKg).toBe(21.75);
    expect(row.combinedAvailableKg).toBe(21.5);
    expect(giza.totalStockKg).toBe(13.75);
    expect(giza.availableKg).toBe(13.5);
    expect(giza.cones).toBe(1);
    expect(giza.blockedKg).toBe(0.25);
  });

  test("yarnCatalogId skips the name match", async () => {
    const row = await runGetYarnLiveStock({ yarnCatalogId: GIZA_ID, query: "cotton" });
    const screen = await screenRow(GIZA_ID);
    expect(row.yarnName).toBe("2/40s-Black-Black-Cotton/Giza Cotton");
    expect(row.totalKg).toBe(screen.totalStockKg);
  });

  test("more than ten cotton yarns returns counts and colours, not kg", async () => {
    const row = await runGetYarnLiveStock({ query: "cotton" });
    expect(row.error).toBe("TOO_MANY");
    expect(row.count).toBeGreaterThan(10);
    expect(row.counts.length).toBeLessThanOrEqual(10);
    expect(row.colours.length).toBeLessThanOrEqual(10);
    expect(row.counts).toContain("2/40s");
    expect(row.counts).toContain("10s");
    expect(row.colours).toContain("Black");
    expect(row.totalKg).toBeUndefined();
  });

  test("unknown name and inactive yarn are not found", async () => {
    expect(await runGetYarnLiveStock({ query: "silk organza" })).toEqual({ error: "NOT_FOUND" });
    await YarnCatalog.updateOne({ _id: RUBBER_ID }, { $set: { status: "inactive" } });
    expect(await runGetYarnLiveStock({ query: "110/70-Navy-Navy-Rubber/Rubber" })).toEqual({
      error: "NOT_FOUND",
    });
  });

  test("denied dashboard permission does not load the catalog", async () => {
    registerTools();
    const find = jest.spyOn(YarnCatalog, "find");
    const denied = {
      "Yarn Management": { Dashboard: false },
    };
    const result = await executeTool(
      "getYarnLiveStock",
      { query: "cotton" },
      { user: { navigation: denied } }
    );
    expect(result).toEqual({ error: "NO_PERMISSION", navPath: "Yarn Management.Dashboard" });
    expect(find).not.toHaveBeenCalled();
    find.mockRestore();
  });

  test("a bad catalog id is not found", async () => {
    expect(await runGetYarnLiveStock({ yarnCatalogId: "not-an-id" })).toEqual({ error: "NOT_FOUND" });
    expect(mongoose.Types.ObjectId.isValid(GIZA_ID)).toBe(true);
  });
});
