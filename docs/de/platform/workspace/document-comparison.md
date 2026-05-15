---
title: Dokumenten-Vergleich
description: Zwei Dokumente nebeneinander vergleichen, um Hinzufügungen, Löschungen und Änderungen zu sehen.
---

Mit dem Dokumenten-Vergleich lädst du zwei Dokumente hoch oder wählst sie aus und siehst ein detailliertes Diff ihres Inhalts. Nutze ihn, um Vertragsrevisionen zu prüfen, Richtlinienänderungen nachzuhalten oder Dokument-Updates zu verifizieren.

## Einen Vergleich starten

1. Navigiere zu **Wissen > Dokumente**.
2. Öffne den Vergleichs-Dialog aus dem Aktionsmenü.
3. Wähle zwei Dokumente:

| Seite  | Label               | Optionen                                             |
| ------ | ------------------- | ---------------------------------------------------- |
| Links  | Basis-Dokument      | Datei hochladen oder vorhandenes Dokument auswählen. |
| Rechts | Vergleichs-Dokument | Datei hochladen oder vorhandenes Dokument auswählen. |

Jede Seite hat zwei Tabs:

- **Hochladen** — per Drag-and-drop oder Auswählen eine Datei vom Gerät hochladen.
- **Vorhanden** — aus Dokumenten in deiner Wissensdatenbank suchen und wählen.

4. Klicke auf **Vergleichen**. Die Plattform schickt beide Dokumente zur Analyse an den RAG-Dienst.

### Unterstützte Dateitypen

PDF, DOCX, XLSX, CSV, TXT, PPTX und gängige Bildformate.

## Die Ergebnisse lesen

Die Vergleichsergebnisse zeigen eine Summary-Leiste und eine Liste von Änderungs-Blöcken.

### Zusammenfassungsstatistik

| Kennzahl        | Beschreibung                                                                      |
| --------------- | --------------------------------------------------------------------------------- |
| **Hinzugefügt** | Absätze, die im Vergleichs-Dokument vorhanden sind, aber nicht im Basis-Dokument. |
| **Gelöscht**    | Absätze, die im Basis-Dokument vorhanden sind, aber nicht im Vergleichs-Dokument. |
| **Geändert**    | Absätze, die sich zwischen den Dokumenten geändert haben.                         |
| **Unverändert** | Absätze ohne Unterschiede.                                                        |

Eine **Hohe-Divergenz**-Warnung erscheint, wenn sich die Dokumente sehr stark unterscheiden. Eine **Abschneide-Meldung** erscheint, wenn die Anzahl der Änderungen die Anzeigegrenze überschreitet.

### Änderungstypen

Jeder Änderungsblock ist farbcodiert:

| Typ         | Farbe | Präfix        | Beschreibung                                                            |
| ----------- | ----- | ------------- | ----------------------------------------------------------------------- |
| Hinzugefügt | Grün  | `+`           | Neuer Inhalt im Vergleichs-Dokument.                                    |
| Gelöscht    | Rot   | `−`           | Aus dem Basis-Dokument entfernter Inhalt (durchgestrichen dargestellt). |
| Geändert    | Gelb  | `~`           | Geänderter Inhalt mit Inline-Diffs, die einzelne Wörter hervorheben.    |
| Kontext     | Grau  | (Leerzeichen) | Unveränderter umgebender Text als Referenz.                             |

Geänderte Blöcke zeigen Inline-Diffs, wenn möglich: gelöschte Teile erscheinen als `[-Text-]` und hinzugefügte als `{+Text+}`. Wenn Inline-Diffs nicht möglich sind, werden alte und neue Version auf getrennten Zeilen angezeigt.

## Wo das einsetzt

Der Dokumentenvergleich ist die zielgerichtete Diff-Oberfläche für die Wissensdatenbank. Er existiert, weil das Review einer Vertragsrevision, eines Richtlinien-Updates oder einer aufgefrischten Vorlage nicht in den Chat passt — das Auge braucht beide Versionen gleichzeitig sichtbar, mit den Änderungen hervorgehoben. Der Diff wird im Browser berechnet und gerendert; nichts geht zusätzlich an die KI, ausser der Chat-Agent wird explizit gebeten, den Diff zusammenzufassen.

Um zwei Versionen desselben Dokuments über die Zeit zu vergleichen, lade jede Version als separate Datei in die [Wissensdatenbank](/de/platform/workspace/knowledge-base) hoch und führ einen Vergleich zwischen ihnen aus.
