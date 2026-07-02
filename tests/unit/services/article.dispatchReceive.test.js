import { describe, test, expect } from '@jest/globals';
import {
  getFloorKey,
  resolveFeederFloorKeyBefore,
  resolvePreviousFloorNameInOrder,
} from '../../../src/utils/productionHelper.js';

describe('productionHelper — Dispatch receive source floor', () => {
  test('SC→Dispatch flow uses secondaryChecking as feeder (not finalChecking)', () => {
    const floorOrder = ['Secondary Checking', 'Dispatch'];
    const sourceKey = resolveFeederFloorKeyBefore(floorOrder, 'Dispatch', getFloorKey, 'finalChecking');
    expect(sourceKey).toBe('secondaryChecking');
  });

  test('standard FC→Dispatch flow still uses finalChecking', () => {
    const floorOrder = ['Secondary Checking', 'Branding', 'Final Checking', 'Dispatch'];
    const sourceKey = resolveFeederFloorKeyBefore(floorOrder, 'Dispatch', getFloorKey, 'finalChecking');
    expect(sourceKey).toBe('finalChecking');
  });

  test('accept cap: 199 receivable from secondaryChecking when transferred=199 and dispatch.received=0', () => {
    const floorOrder = ['Secondary Checking', 'Dispatch'];
    const sourceKey = resolveFeederFloorKeyBefore(floorOrder, 'Dispatch', getFloorKey, 'finalChecking');
    const floorQuantities = {
      secondaryChecking: { transferred: 199, received: 199 },
      finalChecking: { transferred: 0 },
      dispatch: { received: 0 },
    };
    const maxReceivable = Math.max(
      0,
      (floorQuantities[sourceKey]?.transferred || 0) - (floorQuantities.dispatch.received || 0)
    );
    expect(maxReceivable).toBe(199);
    expect(199 <= maxReceivable).toBe(true);
  });

  test('old bug: hardcoded finalChecking cap would reject SC→Dispatch accept', () => {
    const floorQuantities = {
      secondaryChecking: { transferred: 199 },
      finalChecking: { transferred: 0 },
      dispatch: { received: 0 },
    };
    const wrongMax = Math.max(0, floorQuantities.finalChecking.transferred - floorQuantities.dispatch.received);
    expect(wrongMax).toBe(0);
    expect(199 > wrongMax).toBe(true);
  });

  test('resolvePreviousFloorNameInOrder for Dispatch hint text', () => {
    expect(resolvePreviousFloorNameInOrder(['Secondary Checking', 'Dispatch'], 'Dispatch')).toBe(
      'Secondary Checking'
    );
    expect(
      resolvePreviousFloorNameInOrder(['Secondary Checking', 'Branding', 'Final Checking', 'Dispatch'], 'Dispatch')
    ).toBe('Final Checking');
  });
});
