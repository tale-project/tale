---
title: Agent-Wissen
description: Der Wissen-Tab des Agents — Abrufmodus, Scopes für Team- und Organisationsdokumente und Uploads nur für den Agent, und wie sie sich von Tools und Anhängen unterscheiden.
---

Wissen ist das, was ein Agent zur Antwortzeit abrufen und zitieren kann. Ohne Wissen ist der Agent generisch; mit Wissen antwortet er aus deinen Dokumenten und zitiert, woher die Antwort kam. Der Tab **Wissen** des Agents steuert zwei Dinge: _wie_ der Agent abruft (der Abrufmodus) und _was_ im Scope liegt (welche Dokumente).

<Frame caption="Der Wissen-Tab — oben der Abrufmodus, darunter die Dokument-Scopes und das, was jeder davon gerade hält.">

![Der Wissen-Tab des Agenten-Editors mit Tool als gewähltem der vier Abrufmodi, eingeschalteten Schaltern für Team- und Organisationsdokumente, einem Kasten für Team-Dokumente mit dem Hinweis, dass für dieses Team keine Dokumente gefunden wurden, und der Liste der Organisationsdokumente, in der jede Datei ein Abzeichen Indexiert trägt.](/images/platform/agent-editor-knowledge.webp)

</Frame>

## Einen Abrufmodus wählen

Vier Modi wägen Kosten gegen Abdeckung ab. **Tool** lässt den Agent bei Bedarf suchen — der Abruf läuft nur, wenn das Modell entscheidet, dass es ihn braucht. **Kontext** injiziert relevantes Wissen in jede Antwort, ob das Modell gefragt hätte oder nicht. **Beides** kombiniert beide, und **Aus** schaltet die Wissensdatenbank für diesen Agent komplett ab. Starte mit **Tool**; wechsle zu **Kontext**, wenn der ganze Job des Agents das Antworten aus den Dokumenten ist und du den Abruf bei jeder Antwort willst.

## Den Dokument-Scope setzen

Die Wissensdatenbank durchsucht Dokumente, die in deine Organisation hochgeladen wurden — dieselbe Bibliothek, die du unter [Dokumente](/de/platform/knowledge/documents) verwaltest. Zwei Schalter setzen den Scope: **Team-Dokumente einbeziehen** deckt das zugewiesene Team des Agents ab, und **Organisationsdokumente einbeziehen** deckt Dokumente ab, die keinem Team zugewiesen sind. Der Tab listet, was jeder Scope gerade enthält, mit dem Indexzustand pro Dokument — nur Dokumente im Zustand **Indiziert** sind abrufbar.

## Dem Agent eigene Dokumente geben

**Agent-Dokumente** sind Uploads, auf die nur dieser Agent zugreifen kann — klicke auf **Dokumente hochladen**, und die Dateien treten in den Abruf-Scope dieses Agents ein, ohne die geteilte Bibliothek zu betreten. Greif dazu, wenn die Quelle zum Job des Agents gehört statt zur Organisation: ein Triage-Playbook, eine produktspezifische FAQ.

## Wie der Abruf in der Antwort landet

Wenn der Agent abruft, hängen sich Zitate an die Sätze, die sie stützen — Hovern zeigt die Quelle, Klicken öffnet sie. Alles Abrufbare konkurriert bei jeder Frage um Relevanz, also halte den Scope eng: ein breiter Scope macht den Abruf lauter, nicht klüger.

## Wann du danach greifst

Strukturierte Datensätze und Live-Quellen sind Tools, kein Wissen — und Dateien für eine einzelne Konversation sind Anhänge. Die Grenzen:

| Nutze…                                                  | Wenn der Agent braucht…                                       |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| Wissen (dieser Tab)                                     | Hochgeladene Dokumente in jedem Chat durchsuchen und zitieren |
| [Tools](/de/platform/agents/tools)                      | Kontakte, Produkte, Lieferanten, Websites oder Live-Systeme   |
| [Anhänge](/de/platform/chat/attachments)                | Eine Datei, die nur für einen Chat zählt                      |
| [Projekt-Agenten](/de/platform/projects/project-agents) | Wissen, das auf ein Projekt begrenzt ist                      |

## Wo das hingehört

Agent-Wissen ist die Antwort auf „dieser Agent soll aus diesen Dokumenten antworten“. Der breitere Abschnitt [Wissen](/de/platform/knowledge/overview) ist der Ort, an dem die Quellen liegen und indiziert werden; dieser Tab verdrahtet einen Agent mit einem Scope daraus. Für den Bau von Anfang bis Ende — hochladen, Scope setzen, fragen, Zitate prüfen — geh [Agent mit Wissen](/de/tutorials/editor/agent-with-knowledge) durch.
