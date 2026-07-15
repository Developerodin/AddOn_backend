import {
  assertFinalCheckingTransferredWithinInboundChannelCap,
  vendorStyleKey,
} from '../../../src/utils/vendorStyleQuantity.util.js';
import ApiError from '../../../src/utils/ApiError.js';

describe('assertFinalCheckingTransferredWithinInboundChannelCap', () => {
  const styleId = '699024260d1e1d92d979de20';
  const brand = 'Van Heusen';

  const receivedData = [
    { styleCode: styleId, brand, transferred: 150, brandingType: 'Heat Transfer' },
    { styleCode: styleId, brand, transferred: 140, brandingType: 'Embroidery' },
  ];

  test('allows brand-level line within total inbound cap (290)', () => {
    expect(() =>
      assertFinalCheckingTransferredWithinInboundChannelCap(
        [{ styleCode: styleId, brand, transferred: 290 }],
        receivedData
      )
    ).not.toThrow();
  });

  test('rejects brand-level line exceeding total inbound cap', () => {
    expect(() =>
      assertFinalCheckingTransferredWithinInboundChannelCap(
        [{ styleCode: styleId, brand, transferred: 291 }],
        receivedData
      )
    ).toThrow(ApiError);
  });

  test('consolidates per-channel transferred lines against total inbound cap', () => {
    const key = vendorStyleKey(styleId, brand);
    expect(key).toContain(styleId);
    expect(() =>
      assertFinalCheckingTransferredWithinInboundChannelCap(
        [
          { styleCode: styleId, brand, transferred: 150, brandingType: 'Heat Transfer' },
          { styleCode: styleId, brand, transferred: 140, brandingType: 'Embroidery' },
        ],
        receivedData
      )
    ).not.toThrow();

    expect(() =>
      assertFinalCheckingTransferredWithinInboundChannelCap(
        [
          { styleCode: styleId, brand, transferred: 150, brandingType: 'Heat Transfer' },
          { styleCode: styleId, brand, transferred: 141, brandingType: 'Embroidery' },
        ],
        receivedData
      )
    ).toThrow(ApiError);
  });

  test('legacy line without brandingType caps against total inbound for style+brand', () => {
    expect(() =>
      assertFinalCheckingTransferredWithinInboundChannelCap(
        [{ styleCode: styleId, brand, transferred: 290 }],
        receivedData
      )
    ).not.toThrow();

    expect(() =>
      assertFinalCheckingTransferredWithinInboundChannelCap(
        [{ styleCode: styleId, brand, transferred: 291 }],
        receivedData
      )
    ).toThrow(ApiError);
  });
});
