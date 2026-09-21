import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const distDir = path.join(projectRoot, "dist");
const fallbackPath = path.join(projectRoot, "content", "cms-fallback.json");
const directusUrl = process.env.DIRECTUS_URL?.replace(/\/$/, "");
const directusToken = process.env.DIRECTUS_TOKEN?.trim();
const allowEmptyFallback = process.env.DIRECTUS_FALLBACK_EMPTY === "1";
const fallback = JSON.parse(await fs.readFile(fallbackPath, "utf8"));

if (directusUrl && (!directusToken || !/^[\x21-\x7e]+$/.test(directusToken))) {
  throw new Error("DIRECTUS_TOKEN fehlt oder enthaelt Leerzeichen/Steuerzeichen. Nur den Token-Wert ohne 'Bearer' einfuegen.");
}

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const slugify = (value) =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const formatDate = (value) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));

async function directusError(response, collection) {
  const payload = await response.json().catch(() => ({}));
  const detail = payload.errors?.[0]?.extensions?.reason || payload.errors?.[0]?.message || response.statusText;
  return new Error(`Directus ${collection}: ${response.status} ${detail}`);
}

const assertSafePostSlug = (slug) => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(slug))) {
    throw new Error(`Ungültiger Blog-Slug: ${slug}`);
  }
};

async function readCollection(collection, fields, sort) {
  const query = new URLSearchParams({
    "filter[status][_eq]": "published",
    fields: fields.join(","),
    limit: "100",
    sort,
  });
  const response = await fetch(`${directusUrl}/items/${collection}?${query}`, {
    headers: directusToken ? { Authorization: `Bearer ${directusToken}` } : {},
  });
  if (!response.ok) {
    throw await directusError(response, collection);
  }
  const payload = await response.json();
  if (!Array.isArray(payload.data)) throw new Error(`Directus ${collection}: ungültige Antwort`);
  return payload.data;
}

async function readSingleton(collection, fields) {
  const query = new URLSearchParams({ fields: fields.join(",") });
  const response = await fetch(`${directusUrl}/items/${collection}?${query}`, {
    headers: directusToken ? { Authorization: `Bearer ${directusToken}` } : {},
  });
  if (!response.ok) throw await directusError(response, collection);
  const payload = await response.json();
  if (!payload.data || Array.isArray(payload.data)) throw new Error(`Directus ${collection}: ungültige Singleton-Antwort`);
  return payload.data;
}

async function loadContent() {
  if (!directusUrl) {
    console.log("DIRECTUS_URL fehlt: lokaler Fallback-Inhalt wird verwendet.");
    return fallback;
  }

  console.log(`Lade veröffentlichte Inhalte aus ${directusUrl}`);
  const [gallery, packages, posts, homePage, homeTiles, homeOccasions, legalPages, legalSections] = await Promise.all([
    readCollection(
      "gallery_items",
      ["id", "sort", "category", "title", "description", "image.id", "image_alt", "swatch_class"],
      "sort"
    ),
    readCollection(
      "packages",
      ["id", "sort", "kicker", "title", "description", "features", "cta_label", "featured"],
      "sort"
    ),
    readCollection(
      "posts",
      ["id", "title", "slug", "category", "excerpt", "meta_title", "meta_description", "published_at", "reading_minutes", "sections"],
      "-published_at"
    ),
    readSingleton("home_page", [
      "seo_title", "seo_description", "hero_eyebrow", "hero_title", "hero_body", "hero_image.id",
      "hero_image_alt", "hero_primary_label", "hero_secondary_label", "intro_eyebrow", "intro_title",
      "intro_body", "intro_link_label", "occasions_eyebrow", "occasions_title",
    ]),
    readCollection("home_tiles", ["id", "sort", "destination", "label", "image.id", "image_alt"], "sort"),
    readCollection("home_occasions", ["id", "sort", "title", "description"], "sort"),
    readCollection("legal_pages", ["id", "slug", "title", "seo_description"], "slug"),
    readCollection("legal_sections", ["id", "sort", "page", "heading", "body"], "sort"),
  ]);

  const useFallback = (name, items) => {
    if (items.length || !allowEmptyFallback) return items;
    console.warn(`Directus ${name} ist leer: voruebergehend Fallback-Inhalt verwendet.`);
    return fallback[name];
  };
  return {
    gallery: useFallback("gallery", gallery),
    packages: useFallback("packages", packages),
    posts: useFallback("posts", posts),
    home_page: homePage,
    home_tiles: homeTiles,
    home_occasions: homeOccasions,
    legal_pages: legalPages,
    legal_sections: legalSections,
  };
}

