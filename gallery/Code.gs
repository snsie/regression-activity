// Gallery & votes backend: a Google Apps Script web app that stores the list of apps and
// the votes in the Google Sheet it is bound to. Setup: gallery/README.md.
//
// Every request is a POST with a JSON body {action, key, ...}. `key` is a random secret
// made by the voter's browser (one key = one person). The Sheet never stores the key or
// a name, only salted hashes of it:
//   Sites: submitter = hash("submit", key), so "you can't vote for your own app" can be
//          checked without saying who added it;
//   Votes: voter = hash("vote", site id, key), a different value for every app, so one
//          person's votes can't be linked to each other or to the apps they added.
// The browser sends text/plain so no CORS preflight is needed (Apps Script can't answer one).

const SITES = "Sites";
const VOTES = "Votes";
const SITE_HEADERS = ["id", "url", "title", "added", "submitter"];
const VOTE_HEADERS = ["site", "voter"];
const MAX_SITES = 300;
const MAX_URL = 500;
const MAX_TITLE = 80;

function doGet() {
  return json_({ ok: true, service: "explain-the-model gallery" });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return json_({ ok: false, error: "The request wasn't valid JSON." });
  }
  try {
    salt_(); // before any lock: the write lock below isn't reentrant
    const key = String(req.key || "");
    if (!/^[0-9a-f]{32,128}$/.test(key)) throw new UserError("Missing or invalid voter key. Reload the page and try again.");
    if (req.action === "list") return json_({ ok: true, sites: list_(key) });
    if (req.action === "add") return json_(withLock_(() => add_(key, req.url, req.title)));
    if (req.action === "vote") return json_(withLock_(() => vote_(key, String(req.id || ""))));
    throw new UserError("Unknown action.");
  } catch (err) {
    if (err instanceof UserError) return json_({ ok: false, error: err.message });
    console.error(err);
    return json_({ ok: false, error: "Something went wrong on the server. Try again in a moment." });
  }
}

// ---- actions --------------------------------------------------------------------
function list_(key) {
  const mine = hash_("submit", key);
  const votes = rows_(VOTES, VOTE_HEADERS);
  const counts = {};
  const cast = new Set();
  for (const [site, voter] of votes) {
    counts[site] = (counts[site] || 0) + 1;
    cast.add(site + "|" + voter);
  }
  return rows_(SITES, SITE_HEADERS).map(([rawId, url, title, added, submitter]) => {
    const id = String(rawId);
    return {
      id: id,
      url: String(url),
      title: String(title),
      added: added instanceof Date ? added.toISOString() : String(added),
      votes: counts[id] || 0,
      mine: submitter === mine,
      voted: cast.has(id + "|" + hash_("vote", id, key)),
    };
  });
}

function add_(key, rawUrl, rawTitle) {
  const url = String(rawUrl || "").trim();
  if (url.length > MAX_URL || !/^https?:\/\/[^\s/?#]+\.[^\s/?#]+(?:[/?#]\S*)?$/i.test(url)) {
    throw new UserError("Enter a full web address that starts with https://");
  }
  const title = String(rawTitle || "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
  const sites = rows_(SITES, SITE_HEADERS);
  if (sites.length >= MAX_SITES) throw new UserError("The gallery is full. Ask your instructor.");
  const norm = normalizeUrl_(url);
  if (sites.some((s) => normalizeUrl_(String(s[1])) === norm)) throw new UserError("That app is already in the list.");
  const id = Utilities.getUuid().replace(/-/g, "").slice(0, 12);
  sheet_(SITES, SITE_HEADERS).appendRow([text_(id), text_(url), text_(title), new Date(), text_(hash_("submit", key))]);
  return { ok: true, id: id };
}

function vote_(key, id) {
  const site = rows_(SITES, SITE_HEADERS).find((s) => String(s[0]) === id);
  if (!site) throw new UserError("That app isn't in the list any more.");
  if (site[4] === hash_("submit", key)) throw new UserError("You can't vote for an app you added.");
  const voter = hash_("vote", id, key);
  if (rows_(VOTES, VOTE_HEADERS).some((v) => String(v[0]) === id && v[1] === voter)) {
    throw new UserError("You've already voted for this app.");
  }
  sheet_(VOTES, VOTE_HEADERS).appendRow([text_(id), text_(voter)]);
  return { ok: true };
}

// ---- helpers --------------------------------------------------------------------
class UserError extends Error {}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Writes are serialized so two quick clicks can't both pass the "already voted" check.
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    throw new UserError("The gallery is busy. Try again in a moment.");
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function sheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
  }
  return sh;
}

// Data rows without the header. Rows the instructor deleted by hand simply disappear.
function rows_(name, headers) {
  return sheet_(name, headers).getDataRange().getValues().slice(1).filter((r) => r[0] !== "");
}

// A leading apostrophe stores a value as plain text, so "=…" isn't run as a formula and
// "10/22" or an id like "1234e5678901" isn't turned into a date or number. Sheets doesn't
// keep the apostrophe in the value.
function text_(s) {
  return "'" + s;
}

// http/https, letter case of the host, a trailing slash, index.html and #fragments
// don't make a different app.
function normalizeUrl_(url) {
  const m = url.trim().match(/^https?:\/\/([^/?#]+)([^#]*)/i);
  if (!m) return url.trim();
  const path = m[2].replace(/\/index\.html?$/i, "/").replace(/\/+$/, "");
  return m[1].toLowerCase() + path;
}

let salt;
function salt_() {
  if (salt) return salt;
  const props = PropertiesService.getScriptProperties();
  salt = props.getProperty("SALT");
  if (salt) return salt;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    salt = props.getProperty("SALT");
    if (!salt) {
      salt = Utilities.getUuid() + Utilities.getUuid();
      props.setProperty("SALT", salt);
    }
  } finally {
    lock.releaseLock();
  }
  return salt;
}

function hash_(...parts) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, [salt_(), ...parts].join("|"), Utilities.Charset.UTF_8);
  return bytes.map((b) => ((b + 256) % 256).toString(16).padStart(2, "0")).join("");
}

// Run once from the editor (Run → setup) to create both tabs and the salt, and to grant access.
function setup() {
  sheet_(SITES, SITE_HEADERS).setFrozenRows(1);
  sheet_(VOTES, VOTE_HEADERS).setFrozenRows(1);
  salt_();
}
