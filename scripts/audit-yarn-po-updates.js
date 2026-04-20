#!/usr/bin/env node
/**
 * Audit Yarn Purchase Order updates for a given PO _id.
 *
 * Outputs:
 * - PO metadata (poNumber/currentStatus/createDate/lastUpdateDate)
 * - Status logs timeline (with resolved user name/email if available)
 * - API update calls timeline from UserActivityLog (who/when/path/requestMeta)
 *
 * Usage:
 *   node scripts/audit-yarn-po-updates.js 69cf84a67cd22f3f9dae8ae7
 */
import mongoose from 'mongoose';
import dns from 'dns/promises';
import config from '../src/config/config.js';
import { User, UserActivityLog, YarnPurchaseOrder } from '../src/models/index.js';

/**
 * @param {string} uri
 * @returns {string}
 */
function redactMongoUri(uri) {
  // Redact credentials: mongodb(+srv)://user:pass@host -> mongodb(+srv)://***:***@host
  return uri.replace(/^(mongodb(?:\+srv)?:\/\/)([^@]+)@/i, '$1***:***@');
}

/**
 * Some Mongo URIs break if the password contains unescaped '@' (should be %40).
 * This normalizes by URL-encoding the password portion when needed.
 *
 * @param {string} uri
 * @returns {{ uri: string, normalized: boolean, atCount: number }}
 */
function normalizeMongoUri(uri) {
  const atCount = (uri.match(/@/g) || []).length;
  if (atCount <= 1) return { uri, normalized: false, atCount };

  const schemeMatch = uri.match(/^(mongodb(?:\+srv)?:\/\/)(.*)$/i);
  if (!schemeMatch) return { uri, normalized: false, atCount };

  const scheme = schemeMatch[1];
  const rest = schemeMatch[2];

  // Use the LAST '@' as the auth/host delimiter. Anything before it is credentials.
  const lastAt = rest.lastIndexOf('@');
  if (lastAt === -1) return { uri, normalized: false, atCount };

  const creds = rest.slice(0, lastAt);
  const hostAndQuery = rest.slice(lastAt + 1);

  const colonIdx = creds.indexOf(':');
  if (colonIdx === -1) return { uri, normalized: false, atCount };

  const username = creds.slice(0, colonIdx);
  const passwordRaw = creds.slice(colonIdx + 1);
  const passwordEncoded = encodeURIComponent(passwordRaw);

  return {
    uri: `${scheme}${username}:${passwordEncoded}@${hostAndQuery}`,
    normalized: true,
    atCount,
  };
}

/**
 * mongodb driver v3.x doesn't support some newer URI options (e.g. appName).
 * Remove known unsupported query params to avoid parse failures.
 *
 * @param {string} uri
 * @returns {{ uri: string, stripped: boolean, removedKeys: string[] }}
 */
function stripUnsupportedMongoParams(uri) {
  const qIdx = uri.indexOf('?');
  if (qIdx === -1) return { uri, stripped: false, removedKeys: [] };

  const base = uri.slice(0, qIdx);
  const query = uri.slice(qIdx + 1);
  const params = query.split('&').filter(Boolean);

  const removedKeys = [];
  const kept = [];

  for (const kv of params) {
    const [rawKey] = kv.split('=', 1);
    const key = (rawKey || '').trim();
    if (!key) continue;

    // Known to break with mongodb@3.7.x
    if (key === 'appName') {
      removedKeys.push(key);
      continue;
    }
    kept.push(kv);
  }

  if (removedKeys.length === 0) return { uri, stripped: false, removedKeys };
  return { uri: kept.length ? `${base}?${kept.join('&')}` : base, stripped: true, removedKeys };
}

/**
 * mongodb driver v3.x can be finicky with mongodb+srv://. This expands SRV into a
 * standard mongodb:// host list using DNS SRV/TXT records.
 *
 * @param {string} uri
 * @returns {Promise<{ uri: string, expanded: boolean }>}
 */
