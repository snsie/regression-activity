// Checks the gallery rules in gallery/Code.gs. Run: node --test tests/
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { makeGallery } from "./gallery-fake.mjs";

const newKey = () => randomBytes(32).toString("hex");

test("anyone can add an app; it is listed for everyone", () => {
  const g = makeGallery();
  const alice = newKey();
  const bob = newKey();
  assert.deepEqual(g.post({ action: "list", key: alice }), { ok: true, sites: [] });
  const r = g.post({ action: "add", key: alice, url: "https://alice.github.io/explain/", title: "  Alice's   app " });
  assert.equal(r.ok, true);
  const [site] = g.post({ action: "list", key: bob }).sites;
  assert.equal(site.id, r.id);
  assert.equal(site.url, "https://alice.github.io/explain/");
  assert.equal(site.title, "Alice's app");
  assert.equal(site.votes, 0);
  assert.equal(site.mine, false);
  assert.equal(site.voted, false);
  assert.match(site.added, /^\d{4}-\d\d-\d\dT/);
  assert.equal(g.post({ action: "list", key: alice }).sites[0].mine, true);
  assert.equal(g.post({ action: "add", key: bob, url: "https://bob.streamlit.app" }).ok, true);
  assert.equal(g.post({ action: "list", key: bob }).sites.length, 2);
});

test("each person votes once per app", () => {
  const g = makeGallery();
  const [alice, bob, carol] = [newKey(), newKey(), newKey()];
  const { id } = g.post({ action: "add", key: alice, url: "https://alice.github.io/explain/" });
  assert.deepEqual(g.post({ action: "vote", key: bob, id }), { ok: true });
  const again = g.post({ action: "vote", key: bob, id });
  assert.equal(again.ok, false);
  assert.match(again.error, /already voted/);
  assert.equal(g.post({ action: "vote", key: carol, id }).ok, true);
  const bobView = g.post({ action: "list", key: bob }).sites[0];
  assert.equal(bobView.votes, 2);
  assert.equal(bobView.voted, true);
  assert.equal(g.post({ action: "list", key: alice }).sites[0].voted, false);
});

test("nobody can vote for an app they added", () => {
  const g = makeGallery();
  const alice = newKey();
  const { id } = g.post({ action: "add", key: alice, url: "https://alice.github.io/explain/" });
  const r = g.post({ action: "vote", key: alice, id });
  assert.equal(r.ok, false);
  assert.match(r.error, /can't vote for an app you added/);
  assert.equal(g.post({ action: "list", key: alice }).sites[0].votes, 0);
});

test("votes are anonymous: the Sheet holds no keys, and one voter's rows can't be linked", () => {
  const g = makeGallery();
  const [alice, bob] = [newKey(), newKey()];
  const a = g.post({ action: "add", key: alice, url: "https://alice.github.io/a/" }).id;
  const b = g.post({ action: "add", key: alice, url: "https://alice.github.io/b/" }).id;
  g.post({ action: "add", key: bob, url: "https://bob.github.io/b/" });
  g.post({ action: "vote", key: bob, id: a });
  g.post({ action: "vote", key: bob, id: b });
  const dump = JSON.stringify(g.sheets);
  assert.ok(!dump.includes(alice) && !dump.includes(bob), "raw keys are never stored");
  const voters = g.sheets.Votes.rows.slice(1).map((r) => r[1]);
  assert.equal(new Set(voters).size, 2, "the same person gets a different voter hash per app");
  const submitters = g.sheets.Sites.rows.slice(1).map((r) => r[4]);
  assert.ok(voters.every((v) => !submitters.includes(v)), "voter hashes don't match submitter hashes");
  for (const site of g.post({ action: "list", key: alice }).sites) {
    assert.deepEqual(Object.keys(site).sort(), ["added", "id", "mine", "title", "url", "voted", "votes"]);
  }
});

test("bad and duplicate URLs are rejected", () => {
  const g = makeGallery();
  const k = newKey();
  for (const url of ["", "alice.github.io", "javascript:alert(1)", "ftp://x.org", "https://localhost", "https://a b.com", `https://x.org/${"a".repeat(600)}`]) {
    const r = g.post({ action: "add", key: k, url });
    assert.equal(r.ok, false, url);
    assert.match(r.error, /https:\/\//);
  }
  assert.equal(g.post({ action: "add", key: k, url: "https://alice.github.io/explain/" }).ok, true);
  for (const dup of ["http://Alice.GitHub.io/explain", "https://alice.github.io/explain/index.html", "https://alice.github.io/explain/#linear"]) {
    const r = g.post({ action: "add", key: newKey(), url: dup });
    assert.equal(r.ok, false, dup);
    assert.match(r.error, /already in the list/);
  }
  assert.equal(g.post({ action: "add", key: k, url: "https://alice.github.io/other/" }).ok, true);
});

test("user text is stored as text, never as a formula or date", () => {
  const g = makeGallery();
  const k = newKey();
  g.post({ action: "add", key: k, url: "https://x.github.io/", title: "=IMPORTXML(1)" });
  const row = g.sheets.Sites.rows[1];
  assert.equal(row[2], "=IMPORTXML(1)"); // fake strips the apostrophe exactly like Sheets
  assert.equal(g.post({ action: "list", key: k }).sites[0].title, "=IMPORTXML(1)");
  const long = g.post({ action: "add", key: k, url: "https://y.github.io/", title: "t".repeat(200) });
  assert.equal(g.post({ action: "list", key: k }).sites.find((s) => s.id === long.id).title.length, 80);
});

test("requests need a valid key and a known action and app", () => {
  const g = makeGallery();
  for (const key of [undefined, "", "abc", "z".repeat(64)]) {
    const r = g.post({ action: "list", key });
    assert.equal(r.ok, false);
    assert.match(r.error, /voter key/);
  }
  assert.match(g.post("not json").error, /valid JSON/);
  assert.match(g.post({ action: "delete", key: newKey() }).error, /Unknown action/);
  assert.match(g.post({ action: "vote", key: newKey(), id: "nope" }).error, /isn't in the list/);
  assert.equal(g.get().ok, true);
});

test("rows the instructor deletes in the Sheet disappear from the list", () => {
  const g = makeGallery();
  const k = newKey();
  g.run("setup");
  const { id } = g.post({ action: "add", key: k, url: "https://spam.example.com/" });
  g.post({ action: "vote", key: newKey(), id });
  g.sheets.Sites.rows[1] = ["", "", "", "", ""]; // a cleared row reads back as blanks
  assert.deepEqual(g.post({ action: "list", key: k }).sites, []);
});
