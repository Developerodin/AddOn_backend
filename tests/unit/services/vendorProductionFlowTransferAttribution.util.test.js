import {
  consolidateTransferredDataByStyleKey,
  mergeTransferredDataByStyleKey,
  resolveHomogeneousBrandingTypeFromRows,
} from '../../../src/utils/vendorStyleQuantity.util.js';
import { normalizeTransferBreakdownForReceipt } from '../../../src/services/vendorManagement/vendorProductionFlow.service.js';
import {
  preserveIncomingTransferredDelta,
  resolveContainerTransferBreakdownSource,
} from '../../../src/services/vendorManagement/vendorProductionFlowTransferAttribution.util.js';

const ALLEN_STYLE = '699024210d1e1d92d979a688';
const VAN_HEUSEN_STYLE = '699024270d1e1d92d979e69e';

/**
 * Mirror the floor PATCH: snapshot the client delta, then replace `transferredData` with the merged ledger.
 * @param {string} floorKey
 * @param {Array<Object>} prior
 * @param {Array<Object>} delta
 * @returns {Object}
 */
function patchBodyAfterLedgerMerge(floorKey, prior, delta) {
  const bodyForPatch = { transferredData: delta.map((row) => ({ ...row })) };
  preserveIncomingTransferredDelta(floorKey, bodyForPatch);
  const merged = mergeTransferredDataByStyleKey(prior, bodyForPatch.transferredData);
  bodyForPatch.transferredData =
    floorKey === 'finalChecking' ? consolidateTransferredDataByStyleKey(merged) : merged;
  return bodyForPatch;
}

describe('vendorProductionFlowTransferAttribution', () => {
  test('final checking container lines are the new delta, not the first cumulative style', () => {
    const prior = [{ styleCode: ALLEN_STYLE, brand: 'Allen Solly', transferred: 220 }];
    const delta = [{ styleCode: VAN_HEUSEN_STYLE, brand: 'Van Heusen', transferred: 200 }];
    const bodyForPatch = patchBodyAfterLedgerMerge('finalChecking', prior, delta);

    expect(bodyForPatch.transferredData).toEqual([
      { styleCode: ALLEN_STYLE, brand: 'Allen Solly', transferred: 220 },
      { styleCode: VAN_HEUSEN_STYLE, brand: 'Van Heusen', transferred: 200 },
    ]);

    const source = resolveContainerTransferBreakdownSource('finalChecking', bodyForPatch);
    const receiptRows = normalizeTransferBreakdownForReceipt(source, 200, 'finalChecking');

    expect(receiptRows.map((row) => ({
      styleCode: row.styleCode,
      brand: row.brand,
      transferred: row.transferred,
    }))).toEqual([{ styleCode: VAN_HEUSEN_STYLE, brand: 'Van Heusen', transferred: 200 }]);
  });

  test('re-boarding container lines use the incoming delta after the ledger merge', () => {
    const prior = [{ styleCode: ALLEN_STYLE, brand: 'Allen Solly', transferred: 220 }];
    const delta = [{ styleCode: VAN_HEUSEN_STYLE, brand: 'Van Heusen', transferred: 80 }];
    const bodyForPatch = patchBodyAfterLedgerMerge('reBoarding', prior, delta);
    const source = resolveContainerTransferBreakdownSource('reBoarding', bodyForPatch);
    const receiptRows = normalizeTransferBreakdownForReceipt(source, 80, 'reBoarding');

    expect(receiptRows.map((row) => ({
      styleCode: row.styleCode,
      brand: row.brand,
      transferred: row.transferred,
    }))).toEqual([{ styleCode: VAN_HEUSEN_STYLE, brand: 'Van Heusen', transferred: 80 }]);
  });

  test('branding staging still uses _incomingBrandingDelta for lines and type routing', () => {
    const prior = [{ styleCode: ALLEN_STYLE, brand: 'Allen Solly', transferred: 220, brandingType: 'Heat Transfer' }];
    const delta = [{ styleCode: VAN_HEUSEN_STYLE, brand: 'Van Heusen', transferred: 40, brandingType: 'Embroidery' }];
    const bodyForPatch = { transferredData: delta.map((row) => ({ ...row })) };
    preserveIncomingTransferredDelta('branding', bodyForPatch);
    bodyForPatch.transferredData = [...prior, ...delta];

    expect(bodyForPatch._incomingBrandingDelta).toEqual(delta);
    expect(bodyForPatch._incomingTransferredDelta).toBeUndefined();

    const source = resolveContainerTransferBreakdownSource('branding', bodyForPatch);
    expect(source).toBe(bodyForPatch._incomingBrandingDelta);
    expect(resolveHomogeneousBrandingTypeFromRows(source, 'Heat Transfer')).toBe('Embroidery');

    const receiptRows = normalizeTransferBreakdownForReceipt(source, 40, 'branding');
    expect(receiptRows.map((row) => ({
      styleCode: row.styleCode,
      brand: row.brand,
      transferred: row.transferred,
      brandingType: row.brandingType,
    }))).toEqual([
      {
        styleCode: VAN_HEUSEN_STYLE,
        brand: 'Van Heusen',
        transferred: 40,
        brandingType: 'Embroidery',
      },
    ]);
  });

  test('dispatch snapshot is the incoming delta when a breakdown is requested', () => {
    const prior = [{ styleCode: ALLEN_STYLE, brand: 'Allen Solly', transferred: 220 }];
    const delta = [{ styleCode: VAN_HEUSEN_STYLE, brand: 'Van Heusen', transferred: 15 }];
    const bodyForPatch = patchBodyAfterLedgerMerge('dispatch', prior, delta);
    const source = resolveContainerTransferBreakdownSource('dispatch', bodyForPatch);

    expect(source).toEqual(delta);
  });
});
