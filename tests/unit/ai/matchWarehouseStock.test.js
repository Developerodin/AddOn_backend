import {
  classifyProductNameMatches,
  isNaEan,
  productNameMatches,
  warehouseLookupKey,
  warehouseNameTokens,
} from "../../../src/ai/tools/matchWarehouseStock.js";

describe("warehouse stock matching", () => {
  test("stopwords drop out and a style code keeps its hyphen", () => {
    expect(warehouseLookupKey("A906 ka warehouse stock kitna hai")).toBe("a906");
    expect(warehouseLookupKey("style code SC-100")).toBe("sc-100");
    expect(warehouseNameTokens("style code SC-100")).toEqual(["sc", "100"]);
  });

  test("name tokens match in any order, and NA is never an EAN", () => {
    expect(productNameMatches("black ankle", "Ankle Length Black")).toBe(true);
    expect(productNameMatches("oxford", "Crew Black")).toBe(false);
    expect(isNaEan("NA")).toBe(true);
    expect(isNaEan("N/A")).toBe(true);
    expect(isNaEan("8904442957002")).toBe(false);
  });

  test("two to ten names are ambiguous and eleven is too many", () => {
    const products = [
      { productId: "1", factoryCode: "O1001", name: "Oxford Black" },
      { productId: "2", factoryCode: "O1002", name: "Oxford Navy" },
    ];
    const ambiguous = classifyProductNameMatches("oxford", products);
    expect(ambiguous.error).toBe("AMBIGUOUS");
    expect(ambiguous.matches).toHaveLength(2);
    const many = Array.from({ length: 11 }, (_, index) => ({
      productId: String(index),
      factoryCode: `R${index}`,
      name: `Ribbed Cotton ${index}`,
    }));
    expect(classifyProductNameMatches("ribbed", many)).toEqual({ error: "TOO_MANY", count: 11 });
    expect(classifyProductNameMatches("silk", products)).toEqual({ error: "NOT_FOUND" });
  });
});
