import { jest } from "@jest/globals"; // eslint-disable-line import/no-extraneous-dependencies
import { executeTool } from "../../../src/ai/registry.js";
import registerTools from "../../../src/ai/tools/registerTools.js";
import { runGetWarehouseStock } from "../../../src/ai/tools/getWarehouseStock.js";
import { getWarehouseInventoryByStyleCode } from "../../../src/services/whms/warehouseInventory.service.js";
import { serializeWarehouseInventory } from "../../../src/utils/warehouseInventorySerializer.js";
import StyleCode from "../../../src/models/styleCode.model.js";
import WarehouseOrder from "../../../src/models/whms/warehouseOrder.model.js";
import setupTestDB from "../../utils/setupTestDB.js";
import seedWarehouseStock from "./warehouseStockFixture.js";

setupTestDB();

/**
 * Screen quantities for one style code.
 * @param {string} styleCode
 * @returns {Promise<object>}
 */
async function screen(styleCode) {
  const doc = await getWarehouseInventoryByStyleCode(styleCode);
  return serializeWarehouseInventory(doc);
}

describe("getWarehouseStock", () => {
  beforeEach(async () => {
    await seedWarehouseStock();
  });

  test("exact style code is the screen row, and damaged is not subtracted", async () => {
    const row = await runGetWarehouseStock({ query: "SC-A906-01" });
    const shown = await screen("SC-A906-01");
    expect(row.queryKind).toBe("style");
    expect(row.productTotal).toBeUndefined();
    expect(row.styleCode).toBe("SC-A906-01");
    expect(row.pack).toBe(shown.styleCodeMaster.pack);
    expect(row.total).toBe(shown.quantities.total);
    expect(row.blocked).toBe(shown.quantities.blocked);
    expect(row.available).toBe(shown.quantities.available);
    expect(row.available).toBe(52);
    expect(row.total - row.blocked).toBe(52);
    expect(row.product.factoryCode).toBe("A906");
    expect(row.product.name).toBe(shown.product.name);
  });

  test("style code wins over a factory code with the same text", async () => {
    const row = await runGetWarehouseStock({ query: "ZZ-STYLE" });
    expect(row.queryKind).toBe("style");
    expect(row.product.factoryCode).toBe("S9000");
    expect(row.available).toBe(8);
  });

  test("one real EAN returns that style, and it wins over a factory code", async () => {
    const byEan = await runGetWarehouseStock({ query: "8904442957001" });
    const shown = await screen("SC-EAN");
    expect(byEan.queryKind).toBe("style");
    expect(byEan.styleCode).toBe("SC-EAN");
    expect(byEan.available).toBe(shown.quantities.available);
    expect(byEan.available).toBe(6);

    const beatsFactory = await runGetWarehouseStock({ query: "1112223334445" });
    expect(beatsFactory.queryKind).toBe("style");
    expect(beatsFactory.styleCode).toBe("SC-EAN-FIRST");
    expect(beatsFactory.product.factoryCode).toBe("B2002");
  });

  test("EAN NA never matches", async () => {
    expect(await runGetWarehouseStock({ query: "NA" })).toEqual({ error: "NOT_FOUND" });
    expect(await runGetWarehouseStock({ query: "N/A" })).toEqual({ error: "NOT_FOUND" });
  });

  test("a duplicate EAN is ambiguous", async () => {
    const row = await runGetWarehouseStock({ query: "8904442957002" });
    expect(row.error).toBe("AMBIGUOUS");
    expect(row.candidates).toHaveLength(2);
    expect(row.candidates.map((candidate) => candidate.factoryCode).sort()).toEqual(["D1001", "D1002"]);
    expect(row.productTotal).toBeUndefined();
  });

  test("one factory code returns the product total in that pack", async () => {
    const row = await runGetWarehouseStock({ query: "a906 ka warehouse stock kitna hai" });
    const shown = await screen("SC-A906-01");
    expect(row.queryKind).toBe("product");
    expect(row.product).toEqual({ factoryCode: "A906", name: "Ankle Length Black" });
    expect(row.unit).toBe("pack-labelled");
    expect(row.styles).toHaveLength(1);
    expect(row.styles[0].available).toBe(shown.quantities.available);
    expect(row.productTotal).toEqual({ total: 60, blocked: 8, available: 52, pack: "1 Pair" });
    expect(row.totalReason).toBeNull();
    expect(Number.isInteger(row.productTotal.available)).toBe(true);
  });

  test("a duplicate factory code is ambiguous", async () => {
    const row = await runGetWarehouseStock({ query: "A5838" });
    expect(row.error).toBe("AMBIGUOUS");
    expect(row.candidates).toEqual([
      { factoryCode: "A5838", name: "Twin Left" },
      { factoryCode: "A5838", name: "Twin Right" },
    ]);
  });

  test("a shared style has no product total", async () => {
    const row = await runGetWarehouseStock({ query: "A5837" });
    const shown = await screen("SC-SHARE");
    expect(row.productTotal).toBeNull();
    expect(row.totalReason).toBe("SHARED_STYLE");
    const share = row.styles.find((style) => style.styleCode === "SC-SHARE");
    const unstocked = row.styles.find((style) => style.styleCode === "SC-OWN");
    expect(share.available).toBe(shown.quantities.available);
    expect(unstocked).toEqual({ styleCode: "SC-OWN", pack: "1 Pair", total: 0, blocked: 0, available: 0 });
  });

  test("mixed packs have no product total", async () => {
    const row = await runGetWarehouseStock({ query: "M1001" });
    expect(row.productTotal).toBeNull();
    expect(row.totalReason).toBe("MIXED_PACK");
    expect(row.styles.map((style) => style.pack).sort()).toEqual(["1 Pair", "Pack of 3"]);
  });

  test("an unstocked style is zeros and the product total still sums", async () => {
    const row = await runGetWarehouseStock({ query: "P1001" });
    const empty = row.styles.find((style) => style.styleCode === "SC-EMPTY");
    expect(empty).toEqual({ styleCode: "SC-EMPTY", pack: "1 Pair", total: 0, blocked: 0, available: 0 });
    expect(row.totalReason).toBeNull();
    expect(row.productTotal).toEqual({ total: 5, blocked: 2, available: 3, pack: "1 Pair" });
  });

  test("a style code with no stock row is zeros", async () => {
    const row = await runGetWarehouseStock({ query: "SC-EMPTY" });
    expect(row.queryKind).toBe("style");
    expect(row.product).toBeNull();
    expect(row.total).toBe(0);
    expect(row.blocked).toBe(0);
    expect(row.available).toBe(0);
    expect(row.pack).toBe("1 Pair");
  });

  test("name tokens: one product, several products, too many, and a miss", async () => {
    const one = await runGetWarehouseStock({ query: "merino heather" });
    expect(one.queryKind).toBe("product");
    expect(one.product.factoryCode).toBe("H1001");

    const several = await runGetWarehouseStock({ query: "oxford" });
    expect(several.error).toBe("AMBIGUOUS");
    expect(several.candidates).toEqual([
      { factoryCode: "O1001", name: "Oxford Black" },
      { factoryCode: "O1002", name: "Oxford Navy" },
    ]);

    const many = await runGetWarehouseStock({ query: "ribbed cotton" });
    expect(many.error).toBe("TOO_MANY");
    expect(many.count).toBe(11);
    expect(many.styles).toBeUndefined();
    expect(many.productTotal).toBeUndefined();

    expect(await runGetWarehouseStock({ query: "silk organza" })).toEqual({ error: "NOT_FOUND" });
    expect(await runGetWarehouseStock({ query: "stock" })).toEqual({ error: "NOT_FOUND" });
  });

  test("each tool checks its own nav key", async () => {
    registerTools();
    const styleFind = jest.spyOn(StyleCode, "findOne");
    const orderFind = jest.spyOn(WarehouseOrder, "find");
    const stockOnly = { "Warehouse Management": { Stock: true, Orders: false } };
    const ordersOnly = { "Warehouse Management": { Stock: false, Orders: true } };

    expect(
      await executeTool("getWarehouseStock", { query: "A906" }, { user: { navigation: ordersOnly } })
    ).toEqual({ error: "NO_PERMISSION", navPath: "Warehouse Management.Stock" });
    expect(styleFind).not.toHaveBeenCalled();

    expect(
      await executeTool("getWarehouseOrder", { query: "WO-2026-00064" }, { user: { navigation: stockOnly } })
    ).toEqual({ error: "NO_PERMISSION", navPath: "Warehouse Management.Orders" });
    expect(orderFind).not.toHaveBeenCalled();

    styleFind.mockRestore();
    orderFind.mockRestore();

    const allowed = await executeTool("getWarehouseStock", { query: "A906" }, { user: { navigation: stockOnly } });
    expect(allowed.product.factoryCode).toBe("A906");
  });
});
