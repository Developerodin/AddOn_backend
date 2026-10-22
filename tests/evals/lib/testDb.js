import { redactMongoUri } from "../../../src/config/mongoUri.js";

/**
 * Points a Mongo URL at a local database whose name ends in `-test`.
 * Refuses anything else so an eval run cannot write the dev database.
 * @param {string} url
 * @returns {string}
 */
export function toLocalTestUrl(url) {
  const raw = String(url || "").trim();
  const match = raw.match(/^(mongodb(?:\+srv)?:\/\/[^/]+\/)([^/?]+)(\?.*)?$/i);
  if (!match) {
    throw new Error("Unrecognised Mongo URL. Refusing to seed eval data.");
  }
  const host = match[1];
  if (!/mongodb:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(host)) {
    throw new Error(
      `Refusing to seed eval data on non-local host ${redactMongoUri(raw)}`
    );
  }
  const name = match[2].endsWith("-test") ? match[2] : `${match[2]}-test`;
  if (!name.endsWith("-test")) {
    throw new Error(`Refusing to seed eval data on database ${name}`);
  }
  return `${host}${name}${match[3] || ""}`;
}

/**
 * Database name from a Mongo URL, for the run log.
 * @param {string} url
 * @returns {string}
 */
export function databaseName(url) {
  const match = String(url || "").match(/\/([^/?]+)(\?|$)/);
  return match ? match[1] : "";
}
