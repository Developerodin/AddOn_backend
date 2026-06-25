import { TRANSITIONS, REOPEN_WINDOW_DAYS, PAUSED_STATUSES } from '../../../src/models/helpSupport/ticket.model.js';
import { enrichTicketWithLiveTimes, recordTransition } from '../../../src/services/helpSupport/ticket.service.js';

describe('Help & Support transitions', () => {
  describe('TRANSITIONS map', () => {
    it('allows raised → in_progress', () => {
      expect(TRANSITIONS.raised).toContain('in_progress');
    });

    it('blocks illegal closed → in_progress', () => {
      expect(TRANSITIONS.closed).not.toContain('in_progress');
    });

    it('allows closed → reopened only', () => {
      expect(TRANSITIONS.closed).toEqual(['reopened']);
    });

    it('has no exits from cancelled', () => {
      expect(TRANSITIONS.cancelled).toEqual([]);
    });
  });

  describe('enrichTicketWithLiveTimes', () => {
    it('adds running duration for open status', () => {
      const enteredAt = new Date(Date.now() - 60_000);
      const enriched = enrichTicketWithLiveTimes({
        status: 'pending',
        createdAt: new Date(Date.now() - 120_000),
        timeInStatus: { pending: 30_000 },
        statusHistory: [{ toStatus: 'pending', enteredAt, exitedAt: null }],
      });

      expect(enriched.timeInStatus.pending).toBeGreaterThanOrEqual(60_000);
      expect(enriched.totalLifetimeMs).toBeGreaterThan(0);
    });

    it('excludes paused statuses from totalActiveTimeMs', () => {
      const enriched = enrichTicketWithLiveTimes({
        status: 'on_hold',
        createdAt: new Date(),
        timeInStatus: {
          in_progress: 10_000,
          on_hold: 5_000,
          awaiting_user: 3_000,
        },
        statusHistory: [{ toStatus: 'on_hold', enteredAt: new Date(), exitedAt: null }],
      });

      expect(enriched.totalActiveTimeMs).toBe(10_000);
      PAUSED_STATUSES.forEach((s) => {
        expect(enriched.timeInStatus[s]).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('recordTransition', () => {
    const makeTicket = (status = 'raised') => {
      const now = new Date();
      return {
        status,
        statusHistory: [{ fromStatus: null, toStatus: status, enteredAt: now, exitedAt: null, durationMs: null }],
        timeInStatus: {},
        resolvedAt: null,
        closedAt: null,
        markModified: () => {},
        save: async () => true,
      };
    };

    const user = { _id: 'user1' };

    it('rejects illegal transition', async () => {
      const ticket = makeTicket('closed');
      await expect(recordTransition(ticket, 'in_progress', user)).rejects.toThrow(/Invalid transition/);
    });

    it('closes open history entry and updates timeInStatus', async () => {
      const ticket = makeTicket('raised');
      await recordTransition(ticket, 'pending', user, 'ack');

      expect(ticket.status).toBe('pending');
      expect(ticket.statusHistory).toHaveLength(2);
      expect(ticket.statusHistory[0].exitedAt).toBeTruthy();
      expect(ticket.statusHistory[0].durationMs).toBeGreaterThanOrEqual(0);
      expect(ticket.timeInStatus.raised).toBeGreaterThanOrEqual(0);
    });

    it('sets resolvedAt when moving to resolved', async () => {
      const ticket = makeTicket('in_progress');
      await recordTransition(ticket, 'resolved', user);
      expect(ticket.resolvedAt).toBeTruthy();
    });

    it('enforces reopen window from closed', async () => {
      const ticket = makeTicket('closed');
      ticket.closedAt = new Date(Date.now() - (REOPEN_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);
      await expect(recordTransition(ticket, 'reopened', user)).rejects.toThrow(/reopened within/);
    });
  });
});
