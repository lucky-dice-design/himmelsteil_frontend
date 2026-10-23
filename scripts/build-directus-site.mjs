import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const projectRoot = process.cwd();
const distDir = path.join(projectRoot, "dist");
const fallbackPath = path.join(projectRoot, "content", "cms-fallback.json");
const directusUrl = process.env.DIRECTUS_URL?.replace(/\/$/, "");
const directusToken = process.env.DIRECTUS_TOKEN?.trim();
const allowEmptyFallback = process.env.DIRECTUS_FALLBACK_EMPTY === "1";
const channel = process.env.SITE_CHANNEL || "live";
if (!["live", "preview"].includes(channel)) throw new Error("SITE_CHANNEL muss live oder preview sein.");
const visibleStatuses = channel === "preview" ? ["live", "published", "preview"] : ["live", "published"];
const liveStatePath = path.resolve(process.env.CMS_LIVE_STATE_PATH || ".cms-live-state.json");
if (liveStatePath === distDir || liveStatePath.startsWith(`${distDir}${path.sep}`)) {
  throw new Error("Der Live-Zwischenstand darf nicht im oeffentlichen dist-Verzeichnis liegen.");
}
let liveState = {};
if (directusUrl && channel === "live") {
  try { liveState = JSON.parse(await fs.readFile(liveStatePath, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
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
  if (["site_settings", "home_page", "contact_form", "gallery_page", "packages_page", "blog_page"].includes(collection) && [403, 404].includes(response.status)) {
    return new Error(`Directus ${collection} fehlt oder ist fuer den Build nicht lesbar. Zuerst das aktuelle Backend deployen und auf dem VPS 'sudo bash /opt/himmelsteil-cms/setup-website-features.sh' ausfuehren; danach den Frontend-Workflow erneut starten.`);
  }
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
    "filter[status][_in]": visibleStatuses.join(","),
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
  return payload.data.filter((item) => visibleStatuses.includes(item.status));
}

async function readSingleton(collection, fields) {
  const query = new URLSearchParams({ fields: ["status", ...fields].join(",") });
  const response = await fetch(`${directusUrl}/items/${collection}?${query}`, {
    headers: directusToken ? { Authorization: `Bearer ${directusToken}` } : {},
  });
  if (!response.ok) throw await directusError(response, collection);
  const payload = await response.json();
  if (!payload.data || Array.isArray(payload.data)) throw new Error(`Directus ${collection}: ungültige Singleton-Antwort`);
  if (channel === "preview" && visibleStatuses.includes(payload.data.status)) return payload.data;
  if (["live", "published"].includes(payload.data.status)) {
    liveState[collection] = payload.data;
    return payload.data;
  }
  if (channel === "live" && liveState[collection]) return liveState[collection];
  throw new Error(`${collection}: kein Live-Stand vorhanden. Zuerst einmal mit Status Live bauen.`);
}

async function loadContent() {
  if (!directusUrl) {
    console.log("DIRECTUS_URL fehlt: lokaler Fallback-Inhalt wird verwendet.");
    return fallback;
  }

  console.log(`Lade ${channel}-Inhalte aus ${directusUrl}`);
  const [gallery, packages, posts, homePage, homeTiles, homeOccasions, legalPages, legalSections, contactForm, contactOptions, siteSettings, galleryPage, packagesPage, blogPage] = await Promise.all([
    readCollection(
      "gallery_items",
      ["id", "status", "sort", "category", "title", "description", "image.id", "image_alt", "image_copyright", "show_image_copyright", "swatch_class"],
      "sort"
    ),
    readCollection(
      "packages",
      ["id", "status", "sort", "kicker", "title", "description", "features", "cta_label", "featured"],
      "sort"
    ),
    readCollection(
      "posts",
      ["id", "status", "title", "slug", "category", "excerpt", "meta_title", "meta_description", "published_at", "reading_minutes", "sections"],
      "-published_at"
    ),
    readSingleton("home_page", [
      "seo_title", "seo_description", "hero_eyebrow", "hero_title", "hero_body", "hero_image.id",
      "hero_image_alt", "hero_image_copyright", "show_hero_image_copyright", "hero_primary_label", "hero_secondary_label", "intro_eyebrow", "intro_title",
      "intro_body", "intro_link_label", "occasions_eyebrow", "occasions_title", "tiles_label",
    ]),
    readCollection("home_tiles", ["id", "status", "sort", "destination", "label", "image.id", "image_alt", "image_copyright", "show_image_copyright"], "sort"),
    readCollection("home_occasions", ["id", "status", "sort", "title", "description"], "sort"),
    readCollection("legal_pages", ["id", "status", "slug", "title", "seo_description"], "slug"),
    readCollection("legal_sections", ["id", "status", "sort", "page", "heading", "body"], "sort"),
    readSingleton("contact_form", [
      "seo_title", "seo_description", "intro_eyebrow", "intro_title", "intro_body", "intro_image.id",
      "intro_image_alt", "intro_image_copyright", "show_intro_image_copyright", "contact_eyebrow", "contact_title", "contact_body", "contact_details", "contact_email",
      "name_label", "email_label", "occasion_label", "occasion_placeholder", "timeframe_label",
      "timeframe_placeholder", "message_label", "consent_label", "submit_label", "sending_message",
      "success_message", "error_message", "privacy_intro", "privacy_link_label", "noscript_message", "timeout_message",
    ]),
    readCollection("contact_options", ["id", "status", "sort", "label"], "sort"),
    readSingleton("site_settings", Object.keys(fallback.site_settings).map((field) => field === "logo" ? "logo.id" : field)),
    ...["gallery_page", "packages_page", "blog_page"].map((name) => readSingleton(name, Object.keys(fallback[name]).filter((key) => key !== "intro_image_class").map((key) => key === "intro_image" ? "intro_image.id" : key))),
  ]);

  const useFallback = (name, items) => {
    if (items.length || !allowEmptyFallback || channel === "live") return items;
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
    contact_form: contactForm,
    contact_options: contactOptions,
    site_settings: siteSettings,
    gallery_page: galleryPage, packages_page: packagesPage, blog_page: blogPage,
  };
}

function imageExtension(response, bytes) {
  // Directus returns SVG sources unchanged, even when format=webp is requested.
  const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const prefix = bytes.subarray(0, 8192).toString("utf8").replace(/^\uFEFF/, "");
  if (type === "image/svg+xml" || /^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(prefix)) return "svg";
  return ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/avif": "avif" })[type] || "webp";
}

async function downloadGalleryImage(item) {
  if (!item.image) return null;
  if (typeof item.image === "string" && item.image.startsWith("assets/")) return item.image;

  const fileId = typeof item.image === "string" ? item.image : item.image.id;
  if (!fileId || !directusUrl) return null;

  const outputDir = path.join(distDir, "assets", "cms");
  const assetUrl = `${directusUrl}/assets/${fileId}?width=1600&height=1000&fit=cover&format=webp&quality=82`;
  const response = await fetch(assetUrl, {
    headers: directusToken ? { Authorization: `Bearer ${directusToken}` } : {},
  });
  if (!response.ok) throw new Error(`Directus Bild ${fileId}: ${response.status} ${response.statusText}`);

  const bytes = Buffer.from(await response.arrayBuffer());
  const version = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const fileName = `${slugify(item.title || "galerie")}-${fileId}-${version}.${imageExtension(response, bytes)}`;
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, fileName), bytes);
  return `assets/cms/${fileName}`;
}

async function downloadHomeImage(image, key, width, height, fit = "cover") {
  if (!image) return null;
  if (typeof image === "string" && image.startsWith("assets/")) return image;
  const fileId = typeof image === "string" ? image : image.id;
  if (!/^[0-9a-f-]{36}$/i.test(String(fileId)) || !directusUrl) {
    throw new Error(`Ungültiges Startseitenbild: ${key}`);
  }
  const outputDir = path.join(distDir, "assets", "cms");
  const response = await fetch(
    `${directusUrl}/assets/${fileId}?width=${width}&height=${height}&fit=${fit}&format=webp&quality=82`,
    { headers: directusToken ? { Authorization: `Bearer ${directusToken}` } : {} }
  );
  if (!response.ok) throw new Error(`Directus Startseitenbild ${fileId}: ${response.status} ${response.statusText}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const version = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const fileName = `home-${slugify(key)}-${fileId}-${version}.${imageExtension(response, bytes)}`;
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, fileName), bytes);
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
  if (new Set(destinations).size !== destinations.length ||
      destinations.some((target) => !["galerie", "pakete", "blog"].includes(target))) {
    throw new Error("Startseite: Kachelziele muessen eindeutig Galerie, Pakete oder Blog sein.");
  }
  for (const tile of content.home_tiles) {
    if (!tile.label) throw new Error(`Startseite: Kachel ${tile.destination} ohne Beschriftung.`);
    if (tile.image && !tile.image_alt) throw new Error(`Startseite: Kachel ${tile.destination} ohne Bildbeschreibung.`);
  }
  for (const occasion of content.home_occasions) {
    if (!occasion.title || !occasion.description) throw new Error("Startseite: Anlass ohne Titel oder Beschreibung.");
  }
}

function renderGalleryFilters(settings) {
  // A deliberately empty list hides the filter bar.
  const filters = settings.gallery_filters;
  if (!Array.isArray(filters)) throw new Error("Galerie-Filter: Liste erforderlich.");
  const categories = new Set();
  for (const filter of filters) {
    if (!filter || !["all", "hochzeit", "event", "kollektion"].includes(filter.category) || categories.has(filter.category)) {
      throw new Error("Galerie-Filter: Kategorie ungueltig oder doppelt.");
    }
    categories.add(filter.category);
    if (typeof filter.label !== "string" || !filter.label.trim() || typeof filter.enabled !== "boolean") {
      throw new Error("Galerie-Filter: Beschriftung und Sichtbarkeit erforderlich.");
    }
  }
  const buttons = filters.filter((filter) => filter.enabled).map((filter) => {
    const active = filter.category === "all";
    return `<button class="filter${active ? " is-active" : ""}" type="button" data-filter="${filter.category}" aria-pressed="${active}" aria-controls="gallery-grid">${escapeHtml(filter.label)}</button>`;
  }).join("");
  return buttons ? `<div class="filter-bar" aria-label="${escapeHtml(content.gallery_page.filter_label)}">${buttons}</div>` : "";
}

function internalPath(value) {
  if (!/^\/(?!\/)[a-z0-9/-]*(?:#[a-z0-9-]+)?$/.test(value)) throw new Error("Seiteninhalt: interner Link ungueltig.");
  return escapeHtml(value);
}

function validatePage(page, name) {
  for (const key of ["seo_title", "seo_description", "intro_title", "intro_body", "section_title"]) {
    if (!String(page[key] || "").trim()) throw new Error(`${name}: ${key} fehlt.`);
  }
  if (typeof page.show_intro_image !== "boolean") throw new Error(`${name}: Bildsichtbarkeit fehlt.`);
  if (page.show_intro_image && !page.intro_image_alt?.trim()) throw new Error(`${name}: Bildbeschreibung fehlt.`);
}

async function renderPageIntro(page, name) {
  let media = "";
  if (page.show_intro_image) {
    const referenceImage = name === "packages_page" ? "assets/papeterie-event.jpeg" : "assets/papeterie-welcome.jpeg";
    const image = await downloadHomeImage(page.intro_image || referenceImage, name, 1200, 1200);
    const reference = image === referenceImage;
    const imageClass = name === "packages_page" ? "reference-event" : "reference-welcome";
    media = captionedImage(`<div class="page-intro-visual${reference ? " reference-crop" : ""}"><img${reference ? ` class="${imageClass}"` : ""} src="${escapeHtml(image)}" width="${reference ? 843 : 1200}" height="${reference ? 1600 : 1200}" decoding="async" fetchpriority="high" alt="${escapeHtml(page.intro_image_alt)}"></div>`, page, "intro_image");
  }
  return `<section class="page-intro container${page.show_intro_image ? "" : " page-intro-no-image"}"><div><p class="eyebrow">${escapeHtml(page.intro_eyebrow)}</p><h1>${escapeHtml(page.intro_title)}</h1>${paragraphs(page.intro_body)}</div>${media}</section>`;
}

function renderPageHeading(page, id) {
  return `<div class="section-heading"><p class="eyebrow">${escapeHtml(page.section_eyebrow)}</p><h2 id="${id}">${escapeHtml(page.section_title)}</h2>${paragraphs(page.section_body || "")}</div>`;
}

function renderPackageDetails(page) {
  if (!page.show_details) return "";
  if (!page.details_title?.trim() || !page.details_body?.trim() || !page.details_cta_label?.trim()) throw new Error("Pakete: Zusatzabschnitt unvollstaendig.");
  return `<section class="section container split"><div><p class="eyebrow">${escapeHtml(page.details_eyebrow)}</p><h2>${escapeHtml(page.details_title)}</h2></div><div class="section-copy">${paragraphs(page.details_body)}<p><a class="button secondary" href="${internalPath(page.details_cta_href)}">${escapeHtml(page.details_cta_label)}</a></p></div></section>`;
}

function paragraphs(value) {
  return String(value).split(/\n\s*\n/).filter(Boolean).map((part) => `<p>${escapeHtml(part.trim()).replaceAll(/\r?\n/g, "<br>")}</p>`).join("\n        ");
}

function captionedImage(markup, item, prefix = "image", className = "") {
  const text = String(item[`${prefix}_copyright`] || "").trim();
  if (item[`show_${prefix}_copyright`] !== true || !text) return markup;
  return `<figure class="credited-image ${className}">${markup}<figcaption class="image-copyright"><small><i>${escapeHtml(text)}</i></small></figcaption></figure>`;
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
  return `<p class="eyebrow">${escapeHtml(content.site_settings.legal_eyebrow)}</p><h1>${escapeHtml(page.title)}</h1>${ownSections.map((section) =>
    `<h2>${escapeHtml(section.heading)}</h2>${paragraphs(section.body)}`
  ).join("\n        ")}`;
}

function validateContact(page, options) {
  const required = [
    "seo_title", "seo_description", "intro_eyebrow", "intro_title", "intro_body", "intro_image_alt",
    "contact_eyebrow", "contact_title", "contact_body", "contact_details", "contact_email", "name_label",
    "email_label", "occasion_label", "occasion_placeholder", "timeframe_label", "timeframe_placeholder",
    "message_label", "consent_label", "submit_label", "sending_message", "success_message", "error_message",
  ];
  for (const field of required) {
    if (!String(page?.[field] || "").trim()) throw new Error(`Kontaktformular: ${field} fehlt.`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(page.contact_email)) {
    throw new Error("Kontaktformular: ungueltige Kontakt-E-Mail-Adresse.");
  }
  if (!options.length || options.some((option) => !option.label?.trim())) {
    throw new Error("Kontaktformular: mindestens eine vollstaendige Anlassoption erforderlich.");
  }
}

async function renderContactIntro(page) {
  const fallbackImage = fallback.contact_form.intro_image;
  const imagePath = await downloadHomeImage(page.intro_image || fallbackImage, "contact", 1200, 1200);
  const reference = imagePath === fallbackImage;
  return `<div><p class="eyebrow">${escapeHtml(page.intro_eyebrow)}</p><h1>${escapeHtml(page.intro_title)}</h1>${paragraphs(page.intro_body)}</div>
      ${captionedImage(`<div class="page-intro-visual${reference ? " reference-crop" : ""}"><img${reference ? ' class="reference-event"' : ""} src="${escapeHtml(imagePath)}" width="${reference ? 843 : 1200}" height="${reference ? 1600 : 1200}" decoding="async" fetchpriority="high" alt="${escapeHtml(page.intro_image_alt)}"></div>`, page, "intro_image")}`;
}

function renderContactForm(page, options) {
  const optionMarkup = [...options].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((option) => `<option>${escapeHtml(option.label)}</option>`).join("");
  const details = escapeHtml(page.contact_details).replaceAll(/\r?\n/g, "<br>");
  return `<div class="contact-copy"><p class="eyebrow">${escapeHtml(page.contact_eyebrow)}</p><h2 id="kontakt-title">${escapeHtml(page.contact_title)}</h2>${paragraphs(page.contact_body)}<address>${details}<br><br><a href="mailto:${escapeHtml(page.contact_email)}">${escapeHtml(page.contact_email)}</a></address></div>
      <form class="contact-form" action="/api/contact" method="post" data-contact-form data-sending-message="${escapeHtml(page.sending_message)}" data-success-message="${escapeHtml(page.success_message)}" data-error-message="${escapeHtml(page.error_message)}" data-timeout-message="${escapeHtml(page.timeout_message)}">
        <label>${escapeHtml(page.name_label)}<input name="name" autocomplete="name" maxlength="100" required></label>
        <label>${escapeHtml(page.email_label)}<input name="email" type="email" autocomplete="email" maxlength="254" required></label>
        <label>${escapeHtml(page.occasion_label)}<select name="occasion" required><option value="">${escapeHtml(page.occasion_placeholder)}</option>${optionMarkup}</select></label>
        <label>${escapeHtml(page.timeframe_label)}<input name="timeframe" maxlength="100" placeholder="${escapeHtml(page.timeframe_placeholder)}"></label>
        <label>${escapeHtml(page.message_label)}<textarea name="message" rows="6" maxlength="5000" required></textarea></label>
        <div class="form-trap" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
        <label class="consent"><input name="consent" type="checkbox" required><span>${escapeHtml(page.consent_label)} ${escapeHtml(page.privacy_intro)} <a href="/datenschutz">${escapeHtml(page.privacy_link_label)}</a>.</span></label>
        <button class="button primary" type="submit">${escapeHtml(page.submit_label)}</button>
        <p class="form-status" data-form-status role="status" aria-live="polite"></p>
        <noscript><p>${escapeHtml(page.noscript_message)} <a href="mailto:${escapeHtml(page.contact_email)}">${escapeHtml(page.contact_email)}</a>.</p></noscript>
      </form>`;
}

async function renderHomeHero(page) {
  const fallbackImage = fallback.home_page.hero_image;
  const image = page.hero_image || fallbackImage;
  const imagePath = await downloadHomeImage(image, "hero", 1800, 1350, "inside");
  const reference = imagePath === fallbackImage;
  const imageClass = reference ? ' class="reference-event"' : "";
  return `<section class="hero container">
      ${captionedImage(`<div class="hero-media${reference ? " reference-crop" : ""}"><img${imageClass} src="${escapeHtml(imagePath)}" width="${reference ? 843 : 1800}" height="${reference ? 1600 : 1350}" decoding="async" fetchpriority="high" alt="${escapeHtml(page.hero_image_alt)}"></div>`, page, "hero_image")}
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
    const link = `<a class="${classes}" href="${hrefs[tile.destination]}">${imageMarkup}<span>${escapeHtml(tile.label)}</span></a>`;
    cards.push(imagePath ? captionedImage(link, tile) : link);
  }
  return `<section class="home-links container" aria-label="${escapeHtml(content.home_page.tiles_label)}">${cards.join("\n      ")}</section>`;
}

function renderHomeIntro(page) {
  return `<section class="section container split" aria-labelledby="individuell-title">
      <div><p class="eyebrow">${escapeHtml(page.intro_eyebrow)}</p><h2 id="individuell-title">${escapeHtml(page.intro_title)}</h2></div>
      <div class="section-copy">${paragraphs(page.intro_body)}<p><a class="text-link" href="/pakete">${escapeHtml(page.intro_link_label)}</a></p></div>
    </section>`;
}

function renderHomeOccasions(page, items) {
  if (!items.length) return "";
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
      media = `<div class="gallery-card-reference reference-crop"><img class="${escapeHtml(item.image_class)}" src="${escapeHtml(imagePath)}" width="843" height="1600" loading="lazy" decoding="async" alt="${escapeHtml(item.image_alt || item.title || "")}"></div>`;
    } else if (imagePath) {
      media = `<img class="gallery-card-media" src="${escapeHtml(imagePath)}" width="1600" height="1000" loading="lazy" decoding="async" alt="${escapeHtml(item.image_alt || item.title || "")}">`;
    } else {
      const swatch = item.swatch_class ? ` ${escapeHtml(item.swatch_class)}` : "";
      media = `<div class="paper-swatch${swatch}" aria-hidden="true"></div>`;
    }
    const title = String(item.title || "").trim();
    const description = String(item.description || "").trim();
    const body = title || description ? `<div class="gallery-card-body">${title ? `<h3>${escapeHtml(title)}</h3>` : ""}${description ? `<p>${escapeHtml(description)}</p>` : ""}</div>` : "";
    cards.push(`        <article class="gallery-card" data-category="${escapeHtml(item.category)}">${imagePath ? captionedImage(media, item) : media}${body}</article>`);
  }
  return cards.join("\n");
}

