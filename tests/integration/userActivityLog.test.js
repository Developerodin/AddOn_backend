import request from 'supertest';
import moment from 'moment';
import httpStatus from 'http-status';
import app from '../../src/app.js';
import setupTestDB from '../utils/setupTestDB.js';
import { insertUsers } from '../fixtures/user.fixture.js';
import { admin } from '../fixtures/user.fixture.js';
import tokenService from '../../src/services/token.service.js';
import config from '../../src/config/config.js';
import { tokenTypes } from '../../src/config/tokens.js';

setupTestDB();

describe('User Activity Logs', () => {
  let adminAccessToken;

  beforeEach(async () => {
    await insertUsers([admin]);
    const expires = moment().add(config.jwt.accessExpirationMinutes, 'minutes');
    adminAccessToken = tokenService.generateToken(admin._id, expires, tokenTypes.ACCESS);
  });

  describe('GET /v1/user-activity-logs/me', () => {
    test('should return 401 without token', async () => {
      await request(app).get('/v1/user-activity-logs/me').expect(httpStatus.UNAUTHORIZED);
    });

    test('should return empty results initially', async () => {
      const res = await request(app)
        .get('/v1/user-activity-logs/me')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(httpStatus.OK);

      expect(res.body.results).toEqual([]);
      expect(res.body.totalResults).toBe(0);
    });

    test('should create and return logs after API calls with token', async () => {
      // Make API call that should be logged
      await request(app)
        .get('/v1/users/me')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(httpStatus.OK);

      // Wait for async log write
      await new Promise((r) => setTimeout(r, 500));

      const res = await request(app)
        .get('/v1/user-activity-logs/me')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(httpStatus.OK);

      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
      expect(res.body.results.length).toBeGreaterThanOrEqual(1);
      const log = res.body.results[0];
      expect(log).toMatchObject({
        method: 'GET',
        path: '/v1/users/me',
        action: 'read',
        resource: 'users',
      });
    });
  });

  describe('GET /v1/user-activity-logs/me/stats', () => {
    test('should return stats', async () => {
      const res = await request(app)
        .get('/v1/user-activity-logs/me/stats')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(httpStatus.OK);

      expect(res.body).toHaveProperty('totals');
      expect(res.body).toHaveProperty('byAction');
      expect(res.body).toHaveProperty('byResource');
    });
  });
});
