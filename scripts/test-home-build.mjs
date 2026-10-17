import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const fallback = JSON.parse(await fs.readFile(path.join(root, "content", "cms-fallback.json"), "utf8"));
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "himmelsteil-home-test-"));
const originalFetch = global.fetch;
const originalUrl = process.env.DIRECTUS_URL;
const originalToken = process.env.DIRECTUS_TOKEN;
const originalFallbackFlag = process.env.DIRECTUS_FALLBACK_EMPTY;
const originalChannel = process.env.SITE_CHANNEL;
const originalStatePath = process.env.CMS_LIVE_STATE_PATH;

try {
  await fs.cp(path.join(root, "dist"), path.join(tempRoot, "dist"), { recursive: true });
  await fs.writeFile(path.join(tempRoot, "dist", "blog-alter-entwurf.html"), "stale");
  await fs.mkdir(path.join(tempRoot, "content"));
  await fs.copyFile(path.join(root, "content", "cms-fallback.json"), path.join(tempRoot, "content", "cms-fallback.json"));

  const heroFileId = "11111111-2222-4333-8444-555555555555";
  const homePage = { ...fallback.home_page, hero_title: "CMS & <Test>", seo_title: "CMS & <SEO>", hero_image: { id: heroFileId }, hero_image_copyright: "© Anna & <Foto>", show_hero_image_copyright: true };
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
    contact_form: { ...fallback.contact_form, intro_title: "Kontakt & <CMS>", submit_label: "Jetzt anfragen" },
    contact_options: [{ sort: 1, label: "Freie Feier & Fest" }],
    site_settings: { ...fallback.site_settings, brand_name: "CMS & Marke", footer_text: "© CMS <Footer>" },
  };
  for (const [name, data] of Object.entries(items)) {
    if (Array.isArray(data)) items[name] = data.map((item) => ({ ...item, status: "live" }));
    else data.status = "live";
  }
  items.posts.push({ ...items.posts[0], slug: "nur-preview", title: "Unveröffentlichter Beitrag", status: "preview" });
  items.gallery_items = items.gallery_items.map((item) => ({ ...item, image_copyright: "Ausgeschalteter Bildnachweis", show_image_copyright: false }));
  items.home_tiles[0] = { ...items.home_tiles[0], image_copyright: "© Kachel", show_image_copyright: true };
  items.contact_form.intro_image_copyright = "© Kontaktfoto";
  items.contact_form.show_intro_image_copyright = true;

  process.env.DIRECTUS_URL = "https://directus-test.invalid";
  process.env.DIRECTUS_TOKEN = "test-token\r\n";
  process.env.DIRECTUS_FALLBACK_EMPTY = "1";
  process.env.SITE_CHANNEL = "preview";
  process.env.CMS_LIVE_STATE_PATH = path.join(tempRoot, ".cms-live-state.json");
  global.fetch = async (input, options) => {
    const url = new URL(input);
    assert.equal(url.hostname, "directus-test.invalid");
    assert.equal(options?.headers?.Authorization, "Bearer test-token");
    if (url.pathname === `/assets/${heroFileId}`) {
      assert.equal(url.searchParams.get("fit"), "inside", "Das Hero-Motiv darf beim Download nicht beschnitten werden.");
      assert.equal(url.searchParams.get("width"), "1800");
      assert.equal(url.searchParams.get("height"), "1350");
      return new Response("hero-image-fixture", { headers: { "Content-Type": "image/webp" } });
    }
    const collection = url.pathname.split("/")[2];
    assert.ok(Object.hasOwn(items, collection), `Unexpected collection: ${collection}`);
    if (!new Set(["home_page", "contact_form", "site_settings"]).has(collection)) {
      assert.equal(url.searchParams.get("filter[status][_in]"), process.env.SITE_CHANNEL === "preview" ? "live,published,preview" : "live,published");
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
  assert.match(html, new RegExp(`src="assets/cms/home-hero-${heroFileId}\\.webp"`));
  assert.equal(await fs.readFile(path.join(tempRoot, "dist", "assets", "cms", `home-hero-${heroFileId}.webp`), "utf8"), "hero-image-fixture");
  assert.match(html, /<h3>Hochzeit &amp; Feier<\/h3>/);
  assert.equal((html.match(/class="image-tile/g) || []).length, 3);
  assert.doesNotMatch(html, /<h1>Schönes auf Papier\.<\/h1>/);
  assert.match(html, /href="\/galerie"/);
  assert.match(html, /<small><i>© Anna &amp; &lt;Foto&gt;<\/i><\/small>/);
  assert.match(html, /<small><i>© Kachel<\/i><\/small>/);
  assert.match(html, /content="noindex,nofollow,noarchive"/);
  const galleryHtml = await fs.readFile(path.join(tempRoot, "dist", "galerie.html"), "utf8");
  assert.doesNotMatch(galleryHtml, /Ausgeschalteter Bildnachweis|<figcaption/);
  for (const file of (await fs.readdir(path.join(tempRoot, "dist"))).filter((name) => name.endsWith(".html"))) {
    const page = await fs.readFile(path.join(tempRoot, "dist", file), "utf8");
    assert.match(page, /<span>CMS &amp; Marke<\/span>/);
    assert.match(page, /© CMS &lt;Footer&gt;/);
  }
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
  const contactHtml = await fs.readFile(path.join(tempRoot, "dist", "kontakt.html"), "utf8");
  assert.match(contactHtml, /<h1>Kontakt &amp; &lt;CMS&gt;<\/h1>/);
  assert.match(contactHtml, /<option>Freie Feier &amp; Fest<\/option>/);
  assert.match(contactHtml, />Jetzt anfragen<\/button>/);
  assert.match(contactHtml, /<small><i>© Kontaktfoto<\/i><\/small>/);
  await assert.rejects(fs.access(path.join(tempRoot, "dist", "blog-alter-entwurf.html")), { code: "ENOENT" });
  await fs.access(path.join(tempRoot, "dist", "blog-nur-preview.html"));

  // Live must exclude preview entries even when the API returns too much data.
  process.env.SITE_CHANNEL = "live";
  await import("./build-directus-site.mjs?live-initial");
  await assert.rejects(fs.access(path.join(tempRoot, "dist", "blog-nur-preview.html")), { code: "ENOENT" });
  const livePackages = await fs.readFile(path.join(tempRoot, "dist", "pakete.html"), "utf8");
  assert.doesNotMatch(livePackages, /Einladung anfragen/, "Live darf leere Collections nicht mit Beispielinhalten auffuellen.");
  assert.match(await fs.readFile(path.join(tempRoot, "dist", "index.html"), "utf8"), /content="index,follow,max-image-preview:large"/);
  // A preview revision of a singleton must keep the previously built live content.
  items.home_page.status = "preview";
  items.home_page.hero_title = "Nur in Preview geändert";
  items.site_settings.status = "preview";
  items.site_settings.brand_name = "Preview-Marke";
  items.home_tiles[0].status = "preview";
  items.legal_pages[0].status = "preview";
  await import("./build-directus-site.mjs?live-snapshot");
  const liveHtml = await fs.readFile(path.join(tempRoot, "dist", "index.html"), "utf8");
  assert.match(liveHtml, /<h1>CMS &amp; &lt;Test&gt;<\/h1>/);
  assert.doesNotMatch(liveHtml, /Nur in Preview geändert|Preview-Marke|© Kachel/);
  assert.match(liveHtml, /<a href="\/" aria-current="page">Start<\/a>/);
  assert.doesNotMatch(await fs.readFile(path.join(tempRoot, "dist", "impressum.html"), "utf8"), /Kontakt &lt;Test&gt;/, "Rechtstext darf nicht aus dem vorherigen Build stehen bleiben.");
  const stateBeforePreview = await fs.readFile(process.env.CMS_LIVE_STATE_PATH, "utf8");
  process.env.SITE_CHANNEL = "preview";
  await import("./build-directus-site.mjs?preview-revision");
  const previewHtml = await fs.readFile(path.join(tempRoot, "dist", "index.html"), "utf8");
  assert.match(previewHtml, /Nur in Preview geändert/);
  assert.match(previewHtml, /Preview-Marke/);
  assert.equal(await fs.readFile(process.env.CMS_LIVE_STATE_PATH, "utf8"), stateBeforePreview);
  assert.doesNotMatch((await fs.readdir(path.join(tempRoot, "dist"))).join(","), /live-state|singletons/);
  items.home_page.status = "live";
  items.site_settings.status = "live";
  process.env.SITE_CHANNEL = "live";
  await import("./build-directus-site.mjs?promote-live");
  assert.match(await fs.readFile(path.join(tempRoot, "dist", "index.html"), "utf8"), /Nur in Preview geändert/);
  assert.match(await fs.readFile(process.env.CMS_LIVE_STATE_PATH, "utf8"), /Preview-Marke/);
  const check = spawnSync(process.execPath, [path.join(root, "scripts", "check-site.mjs")], { cwd: tempRoot, encoding: "utf8" });
  assert.equal(check.status, 0, check.stdout + check.stderr);
  // Unsafe navigation and an absent first Live snapshot must fail visibly.
  items.site_settings.header_links = [{ label: "Unsicher", href: "javascript:alert(1)" }];
  process.env.SITE_CHANNEL = "preview";
  await assert.rejects(import("./build-directus-site.mjs?unsafe-link"), /Link benoetigt/);
  process.env.SITE_CHANNEL = "live";
  process.env.CMS_LIVE_STATE_PATH = path.join(tempRoot, "missing-state.json");
  items.home_page.status = "preview";
  await assert.rejects(import("./build-directus-site.mjs?missing-state"), /kein Live-Stand vorhanden/);
  console.log("CMS-Build geprueft: Header/Footer, Bildnachweise, Live/Preview und Live-Zwischenstand.");
} finally {
  process.chdir(root);
  global.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.DIRECTUS_URL;
  else process.env.DIRECTUS_URL = originalUrl;
  if (originalToken === undefined) delete process.env.DIRECTUS_TOKEN;
  else process.env.DIRECTUS_TOKEN = originalToken;
  if (originalFallbackFlag === undefined) delete process.env.DIRECTUS_FALLBACK_EMPTY;
  else process.env.DIRECTUS_FALLBACK_EMPTY = originalFallbackFlag;
  if (originalChannel === undefined) delete process.env.SITE_CHANNEL;
  else process.env.SITE_CHANNEL = originalChannel;
  if (originalStatePath === undefined) delete process.env.CMS_LIVE_STATE_PATH;
  else process.env.CMS_LIVE_STATE_PATH = originalStatePath;
  if (path.dirname(tempRoot) !== os.tmpdir() || !path.basename(tempRoot).startsWith("himmelsteil-home-test-")) {
    throw new Error("Unerwarteter Testpfad; temporaere Dateien werden nicht entfernt.");
  }
  await fs.rm(tempRoot, { recursive: true });
}
