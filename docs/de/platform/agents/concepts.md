---
title: Agent-Konzepte
description: Das Vier-Knöpfe-Modell hinter jedem Tale-Agent — Anweisungen, Wissen, Tools und Modell — und wann ein Agent statt einer Automatisierung die richtige Wahl ist.
---

Ein Agent ist ein Bündel aus vier Dingen: **Anweisungen**, die sein Verhalten steuern, **Wissen**, das begrenzt, was er lesen darf, **Tools**, die entscheiden, was er tun darf, und ein **Modell**, das bestimmt, wie er denkt. Alles andere in der Agent-Oberfläche — Versionierung, Gesprächseinstiege, Worker-URLs, Delegation — ist Infrastruktur um diese vier. Die Zielgruppe ist jeder, der Agents baut oder über sie nachdenkt; sobald du die vier für den gewünschten Agent benennen kannst, dauert der Bau selbst nur noch Minuten.

Diese Seite ist das mentale Modell. Der End-zu-End-Bau geht dieselben vier Tabs der Reihe nach durch unter [Agent erstellen](/de/platform/agents/create).

## Anweisungen

Die Anweisungen sind der System-Prompt, den das Modell vor jeder Nachricht in der Konversation sieht. Sie beantworten „Wer bist du und was ist dein Auftrag?". Gute Anweisungen sind kurz, spezifisch und listen die Regeln, an die der Agent sich halten muss — was der Agent ist, was er beantworten darf, was er verweigern muss und wie er seine Antworten formatiert.

Ein konkretes Beispiel:

> Du bist der Support-Agent von Acme Corp. Beantworte Fragen zu unseren Produkten, dem Versand und Retouren. Gib keine medizinischen oder rechtlichen Ratschläge. Antworte immer in der Sprache des Nutzers. Halte Antworten unter 200 Wörtern.

Die Anweisungen zu ändern, ändert Persönlichkeit, Umfang und Ausgabeformat des Agents. Behandle sie als die tragendste Komponente — die meisten Qualitätsgewinne kommen aus dem Umschreiben der Anweisungen, nicht aus dem Modelltausch.

## Wissen

Wissen ist die Teilmenge der [Wissensdatenbank](/de/platform/workspace/knowledge-base), die der Agent durchsuchen darf. Standardmässig dürfen Agents alles durchsuchen, was die Organisation hochgeladen hat; du engst diesen Umfang nach Ordner, Team oder Entitätstyp ein (Dokumente, Produkte, Kunden, Lieferanten).

Engeres Wissen heisst relevantere Treffer — ein Support-Agent, der nur den kundenseitigen Ordner durchsucht, lässt sich nicht von internen Entwicklungs-Dokumenten ablenken. Enger heisst auch günstiger, weil weniger Dokumente bei jeder Suche das Modell erreichen.

## Tools

Tools sind die Fähigkeiten, die der Agent in einer Konversation aufrufen kann. Eingebaute Tools umfassen Wissens-Suche, Web-Suche, Dokument-Verarbeitung und Bild-Analyse. Jede konfigurierte Integration (REST-APIs, SQL, E-Mail) erscheint als Tool, ebenso jeder aktive [MCP-Server](/de/platform/integrations/mcp-servers).

Du schaltest jedes Tool pro Agent an oder aus. Ein Nur-Lese-Research-Agent hat vielleicht Web-Suche an und alle Schreib-Operationen aus. Ein Agent, der Tickets in einem Support-System aktualisiert, hat die Support-Integration an und sonst alles aus. Die Tool-Liste trennt den Agent, der nur reden kann, von dem, der handeln kann.

## Modell

Jeder Agent ist an eine Modell-Voreinstellung gebunden — **Schnell**, **Standard** oder **Erweitert**. Jede Voreinstellung zeigt auf ein bestimmtes KI-Modell, das in deinen [KI-Anbietern](/de/platform/admin/providers) konfiguriert ist. Schnell ist am günstigsten und am schnellsten; Erweitert ist das fähigste. Die meisten Agents landen auf Standard; greife zu Erweitert, wenn Argumentationsqualität wichtiger ist als Latenz, und zu Schnell für Routine-Aufgaben mit hohem Volumen, bei denen Tempo Nuance schlägt.

## Alles zusammen

Die vier Knöpfe kombinieren sich zu vielen Agents aus derselben Plattform. Drei konkrete Formen:

| Szenario             | Anweisungen                                    | Wissen                                | Tools                           | Modell    |
| -------------------- | ---------------------------------------------- | ------------------------------------- | ------------------------------- | --------- |
| Freundlicher Support | hilfsbereit, knapp, lehnt Off-Scope-Fragen ab. | Nur Hilfe-Center-Dokumente.           | Wissens-Suche, Kunden-Lookup.   | Standard  |
| Vertriebs-Recherche  | gräbt tief, zitiert Quellen.                   | Alle Dokumente + Websites + Produkte. | Wissens-Suche, Web-Suche.       | Erweitert |
| Daten-Exploration    | vorsichtig, erklärt Abfragen.                  | Alle SQL-Verbindungen.                | SQL-Integration, Wissens-Suche. | Schnell   |

## Wann du danach greifst

Agents sind das Konversations-Primitiv in Tale. Ihr Geschwister-Primitiv ist die **Automatisierung** — ein mehrstufiges Programm, das ohne Menschen in der Schleife läuft. Die beiden lösen unterschiedliche Probleme, und die meisten Teams landen am Ende bei beidem.

| Greif zum Agent, wenn …                                              | Greif zur Automatisierung, wenn …                                                              |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Ein Mensch im Gespräch Fragen stellt.                                | Ein geplanter Trigger, ein externer Webhook oder ein internes Ereignis sie startet.            |
| Der Ablauf offen ist — der nächste Schritt hängt von der Antwort ab. | Der Ablauf deterministisch ist — dieselben Schritte jedes Mal, in derselben Reihenfolge.       |
| Die Ausgabe Text oder eine kleine strukturierte Payload ist.         | Die Ausgabe eine Wirkung auf ein anderes System ist (Datensatz aktualisiert, E-Mail gesendet). |
| Latenz zählt, weil jemand wartet.                                    | Hintergrund-Latenz ist okay; Korrektheit zählt mehr.                                           |

Viele Funktionen mischen beides: ein Agent, der einen langlaufenden Job an eine Automatisierung delegiert, oder ein Workflow, dessen LLM-Schritt die Anweisungen eines Agents nutzt. Wähle das primäre Primitiv danach, ob der Nutzer im Gespräch ist, wenn die Arbeit anfallen muss.

## Einen bauen

Die Konzepte sind erledigt. Die nächste Seite führt den Bau-Flow durch — Namen geben, Modell wählen, Anweisungen schreiben, Wissen anhängen, Tools aktivieren und die erste Version veröffentlichen. Geh dort weiter: [Agent erstellen](/de/platform/agents/create).
