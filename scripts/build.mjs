// Builds the static site into dist/. No dependencies: node scripts/build.mjs
//
// Pages are HTML fragments in site/pages/ wrapped in site/layout.html. Tokens like
// {{help residual}} or {{dl data/glucose.csv}} are expanded here, and the build fails
// on any unknown glossary term or missing download, so broken links can't ship.
// All links are relative, so the site works under the GitHub Pages project subpath.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, relative } from "node:path";
import { makeZip } from "./zip.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const SITE = join(ROOT, "site");
const STARTER = join(ROOT, "starter");
const OUT = join(ROOT, "dist");
const REPO = "https://github.com/snsie/regression-activity";
const ZIP_NAME = "explain-the-model-starter.zip";
const VERSION = (process.env.GITHUB_SHA || (() => {
  try { return execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(); } catch { return "local"; }
})()).slice(0, 7);

const NAV = [
  { file: "index", label: "Overview" },
  { group: "Competitions" },
  { file: "linear", label: "Push & Pull" },
  { file: "forest", label: "Wisdom of the Forest" },
  { file: "boosting", label: "One Correction at a Time" },
  { group: "Resources" },
  { file: "data", label: "Data & files" },
  { file: "hosting", label: "Publish & back up" },
  { file: "submit", label: "Submit & evaluation" },
  { file: "glossary", label: "Glossary" },
];
const PAGES = ["index", "linear", "forest", "boosting", "data", "hosting", "submit", "glossary", "404"];

