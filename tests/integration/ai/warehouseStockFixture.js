import Category from "../../../src/models/category.model.js";
import Product from "../../../src/models/product.model.js";
import StyleCode from "../../../src/models/styleCode.model.js";
import WarehouseInventory from "../../../src/models/whms/warehouseInventory.model.js";

/**
 * @param {object} category
 * @param {object} spec
 * @returns {Promise<object>}
 */
async function makeStyle(spec) {
  return StyleCode.create({
    styleCode: spec.styleCode,
    eanCode: spec.eanCode,
    mrp: 199,
    pack: spec.pack,
    brand: "Eval",
  });
}

/**
 * @param {object} category
 * @param {string} factoryCode
 * @param {string} name
 * @param {object[]} styles
 * @param {string} [status]
 * @returns {Promise<object>}
 */
function makeProduct(category, factoryCode, name, styles, status = "active") {
  return Product.create({
    name,
    factoryCode,
    softwareCode: `EV-${factoryCode}-${name.replace(/\s+/g, "-")}`,
    category: category._id, // eslint-disable-line no-underscore-dangle
    styleCodes: styles.map((style) => style._id), // eslint-disable-line no-underscore-dangle
    status,
  });
}

/**
 * Stock screen row. available is total - blocked. damaged is stored and not saleable.
 * @param {object} style
 * @param {object} product
 * @param {number} total
 * @param {number} blocked
 * @param {number} [damaged]
 * @returns {Promise<object>}
 */
function makeStock(style, product, total, blocked, damaged = 0) {
  return WarehouseInventory.create({
    itemId: product._id, // eslint-disable-line no-underscore-dangle
    styleCodeId: style._id, // eslint-disable-line no-underscore-dangle
    styleCode: style.styleCode,
    totalQuantity: total,
    blockedQuantity: blocked,
    damagedQuantity: damaged,
  });
}

/**
 * Active products, shared styles, a duplicate EAN, NA EANs, and a mixed pack.
 * @returns {Promise<object>}
 */
export default async function seedWarehouseStock() {
  const category = await Category.create({ name: "Eval Socks" });
  const a906Style = await makeStyle({
    styleCode: "SC-A906-01",
    eanCode: "8901000000906",
    pack: "1 Pair",
  });
  const shared = await makeStyle({ styleCode: "SC-SHARE", eanCode: "8901000000001", pack: "1 Pair" });
  const own = await makeStyle({ styleCode: "SC-OWN", eanCode: "8901000000002", pack: "1 Pair" });
  const eanStyle = await makeStyle({ styleCode: "SC-EAN", eanCode: "8904442957001", pack: "1 Pair" });
  const dup1 = await makeStyle({ styleCode: "SC-DUP-1", eanCode: "8904442957002", pack: "1 Pair" });
  const dup2 = await makeStyle({ styleCode: "SC-DUP-2", eanCode: "8904442957002", pack: "1 Pair" });
  const na1 = await makeStyle({ styleCode: "SC-NA-1", eanCode: "NA", pack: "1 Pair" });
  const na2 = await makeStyle({ styleCode: "SC-NA-2", eanCode: "N/A", pack: "1 Pair" });
  const mix1 = await makeStyle({ styleCode: "SC-MIX-1", eanCode: "8901000000011", pack: "1 Pair" });
  const mix2 = await makeStyle({ styleCode: "SC-MIX-2", eanCode: "8901000000012", pack: "Pack of 3" });
  const full = await makeStyle({ styleCode: "SC-FULL", eanCode: "8901000000021", pack: "1 Pair" });
  const empty = await makeStyle({ styleCode: "SC-EMPTY", eanCode: "8901000000022", pack: "1 Pair" });
  const clashStyle = await makeStyle({ styleCode: "ZZ-STYLE", eanCode: "8901000000031", pack: "1 Pair" });
  const eanBeatsFactory = await makeStyle({
    styleCode: "SC-EAN-FIRST",
    eanCode: "1112223334445",
    pack: "1 Pair",
  });

  const ankle = await makeProduct(category, "A906", "Ankle Length Black", [a906Style]);
  const crew = await makeProduct(category, "A5837", "Crew Black", [shared, own]);
  const navy = await makeProduct(category, "A5840", "Crew Navy", [shared]);
  const eanProduct = await makeProduct(category, "B1001", "Ean Only Sock", [eanStyle]);
  await makeProduct(category, "D1001", "Dup One", [dup1]);
  await makeProduct(category, "D1002", "Dup Two", [dup2]);
  const mixed = await makeProduct(category, "M1001", "Mixed Pack Sock", [mix1, mix2]);
  const plain = await makeProduct(category, "P1001", "Plain Crew", [full, empty]);
  const screen = await makeProduct(category, "S9000", "Screen Product", [clashStyle]);
  await makeProduct(category, "ZZ-STYLE", "Factory Clash", []);
  const eanOwner = await makeProduct(category, "B2002", "Ean Owner", [eanBeatsFactory]);
  await makeProduct(category, "1112223334445", "Factory Ean", []);
  await makeProduct(category, "A5838", "Twin Left", []);
  await makeProduct(category, "A5838", "Twin Right", []);
  await makeProduct(category, "H1001", "Merino Heather", []);
  await makeProduct(category, "O1001", "Oxford Black", []);
  await makeProduct(category, "O1002", "Oxford Navy", []);
  await makeProduct(category, "A906", "Old Ankle", [a906Style], "inactive");
  await makeProduct(category, "NA001", "Placeholder Socks", [na1, na2]);

  await Array.from({ length: 11 }, (_, index) => index + 1).reduce(async (previous, n) => {
    await previous;
    const code = `R${String(n).padStart(2, "0")}`;
    await makeProduct(category, code, `Ribbed Cotton ${String(n).padStart(2, "0")}`, []);
  }, Promise.resolve());

  await makeStock(a906Style, ankle, 60, 8, 9);
  await makeStock(shared, crew, 20, 4);
  await makeStock(eanStyle, eanProduct, 7, 1);
  await makeStock(mix1, mixed, 4, 0);
  await makeStock(mix2, mixed, 13, 0);
  await makeStock(full, plain, 5, 2);
  await makeStock(clashStyle, screen, 9, 1);
  await makeStock(eanBeatsFactory, eanOwner, 8, 3);

  return { ankle, crew, navy, plain, screen };
}
