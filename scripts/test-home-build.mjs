import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";

const root = process.cwd();
const fallback = JSON.parse(await fs.readFile(path.join(root, "content", "cms-fallback.json"), "utf8"));
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "himmelsteil-home-test-"));
const originalFetch = global.fetch;
const originalUrl = process.env.DIRECTUS_URL;
const originalToken = process.env.DIRECTUS_TOKEN;
const originalFallbackFlag = process.env.DIRECTUS_FALLBACK_EMPTY;
const originalChannel = process.env.SITE_CHANNEL;
const originalStatePath = process.env.CMS_LIVE_STATE_PATH;

// Exercise the browser handlers with CMS labels and real click state changes.
function element(attributes = {}, dataset = {}) {
  const values = new Map(Object.entries(attributes));
  const classes = new Set((attributes.class || "").split(" "));
  return {
    dataset, listeners: {}, textContent: "", hidden: false,
    classList: { contains: (name) => classes.has(name), add: (name) => classes.add(name), remove: (name) => classes.delete(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name) },
    getAttribute: (name) => values.get(name), setAttribute: (name, value) => values.set(name, value),
    addEventListener(name, handler) { this.listeners[name] = handler; },
  };
}
const menu = element({}, { openLabel: "Navigation öffnen", closeLabel: "Navigation schließen" });
const menuText = element();
menu.querySelector = () => menuText;
const nav = element();
const status = element({}, { resultsMessage: "{count} Motive sichtbar" });
const buttons = [element({ "data-filter": "all", class: "filter is-active" }), element({ "data-filter": "event", class: "filter" })];
const cards = [element({ "data-category": "event" }), element({ "data-category": "hochzeit" })];
vm.runInNewContext(await fs.readFile(path.join(root, "dist", "script.js"), "utf8"), {
  document: { querySelector: (selector) => ({ ".menu-toggle": menu, ".main-nav": nav, "[data-gallery-status]": status })[selector] || null, querySelectorAll: (selector) => selector === "[data-filter]" ? buttons : cards, addEventListener() {} },
  crypto: { randomUUID: () => "test-id" },
});
menu.listeners.click();
assert.equal(menuText.textContent, "Navigation schließen");
menu.listeners.click();
assert.equal(menuText.textContent, "Navigation öffnen");
buttons[1].listeners.click();
assert.equal(status.textContent, "1 Motive sichtbar");
assert.equal(cards[1].hidden, true);
assert.equal(buttons[1].getAttribute("aria-pressed"), "true");
buttons[0].listeners.click();
assert.equal(status.textContent, "2 Motive sichtbar");
assert.ok(cards.every((card) => !card.hidden));

