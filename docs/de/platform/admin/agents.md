---
title: Agenten aus Admin-Sicht
description: Verwalte Zugriff, Anbieter, Ausstattung und Secret-Freigaben über die Projektberechtigungen und die Ressourcen der Organisation.
---

Agenten gehören zu Projekten und unterliegen deren Berechtigungen. Als Inhaber oder Admin bestimmst du, welche Ressourcen verfügbar sind und wer die Konfiguration ändern darf. Diese Seite erklärt die Grenzen; [Projekt-Agenten](/de/platform/projects/project-agents) beschreibt die tägliche Einrichtung.

## Die Verwaltung des Teams regeln

Wer ein Projekt lesen darf, sieht seine Agenten. Mit Bearbeitungsrechten kannst du Agenten in einem aktiven Projekt anlegen, ändern und löschen; archivierte Projekte bleiben lesbar. Jedes Projekt fasst bis zu 50 Agenten mit innerhalb des Projekts eindeutigen Namen.

Eine Agenten-ID gehört zu ihrem Projekt. Auch mit Zugriff auf zwei Projekte lässt sich der Agent des einen Projekts nicht über das andere ändern. [Mitglieder und Rollen](/de/platform/admin/members-and-roles) und [Teams](/de/platform/admin/teams) erklären die zugrunde liegenden Rechte.

## Die verfügbaren Ressourcen steuern

- **Anbieter** stellen Modelle und Zugangsdaten für die Ausführung bereit. [Anbieter](/de/platform/admin/providers) beschreibt die verfügbaren Engines.
- **Connectors, Skills und Tools** bestimmen, welche Dienste, Referenzen und Plattformaktionen ein Agent erreicht. Vergib die Ausstattung, die seine Aufgabe verlangt.
- **Secret-Freigaben** geben dem Lauf die Werte benannter Organisationsgeheimnisse. Nur Inhaber oder Admins der Organisation dürfen die freigegebenen Namen ändern. Redakteure können andere Einstellungen speichern, wenn sie die vorhandenen Freigaben beibehalten.
- **Budgets und Richtlinien** regeln Ausgaben und Aktionen organisationsweit; siehe [Richtlinien und Grenzen](/de/platform/admin/governance/policies-and-limits).

Geheimniswerte bleiben verschlüsselt gespeichert und fehlen in der Agentenkonfiguration, die die API zurückgibt. Beim Rotieren änderst du den Wert für alle Agenten, die auf diesen Namen verweisen.

## Dieselben Regeln für Integrationen anwenden

Die öffentliche API verlangt bei jeder Agentenoperation eine Projekt-ID und prüft die Projektberechtigungen des Schlüsselinhabers. API und Projektoberfläche lesen und ändern dieselben Agenten. Die [API-Referenz](/de/develop/api-reference#agenten-eines-projekts-verwalten) enthält die Routen und ein vollständiges Beispiel.

Eine Aktualisierung enthält die gesamte Konfiguration samt den Secret-Freigaben, die bleiben sollen. Lässt du die Freigaben aus, verlangst du deren Entfernung; dafür brauchst du dieselben Admin-Rechte wie beim Hinzufügen.

## Die Projekteinstellungen prüfen

Prüfe die Projektmitgliedschaft zusammen mit Modell, Ausstattung und Secret-Freigaben des Agenten. [Agenten verstehen](/de/platform/agents/concepts) erklärt das Zusammenspiel, [Projekt-Agenten](/de/platform/projects/project-agents) die Konfiguration für Aufgaben.
