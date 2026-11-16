#!/usr/bin/env node
/**
 * Build the app shell and browser bundles into single-file.html.
 * Run with: npm run build:single
 *
 * The proxy's service workers remain separate: browsers require worker scripts
 * to be fetched from their own same-origin URLs.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = path.dirname(fileURLToPath(import.meta.url));
const temp = mkdtempSync(path.join(tmpdir(), "weird-thing-single-"));
const jsOut = path.join(temp, "app.js");
const cssOut = path.join(temp, "app.css");

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function dataUrlFor(file) {
  const ext = path.extname(file).toLowerCase();
  const mime = ({
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
    ".avif": "image/avif", ".woff": "font/woff", ".woff2": "font/woff2",
    ".ttf": "font/ttf", ".otf": "font/otf", ".eot": "application/vnd.ms-fontobject",
  })[ext];
  if (!mime) return null;
  const contents = readFileSync(file);
  return `data:${mime}${ext === ".svg" ? "," + encodeURIComponent(contents.toString("utf8")) : ";base64," + contents.toString("base64")}`;
}

function inlineCssUrls(css, cssFile) {
  return css.replace(/url\((['"]?)(.*?)\1\)/gi, (whole, _quote, value) => {
    const url = value.trim();
    if (!url || /^(data:|https?:|\/\/|#|blob:)/i.test(url)) return whole;
    const asset = path.resolve(path.dirname(cssFile), decodeURIComponent(url.split(/[?#]/, 1)[0]));
    if (!asset.startsWith(root + path.sep) || !statSync(asset, { throwIfNoEntry: false })?.isFile()) return whole;
    const dataUrl = dataUrlFor(asset);
    return dataUrl ? `url("${dataUrl}")` : whole;
  });
}

try {
  const result = spawnSync("npx", [
    "--yes", "esbuild@0.25.0", "B5XiAeVc.js", "--bundle", "--format=esm",
    "--platform=browser", "--target=es2022", `--outfile=${jsOut}`,
    "--loader:.svg=dataurl", "--loader:.png=dataurl", "--loader:.jpg=dataurl",
    "--loader:.jpeg=dataurl", "--loader:.gif=dataurl", "--loader:.webp=dataurl",
    "--loader:.woff=dataurl", "--loader:.woff2=dataurl", "--loader:.ttf=dataurl",
    "--loader:.otf=dataurl", "--loader:.eot=dataurl",
  ], { cwd: root, encoding: "utf8", stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`esbuild exited with status ${result.status}`);

  const cssFiles = walk(path.join(root, "assets")).filter((file) => file.endsWith(".css"));
  if (statSync(cssOut, { throwIfNoEntry: false })?.isFile()) cssFiles.push(cssOut);
  const css = cssFiles.map((file) => inlineCssUrls(readFileSync(file, "utf8"), file)).join("\n");
  const js = readFileSync(jsOut, "utf8").replace(/<\/script/gi, "<\\/script");
  const safeCss = css.replace(/<\/style/gi, "<\\/style");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dogeub</title>
  <style>${safeCss}</style>
</head>
<body>
  <div id="root"></div>
  <script>window.open = function () { return null; };</script>
  <script type="module">${js}</script>
</body>
</html>
`;
  writeFileSync(path.join(root, "single-file.html"), html);
  console.log("Wrote single-file.html");
  console.log("Note: service-worker files and their runtime dependencies must remain hosted separately for proxy functionality.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