const terms = JSON.parse(readFileSync(join(SITE, "terms.json"), "utf8"));
const datasets = JSON.parse(readFileSync(join(STARTER, "data", "datasets.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(STARTER, "data", "manifest.json"), "utf8"));
const bundles = Object.fromEntries(
  Object.keys(datasets).map((k) => [k, JSON.parse(readFileSync(join(STARTER, "outputs", `${k}.json`), "utf8"))]),
);

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// toFixed rounds the exact binary value, like Python, check.md and both starter apps
// (toLocaleString would round 1982.55 up to 1,982.6 while they show 1,982.5).
const fmt = (v, d = 1) => {
  const [int, dec] = Number(v).toFixed(d).split(".");
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (dec ? `.${dec}` : "");
};

function size(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function starterFiles(dir = STARTER) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? starterFiles(join(dir, e.name)) : [join(dir, e.name)]))
    .filter((p) => !p.includes("__pycache__"))
    .sort();
}

// ---- tokens -------------------------------------------------------------------
function help(id, label) {
  const t = terms[id];
  if (!t) throw new Error(`unknown glossary term: ${id}`);
  const name = label || t.term;
  return `<a class="help" href="glossary.html#${id}" data-help="${id}" aria-label="What is ${esc(name)}?" title="What is ${esc(name)}?"><span aria-hidden="true">?</span></a>`;
}

function download(path, text) {
  const file = join(STARTER, path);
  if (!existsSync(file)) throw new Error(`missing download: starter/${path}`);
  const name = text || path.split("/").pop();
  return `<a class="file" href="starter/${path}" download>${esc(name)}</a> <span class="size">${size(statSync(file).size)}</span>`;
}

function repoLink(path, text) {
  const full = join(ROOT, path);
  if (!existsSync(full)) throw new Error(`missing repository path: ${path}`);
  const kind = statSync(full).isDirectory() ? "tree" : "blob";
  return `<a href="${REPO}/${kind}/main/${path}">${esc(text || path)}</a>`;
}

function datasetCard(key) {
  const d = datasets[key];
  const m = manifest.datasets[key];
  const rows = d.features
    .map((f) => `<tr><td><code>${esc(f.name)}</code></td><td>${esc(f.label)}</td><td>${esc(f.units)}</td></tr>`)
    .join("");
  return `<div class="table-wrap"><table class="dictionary">
    <caption>Columns in <code>${key}.csv</code></caption>
    <thead><tr><th scope="col">Column</th><th scope="col">Meaning</th><th scope="col">Units</th></tr></thead>
    <tbody>
      <tr><td><code>row_id</code></td><td>Row number</td><td></td></tr>
      <tr><td><code>split</code></td><td><code>train</code> (${m.n_train.toLocaleString()} people) or <code>validation</code> (${m.n_validation.toLocaleString()} people) ${help("validation-data")}</td><td></td></tr>
      ${rows}
      <tr class="target"><td><code>${esc(d.target)}</code></td><td><strong>Target:</strong> ${esc(d.target_label)} ${help("target")}</td><td>${esc(d.units)}</td></tr>
    </tbody></table></div>
    <p class="data-facts"><span class="tag">From the supplied data</span> ${m.n_rows.toLocaleString()} people. ${esc(d.target_label)}: average ${fmt(m.target_summary.mean)} ${esc(d.units)}, typical spread (SD) ${fmt(m.target_summary.sd)} ${esc(d.units)}, range ${fmt(m.target_summary.min)}–${fmt(m.target_summary.max)} ${esc(d.units)}.</p>
    <p class="source">Source: ${esc(d.source)}. ${esc(d.citation)} <a href="${esc(d.url)}">NHANES website</a>.</p>`;
}

const DATASET_NAMES = { glucose: "Fasting glucose", sbp: "Blood pressure", fev1: "Lung function (FEV₁)" };

function checkTable(model) {
  const rows = Object.entries(bundles).map(([key, b]) => {
    const p = b.people[0];
    const u = b.units;
    let shows;
    if (model === "linear") {
      shows = `starting point <strong>${fmt(b.linear.baseline)}</strong> + pushes = prediction <strong>${fmt(b.linear.people[p.id].prediction)}</strong> ${u}`;
    } else if (model === "forest") {
      const f = b.forest.people[p.id];
      shows = `average of all ${b.forest.n_trees} trees <strong>${fmt(f.prediction)}</strong> ${u} (tree 1 alone: ${fmt(f.tree_predictions[0])})`;
    } else {
      const g = b.boosting;
      shows = `round 0 <strong>${fmt(g.init)}</strong> → round 500 <strong>${fmt(g.people[p.id].staged.at(-1))}</strong> ${u}; lowest validation RMSE ${fmt(g.best_validation_rmse)} ${u} at round <strong>${g.best_validation_round}</strong>`;
    }
    return `<tr><th scope="row">${DATASET_NAMES[key]}</th><td>${p.label} (${esc(p.description)})</td><td>${shows}</td></tr>`;
  });
  return `<div class="table-wrap"><table class="check">
    <caption><span class="tag">From the supplied data</span> Your finished section should still show these numbers</caption>
    <thead><tr><th scope="col">Dataset</th><th scope="col">Pick</th><th scope="col">Your app shows</th></tr></thead>
    <tbody>${rows.join("")}</tbody></table></div>`;
}

function glossary() {
  const groups = {};
  for (const [id, t] of Object.entries(terms)) (groups[t.group] ||= []).push([id, t]);
  return Object.entries(groups)
    .map(([g, items]) => `<section class="glossary-group"><h2>${esc(g)}</h2><dl>${items
      .map(([id, t]) => `<div class="term" id="${id}"><dt>${esc(t.term)}</dt><dd><p>${esc(t.short)}</p>${t.more ? `<p class="more">${esc(t.more)}</p>` : ""}</dd></div>`)
      .join("")}</dl></section>`)
    .join("");
}

const FILE_NOTES = {
  "AGENT_BRIEF.md": "Rules for your AI coding agent. Have it read this first.",
  "SETUP.md": "Run and publish your app (both routes).",
  "check.md": "Numbers your finished app must still show.",
  "README.md": "Your app's README: put your public link at the top.",
  "index.html": "GitHub Pages route: the page.",
  "app.js": "GitHub Pages route: the three plain starter sections.",
  "m10.js": "GitHub Pages route: helper math (pushes, boosting rounds).",
  "streamlit_app.py": "Streamlit route: the three plain starter sections.",
  "m10.py": "Streamlit route: helper math and the fixed models.",
  "requirements.txt": "Streamlit route: packages to install.",
  ".gitignore": "Keeps caches and secrets out of Git.",
  "data/README.md": "Data dictionary and sources.",
  "data/datasets.json": "Labels, units and categories for each dataset.",
  "data/manifest.json": "Provenance: source commit, versions, row counts.",
  "outputs/SCHEMA.md": "Field guide to the model output files.",
};

function fileList() {
  const rows = starterFiles().map((f) => {
    const rel = relative(STARTER, f);
    let note = FILE_NOTES[rel];
    if (!note && rel.startsWith("data/") && rel.endsWith(".csv")) note = `${DATASET_NAMES[rel.slice(5, -4)]} dataset.`;
    if (!note && rel.endsWith("_boosting_trees.json")) note = "The 500 boosting trees, for live predictions on edited values (optional).";
    if (!note && rel.startsWith("outputs/")) note = `Model outputs: ${DATASET_NAMES[rel.slice(8, -5)]}.`;
    return `<tr><td>${download(rel, rel)}</td><td>${esc(note || "")}</td></tr>`;
  });
  return `<div class="table-wrap"><table class="files"><thead><tr><th scope="col">File</th><th scope="col">What it is</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

function expand(html, zipBytes) {
  return html
    .replace(/\{\{help ([a-z0-9-]+)(?:\|([^}]+))?\}\}/g, (_, id, label) => help(id, label))
    .replace(/\{\{dl ([^|}]+)(?:\|([^}]+))?\}\}/g, (_, p, t) => download(p.trim(), t))
    .replace(/\{\{repo ([^|}]+)(?:\|([^}]+))?\}\}/g, (_, p, t) => repoLink(p.trim(), t))
    .replace(/\{\{dataset (\w+)\}\}/g, (_, k) => datasetCard(k))
    .replace(/\{\{check (\w+)\}\}/g, (_, m) => checkTable(m))
    .replace(/\{\{glossary\}\}/g, () => glossary())
    .replace(/\{\{files\}\}/g, () => fileList())
    .replace(/\{\{zip\}\}/g, () => `<a class="button primary" href="downloads/${ZIP_NAME}" download>Download the starter (.zip, ${size(zipBytes)})</a>`)
    .replace(/\{\{zipurl\}\}/g, `downloads/${ZIP_NAME}`);
}

function nav(current) {
  return NAV.map((n) =>
    n.group
      ? `<li class="nav-group" aria-hidden="true">${n.group}</li>`
      : `<li><a href="${n.file === "index" ? "./" : `${n.file}.html`}"${n.file === current ? ' aria-current="page"' : ""}>${esc(n.label)}</a></li>`,
  ).join("");
}

// ---- build ----------------------------------------------------------------------
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "downloads"), { recursive: true });
cpSync(join(SITE, "assets"), join(OUT, "assets"), { recursive: true });
cpSync(STARTER, join(OUT, "starter"), { recursive: true, filter: (p) => !p.includes("__pycache__") });
writeFileSync(join(OUT, ".nojekyll"), "");
writeFileSync(join(OUT, "assets", "terms.js"), `// Generated from site/terms.json\nexport const TERMS = ${JSON.stringify(terms)};\n`);

const zip = makeZip(starterFiles().map((f) => ({ name: `explain-the-model-starter/${relative(STARTER, f)}`, data: readFileSync(f) })));
writeFileSync(join(OUT, "downloads", ZIP_NAME), zip);

const layout = readFileSync(join(SITE, "layout.html"), "utf8");
for (const page of PAGES) {
  const src = readFileSync(join(SITE, "pages", `${page}.html`), "utf8");
  const meta = JSON.parse(src.match(/^<!--meta (.*?) -->/)[1]);
  const body = expand(src.replace(/^<!--meta .*? -->\n?/, ""), zip.length);
  const html = layout
    .replaceAll("{{title}}", esc(meta.title))
    .replaceAll("{{description}}", esc(meta.description))
    .replaceAll("{{page}}", page)
    .replace("{{base}}", meta.base ? `<base href="${meta.base}">` : "")
    .replace("{{nav}}", nav(page))
    .replace("{{version}}", VERSION === "local" ? "local build" : `<a href="${REPO}/commit/${VERSION}">version ${VERSION}</a>`)
    .replace("{{content}}", body)
    .replace("{{scripts}}", (meta.scripts || []).map((s) => `<script type="module" src="assets/${s}"></script>`).join(""));
  if (/\{\{[a-z]/.test(html)) throw new Error(`unexpanded token in ${page}: ${html.match(/\{\{[^}]*\}\}/)[0]}`);
  writeFileSync(join(OUT, `${page}.html`), html);
}
console.log(`built ${PAGES.length} pages, ${starterFiles().length} starter files, ${ZIP_NAME} (${size(zip.length)}) → dist/`);
