import {
  aggregateFinalCheckingReceivedForSourceCap,
  vendorStyleKey,
} from '../../../src/utils/vendorStyleQuantity.util.js';

describe('aggregateFinalCheckingReceivedForSourceCap', () => {
  const styleKey = vendorStyleKey('699024260d1e1d92d979de20', 'Van Heusen');
  const htOutbound = new Map([[styleKey, 150]]);

  test('reBoarding source ignores legacy HT received without brandingType', () => {
    const receivedData = [
      { styleCode: '699024260d1e1d92d979de20', brand: 'Van Heusen', transferred: 150 },
    ];
    const map = aggregateFinalCheckingReceivedForSourceCap(receivedData, 'reBoarding', htOutbound);
    expect(map.get(styleKey) ?? 0).toBe(0);
  });

  test('reBoarding source counts only Embroidery-tagged lines', () => {
    const receivedData = [
      { styleCode: '699024260d1e1d92d979de20', brand: 'Van Heusen', transferred: 150 },
      {
        styleCode: '699024260d1e1d92d979de20',
        brand: 'Van Heusen',
        transferred: 140,
        brandingType: 'Embroidery',
      },
    ];
    const map = aggregateFinalCheckingReceivedForSourceCap(receivedData, 'reBoarding', htOutbound);
    expect(map.get(styleKey)).toBe(140);
  });

  test('branding source counts HT and legacy lines with HT outbound', () => {
    const receivedData = [
      { styleCode: '699024260d1e1d92d979de20', brand: 'Van Heusen', transferred: 150 },
      {
        styleCode: '699024260d1e1d92d979de20',
        brand: 'Van Heusen',
        transferred: 140,
        brandingType: 'Embroidery',
      },
    ];
    const map = aggregateFinalCheckingReceivedForSourceCap(receivedData, 'branding', htOutbound);
    expect(map.get(styleKey)).toBe(150);
  });
});
