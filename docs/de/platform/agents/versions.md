---
title: Agent-Versionen
description: Mit Draft-Publish und Rollback sicher an einem produktiven Agent iterieren.
---

Agents nutzen ein Draft-Publish-Versionsmodell, damit du an einem Agent arbeiten kannst, ohne die gerade laufenden Nutzer zu stören.

## Draft vs. Live

Jeder Agent hat zu jeder Zeit zwei Zustände:

- **Live-Version** — die, die gerade Requests bedient. Das ist, was Nutzer sehen, wenn sie den Agent im Chat auswählen, und was Webhooks und Delegations aufrufen.
- **Draft-Version** — deine laufende Arbeit. Änderungen an Anweisungen, Wissen oder Tools aktualisieren den Draft. Bis du publizierst, sehen die Nutzer nichts davon.

Oben rechts im Agent-Editor zeigt eine Anzeige, welche Version du gerade bearbeitest — **Draft** oder **Live** — und erlaubt den Wechsel.

## Einen Draft publizieren

Wenn du mit dem Draft zufrieden bist, klicke auf **Publish**. Publish tut Folgendes:

1. Trägt die vorherige Live-Version in den Versionsverlauf ein.
2. Macht den Draft zur neuen Live-Version.
3. Leert den Draft-Zustand. Zukünftige Änderungen starten einen frischen Draft.

Jede Konversation, die beim Publizieren mitten in einer Antwort war, läuft mit ihrer ursprünglichen Version zu Ende — niemand sieht einen Persönlichkeitswechsel mitten im Zug.

## Versionsverlauf

Der Versionsverlaufs-Dialog zeigt jede publizierte Version des Agents mit Autor, Publish-Zeitpunkt und einer kurzen Zusammenfassung der Änderungen. Für jede vergangene Version kannst du:

- **Compare** — Anweisungen gegen die aktuelle Live-Version vergleichen.
- **Restore** — die Version zum neuen Draft machen, den du dann publizieren kannst.

## Rollback

Wenn eine publizierte Änderung Probleme verursacht — falscher Ton, schlechte Antworten, kaputte Tool-Zugriffe — öffne den Versionsverlauf, wähle die letzte gute Version und klicke **Restore** dann **Publish**. Der Rollback ist sofort für alle neuen Konversationen wirksam.

## Datei-basierte Agents

Agents, die in `TALE_CONFIG_DIR/agents/*.json` definiert sind, nutzen nicht die UI-Versionierung — ihre Historie ist das, was dein Git-Repository aufzeichnet. Siehe [AI-assisted development](/de/develop/ai-assisted-development) für den datei-basierten Workflow.
