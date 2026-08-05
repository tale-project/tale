---
title: Skill-Bibliothek
description: Die Seite Einstellungen > Skills — dateibasierte Bundles, die deine Agenten lesen, von jedem Mitglied erstellt und mit Teams oder organisationsweit geteilt.
---

Ein Skill ist eine Anweisung, die du einmal schreibst und die danach jeder Agent lesen kann. Er liegt als kleines Bundle im Dateibaum deiner Organisation — eine `SKILL.md` mit der Anweisung im Body, dazu das Referenzmaterial, auf das sich diese Anweisung stützt. Unter **Einstellungen > Skills** legst du solche Bundles an, lädst sie hoch und pflegst sie. Jedes Mitglied kann Skills erstellen; was du bearbeiten darfst, entscheidet sich pro Bundle.

Diese Seite erklärt, was ein Skill ist, aus welcher Datei er besteht, wer ihn zu sehen bekommt und wie du einen anlegst und wieder aus dem Verkehr ziehst. Die Agent-Seite steht unter [Skills auf Agenten](/de/platform/agents/skills) — lies sie, sobald ein bestimmter Agent nach einem bestimmten Bundle greifen soll.

## Was ein Skill ist und was nicht

Ein Skill ist ein **Wissenspaket**. Sein Body ist eine Anweisung, die ein Modell liest, wenn die Arbeit danach verlangt: eine Hausstimme fürs Schreiben, eine Checkliste deines Teams, die Art, wie deine Organisation eine Absage formuliert. Ein Modell findet das Bundle über seine Beschreibung, liest den Body, wenn diese Beschreibung zur Aufgabe passt, und öffnet einzelne Bundle-Dateien, wenn der Body auf sie verweist.

Ein Skill ist nie etwas, das die Plattform ausführt. Ein Bundle hat keinen Einstiegspunkt, kein Kommando und keine Laufzeit — eine Datei unter `scripts/` ist Material, das ein Modell lesen und anpassen darf, kein Programm, das Tale für dich startet. Genau diese Grenze macht ein Bundle von außen annehmbar: Wer den Skill einer anderen Person importiert, holt sich Prosa und Referenzdateien ins Haus — und nichts, das von allein handeln kann.

## Die Datei SKILL.md

Jedes Bundle hat genau eine `SKILL.md` an seiner Wurzel — ein YAML-Frontmatter, dann der Anweisungs-Body in Markdown.

```markdown
---
name: release-notes
description: Verwandle eine Liste gemergter Änderungen in Release Notes in unserer Hausstimme. Nutze das, wenn jemand nach einem Changelog, Release Notes oder einer Zusammenfassung fragt.
visibility: team
teams:
  - jx7d…
license: CC-BY-4.0
---

Schreibe Release Notes als drei Abschnitte — Added, Changed, Fixed — und
beginne jede Zeile mit dem Verb...
```

Die Schlüssel folgen der agentskills.io-Konvention in Kebab-Case, und jeden Schlüssel, den Tale nicht kennt, bewahrt es unverändert — ein Bundle, das für ein anderes Tool geschrieben wurde, übersteht Bearbeiten und Speichern unversehrt.

| Schlüssel                  | Was er trägt                                                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                     | Der Slug, der dem Ordnernamen des Bundles entsprechen muss — Kleinbuchstaben, Ziffern und einzelne Bindestriche, höchstens 64 Zeichen. `anthropic` und `claude` sind reserviert. |
| `description`              | Bis zu 1024 Zeichen — das Feld, das entscheidet, ob ein Modell überhaupt zum Skill greift. Sag, was er tut und wann er passt.                                                    |
| `visibility`               | `team` oder `org`. Fehlt der Eintrag, gilt `org`. `private` ist ausgemustert — ein Bundle, das es schon trägt, wird weiter gelesen, aber kein neuer Skill bekommt es.            |
| `teams`                    | Die Team-IDs, mit denen ein `team`-Skill geteilt ist — dort Pflicht, sonst abgelehnt. Die Sichtbarkeits-Auswahl der Bibliothek füllt das Feld für dich.                          |
| `owner`                    | Das Mitglied, dem das Bundle gehört — bei einem geteilten Skill reine Zuschreibung, bei einem alten `private`-Skill Pflicht.                                                     |
| `license`                  | Freitext, für ein Bundle, das du importiert hast oder weitergeben willst.                                                                                                        |
| `recommended-packages`     | Python- oder Node-Pakete, die der Autor empfiehlt. Nur ein Hinweis — Tale installiert nie etwas im Namen eines Skills.                                                           |
| `disable-model-invocation` | Auf `true` gesetzt, darf ein Modell nicht von sich aus zum Skill greifen. Für einen expliziten Abruf bleibt er verfügbar.                                                        |
| `icon` und `labels`        | Eine Iconify-ID und bis zu acht Chips für die Karte des Skills in der Bibliothek.                                                                                                |

Zwei Obergrenzen gelten: Das Frontmatter darf 16 KB erreichen, die ganze `SKILL.md` 512 KB. Bundle-Assets zählen nicht in dieses Budget.

## Wer ihn sieht

