import mongoose from "mongoose";
import Category from "../../../src/models/category.model.js";
import Product from "../../../src/models/product.model.js";
import StyleCode from "../../../src/models/styleCode.model.js";
import WarehouseInventory from "../../../src/models/whms/warehouseInventory.model.js";
import WarehouseOrder from "../../../src/models/whms/warehouseOrder.model.js";

const NOW = new Date("2026-01-15T00:00:00.000Z");
const CATEGORY_ID = new mongoose.Types.ObjectId("65f0c1000000000000000001");
const CLIENT_ID = new mongoose.Types.ObjectId("65f0c1000000000000000002");
const LINE_STYLE_ID = new mongoose.Types.ObjectId("65f0c1000000000000000003");

/**
 * Eval catalog. Packs and codes follow the stock screen: 1 Pair, Pack of 3, A#### factory codes.
 * Shared style 100583701 sits on A5837 and A5840. A5888 is Pack of 3 at 13 available.
 */
const PRODUCTS = [
  {
    id: "65f0c2000000000000000001",
    factoryCode: "A906",
    name: "Ankle Length Black",
    styles: [
      {
        id: "65f0c3000000000000000001",
        styleCode: "10090601",
        eanCode: "8904442000906",
        pack: "1 Pair",
        total: 60,
        blocked: 8,
      },
    ],
  },
  {
    id: "65f0c2000000000000000002",
    factoryCode: "A5837",
    name: "Crew Black",
    styles: [
      {
        id: "65f0c3000000000000000002",
        styleCode: "100583701",
        eanCode: "8904442005837",
        pack: "1 Pair",
        total: 36,
        blocked: 3,
      },
      {
        id: "65f0c3000000000000000003",
        styleCode: "100583702",
        eanCode: "8904442005838",
        pack: "1 Pair",
        total: 12,
        blocked: 2,
      },
    ],
  },
  {
    id: "65f0c2000000000000000003",
    factoryCode: "A5840",
    name: "Crew Navy",
    styles: [
      {
        id: "65f0c3000000000000000002",
        styleCode: "100583701",
        eanCode: "8904442005837",
        pack: "1 Pair",
      },
    ],
  },
  {
    id: "65f0c2000000000000000004",
    factoryCode: "A5888",
    name: "Sports Triple",
    styles: [
      {
        id: "65f0c3000000000000000004",
        styleCode: "100588801",
        eanCode: "8904442005888",
        pack: "Pack of 3",
        total: 15,
        blocked: 2,
      },
    ],
  },
];

/**
 * One order document. Line quantity is 4 except the stage order, which sums to 11.
 * @param {object} fields
 * @returns {object}
 */
function orderDoc(fields) {
  return {
    clientId: CLIENT_ID,
    clientType: "Trade",
    clientName: "Metro Stores",
    styleCodeSinglePair: [
      { styleCodeId: LINE_STYLE_ID, styleCode: "10090601", pack: "1 Pair", quantity: 4 },
    ],
    styleCodeMultiPair: [],
    status: "pending",
    flowStatus: "order-created",
    createdAt: NOW,
    updatedAt: NOW,
    ...fields,
  };
}

/**
 * Replaces eval warehouse products, stock rows, and WO- orders. Leaves production orders alone.
 * @returns {Promise<void>}
 */
export default async function insertEvalWarehouse() {
  const styleIds = [
    "65f0c3000000000000000001",
    "65f0c3000000000000000002",
    "65f0c3000000000000000003",
    "65f0c3000000000000000004",
  ].map((id) => new mongoose.Types.ObjectId(id));
  const productIds = PRODUCTS.map((product) => new mongoose.Types.ObjectId(product.id));
  const orderNumbers = ["WO-2026-00064", "WO-2026-00072"].concat(
    Array.from({ length: 12 }, (_, index) => `WO-2026-${12001 + index}`)
  );

  await WarehouseOrder.collection.deleteMany({ orderNumber: { $in: orderNumbers } });
  await WarehouseInventory.collection.deleteMany({ styleCodeId: { $in: styleIds } });
  await Product.collection.deleteMany({ _id: { $in: productIds } });
  await StyleCode.collection.deleteMany({ _id: { $in: styleIds } });
  await Category.collection.deleteMany({ _id: CATEGORY_ID });

  await Category.collection.insertOne({
    _id: CATEGORY_ID,
    name: "Eval Socks",
    status: "active",
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
  });

  const styleInserted = new Set();
  await PRODUCTS.reduce(async (previous, product) => {
    await previous;
    const productId = new mongoose.Types.ObjectId(product.id);
    await product.styles.reduce(async (stylePrevious, style) => {
      await stylePrevious;
      const styleId = new mongoose.Types.ObjectId(style.id);
      if (!styleInserted.has(style.styleCode)) {
        styleInserted.add(style.styleCode);
        await StyleCode.collection.insertOne({
          _id: styleId,
          styleCode: style.styleCode,
          eanCode: style.eanCode,
          mrp: 199,
          pack: style.pack,
          brand: "Eval",
          status: "active",
          createdAt: NOW,
          updatedAt: NOW,
        });
      }
      if (style.total == null) return;
      await WarehouseInventory.collection.insertOne({
        _id: new mongoose.Types.ObjectId(),
        itemId: productId,
        styleCodeId: styleId,
        styleCode: style.styleCode,
        totalQuantity: style.total,
        blockedQuantity: style.blocked,
        availableQuantity: style.total - style.blocked,
        damagedQuantity: 0,
        createdAt: NOW,
        updatedAt: NOW,
      });
    }, Promise.resolve());
    await Product.collection.insertOne({
      _id: productId,
      name: product.name,
      softwareCode: `EV-${product.factoryCode}-${product.name.replace(/\s+/g, "-")}`,
      factoryCode: product.factoryCode,
      category: CATEGORY_ID,
      styleCodes: product.styles.map((style) => new mongoose.Types.ObjectId(style.id)),
      productionType: "internal",
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
    });
  }, Promise.resolve());

  await WarehouseOrder.collection.insertOne(
    orderDoc({
      orderNumber: "WO-2026-00064",
      clientName: "Metro Stores",
      status: "in-progress",
      flowStatus: "picking-done",
      styleCodeSinglePair: [
        { styleCodeId: LINE_STYLE_ID, styleCode: "10090601", pack: "1 Pair", quantity: 5 },
        { styleCodeId: LINE_STYLE_ID, styleCode: "100583702", pack: "1 Pair", quantity: 6 },
      ],
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    })
  );
  await WarehouseOrder.collection.insertOne(
    orderDoc({
      orderNumber: "WO-2026-00072",
      clientName: "Partial Client",
      status: "packed",
      flowStatus: "billed",
      styleCodeSinglePair: [
        { styleCodeId: LINE_STYLE_ID, styleCode: "100588801", pack: "Pack of 3", quantity: 9 },
      ],
      createdAt: new Date("2026-06-02T00:00:00.000Z"),
      updatedAt: new Date("2026-06-02T00:00:00.000Z"),
    })
  );

  await Array.from({ length: 12 }, (_, index) => index + 1).reduce(async (previous, day) => {
    await previous;
    await WarehouseOrder.collection.insertOne(
      orderDoc({
        orderNumber: `WO-2026-${12000 + day}`,
        clientName: "Lifestyle Retail",
        flowStatus: "picking",
        status: "in-progress",
        createdAt: new Date(Date.UTC(2026, 5, day)),
        updatedAt: new Date(Date.UTC(2026, 5, day)),
      })
    );
  }, Promise.resolve());
}