async function downloadGalleryImage(item) {
  if (!item.image) return null;
  if (typeof item.image === "string" && item.image.startsWith("assets/")) return item.image;

  const fileId = typeof item.image === "string" ? item.image : item.image.id;
  if (!fileId || !directusUrl) return null;

  const fileName = `${slugify(item.title)}-${fileId}.webp`;
  const outputDir = path.join(distDir, "assets", "cms");
  const outputPath = path.join(outputDir, fileName);
  const assetUrl = `${directusUrl}/assets/${fileId}?width=1600&height=1000&fit=cover&format=webp&quality=82`;
  const response = await fetch(assetUrl, {
    headers: directusToken ? { Authorization: `Bearer ${directusToken}` } : {},
  });
  if (!response.ok) throw new Error(`Directus Bild ${fileId}: ${response.status} ${response.statusText}`);

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
  return `assets/cms/${fileName}`;
}

async function downloadHomeImage(image, key, width, height) {
  if (!image) return null;
  if (typeof image === "string" && image.startsWith("assets/")) return image;
  const fileId = typeof image === "string" ? image : image.id;
  if (!/^[0-9a-f-]{36}$/i.test(String(fileId)) || !directusUrl) {
    throw new Error(`Ungültiges Startseitenbild: ${key}`);
  }
  const fileName = `home-${slugify(key)}-${fileId}.webp`;
  const outputDir = path.join(distDir, "assets", "cms");
  const response = await fetch(
    `${directusUrl}/assets/${fileId}?width=${width}&height=${height}&fit=cover&format=webp&quality=82`,
    { headers: directusToken ? { Authorization: `Bearer ${directusToken}` } : {} }
  );
  if (!response.ok) throw new Error(`Directus Startseitenbild ${fileId}: ${response.status} ${response.statusText}`);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, fileName), Buffer.from(await response.arrayBuffer()));
  return `assets/cms/${fileName}`;
}

function validateHome(content) {
  const page = content.home_page;
  const required = [
    "seo_title", "seo_description", "hero_eyebrow", "hero_title", "hero_body", "hero_image_alt",
    "hero_primary_label", "hero_secondary_label", "intro_eyebrow", "intro_title", "intro_body",
    "intro_link_label", "occasions_eyebrow", "occasions_title",
  ];
  for (const field of required) {
    if (!String(page?.[field] || "").trim()) throw new Error(`Startseite: ${field} fehlt.`);
  }
  const destinations = content.home_tiles.map((tile) => tile.destination);
  if (destinations.length !== 3 || new Set(destinations).size !== 3 ||
      !["galerie", "pakete", "blog"].every((target) => destinations.includes(target))) {
    throw new Error("Startseite: genau eine veröffentlichte Kachel für Galerie, Pakete und Blog erforderlich.");
  }
  for (const tile of content.home_tiles) {
    if (!tile.label) throw new Error(`Startseite: Kachel ${tile.destination} ohne Beschriftung.`);
    if (tile.image && !tile.image_alt) throw new Error(`Startseite: Kachel ${tile.destination} ohne Bildbeschreibung.`);
  }
  if (!content.home_occasions.length) throw new Error("Startseite: mindestens ein veröffentlichter Anlass erforderlich.");
  for (const occasion of content.home_occasions) {
    if (!occasion.title || !occasion.description) throw new Error("Startseite: Anlass ohne Titel oder Beschreibung.");
  }
}

