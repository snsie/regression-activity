// Gallery & votes: lists the class's apps and records votes through the Apps Script
// backend in gallery/Code.gs. There's no sign-in: this browser keeps a random key that
// stands for one voter, and the server stores only hashes of it, so votes stay anonymous.
const root = document.getElementById("gallery");
const endpoint = root?.dataset.endpoint;
const KEY_STORE = "explain-the-model:gallery-key";
const SORT_STORE = "explain-the-model:gallery-sort";
const REFRESH_MS = 60000;

let key;
let sites = [];
let loading = false;

function voterKey() {
  try {
    const saved = localStorage.getItem(KEY_STORE);
    if (/^[0-9a-f]{64}$/.test(saved || "")) return { key: saved, saved: true };
  } catch {}
  const key = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
  try {
    localStorage.setItem(KEY_STORE, key);
    return { key, saved: localStorage.getItem(KEY_STORE) === key };
  } catch {
    return { key, saved: false };
  }
}

// A plain-text body keeps this a "simple" request: Apps Script can't answer a CORS preflight.
async function call(action, data = {}) {
  let res;
  try {
    res = await fetch(endpoint, { method: "POST", body: JSON.stringify({ action, key, ...data }) });
  } catch {
    throw new Error("Couldn't reach the gallery. Check your connection and try again.");
  }
  if (!res.ok) throw new Error(`The gallery server answered ${res.status}. Try again in a moment.`);
  const out = await res.json().catch(() => ({ ok: false, error: "The gallery server sent an unreadable answer." }));
  if (!out.ok) throw new Error(out.error || "Something went wrong.");
  return out;
}

const $ = (sel) => root.querySelector(sel);
const list = $("#gallery-list");
const status = $(".gallery-status");
const summary = $(".gallery-summary");
const sortSelect = $("#gallery-sort");

function el(tag, attrs = {}, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : null);
const shortUrl = (u) => u.replace(/^https?:\/\//i, "").replace(/\/$/, "");
const nameOf = (s) => s.title || shortUrl(s.url).split("/")[0];
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function sorted() {
  const by = sortSelect.value;
  const name = (a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: "base" });
  return [...sites].sort((a, b) =>
    by === "votes" ? b.votes - a.votes || name(a, b)
      : by === "new" ? String(b.added).localeCompare(String(a.added))
        : name(a, b));
}

function voteCell(s) {
  if (s.mine) return el("span", { class: "vote-done", tabindex: "-1" }, "Your app");
  if (s.voted) return el("span", { class: "vote-done voted", tabindex: "-1" }, "✓ You voted");
  const b = el("button", { type: "button", class: "vote-button", "aria-label": `Vote for ${nameOf(s)}` }, "Vote");
  b.addEventListener("click", () => vote(s, b));
  return b;
}

function item(s) {
  const li = el("li", { class: "gallery-item", "data-id": s.id });
  const main = el("div", { class: "gallery-main" });
  const href = safeUrl(s.url);
  const title = href ? el("a", { class: "gallery-title", href, target: "_blank", rel: "noopener noreferrer" }, nameOf(s))
    : el("span", { class: "gallery-title" }, nameOf(s));
  main.append(title);
  if (s.mine) main.append(" ", el("span", { class: "tag" }, "Added by you"));
  main.append(el("span", { class: "gallery-url" }, shortUrl(s.url)));
  const side = el("div", { class: "gallery-vote" });
  const count = el("span", { class: "vote-count" });
  count.append(el("strong", {}, String(s.votes)), ` ${s.votes === 1 ? "vote" : "votes"}`);
  side.append(count, voteCell(s));
  li.append(main, side);
  return li;
}

// Re-rendering keeps keyboard focus on the same app's link or vote control.
function render() {
  const active = document.activeElement;
  const focusedId = list.contains(active) ? active.closest("[data-id]")?.dataset.id : null;
  const focusedVote = focusedId && !active.matches("a");
  list.replaceChildren(...sorted().map(item));
  const votes = sites.reduce((n, s) => n + s.votes, 0);
  summary.textContent = sites.length ? `· ${plural(sites.length, "app")}, ${plural(votes, "vote")}` : "";
  if (focusedId) {
    const li = list.querySelector(`[data-id="${CSS.escape(focusedId)}"]`);
    li?.querySelector(focusedVote ? ".vote-button, .vote-done" : "a")?.focus();
  }
}

async function load(quiet = false) {
  if (loading) return;
  loading = true;
  if (!quiet) status.textContent = "Loading the gallery…";
  try {
    sites = (await call("list")).sites;
    render();
    status.textContent = sites.length ? "" : "No apps yet. Add the first one above.";
  } catch (err) {
    if (!quiet || !sites.length) status.textContent = `Couldn't load the gallery. ${err.message}`;
  } finally {
    loading = false;
  }
}

// The list may have been refreshed while the vote was on its way, so update the current copy.
async function vote(s, button) {
  button.disabled = true;
  button.textContent = "Voting…";
  let counted = false;
  let already = false;
  try {
    await call("vote", { id: s.id });
    counted = true;
    status.textContent = `Vote recorded for ${nameOf(s)}.`;
  } catch (err) {
    already = /already voted/.test(err.message);
    status.textContent = `Your vote for ${nameOf(s)} wasn't recorded. ${err.message}`;
  }
  const current = sites.find((x) => x.id === s.id);
  if (current && counted && !current.voted) current.votes += 1;
  if (current && (counted || already)) current.voted = true;
  render();
  list.querySelector(`[data-id="${CSS.escape(s.id)}"]`)?.querySelector(".vote-button, .vote-done")?.focus();
}

function setupForm() {
  const form = $("#add-form");
  const url = $("#add-url");
  const title = $("#add-title");
  const msg = $("#add-msg");
  const submit = form.querySelector('button[type="submit"]');
  form.hidden = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = url.value.trim();
    let ok = false;
    try {
      const u = new URL(value);
      ok = /^https?:$/.test(u.protocol) && u.hostname.includes(".");
    } catch {}
    if (!ok) {
      msg.textContent = "Enter your app's full public link, starting with https://";
      url.setAttribute("aria-invalid", "true");
      url.focus();
      return;
    }
    url.removeAttribute("aria-invalid");
    submit.disabled = true;
    msg.textContent = "Adding…";
    try {
      await call("add", { url: value, title: title.value.trim() });
      form.reset();
      msg.textContent = "Added. It's marked “Added by you”, and you can't vote for it.";
      await load(true);
    } catch (err) {
      msg.textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });
}

if (root) {
  if (!endpoint) {
    $(".gallery-closed").hidden = false;
  } else {
    const k = voterKey();
    key = k.key;
    $(".gallery-key-note").hidden = k.saved;
    $(".gallery-apps").hidden = false;
    setupForm();
    try {
      const saved = localStorage.getItem(SORT_STORE);
      if ([...sortSelect.options].some((o) => o.value === saved)) sortSelect.value = saved;
    } catch {}
    sortSelect.addEventListener("change", () => {
      try { localStorage.setItem(SORT_STORE, sortSelect.value); } catch {}
      render();
    });
    $("#gallery-refresh").addEventListener("click", () => load());
    load();
    setInterval(() => document.visibilityState === "visible" && load(true), REFRESH_MS);
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && load(true));
  }
}
