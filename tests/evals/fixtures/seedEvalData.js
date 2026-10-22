import mongoose from "mongoose";
import Article from "../../../src/models/production/article.model.js";
import ProductionOrder from "../../../src/models/production/productionOrder.model.js";
import User from "../../../src/models/user.model.js";
import { getNavigationPermission } from "../../../src/utils/navigationHelper.js";
import { assertEvalSnapshots, evalOrders } from "./orders.js";
import insertEvalWarehouse from "./warehouse.js";
import { insertEvalYarnStock } from "./yarnStock.js";

const NAV_PATH = "navigation.Production Planning.Production Orders";
const YARN_NAV_PATH = "navigation.Yarn Management.Dashboard";
const STOCK_NAV_PATH = "navigation.Warehouse Management.Stock";
const ORDERS_NAV_PATH = "navigation.Warehouse Management.Orders";
const SEEDED_AT = new Date("2026-01-01T00:00:00.000Z");

/**
 * Mongo documents expose the id on `_id`.
 * @param {object} doc
 * @returns {import('mongoose').Types.ObjectId}
 */
function mongoId(doc) {
  return doc._id; // eslint-disable-line no-underscore-dangle
}

const USERS = [
  {
    key: "eval-allowed",
    _id: new mongoose.Types.ObjectId("65f0e0000000000000000001"),
    email: "eval-allowed@addon.in",
    name: "Eval Allowed",
    allowed: true,
  },
  {
    key: "eval-denied",
    _id: new mongoose.Types.ObjectId("65f0e0000000000000000002"),
    email: "eval-denied@addon.in",
    name: "Eval Denied",
    allowed: false,
  },
];

/**
 * Inserts one order and its articles with raw floor numbers. Skips Article pre-save.
 * @param {object} spec
 * @returns {Promise<void>}
 */
async function insertOrder(spec) {
  const articleIds = [];
  await spec.articles.reduce(async (previous, row, index) => {
    await previous;
    const articleId = mongoId(row);
    articleIds.push(articleId);
    await Article.collection.insertOne({
      _id: articleId,
      id: `eval-${spec.orderNumber}-${index + 1}`,
      orderId: mongoId(spec),
      articleNumber: row.articleNumber,
      plannedQuantity: row.plannedQuantity,
      linkingType: "Auto Linking",
      priority: "High",
      status: row.status,
      progress: 0,
      floorQuantities: row.floorQuantities,
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    });
  }, Promise.resolve());

  await ProductionOrder.collection.insertOne({
    _id: mongoId(spec),
    orderNumber: spec.orderNumber,
    priority: "High",
    status: spec.status,
    currentFloor: "Knitting",
    articles: articleIds,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
  });
}

/**
 * Replaces the eval orders and the two eval users on the already-open connection.
 * Other documents in the test database are left in place.
 * @returns {Promise<{ users: Record<string, { id: import('mongoose').Types.ObjectId, navigation: object }>, snapshots: object[] }>}
 */
export default async function seedEvalData() {
  const snapshots = assertEvalSnapshots();
  const orderNumbers = evalOrders
    .map((order) => order.orderNumber)
    .concat(["EVAL-A", "EVAL-B", "EVAL-C"]);
  const existing = await ProductionOrder.collection
    .find({ orderNumber: { $in: orderNumbers } })
    .toArray();
  const oldIds = existing.map((order) => mongoId(order));
  await Article.collection.deleteMany({
    $or: [{ orderId: { $in: oldIds } }, { articleNumber: /^E[A-F]-/ }],
  });
  await ProductionOrder.collection.deleteMany({
    orderNumber: { $in: orderNumbers },
  });
  await User.deleteMany({ email: { $in: USERS.map((user) => user.email) } });

  await evalOrders.reduce(async (previous, order) => {
    await previous;
    await insertOrder(order);
  }, Promise.resolve());

  const users = {};
  await USERS.reduce(async (previous, spec) => {
    await previous;
    const userId = mongoId(spec);
    await User.create({
      _id: userId,
      name: spec.name,
      email: spec.email,
      password: "EvalPass1",
      role: "user",
    });
    await User.updateOne(
      { _id: userId },
      {
        $set: {
          [NAV_PATH]: spec.allowed,
          [YARN_NAV_PATH]: spec.allowed,
          [STOCK_NAV_PATH]: spec.allowed,
          [ORDERS_NAV_PATH]: spec.allowed,
        },
      }
    );
    const fresh = await User.findById(userId);
    if (!fresh) throw new Error(`Eval user ${spec.key} was not saved`);
    const { navigation } = fresh.toObject();
    const allowed = getNavigationPermission(
      navigation,
      "Production Planning.Production Orders"
    );
    const yarnAllowed = getNavigationPermission(navigation, "Yarn Management.Dashboard");
    const stockAllowed = getNavigationPermission(navigation, "Warehouse Management.Stock");
    const warehouseOrdersAllowed = getNavigationPermission(navigation, "Warehouse Management.Orders");
    if (
      allowed !== spec.allowed ||
      yarnAllowed !== spec.allowed ||
      stockAllowed !== spec.allowed ||
      warehouseOrdersAllowed !== spec.allowed
    ) {
      throw new Error(
        `Eval user ${spec.key} flags are orders ${allowed}, yarn ${yarnAllowed}, stock ${stockAllowed}, warehouse orders ${warehouseOrdersAllowed}, expected ${spec.allowed}`
      );
    }
    users[spec.key] = { id: mongoId(fresh), navigation };
  }, Promise.resolve());

  await insertEvalYarnStock();
  await insertEvalWarehouse();
  return { users, snapshots };
}
