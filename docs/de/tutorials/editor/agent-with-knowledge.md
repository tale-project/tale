---
title: Einen Agent mit Wissen bauen
description: Dokumente an einen Agenten zu binden gibt es in dieser Version nicht — Wissen gehört der ganzen Organisation, wird unter Wissen indexiert, und Chat-Assistent wie Projekt-Agenten lesen es von dort.
---

Diese Anleitung hat früher drei Dokumente an einen frischen Agenten gebunden: unter **Agenten > Neuer Agent** mit eingeschaltetem RAG-Tool anlegen, seinen Tab **Wissen** öffnen, die Dokumente auswählen, dann mit dem Agenten chatten und die Belege prüfen. Keine dieser Ansichten gibt es in dieser Version von Tale — es gibt keinen Agenten-Editor, keinen Tab **Wissen** pro Agent und keinen Agenten, mit dem du einen Chat öffnen könntest. Das Wissen selbst ist sehr wohl da; es gehört der Organisation und nicht einem Agenten, und jede Bahn liest aus diesem einen Bestand.

<Note>

Dokumente pro Agent zu binden ist in dieser Version nicht verfügbar. Lade Dokumente unter **Wissen** hoch; der Chat-Assistent durchsucht sie, wenn eine Frage danach verlangt, und ein Projekt-Agent liest sie über die Plattform-Tools, mit denen du ihn ausrüstest.

</Note>

## Heute Antworten aus deinen Dokumenten bekommen

Lade die Dokumente unter [Dokumente](/de/platform/knowledge/documents) hoch und warte, bis die Indexierung durch ist — ein Dokument, das noch nicht fertig indexiert ist, lässt sich noch nicht finden. Dann frag den **Chat-Assistenten**: Er durchsucht das Wissen der Organisation mit `rag_search`, wann immer die Frage danach verlangt, lädt die gefundene Passage mit `rag_fetch` und listet unter der Antwort die Quellen, die er tatsächlich gelesen hat — abgeleitet aus den Tool-Ergebnissen, sodass eine Quellenkarte nie eine Lektüre behauptet, die nicht stattgefunden hat. Lässt sich die Wissensdatenbank gar nicht durchsuchen — kein Embedding-Modell konfiguriert, der Bestand noch leer —, sagt der Assistent das, statt zu antworten, als gäbe es nichts. Auf drei Dokumente eingrenzen lässt sich der Assistent nicht; er liest das Wissen der Organisation.

Ein **Projekt-Agent** liest Dokumente und Wissenseinträge über die Plattform-Tools, die du ihm unter **Skills, Connectors & Tools** gibst, beschränkt auf sein Projekt. Seine **Anweisungen** sind der Ort, an dem die Regel der alten Anleitung heute steht — „antworte nur aus den Dokumenten der Organisation, nenne den Titel, lehne ab, wenn nichts passt“ —, und das Ergebnis kommt als Aufgaben-Kommentar unter **In Prüfung** zurück, wo du den Beleg prüfst, bevor du annimmst. [Projekt-Agenten](/de/platform/projects/project-agents) geht die Ausrüstung durch; [Deinen ersten Agent bauen](/de/tutorials/editor/first-agent-end-to-end) legt einen von Null an.

## Wo das hingehört

Wissen ist in dieser Version eine Eigenschaft der Organisation, nicht eines Agenten: Du entscheidest, was indexiert wird, und Chat, Projekt-Agenten und das `get_knowledge` des MCP-Endpoints lesen aus diesem einen Bestand mit ihren eigenen Zugriffsregeln. [Agent-Wissen](/de/platform/agents/knowledge) ist die konzeptionelle Seite; [Wissen](/de/platform/knowledge/overview) ist der Ort, an dem du den Bestand formst — Dokumente und die Websites, die du hineincrawlst.
