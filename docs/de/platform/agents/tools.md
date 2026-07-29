---
title: Agent-Tools
description: Die Berechtigungen pro Tool, die ein Agent über die Texterzeugung hinaus trägt — die Tool-Kategorien, Web-Zugang als Tool und Connectors und Automatisierungen als Fähigkeiten.
---

Tools sind das, was ein Agent über das Erzeugen von Text hinaus tun kann. Das Modell entscheidet, welches Tool es aus der Liste aufruft, die der Autor des Agents gewährt hat; Tale führt das Tool aus, reicht das Ergebnis zurück, und das Modell macht weiter. Der Tab **Tools** des Agents ist diese Liste — ein durchsuchbarer Katalog mit Schaltern pro Tool, gruppiert in Kategorie-Karten.

<Frame caption="Der Tool-Katalog — eine Karte pro Kategorie, jede mit der Zahl der Tools, die der Agent gewährt bekommen hat.">

![Der Tools-Tab des Agenten-Editors, gescrollt zu den Kategorie-Karten, mit Wissen bei drei von vier angehakten Tools und Dateien bei sieben von sieben, während Konversationen, Diskussionen, Analysen und Aufgaben & Projekte nichts gewährt bekommen haben.](/images/platform/agent-editor-tools.webp)

</Frame>

## Tools einzeln gewähren

Setz den Haken bei einem Tool, und der Agent kann es ab der nächsten Anfrage aufrufen; entfern den Haken, und der Agent vergisst, dass es existiert. **Tools durchsuchen…** filtert den Katalog nach Name oder Kategorie, jede Tool-Zeile trägt eine einzeilige Beschreibung dessen, was sie gewährt, und die Kopf-Checkbox einer Kategorie schaltet die ganze Gruppe auf einmal — der Zähler daneben zeigt, wie viele Tools der Gruppe an sind. Die Kategorien bilden die Oberflächen der Plattform ab: **Kontakte**, **Produkte**, **Lieferanten** und **Websites** stellen Lese- und Update-Tools über strukturierte Datensätze bereit; **Konversationen** lässt den Agent lesen und antworten; **Wissen** deckt Dokumentsuche und Schreiben ab; **Aufgaben & Projekte** enthält die eigene To-do-Liste des Agents; **Automatisierungen** lässt ihn die Automatisierungen der Organisation anlegen und ausführen; **Web** hält die Suche über die Sites, die deine Organisation hinzugefügt hat; **Dateien** deckt die Dateioperationen des Agents ab; **System** hält **Code ausführen**, **Mensch fragen** und die übrigen Laufzeit-Tools. Gewähre die kleinste Menge, die den Job erledigt — jedes aktivierte Tool weitet, was der Agent in deinem Namen lesen oder ändern kann.

**Code ausführen** in der Gruppe **System** ist das weitreichendste dieser Tools: Es führt Python, Node oder bash in der eigenen Sandbox des Chats aus und arbeitet dabei auf den Dateien, die der Chat schon hält, statt in einer leeren Box. Ein Aufruf führt einen Schnipsel direkt aus, führt ein Skript aus, das der Agent unter `/user/code/` abgelegt hat, oder installiert nur Pakete — deklarierte Pakete werden zuerst installiert und bleiben den Rest des Zugs erhalten, und was der Lauf unter `/user/output/` schreibt, erscheint als Datei im Chat. Dateien und Ordner, die du mit `@` anheftest, landen in dieser Sandbox unter `/user/uploads/`, sodass der Code die echten Bytes öffnet statt eines Retrieval-Schnipsels.

<Note>

Ein Agent startet für eine Teilaufgabe von sich aus einen fokussierten **Worker** — das ist kein Tool, das du hier umschaltest. [Agent-Worker](/de/platform/agents/delegation) deckt ab, wann das der richtige Zug ist und wie ein Worker eine begrenzte Teilmenge der Fähigkeiten des Agents erbt.

</Note>

## Web-Zugang ist ein Tool, kein Modus

Die Websuche steht im Katalog wie alles andere. Gewähr sie, und der Agent kann suchen, wenn er es für richtig hält; lass sie aus, und er kann gar nicht suchen. Es gibt keinen eigenen Modus einzustellen und kein automatisches Einspeisen von Ergebnissen in eine Antwort — der Agent greift nach der Suche wie nach jedem anderen Tool. Durchsucht wird das Material, das deine Organisation hinzugefügt hat, und kein offener Crawl; die Quellen verwaltest du also unter [Websites](/de/platform/knowledge/crawling).

## Auch Connectors und Automatisierungen sind Fähigkeiten

Eine angebundene Connector und eine veröffentlichte Automatisierung erreichen den Agenten über dieselbe Liste. Darunter liegt keine zweite Binde-Oberfläche: Nenn die Fähigkeit in der Erlaubnisliste des Agenten, und er kann sie aufrufen, ohne die Connector oder die Automatisierungs-Id selbst zu zitieren. Verbundene [MCP-Server](/de/platform/connectors/mcp-servers) kommen auf demselben Weg, über die Connectors der Organisation.

Eine Automatisierung, die nur ein Ereignis starten kann, wird aufgeführt, ist aber nicht aufrufbar. Der Agent sieht, dass es sie gibt, und wird klar darauf hingewiesen, dass sie läuft, wenn ihr Ereignis eintritt, und nicht auf Zuruf — ein Agent, der die Automatisierungen der Organisation nicht sieht, erfindet Umwege, statt auf die eine zu zeigen, die die Arbeit längst erledigt.

## Wie Tool-Aufrufe erscheinen

Tool-Aufrufe erscheinen im Chat als eingeklappte Karten zwischen der Nachricht des Users und der Antwort. Eine aufgeklappte Karte zeigt den Tool-Namen, die Eingaben, die das Modell ausgegeben hat, und das Ergebnis, das Tale zurückgab. Ein fehlgeschlagener Tool-Aufruf zeigt den Fehler; das Modell versucht es beim nächsten Zug meist mit anderer Form erneut.

## Wann du danach greifst

| Nutze Tools, wenn…                                              | Nutze Wissen, wenn…                                |
| --------------------------------------------------------------- | -------------------------------------------------- |
| Der Agent handeln muss — abfragen, ändern, ausführen, antworten | Der Agent abgerufene Dokumente zitieren muss       |
| Die Daten strukturierte Datensätze oder Live-Systeme sind       | Die Daten hochgeladene oder gecrawlte Inhalte sind |

## Wo das hingehört

Tools weiten, was ein Agent tun kann; sie weiten auch die Vertrauensgrenze, denn der Agent kann jetzt in deinem Namen lesen, schreiben oder aufrufen. Lies diese Seite zusammen mit der [Run-Code-Richtlinie](/de/platform/admin/governance/run-code-policy), wenn der Agent Code ausführen soll. Die Anweisungen des Agents bleiben der Ort der **Richtlinie**; der Tab **Tools** ist der Ort der **Oberfläche**.
