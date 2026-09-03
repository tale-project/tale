---
title: Agent-Wissen
description: Einen Wissen-Tab pro Agent gibt es in dieser Version nicht — Wissen wird organisationsweit verwaltet und über die Such-Tools des Chat-Assistenten und die Plattform-Tools eines Projekt-Agenten erreicht.
---

Diese Seite hat früher einen Tab **Wissen** im Agenten-Editor beschrieben, mit einer einzigen Einstellung — welchen Bestand die Suche eines Agenten lesen darf. Diesen Tab gibt es in dieser Version von Tale nicht. Das Wissen selbst gibt es sehr wohl: Dokumente und gecrawlte Websites der Organisation werden unter **Wissen** indexiert, der Chat-Assistent durchsucht sie, wann immer eine Frage danach verlangt, und ein Projekt-Agent liest sie über seine Plattform-Tools.

<Note>

Den Wissensbereich pro Agent gibt es in dieser Version nicht als Einstellung. Das Dateiformat der Personas trägt noch ein Feld `knowledge`, aber kein Bildschirm setzt es, und der Chat führt keine Personas aus.

</Note>

## Wo Wissen heute entschieden wird

Die Quellen sind organisationsweit. Lade Dateien unter [Dokumente](/de/platform/knowledge/documents) hoch und ordne sie, füge Sites zum Crawlen unter [Crawling](/de/platform/knowledge/crawling) hinzu, und lies [Wissen](/de/platform/knowledge/overview) dafür, wie die Indexierung arbeitet. Alles Indexierte gehört deiner Organisation; nichts, was ein Agent abruft, reicht also je in das Material eines anderen Mandanten.

Der **Chat-Assistent** erreicht dieses Material über `rag_search` und `rag_fetch` — er sucht, wenn die Frage es verlangt, lädt die gefundene Passage vollständig und antwortet daraus. Ein Dokument, dessen Indexierung noch läuft, ist noch nicht auffindbar; ein Assistent, der eine offensichtliche Quelle zu übergehen scheint, wartet meist nur auf den Index. Lässt sich die Wissensdatenbank gar nicht durchsuchen — kein Embedding-Modell konfiguriert, der Bestand noch leer —, bekommt der Assistent das im Tool-Ergebnis gesagt und sagt es dir, statt zu antworten, als gäbe es nichts.

Ein **Projekt-Agent** liest Dokumente und Wissen über die Plattform-Tools, mit denen du ihn ausrüstest, begrenzt auf sein Projekt: Das Board und die Dateien eines anderen Projekts sieht er nie. [Projekt-Agenten](/de/platform/projects/project-agents) behandelt die Ausrüstung; der [MCP-Endpoint](/de/develop/mcp-endpoint) gibt einem Client außerhalb von Tale dieselbe Suche über `get_knowledge`.

## Wo das hingehört

Wissen ist in dieser Version eine Eigenschaft der Organisation, nicht eines Agenten: Du entscheidest, was indexiert wird, und jede Spur — Chat, Projekt-Agenten, der MCP-Endpoint — liest aus diesem einen Bestand mit ihren eigenen Zugriffsregeln. [Wissen](/de/platform/knowledge/overview) ist der Ort, ihn zu formen; [Agent-Tools](/de/platform/agents/tools) behandelt den Rest dessen, was ein Agent kann.
