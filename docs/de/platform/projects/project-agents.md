---
title: Projektagenten erstellen und verwalten
description: Konfiguriere einen wiederverwendbaren Agenten, vergib seine Ausstattung und starte eine Aufgabe mit prüfbarem Ergebnis.
---

Erstelle einen Projektagenten, wenn ein wiederverwendbarer Agent die Aufgaben dieses Projekts bearbeiten soll. Er verbindet Coding-Laufzeit, Modell, Anweisungen und erlaubte Ausstattung. Du brauchst Bearbeitungszugriff auf das aktive Projekt. Secret-Zuordnungen dürfen nur Inhaber und Admins ändern.

## Die erste Aufgabe vorbereiten

Wähle ein kleines Ergebnis, etwa die Prüfung eines Launch-Briefings auf fehlende Freigaben. Der Agent braucht passende [Provider-Zugangsdaten](/de/platform/admin/providers) und eine verfügbare [Sandbox](/de/platform/admin/sandboxes). Eine gespeicherte Konfiguration belegt noch keinen erfolgreichen Sandbox-Lauf.

Trenne dauerhafte Anweisungen von der jeweiligen Aufgabe. „Erkenne fehlende Belege und berichte über deine Prüfungen“ gehört zum Agenten. Dokument, Prüfungstermin und Abnahmekriterien gehören zur Aufgabe.

<Frame caption="Der Tab Agenten — die eigenen Agenten des Projekts; jede Zeile nennt Agent-Laufzeit, Provider und Modell.">

![Der Tab Agenten des Projekts Website relaunch mit zwei benannten Agenten — Content editor auf Claude Code und Redirect auditor auf Codex — jede Zeile mit Provider und Modell-ID, neben dem Knopf Neuer Agent.](/images/platform/project-agents-models.webp)

</Frame>

## Den Agenten konfigurieren

<Steps>

<Step title="Namen und Laufzeit wählen">

Öffne den Tab **Agenten** des Projekts und wähle **Neuer Agent**. Gib unter **Name** einen erkennbaren Namen ein und wähle die **Agent-Laufzeit**, also den Coding-[Harness](/de/platform/agents/harnesses). Namen sind innerhalb des Projekts eindeutig; bis zu 50 Agenten sind möglich.

</Step>

<Step title="Modell und Provider auswählen">

Suche unter **Modell** nach Name oder API-ID. Dasselbe Modell kann pro Provider einmal erscheinen. Lies den Provider des Eintrags, bevor du ihn wählst. Damit legst du diese Kombination für künftige Läufe fest. Abonnementeinträge erscheinen nur bei kompatibler Laufzeit.

Eine ältere Konfiguration kann ein Modell ohne festgelegten Provider enthalten. Der Dialog zeigt, welcher Provider es derzeit bereitstellen würde oder warum kein Zugang verfügbar ist. Wähle einen Eintrag, wenn du den Provider festlegen möchtest.

</Step>

<Step title="Ausstattung vergeben und Anweisungen schreiben">

Füge unter **Skills, Connectors & Tools** die benötigten Bundles, Dienste und Plattformoperationen hinzu. Bei einem neuen Agenten sind die Dokument-Skills `docx`, `pptx`, `xlsx` und `pdf` vorausgewählt, sofern sie für das Projekt verfügbar sind. Sie enthalten Anleitungen für die Arbeit mit Word-, PowerPoint-, Excel- und PDF-Dateien. Entferne die Häkchen bei Skills, die der Agent nicht braucht. Beim Bearbeiten eines bestehenden Agenten bleibt seine gespeicherte Ausstattung erhalten. Verfügbare Skills folgen dem Team-Zugriff des Projekts, nicht nur deiner persönlichen Sichtbarkeit. Ein fehlender Skill kann deshalb eine andere Freigabe brauchen.

Beachte **Schreibt Daten**, bevor du ein Plattform-Schreib-Tool vergibst. Es erlaubt echte Operationen innerhalb seiner Zugriffsregeln. Der Connector-Broker bietet Agenten nur Leseaktionen; direkte GitHub-Werkzeuge und ausdrücklich vergebene Secrets haben eigene Zugangswege.