function paragraphs(value) {
  return String(value).split(/\n\s*\n/).filter(Boolean).map((part) => `<p>${escapeHtml(part.trim()).replaceAll(/\r?\n/g, "<br>")}</p>`).join("\n        ");
}

function renderLegalPage(page, sections) {
  if (!page.title?.trim() || !page.seo_description?.trim()) {
    throw new Error(`Rechtstext ${page.slug}: Titel oder SEO-Beschreibung fehlt.`);
  }
  const ownSections = sections.filter((section) => section.page === page.slug)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  if (!ownSections.length || ownSections.some((section) => !section.heading?.trim() || !section.body?.trim())) {
    throw new Error(`Rechtstext ${page.slug}: mindestens ein vollstaendiger Abschnitt erforderlich.`);
  }
  return `<p class="eyebrow">Rechtliches</p><h1>${escapeHtml(page.title)}</h1>${ownSections.map((section) =>
    `<h2>${escapeHtml(section.heading)}</h2>${paragraphs(section.body)}`
  ).join("\n        ")}`;
}

async function renderHomeHero(page) {
  const fallbackImage = fallback.home_page.hero_image;
  const image = page.hero_image || fallbackImage;
  const imagePath = await downloadHomeImage(image, "hero", 1800, 1350);
  const reference = imagePath === fallbackImage;
  const imageClass = reference ? ' class="reference-event"' : "";
  return `<section class="hero container">
      <div class="hero-media${reference ? " reference-crop" : ""}"><img${imageClass} src="${escapeHtml(imagePath)}" width="${reference ? 843 : 1800}" height="${reference ? 1600 : 1350}" decoding="async" fetchpriority="high" alt="${escapeHtml(page.hero_image_alt)}"></div>
      <div class="hero-copy"><p class="eyebrow">${escapeHtml(page.hero_eyebrow)}</p><h1>${escapeHtml(page.hero_title)}</h1>${paragraphs(page.hero_body)}<div class="hero-actions"><a class="button primary" href="/kontakt">${escapeHtml(page.hero_primary_label)}</a><a class="button secondary" href="/galerie">${escapeHtml(page.hero_secondary_label)}</a></div></div>
    </section>`;
}

async function renderHomeTiles(tiles) {
  const cards = [];
  const hrefs = { galerie: "/galerie", pakete: "/pakete", blog: "/blog" };
  for (const tile of [...tiles].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))) {
    const fallbackTile = fallback.home_tiles.find((item) => item.destination === tile.destination);
    const image = tile.image || fallbackTile?.image;
    const imagePath = image ? await downloadHomeImage(image, `tile-${tile.destination}`, 1200, 1200) : null;
    const reference = imagePath === fallbackTile?.image && Boolean(fallbackTile?.image_class);
    const classes = ["image-tile", tile.destination === "galerie" ? "wide" : "", tile.destination === "blog" ? "soft" : "", reference ? "reference-crop" : ""].filter(Boolean).join(" ");
    const imageMarkup = imagePath
      ? `<img${reference ? ` class="${escapeHtml(fallbackTile.image_class)}"` : ""} src="${escapeHtml(imagePath)}" width="${reference ? 843 : 1200}" height="${reference ? 1600 : 1200}" loading="lazy" decoding="async" alt="${escapeHtml(tile.image_alt || fallbackTile?.image_alt)}">`
      : "";
    cards.push(`<a class="${classes}" href="${hrefs[tile.destination]}">${imageMarkup}<span>${escapeHtml(tile.label)}</span></a>`);
  }
  return `<section class="home-links container" aria-label="Websitebereiche">${cards.join("\n      ")}</section>`;
}

