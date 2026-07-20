import { userHasWhmsRight, hasWhmsApiAccess } from '../../../src/utils/whmsNavigationAccess.util.js';

describe('whmsNavigationAccess.util', () => {
  const scannerNavUser = {
    role: 'user',
    navigation: {
      'Warehouse Management': {
        Scanning: true,
        Billing: false,
      },
    },
  };

  test('grants whmsScanning when Scanning navigation is enabled', () => {
    expect(userHasWhmsRight(scannerNavUser, 'whmsScanning')).toBe(true);
    expect(hasWhmsApiAccess(scannerNavUser, ['whmsScanning'])).toBe(true);
  });

  test('does not grant whmsBilling without Billing navigation', () => {
    expect(userHasWhmsRight(scannerNavUser, 'whmsBilling')).toBe(false);
  });

  test('does not grant whmsReturnsApprove from Returns navigation alone', () => {
    const returnsUser = {
      role: 'user',
      navigation: { 'Warehouse Management': { Returns: true } },
    };
    expect(userHasWhmsRight(returnsUser, 'whmsReturns')).toBe(true);
    expect(userHasWhmsRight(returnsUser, 'whmsReturnsApprove')).toBe(false);
  });

  test('still honors role-based whmsScanning for scanning_team', () => {
    expect(userHasWhmsRight({ role: 'scanning_team' }, 'whmsScanning')).toBe(true);
  });
});
