---
title: Agents (Admin-Sicht)
description: Welche Agenten es in dieser Version gibt und wie ein Admin sie steuert — Projekt-Agenten auf dem Tab Agenten jedes Projekts und dateibasierte Agent-Personas in der Konfiguration der Organisation.
---

Ein organisationsweites Verzeichnis **Einstellungen > Agents** gibt es in dieser Version von Tale nicht, und auch keinen Bildschirm für Policies oder Besitz pro Agent. Agenten leben stattdessen an zwei Orten: als **Projekt-Agenten** — die benannte Crew, die ein Projekt auf seinem Tab **Agenten** aufstellt und auf Board-Aufgaben ansetzt — und als **Agent-Personas**, Konfigurationsdateien, die die Plattform aus dem Konfigurationsbaum der Organisation liest und über ihre eigene API bereitstellt. Diese Seite ist die Landkarte für Admins: wo jede Art lebt, wer sie ändern darf und welche Hebel ein Inhaber oder Admin tatsächlich in der Hand hat.

Wie du einen Agenten baust, steht anderswo: [Projekt-Agenten](/de/platform/projects/project-agents) führt durch den Dialog, [Agent-Konzepte](/de/platform/agents/concepts) erklärt, was eine Persona trägt. Hier geht es um die Steuerung.

## Projekt-Agenten — die Agenten mit Bildschirm

Der Tab **Agenten** eines Projekts listet seine Agenten: Jede Zeile nennt ein Coding-[Harness](/de/platform/agents/harnesses), den Provider, der das Modell bedient, das Modell selbst und wie viel Ausrüstung der Agent hat. Wer das Projekt bearbeiten darf, legt sie an, ändert und löscht sie — bis zu 50 pro Projekt —, und die Ausrüstungsliste folgt dem Team-Zugriff des Projekts, nicht der persönlichen Sichtbarkeit der bearbeitenden Person. Zur Arbeit kommt ein Agent, indem du ihm eine Board-Aufgabe zuweist und auf **Agent starten** klickst; er arbeitet in einer isolierten Sandbox und parkt das Ergebnis bei **In Prüfung**, bis ein Mensch es annimmt.

Die Hebel eines Admins sitzen eine Ebene höher, auf der Organisation:

- **Provider** entscheiden, auf welchen Modellen und Zugängen ein Agent überhaupt angelegt werden kann; ein Modell, dessen Provider es nicht mehr bedienen kann, lässt den Lauf mit Begründung scheitern, statt still die Rechnung zu wechseln. Verwalte sie unter **Einstellungen > KI-Anbieter** — siehe [Provider](/de/platform/admin/providers).
- **Connectors und Skills** entscheiden, womit ein Agent ausgerüstet werden kann. Verbinde Dienste unter **Einstellungen > Connectors**, pflege Bundles unter **Einstellungen > Skills**.
- **Secrets**, die ein Agent als Umgebungsvariablen bekommt, gehören der Organisation: verschlüsselt gespeichert, nie wieder angezeigt, über Agenten hinweg wiederverwendet — rotiert an einer Stelle.
- **Budgets und Richtlinien** deckeln Ausgaben und schalten Aktionen organisationsweit; siehe [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits).
- **Projekt-Mitgliedschaft** entscheidet, wer die Crew eines Projekts überhaupt bearbeiten darf — [Mitglieder und Rollen](/de/platform/admin/members-and-roles) behandelt die Rollen, [Teams](/de/platform/admin/teams) die Team-Freigaben.

## Agent-Personas — Konfiguration, kein Bildschirm

Eine Persona ist eine YAML-Datei in der Konfiguration der Organisation: ein Slug, Anzeigename und Beschreibung, optional deren Fassungen pro Sprache, Anweisungen, eine Erlaubnisliste für Tools und eine für Skills, ein Wissensbereich und eine **Sichtbarkeit** von `private` oder `org` mit hinterlegtem Besitzer. Jede Organisation bekommt eine mitgeliefert, `coding-agent`. Kein Bildschirm dieser Version listet, bearbeitet oder wählt eine Persona — der Chat-Composer hat keine Agenten-Auswahl, und der Chat-Assistent läuft mit einem festen, rein lesenden Tool-Satz —, Personas bewegen sich also über den Konfigurationsbaum und die eigene API der Plattform.

Die Regeln, die die API durchsetzt, sollte ein Admin kennen:

- **Wer sieht was.** Eine `org`-Persona sieht jedes Mitglied. Eine `private`-Persona sieht nur ihr Besitzer — ein Inhaber oder Admin kann sie nicht lesen, und eine Anfrage danach antwortet, als gäbe es sie nicht.
- **Wer ändert was.** Der Besitzer immer. Inhaber und Admins — wer die Einstellungen der Organisation schreiben darf — bearbeiten und löschen jede `org`-Persona, damit ein Mitglied, das geht, keine geteilte Konfiguration verwaist zurücklässt.
- **Besitz durch Übernahme.** Eine neue Persona gehört, wer sie angelegt hat, und startet `private`; stellst du eine geteilte Persona ohne hinterlegten Besitzer zurück auf `private`, wirst du ihr Besitzer — eine private Persona ohne Besitzer wäre für niemanden erreichbar.
- **Verlauf.** Jedes Speichern behält die abgelöste Datei in einer Verlaufsspur im Konfigurationsbaum der Organisation, sodass eine frühere Version nie verloren geht — du erreichst sie direkt auf der Platte; eine Wiederherstellung über die API gibt es nicht. Eine Persona, die sich nicht parsen lässt, wird mit ihrem Pfad gemeldet, statt still aus der Liste zu fallen.

Wer selbst hostet, erreicht die Dateien direkt — die Projektstruktur steht auf [AI-gestützte Entwicklung](/de/develop/ai-assisted-development), die CLI unter [Die tale-CLI installieren](/de/self-hosted/install/cli-install).

## Wo das hingehört

Die Steuerung von Agenten ist in dieser Version bewusst indirekt: Du formst, was jeder Agent nutzen darf — Provider, Connectors, Skills, Secrets, Budgets — und wer jedes Projekt bearbeiten darf, statt Agenten einzeln zu editieren. Die tägliche Arbeit passiert auf dem Tab **Agenten** jedes Projekts, den [Projekt-Agenten](/de/platform/projects/project-agents) durchgeht; das Persona-Modell steht in [Agent-Konzepte](/de/platform/agents/concepts); und die Rollen hinter den Regeln oben in [Mitglieder und Rollen](/de/platform/admin/members-and-roles).
