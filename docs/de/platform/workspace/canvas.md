---
title: Canvas
description: KI-generierte Artefakte — HTML, Code, SVG, Mermaid-Diagramme und Markdown — in einem eigenen Seitenbereich ansehen, bearbeiten und überarbeiten, den die KI direkt patchen kann.
---

Canvas ist ein Seitenbereich neben dem Chat zum Ansehen und Bearbeiten KI-generierter **Artefakte** — lauffähiges HTML, SVG-Grafiken, Mermaid-Diagramme, Markdown-Dokumente oder Code-Snippets. Jedes Artefakt liegt außerhalb des Nachrichtenstroms und behält über die gesamte Konversation eine stabile Identität, sodass die KI es schrittweise überarbeiten kann, statt das ganze Dokument bei jeder Korrektur neu auszugeben.

## Lebenszyklus eines Artefakts

Wenn die KI etwas Lauffähiges oder Überarbeitbares erzeugt, ruft sie das Werkzeug `artifact_create` auf. Das neue Artefakt:

- erscheint als Karte in der **Artefakte-Leiste** über dem Chat.
- öffnet sich beim ersten Erstellen automatisch im Canvas-Bereich.
- streamt seinen Inhalt live ins Iframe, während die KI tippt.

Zum Überarbeiten ruft die KI `artifact_edit` für dasselbe Artefakt auf. Kleine Änderungen nutzen `mode: 'patch'` (Suchen-und-Ersetzen-Blöcke); große Umschriften nutzen `mode: 'rewrite'`. In beiden Fällen rendert der Canvas-Bereich an Ort und Stelle neu — kein Zurückscrollen, um die aktuellste Version zu finden.

## Unterstützte Artefakt-Typen

| Typ          | Vorschau                                  | Bearbeitung            | Hinweise                                           |
| ------------ | ----------------------------------------- | ---------------------- | -------------------------------------------------- |
| **HTML**     | Live-Rendering in einem Sandbox-iframe    | HTML-Source-Editor     | Scripts laufen in einer Sandbox.                   |
| **SVG**      | gerenderte Vektor-Grafik                  | SVG-Source-Editor      | nutzt denselben Renderer wie HTML.                 |
| **Mermaid**  | gerendertes Diagramm                      | Mermaid-DSL-Editor     | lädt die Mermaid-Library beim ersten Einsatz nach. |
| **Markdown** | formatierter Rich-Text                    | Markdown-Source-Editor | rendert mit Standard-Markdown-Formatierung.        |
| **Code**     | syntax-hervorgehobene Darstellung (Shiki) | Plain-Text-Editor      | unterstützt alle gängigen Programmiersprachen.     |

## Artefakte-Leiste

Eine horizontale Leiste über dem Chat listet jedes Artefakt im aktuellen Thread. Jede Karte zeigt Titel, Typ-Icon und aktuelle Revision (`v3`, `v4`, …). Klicke auf eine Karte, um sie in Canvas zu öffnen.

Während die KI ein Artefakt schreibt oder patcht, zeigt die Karte einen Spinner und der Canvas-Header **KI schreibt …** oder **KI bearbeitet …**.

## Toolbar-Aktionen

Der Canvas-Header enthält:

- **Bearbeiten / Vorschau**-Umschalter — zwischen Bearbeitung der Quelle und Anzeige der gerenderten Ausgabe wechseln.
- **Änderungen übernehmen** — deine Änderungen als neue Revision speichern. Erscheint nur, wenn du etwas geändert hast und die KI gerade nicht schreibt.
- **Kopieren** — den angezeigten Inhalt in die Zwischenablage kopieren.
- **Herunterladen** — den Inhalt als Datei mit passender Endung herunterladen (`.html`, `.mmd`, `.svg`, `.md` oder die Sprach-Endung für Code).
- **Vollbild** — den Bereich auf den ganzen Viewport ausdehnen. Drücke `Esc` oder klicke auf das Minimieren-Icon zum Verlassen.
- **Canvas schließen** — den Canvas-Bereich schließen.

## Bearbeiten und Anwenden

1. Klicke auf das **Bleistift**-Icon, um in den Bearbeitungsmodus zu wechseln. Der aktuell gespeicherte Inhalt wird in einen Text-Editor geladen.
2. Ändere den Inhalt.
3. Klicke auf das **Auge**-Icon, um das Ergebnis in der Vorschau zu sehen.
4. Klicke auf **Änderungen übernehmen**, um die Änderungen als neue Revision festzuschreiben. Die KI sieht deine bearbeitete Version im nächsten Schritt und kann von dort aus weiter patchen.

Nutzer-Bearbeitungen werden als neue Revision (`editKind: 'user'`) gespeichert, sodass die Artefakt-Historie zeigt, wer was geändert hat.

## Größe ändern

Ziehe am linken Rand des Canvas-Bereichs, um ihn zu verkleinern oder zu vergrößern. Die Mindestbreite beträgt 320 Pixel, die Höchstbreite 900 Pixel.
