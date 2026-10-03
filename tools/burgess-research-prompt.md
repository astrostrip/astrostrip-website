# Vorlage: Agenten-Auftrag für die Burgess-Recherche eines Zeichens

Angelegt am 30.09.2026 für Löwe bis Fische (Voraussetzung der Website-Gradtexte, danach `degree-text-prompt.md`).
Platzhalter: `<ZEICHEN>` (deutsch, z. B. Löwe), `<zeichen>` (Dateiname ohne Umlaut, z. B. loewe), `<sign>` (englisch klein, z. B. leo), `<Sign>` (Leo).
Nach dem Lauf selbst prüfen: 30 `### <ZEICHEN> N`-Abschnitte, jeder mit Kern/Schatten/Weg/Lichtseite; Rohbericht-Tabelle 30 Zeilen; eine Stichprobe gegen die Originalseite.

---

Du recherchierst für astro.strip (Sandra, psychologische Astrologie). Arbeitsverzeichnis: /Users/sandrawilluweit/Documents/Claude Gehirn. **Arbeite selbst, starte KEINE Unteragenten.**

AUFTRAG: Alle 30 Sabian-Grade <ZEICHEN> nach James Burgess nachschlagen und **genau analog zur Krebs-Recherche** ablegen, in zwei neuen Dateien:
1. `reference/sabian-<zeichen>-burgess.md` — ausführliche deutsche Fassung, **gleicher Aufbau wie `reference/sabian-krebs-burgess.md`** (Kopf mit Quelle/Datum, „Wie dieses Dokument zu lesen ist", Bogen des Zeichens mit Gruppentabelle, je Gruppe Stufentabelle, je Grad: Leitthema · Kernphrase · Stichworte · **Kern · Schatten · Weg · Volle Lichtseite** · Rudhyar; danach Life Journey rückwärts, Schatten auf einen Blick, Was davon für astro.strip taugt, Grenzen dieser Datei). Den Abschnitt „Grad aus dem Geburtsdatum" weglassen.
2. `reference/rohberichte/sabian-burgess/<zeichen>-30-grade-2026-09-30.md` — Belegdatei, **gleicher Aufbau wie `reference/rohberichte/sabian-burgess/krebs-30-grade-2026-09-30.md`** (Tabelle mit Symbol, Leitthema, Kernphrase, Stichwort wörtlich englisch; Kern in eigenen Worten; Klischee-Spalte gegen das gängige <ZEICHEN>-Bild).

ZUERST LESEN (vollständig): `reference/sabian-krebs-burgess.md` und den Krebs-Rohbericht als Muster; in `reference/sabian-symbole-burgess.md` die Abschnitte 2, 4, 5, 6 und 8. Dort in Abschnitt 10 stehen schon einzelne <ZEICHEN>-Grade — zum Abgleich nutzen, die Seiten trotzdem selbst lesen.

WEG: Slugs aus `tools/astrology/sabian-360.json` (Schlüssel „<ZEICHEN>", Felder `symbole` und `slugs`). Seiten per `curl -s https://www.jamesburgess.com/<slug>.html`, HTML zu Text reduzieren (z. B. mit python3), **jede der 30 Seiten ganz lesen**. Zeichen-Studie: `https://www.jamesburgess.com/<sign>-sabian-symbols.html` (Gruppen, Bogen, Life Journey). Führt ein Slug ins Leere: über `/<sign>-sabians.html` den richtigen Link suchen. Scheitert ein Zugriff, zuerst den eigenen Zugriff verdächtigen (Slug, Schreibweise), nicht die Quelle.

REGELN:
- Eigene Worte, keine Abschrift (Urheberrecht). Wörtlich nur, was auch die Krebs-Datei wörtlich führt: Symbol, Leitthema, Kernphrase, Stichwort.
- Burgess' spirituellen/esoterischen Ton nicht übernehmen, den psychologischen Kern schon. Die Zuordnung Kern/Schatten/Weg/Lichtseite ist deine Destillation — so kennzeichnen wie in der Krebs-Datei.
- Nichts erfinden. Wo eine Seite dünn ist, das beim Grad offen sagen („Seite knapp, …").
- Aussagen über Rasse oder Nation, falls ein Grad sie enthält, nur neutral als Quelleninhalt vermerken, nicht als Deutung übernehmen.
- Kein Heil-Wording in den Deutungsteilen (Heilung, Therapie, Trauma).
- **Keine bestehende Datei ändern**, auch nicht `reference/sabian-symbole-burgess.md` (andere Sessions schreiben dort). Nur die zwei neuen Dateien anlegen.
- **Datei früh anlegen und nach je fünf Graden erweitern**, damit bei einem Abbruch nichts verloren geht.

ABSCHLUSS: Zähle die `### <ZEICHEN> N`-Abschnitte (müssen 30 sein) und die Tabellenzeilen im Rohbericht (30).

ANTWORT (kurz, max. 120 Wörter): beide Dateien geschrieben ja/nein, Anzahl Grade, Liste der Grade mit dünner Quelle, nicht erreichbare Seiten.
