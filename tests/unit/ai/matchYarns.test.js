import {
  classifyYarnMatches,
  colourToken,
  countToken,
  yarnNameMatches,
  yarnTokens,
} from "../../../src/ai/tools/matchYarns.js";

const GIZA = { yarnCatalogId: "1", yarnName: "2/40s-Black-Black-Cotton/Giza Cotton" };
const COMBED = { yarnCatalogId: "2", yarnName: "40s-Black-Black-Cotton/Combed" };
const SIXTY = { yarnCatalogId: "3", yarnName: "2/60s-Black-Black-Cotton/Giza Cotton" };
const RUBBER = { yarnCatalogId: "4", yarnName: "110/70-Navy-Navy-Rubber/Rubber" };

describe("yarn name tokens", () => {
  test("cotton 40s black matches 2/40s giza and plain 40s", () => {
    expect(yarnTokens("cotton 40s black")).toEqual(["cotton", "40s", "black"]);
    expect(yarnNameMatches("cotton 40s black", GIZA.yarnName)).toBe(true);
    expect(yarnNameMatches("cotton 40s black", COMBED.yarnName)).toBe(true);
    expect(yarnNameMatches("cotton 40s black", SIXTY.yarnName)).toBe(false);
  });

  test("stopwords are ignored, so the stock phrase matches the same yarns", () => {
    const yarns = [GIZA, COMBED, SIXTY, RUBBER];
    const plain = classifyYarnMatches("cotton 40s black", yarns);
    const noisy = classifyYarnMatches("cotton 40s black yarn ka stock", yarns);
    expect(yarnTokens("cotton 40s black yarn ka stock")).toEqual(["cotton", "40s", "black"]);
    expect(noisy).toEqual(plain);
  });

  test("a slash count is its own token, so 2/40s does not match a plain 40s yarn", () => {
    expect(yarnNameMatches("2/40s", GIZA.yarnName)).toBe(true);
    expect(yarnNameMatches("2/40s", COMBED.yarnName)).toBe(false);
  });

  test("count and colour come from the hyphen segments", () => {
    expect(countToken(GIZA.yarnName)).toBe("2/40s");
    expect(countToken(RUBBER.yarnName)).toBe("110/70");
    expect(colourToken(GIZA.yarnName)).toBe("Black");
    expect(colourToken(RUBBER.yarnName)).toBe("Navy");
  });

  test("one, several, too many, and none", () => {
    const yarns = [GIZA, COMBED, SIXTY, RUBBER];
    expect(classifyYarnMatches("110/70 navy rubber", yarns)).toEqual({ match: RUBBER });
    const ambiguous = classifyYarnMatches("cotton 40s black", yarns);
    expect(ambiguous.error).toBe("AMBIGUOUS");
    expect(ambiguous.matches.map((yarn) => yarn.yarnCatalogId)).toEqual(["1", "2"]);
    const many = Array.from({ length: 12 }, (_, index) => ({
      yarnCatalogId: String(index),
      yarnName: `${index}s-Red-Red-Cotton/Combed`,
    }));
    const tooMany = classifyYarnMatches("cotton", many);
    expect(tooMany.error).toBe("TOO_MANY");
    expect(tooMany.count).toBe(12);
    expect(tooMany.counts).toHaveLength(10);
    expect(tooMany.colours).toEqual(["Red"]);
    expect(classifyYarnMatches("silk", yarns)).toEqual({ error: "NOT_FOUND" });
  });
});