Die Connector-Aufrufe eines Laufs erfolgen im Namen des Mitglieds, das ihn gestartet hat, ob mit **Agent starten**, mit **Erneut ausführen**, durch Verschieben nach **In Bearbeitung** oder durch eine Erwähnung des Agenten mit @. Sie nutzen die [Connector-Zugangsdaten](/de/platform/admin/connectors) der Organisation und werden diesem Mitglied zugeordnet. Verlässt es die Organisation oder wird es deaktiviert, lehnt Tale die Aufrufe ab. Beende den Lauf dann mit **Lauf abbrechen** (oder lass ihn zu Ende laufen) und starte ihn selbst neu, damit er in deinem Namen arbeitet. Startet ein Kommentar den Lauf neu, um ihn zu lenken, wie bei allen Laufzeiten außer Claude Code, erfolgen die Aufrufe ab dann im Namen der Person, die den Kommentar geschrieben hat.

Beschreibe unter **Anweisungen** Verantwortung, Belege und Grenzen. Für den Launch-Prüfer etwa: „Lies das beigefügte Briefing. Berichte über fehlende Freigaben und widersprüchliche Termine mit der zugehörigen Textstelle. Schließe die Aufgabe nicht ab.“

</Step>

<Step title="Prüfen und speichern">

Braucht die Arbeit **Secrets**, ordnet ein Inhaber oder Admin benannte Zugangsdaten der Organisation zu. Der laufende Agent kann ihre Werte lesen. Verwende deshalb eng begrenzte, austauschbare Tokens. Ändert sich ein gemeinsam genutzter Wert, betrifft das auch andere Agenten und Workflow-Nodes mit diesem Namen. Ein Lauf, den ein Mitglied startet, erhält keines dieser Secrets und auch nicht das Token eines zugeordneten GitHub-Zugangs: Arbeit, die sie braucht, muss ein Redakteur oder eine höhere Rolle starten.

Wähle **Agent erstellen**. Prüfe Laufzeit, Provider und Modell der neuen Zeile. Öffne den Agenten erneut, um gespeicherte Ausstattung und Anweisungen zu kontrollieren.

</Step>

</Steps>

## Arbeit zuweisen und starten

Öffne eine Aufgabe desselben Projekts, wähle den Agenten als Zuständigen und klicke auf **Agent starten**. Zuweisung und Ausführung sind getrennte Aktionen. Ergänze Dateien und Abnahmekriterien vor dem Start. Bearbeitungszugriff auf das Projekt brauchst du dafür nicht: Mitglieder lassen einen Agenten an Aufgaben arbeiten, die sie erstellt haben oder die ihnen zugewiesen sind, Redakteure und höhere Rollen an jeder Aufgabe des Projekts. Ein Lauf, den ein Mitglied startet, bleibt bei dieser Aufgabe, ohne die Secrets des Agenten und in einem eigenen Arbeitsbereich; [Agentenläufe, die ein Mitglied startet](/de/platform/projects/tasks#agentenlaeufe-die-ein-mitglied-startet) zählt auf, was sich ändert.

Der Bericht erscheint als Aufgabenkommentar; gesammelte Dateien werden als Ergebnisse angehängt. Nach erfolgreicher Agentenarbeit steht die Aufgabe **In Prüfung**, damit eine Person sie beurteilt. Erwähne den Agenten in einem Kommentar, um die Arbeit zu lenken oder fortzusetzen. Der Harness bestimmt, ob der Hinweis in den laufenden Prozess gelangt oder eine Fortsetzung startet.

Die [Aufgaben-Automatisierung](/de/platform/projects/task-automation) erklärt Fortschritt, Stoppen und Prüfung. Der gewöhnliche Chat-Assistent bleibt davon getrennt, auch mit Projektkontext.

## Einen Agenten ändern oder entfernen

Bearbeite oder lösche den Agenten über sein Zeilenmenü. Änderungen gelten für spätere Läufe; ein aktiver Lauf behält seine Startkonfiguration. Die Löschung entfernt Agentenzuweisungen von Aufgaben, erhält aber deren Verlauf. Prüfe laufende Arbeit, bevor du den zugehörigen Agenten entfernst.

Lies bei einem Fehler die Begründung. Ein doppelter Name, fehlender Projektzugriff, ein nicht verfügbares Modell, unsichtbare Skills und fehlende Sandbox-Kapazität sind unterschiedliche Ursachen. Neue Anweisungen beheben diese Voraussetzungen nicht.
