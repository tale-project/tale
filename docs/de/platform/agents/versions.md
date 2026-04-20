---
title: Agent-Versionen
description: Mit Entwurf und Veröffentlichung sowie Rollback sicher an einem produktiven Agent iterieren.
---

Agents nutzen ein Entwurf-Veröffentlichen-Versionsmodell, damit du an einem Agent arbeiten kannst, ohne die gerade laufenden Nutzer zu stören.

## Entwurf vs. Aktiv

Jeder Agent hat zu jeder Zeit zwei Zustände:

- **Aktive Version** — die, die gerade Requests bedient. Das ist, was Nutzer sehen, wenn sie den Agent im Chat auswählen, und was Webhooks und Delegations aufrufen.
- **Entwurf-Version** — deine laufende Arbeit. Änderungen an Anweisungen, Wissen oder Tools aktualisieren den Entwurf. Bis du veröffentlichst, sehen die Nutzer nichts davon.

Oben rechts im Agent-Editor zeigt eine Anzeige, welche Version du gerade bearbeitest — **Entwurf** oder **Aktiv** — und erlaubt den Wechsel.

## Einen Entwurf veröffentlichen

Wenn du mit dem Entwurf zufrieden bist, klicke auf **Veröffentlichen**. Veröffentlichen tut Folgendes:

1. Trägt die vorherige aktive Version in den Versionsverlauf ein.
2. Macht den Entwurf zur neuen aktiven Version.
3. Leert den Entwurfs-Zustand. Zukünftige Änderungen starten einen frischen Entwurf.

Jede Konversation, die beim Veröffentlichen mitten in einer Antwort war, läuft mit ihrer ursprünglichen Version zu Ende — niemand sieht einen Persönlichkeitswechsel mitten im Zug.

## Versionsverlauf

Der Versionsverlaufs-Dialog zeigt jede veröffentlichte Version des Agents mit Autor, Veröffentlichungs-Zeitpunkt und einer kurzen Zusammenfassung der Änderungen. Für jede vergangene Version kannst du:

- **Vergleichen** — Anweisungen gegen die aktuelle aktive Version vergleichen.
- **Wiederherstellen** — die Version zum neuen Entwurf machen, den du dann veröffentlichen kannst.

## Rollback

Wenn eine veröffentlichte Änderung Probleme verursacht — falscher Ton, schlechte Antworten, kaputte Tool-Zugriffe — öffne den Versionsverlauf, wähle die letzte gute Version und klicke **Wiederherstellen** dann **Veröffentlichen**. Der Rollback ist sofort für alle neuen Konversationen wirksam.

## Datei-basierte Agents

Agents, die in `TALE_CONFIG_DIR/agents/*.json` definiert sind, nutzen nicht die UI-Versionierung — ihre Historie ist das, was dein Git-Repository aufzeichnet. Siehe [AI-assisted development](/de/develop/ai-assisted-development) für den datei-basierten Workflow.
