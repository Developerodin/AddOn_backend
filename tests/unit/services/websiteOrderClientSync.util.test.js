import {
  TRADE_REQUIRED_WEB_SYNC_FIELDS,
  buildClientPatchFromWebsite,
  getTradeClientIncompleteFields,
  mergeWebsiteFieldsIntoClient,
} from '../../../src/services/integrations/websiteOrderClientSync.util.js';

describe('websiteOrderClientSync.util', () => {
  describe('buildClientPatchFromWebsite', () => {
    it('maps website customer fields to Trade client patch', () => {
      const patch = buildClientPatchFromWebsite({
        opencartCustomerId: 42,
        companyName: 'Shivanshi Enterprises',
        contactPerson: 'Raj',
        email: 'raj@example.com',
        telephone: '9999999999',
        gstin: '29AAAAA0000A1Z5',
        address1: '12 Main St',
        city: 'Jaipur',
        postcode: '302001',
        zone: 'Rajasthan',
      });

      expect(patch.retailerName).toBe('Shivanshi Enterprises');
      expect(patch.email).toBe('raj@example.com');
      expect(patch.parentKeyCode).toBe('OC-42');
      expect(patch.gstin).toBe('29AAAAA0000A1Z5');
    });

    it('falls back to shipping address when payment address missing', () => {
      const patch = buildClientPatchFromWebsite({
        opencartCustomerId: 1,
        companyName: 'Test Co',
        shippingAddress1: 'Ship St',
        shippingCity: 'Mumbai',
      });

      expect(patch.address).toBe('Ship St');
      expect(patch.city).toBe('Mumbai');
    });
  });

  describe('getTradeClientIncompleteFields', () => {
    it('returns all required fields when client is empty', () => {
      expect(getTradeClientIncompleteFields({})).toEqual([...TRADE_REQUIRED_WEB_SYNC_FIELDS]);
    });

    it('returns only missing fields', () => {
      const missing = getTradeClientIncompleteFields({
        retailerName: 'Acme',
        email: 'a@b.com',
        mobilePhone: '123',
        gstin: 'GST',
        address: 'Addr',
        city: 'City',
        state: 'State',
        zipCode: '',
      });
      expect(missing).toEqual(['zipCode']);
    });

    it('returns empty array when profile is complete', () => {
      const missing = getTradeClientIncompleteFields({
        retailerName: 'Acme',
        email: 'a@b.com',
        mobilePhone: '123',
        gstin: 'GST',
        address: 'Addr',
        city: 'City',
        state: 'State',
        zipCode: '302001',
      });
      expect(missing).toEqual([]);
    });
  });

  describe('mergeWebsiteFieldsIntoClient', () => {
    it('fills empty client fields without overwriting existing values', () => {
      const client = {
        retailerName: 'Existing Co',
        email: '',
        mobilePhone: '111',
        gstin: '',
        address: '',
        city: '',
        state: '',
        zipCode: '',
      };
      const changed = mergeWebsiteFieldsIntoClient(client, {
        retailerName: 'New Co',
        email: 'new@example.com',
        mobilePhone: '222',
        gstin: 'GST123',
        address: 'Addr',
        city: 'Jaipur',
        state: 'RJ',
        zipCode: '302001',
        parentKeyCode: 'OC-99',
      });

      expect(changed).toBe(true);
      expect(client.retailerName).toBe('Existing Co');
      expect(client.email).toBe('new@example.com');
      expect(client.mobilePhone).toBe('111');
      expect(client.gstin).toBe('GST123');
    });
  });
});
