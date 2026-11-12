import Joi from 'joi';
import { buildSyncConfig, syncEnvKeys } from '../../../src/config/syncConfig.js';

const schema = Joi.object(syncEnvKeys).unknown(false);

describe('sync env flags', () => {
  it('boots with no SYNC_* keys and stays dark', () => {
    const { error, value } = schema.validate({});
    expect(error).toBeUndefined();
    const sync = buildSyncConfig(value);
    expect(sync.enabled).toBe(false);
    expect(sync.shadowVendorTransfer).toBe(false);
    expect(sync.workerEnabled).toBe(false);
    expect(sync.applyMode).toBe('shadow');
    expect(sync.siteId).toBe('');
    expect(sync.applyPilot).toBe(false);
  });

  it('SYNC_APPLY_PILOT is true only for the literal true', () => {
    expect(buildSyncConfig(schema.validate({ SYNC_APPLY_PILOT: 'true' }).value).applyPilot).toBe(true);
    expect(buildSyncConfig(schema.validate({ SYNC_APPLY_PILOT: 'false' }).value).applyPilot).toBe(false);
    expect(buildSyncConfig(schema.validate({ SYNC_APPLY_PILOT: 'yes' }).value).applyPilot).toBe(false);
  });

  it('still rejects apply mode when the pilot is on', () => {
    const { error } = schema.validate({ SYNC_APPLY_PILOT: 'true', SYNC_APPLY_MODE: 'apply' });
    expect(error).toBeTruthy();
  });

  it('rejects apply mode', () => {
    const { error } = schema.validate({ SYNC_APPLY_MODE: 'apply' });
    expect(error).toBeTruthy();
  });
});
