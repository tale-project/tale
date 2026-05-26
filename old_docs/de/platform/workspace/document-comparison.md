---
title: Dokumenten-Vergleich
description: Zwei Dokumente nebeneinander vergleichen und ein detailliertes Diff lesen, das Hinzufügungen, Löschungen und Änderungen Absatz für Absatz hervorhebt.
---

Der Dokumenten-Vergleich lässt dich zwei Dokumente hochladen oder auswählen und liest ein Diff auf Absatzebene zwischen den beiden. Nutze ihn, um eine Vertragsrevision gegen die vorherige Fassung zu prüfen, Richtlinien-Updates zwischen jährlichen Aktualisierungen zu verfolgen oder zu verifizieren, dass eine aufgefrischte Vorlage zur Spezifikation passt. Zielgruppe sind Redakteure und Admins, die Dokumente prüfen; Mitglieder mit Lesezugriff auf die Wissensdatenbank können ebenfalls einen Vergleich laufen lassen, wenn ihre Rolle es zulässt.

Das Diff wird im Browser berechnet und gerendert; nichts erreicht die KI, solange ein Agent nicht ausdrücklich gebeten wird, das Ergebnis im Nachgang zusammenzufassen.

## Einen Vergleich starten

Um den Vergleichs-Dialog zu öffnen, navigiere zu **Wissen > Dokumente** und wähle den Vergleichs-Eintrag aus dem Aktionsmenü. Der Dialog fragt nach zwei Dokumenten — die Basis links, der Vergleich rechts:

| Seite  | Label               | Optionen                                              |
| ------ | ------------------- | ----------------------------------------------------- |
| Links  | Basis-Dokument      | Datei hochladen oder ein vorhandenes Dokument wählen. |
| Rechts | Vergleichs-Dokument | Datei hochladen oder ein vorhandenes Dokument wählen. |

Jede Seite hat zwei Tabs. **Hochladen** lässt dich eine Datei vom Gerät ablegen oder über den Dateiauswahl-Dialog suchen. **Vorhanden** sucht und wählt aus Dokumenten, die schon in der Wissensdatenbank liegen. Klicke **Vergleichen**, sobald beide Seiten gefüllt sind; Tale schickt beide Dokumente zur Analyse an den RAG-Dienst, und das Ergebnis erscheint inline.

Die akzeptierten Formate: PDF, DOCX, XLSX, CSV, TXT, PPTX und gängige Bildformate. Alles ausserhalb dieses Satzes wird beim Upload abgelehnt.

## Die Ergebnisse lesen

Die Ergebnisansicht besteht aus zwei Teilen: einer Zusammenfassungsleiste mit Statistiken über das gesamte Diff und einer scrollbaren Liste von Änderungs-Blöcken. Die Zusammenfassung nennt, wie viele Absätze in welcher Kategorie landen:

| Statistik       | Was sie zählt                                                                     |
| --------------- | --------------------------------------------------------------------------------- |
| **Hinzugefügt** | Absätze, die im Vergleichs-Dokument vorhanden sind, aber nicht im Basis-Dokument. |
| **Gelöscht**    | Absätze, die im Basis-Dokument vorhanden sind, aber nicht im Vergleichs-Dokument. |
| **Geändert**    | Absätze, die sich zwischen den Dokumenten geändert haben.                         |
| **Unverändert** | Absätze ohne Unterschiede.                                                        |

Eine **Hohe-Divergenz**-Warnung erscheint oben am Ergebnis, wenn die Dokumente sich stark unterscheiden — nützlich, um einen falschen Versions-Mix vor dem Weiterlesen zu erkennen. Eine **Abschneide-Meldung** erscheint, wenn die Zahl der Änderungen die Anzeigegrenze übersteigt; die fehlenden Blöcke fallen aus dem gerenderten Diff, aber die Zusammenfassung zählt das ganze Dokument.

## Farbcodierung der Änderungs-Blöcke

Jeder Block in der scrollbaren Liste ist nach Art der Änderung farbcodiert:

| Typ         | Farbe | Präfix        | Was er zeigt                                                            |
| ----------- | ----- | ------------- | ----------------------------------------------------------------------- |
| Hinzugefügt | Grün  | `+`           | Neuer Inhalt im Vergleichs-Dokument.                                    |
| Gelöscht    | Rot   | `−`           | Aus dem Basis-Dokument entfernter Inhalt (durchgestrichen dargestellt). |
| Geändert    | Gelb  | `~`           | Geänderter Inhalt mit Inline-Diffs, die einzelne Wörter hervorheben.    |
| Kontext     | Grau  | (Leerzeichen) | Unveränderter umgebender Text als Referenz.                             |

Geänderte Blöcke zeigen Inline-Diffs, wenn die Änderung klein genug ist, um auf Wort-Ebene darstellbar zu sein: gelöschte Teile erscheinen als `[-Text-]`, hinzugefügte als `{+Text+}`. Wenn Inline-Diffs nicht verfügbar sind — typischerweise, weil die Änderung den grössten Teil des Absatzes umgeschrieben hat —, werden alte und neue Fassung auf getrennten Zeilen gerendert.

## Wo das einsetzt

Der Dokumenten-Vergleich ist die zielgerichtete Diff-Oberfläche für die Wissensdatenbank. Er existiert, weil das Prüfen einer Vertragsrevision, eines Richtlinien-Updates oder einer aufgefrischten Vorlage nicht in den Chat passt — das Auge braucht beide Versionen gleichzeitig sichtbar, mit den Änderungen hervorgehoben. Um zwei Versionen desselben Dokuments über die Zeit zu vergleichen, lade jede Version als separate Datei in die [Wissensdatenbank](/de/platform/workspace/knowledge-base) hoch und lass sie gegeneinander vergleichen.

Für eine KI-Zusammenfassung des Diffs kopiere den Vergleichslink in einen Chat und lass den Assistenten die Änderungen durchgehen; der Chat-Agent kann dieselbe RAG-Ausgabe lesen, die der Vergleichs-Dialog rendert.
