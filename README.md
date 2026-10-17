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

Neue CMS-Funktionen: Header und Footer werden gemeinsam in `site_settings` bearbeitet.
Ein eigenes Logo kann dort aus dem Ordner `Website` hochgeladen/ausgewählt werden.
Es erscheint im Header und optional über `show_footer_logo` auch im Footer.
Ohne Logo-Datei bleibt das bisherige Symbol sichtbar; `logo_alt` beschreibt das Bild.
Hero-, Kachel-, Galerie- und Kontaktbilder besitzen einen optionalen Copyright-Text
mit einem separaten Schalter. `SITE_CHANNEL=preview` baut Live- und Preview-Inhalte;
der Standard `SITE_CHANNEL=live` baut ausschließlich Live-Inhalte. Entwürfe bleiben
unsichtbar. Die bisherige Kennung `published` wird während der Migration als Live behandelt.

Die notwendige Directus-Migration und Einrichtung der getrennten Veröffentlichung
stehen in `himmelsteil_backend/directus/WEBSITE-FEATURES.md`. Die neue Frontend-Version
erst nach dieser Migration mit Directus bauen. Der öffentliche Caddy-VHost verwendet
ein eigenes Verzeichnis, damit Preview-Inhalte nicht öffentlich ausgeliefert werden.
Der private Live-Zwischenstand `.cms-live-state.json` enthält den letzten Live-Stand
von Startseite, Kontakt und Header/Footer. Bei Preview-Änderungen bleibt dieser
Stand öffentlich erhalten; er gehört nicht in `dist/` oder Git.

- Frontend und Hosting: statische Mehrseiten-Website auf demselben IONOS VPS wie Directus, ausgeliefert von Caddy unter `himmelsteil.de`.
- CMS: selbst gehostetes Directus auf dem IONOS VPS als geschütztes Redaktionssystem für Startseite, Galerie, Pakete, Blog und Rechtstexte.
- Build: `scripts/build-directus-site.mjs` lädt Startseitentexte und veröffentlichte Einträge, erzeugt die Blogseiten und speichert CMS-Bilder lokal im Build-Artefakt.
- Fallback: Ohne Directus-Zugang baut die Website aus `content/cms-fallback.json`.
- Shop später: als getrenntes Modul evaluieren, ohne die CMS-Struktur zu blockieren.

GitHub dient als Versionsverwaltung. Der vorbereitete Actions-Workflow prüft Änderungen und kann nach Einrichtung des VPS-Zugangs automatisch deployen (siehe `deploy/README.md`). Das Frontend wird nicht über GitHub Pages veröffentlicht. Directus wird nur beim Build angesprochen; Besucher erhalten statische Dateien. Die Serverkonfiguration liegt im separaten Repository `himmelsteil_backend`.

Das Kontaktformular sendet über einen kleinen, ausschließlich intern erreichbaren Dienst auf dem VPS. Caddy leitet `/api/contact` weiter; SMTP-Zugangsdaten werden nie an den Browser oder in dieses Repository ausgeliefert.

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

Die GitHub Action in `.github/workflows/deploy.yml` prüft Änderungen. Nach der einmaligen Einrichtung gemäß `deploy/README.md` überträgt sie erfolgreiche Hauptbranch-Releases per SSH in die VPS-Buildquelle und führt den Vorschau-Build aus. Der VPS baut die Vorschau alle fünf Minuten aus veröffentlichten Directus-Inhalten; Frontend-Codeänderungen benötigen eine Aktualisierung der Quellkopie auf dem VPS; nach Aktivierung übernimmt dies der Workflow.

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

## Automatisches VPS-Deployment

Prüfungen und Deployment per GitHub Actions sind unter [deploy/README.md](deploy/README.md) beschrieben. Die einmalige Einrichtung auf GitHub und dem VPS ist vor der Aktivierung erforderlich.
