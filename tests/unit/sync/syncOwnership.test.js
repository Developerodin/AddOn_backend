import { getApplyDecision, refuseDomainApply } from '../../../src/services/sync/syncOwnership.service.js';

describe('sync ownership gate', () => {
  it('refuses domain apply while the build is shadow-only', async () => {
    await expect(getApplyDecision('vendorProductionFlow')).resolves.toEqual({
      allowed: false,
      reason: 'SHADOW_ONLY',
    });
    await expect(refuseDomainApply('vendorProductionFlow')).rejects.toThrow('SHADOW_ONLY');
  });
});
