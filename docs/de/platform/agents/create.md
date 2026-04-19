---
title: Agent erstellen
description: Spezialisierte KI-Assistenten mit eigenen Anweisungen, Wissen und Tools bauen.
---

Agents sind spezialisierte KI-Assistenten, die du für bestimmte Aufgaben konfigurierst. Im Gegensatz zum Standard-Chat-Agent, der ein Allrounder ist, hat ein Agent eigene Anweisungen, einen definierten Wissensumfang, ein bestimmtes KI-Modell und optionale Tool-Einschränkungen.

## Einen Agent erstellen

1. Navigiere in der Seitenleiste zu Agents.
2. Klicke auf New Agent.
3. Gib einen Display Name (im Agent-Selector angezeigt) und einen Internal Name (URL-sicherer Slug für API-Aufrufe, z. B. `support-agent`) ein.
4. Optional eine Beschreibung hinzufügen, dann Create klicken.
5. Du landest auf der Konfigurationsseite des Agents, auf der du Instructions, Knowledge, Tools und Webhook einrichtest.

### Datei-basiert mit KI-Unterstützung

Du kannst Agents auch erstellen, indem du JSON-Dateien direkt in das Verzeichnis `agents/` deines Projekts legst. Wenn du das Projekt in einem KI-Editor (Claude Code, Cursor, GitHub Copilot oder Windsurf) öffnest, kennt der Editor die Agent-Schemas und Plattform-Fähigkeiten vollständig. Beschreibe den gewünschten Agent, und er erzeugt eine gültige Konfigurationsdatei. Siehe [AI-assisted development](/de/develop/ai-assisted-development) für die Einrichtung.

## Tab Instructions

Das ist der wichtigste Tab. Er definiert, was der Agent weiß, wie er sich verhält und was er tun kann.

- System Instructions: der Prompt, der dem Modell vor jeder Konversation vorangestellt wird. Nutze ihn, um Rolle, Ton, erlaubte und verbotene Themen und Antwortformate festzulegen.
- Model Preset: wähle zwischen Fast, Standard und Advanced. Jede Stufe ist einem in den Anbieter-Dateien (`providers/*.json`) konfigurierten KI-Modell zugeordnet.
- Structured Responses: wenn an, formatiert der Agent seine Antworten mit einheitlicher Struktur (Abschnitte und Listen) statt Freitext.

Änderungen in diesem Tab werden automatisch gespeichert. Eine Speicher-Anzeige oben rechts zeigt den aktuellen Status.

## Tab Knowledge

Steuert, welche Teile der Wissensdatenbank dieser Agent durchsuchen darf. Standardmäßig können Agents das gesamte Organisationswissen durchsuchen. Du kannst den Zugriff auf bestimmte Dokumenten-Ordner, Produktkategorien oder team-gebundene Daten einschränken.

## Tab Tools

Steuert, welche Plattform-Fähigkeiten der Agent nutzen darf. Schalte einzelne Tools ein oder aus. Zum Beispiel kann ein reiner Support-Agent Web-Browsing aus- und Customer-Lookup anhaben.

## Tab Conversation Starters

Definiere Vorschläge, die erscheinen, wenn Nutzer eine neue Konversation mit diesem Agent starten. Conversation Starter helfen Nutzern zu entdecken, was der Agent kann, und senken die Hürde für die erste Nachricht.

Jeder Starter hat einen Titel und einen Prompt. Der Titel erscheint als klickbarer Vorschlag; der Prompt wird beim Klicken als erste Nachricht gesendet.

## Tab Delegation

Konfiguriere Agent-zu-Agent-Übergaben. Mit Delegation kann dieser Agent Konversationen an andere Agents weiterleiten, wenn das Thema außerhalb seines Bereichs liegt. Zum Beispiel kann ein allgemeiner Support-Agent Billing-Fragen an einen spezialisierten Billing-Agent übergeben.

## Tab Webhook

Jeder Agent bekommt einen eigenen Webhook-Endpoint. Du kannst eine Nachricht und den Konversationskontext an diese URL POSTen, um eine Antwort vom Agent zu erhalten, ohne die Plattform-Oberfläche zu nutzen. Nützlich, um den Agent in externe Produkte oder Chat-Widgets zu integrieren.

Du kannst ein Webhook-Secret hinzufügen, um die Authentizität eingehender Requests zu prüfen.

## Versionierung

Agents unterstützen Versionen. Beim Bearbeiten der Anweisungen eines Agents wird eine Draft-Version erzeugt. Die Live-Version bedient weiter Requests, bis du den Draft publizierst. Der Versionsverlauf-Dialog zeigt alle vergangenen Versionen und erlaubt Vergleich und Rollback.
