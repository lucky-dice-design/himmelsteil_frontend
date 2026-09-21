# himmelsteil Papeterie Website

Statische Mehrseiten-Website für eine Design- und Papeterie-Marke mit Fokus auf Hochzeit, Events, Pakete, Galerie, Blog und Kontakt.

## Seiten

- `dist/index.html`: Startseite
- `dist/galerie.html`: filterbare Galerie
- `dist/pakete.html`: kombinierte Papeterie-Angebote
- `dist/blog.html`: Blogübersicht
- `dist/blog-*.html`: eigenständige, indexierbare Blogartikel
- `dist/kontakt.html`: Kontakt und Anfrageformular
- `dist/impressum.html` und `dist/datenschutz.html`: vorbereitete Rechtstexte, die vor Veröffentlichung geprüft werden müssen

## Architektur

- Frontend und Hosting: statische Mehrseiten-Website auf demselben IONOS VPS wie Directus, ausgeliefert von Caddy unter `himmelsteil.de`.
- CMS: selbst gehostetes Directus auf dem IONOS VPS als geschütztes Redaktionssystem für Galerie, Pakete und Blog.
- Build: `scripts/build-directus-site.mjs` lädt nur veröffentlichte Inhalte, erzeugt die Blogseiten und speichert CMS-Bilder lokal im Build-Artefakt.
- Fallback: Ohne Directus-Zugang baut die Website aus `content/cms-fallback.json`.
- Shop später: als getrenntes Modul evaluieren, ohne die CMS-Struktur zu blockieren.

GitHub dient als Versionsverwaltung und führt nur die Build-Prüfung aus. Das Frontend wird nicht über GitHub Pages veröffentlicht. Directus wird nur beim Build angesprochen; Besucher erhalten statische Dateien. Die Serverkonfiguration liegt im separaten Repository `himmelsteil_backend`.

Das Datenmodell und die VPS-Einrichtung sind im separaten Repository `himmelsteil_backend` dokumentiert. Ein automatischer Veröffentlichungs-Flow ist noch nicht eingerichtet.

## SEO und KI-Crawler

- `dist/robots.txt` erlaubt normale Suchmaschinen und `OAI-SearchBot`, blockiert aber `GPTBot` für mögliches Modelltraining.
- Hauptseiten besitzen eindeutige Titel, Meta Descriptions, Social-Metadaten und ein Favicon.
- Start- und Kontaktseite enthalten strukturierte `LocalBusiness`-Daten.
- Blogartikel enthalten strukturierte `BlogPosting`-Daten sowie Autor und Veröffentlichungsdatum.

### Nach Festlegung der Domain

1. Auf jeder indexierbaren Seite eine absolute Canonical URL ergänzen.
2. `og:url` und ein absolutes `og:image` im Format 1200 x 630 Pixel ergänzen.
3. `dist/sitemap.xml` mit allen öffentlichen URLs erstellen.
4. Die Sitemap als absolute URL in `dist/robots.txt` eintragen.
5. Website bei Google Search Console und Bing Webmaster Tools anmelden.
6. Formular von `mailto:` auf einen Formdienst oder ein eigenes Backend umstellen.
7. Referenz-Screenshots durch zugeschnittene WebP- oder AVIF-Fotodateien ersetzen.

## Deployment auf dem VPS

Die GitHub Action in `.github/workflows/check.yml` prüft nur den Build. Sie veröffentlicht nichts. Das Frontend kann zunächst mit Fallback-Inhalten gebaut und später mit dem eingeschränkten Directus-Build-Token verbunden werden.

Die Schritte zum Bereitstellen der statischen Dateien und zur DNS-Umstellung stehen im Backend-Repository unter `server/directus/README.md`. Die Hauptdomain erst nach Prüfung von Inhalt, Bildrechten, Impressum und Datenschutz umstellen.

## Lokale Vorschau

Die Website ist rein statisch. Jeder einfache Webserver im Projektordner reicht, zum Beispiel:

```bash
python -m http.server 4173 --directory dist
```

## Lokale Qualitätsprüfung

```bash
npm run build
```

Der Build verwendet ohne gesetzte Umgebungsvariablen die lokalen Fallback-Inhalte. Der anschließende Prüfer kontrolliert Seitentitel, Meta Descriptions, H1-Struktur, JSON-LD, Bildattribute und interne Dateiverweise.
