---
title: Canvas-Bereich
description: Wann der Canvas-Bereich öffnet, was einen Canvas statt einer Inline-Darstellung bekommt, und wie der Canvas-Inhalt beim Chat bleibt zwischen den Besuchen.
---

Der **Canvas** ist ein zweiter Bereich, der rechts vom Chat-Thread öffnet. Er erscheint, wenn die Antwort Inhalt enthält, den der lineare Thread schlecht halten kann — ein langer Codeblock, ein Mermaid-Diagramm, ein strukturiertes Dokument, ein ausführbares Python-Skript. Inline-Antworten bleiben kurz und lesbar; alles andere zieht aus dem Weg.

Der Canvas ist kein separater Dokumentbereich und kein reichhaltigerer Composer. Er ist ein Render-Ziel — der Agent entscheidet anhand der Form seiner Ausgabe, was dort hingeht, und der User sieht es, ohne fragen zu müssen.

## Was der Canvas ist

Der Canvas öffnet automatisch beim ersten Mal, wenn eine Antwort canvas-würdigen Inhalt produziert. Der Thread behält einen kurzen Verweis („Source", „Preview") an der Stelle der Konversation, wo der Canvas-Inhalt erzeugt wurde; der rechte Bereich hält den eigentlichen Inhalt. Wechsle oben im Canvas zwischen **Source** und **Preview**, um rohen Code zu lesen oder das gerenderte Ergebnis zu sehen; **Download** speichert den aktuellen Canvas-Inhalt in eine Datei.

## Wann er automatisch öffnet

Der Canvas öffnet für mehrere Render-Arten, die der Inline-Thread überfüllen würde: **Code** (jede Sprache), **HTML**, **Mermaid**-Diagramme, **SVG**, lange **Markdown**-Dokumente, die der Agent produziert hat, und ausführbare Skripte — **Python (sandbox)**, **Node (sandbox)**, **Script (sandbox)**. Run-Code-Ausgaben landen im Canvas neben dem Skript, sodass ein einzelner Bereich Code und Resultat zeigt. Kurze Snippets, die der Inline-Thread halten kann, lösen den Canvas nicht aus — die Schwelle ist grob, aber über die Arten hinweg konsistent.

## Im Canvas bearbeiten

Der Canvas ist eine Render-Oberfläche für das, was der Agent produziert hat. Den gerenderten Inhalt zu bearbeiten heisst, den Agent um eine Revision zu bitten — eine Folgennachricht im Thread („setz den Timeout auf 30 Sekunden", „mach das Diagramm horizontal") löst eine neue Generierung aus, die den Canvas-Inhalt ersetzt. Es gibt keinen Direkt-Bearbeiten-Modus; der Agent besitzt, was im Canvas ist.

## Persistenz über den Chat hinweg

Der Canvas-Inhalt gehört zum Chat, nicht zu einer separaten Datei. Den Chat später wieder zu öffnen, öffnet den Canvas mit dem letzten Inhalt; zu einem anderen Chat zu wechseln schliesst den Canvas, bis dieser Chat eigenen Canvas-Inhalt produziert oder trägt. Den Chat mit **Chat teilen** zu teilen, trägt den Canvas mit über — der Betrachter sieht denselben Source-/Preview-Wechsel, im Lesemodus.

## Wo das hineinpasst

Der Canvas ist die Antwort auf „was passiert, wenn die Antwort zu gross für den Thread ist". Er komponiert mit allem anderen im Chat — Agents, Anhänge, Sprache, geteilte Chats — ohne dass diese Features davon wissen müssten. Die nächste manchmal relevante Lektüre: [Ein eigenes Tool bauen](/de/tutorials/developer/build-a-custom-tool) führt einen Agent von Anfang bis Ende durch, der ausführbares Python im Canvas produziert.
