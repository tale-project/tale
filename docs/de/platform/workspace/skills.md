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

Öffne **Einstellungen > Skills**. **Skill hinzufügen** fragt nach einem Namen — dem Slug, aus Kleinbuchstaben, Ziffern und einzelnen Bindestrichen — und einer Beschreibung, und setzt dich auf die Seite des neuen Bundles. Schreib die Anweisung unter **Anweisungen (Body)**: Das ist der Text, den ein Modell liest — formuliere ihn wie ein Briefing für eine Kollegin: wozu der Skill da ist, wann er greift und woran gutes Ergebnis zu erkennen ist.

Bundles kommen auch an, ohne dass hier jemand tippt: Ein als Zip hochgeladenes Automatisierungs-Paket installiert die Skills, die es mitbringt, direkt in diese Bibliothek — mit einer Bestätigung vor jedem bestehenden Skill, den es ersetzen würde. Dieser Weg — und wie ein Paket seine Skills deklariert — steht auf [Automatisierungen in deine Organisation bringen](/de/platform/automations/catalog).

## Ersetzen und aussortieren

Den Inhalt eines Bundles ersetzt derselbe Paket-Upload: Ein mitgebrachter Skill, dessen Slug es schon gibt, fragt nach Bestätigung, tauscht dann das ganze Bundle und behält die abgelöste `SKILL.md` im Verlauf des Skills. **Löschen** auf der Seite des Skills entfernt das Bundle von der Platte; jeder gebundene Agent verliert den Zugriff, und die Bindung greift auf nichts zurück.

<Warning>

Ersetzen und Löschen wirken sofort, und es gibt kein Festschreiben einer Version. Ein gebundener Agent liest ein Bundle immer genau so, wie es gerade dasteht.

</Warning>

## Was im Bundle liegt

Die Seite des Skills zeigt **Bundle** — den Dateibaum, wie er auf der Platte liegt, mit der `SKILL.md` oben angepinnt — und jede angeklickte Datei öffnet sich schreibgeschützt neben dem Baum: Code mit Syntax-Hervorhebung, Markdown gerendert, und ein klarer Hinweis bei einem Bild oder einer Binärdatei, die der Browser nicht anzeigen kann. Die `SKILL.md` selbst bringt das Bearbeitungsformular zurück. Der kleinste brauchbare Skill besteht aus einer einzigen Datei, und die meisten wachsen Ordner für Ordner.

```text
release-notes/
├── SKILL.md
├── references/
│   └── stimme-und-tonfall.md
└── scripts/
    └── group-changes.py
```

<Frame caption="Die Seite eines Skills — links der Dateibaum des Bundles, rechts die gewählte Datei schreibgeschützt.">

![Die Detailseite eines Skills mit dem Dateibaum des Bundles, der SKILL.md oben angepinnt, und einer Script-Datei im schreibgeschützten Viewer.](/images/platform/skills-bundle-tree.webp)

</Frame>

Halte die Assets klein und lesbar. Text, den ein Modell günstig öffnen kann, wird auch benutzt; eine große Binärdatei liegt ungelesen herum, und die Vorschau sagt dir offen, dass sie damit nichts anfangen kann.

## Wo das hingehört

Die Skill-Bibliothek ist die leichteste Form der Wiederverwendung in Tale: eine Datei, ein Feld fürs Teilen und nichts, was zwischen den Leuten abgeglichen werden müsste. Hier hört eine Formulierung auf, etwas zu sein, das du immer wieder abtippst. Liegt das Bundle einmal in der Bibliothek, bleibt nur noch die Frage, welcher Agent danach greifen soll — das steht unter [Agent-Skills](/de/platform/agents/skills), zusammen mit dem Binden, der Obergrenze pro Agent und dem Weg eines Bundles in eine Sandbox.
