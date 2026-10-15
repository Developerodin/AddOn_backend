import { mapWebsiteProductsToLines } from '../../../src/services/integrations/websiteOrderLineMap.util.js';

const single = new Map([
  ['LPO1SQCBD00324', { _id: 'single-1', styleCode: 'LPO1SQCBD00324', pack: '1 Pair' }],
]);

const pairs = new Map([
  ['PFR3', { _id: 'pair-short', pairStyleCode: 'PFR3', pack: 10, eanCode: '111' }],
  [
    'PEC1SQCFN00067/PEC1SQCFN00068/PEC1SQCFN00069',
    {
      _id: 'pair-slash',
      pairStyleCode: 'PEC1SQCFN00067/PEC1SQCFN00068/PEC1SQCFN00069',
      pack: 3,
      eanCode: '222',
    },
  ],
]);

describe('mapWebsiteProductsToLines', () => {
  it('keeps a catalogue style code on single pair', () => {
    const mapped = mapWebsiteProductsToLines(
      [{ model: 'LPO1SQCBD00324', quantity: 10, options: [{ name: 'Color', value: 'Black' }] }],
      single,
      pairs
    );

    expect(mapped.singlePair).toEqual([
      {
        styleCodeId: 'single-1',
        styleCode: 'LPO1SQCBD00324',
        pack: '1 Pair',
        colour: 'Black',
        quantity: 10,
      },
    ]);
    expect(mapped.multiPair).toHaveLength(0);
    expect(mapped.syncErrors).toHaveLength(0);
  });

  it('maps a short pair code and a slash-joined pair code onto multi pair', () => {
    const mapped = mapWebsiteProductsToLines(
      [
        { model: 'PFR3', quantity: 2, options: [{ name: 'Pack', value: 'Pack of 10' }] },
        { model: 'PEC1SQCFN00067/PEC1SQCFN00068/PEC1SQCFN00069', quantity: 4 },
      ],
      single,
      pairs
    );

    expect(mapped.singlePair).toHaveLength(0);
    expect(mapped.multiPair).toEqual([
      {
        styleCodeMultiPairId: 'pair-short',
        styleCode: 'PFR3',
        pack: 'Pack of 10',
        colour: '',
        eanCode: '111',
        quantity: 2,
      },
      {
        styleCodeMultiPairId: 'pair-slash',
        styleCode: 'PEC1SQCFN00067/PEC1SQCFN00068/PEC1SQCFN00069',
        pack: '3',
        colour: '',
        eanCode: '222',
        quantity: 4,
      },
    ]);
    expect(mapped.syncErrors).toHaveLength(0);
  });

  it('leaves a model that is in neither catalogue as a mapping error', () => {
    const mapped = mapWebsiteProductsToLines(
      [{ model: 'MISSING/CODE', quantity: 1 }, { model: '', quantity: 1 }],
      single,
      pairs
    );

    expect(mapped.syncErrors).toEqual([
      { model: 'MISSING/CODE', reason: 'style_code_not_found', quantity: 1 },
      { model: '', reason: 'missing_model' },
    ]);
  });
});
