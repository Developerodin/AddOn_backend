import { resolveSupplierYarnTearweight } from '../../../src/services/yarnManagement/supplierYarnTearweight.helper.js';

describe('resolveSupplierYarnTearweight', () => {
  const catalogId = '6a91688cab55ed40e21c7b45';
  const details = [
    { yarnName: '20s-Sky Blue-Bamboo/Bamboo', yarnCatalogId: catalogId, tearweight: 0.05 },
    { yarnName: '20s-Pastel Yellow-Lemon Yellow-Bamboo/Bamboo', yarnCatalogId: 'aaa', tearweight: 0.05 },
  ];

  test('exact yarnName match', () => {
    expect(
      resolveSupplierYarnTearweight(details, '20s-Pastel Yellow-Lemon Yellow-Bamboo/Bamboo', [])
    ).toBe(0.05);
  });

  test('catalog-id match when supplier yarnName dropped the shade token', () => {
    expect(
      resolveSupplierYarnTearweight(details, '20s-Sky Blue-Sky Blue-Bamboo/Bamboo', [catalogId])
    ).toBe(0.05);
  });

  test('returns null when neither name nor catalog matches', () => {
    expect(resolveSupplierYarnTearweight(details, '20s-Unknown-Bamboo/Bamboo', ['deadbeef'])).toBeNull();
  });

  test('ignores empty requested name', () => {
    expect(resolveSupplierYarnTearweight(details, '  ', [catalogId])).toBeNull();
  });
});