function renderHomeIntro(page) {
  return `<section class="section container split" aria-labelledby="individuell-title">
      <div><p class="eyebrow">${escapeHtml(page.intro_eyebrow)}</p><h2 id="individuell-title">${escapeHtml(page.intro_title)}</h2></div>
      <div class="section-copy">${paragraphs(page.intro_body)}<p><a class="text-link" href="/pakete">${escapeHtml(page.intro_link_label)}</a></p></div>
    </section>`;
}

function renderHomeOccasions(page, items) {
  const cards = [...items].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((item) => `<div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p></div>`)
    .join("\n          ");
  return `<div class="occasion-band"><section class="section container" aria-labelledby="anlaesse-title">
      <p class="eyebrow">${escapeHtml(page.occasions_eyebrow)}</p><h2 id="anlaesse-title">${escapeHtml(page.occasions_title)}</h2>
      <div class="occasion-grid">${cards}</div>
    </section></div>`;
}

async function renderGallery(items) {
  const cards = [];
  for (const item of [...items].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))) {
    const imagePath = await downloadGalleryImage(item);
    let media;
    if (imagePath && item.image_class) {
      media = `<div class="gallery-card-reference reference-crop"><img class="${escapeHtml(item.image_class)}" src="${escapeHtml(imagePath)}" width="843" height="1600" loading="lazy" decoding="async" alt="${escapeHtml(item.image_alt || item.title)}"></div>`;
    } else if (imagePath) {
      media = `<img class="gallery-card-media" src="${escapeHtml(imagePath)}" width="1600" height="1000" loading="lazy" decoding="async" alt="${escapeHtml(item.image_alt || item.title)}">`;
    } else {
      const swatch = item.swatch_class ? ` ${escapeHtml(item.swatch_class)}` : "";
      media = `<div class="paper-swatch${swatch}" aria-hidden="true"></div>`;
    }
    cards.push(`        <article class="gallery-card" data-category="${escapeHtml(item.category)}">${media}<div class="gallery-card-body"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p></div></article>`);
  }
  return cards.join("\n");
}

function renderPackages(items) {
  return [...items]
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((item) => {
      const features = Array.isArray(item.features) ? item.features : [];
      const className = item.featured ? "package-card featured" : "package-card";
      return `        <article class="${className}"><p class="package-kicker">${escapeHtml(item.kicker)}</p><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><ul>${features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}</ul><a class="text-link" href="/kontakt">${escapeHtml(item.cta_label || "Paket anfragen")}</a></article>`;
    })
    .join("\n");
}

function renderPostCards(posts) {
  return [...posts]
    .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))
    .map(
      (post) =>
        `        <article class="blog-card"><time datetime="${escapeHtml(post.published_at)}">${escapeHtml(formatDate(post.published_at))}</time><h2>${escapeHtml(post.title)}</h2><p>${escapeHtml(post.excerpt)}</p><a class="text-link" href="/blog-${escapeHtml(post.slug)}">Artikel lesen</a></article>`
    )
    .join("\n");
}

function renderSections(sections, excerpt, slug) {
  if (sections == null) return `<p class="lead">${escapeHtml(excerpt)}</p>`;
  if (!Array.isArray(sections) || sections.some((section) => !section || typeof section !== "object" || Array.isArray(section))) {
    throw new Error(`Blog ${slug}: sections muss ein JSON-Array mit Abschnittsobjekten sein.`);
  }
  if (sections.length === 0) return `<p class="lead">${escapeHtml(excerpt)}</p>`;
  return sections
    .map((section) => {
      const parts = [];
      if (section.lead) parts.push(`<p class="lead">${escapeHtml(section.lead)}</p>`);
      if (section.heading) parts.push(`<h2>${escapeHtml(section.heading)}</h2>`);
      for (const paragraph of section.paragraphs ?? []) parts.push(`<p>${escapeHtml(paragraph)}</p>`);
      for (const subsection of section.subsections ?? []) {
        parts.push(`<h3>${escapeHtml(subsection.heading)}</h3><p>${escapeHtml(subsection.paragraph)}</p>`);
      }
      if (section.list?.length) parts.push(`<ul>${section.list.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`);
      if (section.ordered_list?.length) parts.push(`<ol>${section.ordered_list.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`);
      if (section.callout) parts.push(`<div class="article-callout"><p>${escapeHtml(section.callout)}</p></div>`);
      return parts.join("\n        ");
    })
    .join("\n        ");
}

