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
- CMS: selbst gehostetes Directus auf dem IONOS VPS als geschütztes Redaktionssystem für Startseite, Galerie, Pakete, Blog und Rechtstexte.
- Build: `scripts/build-directus-site.mjs` lädt Startseitentexte und veröffentlichte Einträge, erzeugt die Blogseiten und speichert CMS-Bilder lokal im Build-Artefakt.
- Fallback: Ohne Directus-Zugang baut die Website aus `content/cms-fallback.json`.
- Shop später: als getrenntes Modul evaluieren, ohne die CMS-Struktur zu blockieren.

GitHub dient als Versionsverwaltung und führt nur die Build-Prüfung aus. Das Frontend wird nicht über GitHub Pages veröffentlicht. Directus wird nur beim Build angesprochen; Besucher erhalten statische Dateien. Die Serverkonfiguration liegt im separaten Repository `himmelsteil_backend`.

Das Datenmodell und die VPS-Einrichtung sind im separaten Repository `himmelsteil_backend` dokumentiert. Die Startseite nutzt dort `home_page`, `home_tiles` und `home_occasions`; Linkziele und Layout bleiben im Frontend fest. Der Cron-basierte Vorschau-Build liegt unter `himmelsteil_backend/server/preview/`; er wird auf dem VPS eingerichtet und veröffentlicht nur die geschützte Vorschau.

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

Die GitHub Action in `.github/workflows/check.yml` prüft nur den Build. Sie veröffentlicht nichts. Der VPS baut die Vorschau alle fünf Minuten aus veröffentlichten Directus-Inhalten; Frontend-Codeänderungen benötigen weiterhin eine Aktualisierung der Quellkopie auf dem VPS.

Die Schritte zum Bereitstellen der statischen Dateien und zur DNS-Umstellung stehen im Backend-Repository unter `server/directus/README.md`. URL-Umschreibung und VPS-Härtung sind dort unter `server/security/README.md` beschrieben. Die Hauptdomain erst nach Prüfung von Inhalt, Bildrechten, Impressum und Datenschutz umstellen.

## Lokale Vorschau

Die Website ist rein statisch, verwendet aber extensionlose Links. Die vollständige Navigation deshalb über die Caddy-Vorschau auf dem VPS testen. Ein einfacher lokaler Dateiserver ohne Rewrite-Regeln liefert `/galerie` nicht aus:

```bash
python -m http.server 4173 --directory dist
```

## Lokale Qualitätsprüfung

```bash
npm run build
```

Der Build verwendet ohne gesetzte Umgebungsvariablen die lokalen Fallback-Inhalte. Der anschließende Prüfer kontrolliert Seitentitel, Meta Descriptions, H1-Struktur, JSON-LD, Bildattribute und interne Dateiverweise.

Solange Galerie, Pakete oder Blog im CMS noch keine veroeffentlichten Eintraege haben, kann `DIRECTUS_FALLBACK_EMPTY=1` fuer einen Directus-Build gesetzt werden. Nur leere dieser drei Collections erhalten dann lokale Fallback-Inhalte; die Startseite muss aus Directus kommen. Nach der Inhaltsmigration diese Uebergangsvariable entfernen, damit fehlende Inhalte den Build sichtbar stoppen.
