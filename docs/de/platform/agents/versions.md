---
title: Agent-Versionen
description: Die Verlauf-Ansicht des Agenten-Editors gibt es in dieser Version nicht — Persona-Dateien führen hinter der API einen Verlauf, und die Versionierung, die du im Produkt siehst, gehört den Automatisierungen.
---

Diese Seite hat früher den Button **Verlauf** des Agenten-Editors beschrieben — jedes Speichern ein Snapshot, ein Diff gegen die aktuelle Version, Wiederherstellen per Klick. Den Editor und seine Verlauf-Ansicht gibt es in dieser Version von Tale nicht. Die Versionierung ist damit nicht verschwunden: Automatisierungen sind im Produkt versioniert, und Agent-Personas führen einen Datei-Verlauf, den die API der Plattform bereitstellt.

<Note>

Die Verlauf-Ansicht für Agenten ist in dieser Version nicht verfügbar. Es gibt keinen Agenten-Editor, aus dem du sie öffnen könntest.

</Note>

## Was heute versioniert ist

**Automatisierungen** tragen die Versionierung, die du siehst. Jedes Speichern auf dem Canvas und jedes hochgeladene Paket wird eine neue unveränderliche Version; auf der Seite der Automatisierung schaltest du eine davon live, und die Liste unter **Automatisierungen** zeigt zu jeder Automatisierung die Zahl ihrer Versionen neben der Version, die live ist — oder **Nicht live**. [Der Workflow-Editor](/de/platform/automations/editor) behandelt Versionen, Testläufe und das Live-Schalten; [Automatisierungen in deine Organisation bringen](/de/platform/automations/catalog), was ein Upload anhängt.

**Agent-Personas** führen ihren Verlauf hinter der API. Jedes Speichern behält die abgelöste Datei in der Verlaufsspur der Persona, und das Wiederherstellen eines Eintrags sichert zuerst die aktuelle Datei — eine Wiederherstellung ist additiv und zerstört nie den Stand, den sie ersetzt; ein Verlaufseintrag, der sich nicht mehr parsen ließe, wird mit Begründung abgelehnt statt geschrieben. Kein Bildschirm zeigt diese Spur in dieser Version — erreichbar ist sie über die eigene API der Plattform und, wer selbst hostet, auf der Platte neben den Persona-Dateien. [Agents (Admin-Sicht)](/de/platform/admin/agents) erklärt, wer was wiederherstellen darf.

**Skills** behalten die abgelöste `SKILL.md`, wenn ein hochgeladenes Paket ein Bundle ersetzt, wie [Automatisierungen in deine Organisation bringen](/de/platform/automations/catalog) beschreibt. Wer organisationsweit was getan hat, steht in den [Audit-Logs](/de/platform/admin/governance/audit-logs).

## Wo das hingehört

Versionen leben in dieser Version dort, wo bearbeitet wird: auf der Seite der Automatisierung für Automatisierungen, in der Verlaufsspur für Personas, im Verlauf jedes Skills für Bundles. Die Begleitlektüre sind die [Audit-Logs](/de/platform/admin/governance/audit-logs) für das Wer-hat-was über alle drei hinweg.
