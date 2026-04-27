/**
 * Node 25+ made url.parse() throw on comma-separated hosts (mongodb multi-host URIs).
 * The mongodb driver 3.x uses url.parse() as a pre-check before its own regex parser,
 * so we patch it to return a best-effort result instead of throwing.
 * Import this module once before `mongoose` / `mongodb` load.
 */
import url from 'url';

const originalParse = url.parse;
url.parse = function patchedParse(urlStr, ...args) {
  try {
    return originalParse.call(this, urlStr, ...args);
  } catch {
    const firstHost = String(urlStr).replace(/(@[^,/]+),([^/])/, '$1/$2');
    return originalParse.call(this, firstHost, ...args);
  }
};

export {};
