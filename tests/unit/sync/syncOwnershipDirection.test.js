import { jest } from '@jest/globals';

const findOneAndUpdate = jest.fn();
const findById = jest.fn();

jest.unstable_mockModule('../../../src/models/sync/syncInbox.model.js', () => ({
  default: {
    findOneAndUpdate: (...a) => ({ lean: () => findOneAndUpdate(...a) }),
    findById: (...a) => ({ select: () => ({ lean: () => findById(...a) }) }),
    updateOne: jest.fn(),
    find: jest.fn(),
  },
}));

const { applyPilotEvent, isPilotApplyEvent } = await import('../../../src/services/sync/syncPilotApply.service.js');
const { checkEventPolicy } = await import('../../../src/services/sync/syncPolicy.js');
const { default: config } = await import('../../../src/config/config.js');

const row = (over) => ({ _id: 'r1', eventId: 'e1', payload: {}, ...over });

describe('ownership apply direction', () => {
  const original = { ...config.sync };

  beforeEach(() => {
    findOneAndUpdate.mockReset().mockResolvedValue(null);
    findById.mockReset().mockResolvedValue({ status: 'APPLIED' });
    Object.assign(config.sync, { enabled: true, applyPilot: true, factorySiteId: 'factory-mac' });
  });

  afterAll(() => {
    Object.assign(config.sync, original);
  });

  it.each([
    ['productionOrder', 'productionArticleFloorTransfer'],
    ['productionOrder', 'productionArticleFloorReceive'],
    ['yarnCone', 'yarnConeFloorIssued'],
    ['yarnCone', 'yarnConeReturned'],
    ['warehouseInventory', 'warehouseInventoryUpdated'],
    ['vendorProductionFlow', 'vendorFloorTransfer'],
  ])('refuses factory-owned %s/%s from the cloud without claiming it', async (entityType, eventType) => {
    const out = await applyPilotEvent(row({ entityType, eventType, sourceSiteId: 'cloud-mac' }));
    expect(out.applyOutcome).toBe('DIRECTION_REFUSED');
    expect(out.domainInvoked).toBe(false);
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['category', 'categoryCreated'],
    ['product', 'productCreated'],
    ['styleCode', 'styleCodeCreated'],
    ['yarnCatalog', 'yarnCatalogCreated'],
  ])('accepts master %s/%s from either site', async (entityType, eventType) => {
    for (const sourceSiteId of ['cloud-mac', 'factory-mac']) {
      // eslint-disable-next-line no-await-in-loop
      const out = await applyPilotEvent(row({ entityType, eventType, sourceSiteId }));
      expect(out.applyOutcome).toBe('ALREADY_APPLIED');
    }
    expect(findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  it('a Warehouse floor receive stays store-only', async () => {
    const out = await applyPilotEvent(
      row({
        entityType: 'productionOrder',
        eventType: 'productionArticleFloorReceive',
        sourceSiteId: 'factory-mac',
        payload: { floor: 'Warehouse' },
      })
    );
    expect(out.applyOutcome).toBe('STORE_ONLY_WAREHOUSE_RECEIVE');
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('a factory floor issue is covered by the document copy and does not replay the service', async () => {
    const inbox = (await import('../../../src/models/sync/syncInbox.model.js')).default;
    inbox.updateOne.mockClear();
    findOneAndUpdate.mockResolvedValue({
      _id: 'r1',
      eventId: 'e1',
      entityType: 'yarnCone',
      eventType: 'yarnConeFloorIssued',
      sourceSiteId: 'factory-mac',
      payload: { coneId: 'c1', floor: 'linking' },
      aggregateId: 'c1',
    });
    const out = await applyPilotEvent(
      row({
        entityType: 'yarnCone',
        eventType: 'yarnConeFloorIssued',
        sourceSiteId: 'factory-mac',
        payload: { coneId: 'c1', floor: 'linking' },
      })
    );
    expect(out.applyOutcome).toBe('COVERED_BY_DOCUMENT_UPSERT');
    expect(out.domainInvoked).toBe(false);
    expect(inbox.updateOne).toHaveBeenCalled();
    const finished = inbox.updateOne.mock.calls[0][1].$set;
    expect(finished.status).toBe('APPLIED');
  });

  it('an event type on the wrong entity type is not an apply event', () => {
    expect(isPilotApplyEvent(row({ entityType: 'product', eventType: 'yarnConeCreated' }))).toBe(false);
  });

  it('a user-log delete is refused and a pick-list delete is accepted', () => {
    const payload = { _id: 'x', modelName: 'PickList', collectionName: 'picklists' };
    expect(
      checkEventPolicy(
        { siteId: 'factory-mac', entityType: 'UserActivityLog', eventType: 'documentRemoved', payload },
        'factory-mac'
      ).code
    ).toBe('ENTITY_TYPE_NOT_ALLOWED');
    expect(
      checkEventPolicy(
        { siteId: 'factory-mac', entityType: 'PickList', eventType: 'documentRemoved', payload },
        'factory-mac'
      )
    ).toBeNull();
  });

  it('the receiver policy refuses derived quantities in the new entity types', () => {
    const base = {
      siteId: 'factory-mac',
      entityType: 'warehouseInventory',
      payload: { _id: 'x', body: { remainingQty: 1 } },
    };
    expect(checkEventPolicy(base, 'factory-mac').code).toBe('DERIVED_FIELD_NOT_ALLOWED');
    expect(checkEventPolicy({ ...base, payload: { _id: 'x' } }, 'factory-mac')).toBeNull();
  });
});
