import fs from "node:fs";
import path from "node:path";

const root = path.resolve("dist");
const htmlFiles = fs.readdirSync(root).filter((file) => file.endsWith(".html"));
const errors = [];

const fail = (file, message) => errors.push(`${file}: ${message}`);

for (const file of htmlFiles) {
  const html = fs.readFileSync(path.join(root, file), "utf8");

  if (!/<html\s+[^>]*lang="de"/i.test(html)) fail(file, "lang=de fehlt");
  if (!/<title>[^<]+<\/title>/i.test(html)) fail(file, "Titel fehlt");
  if (!/<meta\s+name="description"\s+content="[^"]+"/i.test(html)) fail(file, "Meta Description fehlt");

  const h1Count = (html.match(/<h1(?:\s|>)/gi) ?? []).length;
  if (h1Count !== 1) fail(file, `erwartet genau eine H1, gefunden: ${h1Count}`);

  for (const match of html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try {
      JSON.parse(match[1]);
    } catch (error) {
      fail(file, `ungültiges JSON-LD: ${error.message}`);
    }
  }

  for (const match of html.matchAll(/<(?:a|link|script|img)\b[^>]*(?:href|src)="([^"]+)"[^>]*>/gi)) {
    const reference = match[1];
    if (/^(?:https?:|mailto:|tel:|data:|#)/i.test(reference)) continue;
    const localPath = reference.split(/[?#]/)[0];
    const sitePath = localPath.replace(/^\//, "");
    const target = sitePath === "" ? "index.html" : path.extname(sitePath) ? sitePath : `${sitePath}.html`;
    if (!fs.existsSync(path.join(root, target))) fail(file, `lokale Referenz fehlt: ${reference}`);
    if (match[0].startsWith("<a ") && localPath.endsWith(".html")) {
      fail(file, `interner Link mit .html: ${reference}`);
    }
  }

  for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
    const attributes = match[1];
    if (!/\balt="[^"]*"/i.test(attributes)) fail(file, "Bild ohne alt-Attribut");
    if (!/\bwidth="\d+"/i.test(attributes) || !/\bheight="\d+"/i.test(attributes)) {
      fail(file, "Bild ohne width/height");
    }
  }
}

for (const required of ["robots.txt", "favicon.svg"]) {
  if (!fs.existsSync(path.join(root, required))) fail("dist", `${required} fehlt`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`${htmlFiles.length} HTML-Seiten geprüft: keine SEO-Strukturfehler gefunden.`);