try {
  await fs.cp(path.join(root, "dist"), path.join(tempRoot, "dist"), { recursive: true });
  await fs.writeFile(path.join(tempRoot, "dist", "blog-alter-entwurf.html"), "stale");
  await fs.mkdir(path.join(tempRoot, "content"));
  await fs.copyFile(path.join(root, "content", "cms-fallback.json"), path.join(tempRoot, "content", "cms-fallback.json"));

  const heroFileId = "11111111-2222-4333-8444-555555555555";
  const logoFileId = "22222222-3333-4444-8555-666666666666";
  let logoDownloads = 0;
  let heroBytes = "hero-image-fixture";
  let galleryBytes = "gallery-image-fixture";
  const galleryFileId = "33333333-4444-4555-8666-777777777777";
  const introFileId = "44444444-5555-4666-8777-888888888888";
  const homePage = { ...fallback.home_page, hero_title: "CMS & <Test>", seo_title: "CMS & <SEO>", hero_image: { id: heroFileId }, hero_image_copyright: "© Anna & <Foto>", show_hero_image_copyright: true };
  const homeTiles = fallback.home_tiles.map((tile) => ({ ...tile, image: null }));
  const homeOccasions = fallback.home_occasions.map((item) => ({ ...item }));
  homeOccasions[0].title = "Hochzeit & Feier";
  const posts = fallback.posts.map((post) => ({ ...post }));
  posts[0].sections = null;
  const items = {
    gallery_page: { ...structuredClone(fallback.gallery_page), intro_title: "Galerie & <CMS>", intro_image: { id: introFileId }, intro_image_copyright: "© Galerie-Foto", show_intro_image_copyright: true, filter_label: "Arbeiten filtern", results_message: "{count} Motive sichtbar" },
    packages_page: { ...structuredClone(fallback.packages_page), seo_title: "Pakete $& <CMS>", details_title: "Persönlich & <passend>", details_cta_label: "Mehr erfahren" },
    blog_page: { ...structuredClone(fallback.blog_page), read_label: "Weiterlesen & entdecken", section_title: "Atelier-Neuigkeiten", contact_cta_label: "Mit uns sprechen" },
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
    site_settings: { ...fallback.site_settings, brand_name: "CMS & Marke", footer_text: "© CMS <Footer>", logo: { id: logoFileId }, logo_alt: "Logo & <Marke>", show_footer_logo: true },
  };
  for (const [name, data] of Object.entries(items)) {
    if (Array.isArray(data)) items[name] = data.map((item) => ({ ...item, status: "live" }));
    else data.status = "live";
  }
  items.posts.push({ ...items.posts[0], slug: "nur-preview", title: "Unveröffentlichter Beitrag", status: "preview" });
  items.gallery_items = items.gallery_items.map((item) => ({ ...item, image_copyright: "Ausgeschalteter Bildnachweis", show_image_copyright: false }));
  items.gallery_items[0].image = { id: galleryFileId };
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
    if (url.pathname === `/assets/${logoFileId}`) {
      logoDownloads++;
      assert.equal(url.searchParams.get("fit"), "inside", "Ein Logo darf nicht beschnitten werden.");
      assert.equal(url.searchParams.get("width"), "640");
      assert.equal(url.searchParams.get("height"), "320");
      return new Response("logo-image-fixture", { headers: { "Content-Type": "image/webp" } });
    }
    if (url.pathname === `/assets/${heroFileId}`) {
      assert.equal(url.searchParams.get("fit"), "inside", "Das Hero-Motiv darf beim Download nicht beschnitten werden.");
      assert.equal(url.searchParams.get("width"), "1800");
      assert.equal(url.searchParams.get("height"), "1350");
      return new Response(heroBytes, { headers: { "Content-Type": "image/webp" } });
    }
    if (url.pathname === `/assets/${galleryFileId}`) {
      return new Response(galleryBytes, { headers: { "Content-Type": "image/webp" } });
    }
    if (url.pathname === `/assets/${introFileId}`) {
      assert.equal(url.searchParams.get("width"), "1200");
      return new Response("page-intro-fixture", { headers: { "Content-Type": "image/webp" } });
    }
    const collection = url.pathname.split("/")[2];
    assert.ok(Object.hasOwn(items, collection), `Unexpected collection: ${collection}`);
    if (!new Set(["home_page", "contact_form", "site_settings", "gallery_page", "packages_page", "blog_page"]).has(collection)) {
      assert.equal(url.searchParams.get("filter[status][_in]"), process.env.SITE_CHANNEL === "preview" ? "live,published,preview" : "live,published");
    }
    return new Response(JSON.stringify({ data: items[collection] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  process.chdir(tempRoot);
  await import("./build-directus-site.mjs");
  assert.equal(logoDownloads, 1, "Das gemeinsame Logo wird nur einmal pro Build geladen.");
  const html = await fs.readFile(path.join(tempRoot, "dist", "index.html"), "utf8");
  assert.match(html, /<h1>CMS &amp; &lt;Test&gt;<\/h1>/);
  assert.match(html, /<title>CMS &amp; &lt;SEO&gt;<\/title>/);
  const heroPath = (markup) => markup.match(new RegExp(`src="(assets/cms/home-hero-${heroFileId}-[a-f0-9]{12}\\.webp)"`))?.[1];
  const galleryPath = (markup) => markup.match(new RegExp(`src="(assets/cms/[^"/]+-${galleryFileId}-[a-f0-9]{12}\\.webp)"`))?.[1];
  assert.ok(heroPath(html));
  assert.equal(await fs.readFile(path.join(tempRoot, "dist", heroPath(html)), "utf8"), heroBytes);
  assert.match(html, /<h3>Hochzeit &amp; Feier<\/h3>/);
  assert.equal((html.match(/class="image-tile/g) || []).length, 3);
  assert.doesNotMatch(html, /<h1>Schönes auf Papier\.<\/h1>/);
  assert.match(html, /href="\/galerie"/);
  assert.match(html, /<small><i>© Anna &amp; &lt;Foto&gt;<\/i><\/small>/);
  assert.match(html, /<small><i>© Kachel<\/i><\/small>/);
  assert.match(html, /content="noindex,nofollow,noarchive"/);
  const galleryHtml = await fs.readFile(path.join(tempRoot, "dist", "galerie.html"), "utf8");
  assert.doesNotMatch(galleryHtml.match(/<!-- CMS:GALLERY:START -->[\s\S]*?<!-- CMS:GALLERY:END -->/)[0], /Ausgeschalteter Bildnachweis|<figcaption/);
  for (const file of (await fs.readdir(path.join(tempRoot, "dist"))).filter((name) => name.endsWith(".html"))) {
    const page = await fs.readFile(path.join(tempRoot, "dist", file), "utf8");
    assert.match(page, /<span>CMS &amp; Marke<\/span>/);
    assert.match(page, /© CMS &lt;Footer&gt;/);
    assert.equal((page.match(/class="brand-mark custom-logo"/g) || []).length, 2, `Logo in Header und Footer: ${file}`);
    assert.match(page, /alt="Logo &amp; &lt;Marke&gt;"/);
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
  const galleryPageHtml = await fs.readFile(path.join(tempRoot, "dist", "galerie.html"), "utf8");
  assert.match(galleryPageHtml, /<h1>Galerie &amp; &lt;CMS&gt;<\/h1>/);
  assert.match(galleryPageHtml, /© Galerie-Foto/);
  assert.match(galleryPageHtml, /aria-label="Arbeiten filtern"/);
  assert.match(galleryPageHtml, /6 Motive sichtbar/);
  assert.match(galleryPageHtml, new RegExp(`home-gallery-page-${introFileId}-[a-f0-9]{12}\\.webp`));
  const packagesPageHtml = await fs.readFile(path.join(tempRoot, "dist", "pakete.html"), "utf8");
  assert.match(packagesPageHtml, /<title>Pakete \$&amp; &lt;CMS&gt;<\/title>/);
  assert.match(packagesPageHtml, /Persönlich &amp; &lt;passend&gt;/);
  assert.match(packagesPageHtml, />Mehr erfahren<\/a>/);
  const blogPageHtml = await fs.readFile(path.join(tempRoot, "dist", "blog.html"), "utf8");
  assert.match(blogPageHtml, /Atelier-Neuigkeiten/);
  assert.match(blogPageHtml, /Weiterlesen &amp; entdecken/);
  const articleHtml = await fs.readFile(path.join(tempRoot, "dist", `blog-${posts[0].slug}.html`), "utf8");
  assert.match(articleHtml, /Mit uns sprechen/);

  // Replacing a file under the same Directus ID must invalidate cached image URLs.
  const firstGalleryHtml = await fs.readFile(path.join(tempRoot, "dist", "galerie.html"), "utf8");
  assert.ok(galleryPath(firstGalleryHtml));
  await import("./build-directus-site.mjs?unchanged-images");
  assert.equal(heroPath(await fs.readFile(path.join(tempRoot, "dist", "index.html"), "utf8")), heroPath(html));
  assert.equal(galleryPath(await fs.readFile(path.join(tempRoot, "dist", "galerie.html"), "utf8")), galleryPath(firstGalleryHtml));
  heroBytes = "replaced-hero-image";
  galleryBytes = "replaced-gallery-image";
  await import("./build-directus-site.mjs?replaced-images");
  const replacedHero = heroPath(await fs.readFile(path.join(tempRoot, "dist", "index.html"), "utf8"));
  const replacedGallery = galleryPath(await fs.readFile(path.join(tempRoot, "dist", "galerie.html"), "utf8"));
  assert.ok(replacedHero);
  assert.ok(replacedGallery);
  assert.notEqual(replacedHero, heroPath(html));
  assert.notEqual(replacedGallery, galleryPath(firstGalleryHtml));
  assert.equal(await fs.readFile(path.join(tempRoot, "dist", replacedHero), "utf8"), heroBytes);
  assert.equal(await fs.readFile(path.join(tempRoot, "dist", replacedGallery), "utf8"), galleryBytes);

  const originalFilters = structuredClone(items.gallery_page.gallery_filters);
  items.gallery_page.gallery_filters = [
    { category: "kollektion", label: "Designs & <Ideen>", enabled: true },
    { category: "event", label: "Ausgeblendet", enabled: false },
    { category: "all", label: "Alle Arbeiten", enabled: true },
  ];
  await import("./build-directus-site.mjs?custom-gallery-filters");
  const customGallery = await fs.readFile(path.join(tempRoot, "dist", "galerie.html"), "utf8");
  assert.match(customGallery, /data-filter="kollektion"[^>]*>Designs &amp; &lt;Ideen&gt;<\/button>/);
  assert.doesNotMatch(customGallery, /data-filter="event"|data-filter="hochzeit"|Ausgeblendet/);
  assert.ok(customGallery.indexOf('data-filter="kollektion"') < customGallery.indexOf('data-filter="all"'));
  assert.match(customGallery, /class="filter is-active"[^>]*data-filter="all"[^>]*aria-pressed="true"[^>]*>Alle Arbeiten/);
  assert.match(customGallery, /data-category="event"/, "Deaktivierte Filter entfernen keine Galerieeintraege.");
  items.gallery_page.gallery_filters = [{ category: "event", label: "Feiern", enabled: true }];
  await import("./build-directus-site.mjs?without-all-filter");
  const withoutAll = await fs.readFile(path.join(tempRoot, "dist", "galerie.html"), "utf8");
  assert.doesNotMatch(withoutAll, /data-filter="all"|filter is-active/);
  assert.match(withoutAll, /data-filter="event" aria-pressed="false"/);
  items.gallery_page.gallery_filters = originalFilters.map((filter) => ({ ...filter, enabled: false }));
  await import("./build-directus-site.mjs?disabled-gallery-filters");
  assert.doesNotMatch(await fs.readFile(path.join(tempRoot, "dist", "galerie.html"), "utf8"), /class="filter-bar"|data-filter=/);
  items.gallery_page.gallery_filters = [];
  await import("./build-directus-site.mjs?empty-gallery-filters");
  assert.doesNotMatch(await fs.readFile(path.join(tempRoot, "dist", "galerie.html"), "utf8"), /class="filter-bar"|data-filter=/);
  items.gallery_page.gallery_filters = [...originalFilters, originalFilters[0]];
  await assert.rejects(import("./build-directus-site.mjs?duplicate-gallery-filter"), /Kategorie ungueltig oder doppelt/);
  items.gallery_page.gallery_filters = [{ category: 'event" onclick="alert(1)', label: "Unsicher", enabled: true }];
  await assert.rejects(import("./build-directus-site.mjs?invalid-gallery-filter"), /Kategorie ungueltig oder doppelt/);
  items.gallery_page.gallery_filters = originalFilters;

  // Images/extra package section can be hidden; gallery cards can be image-only.
  items.gallery_page.show_intro_image = false;
  items.packages_page.show_details = false;
  const firstWork = { ...items.gallery_items[0] };
  items.gallery_items[0].title = null;
  items.gallery_items[0].description = null;
  await import("./build-directus-site.mjs?optional-gallery-copy");
  const imageOnlyGallery = await fs.readFile(path.join(tempRoot, "dist", "galerie.html"), "utf8");
  assert.match(imageOnlyGallery, /page-intro-no-image/);
  const firstCard = imageOnlyGallery.match(/<article class="gallery-card"[^>]*>[\s\S]*?<\/article>/)[0];
  assert.match(firstCard, /<img/);
  assert.doesNotMatch(firstCard, /gallery-card-body|<h3|<p>|null|undefined/);
  assert.doesNotMatch(await fs.readFile(path.join(tempRoot, "dist", "pakete.html"), "utf8"), /Persönlich &amp; &lt;passend&gt;|>Mehr erfahren<\/a>/);
  items.gallery_items[0] = firstWork;
  items.gallery_page.show_intro_image = true;
  items.packages_page.show_details = true;
  items.packages_page.details_cta_href = "javascript:alert(1)";
  await assert.rejects(import("./build-directus-site.mjs?unsafe-page-link"), /interner Link ungueltig/);
  items.packages_page.details_cta_href = "/kontakt";

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
  items.gallery_page.status = "preview";
  items.packages_page.status = "preview";
  items.blog_page.status = "preview";
  items.gallery_page.intro_title = "Preview-Galeriekopf";
  items.packages_page.intro_title = "Preview-Paketkopf";
  items.blog_page.intro_title = "Preview-Blogkopf";
  items.site_settings.brand_name = "Preview-Marke";
  items.site_settings.logo = null;
  items.site_settings.show_footer_logo = false;
  items.gallery_page.gallery_filters = [{ category: "event", label: "Preview-Filter", enabled: true }];
  items.home_tiles[0].status = "preview";
  items.legal_pages[0].status = "preview";
  await import("./build-directus-site.mjs?live-snapshot");
  const liveHtml = await fs.readFile(path.join(tempRoot, "dist", "index.html"), "utf8");
  assert.match(liveHtml, /<h1>CMS &amp; &lt;Test&gt;<\/h1>/);
  assert.match(liveHtml, new RegExp(`home-site-logo-${logoFileId}-[a-f0-9]{12}\\.webp`), "Das Live-Logo bleibt bei einer Preview-Aenderung erhalten.");
  assert.doesNotMatch(liveHtml, /Nur in Preview geändert|Preview-Marke|© Kachel/);
  assert.doesNotMatch(await fs.readFile(path.join(tempRoot, "dist", "galerie.html"), "utf8"), /Preview-Filter/);
  for (const file of ["galerie.html", "pakete.html", "blog.html"]) {
    assert.doesNotMatch(await fs.readFile(path.join(tempRoot, "dist", file), "utf8"), /Preview-(Galerie|Paket|Blog)kopf/);
  }
  assert.match(liveHtml, /<a href="\/" aria-current="page">Start<\/a>/);
  assert.doesNotMatch(await fs.readFile(path.join(tempRoot, "dist", "impressum.html"), "utf8"), /Kontakt &lt;Test&gt;/, "Rechtstext darf nicht aus dem vorherigen Build stehen bleiben.");
  const stateBeforePreview = await fs.readFile(process.env.CMS_LIVE_STATE_PATH, "utf8");
  process.env.SITE_CHANNEL = "preview";
  await import("./build-directus-site.mjs?preview-revision");
  const previewHtml = await fs.readFile(path.join(tempRoot, "dist", "index.html"), "utf8");
  assert.match(previewHtml, /Nur in Preview geändert/);
  assert.match(previewHtml, /Preview-Marke/);
  assert.match(await fs.readFile(path.join(tempRoot, "dist", "galerie.html"), "utf8"), /Preview-Filter/);
  for (const file of ["galerie.html", "pakete.html", "blog.html"]) {
    assert.match(await fs.readFile(path.join(tempRoot, "dist", file), "utf8"), /Preview-(Galerie|Paket|Blog)kopf/);
  }
  assert.doesNotMatch(previewHtml, /custom-logo|footer-brand/);
  assert.match(previewHtml, /<svg viewBox="0 0 64 64">/);
  assert.equal(await fs.readFile(process.env.CMS_LIVE_STATE_PATH, "utf8"), stateBeforePreview);
  assert.doesNotMatch((await fs.readdir(path.join(tempRoot, "dist"))).join(","), /live-state|singletons/);
  items.home_page.status = "live";
  items.site_settings.status = "live";
  items.gallery_page.status = "live";
  items.packages_page.status = "live";
  items.blog_page.status = "live";
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
  const successfulFetch = global.fetch;
  global.fetch = (input, options) => new URL(input).pathname === "/items/site_settings"
    ? Promise.resolve(new Response(JSON.stringify({ errors: [{ message: "Forbidden" }] }), { status: 403 }))
    : successfulFetch(input, options);
  process.env.SITE_CHANNEL = "preview";
  await assert.rejects(import("./build-directus-site.mjs?missing-migration"), /setup-website-features\.sh/);
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
