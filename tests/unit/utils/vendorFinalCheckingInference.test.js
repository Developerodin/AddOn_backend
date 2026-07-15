import {
  buildFinalCheckingOutboundMaps,
  inferFinalCheckingReceivedDataBrandingTypes,
  assertFinalCheckingTransferredWithinInboundChannelCap,
  vendorStyleKey,
} from '../../../src/utils/vendorStyleQuantity.util.js';

describe('inferFinalCheckingReceivedDataBrandingTypes', () => {
  const styleId = '699024260d1e1d92d979de20';
  const brand = 'Van Heusen';
  const styleKey = vendorStyleKey(styleId, brand);

  const htOutbound = new Map([[styleKey, 150]]);
  const rbOutbound = new Map([[styleKey, 140]]);

  test('legacy 150 without brandingType infers as Heat Transfer when HT outbound exists', () => {
    const receivedData = [
      { styleCode: styleId, brand, transferred: 150 },
      { styleCode: styleId, brand, transferred: 140, brandingType: 'Embroidery' },
    ];
    const enriched = inferFinalCheckingReceivedDataBrandingTypes(receivedData, htOutbound, rbOutbound);
    expect(enriched[0].brandingType).toBe('Heat Transfer');
    expect(enriched[1].brandingType).toBe('Embroidery');
  });

  test('does not double-count — HT and Emb totals stay separate', () => {
    const receivedData = [
      { styleCode: styleId, brand, transferred: 150 },
      { styleCode: styleId, brand, transferred: 140, brandingType: 'Embroidery' },
    ];
    const enriched = inferFinalCheckingReceivedDataBrandingTypes(receivedData, htOutbound, rbOutbound);
    const htSum = enriched
      .filter((r) => r.brandingType === 'Heat Transfer')
      .reduce((s, r) => s + r.transferred, 0);
    const embSum = enriched
      .filter((r) => r.brandingType === 'Embroidery')
      .reduce((s, r) => s + r.transferred, 0);
    expect(htSum).toBe(150);
    expect(embSum).toBe(140);
  });
});

describe('assertFinalCheckingTransferredWithinInboundChannelCap with flow inference', () => {
  const styleId = '699024260d1e1d92d979de20';
  const brand = 'Van Heusen';

  const flow = {
    floorQuantities: {
      branding: {
        transferredData: [
          { styleCode: styleId, brand, transferred: 150, brandingType: 'Heat Transfer' },
        ],
      },
      reBoarding: {
        transferredData: [{ styleCode: styleId, brand, transferred: 140 }],
      },
      finalChecking: {
        receivedData: [
          { styleCode: styleId, brand, transferred: 150 },
          { styleCode: styleId, brand, transferred: 140, brandingType: 'Embroidery' },
        ],
      },
    },
  };

  test('allows HT M1 up to inferred legacy inbound cap', () => {
    expect(() =>
      assertFinalCheckingTransferredWithinInboundChannelCap(
        [{ styleCode: styleId, brand, transferred: 150, brandingType: 'Heat Transfer' }],
        flow.floorQuantities.finalChecking.receivedData,
        flow
      )
    ).not.toThrow();
  });

  test('buildFinalCheckingOutboundMaps splits HT branding from RB', () => {
    const { htOutbound, rbOutbound } = buildFinalCheckingOutboundMaps(flow);
    expect(htOutbound.get(vendorStyleKey(styleId, brand))).toBe(150);
    expect(rbOutbound.get(vendorStyleKey(styleId, brand))).toBe(140);
  });
});
