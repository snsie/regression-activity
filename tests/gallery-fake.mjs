// Runs gallery/Code.gs in Node with an in-memory stand-in for the Google services it
// uses (Sheet, lock, properties, hashing), so its rules can be tested without Google.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const CODE = readFileSync(new URL("../gallery/Code.gs", import.meta.url), "utf8");

class FakeSheet {
  constructor() { this.rows = []; }
  // Like Sheets: a leading apostrophe forces text and isn't part of the stored value.
  appendRow(row) { this.rows.push(row.map((v) => (typeof v === "string" && v.startsWith("'") ? v.slice(1) : v))); }
  getDataRange() { return { getValues: () => (this.rows.length ? this.rows.map((r) => [...r]) : [[""]]) }; }
  setFrozenRows() {}
}

export function makeGallery() {
  const sheets = {};
  const props = {};
  const context = vm.createContext({
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => (sheets[n] = new FakeSheet()),
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => (props[k] = v) }),
    },
    Utilities: {
      getUuid: () => randomUUID(),
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      // Apps Script returns signed bytes (-128..127).
      computeDigest: (alg, s) => [...createHash(alg).update(s, "utf8").digest()].map((b) => (b > 127 ? b - 256 : b)),
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
    },
  });
  vm.runInContext(CODE, context, { filename: "Code.gs" });
  const post = (body) => JSON.parse(context.doPost({ postData: { contents: typeof body === "string" ? body : JSON.stringify(body) } }).text);
  return { post, get: () => JSON.parse(context.doGet({ parameter: {} }).text), sheets, run: (fn) => context[fn]() };
}
