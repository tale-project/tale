---
title: Skill-Bibliothek
description: Die Skill-Bibliothek der Organisation — dateibasierte Bundles, die jeder Agent zur Laufzeit liest, privat gehalten oder über ein einziges Feld für alle freigegeben.
---

Ein Skill ist eine Anweisung, die du einmal schreibst und die danach jeder Chat und jeder Agent lesen kann. Er liegt als kleines Bundle im Dateibaum deiner Organisation — eine `SKILL.md` mit der Anweisung im Body, dazu das Referenzmaterial, auf das sich diese Anweisung stützt. Unter **Einstellungen > Skills** legst du solche Bundles an, lädst sie hoch und pflegst sie. Dafür brauchst du Admin- oder Developer-Rechte.

Diese Seite erklärt, was ein Skill ist, aus welcher Datei er besteht, wer ihn zu sehen bekommt und wie du einen anlegst, kopierst und wieder aus dem Verkehr ziehst. Die Agent-Seite steht unter [Agent-Skills](/de/platform/agents/skills) — lies sie, sobald ein bestimmter Agent nach einem bestimmten Bundle greifen soll.

## Was ein Skill ist und was nicht

Ein Skill ist ein **Wissenspaket**. Sein Body ist Anweisung, die ein Modell liest, wenn die Aufgabe danach verlangt: eine hauseigene Schreibstimme, eine Checkliste, an die sich dein Team hält, die Art, wie deine Organisation eine Absage formuliert. Ein Modell findet das Bundle über seine Beschreibung, klappt den Body auf, sobald diese Beschreibung zur Aufgabe passt, und öffnet einzelne Bundle-Dateien dort, wo der Body auf sie verweist.

Ausgeführt wird ein Skill nie. In einem Bundle steckt kein Einstiegspunkt, kein Kommando und keine Laufzeitumgebung — eine Datei unter `scripts/` ist Material, das ein Modell lesen und übernehmen darf, kein Programm, das Tale für dich startet. Genau diese Grenze macht es unbedenklich, ein fremdes Bundle anzunehmen: Du holst dir Prosa und Referenzdateien in die Organisation, nichts, was von sich aus handeln könnte.

## Die Datei SKILL.md

Jedes Bundle hat genau eine `SKILL.md` in seinem Wurzelverzeichnis — einen YAML-Frontmatter-Block und darunter den Anweisungs-Body in Markdown.

```markdown
---
name: release-notes
description: Verwandelt eine Liste zusammengeführter Änderungen in Release Notes in unserer Hausstimme. Nimm ihn, wenn jemand nach einem Changelog, nach Release Notes oder nach einer Zusammenfassung des Auslieferungsstands fragt.
visibility: org
license: CC-BY-4.0
recommended-packages:
  python:
    - markdown-it-py
---

Schreibe Release Notes in drei Abschnitten — Hinzugefügt, Geändert, Behoben —
und beginne jede Zeile mit dem Verb ...
```

Die Schlüssel folgen der Konvention von agentskills.io in Kebab-Case. Jeden Schlüssel, den Tale nicht kennt, behält es unverändert bei — so übersteht ein Bundle, das für ein anderes Werkzeug geschrieben wurde, ein Bearbeiten und Speichern ohne Verlust.

| Schlüssel                  | Was darin steht                                                                                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                     | Der Slug, der dem Ordnernamen des Bundles entsprechen muss — Kleinbuchstaben, Ziffern und einzelne Bindestriche, höchstens 64 Zeichen. `anthropic` und `claude` sind reserviert. |
| `description`              | Bis zu 1024 Zeichen, und das Feld, an dem sich entscheidet, ob ein Modell überhaupt nach dem Skill greift. Sag, was er tut und wann er passt.                                    |
| `visibility`               | `private` oder `org`. Fehlt das Feld, zählt es als `org`.                                                                                                                        |
| `owner`                    | Das Mitglied, dem das Bundle gehört. Bei einem `private` Skill Pflicht, bei einem `org` Skill nur Zuschreibung.                                                                  |
| `license`                  | Freier Text, für ein Bundle, das du importiert hast oder weitergeben willst.                                                                                                     |
| `recommended-packages`     | Python- oder Node-Pakete, die die Autorin vorschlägt. Reine Empfehlung — Tale installiert für einen Skill nie etwas.                                                             |
| `disable-model-invocation` | Steht es auf `true`, darf ein Modell nicht von sich aus nach dem Skill greifen. Wer ihn ausdrücklich aufruft, bekommt ihn trotzdem.                                              |
| `icon` und `labels`        | Eine Iconify-ID und bis zu acht Chips für die Karte des Skills in der Bibliothek.                                                                                                |

Zwei Obergrenzen gelten: Der Frontmatter-Block darf 16 KB umfassen, die ganze `SKILL.md` 512 KB. Bundle-Assets zählen nicht in dieses Budget.

## Wer ihn sehen darf

