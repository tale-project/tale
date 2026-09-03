---
title: Agent-Tools
description: Einen Tools-Tab pro Agent gibt es in dieser Version nicht — der Chat-Assistent trägt einen festen, rein lesenden Tool-Satz, und Projekt-Agenten rüstest du in ihrem eigenen Dialog aus.
---

Diese Seite hat früher den Tab **Tools** des Agenten-Editors beschrieben: einen Katalog aus Schaltern pro Tool, gruppiert in Kategorie-Karten, darunter Websuche, **Code ausführen** und verbundene MCP-Server. Diesen Tab gibt es in dieser Version von Tale nicht. Was ein Agent kann, entscheidet sich an zwei anderen Stellen — in einem festen Tool-Satz für den Chat-Assistenten und in der Ausrüstung, die du einem Projekt-Agenten beim Anlegen gibst.

<Note>

Der Tool-Katalog pro Agent ist in dieser Version nicht verfügbar. Der Chat trägt drei Lese-Tools, und kein Schalter fügt ein viertes hinzu; Projekt-Agenten rüstest du auf dem Tab **Agenten** des Projekts aus.

</Note>

## Was Agenten heute können

Der **Chat-Assistent** hat genau drei Tools, bewusst festgelegt: `rag_search` durchsucht das Wissen der Organisation, `rag_fetch` lädt den vollen Inhalt eines Treffers, und `web_fetch` holt eine öffentliche Seite. Der Chat ist für Fragen und Recherche da; er erzeugt keine Dateien und führt keinen Code aus — ein Ergebnis wie ein Dokument, eine Tabelle oder eine übersetzte Datei entsteht stattdessen auf einer Aufgabe.

Ein **Projekt-Agent** wird in seinem Dialog unter **Skills, Connectors & Tools** ausgerüstet: Skills legen Referenz-Bundles in seine Sandbox, Connectors vermitteln einen verbundenen Dienst, und Plattform-Tools lassen ihn die Aufgaben, Kontakte, Produkte, Dokumente und das Wissen der Organisation lesen — und, wenn du ein Schreib-Tool gewährst, ändern —, begrenzt auf sein Projekt. **Secrets** geben ihm einen API-Schlüssel als Umgebungsvariable für einen Dienst ohne Connector. Er läuft in einer isolierten Sandbox mit Shell; Code auszuführen gehört also zum Harness, nicht zu einem Schalter. [Projekt-Agenten](/de/platform/projects/project-agents) führt durch den Dialog.

Eine **Automatisierung** erreicht dieselben Connectors über ihre Knoten und läuft auf einen Trigger statt auf Zuruf — [Automatisierungskonzepte](/de/platform/automations/concepts) ist das Modell. Externe MCP-Server werden in dieser Version nicht angebunden; die einzige MCP-Oberfläche ist der [eingehende Endpoint](/de/develop/mcp-endpoint), über den Clients außerhalb von Tale es steuern.

## Der abgelöste Editor

Wer das frühere Handbuch kennt, erinnert sich an den Tools-Tab unten. Er steht hier nur, damit die Änderung erkennbar bleibt — kein Bildschirm dieser Version zeigt ihn, und nichts darauf lässt sich umschalten.

<Frame caption="Der Tools-Tab des früheren Agenten-Editors — ein Bildschirm, den diese Version nicht ausliefert.">

![Der Tools-Tab des Agenten-Editors, gescrollt zu den Kategorie-Karten, mit Wissen bei drei von vier angehakten Tools und Dateien bei sieben von sieben, während Konversationen, Diskussionen, Analysen und Aufgaben & Projekte nichts gewährt bekommen haben.](/images/platform/agent-editor-tools.webp)

</Frame>

## Wo das hingehört

Tools folgen der Spur: Der Chat recherchiert, ein Projekt-Agent handelt in seinem Projekt mit der Ausrüstung, die du ihm gegeben hast, und eine Automatisierung handelt auf einen Trigger. Lies [Projekt-Agenten](/de/platform/projects/project-agents) für den Ausrüstungsdialog und [Agent-Wissen](/de/platform/agents/knowledge) dafür, wie Recherche in dieser Version eingegrenzt ist.
