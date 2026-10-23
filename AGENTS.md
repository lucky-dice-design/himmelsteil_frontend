# Arbeitsweise für dieses Projekt

- Für jede neue Änderung bzw. Aufgabe einen neuen Branch mit Präfix `codex/`
  anlegen; bereits verwendete oder gemergte Aufgabenbranches nicht wiederverwenden.
- Vor dem Anlegen `git fetch origin` ausführen und den neuen Branch auf dem
  aktuellen `origin/main` aufsetzen. Vor Abschluss erneut abrufen und eigene
  offene Commits bei Bedarf auf `origin/main` rebasen. Fremde Änderungen erhalten;
  gemeinsam genutzte Remote-Historie nicht ohne ausdrücklichen Auftrag umschreiben.

- Nutzerpräferenz: Nach abgeschlossenen und geprüften Änderungen passende lokale
  Commits erstellen und den Push vorbereiten. Im Abschluss Commit-IDs, Branches
  und Push-Befehle nennen.
- Frontend und das separate Git-Repository `himmelsteil_backend` berücksichtigen.
  Änderungen je Repository gezielt aufnehmen; fremde oder bereits vorhandene
  unversionierte Dateien nicht ohne Bezug zur Aufgabe mitcommitten.
- „Push vorbereiten“ umfasst lokale Commits und die Vorbereitung der Befehle.
  Einen tatsächlichen Push nur bei entsprechendem Auftrag im Gespräch ausführen.
- Vor einem Push auf `main` die bestehende automatische VPS-Veröffentlichung und
  gegebenenfalls erforderliche Directus-Migrationen berücksichtigen.
