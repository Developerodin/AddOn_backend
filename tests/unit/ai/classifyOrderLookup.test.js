import { describe, test, expect } from '@jest/globals'; // eslint-disable-line import/no-extraneous-dependencies
import { classifyOrderLookup, SUFFIX_CANDIDATE_LIMIT } from '../../../src/ai/tools/getProductionOrder.js';

describe('classifyOrderLookup', () => {
  test('an exact orderNumber wins and does not set matchedFrom', () => {
    expect(classifyOrderLookup('ORD-000123', 'ORD-000123', ['ORD-000123', 'ORD-999123'])).toEqual({
      orderNumber: 'ORD-000123',
    });
  });

  test('one suffix match returns that order with matchedFrom', () => {
    expect(classifyOrderLookup('123', null, ['ORD-000123'])).toEqual({
      orderNumber: 'ORD-000123',
      matchedFrom: '123',
    });
  });

  test('several suffix matches return AMBIGUOUS and at most 10 candidates', () => {
    const suffixOrderNumbers = Array.from({ length: 11 }, (_, index) => `ORD-${index}-424242`);
    const result = classifyOrderLookup('424242', null, suffixOrderNumbers);
    expect(result.error).toBe('AMBIGUOUS');
    expect(result.candidates).toEqual(suffixOrderNumbers.slice(0, SUFFIX_CANDIDATE_LIMIT));
    expect(result.candidates).toHaveLength(10);
  });

  test('no exact match and no suffix match returns NOT_FOUND', () => {
    expect(classifyOrderLookup('999001', null, [])).toEqual({ error: 'NOT_FOUND' });
    expect(classifyOrderLookup('EVAL-NONE', null, [])).toEqual({ error: 'NOT_FOUND' });
  });
});