Das Teilen steckt in einem einzigen Feld, nicht in einer Rechtetabelle. `visibility: private` heißt, dass nur der `owner` des Bundles es in der Bibliothek sieht — deshalb muss ein privater Skill einen benennen. `visibility: org` heißt, dass jedes Mitglied es sieht. Darunter liegt keine weitere Abstufung: Einen Skill zu teilen ist eine Änderung, die `visibility` auf `org` umstellt, und ihn zurückzuholen stellt wieder auf `private`.

<Note>

Ein Bundle ganz ohne `visibility` gilt als Organisations-Skill. Ein unmarkiertes Bundle ist absichtlich im Baum der Organisation gelandet — ein Import aus der Community, eine Kopie eines mitgelieferten Skills —, und als privat behandelt wäre es auf einen Schlag für alle unsichtbar.

</Note>

## Einen Skill in die Bibliothek legen

Öffne **Einstellungen > Skills**. **Skill hinzufügen** bietet dir zwei Startpunkte, daneben liegt **Skill hochladen** für ein Bundle, das du schon hast.

<Steps>

<Step title="Leer starten oder aus einer Vorlage">

**Leer** fragt nur nach einem Namen — dem Slug, aus Kleinbuchstaben, Ziffern und einzelnen Bindestrichen — und setzt dich in ein leeres Bundle. **Aus Vorlage** öffnet **Neuer Skill aus Vorlage**: Du wählst einen der mitgelieferten Skills und bekommst eine Kopie, die dir gehört.

</Step>

<Step title="Oder ein Bundle hochladen">

**Skill hochladen** öffnet **Skill-Bundle hochladen**. Lege eine `.zip` ab, die eine `SKILL.md` im Wurzelverzeichnis enthält, daneben beliebige Ordner `scripts/`, `references/` oder `assets/`. Tale liest den Frontmatter, bevor irgendetwas geschrieben wird, und zeigt dir, was darin steht — Beschreibung, Lizenz, empfohlene Pakete und wie viele zusätzliche Schlüssel es unverändert übernimmt. So gibst du ein Bundle frei, das du tatsächlich gelesen hast. Bei einem Slug, den es schon gibt, wird vorher gefragt, ob ersetzt werden soll.

</Step>

<Step title="Den Body schreiben">

Öffne den Skill und schreib die Anweisung unter **Anweisungen (Body)**. Das ist der Text, den ein Modell liest — formuliere ihn wie ein Briefing für eine Kollegin: wozu der Skill da ist, wann er greift und woran gutes Ergebnis zu erkennen ist.

</Step>

</Steps>

## Kopieren, ersetzen, aussortieren

Im Menü jedes Skills stehen **Details anzeigen**, **Duplizieren** und **Skill löschen**; in der Detailansicht kommt **Bundle ersetzen** dazu.

**Duplizieren** gabelt das Bundle unter einem neuen Slug ab — praktisch, wenn du eine geteilte Fassung abwandeln willst, ohne das Original anzurühren. **Bundle ersetzen** überschreibt den Inhalt an Ort und Stelle und behält den Slug, sodass jeder daran gebundene Agent ab der nächsten Anfrage den neuen Text liest. **Skill löschen** entfernt das Bundle von der Platte; jeder gebundene Agent verliert den Zugriff, und die Bindung greift auf nichts zurück.

<Warning>

Ersetzen und Löschen wirken sofort, und es gibt kein Festschreiben einer Version. Ein gebundener Agent liest ein Bundle immer genau so, wie es gerade dasteht.

</Warning>

## Was im Bundle liegt

Die Detailansicht zeigt **Bundle** — den Dateibaum, wie er auf der Platte liegt — mit einer Vorschau für jede Datei, die du anklickst. Der kleinste brauchbare Skill besteht aus einer einzigen Datei, und die meisten wachsen Ordner für Ordner.

```text
release-notes/
├── SKILL.md
├── references/
│   └── stimme-und-tonfall.md
└── scripts/
    └── group-changes.py
```

Halte die Assets klein und lesbar. Text, den ein Modell günstig öffnen kann, wird auch benutzt; eine große Binärdatei liegt ungelesen herum, und die Vorschau sagt dir offen, dass sie damit nichts anfangen kann. **Letzte Änderungen** in derselben Ansicht ist die Prüfspur des Bundles — wer es hochgeladen, dupliziert, geändert oder gelöscht hat und wann. Dort schaust du zuerst nach, wenn ein Skill sich anders verhält als beim letzten Mal.

## Wo das hingehört

Die Skill-Bibliothek ist die leichteste Form der Wiederverwendung in Tale: eine Datei, ein Feld fürs Teilen und nichts, was zwischen den Leuten abgeglichen werden müsste. Hier hört eine Formulierung auf, etwas zu sein, das du immer wieder abtippst. Liegt das Bundle einmal in der Bibliothek, bleibt nur noch die Frage, welcher Agent danach greifen soll — das steht unter [Agent-Skills](/de/platform/agents/skills), zusammen mit dem Binden, der Obergrenze pro Agent und dem Weg eines Bundles in eine Sandbox.
