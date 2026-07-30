---
title: Agent-Wissen
description: Der Wissen-Tab des Agents — eine Einstellung dafür, welchen Bestand seine Suche lesen darf, und wie sich das von Tools unterscheidet.
---

Wissen ist das, was ein Agent zur Antwortzeit heraussuchen und belegen kann. Ohne das bleibt er allgemein; damit antwortet er aus dem Material deiner Organisation und zeigt, woher die Antwort kommt. Auf dem Tab **Wissen** steht genau eine Entscheidung: welchen Bestand die Suche dieses Agenten lesen darf.

Diese Entscheidung ist kleiner, als sie einmal sein musste, denn die Suche selbst ist kein Modus mehr, den du einstellst. Ein Agent sucht, wenn er es für nötig hält, und in eine Antwort rutscht nichts, wonach er nicht selbst gesucht hat.

## Einen Bereich wählen

Vier Werte, eine Einstellung:

- **Dokumente** — die hochgeladenen Dateien der Organisation und sonst nichts.
- **Web** — die für die Organisation geholten Seiten und sonst nichts.
- **Alles** — beide Bestände, zu einem Ranking zusammengeführt. Das bekommt ein Agent, wenn ihn niemand eingrenzt.
- **Nichts** — dem Agenten wird gar keine Suche angeboten. Nimm das, wenn seine Aufgabe Denken oder Formulieren ist und Belege nur stören würden.

Jeder Bestand gehört deiner Organisation, ein weiterer Bereich reicht also nie in fremdes Material hinein. Er entscheidet nur, auf wie viel vom Eigenen der Agent zeigt.

## Bewusst eingrenzen

Alles im Bereich konkurriert bei jeder Frage um Relevanz, und deshalb antwortet ein enger Bereich meist besser als ein weiter. Ein Agent, der auf die Dokumente zeigt, die dein Team tatsächlich pflegt, findet die richtige Passage; derselbe Agent, der zusätzlich auf jede gecrawlte Seite zeigt, muss erst das Rauschen schlagen.

Nimm **Dokumente**, wenn die Wahrheit in Dateien liegt, die du kontrollierst, und eine veraltete Webseite ein Risiko wäre. Nimm **Web**, wenn es dem Agenten um Veröffentlichtes geht und nicht um Abgelegtes. Nimm **Alles**, wenn wirklich beides zählt und dir Trefferbreite lieber ist. Das Material selbst — was hochgeladen, was gecrawlt und was indexiert ist — verwaltest du unter [Dokumente](/de/platform/knowledge/documents) und [Websites](/de/platform/knowledge/crawling) und nicht hier; dieser Tab zeigt den Agenten nur darauf.

## Wie die Suche in der Antwort landet

Sucht der Agent, hängen die Belege an den Sätzen, die sie stützen — beim Überfahren siehst du die Quelle, mit einem Klick öffnest du sie. Ein Dokument, dessen Indexierung noch läuft, ist noch nicht auffindbar; ein Agent, der eine offensichtliche Quelle zu übergehen scheint, wartet also oft nur auf den Index, statt falsch eingestellt zu sein.

## Wann du dazu greifst

Strukturierte Datensätze und laufende Systeme sind Tools und kein Wissen. Die Grenzen:

| Nimm …                                                  | Wenn der Agent … braucht                                    |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| Wissen (diesen Tab)                                     | Suche und Belege im Material der Organisation               |
| [Tools](/de/platform/agents/tools)                      | Kontakte, Produkte, Lieferanten, Websites, laufende Systeme |
| [Projekt-Agenten](/de/platform/projects/project-agents) | Wissen, das auf ein Projekt begrenzt ist                    |

## Wo das hingehört

Agent-Wissen beantwortet eine Frage — soll dieser Agent die Dokumente der Organisation lesen, ihr gecrawltes Web, beides oder keines von beidem. Im größeren Kapitel [Wissen](/de/platform/knowledge/overview) leben und indexieren sich die Quellen; dieser Tab hängt einen Agenten an einen Ausschnitt davon. Den Weg von Anfang bis Ende — hochladen, eingrenzen, fragen, Belege prüfen — geht [Agent mit Wissen](/de/tutorials/editor/agent-with-knowledge).
