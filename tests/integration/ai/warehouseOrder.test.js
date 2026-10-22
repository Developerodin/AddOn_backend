import { jest } from "@jest/globals"; // eslint-disable-line import/no-extraneous-dependencies
import mongoose from "mongoose";
import { executeTool } from "../../../src/ai/registry.js";
import registerTools from "../../../src/ai/tools/registerTools.js";
import { runGetWarehouseOrder } from "../../../src/ai/tools/getWarehouseOrder.js";
import WarehouseOrder from "../../../src/models/whms/warehouseOrder.model.js";
import setupTestDB from "../../utils/setupTestDB.js";

setupTestDB();

const styleId = new mongoose.Types.ObjectId("65f0d1000000000000000001");
const clientId = new mongoose.Types.ObjectId("65f0d1000000000000000002");

/**
 * Inserts one warehouse order. Pass flowStatus null to leave it unset.
 * @param {object} fields
 * @returns {Promise<void>}
 */
async function insertOrder(fields) {
  const doc = {
    clientId,
    clientType: "Trade",
    clientName: "Metro Stores",
    styleCodeSinglePair: [
      { styleCodeId: styleId, styleCode: "10090601", pack: "1 Pair", quantity: 4 },
    ],
    styleCodeMultiPair: [],
    status: "pending",
    flowStatus: "order-created",
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    ...fields,
  };
  if (fields.flowStatus === null) delete doc.flowStatus;
  await WarehouseOrder.collection.insertOne(doc);
}

