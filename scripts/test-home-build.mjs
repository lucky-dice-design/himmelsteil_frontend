import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const fallback = JSON.parse(await fs.readFile(path.join(root, "content", "cms-fallback.json"), "utf8"));
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "himmelsteil-home-test-"));
const originalFetch = global.fetch;
const originalUrl = process.env.DIRECTUS_URL;
const originalToken = process.env.DIRECTUS_TOKEN;
const originalFallbackFlag = process.env.DIRECTUS_FALLBACK_EMPTY;

try {
  await fs.cp(path.join(root, "dist"), path.join(tempRoot, "dist"), { recursive: true });
  await fs.writeFile(path.join(tempRoot, "dist", "blog-alter-entwurf.html"), "stale");
  await fs.mkdir(path.join(tempRoot, "content"));
  await fs.copyFile(path.join(root, "content", "cms-fallback.json"), path.join(tempRoot, "content", "cms-fallback.json"));

  const homePage = { ...fallback.home_page, hero_title: "CMS & <Test>", seo_title: "CMS & <SEO>" };
  const homeTiles = fallback.home_tiles.map((tile) => ({ ...tile, image: null }));
  const homeOccasions = fallback.home_occasions.map((item) => ({ ...item }));
  homeOccasions[0].title = "Hochzeit & Feier";
  const posts = fallback.posts.map((post) => ({ ...post }));
  posts[0].sections = null;
  const items = {
    gallery_items: fallback.gallery,
    packages: [],
    posts,
    home_page: homePage,
    home_tiles: homeTiles,
    home_occasions: homeOccasions,
    legal_pages: [{ slug: "impressum", title: "Impressum & Kontakt", seo_description: "CMS Rechtstext" }],
    legal_sections: [{ page: "impressum", sort: 1, heading: "Kontakt <Test>", body: "Zeile eins\nZeile zwei\n\n<script>verboten</script>" }],
  };

  process.env.DIRECTUS_URL = "https://directus-test.invalid";
  process.env.DIRECTUS_TOKEN = "test-token\r\n";
  process.env.DIRECTUS_FALLBACK_EMPTY = "1";
  global.fetch = async (input, options) => {
    const url = new URL(input);
    assert.equal(url.hostname, "directus-test.invalid");
    assert.equal(options?.headers?.Authorization, "Bearer test-token");
    const collection = url.pathname.split("/")[2];
    assert.ok(Object.hasOwn(items, collection), `Unexpected collection: ${collection}`);
    if (collection !== "home_page") {
      assert.equal(url.searchParams.get("filter[status][_eq]"), "published");
    }
    return new Response(JSON.stringify({ data: items[collection] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  process.chdir(tempRoot);
  await import("./build-directus-site.mjs");
  const html = await fs.readFile(path.join(tempRoot, "dist", "index.html"), "utf8");
  assert.match(html, /<h1>CMS &amp; &lt;Test&gt;<\/h1>/);
  assert.match(html, /<title>CMS &amp; &lt;SEO&gt;<\/title>/);
  assert.match(html, /<h3>Hochzeit &amp; Feier<\/h3>/);
  assert.equal((html.match(/class="image-tile/g) || []).length, 3);
  assert.doesNotMatch(html, /<h1>Schönes auf Papier\.<\/h1>/);
  assert.match(html, /href="\/galerie"/);
  const packagesHtml = await fs.readFile(path.join(tempRoot, "dist", "pakete.html"), "utf8");
  assert.match(packagesHtml, /Einladung anfragen/);
  const postHtml = await fs.readFile(path.join(tempRoot, "dist", `blog-${posts[0].slug}.html`), "utf8");
  assert.match(postHtml, /Eine ehrliche Reihenfolge: Was wichtig ist/);
  assert.match(postHtml, /href="\/blog"/);
  const imprintHtml = await fs.readFile(path.join(tempRoot, "dist", "impressum.html"), "utf8");
  assert.match(imprintHtml, /<h1>Impressum &amp; Kontakt<\/h1>/);
  assert.match(imprintHtml, /<h2>Kontakt &lt;Test&gt;<\/h2>/);
  assert.match(imprintHtml, /Zeile eins<br>Zeile zwei/);
  assert.match(imprintHtml, /&lt;script&gt;verboten&lt;\/script&gt;/);
  assert.match(imprintHtml, /content="CMS Rechtstext"/);
  const privacyHtml = await fs.readFile(path.join(tempRoot, "dist", "datenschutz.html"), "utf8");
  assert.match(privacyHtml, /<h1>Datenschutz<\/h1>/);
  await assert.rejects(fs.access(path.join(tempRoot, "dist", "blog-alter-entwurf.html")), { code: "ENOENT" });
  console.log("Directus-Startseitenbuild geprueft.");
} finally {
  process.chdir(root);
  global.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.DIRECTUS_URL;
  else process.env.DIRECTUS_URL = originalUrl;
  if (originalToken === undefined) delete process.env.DIRECTUS_TOKEN;
  else process.env.DIRECTUS_TOKEN = originalToken;
  if (originalFallbackFlag === undefined) delete process.env.DIRECTUS_FALLBACK_EMPTY;
  else process.env.DIRECTUS_FALLBACK_EMPTY = originalFallbackFlag;
  if (path.dirname(tempRoot) !== os.tmpdir() || !path.basename(tempRoot).startsWith("himmelsteil-home-test-")) {
    throw new Error("Unerwarteter Testpfad; temporaere Dateien werden nicht entfernt.");
  }
  await fs.rm(tempRoot, { recursive: true });
}
