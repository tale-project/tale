---
title: Agent-Konzepte
description: Das mentale Modell hinter Tale-Agents — Anweisungen, Wissen, Tools und Modelle.
---

Ein Agent ist ein Bündel aus vier Dingen: **Anweisungen** (wie er sich verhält), **Wissen** (was er lesen darf), **Tools** (was er tun darf) und einem **Modell** (wie er denkt). Alles andere — Versionierung, Webhooks, Gesprächseinstiege — ist Infrastruktur rund um diese vier. Sobald du die vier für den gewünschten Agent benennen kannst, dauert der Bau selbst nur noch Minuten.

## Anweisungen

Die Anweisungen sind der System-Prompt, den das Modell vor jeder Nachricht in der Konversation sieht. Sie beantworten „Wer bist du und was ist dein Auftrag?". Gute Anweisungen sind kurz, spezifisch und listen die Regeln, an die der Agent sich halten muss.

Beispiel:

> Du bist der Support-Agent von Acme Corp. Beantworte Fragen zu unseren Produkten, dem Versand und Retouren. Gib keine medizinischen oder rechtlichen Ratschläge. Antworte immer in der Sprache des Nutzers. Halte Antworten unter 200 Wörtern.

Die Anweisungen zu ändern, ändert Persönlichkeit, Umfang und Ausgabeformat des Agents. Behandle sie als die tragendste Komponente — die meisten Qualitätsgewinne entstehen durch Umschreiben der Anweisungen, nicht durch Modelltausch.

## Wissen

Wissen ist die Teilmenge der [Wissensdatenbank](/de/platform/workspace/knowledge-base), die der Agent durchsuchen darf. Standardmäßig dürfen Agents alles durchsuchen, was die Organisation hochgeladen hat. Du schränkst das nach Ordner, Team oder Entitätstyp ein (Dokumente, Produkte, Kunden, Lieferanten).

Engere Wissensfilter führen zu relevanteren Treffern — ein Support-Agent, der nur den kundenseitigen Ordner durchsucht, lässt sich nicht von internen Engineering-Dokumenten ablenken. Engere Filter heißen außerdem niedrigere Kosten, weil weniger Dokumente das Modell erreichen.

## Tools

Tools sind Fähigkeiten, die der Agent in einer Konversation aufrufen kann. Eingebaute Tools sind Wissens-Suche, Web-Suche, Dokument-Verarbeitung und Bild-Analyse. Integrationen, die du konfiguriert hast (REST-API, SQL, E-Mail), erscheinen ebenfalls als Tools.

Du schaltest jedes Tool pro Agent einzeln an und ab. Ein Nur-Lese-Research-Agent hat vielleicht Web-Suche an, aber alle Schreib-Operationen aus. Ein Agent, der Tickets in einem Support-System aktualisiert, hat genau eine Integration aktiviert und sonst nichts. Die Tool-Liste trennt den Agent, der nur reden kann, von dem, der handeln kann.

## Modell

Jeder Agent ist an eine Modellvoreinstellung gebunden — **Schnell**, **Standard** oder **Erweitert**. Jede Voreinstellung ist einem bestimmten KI-Modell aus deinen [Anbietern](/de/platform/admin/providers) zugeordnet. **Schnell** ist am günstigsten und schnellsten; **Erweitert** ist am leistungsfähigsten. Die meisten Agents landen auf Standard; greife zu Erweitert, wenn Argumentationsqualität wichtiger ist als Latenz, und zu Schnell für hohe Volumina an Routine-Aufgaben, bei denen Tempo Nuance schlägt.

## Alles zusammen

Diese vier Stellschrauben erlauben viele Agents aus derselben Plattform:

| Szenario             | Anweisungen                                   | Wissen                               | Tools                          | Modell    |
| -------------------- | --------------------------------------------- | ------------------------------------ | ------------------------------ | --------- |
| Freundlicher Support | hilfsbereit, knapp, lehnt Off-Scope-Fragen ab | nur Hilfe-Center-Dokumente           | Wissens-Suche, Kunden-Lookup   | Standard  |
| Vertriebs-Recherche  | gründlich, zitiert Quellen                    | alle Dokumente + Websites + Produkte | Wissens-Suche, Web-Suche       | Erweitert |
| Daten-Exploration    | vorsichtig, erklärt Abfragen                  | alle SQL-Verbindungen                | SQL-Integration, Wissens-Suche | Schnell   |

## Wann du danach greifst

Agents sind das Konversations-Primitiv in Tale. Ihr Geschwister-Primitiv ist die **Automatisierung** — ein mehrstufiges Programm, das ohne Mensch in der Schleife läuft. Die beiden lösen unterschiedliche Probleme, und die meisten Teams landen am Ende bei beidem.

| Greif zum Agent, wenn …                                             | Greif zur Automatisierung, wenn …                                                              |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| ein Mensch im Gespräch Fragen stellt                                | ein geplanter Trigger, ein externer Webhook oder ein internes Ereignis sie startet             |
| der Ablauf offen ist — der nächste Schritt hängt von der Antwort ab | der Ablauf deterministisch ist — jedes Mal dieselben Schritte, in derselben Reihenfolge        |
| die Ausgabe Text oder eine kleine strukturierte Nutzlast ist        | die Ausgabe eine Wirkung auf ein anderes System ist (Datensatz aktualisiert, E-Mail versendet) |
| Latenz zählt, weil jemand wartet                                    | Hintergrund-Latenz ist okay; Korrektheit zählt mehr                                            |

Viele Funktionen mischen beides: ein Agent, der einen langlaufenden Job an eine Automatisierung delegiert, oder ein Workflow, dessen LLM-Schritt die Anweisungen eines Agents verwendet. Wähle das primäre Primitiv danach, ob der Nutzer im Gespräch ist, wenn die Arbeit anfallen muss.

## Einen bauen

Konzepte erledigt. Die nächste Seite führt durch den Erstellen-Flow von Anfang bis Ende — Namen geben, Modell wählen, Anweisungen schreiben, Wissen anhängen, Tools aktivieren und die erste Version veröffentlichen. Dort gehst du weiter: [Agent erstellen](/de/platform/agents/create).