describe("getWarehouseOrder", () => {
  beforeEach(async () => {
    await insertOrder({
      orderNumber: "WO-2026-00064",
      clientName: "Metro Stores",
      addonOrderId: "WEB-9001",
      status: "in-progress",
      flowStatus: "picking-done",
      styleCodeSinglePair: [
        { styleCodeId: styleId, styleCode: "10090601", pack: "1 Pair", quantity: 4 },
        { styleCodeId: styleId, styleCode: "100583702", pack: "1 Pair", quantity: 6 },
      ],
      styleCodeMultiPair: [
        { styleCodeMultiPairId: styleId, styleCode: "1009003", pack: "Pack of 3", quantity: 3 },
      ],
    });
    await insertOrder({
      orderNumber: "WO-2026-00164",
      clientName: "Suffix Twin",
      createdAt: new Date("2026-06-02T00:00:00.000Z"),
    });
    await insertOrder({
      orderNumber: "WO-2026-00072",
      clientName: "Partial Client",
      status: "packed",
      flowStatus: "billed",
      createdAt: new Date("2026-06-03T00:00:00.000Z"),
    });
    await insertOrder({
      orderNumber: "WO-2026-30001",
      clientName: "Bare Status",
      status: "in-progress",
      flowStatus: null,
    });
    await insertOrder({
      orderNumber: "WO-2026-40001",
      clientName: "City Stores",
      addonOrderId: "WEB-ALPHA",
      flowStatus: "packing-done",
    });
    await Array.from({ length: 12 }, (_, index) => index + 1).reduce(async (previous, day) => {
      await previous;
      await insertOrder({
        orderNumber: `WO-2026-${11000 + day}`,
        clientName: "Lifestyle Retail",
        createdAt: new Date(Date.UTC(2026, 0, day)),
        updatedAt: new Date(Date.UTC(2026, 0, day)),
        flowStatus: "picking",
        status: "in-progress",
      });
    }, Promise.resolve());
  });

  test("exact order number returns stored flowStatus, the UI label, and the line sum", async () => {
    const row = await runGetWarehouseOrder({ query: "WO-2026-00064" });
    const lineSum = [...row.singleRows, ...row.multiRows].reduce((sum, line) => sum + line.quantity, 0);
    expect(row.matchedFrom).toBeUndefined();
    expect(row.orderNumber).toBe("WO-2026-00064");
    expect(row.addonOrderId).toBe("WEB-9001");
    expect(row.client).toBe("Metro Stores");
    expect(row.clientType).toBe("Trade");
    expect(row.status).toBe("in-progress");
    expect(row.statusLabel).toBe("In-Progress");
    expect(row.flowStatus).toBe("picking-done");
    expect(row.flowStageLabel).toBe("Picking Done");
    expect(row.flowStageLabel).not.toBe("Picking");
    expect(row.totalQty).toBe(lineSum);
    expect(row.totalQty).toBe(13);
    expect(row.singleRows).toHaveLength(2);
    expect(row.multiRows).toHaveLength(1);
  });

  test("a suffix that hits one order sets matchedFrom", async () => {
    const row = await runGetWarehouseOrder({ query: "72" });
    expect(row.matchedFrom).toBe("72");
    expect(row.orderNumber).toBe("WO-2026-00072");
    expect(row.flowStatus).toBe("billed");
    expect(row.flowStageLabel).toBe("Billed");
  });

  test("a suffix that hits several orders is ambiguous", async () => {
    const row = await runGetWarehouseOrder({ query: "64" });
    expect(row.error).toBe("AMBIGUOUS");
    expect(row.candidates).toEqual(["WO-2026-00064", "WO-2026-00164"]);
    expect(row.totalQty).toBeUndefined();
  });

  test("addonOrderId matches when the suffix does not", async () => {
    const row = await runGetWarehouseOrder({ query: "WEB-ALPHA" });
    expect(row.orderNumber).toBe("WO-2026-40001");
    expect(row.client).toBe("City Stores");
    expect(row.flowStageLabel).toBe("Packing Done");
  });

  test("a missing flowStatus is not derived from the coarse status", async () => {
    const row = await runGetWarehouseOrder({ query: "WO-2026-30001" });
    expect(row.status).toBe("in-progress");
    expect(row.statusLabel).toBe("In-Progress");
    expect(row.flowStatus).toBeNull();
    expect(row.flowStageLabel).toBeNull();
  });

  test("a client with more than 10 orders returns the 10 most recent and totalCount", async () => {
    const row = await runGetWarehouseOrder({ query: "orders for Lifestyle Retail" });
    expect(row.client).toBe("Lifestyle Retail");
    expect(row.totalCount).toBe(12);
    expect(row.returnedCount).toBe(10);
    expect(row.orders).toHaveLength(10);
    expect(row.orders[0].orderNumber).toBe("WO-2026-11012");
    expect(row.orders.map((order) => order.orderNumber)).not.toContain("WO-2026-11001");
    expect(row.orders.map((order) => order.orderNumber)).not.toContain("WO-2026-11002");
    expect(row.orders[0].totalQty).toBe(4);
  });

  test("a client-name token that hits two clients is ambiguous", async () => {
    const row = await runGetWarehouseOrder({ query: "stores" });
    expect(row.error).toBe("AMBIGUOUS");
    expect(row.candidates).toEqual(["City Stores", "Metro Stores"]);
  });

  test("unknown query is not found", async () => {
    expect(await runGetWarehouseOrder({ query: "WO-1999-00001" })).toEqual({ error: "NOT_FOUND" });
  });

  test("orders permission is Warehouse Management.Orders", async () => {
    registerTools();
    const find = jest.spyOn(WarehouseOrder, "find");
    const denied = await executeTool(
      "getWarehouseOrder",
      { query: "WO-2026-00064" },
      { user: { navigation: { "Warehouse Management": { Orders: false, Stock: true } } } }
    );
    expect(denied).toEqual({ error: "NO_PERMISSION", navPath: "Warehouse Management.Orders" });
    expect(find).not.toHaveBeenCalled();
    find.mockRestore();

    const allowed = await executeTool(
      "getWarehouseOrder",
      { query: "WO-2026-00064" },
      { user: { navigation: { "Warehouse Management": { Orders: true, Stock: false } } } }
    );
    expect(allowed.orderNumber).toBe("WO-2026-00064");
    expect(allowed.flowStageLabel).toBe("Picking Done");
  });
});
