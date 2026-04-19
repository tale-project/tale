---
title: Canvas
description: KI-generierten Code, HTML, Diagramme und Markdown in einem eigenen Seitenbereich ansehen, bearbeiten und exportieren.
---

Canvas ist ein Seitenbereich neben dem Chat, der dir einen fokussierten Arbeitsbereich zum Ansehen und Bearbeiten von KI-generierten Inhalten bietet. Statt durch Code-Blöcke in der Konversation zu scrollen, öffnest du sie in Canvas, wo du Syntax-Highlighting, Live-Vorschau, Bearbeitung und Export bekommst.

## Canvas öffnen

Wenn die KI einen Code-Block, ein HTML-Snippet, ein Mermaid-Diagramm oder Markdown erzeugt, erscheint auf dem Block ein Button **Open in Canvas**. Klicke darauf, um den Inhalt im Canvas-Bereich auf der rechten Seite des Chats zu öffnen.

## Unterstützte Inhaltstypen

| Typ          | Vorschau                                  | Bearbeitung            | Hinweise                                           |
| ------------ | ----------------------------------------- | ---------------------- | -------------------------------------------------- |
| **Code**     | syntax-hervorgehobene Darstellung (Shiki) | Plain-Text-Editor      | unterstützt alle gängigen Programmiersprachen.     |
| **HTML**     | Live-Rendering in einem Sandbox-iframe    | HTML-Source-Editor     | Scripts laufen in einer Sandbox.                   |
| **SVG**      | gerenderte Vektor-Grafik                  | SVG-Source-Editor      | nutzt denselben Renderer wie HTML.                 |
| **Mermaid**  | gerendertes Diagramm                      | Mermaid-DSL-Editor     | lädt die Mermaid-Library beim ersten Einsatz nach. |
| **Markdown** | formatierter Rich-Text                    | Markdown-Source-Editor | rendert mit Standard-Markdown-Formatierung.        |

## Toolbar-Aktionen

Der Canvas-Header enthält:

- **Edit / Preview-Umschalter** — zwischen Bearbeitung der Quelle und Anzeige der gerenderten Ausgabe wechseln.
- **Apply** — deine Änderungen in die ursprüngliche Nachricht im Chat zurückschreiben. Erscheint nur, wenn du etwas geändert hast.
- **Copy** — den Inhalt in die Zwischenablage kopieren.
- **Download** — den Inhalt als Datei mit passender Endung herunterladen (`.html`, `.mmd`, `.svg`, `.md` oder die Endung der Code-Datei).
- **Close** — den Canvas-Bereich schließen.

## Bearbeiten und Anwenden

1. Klicke auf das **Bleistift**-Icon, um in den Bearbeitungsmodus zu wechseln.
2. Ändere den Inhalt im Text-Editor.
3. Klicke auf das **Auge**-Icon, um das Ergebnis in der Vorschau zu sehen.
4. Klicke auf **Apply**, um die Änderungen in die Quellnachricht der Konversation zurückzuschreiben.

Der Apply-Button erscheint nur, wenn der Inhalt vom Original abweicht. Ein Bestätigungs-Toast zeigt an, wann Änderungen erfolgreich übernommen wurden.

## Größe ändern

Ziehe am linken Rand des Canvas-Bereichs, um ihn zu verkleinern oder zu vergrößern. Die Mindestbreite beträgt 320 Pixel, die Höchstbreite 900 Pixel.
