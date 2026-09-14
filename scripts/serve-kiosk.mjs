// Static server for the kiosk build: dist/ at /, and the mirrored library at /clips.
//
// Deliberately dependency-free and local-only, so the show machine needs nothing installed beyond
// node and does not depend on the venue network being up.
//
//   node scripts/serve-kiosk.mjs [--port 4173] [--clips ./local-clips] [--host 127.0.0.1]
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const PORT = Number(argOf("port", 4173));
const HOST = argOf("host", "127.0.0.1");
const DIST = join(root, argOf("dist", "dist"));
const CLIPS = join(root, argOf("clips", "local-clips"));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

// Resolve a URL path inside a root without letting ".." escape it.
function safeJoin(base, urlPath) {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  const full = join(base, rel);
  return full.startsWith(base) ? full : null;
}

function send(res, status, headers, stream) {
  res.writeHead(status, headers);
  if (stream) stream.pipe(res);
  else res.end();
}

// Range support matters: the focus overlay seeks within full-quality clips, and Chrome will not
// start playback of a large mp4 without it.
function serveFile(req, res, file, cacheControl) {
  const stat = statSync(file);
  const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.range;

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Number(m[2]) : stat.size - 1;
      if (start >= stat.size || end >= stat.size || start > end) {
        return send(res, 416, { "Content-Range": `bytes */${stat.size}` });
      }
      return send(
        res,
        206,
        {
          "Content-Type": type,
          "Content-Length": end - start + 1,
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": cacheControl,
        },
        createReadStream(file, { start, end })
      );
    }
  }

  send(
    res,
    200,
    {
      "Content-Type": type,
      "Content-Length": stat.size,
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheControl,
    },
    createReadStream(file)
  );
}

const server = createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0];

  if (url.startsWith("/clips/")) {
    const file = safeJoin(CLIPS, url.slice("/clips".length));
    if (!file || !existsSync(file) || statSync(file).isDirectory()) return send(res, 404, {});
    // Clip filenames are stable day numbers, so they can be cached hard.
    return serveFile(req, res, file, "public, max-age=31536000, immutable");
  }

  const file = safeJoin(DIST, url === "/" ? "/index.html" : url);
  if (file && existsSync(file) && !statSync(file).isDirectory()) {
    // Hashed asset filenames are immutable; index.html must always be revalidated.
    const immutable = /\/assets\//.test(url);
    return serveFile(req, res, file, immutable ? "public, max-age=31536000, immutable" : "no-cache");
  }

  // SPA fallback.
  const index = join(DIST, "index.html");
  if (existsSync(index)) return serveFile(req, res, index, "no-cache");
  send(res, 404, {});
});

if (!existsSync(DIST)) {
  console.error(`No build at ${DIST} — run "npm run build:kiosk" first.`);
  process.exit(1);
}
if (!existsSync(CLIPS)) {
  console.warn(`! No mirrored clips at ${CLIPS} — run "npm run clips:mirror".`);
  console.warn("  The kiosk will fall back to whatever VITE_CDN_BASE was built in.\n");
}

server.listen(PORT, HOST, () => {
  console.log(`Kiosk serving on http://${HOST}:${PORT}`);
  console.log(`  app    ${DIST}`);
  console.log(`  clips  ${CLIPS} -> /clips`);
  console.log(`\nOpen fullscreen and it will go into kiosk mode automatically.`);
});