function siteHeader() {
  return `<header class="site-header"><a class="brand" href="/" aria-label="himmelsteil Papeterie Startseite"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="29"></circle><path d="m12 42 14-16 9 10 5-7 12 13"></path><circle cx="47" cy="19" r="2"></circle></svg></span><span>himmelsteil Papeterie</span></a><button class="menu-toggle" type="button" aria-expanded="false" aria-controls="main-nav"><span></span><span></span><span></span><span class="sr-only">Menü öffnen</span></button><nav id="main-nav" class="main-nav" aria-label="Hauptnavigation"><a href="/">Start</a><a href="/galerie">Galerie</a><a href="/pakete">Pakete</a><a href="/blog" aria-current="page">Blog</a><a href="/kontakt">Kontakt</a></nav></header>`;
}

function siteFooter() {
  return `<footer class="site-footer"><div class="site-footer-inner container"><p>© himmelsteil Papeterie 2026</p><div class="footer-links"><a href="/kontakt">Kontakt</a><a href="/impressum">Impressum</a><a href="/datenschutz">Datenschutz</a></div></div></footer>`;
}

function renderPostPage(post) {
  const title = post.meta_title || `${post.title} | himmelsteil`;
  const description = post.meta_description || post.excerpt;
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description,
    datePublished: post.published_at,
    dateModified: post.published_at,
    inLanguage: "de",
    author: { "@type": "Person", name: "Anna Dahlenburg" },
    publisher: { "@type": "Organization", name: "himmelsteil Papeterie" },
  }).replaceAll("<", "\\u003c");

  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}"><meta name="robots" content="index,follow,max-image-preview:large">
  <meta property="og:type" content="article"><meta property="og:locale" content="de_DE"><meta property="og:site_name" content="himmelsteil Papeterie"><meta property="og:title" content="${escapeHtml(post.title)}"><meta property="og:description" content="${escapeHtml(description)}">
  <meta name="twitter:card" content="summary"><link rel="icon" href="favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500;1,600&family=Nunito+Sans:wght@300;400;500;700&display=swap" rel="stylesheet"><link rel="stylesheet" href="styles.css?v=7">
  <script type="application/ld+json">${structuredData}</script>
</head>
<body>
  ${siteHeader()}
  <main class="article-shell"><nav class="breadcrumb" aria-label="Brotkrümelnavigation"><a href="/">Start</a><span aria-hidden="true">/</span><a href="/blog">Blog</a><span aria-hidden="true">/</span><span>${escapeHtml(post.title)}</span></nav><article>
    <header class="article-header"><p class="eyebrow">${escapeHtml(post.category)}</p><h1>${escapeHtml(post.title)}</h1><div class="article-meta"><time datetime="${escapeHtml(post.published_at)}">${escapeHtml(formatDate(post.published_at))}</time><span>Von Anna Dahlenburg</span><span>${escapeHtml(post.reading_minutes || 5)} Minuten Lesezeit</span></div></header>
    <div class="article-body">${renderSections(post.sections, post.excerpt, post.slug)}<div class="article-footer"><a class="button primary" href="/pakete">Pakete ansehen</a><a class="button secondary" href="/kontakt">Projekt anfragen</a></div></div>
  </article></main>
  ${siteFooter()}<script src="script.js?v=3"></script>
