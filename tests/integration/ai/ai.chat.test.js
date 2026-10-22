/* eslint-env jest */
import { jest } from '@jest/globals'; // eslint-disable-line import/no-extraneous-dependencies
import mongoose from 'mongoose';
import request from 'supertest';
import httpStatus from 'http-status';
import setupTestDB from '../../utils/setupTestDB.js';
import { userOne, insertUsers } from '../../fixtures/user.fixture.js';
import { userOneAccessToken } from '../../fixtures/token.fixture.js';
import User from '../../../src/models/user.model.js';
import Article from '../../../src/models/production/article.model.js';
import ProductionOrder from '../../../src/models/production/productionOrder.model.js';
import {
  chatModelId,
  chatReasoningEffort,
  PROMPT_VERSION,
} from '../../../src/ai/loadSystemPrompt.js';

const streamText = jest.fn();

jest.unstable_mockModule('ai', () => ({
  streamText: (...args) => streamText(...args),
  convertToModelMessages: async (messages) => messages,
  isStepCount: (count) => ({ type: 'step-count', count }),
  toUIMessageStream: ({ stream }) => stream,
  pipeUIMessageStreamToResponse: async ({ response, stream }) => {
    response.writeHead(httpStatus.OK, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    });
    if (typeof stream === 'string' && stream) response.write(stream);
    response.end();
  },
}));

let app;
let executeTool;
let AiTrace;

beforeAll(async () => {
  ({ default: app } = await import('../../../src/app.js'));
  ({ executeTool } = await import('../../../src/ai/registry.js'));
  ({ default: AiTrace } = await import('../../../src/ai/models/aiTrace.model.js'));
});

setupTestDB();

const NAV_PATH = 'navigation.Production Planning.Production Orders';

/**
 * Inserts a production order and its articles without article pre-save hooks.
 * @param {{ orderNumber: string, status: string, priority?: string, articles: object[] }} spec
 * @returns {Promise<void>}
 */
