---
title: Agent erstellen
description: Spezialisierte KI-Assistenten mit eigenen Anweisungen, Wissen und Tools bauen.
---

Agents sind spezialisierte KI-Assistenten, die du für bestimmte Aufgaben konfigurierst. Im Gegensatz zum Standard-Chat-Agent, der ein Allrounder ist, hat ein Agent eigene Anweisungen, einen definierten Wissensumfang, ein bestimmtes KI-Modell und optionale Tool-Einschränkungen.

## Einen Agent erstellen

1. Navigiere in der Seitenleiste zu **Agents**.
2. Klicke auf **Agent erstellen**.
3. Gib einen **Anzeigenamen** (im Agent-Selector angezeigt) und einen **Namen** (URL-sicherer Slug für API-Aufrufe, z. B. `support-agent`) ein.
4. Optional eine Beschreibung hinzufügen, dann auf **Erstellen** klicken.
5. Du landest auf der Konfigurationsseite des Agents, auf der du **Anweisungen & Modell**, **Wissen**, **Tools** und **Webhook** einrichtest.

### Datei-basiert mit KI-Unterstützung

Du kannst Agents auch erstellen, indem du JSON-Dateien direkt in das Verzeichnis `agents/` deines Projekts legst. Wenn du das Projekt in einem KI-Editor (Claude Code, Cursor, GitHub Copilot oder Windsurf) öffnest, kennt der Editor die Agent-Schemas und Plattform-Fähigkeiten vollständig. Beschreibe den gewünschten Agent, und er erzeugt eine gültige Konfigurationsdatei. Siehe [AI-assisted development](/de/develop/ai-assisted-development) für die Einrichtung.

## Tab Anweisungen & Modell

Das ist der wichtigste Tab. Er definiert, was der Agent weiß, wie er sich verhält und was er tun kann.

- **Systemanweisungen**: der Prompt, der dem Modell vor jeder Konversation vorangestellt wird. Nutze ihn, um Rolle, Ton, erlaubte und verbotene Themen und Antwortformate festzulegen.
- **Modellvoreinstellung**: wähle zwischen **Schnell**, **Standard** und **Erweitert**. Jede Stufe ist einem in den Anbieter-Dateien (`providers/*.json`) konfigurierten KI-Modell zugeordnet.
- **Strukturierte Antworten**: wenn an, formatiert der Agent seine Antworten mit einheitlicher Struktur (Abschnitte und Listen) statt Freitext.

Änderungen in diesem Tab werden automatisch gespeichert. Eine Speicher-Anzeige oben rechts zeigt den aktuellen Status.

## Tab Wissen

Steuert, welche Teile der Wissensdatenbank dieser Agent durchsuchen darf. Standardmäßig können Agents das gesamte Organisationswissen durchsuchen. Du kannst den Zugriff auf bestimmte Dokumenten-Ordner, Produktkategorien oder team-gebundene Daten einschränken.

## Tab Tools

Steuert, welche Plattform-Fähigkeiten der Agent nutzen darf. Schalte einzelne Tools ein oder aus. Zum Beispiel kann ein reiner Support-Agent Web-Browsing aus- und Kunden-Lookup anhaben.

## Tab Gesprächseinstiege

Definiere Vorschläge, die erscheinen, wenn Nutzer eine neue Konversation mit diesem Agent starten. Gesprächseinstiege helfen Nutzern zu entdecken, was der Agent kann, und senken die Hürde für die erste Nachricht.

Jeder Starter hat einen Titel und einen Prompt. Der Titel erscheint als klickbarer Vorschlag; der Prompt wird beim Klicken als erste Nachricht gesendet.

## Tab Delegation

Konfiguriere Agent-zu-Agent-Übergaben. Mit Delegation kann dieser Agent Konversationen an andere Agents weiterleiten, wenn das Thema außerhalb seines Bereichs liegt. Zum Beispiel kann ein allgemeiner Support-Agent Abrechnung-Fragen an einen spezialisierten Abrechnung-Agent übergeben.

## Tab Webhook

Jeder Agent bekommt einen eigenen Webhook-Endpoint. Du kannst eine Nachricht und den Konversationskontext an diese URL POSTen, um eine Antwort vom Agent zu erhalten, ohne die Plattform-Oberfläche zu nutzen. Nützlich, um den Agent in externe Produkte oder Chat-Widgets zu integrieren.

Du kannst ein Webhook-Secret hinzufügen, um die Authentizität eingehender Anfragen zu prüfen.

## Versionierung

Agents unterstützen Versionen. Beim Bearbeiten der Anweisungen eines Agents wird eine Entwurf-Version erzeugt. Die aktive Version bedient weiter Anfragen, bis du den Entwurf veröffentlichst. Der Versionsverlauf-Dialog zeigt alle vergangenen Versionen und erlaubt Vergleich und Rollback.

## Wo das hingehört

Diese Seite ist der Bau-Flow — Name, Modell, Anweisungen, Wissen, Tools, Version. Die meiste Iteration an einem Agent passiert _nach_ diesem ersten Anlegen: Anweisungen umschreiben, wenn du lernst, was der Agent falsch versteht; Wissen verengen, wenn du siehst, woraus er sich verankert; Tools an- und abschalten, wenn der Anwendungsfall sich schärft. Die vier Entscheidungen, die du hier getroffen hast, sind die vier Knöpfe, an denen du weiter drehst.

Für die Iterationsschleife — Entwerfen, Veröffentlichen und Rollback aktiver Agents — ist [Agent-Versionen](/de/platform/agents/versions) die dedizierte Referenz. Um den Agent von ausserhalb der UI aufzurufen, decken [Webhooks](/de/develop/webhooks) und die [API-Referenz](/de/develop/api-reference) die beiden Nicht-UI-Oberflächen ab.
