---
title: Agent-Konzepte
description: Das mentale Modell hinter Tale-Agents — Anweisungen, Wissen, Tools und Modelle.
---

Ein Agent ist ein Bündel aus vier Dingen: **Anweisungen** (wie er sich verhält), **Wissen** (was er lesen darf), **Tools** (was er tun darf) und einem **Modell** (wie er denkt). Alles andere — Versionierung, Webhooks, Gesprächseinstiege — sind Infrastruktur rund um diese vier.

## Anweisungen

Die Anweisungen sind der System-Prompt, den das Modell vor jeder Nachricht in der Konversation sieht. Sie beantworten "Wer bist du und was ist dein Auftrag?". Gute Anweisungen sind kurz, spezifisch und listen die Regeln, an die der Agent sich halten muss.

Beispiel:

> Du bist der Support-Agent von Acme Corp. Beantworte Fragen zu unseren Produkten, dem Versand und Retouren. Gib keine medizinischen oder rechtlichen Ratschläge. Antworte immer in der Sprache des Nutzers. Halte Antworten unter 200 Wörtern.

Die Anweisungen zu ändern, ändert Persönlichkeit, Umfang und Ausgabeformat des Agents.

## Wissen

Wissen ist die Teilmenge der [Wissensdatenbank](/de/platform/workspace/knowledge-base), die der Agent durchsuchen darf. Standardmäßig dürfen Agents alles durchsuchen, was die Organisation hochgeladen hat. Du kannst das nach Ordner, Team oder Entitätstyp (Dokumente, Produkte, Kunden, Lieferanten) einschränken.

Engere Wissensfilter führen zu relevanteren Treffern — ein Support-Agent, der nur den Ordner "Help Center" durchsucht, lässt sich nicht von internen Engineering-Dokumenten ablenken.

## Tools

Tools sind Fähigkeiten, die der Agent in einer Konversation aufrufen kann. Eingebaute Tools sind Wissens-Suche, Web-Suche, Dokument-Verarbeitung und Bild-Analyse. Integrationen, die du konfiguriert hast (REST-API, SQL, E-Mail), erscheinen ebenfalls als Tools.

Du kannst jedes Tool pro Agent einzeln an- und abschalten. Ein Nur-Lese-Research-Agent hat vielleicht Web-Suche an, aber alle Schreib-Operationen aus. Ein Billing-Agent hat eventuell nur die Billing-Integration verfügbar.

## Modell

Jeder Agent ist an eine Modellvoreinstellung gebunden — **Schnell**, **Standard** oder **Erweitert**. Jede Voreinstellung ist einem bestimmten KI-Modell aus deinen [Anbietern](/de/platform/admin/providers) zugeordnet. **Schnell** ist am günstigsten und schnellsten; **Erweitert** ist am leistungsfähigsten.

## Alles zusammen

Diese vier Stellschrauben erlauben viele Agents aus derselben Plattform:

| Szenario             | Anweisungen                                   | Wissen                               | Tools                          | Modell    |
| -------------------- | --------------------------------------------- | ------------------------------------ | ------------------------------ | --------- |
| Freundlicher Support | hilfsbereit, knapp, lehnt Off-Scope-Fragen ab | nur Help-Center-Dokumente            | Wissens-Suche, Kunden-Lookup   | Standard  |
| Sales Research       | gründlich, zitiert Quellen                    | alle Dokumente + Websites + Produkte | Wissens-Suche, Web-Suche       | Erweitert |
| Daten-Exploration    | vorsichtig, erklärt Abfragen                  | alle SQL-Verbindungen                | SQL-Integration, Wissens-Suche | Schnell   |

## Weiter

Bereit, einen zu bauen? Gehe zu [Agent erstellen](/de/platform/agents/create).
