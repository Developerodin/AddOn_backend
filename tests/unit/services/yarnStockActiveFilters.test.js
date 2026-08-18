import { activeYarnBoxMatch, activeYarnBoxListingMatch, notPoReturnedBoxMatch } from '../../../src/services/yarnManagement/yarnStockActiveFilters.js';

describe('yarnStockActiveFilters atVendorAt', () => {
  test('activeYarnBoxMatch excludes atVendorAt and returnedToVendorAt', () => {
    expect(activeYarnBoxMatch.$or).toEqual([
      { returnedToVendorAt: { $exists: false } },
      { returnedToVendorAt: null },
    ]);
    expect(activeYarnBoxMatch.$and).toEqual([
      { $or: [{ atVendorAt: { $exists: false } }, { atVendorAt: null }] },
    ]);
  });

  test('listing match keeps atVendor exclusion via spread', () => {
    expect(activeYarnBoxListingMatch.$and).toEqual(activeYarnBoxMatch.$and);
  });

  test('uniqueness match still includes at-vendor boxes', () => {
    expect(notPoReturnedBoxMatch.$and).toBeUndefined();
    expect(notPoReturnedBoxMatch.$or).toEqual(activeYarnBoxMatch.$or);
  });
});