</body></html>`;
}

async function replaceBlock(file, key, markup) {
  const filePath = path.join(distDir, file);
  const source = await fs.readFile(filePath, "utf8");
  const pattern = new RegExp(`(<!-- CMS:${key}:START -->)[\\s\\S]*?(\\r?\\n[ \\t]*<!-- CMS:${key}:END -->)`);
  if (!pattern.test(source)) throw new Error(`${file}: CMS-Marker ${key} fehlt`);
  await fs.writeFile(filePath, source.replace(pattern, (_match, start, end) => `${start}\n${markup}${end}`));
}

async function updateHomeSeo(page) {
  const filePath = path.join(distDir, "index.html");
  let html = await fs.readFile(filePath, "utf8");
  const replacements = [
    [/<title>[^<]*<\/title>/, `<title>${escapeHtml(page.seo_title)}</title>`],
    [/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeHtml(page.seo_description)}">`],
    [/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escapeHtml(page.seo_title)}">`],
    [/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escapeHtml(page.seo_description)}">`],
  ];
  for (const [pattern, replacement] of replacements) {
    if (!pattern.test(html)) throw new Error("Startseite: SEO-Metadaten fehlen im Template.");
    html = html.replace(pattern, replacement);
  }
  await fs.writeFile(filePath, html);
}

async function updateLegalSeo(slug, page) {
  const filePath = path.join(distDir, `${slug}.html`);
  let html = await fs.readFile(filePath, "utf8");
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(page.title)} | himmelsteil Papeterie</title>`);
  html = html.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeHtml(page.seo_description)}">`);
  await fs.writeFile(filePath, html);
}

const content = await loadContent();
if (!content.gallery.length || !content.packages.length || !content.posts.length) {
  throw new Error("Mindestens eine CMS-Collection enthält keine veröffentlichten Einträge.");
}
validateHome(content);

await replaceBlock("index.html", "HOME_HERO", await renderHomeHero(content.home_page));
await replaceBlock("index.html", "HOME_TILES", await renderHomeTiles(content.home_tiles));
await replaceBlock("index.html", "HOME_INTRO", renderHomeIntro(content.home_page));
await replaceBlock("index.html", "HOME_OCCASIONS", renderHomeOccasions(content.home_page, content.home_occasions));
await updateHomeSeo(content.home_page);

await replaceBlock("galerie.html", "GALLERY", await renderGallery(content.gallery));
await replaceBlock("pakete.html", "PACKAGES", renderPackages(content.packages));
await replaceBlock("blog.html", "POSTS", renderPostCards(content.posts));

for (const slug of ["impressum", "datenschutz"]) {
  const pages = content.legal_pages.filter((page) => page.slug === slug);
  if (pages.length > 1) throw new Error(`Doppelter Rechtstext: ${slug}`);
  if (!pages.length) continue;
  await replaceBlock(`${slug}.html`, "LEGAL_CONTENT", renderLegalPage(pages[0], content.legal_sections));
  await updateLegalSeo(slug, pages[0]);
}

const galleryPath = path.join(distDir, "galerie.html");
const galleryHtml = await fs.readFile(galleryPath, "utf8");
await fs.writeFile(
  galleryPath,
  galleryHtml.replace(/<p class="sr-only" data-gallery-status aria-live="polite">[^<]*<\/p>/, `<p class="sr-only" data-gallery-status aria-live="polite">${content.gallery.length} Arbeiten werden angezeigt.</p>`)
);

for (const post of content.posts) {
  assertSafePostSlug(post.slug);
  await fs.writeFile(path.join(distDir, `blog-${post.slug}.html`), renderPostPage(post));
}

const publishedPages = new Set(content.posts.map((post) => `blog-${post.slug}.html`));
for (const file of await fs.readdir(distDir)) {
  if (/^blog-[a-z0-9-]+\.html$/.test(file) && !publishedPages.has(file)) {
    await fs.unlink(path.join(distDir, file));
  }
}

console.log(`Startseite, ${content.gallery.length} Galerieeinträge, ${content.packages.length} Pakete und ${content.posts.length} Beiträge gebaut.`);
