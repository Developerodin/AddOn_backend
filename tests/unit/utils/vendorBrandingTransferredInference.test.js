import {
  enrichBrandingTransferredDataRows,
  inferBrandingTransferredRowType,
  mergeBrandingTransferredDataByLineKey,
  vendorStyleKey,
} from '../../../src/utils/vendorStyleQuantity.util.js';

describe('inferBrandingTransferredRowType', () => {
  const styleId = '699024260d1e1d92d979de20';
  const brand = 'Van Heusen';

  test('legacy 150 without brandingType infers as Heat Transfer when Embroidery sibling exists', () => {
    const rows = [
      { styleCode: styleId, brand, transferred: 150 },
      { styleCode: styleId, brand, transferred: 140, brandingType: 'Embroidery' },
    ];
    expect(inferBrandingTransferredRowType(rows[0], rows)).toBe('Heat Transfer');
    expect(inferBrandingTransferredRowType(rows[1], rows)).toBe('Embroidery');
  });

  test('uses flow fallback when no sibling types exist', () => {
    const rows = [{ styleCode: styleId, brand, transferred: 150 }];
    expect(inferBrandingTransferredRowType(rows[0], rows, 'Heat Transfer')).toBe('Heat Transfer');
  });
});

describe('enrichBrandingTransferredDataRows', () => {
  const styleId = '699024260d1e1d92d979de20';
  const brand = 'Van Heusen';

  test('stamps Heat Transfer on legacy HT line in mixed breakdown', () => {
    const rows = [
      { styleCode: styleId, brand, transferred: 150 },
      { styleCode: styleId, brand, transferred: 140, brandingType: 'Embroidery' },
    ];
    const enriched = enrichBrandingTransferredDataRows(rows);
    expect(enriched[0].brandingType).toBe('Heat Transfer');
    expect(enriched[1].brandingType).toBe('Embroidery');
  });
});

describe('mergeBrandingTransferredDataByLineKey legacy HT', () => {
  const styleId = '699024260d1e1d92d979de20';
  const brand = 'Van Heusen';
  const styleKey = vendorStyleKey(styleId, brand);

  test('merges incoming HT delta into legacy untagged row after enrichment', () => {
    const existing = [{ styleCode: styleId, brand, transferred: 150 }];
    const incoming = [
      { styleCode: styleId, brand, transferred: 10, brandingType: 'Heat Transfer' },
    ];
    const merged = mergeBrandingTransferredDataByLineKey(existing, incoming, 'Heat Transfer');
    expect(merged).toHaveLength(1);
    expect(merged[0].brandingType).toBe('Heat Transfer');
    expect(merged[0].transferred).toBe(160);
    expect(styleKey).toBeTruthy();
  });
});
