// Preview dist/ under the same subpath GitHub Pages uses: node scripts/serve.mjs [port]
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const DIST = new URL("../dist", import.meta.url).pathname;
const BASE = "/regression-activity/";
const PORT = Number(process.argv[2] || 4173);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".csv": "text/csv", ".md": "text/markdown; charset=utf-8", ".py": "text/x-python", ".txt": "text/plain",
  ".zip": "application/zip", ".svg": "image/svg+xml",
};

createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (!url.startsWith(BASE)) {
    res.writeHead(302, { Location: BASE }).end();
    return;
  }
  let file = normalize(join(DIST, url.slice(BASE.length)));
  if (!file.startsWith(DIST)) return res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) {
    res.writeHead(404, { "Content-Type": TYPES[".html"] }).end(readFileSync(join(DIST, "404.html")));
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" }).end(readFileSync(file));
}).listen(PORT, () => console.log(`http://localhost:${PORT}${BASE}`));
