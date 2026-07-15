---
title: Canvas-Bereich
description: Wann der Canvas-Bereich öffnet, was einen Canvas statt einer Inline-Darstellung bekommt, und wie der Canvas-Inhalt über Besuche hinweg beim Chat bleibt.
---

Der **Canvas** ist ein zweiter Bereich, der rechts vom Chat-Thread öffnet. Er erscheint, wenn die Antwort Inhalt enthält, den der lineare Thread schlecht halten kann — ein langer Codeblock, ein Mermaid-Diagramm, ein strukturiertes Dokument, ein ausführbares Python-Skript. Inline-Antworten bleiben kurz und lesbar; alles andere zieht aus dem Weg.

Der Canvas ist kein reichhaltigerer Chat und kein Ort, an dem du von Hand bearbeitest. Er ist eine lebendige Ansicht des Chat-Workspace — die Dateien, die der Agent schreibt, die Dateien, die du hochlädst, und die Dateien, die Code-Läufe erzeugen — und du siehst sie, ohne fragen zu müssen.

## Was der Canvas ist

Der Canvas öffnet automatisch, sobald eine Antwort zum ersten Mal canvas-würdigen Inhalt produziert. Er hat zwei Teile: links einen Dateibaum, rechts einen Betrachter. Der Baum gruppiert die Workspace-Dateien des Chats nach ihrer Herkunft — **KI-Dateien**, die der Agent geschrieben hat (`/user/code`), **Hochgeladen** für Dateien, die du angehängt oder mit `@` angeheftet hast (`/user/uploads`), und **Code-Ausgabe** für das, was ein Lauf erzeugt hat (`/user/output`); leere Gruppen bleiben ausgeblendet. Wähl eine Datei, und sie öffnet im Betrachter, wo du zwischen **Quelltext** und **Vorschau** wechselst, um rohen Code zu lesen oder das gerenderte Ergebnis zu sehen, und **Herunterladen** genau diese Datei speichert.

## Wann er automatisch öffnet

Der Canvas öffnet für mehrere Render-Arten, die den Inline-Thread überfüllen würden: **Code** (jede Sprache), **HTML**, **Mermaid**-Diagramme, **SVG**, lange **Markdown**-Dokumente aus der Hand des Agents und ausführbare Skripte — **Python (Sandbox)**, **Node (Sandbox)**, **Skript (Sandbox)**. `run_code` läuft über den geteilten Workspace des Chats — es liest die Skripte, die der Agent unter `/user/code` geschrieben hat, und erntet, was der Lauf in `/user/output` ablegt, sodass Resultate als **Code-Ausgabe**-Zeilen im Dateibaum erscheinen statt nur neben dem Skript; ein Lauf kann auch bloß Pakete als eigenen Schritt installieren und zeigt dabei **Abhängigkeiten installieren**. Nur vom Agent geschriebene Dateien und Code-Ausgaben öffnen den Canvas automatisch — Dateien, die du hochlädst, erscheinen im Baum, reißen aber nicht den Bildschirm an sich. Kurze Snippets, die der Inline-Thread halten kann, lösen den Canvas nicht aus — ein Skript mit zwanzig Zeilen rendert inline mit eigenem **Kopieren**-Knopf, wie unten.

<Frame caption="Ein kurzes Skript bleibt inline — der Canvas ist für Ausgaben, die dem Thread entwachsen.">

![Eine Chat-Antwort zeigt einen syntaxhervorgehobenen Python-Codeblock, der inline mit einem Kopieren-Knopf gerendert wird, ohne dass sich der Canvas-Bereich öffnet.](/images/platform/chat-code-reply.webp)

</Frame>

## Im Canvas bearbeiten

Der Canvas ist eine Render-Oberfläche für das, was der Agent produziert hat. Den gerenderten Inhalt zu bearbeiten heißt, den Agent um eine Revision zu bitten — eine Folgenachricht im Thread („setz den Timeout auf 30 Sekunden", „mach das Diagramm horizontal") löst eine neue Generierung aus, die den Canvas-Inhalt ersetzt. Einen Direkt-Bearbeiten-Modus gibt es nicht; der Agent besitzt die Dateien, die er schreibt, und die Dateien, die du hochlädst, bleiben genau so, wie du sie gesendet hast.

## Persistenz über den Chat hinweg

Der Canvas-Inhalt gehört zum Chat, nicht zu einer separaten Datei. Den Chat später wieder zu öffnen öffnet den Canvas mit dem letzten Inhalt; zu einem anderen Chat zu wechseln schließt den Canvas-Bereich, bis dieser Chat eigenen Canvas-Inhalt produziert oder trägt. Den Chat mit **Chat teilen** zu teilen trägt den Canvas mit hinüber — Betrachter sehen denselben Wechsel zwischen Quelltext und Vorschau, im Lesemodus.

## Wo das hineinpasst

Der Canvas ist die Antwort auf „was passiert, wenn die Antwort zu groß für den Thread ist". Er komponiert mit allem anderen im Chat — Agents, Anhängen, Sprache, geteilten Chats — ohne dass diese Features von ihm wissen müssten. Die nächste Lektüre, die manchmal zählt: [Ein eigenes Tool bauen](/de/tutorials/developer/build-a-custom-tool) führt auf einer frischen Instanz einen Agent von Anfang bis Ende durch, der ausführbares Python im Canvas produziert.
