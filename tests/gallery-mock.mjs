// A local stand-in for the gallery's Apps Script web app: the real gallery/Code.gs on an
// in-memory Sheet. Data is lost when it stops. Used by tests/e2e.py, or to preview:
//   node tests/gallery-mock.mjs 4174 &
//   GALLERY_ENDPOINT=http://localhost:4174/exec npm run build && npm run preview
import { createServer } from "node:http";
import { makeGallery } from "./gallery-fake.mjs";

const PORT = Number(process.argv[2] || 4174);
const gallery = makeGallery();

createServer((req, res) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  if (req.method === "GET") return res.writeHead(200, headers).end(JSON.stringify(gallery.get()));
  // Like Apps Script, answer nothing but GET and POST (so no CORS preflight either).
  if (req.method !== "POST") return res.writeHead(405).end();
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => res.writeHead(200, headers).end(JSON.stringify(gallery.post(body))));
}).listen(PORT, () => console.log(`gallery mock at http://localhost:${PORT}/exec`));