async function expandSrvUriIfNeeded(uri) {
  const m = uri.match(/^mongodb\+srv:\/\/([^:]+):([^@]+)@([^/]+)\/([^?]+)(\?.*)?$/i);
  if (!m) return { uri, expanded: false };

  const username = m[1];
  const password = m[2];
  const host = m[3];
  const dbName = m[4];
  const query = (m[5] || '').replace(/^\?/, '');

  const srvRecords = await dns.resolveSrv(`_mongodb._tcp.${host}`);
  const hosts = srvRecords.map((r) => `${r.name}:${r.port}`).join(',');

  const txtRecords = await dns.resolveTxt(host);
  const txtFlat = txtRecords.flat().filter(Boolean);
  const txtQuery = txtFlat.join('&');

  const mergedParams = [txtQuery, query].filter(Boolean).join('&');

  // mongodb driver v3.x expects `ssl=true` (not `tls=true`) for Atlas.
  const paramsWithSsl = mergedParams ? `${mergedParams}&ssl=true` : 'ssl=true';

  const userEnc = encodeURIComponent(username);
  const passEnc = encodeURIComponent(password);

  return {
    uri: `mongodb://${userEnc}:${passEnc}@${hosts}/${dbName}?${paramsWithSsl}`,
    expanded: true,
  };
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function asNonEmptyString(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length ? v : null;
}

/**
 * @param {string} poId
 * @returns {Promise<void>}
 */
async function run(poId) {
  const id = asNonEmptyString(poId);
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    throw new Error('Invalid PO id. Expected a Mongo ObjectId string.');
  }

  const mongoUrl = config?.mongoose?.url;
  if (typeof mongoUrl !== 'string' || mongoUrl.length === 0) {
    throw new Error('Missing config.mongoose.url (check MONGODB_URL in .env).');
  }
  const normalized = normalizeMongoUri(mongoUrl);
  const stripped = stripUnsupportedMongoParams(normalized.uri);
  const expanded = await expandSrvUriIfNeeded(stripped.uri);
  const hasWhitespace = /\s/.test(mongoUrl);
  const hasNewline = /[\r\n]/.test(mongoUrl);
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        mongo: {
          redactedUrl: redactMongoUri(expanded.uri),
          length: mongoUrl.length,
          hasWhitespace,
          hasNewline,
          startsWithMongo: /^mongodb(\+srv)?:\/\//i.test(mongoUrl),
          atCount: normalized.atCount,
          normalizedPassword: normalized.normalized,
          strippedUnsupportedParams: stripped.stripped,
          removedQueryKeys: stripped.removedKeys,
          expandedSrv: expanded.expanded,
        },
      },
      null,
      2
    )
  );

  await mongoose.connect(expanded.uri, config.mongoose.options);

  const po = await YarnPurchaseOrder.findById(id)
    .select('poNumber currentStatus createDate lastUpdateDate statusLogs')
    .lean();

  if (!po) {
    throw new Error(`YarnPurchaseOrder not found for id=${id}`);
  }

  const poNumber = po.poNumber;

  const statusUserIds = (po.statusLogs || [])
    .map((l) => l?.updatedBy?.user)
    .filter(Boolean)
    .map((u) => String(u));

  const statusUsers = statusUserIds.length
    ? await User.find({ _id: { $in: statusUserIds } }).select('name email').lean()
    : [];
  const statusUserMap = new Map(statusUsers.map((u) => [String(u._id), u]));

  const statusTimeline = (po.statusLogs || [])
    .map((l) => {
      const userId = l?.updatedBy?.user != null ? String(l.updatedBy.user) : null;
      const u = userId ? statusUserMap.get(userId) : null;
      return {
        when: l?.updatedAt ?? null,
        statusCode: l?.statusCode ?? null,
        notes: l?.notes ?? null,
        by: {
          userId,
          usernameStored: l?.updatedBy?.username ?? null,
          name: u?.name ?? null,
          email: u?.email ?? null,
        },
      };
    })
    .sort((a, b) => {
      const ta = a.when ? new Date(a.when).getTime() : 0;
      const tb = b.when ? new Date(b.when).getTime() : 0;
      return ta - tb;
    });

  const pathRegex = new RegExp(`^/v1/yarn-management/yarn-purchase-orders/${id}($|/)`);
  const apiLogs = await UserActivityLog.find({
    method: { $in: ['PATCH', 'PUT', 'DELETE'] },
    path: { $regex: pathRegex },
  })
    .sort({ createdAt: 1 })
    .select('createdAt userId method path statusCode action requestMeta errorMessage')
    .lean();

  const apiUserIds = [...new Set(apiLogs.map((l) => String(l.userId)).filter(Boolean))];
  const apiUsers = apiUserIds.length
    ? await User.find({ _id: { $in: apiUserIds } }).select('name email').lean()
    : [];
  const apiUserMap = new Map(apiUsers.map((u) => [String(u._id), u]));

  const apiTimeline = apiLogs.map((l) => {
    const u = apiUserMap.get(String(l.userId));
    return {
      when: l.createdAt,
      method: l.method,
      path: l.path,
      statusCode: l.statusCode,
      action: l.action,
      by: {
        userId: String(l.userId),
        name: u?.name ?? null,
        email: u?.email ?? null,
      },
      updatedDataSent: l.requestMeta ?? null,
      errorMessage: l.errorMessage ?? null,
    };
  });

  const output = {
    purchaseOrder: {
      id,
      poNumber,
      currentStatus: po.currentStatus ?? null,
      createDate: po.createDate ?? null,
      lastUpdateDate: po.lastUpdateDate ?? null,
    },
    statusLogs: statusTimeline,
    apiUpdates: apiTimeline,
    notes: {
      activityLogRetentionDays: 30,
      caveat:
        'UserActivityLog stores request payload (requestMeta), not before/after diffs. statusLogs are stored on the PO for status changes.',
    },
  };

  // Print JSON for easy copy/paste / saving.
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

const poId = process.argv[2];
run(poId)
  .catch((err) => {
    process.stderr.write(`${err?.stack || err?.message || String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // ignore disconnect errors
    }
  });

