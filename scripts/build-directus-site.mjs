import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const distDir = path.join(projectRoot, "dist");
const fallbackPath = path.join(projectRoot, "content", "cms-fallback.json");
const directusUrl = process.env.DIRECTUS_URL?.replace(/\/$/, "");
const directusToken = process.env.DIRECTUS_TOKEN;

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
    throw new Error(`Directus ${collection}: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload.data)) throw new Error(`Directus ${collection}: ungültige Antwort`);
  return payload.data;
}

async function loadContent() {
  if (!directusUrl) {
    console.log("DIRECTUS_URL fehlt: lokaler Fallback-Inhalt wird verwendet.");
    return JSON.parse(await fs.readFile(fallbackPath, "utf8"));
  }

  console.log(`Lade veröffentlichte Inhalte aus ${directusUrl}`);
  const [gallery, packages, posts] = await Promise.all([
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
  ]);

  return { gallery, packages, posts };
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
      return `        <article class="${className}"><p class="package-kicker">${escapeHtml(item.kicker)}</p><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><ul>${features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}</ul><a class="text-link" href="kontakt.html">${escapeHtml(item.cta_label || "Paket anfragen")}</a></article>`;
    })
    .join("\n");
}

function renderPostCards(posts) {
  return [...posts]
    .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))
    .map(
      (post) =>
        `        <article class="blog-card"><time datetime="${escapeHtml(post.published_at)}">${escapeHtml(formatDate(post.published_at))}</time><h2>${escapeHtml(post.title)}</h2><p>${escapeHtml(post.excerpt)}</p><a class="text-link" href="blog-${escapeHtml(post.slug)}.html">Artikel lesen</a></article>`
    )
    .join("\n");
}

function renderSections(sections = []) {
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
  return `<header class="site-header"><a class="brand" href="index.html" aria-label="himmelsteil Papeterie Startseite"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="29"></circle><path d="m12 42 14-16 9 10 5-7 12 13"></path><circle cx="47" cy="19" r="2"></circle></svg></span><span>himmelsteil Papeterie</span></a><button class="menu-toggle" type="button" aria-expanded="false" aria-controls="main-nav"><span></span><span></span><span></span><span class="sr-only">Menü öffnen</span></button><nav id="main-nav" class="main-nav" aria-label="Hauptnavigation"><a href="index.html">Start</a><a href="galerie.html">Galerie</a><a href="pakete.html">Pakete</a><a href="blog.html" aria-current="page">Blog</a><a href="kontakt.html">Kontakt</a></nav></header>`;
}

function siteFooter() {
  return `<footer class="site-footer"><div class="site-footer-inner container"><p>© himmelsteil Papeterie 2026</p><div class="footer-links"><a href="kontakt.html">Kontakt</a><a href="impressum.html">Impressum</a><a href="datenschutz.html">Datenschutz</a></div></div></footer>`;
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
  <main class="article-shell"><nav class="breadcrumb" aria-label="Brotkrümelnavigation"><a href="index.html">Start</a><span aria-hidden="true">/</span><a href="blog.html">Blog</a><span aria-hidden="true">/</span><span>${escapeHtml(post.title)}</span></nav><article>
    <header class="article-header"><p class="eyebrow">${escapeHtml(post.category)}</p><h1>${escapeHtml(post.title)}</h1><div class="article-meta"><time datetime="${escapeHtml(post.published_at)}">${escapeHtml(formatDate(post.published_at))}</time><span>Von Anna Dahlenburg</span><span>${escapeHtml(post.reading_minutes || 5)} Minuten Lesezeit</span></div></header>
    <div class="article-body">${renderSections(post.sections)}<div class="article-footer"><a class="button primary" href="pakete.html">Pakete ansehen</a><a class="button secondary" href="kontakt.html">Projekt anfragen</a></div></div>
  </article></main>
  ${siteFooter()}<script src="script.js?v=3"></script>
</body></html>`;
}

async function replaceBlock(file, key, markup) {
  const filePath = path.join(distDir, file);
  const source = await fs.readFile(filePath, "utf8");
  const pattern = new RegExp(`(<!-- CMS:${key}:START -->)[\\s\\S]*?(<!-- CMS:${key}:END -->)`);
  if (!pattern.test(source)) throw new Error(`${file}: CMS-Marker ${key} fehlt`);
  await fs.writeFile(filePath, source.replace(pattern, `$1\n${markup}\n        $2`));
}

const content = await loadContent();
if (!content.gallery.length || !content.packages.length || !content.posts.length) {
  throw new Error("Mindestens eine CMS-Collection enthält keine veröffentlichten Einträge.");
}

await replaceBlock("galerie.html", "GALLERY", await renderGallery(content.gallery));
await replaceBlock("pakete.html", "PACKAGES", renderPackages(content.packages));
await replaceBlock("blog.html", "POSTS", renderPostCards(content.posts));

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

console.log(`${content.gallery.length} Galerieeinträge, ${content.packages.length} Pakete und ${content.posts.length} Beiträge gebaut.`);
