import {
  emptyUpcomingFloors,
  productionQtyOnContainer,
  resolveUpcomingFloorKey,
  sumUpcomingFromContainers,
} from '../../../src/services/production/backlogUpcoming.util.js';

describe('backlogUpcoming.util', () => {
  describe('resolveUpcomingFloorKey', () => {
    test('maps enum labels and camelCase keys', () => {
      expect(resolveUpcomingFloorKey('Linking')).toBe('linking');
      expect(resolveUpcomingFloorKey('Secondary Checking')).toBe('secondaryChecking');
      expect(resolveUpcomingFloorKey('linking')).toBe('linking');
      expect(resolveUpcomingFloorKey('secondaryChecking')).toBe('secondaryChecking');
    });

    test('is case-insensitive on enum labels', () => {
      expect(resolveUpcomingFloorKey('linking')).toBe('linking');
      expect(resolveUpcomingFloorKey('FINAL CHECKING')).toBe('finalChecking');
    });

    test('returns null for blank or unknown floors', () => {
      expect(resolveUpcomingFloorKey('')).toBeNull();
      expect(resolveUpcomingFloorKey(null)).toBeNull();
      expect(resolveUpcomingFloorKey('Not A Floor')).toBeNull();
    });
  });

  describe('productionQtyOnContainer', () => {
    test('sums article rows and skips vendor-only rows', () => {
      expect(
        productionQtyOnContainer({
          activeItems: [
            { article: 'a1', quantity: 10 },
            { vendorProductionFlow: 'v1', quantity: 99 },
            { article: 'a2', quantity: 2.5 },
          ],
        })
      ).toBe(12.5);
    });

    test('uses legacy activeArticle + quantity when activeItems is empty', () => {
      expect(
        productionQtyOnContainer({
          activeItems: [],
          activeArticle: 'legacy',
          quantity: 40,
        })
      ).toBe(40);
    });
  });

  describe('sumUpcomingFromContainers', () => {
    test('groups by floor, rounds per floor, and sums rounded totals', () => {
      const { floors, upcomingTotal } = sumUpcomingFromContainers([
        { activeFloor: 'Linking', activeItems: [{ article: 'a', quantity: 11893 }] },
        { activeFloor: 'Secondary Checking', activeItems: [{ article: 'b', quantity: 2575.5 }] },
        { activeFloor: 'Final Checking', activeItems: [{ article: 'c', quantity: 23422.5 }] },
        { activeFloor: 'Linking', activeItems: [{ vendorProductionFlow: 'v', quantity: 500 }] },
      ]);
      expect(floors.linking).toBe(11893);
      expect(floors.secondaryChecking).toBe(2576);
      expect(floors.finalChecking).toBe(23423);
      expect(floors.checking).toBe(0);
      expect(upcomingTotal).toBe(11893 + 2576 + 23423);
    });

    test('starts from a zeroed map for every floor key', () => {
      const empty = emptyUpcomingFloors();
      expect(empty.knitting).toBe(0);
      expect(empty.warehouse).toBe(0);
      expect(Object.keys(empty).length).toBeGreaterThan(8);
    });
  });
});