async function insertOrder(spec) {
  const orderId = new mongoose.Types.ObjectId();
  const articles = spec.articles || [];
  const articleIds = await articles.reduce(async (previous, article) => {
    const ids = await previous;
    const articleId = new mongoose.Types.ObjectId();
    // Raw insert keeps received/transferred/grades exactly as the test set them.
    // Article.pre('save') would look up a product and rewrite floor quantities.
    await Article.collection.insertOne({
      _id: articleId,
      id: `art-${articleId.toString()}`,
      orderId,
      articleNumber: article.articleNumber,
      plannedQuantity: article.plannedQuantity,
      linkingType: 'Auto Linking',
      priority: spec.priority || 'High',
      status: article.status,
      progress: 0,
      floorQuantities: article.floorQuantities || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return ids.concat(articleId);
  }, Promise.resolve([]));
  await ProductionOrder.collection.insertOne({
    _id: orderId,
    orderNumber: spec.orderNumber,
    priority: spec.priority || 'High',
    status: spec.status,
    currentFloor: 'Knitting',
    articles: articleIds,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/**
 * Sets the Production Orders screen flag on the fixture user.
 * @param {boolean} allowed
 * @returns {Promise<import('mongoose').Document>}
 */
async function userWithProductionOrders(allowed) {
  await insertUsers([userOne]);
  const userId = userOne._id; // eslint-disable-line no-underscore-dangle
  await User.updateOne({ _id: userId }, { $set: { [NAV_PATH]: allowed } });
  return User.findById(userId);
}

describe('AI chat', () => {
  beforeEach(() => {
    streamText.mockReset();
    streamText.mockImplementation(async (options) => {
      if (typeof options.onFinish === 'function') {
        await options.onFinish({ text: 'ok', usage: { totalTokens: 1 }, toolResults: [] });
      }
      return { stream: null };
    });
  });

  test('POST /v1/ai/chat without a token returns 401', async () => {
    await request(app).post('/v1/ai/chat').send({ messages: [{ role: 'user', content: 'hi' }] }).expect(httpStatus.UNAUTHORIZED);
    expect(await AiTrace.countDocuments()).toBe(0);
  });

  test('navigation flag false returns NO_PERMISSION and does not query', async () => {
    await insertOrder({
      orderNumber: 'ORD-SECRET',
      status: 'Pending',
      articles: [{ articleNumber: 'A-1', status: 'In Progress', plannedQuantity: 10, floorQuantities: {} }],
    });
    const user = await userWithProductionOrders(false);
    const findSpy = jest.spyOn(ProductionOrder, 'findOne');

    const result = await executeTool('getProductionOrder', { orderNumber: 'ORD-SECRET' }, { user });

    expect(result).toEqual({
      error: 'NO_PERMISSION',
      navPath: 'Production Planning.Production Orders',
    });
    expect(findSpy).not.toHaveBeenCalled();
    findSpy.mockRestore();
  });

  test('stored Pending with an In Progress article derives In Progress', async () => {
    await insertOrder({
      orderNumber: 'ORD-STATUS',
      status: 'Pending',
      articles: [{ articleNumber: 'A-9', status: 'In Progress', plannedQuantity: 40, floorQuantities: {} }],
    });
    const user = await userWithProductionOrders(true);

    const result = await executeTool('getProductionOrder', { orderNumber: 'ORD-STATUS' }, { user });

    expect(result.derivedStatus).toBe('In Progress');
    expect(result.storedStatus).toBe('Pending');
    expect(result.articles[0].status).toBe('In Progress');
    expect(result.unit).toBe('pairs');
    expect(result.articleCount).toBe(1);
  });

  test('one On Hold article and one In Progress article derives On Hold', async () => {
    await insertOrder({
      orderNumber: 'ORD-HOLD',
      status: 'Pending',
      articles: [
        { articleNumber: 'A-HOLD', status: 'On Hold', plannedQuantity: 5, floorQuantities: {} },
        { articleNumber: 'A-RUN', status: 'In Progress', plannedQuantity: 5, floorQuantities: {} },
      ],
    });
    const user = await userWithProductionOrders(true);

    const result = await executeTool('getProductionOrder', { orderNumber: 'ORD-HOLD' }, { user });

    expect(result.derivedStatus).toBe('On Hold');
    expect(result.storedStatus).toBe('Pending');
  });

  test('checking pending is received minus transferred and keeps m2 remaining', async () => {
    await insertOrder({
      orderNumber: 'ORD-CHECK',
      status: 'Pending',
      articles: [
        {
          articleNumber: 'A-CHECK',
          status: 'In Progress',
          plannedQuantity: 90,
          floorQuantities: {
            checking: {
              received: 90,
              transferred: 86,
              remaining: 0,
              m1Remaining: 0,
              m2Remaining: 4,
              m3Quantity: 0,
              m4Quantity: 0,
            },
          },
        },
      ],
    });
    const user = await userWithProductionOrders(true);

    const result = await executeTool('getProductionOrder', { orderNumber: 'ORD-CHECK' }, { user });
    const { checking } = result.articles[0].floorsPending;

    expect(checking.pending).toBe(4);
    expect(checking.grades.m2Remaining).toBe(4);
    expect(checking.unit).toBe('pairs');
    expect(result.articles[0].floorsPending.knitting).toBeUndefined();
  });

  test('order totals sum raw pairs, then round once', async () => {
    await insertOrder({
      orderNumber: 'ORD-SUM',
      status: 'Pending',
      articles: [
        {
          articleNumber: 'A-SUM-1',
          status: 'In Progress',
          plannedQuantity: 100,
          floorQuantities: {
            checking: { received: 5, transferred: 0, remaining: 0 },
            dispatch: { received: 100, transferred: 60, remaining: 0 },
          },
        },
        {
          articleNumber: 'A-SUM-2',
          status: 'In Progress',
          plannedQuantity: 10,
          floorQuantities: {
            checking: { received: 3.5, transferred: 0, remaining: 0 },
            washing: { received: 880.99999, transferred: 0, remaining: 0 },
          },
        },
      ],
    });
    const user = await userWithProductionOrders(true);

    const result = await executeTool('getProductionOrder', { orderNumber: 'ORD-SUM' }, { user });

    expect(result.unit).toBe('pairs');
    expect(result.articleCount).toBe(2);
    expect(result.orderTotals.checking).toBe(8.5);
    expect(result.orderTotals.washing).toBe(881);
    expect(result.orderTotals.dispatch).toBeUndefined();
    expect(result.orderTotals.warehouse).toBeUndefined();
    expect(result.orderSummary).toEqual({
      inProduction: 889.5,
      inWarehouse: 0,
      readyToDispatch: 40,
      dispatched: 60,
    });
    expect(result.articles[1].floorsPending.washing.pending).toBe(881);
    expect(result.articles[1].floorsPending.washing.unit).toBe('pairs');
  });

  test('unknown orderNumber returns NOT_FOUND', async () => {
    const user = await userWithProductionOrders(true);
    const result = await executeTool('getProductionOrder', { orderNumber: 'ORD-MISSING' }, { user });
    expect(result).toEqual({ error: 'NOT_FOUND' });
  });

  test('one orderNumber suffix match returns that order and matchedFrom', async () => {
    await insertOrder({
      orderNumber: 'ORD-000777',
      status: 'Pending',
      articles: [{ articleNumber: 'A-777', status: 'In Progress', plannedQuantity: 8, floorQuantities: {} }],
    });
    const user = await userWithProductionOrders(true);

    const partial = await executeTool('getProductionOrder', { orderNumber: '777' }, { user });
    expect(partial.orderNumber).toBe('ORD-000777');
    expect(partial.matchedFrom).toBe('777');
    expect(partial.error).toBeUndefined();

    const prefixed = await executeTool('getProductionOrder', { orderNumber: 'ORD-777' }, { user });
    expect(prefixed.orderNumber).toBe('ORD-000777');
    expect(prefixed.matchedFrom).toBe('ORD-777');

    const exact = await executeTool('getProductionOrder', { orderNumber: 'ORD-000777' }, { user });
    expect(exact.orderNumber).toBe('ORD-000777');
    expect(exact.matchedFrom).toBeUndefined();
  });

  test('several suffix matches return AMBIGUOUS and at most 10 candidates', async () => {
    const orderNumbers = Array.from({ length: 11 }, (_, index) => `ORD-${String(index).padStart(3, '0')}424242`);
    await orderNumbers.reduce(async (previous, orderNumber) => {
      await previous;
      await insertOrder({
        orderNumber,
        status: 'Pending',
        articles: [
          { articleNumber: `A-${orderNumber}`, status: 'In Progress', plannedQuantity: 4, floorQuantities: {} },
        ],
      });
    }, Promise.resolve());
    const user = await userWithProductionOrders(true);

    const result = await executeTool('getProductionOrder', { orderNumber: '424242' }, { user });

    expect(result).toEqual({ error: 'AMBIGUOUS', candidates: orderNumbers.slice(0, 10) });
  });

  test('digits that match no orderNumber return NOT_FOUND', async () => {
    await insertOrder({
      orderNumber: 'ORD-000777',
      status: 'Pending',
      articles: [{ articleNumber: 'A-777', status: 'In Progress', plannedQuantity: 8, floorQuantities: {} }],
    });
    const user = await userWithProductionOrders(true);
    const result = await executeTool('getProductionOrder', { orderNumber: '999001' }, { user });
    expect(result).toEqual({ error: 'NOT_FOUND' });
  });

  test('one mocked chat request writes exactly one AiTrace with the tool call', async () => {
    await insertOrder({
      orderNumber: 'ORD-TRACE',
      status: 'Pending',
      priority: 'Urgent',
      articles: [{ articleNumber: 'A-TRACE', status: 'In Progress', plannedQuantity: 12, floorQuantities: {} }],
    });
    await userWithProductionOrders(true);

    const originalCreate = AiTrace.create.bind(AiTrace);
    let markWritten;
    const written = new Promise((resolve) => {
      markWritten = resolve;
    });
    jest.spyOn(AiTrace, 'create').mockImplementation((doc) => {
      const pending = Promise.resolve(originalCreate(doc));
      pending.finally(markWritten);
      return pending;
    });

    streamText.mockImplementation(async (options) => {
      const output = await options.tools.getProductionOrder.execute({ orderNumber: 'ORD-TRACE' });
      if (typeof options.onFinish === 'function') {
        await options.onFinish({
          text: 'ORD-TRACE is In Progress. 12 pieces planned.',
          usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
          toolResults: [{ toolName: 'getProductionOrder', input: { orderNumber: 'ORD-TRACE' }, output }],
        });
      }
      return { stream: null };
    });

    await request(app)
      .post('/v1/ai/chat')
      .set('Authorization', `Bearer ${userOneAccessToken}`)
      .send({
        messages: [
          {
            id: 'm1',
            role: 'user',
            parts: [{ type: 'text', text: 'ORD-TRACE ka status?' }],
          },
        ],
      })
      .expect(httpStatus.OK);

    await written;
    const traces = await AiTrace.find();
    expect(traces).toHaveLength(1);
    expect(traces[0].message).toBe('ORD-TRACE ka status?');
    expect(traces[0].promptVersion).toBe(PROMPT_VERSION);
    expect(traces[0].model).toBe(chatModelId());
    const effort = chatReasoningEffort(chatModelId());
    const call = streamText.mock.calls[0][0];
    if (effort) {
      expect(call.providerOptions).toEqual({
        openai: { reasoningEffort: effort, reasoningSummary: null },
      });
    } else {
      expect(call.providerOptions).toBeUndefined();
    }
    expect(traces[0].answer).toBe('ORD-TRACE is In Progress. 12 pieces planned.');
    expect(traces[0].toolCalls).toHaveLength(1);
    expect(traces[0].toolCalls[0].name).toBe('getProductionOrder');
    expect(traces[0].toolCalls[0].input).toEqual({ orderNumber: 'ORD-TRACE' });
    expect(traces[0].toolCalls[0].output.derivedStatus).toBe('In Progress');
    expect(traces[0].toolCalls[0].output.storedStatus).toBe('Pending');
    expect(traces[0].toolCalls[0].error).toBeNull();
    expect(typeof traces[0].toolCalls[0].ms).toBe('number');
    expect(streamText).toHaveBeenCalledTimes(1);
    expect(streamText.mock.calls[0][0].stopWhen).toEqual({ type: 'step-count', count: 8 });
  });

  test('a failed AiTrace insert still returns 200 with the answer', async () => {
    await userWithProductionOrders(true);
    const answer = 'ORD-HOLD is On Hold.';
    streamText.mockImplementation(async (options) => {
      if (typeof options.onFinish === 'function') {
        await options.onFinish({ text: answer, usage: { totalTokens: 2 }, toolResults: [] });
      }
      return { stream: answer };
    });
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(AiTrace, 'create').mockRejectedValue(new Error('trace insert failed'));

    const res = await request(app)
      .post('/v1/ai/chat')
      .set('Authorization', `Bearer ${userOneAccessToken}`)
      .send({ messages: [{ role: 'user', content: 'status of the hold order' }] })
      .expect(httpStatus.OK);

    expect(res.text).toContain(answer);
    expect(errorLog).toHaveBeenCalled();
    expect(await AiTrace.countDocuments()).toBe(0);
  });
});
