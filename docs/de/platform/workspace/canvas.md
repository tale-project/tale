---
title: Canvas
description: KI-generierte Artefakte — HTML, Code, SVG, Mermaid-Diagramme und Markdown — in einem Seitenbereich ansehen, bearbeiten und überarbeiten, den die KI über Runden hinweg an Ort und Stelle patchen kann.
---

Canvas ist ein Seitenbereich neben dem Chat zum Ansehen und Bearbeiten KI-generierter **Artefakte**: lauffähiges HTML, SVG-Illustrationen, Mermaid-Diagramme, Markdown-Dokumente oder Code-Snippets. Jedes Artefakt lebt ausserhalb des Nachrichtenstroms und behält über die ganze Konversation eine stabile Identität, sodass die KI es schrittweise überarbeiten kann, statt das ganze Dokument bei jeder Korrektur neu auszugeben. Stell dir ein Marketing-Briefing vor, das die KI entwirft und du zuspitzt, ein Flussdiagramm, das du die KI erweitern lässt, oder ein kleines HTML-Mockup, das drei Feedback-Runden durchläuft — jedes endet mit einem Artefakt, nicht mit drei Nachrichten.

Die Zielgruppe ist jeder im Chat. Es gibt kein Rollen-Gate; wer chatten kann, kann auch die Artefakte öffnen und bearbeiten, die eine Konversation hervorbringt.

## Wie der Artefakt-Lebenszyklus funktioniert

Wenn die KI etwas Lauffähiges oder Überarbeitbares hervorbringen will, ruft sie das `artifact_create`-Tool auf. Das neue Artefakt erscheint als Karte in der **Artefakte**-Leiste über dem Chat, öffnet sich beim ersten Erzeugen automatisch im Canvas-Bereich und streamt seinen Inhalt live in den Bereich, während die KI tippt. Um das Artefakt zu überarbeiten, ruft die KI `artifact_edit` auf dieselbe Identität — kleine Änderungen nutzen `mode: 'patch'` (Suchen-und-Ersetzen-Blöcke); grosse Umschriften nutzen `mode: 'rewrite'`. In beiden Fällen rendert Canvas an Ort und Stelle neu, sodass du nie zurückscrollen musst, um die neueste Version zu finden.

Während die KI schreibt oder patcht, zeigt die Karte einen Spinner und die Canvas-Kopfzeile liest **KI schreibt…** oder **KI bearbeitet…**.

## Unterstützte Artefakt-Typen

Canvas rendert fünf Artefakt-Formen, jede mit eigenem Vorschau- und Quellcode-Editor-Paar:

| Typ          | Vorschau                                  | Bearbeitung               | Hinweise                                           |
| ------------ | ----------------------------------------- | ------------------------- | -------------------------------------------------- |
| **HTML**     | Live-Rendering in einer Sandbox-iframe    | HTML-Quellcode-Editor     | Skripte laufen in einer Sandbox-Umgebung.          |
| **SVG**      | gerenderte Vektor-Grafik                  | SVG-Quellcode-Editor      | Nutzt denselben Renderer wie HTML.                 |
| **Mermaid**  | gerendertes Diagramm                      | Mermaid-DSL-Editor        | Die Mermaid-Library lädt beim ersten Einsatz nach. |
| **Markdown** | formatierter Rich-Text                    | Markdown-Quellcode-Editor | Rendert mit Standard-Markdown-Formatierung.        |
| **Code**     | syntax-hervorgehobene Darstellung (Shiki) | Plain-Text-Editor         | Unterstützt die gängigen Programmiersprachen.      |

## Die Artefakte-Leiste

Ein horizontaler Streifen über dem Chat listet jedes Artefakt im aktuellen Thread. Jede Karte zeigt den Titel, ein Typ-Icon und die aktuelle Revision (`v3`, `v4`, …). Klicke auf eine Karte, um sie in Canvas zu öffnen. Karten bleiben über die Konversation sichtbar, sodass ein Artefakt aus zwölf Nachrichten Abstand nur einen Klick entfernt ist.

## Toolbar-Aktionen

Die Canvas-Kopfzeile trägt die Aktionen, die für das offene Artefakt gelten. **Bearbeiten** schaltet den Bereich in den Quellcode-Editor; klicke **Vorschau** (derselbe Umschalter), um zur gerenderten Ausgabe zurückzukehren. **Änderungen übernehmen** schreibt deine Änderungen als neue Revision fest — der Button erscheint, sobald du etwas geändert hast und die KI gerade nicht schreibt. **Kopieren** kopiert den angezeigten Inhalt in die Zwischenablage. **Herunterladen** speichert den Inhalt als Datei mit passender Endung (`.html`, `.mmd`, `.svg`, `.md` oder die Sprach-Endung für Code). **Vollbild** weitet den Bereich auf den ganzen Viewport; `Esc` oder das Minimieren-Icon bringt ihn auf die angedockte Grösse zurück. **Canvas schliessen** schliesst den Bereich.

## Bearbeiten und Änderungen übernehmen

Um das Artefakt von Hand statt durch die KI zu ändern, klicke auf das Bleistift-Icon — der bestätigte Inhalt lädt in einen Quellcode-Editor. Mach die Änderungen, klicke auf das Auge-Icon für die Vorschau und auf **Änderungen übernehmen**, um sie als neue Revision festzuschreiben. Deine Bearbeitungen werden als `editKind: 'user'` im Verlauf aufgezeichnet, sodass das Revisions-Log des Artefakts zeigt, wer was geändert hat.

Die KI sieht deine bearbeitete Fassung in der nächsten Runde und patcht von dort aus weiter. Das ist die Schleife, um die der Canvas-Bereich gebaut ist — ein schneller, an Ort und Stelle geführter Dialog zwischen dir und der KI auf einem persistenten Dokument.

## Grösse und Layout

Zieh am linken Rand des Canvas-Bereichs, um ihn anzupassen. Der Bereich hat eine Mindestbreite von 320 Pixeln und eine Höchstbreite von 900 Pixeln, sodass die Chat-Spalte nie vom Bildschirm geschoben wird.

## Wo das einsetzt

Canvas ist der Werkstatt-Bereich für KI-generierte Artefakte. Im Chat fragst du; in Canvas nimmt die strukturierte Ausgabe der KI — ein HTML-Mockup, ein Mermaid-Diagramm, ein Markdown-Briefing, ein Code-Snippet — ihre persistente Form an. Ohne Canvas würde jede Revision das ganze Dokument neu in den Chat-Stream emittieren; mit Canvas hat das Artefakt eine stabile Identität, die die KI über Runden hinweg an Ort und Stelle patchen kann.

Um ein Artefakt auszulösen, frag die KI nach etwas, das Canvas rendern kann — ein Chart, ein Diagramm, eine kleine HTML-Seite, ein Markdown-Dokument. Um ein Artefakt selbst zu überarbeiten, öffne den Quellcode-Editor und klicke **Änderungen übernehmen**; die KI nimmt deine Bearbeitungen in der nächsten Runde auf und patcht von dort aus weiter.