function renderPackages(items) {
  return [...items]
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((item) => {
      const features = Array.isArray(item.features) ? item.features : [];
      const className = item.featured ? "package-card featured" : "package-card";
      return `        <article class="${className}"><p class="package-kicker">${escapeHtml(item.kicker)}</p><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><ul>${features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}</ul><a class="text-link" href="/kontakt">${escapeHtml(item.cta_label || content.site_settings.default_package_cta)}</a></article>`;
    })
    .join("\n");
}

function renderPostCards(posts) {
  return [...posts]
    .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))
    .map(
      (post) =>
        `        <article class="blog-card"><time datetime="${escapeHtml(post.published_at)}">${escapeHtml(formatDate(post.published_at))}</time><h2>${escapeHtml(post.title)}</h2><p>${escapeHtml(post.excerpt)}</p><a class="text-link" href="/blog-${escapeHtml(post.slug)}">${escapeHtml(content.blog_page.read_label)}</a></article>`
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

function siteLinks(links, currentPath = "") {
  if (!Array.isArray(links) || !links.length) throw new Error("Website-Einstellungen: mindestens ein Link erforderlich.");
  return links.map((link) => {
    if (!link || !String(link.label || "").trim() ||
        !/^\/(?!\/)[a-z0-9/-]*(?:#[a-z0-9-]+)?$/.test(link.href)) {
      throw new Error("Website-Einstellungen: Link benoetigt eine Beschriftung und einen internen Pfad (z. B. /kontakt).");
    }
    return `<a href="${escapeHtml(link.href)}"${link.href === currentPath ? ' aria-current="page"' : ""}>${escapeHtml(link.label)}</a>`;
  }).join("");
}

function siteLogo() {
  if (siteLogoPath) return `<span class="brand-mark custom-logo"><img src="${escapeHtml(siteLogoPath)}" width="640" height="320" decoding="async" alt="${escapeHtml(content.site_settings.logo_alt || content.site_settings.brand_name)}"></span>`;
  return `<span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="29"></circle><path d="m12 42 14-16 9 10 5-7 12 13"></path><circle cx="47" cy="19" r="2"></circle></svg></span>`;
}

function siteHeader(currentPath = "/blog") {
  const settings = content.site_settings;
  for (const field of ["brand_name", "brand_home_label", "menu_label", "nav_label", "footer_text"]) {
    if (!String(settings?.[field] || "").trim()) throw new Error(`Website-Einstellungen: ${field} fehlt.`);
  }
  return `<header class="site-header"><a class="brand" href="/" aria-label="${escapeHtml(settings.brand_home_label)}">${siteLogo()}<span>${escapeHtml(settings.brand_name)}</span></a><button class="menu-toggle" type="button" aria-expanded="false" aria-controls="main-nav" data-open-label="${escapeHtml(settings.menu_label)}" data-close-label="${escapeHtml(settings.menu_close_label)}"><span></span><span></span><span></span><span class="sr-only">${escapeHtml(settings.menu_label)}</span></button><nav id="main-nav" class="main-nav" aria-label="${escapeHtml(settings.nav_label)}">${siteLinks(settings.header_links, currentPath)}</nav></header>`;
}

function siteFooter() {
  const logo = content.site_settings.show_footer_logo === true ? `<a class="brand footer-brand" href="/" aria-label="${escapeHtml(content.site_settings.brand_home_label)}">${siteLogo()}</a>` : "";
  return `<footer class="site-footer"><div class="site-footer-inner container">${logo}<p>${escapeHtml(content.site_settings.footer_text)}</p><div class="footer-links">${siteLinks(content.site_settings.footer_links)}</div></div></footer>`;
}

function renderPostPage(post) {
  const title = post.meta_title || `${post.title} | ${content.site_settings.brand_name}`;
  const description = post.meta_description || post.excerpt;
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description,
    datePublished: post.published_at,
    dateModified: post.published_at,
    inLanguage: "de",
    author: { "@type": "Person", name: content.site_settings.owner_name },
    publisher: { "@type": "Organization", name: content.site_settings.brand_name },
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
  <main class="article-shell"><nav class="breadcrumb" aria-label="${escapeHtml(content.blog_page.breadcrumb_label)}"><a href="/">${escapeHtml(content.blog_page.home_label)}</a><span aria-hidden="true">/</span><a href="/blog">${escapeHtml(content.blog_page.intro_title)}</a><span aria-hidden="true">/</span><span>${escapeHtml(post.title)}</span></nav><article>
    <header class="article-header"><p class="eyebrow">${escapeHtml(post.category)}</p><h1>${escapeHtml(post.title)}</h1><div class="article-meta"><time datetime="${escapeHtml(post.published_at)}">${escapeHtml(formatDate(post.published_at))}</time><span>${escapeHtml(content.blog_page.author_prefix)} ${escapeHtml(content.site_settings.owner_name)}</span><span>${escapeHtml(post.reading_minutes || 5)} ${escapeHtml(content.blog_page.reading_suffix)}</span></div></header>
    <div class="article-body">${renderSections(post.sections, post.excerpt, post.slug)}<div class="article-footer"><a class="button primary" href="/pakete">${escapeHtml(content.blog_page.packages_cta_label)}</a><a class="button secondary" href="/kontakt">${escapeHtml(content.blog_page.contact_cta_label)}</a></div></div>
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
  html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(page.title)} | ${escapeHtml(content.site_settings.brand_name)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeHtml(page.seo_description)}">`);
  await fs.writeFile(filePath, html);
}

async function updatePageSeo(file, page) {
  const filePath = path.join(distDir, file);
  let html = await fs.readFile(filePath, "utf8");
  html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(page.seo_title)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${escapeHtml(page.seo_description)}">`);
  html = html.replace(/<meta property="og:title" content="[^"]*">/, () => `<meta property="og:title" content="${escapeHtml(page.seo_title)}">`);
  html = html.replace(/<meta property="og:description" content="[^"]*">/, () => `<meta property="og:description" content="${escapeHtml(page.seo_description)}">`);
  await fs.writeFile(filePath, html);
}

const content = await loadContent();
// New text fields remain usable with private snapshots created before this migration.
for (const name of ["site_settings", "home_page", "contact_form"]) {
  content[name] = { ...fallback[name], ...content[name] };
}
for (const name of ["gallery_page", "packages_page", "blog_page"]) validatePage(content[name], name);
validateHome(content);
validateContact(content.contact_form, content.contact_options);
const siteLogoPath = await downloadHomeImage(content.site_settings.logo, "site-logo", 640, 320, "inside");

await replaceBlock("index.html", "HOME_HERO", await renderHomeHero(content.home_page));
await replaceBlock("index.html", "HOME_TILES", await renderHomeTiles(content.home_tiles));
await replaceBlock("index.html", "HOME_INTRO", renderHomeIntro(content.home_page));
await replaceBlock("index.html", "HOME_OCCASIONS", renderHomeOccasions(content.home_page, content.home_occasions));
await updateHomeSeo(content.home_page);
await replaceBlock("kontakt.html", "CONTACT_INTRO", await renderContactIntro(content.contact_form));
await replaceBlock("kontakt.html", "CONTACT_FORM", renderContactForm(content.contact_form, content.contact_options));
await updatePageSeo("kontakt.html", content.contact_form);

for (const [name, file, headingId] of [["gallery_page", "galerie.html", "arbeiten-title"], ["packages_page", "pakete.html", "pakete-title"], ["blog_page", "blog.html", "beitraege-title"]]) {
  await replaceBlock(file, "PAGE_INTRO", await renderPageIntro(content[name], name));
  await replaceBlock(file, "PAGE_HEADING", renderPageHeading(content[name], headingId));
  await updatePageSeo(file, content[name]);
}
await replaceBlock("pakete.html", "PACKAGE_DETAILS", renderPackageDetails(content.packages_page));

await replaceBlock("galerie.html", "GALLERY", await renderGallery(content.gallery));
await replaceBlock("galerie.html", "GALLERY_FILTERS", renderGalleryFilters(content.gallery_page));
await replaceBlock("pakete.html", "PACKAGES", renderPackages(content.packages));
await replaceBlock("blog.html", "POSTS", renderPostCards(content.posts));

for (const slug of ["impressum", "datenschutz"]) {
  const pages = content.legal_pages.filter((page) => page.slug === slug);
  if (pages.length > 1) throw new Error(`Doppelter Rechtstext: ${slug}`);
  const page = pages[0] || { slug, title: slug === "impressum" ? "Impressum" : "Datenschutz", seo_description: "Rechtliche Informationen von himmelsteil Papeterie." };
  await replaceBlock(`${slug}.html`, "LEGAL_CONTENT", pages.length ? renderLegalPage(page, content.legal_sections) : `<h1>${escapeHtml(page.title)}</h1><p>${escapeHtml(content.site_settings.unpublished_message)}</p>`);
  await updateLegalSeo(slug, page);
}

const galleryPath = path.join(distDir, "galerie.html");
const galleryHtml = await fs.readFile(galleryPath, "utf8");
await fs.writeFile(
  galleryPath,
  galleryHtml.replace(/<p class="sr-only" data-gallery-status[^>]*>[^<]*<\/p>/, () => `<p class="sr-only" data-gallery-status data-results-message="${escapeHtml(content.gallery_page.results_message)}" aria-live="polite">${escapeHtml(content.gallery_page.results_message.replaceAll("{count}", String(content.gallery.length)))}</p>`)
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

for (const file of (await fs.readdir(distDir)).filter((name) => name.endsWith(".html"))) {
  const filePath = path.join(distDir, file);
  let html = await fs.readFile(filePath, "utf8");
  const currentPath = file === "index.html" ? "/" : file.startsWith("blog-") ? "/blog" : `/${file.slice(0, -5)}`;
  html = html.replace(/<header class="site-header">[\s\S]*?<\/header>/, () => siteHeader(currentPath));
  html = html.replace(/<footer class="site-footer">[\s\S]*?<\/footer>/, () => siteFooter());
  html = html.replace(/styles\.css\?v=\d+/g, "styles.css?v=11");
  html = html.replace(/script\.js\?v=\d+/g, "script.js?v=4");
  html = html.replace(/<meta property="og:site_name" content="[^"]*">/, () => `<meta property="og:site_name" content="${escapeHtml(content.site_settings.brand_name)}">`);
  if (["index.html", "kontakt.html"].includes(file)) {
    const settings = content.site_settings;
    const schema = { "@context": "https://schema.org", "@type": "LocalBusiness", name: settings.brand_name, description: settings.business_description, email: content.contact_form.contact_email, founder: { "@type": "Person", name: settings.owner_name }, address: { "@type": "PostalAddress", streetAddress: settings.street_address, postalCode: settings.postal_code, addressLocality: settings.city, addressCountry: settings.country } };
    html = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, () => `<script type="application/ld+json">${JSON.stringify(schema).replaceAll("<", "\\u003c")}</script>`);
  }
  html = html.replace(/<meta name="robots" content="[^"]*">/g, `<meta name="robots" content="${channel === "preview" ? "noindex,nofollow,noarchive" : "index,follow,max-image-preview:large"}">`);
  await fs.writeFile(filePath, html);
}

if (directusUrl && channel === "live") await fs.writeFile(liveStatePath, JSON.stringify(liveState));

console.log(`Startseite, ${content.gallery.length} Galerieeinträge, ${content.packages.length} Pakete und ${content.posts.length} Beiträge gebaut.`);