Freigabe ist ein Feld, keine Berechtigungstabelle. `visibility: team` teilt das Bundle mit den Teams unter `teams`; du wählst sie im Abschnitt **Sichtbarkeit** der Bibliothek. `visibility: org` heißt: Jedes Mitglied sieht ihn, und die Agenten jedes Projekts können ihn ausrüsten. Jedes Mitglied darf einen Skill team- oder organisationsweit teilen; den geteilten Skill einer anderen Person bearbeitet oder löscht nur ein Org-Admin. Ein Bundle ganz ohne `visibility` — auch eines, das du hochlädst — zählt als Organisations-Skill, und die Upload-Vorschau sagt dir das, bevor du bestätigst.

<Note>

`visibility: private` ist ausgemustert. Agenten sind die einzige Oberfläche, die Skills ausrüstet, und die Agenten eines Projekts sehen nie das private Bundle eines einzelnen Mitglieds — ein privater Skill wäre also nur für dich sichtbar und nirgends nutzbar. Ein Bundle, das den Eintrag schon trägt, funktioniert für seinen Inhaber weiter (selbst ein Admin liest es nicht), und der Inhaber kann die Freigabe jederzeit erweitern; neue Skills und Uploads, die `private` deklarieren, werden abgelehnt.

</Note>

Schränkst du die Freigabe eines Skills ein — von Organisation auf Team, oder ein Team fällt weg — bestätigst du das zuerst: Wer den Skill aus dem Blick verliert, verliert ihn auch in jedem Agenten, der ihn über diese Person ausgerüstet hat.

## Einen Skill anlegen

Öffne **Einstellungen > Skills**. Die Seite ist eine Tabelle aller Skills, die du sehen darfst — Name, Beschreibung, Sichtbarkeit und Labels — mit einer Suche über Name, Beschreibung und Labels und Filtern für Sichtbarkeit und Label. Ein Klick auf eine Zeile öffnet das Bundle. **Skill hinzufügen** bietet drei Startpunkte.

<Steps>

<Step title="Leer starten">

**Leerer Skill** fragt nach einem Namen — dem Slug aus Kleinbuchstaben, Ziffern und einzelnen Bindestrichen — dazu Beschreibung und Freigabe, und einem Anweisungs-Body, den du direkt schreibst. Neue Skills starten organisationsweit geteilt; grenze die Freigabe auf Teams ein, wo das Wissen ihnen gehört.

</Step>

<Step title="Oder ein Bundle hochladen">

**Zip hochladen** nimmt ein `.zip` mit `SKILL.md` an der Wurzel, daneben Ordner wie `scripts/`, `references/` oder `assets/`; **Ordner hochladen** nimmt den Ordner selbst und zippt ihn für dich. In beiden Fällen liest Tale das Frontmatter, bevor irgendetwas geschrieben wird, und zeigt dir den Fund — die Beschreibung, die Freigabe, mit der das Bundle landet, die Lizenz und die vollständige Dateiliste mit Größen. Du bestätigst also ein Bundle, das du wirklich gesehen hast. Existiert der Slug schon, fragt Tale zuerst, ob du ersetzen willst.

</Step>

<Step title="Den Body schreiben">

Öffne den Skill und schreibe die Anweisung unter **Anweisungen (Body)**. Diesen Text liest das Modell — schreib ihn so, wie du eine Kollegin briefen würdest: wofür der Skill da ist, wann er gilt und wie ein gutes Ergebnis aussieht.

</Step>

</Steps>

## Was im Bundle liegt

Die Detailansicht eines Skills zeigt **Bundle** — den Dateibaum, wie er auf der Festplatte liegt — mit einem Viewer für jede Datei, die du anklickst. Der kleinste nützliche Skill ist eine einzelne Datei; die meisten wachsen Ordner für Ordner.

```text
release-notes/
├── SKILL.md
├── references/
│   └── voice-and-tone.md
└── scripts/
    └── group-changes.py
```

Halte die Assets klein und lesbar. Text, den ein Modell günstig öffnen kann, wird genutzt; ein großes Binary bleibt ungelesen liegen, und der Viewer sagt offen, dass er es nicht anzeigen kann.

## Einen Skill ausmustern

**Skill löschen** in der Detailansicht entfernt das Bundle von der Festplatte; jeder Agent, der es ausgerüstet hat, verliert den Zugriff — ersatzlos. Versionen lassen sich nicht festnageln: Ein Skill wird immer genau so gelesen, wie er jetzt dasteht. Genau das macht ihn wertvoll — eine Änderung erreicht alle, die ihn halten.

## Wo das hingehört

Die Skill-Bibliothek ist die leichteste Wiederverwendung, die Tale bietet: eine Datei, ein Feld für die Freigabe, nichts, das du über mehrere Köpfe hinweg synchron halten musst. Hier hört eine Formulierung, die du ständig neu tippst, auf, etwas zu sein, das du neu tippst. Liegt ein Bundle erst in der Bibliothek, bleibt die Frage, welche Agenten es bekommen — das ist [Skills auf Agenten](/de/platform/agents/skills): das Ausrüsten der Agenten eines Projekts und der Weg eines Bundles in die Sandbox.
