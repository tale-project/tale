---
title: Projekt-Agenten
description: Der Tab Agenten besetzt ein Projekt mit benannten Agenten — jeder mit Agent-Laufzeit, einem Modell samt gewähltem Provider, Ausrüstung und stehenden Anweisungen —, die die Aufgaben des Projekts in einer isolierten Sandbox erledigen.
---

Der Tab **Agenten** eines Projekts ist seine Crew: benannte Agenten, die du einmal konfigurierst und denen du dann Arbeit zuweist — jeder kombiniert ein Coding-[Harness](/de/platform/agents/harnesses), ein Modell, Skills und Connectors sowie stehende Anweisungen. Der Chat läuft weiter über den eingebauten Assistenten — diese Agenten sind für das Board da: Weise einem eine Aufgabe zu, und er arbeitet in einer isolierten Sandbox und meldet sich zur Prüfung zurück. Verwalten kann sie, wer das Projekt bearbeiten darf; ein Projekt fasst bis zu 50.

<Frame caption="Der Tab Agenten — die eigenen Agenten des Projekts; jede Zeile nennt Agent-Laufzeit, Provider und Modell.">

![Der Tab Agenten eines Projekts mit benannten Agenten, jeweils mit Agent-Laufzeit, Provider, Modell-ID und Ausrüstungszahl.](/images/platform/project-agents-models.webp)

</Frame>

## Einen Agenten anlegen

<Steps>

<Step title="Tab öffnen und loslegen">

Öffne den Tab **Agenten** des Projekts und klicke auf **Neuer Agent**. Gib unter **Name** einen Namen, den dein Team auf Aufgabenkarten wiedererkennt, und wähle die **Agent-Laufzeit** — die Coding-CLI, auf der der Agent läuft.

</Step>

<Step title="Modell wählen — und damit den Provider">

Die Liste unter **Modell** ist durchsuchbar; ein Modell, das mehrere Provider anbieten, erscheint einmal pro Provider, mit dem Provider unter jedem Eintrag. Die Wahl ist exakt: Die Läufe des Agenten rufen dieses Modell über diesen Provider auf — und die Kosten landen auf dessen Zugang. Kann der gewählte Provider das Modell nicht mehr bedienen, schlägt der Lauf mit der Begründung fehl, statt still auf die Rechnung eines anderen Providers auszuweichen.

Abo-Einträge — etwa ein Claude-Abo — erscheinen nur, solange die **Agent-Laufzeit** das Harness ist, das dieses Abo antreibt; ein Lauf darauf authentifiziert sich mit dem Abo des Anbieters statt mit einem API-Schlüssel der Organisation.

</Step>

<Step title="Ausrüsten und Anweisungen setzen">

**Skills & Connectors** bestimmen, was der Agent jenseits seines Workspace erreicht; die Liste folgt dem Team-Zugriff des Projekts, nicht deiner persönlichen Sichtbarkeit. **Anweisungen** reisen bei jedem Lauf als stehende Anweisung mit — was dieser Agent verantwortet, wie er arbeiten soll und welche Grenzen er einhalten muss.

</Step>

</Steps>

Klicke auf **Agent erstellen**. Die Zeile nennt Agent-Laufzeit, Provider, Modell und die Ausrüstungszahl — dieselbe Zusammenfassung, die dein Team beim Zuweisen sieht.

## Arbeit zuweisen

Weise dem Agenten eine Board-Aufgabe zu und klicke auf der Aufgabe auf **Agent starten**. Der Lauf arbeitet in einer isolierten Sandbox mit einem stehenden Workspace, der über die Aufgaben des Agenten hinweg bestehen bleibt, schreibt seinen Bericht als Kommentar an die Aufgabe zurück, hängt erzeugte Dateien als **Ergebnisdateien** an und parkt die Aufgabe **In Prüfung** — Agenten schließen keine Arbeit ab; das tut ein Mensch. Kommentiere die Aufgabe und erwähne den Agenten mit @, um einen laufenden Lauf zu lenken — oder einen frischen zu starten, der deinen Kommentar zuerst liest. [Aufgaben-Automatisierung](/de/platform/projects/task-automation) beschreibt die Board-Schleife von Anfang bis Ende.

## Ändern oder entfernen

Änderungen greifen ab dem nächsten Lauf — ein laufender behält die Konfiguration, mit der er gestartet ist; erst der nächste Lauf übernimmt deine Änderungen. Löschst du einen Agenten, behalten alle Aufgaben ihre Historie; nur die Zuweisung wird leer.

## Chat-Assistent oder Projekt-Agent?

| Nimm…                 | wenn die Arbeit…                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| den Chat              | ein Gespräch ist — Fragen, Entwürfe, Recherche; das erledigt der eingebaute Assistent.          |
| einen Projekt-Agenten | eine Aufgabe ist — Repo- oder Dateiarbeit auf einem Harness, erledigt von einer stehenden Crew. |

## Wo das hingehört

Der Agent bündelt projektseitig, was andere Seiten erklären: Der Harness-Katalog und seine Fähigkeiten stehen unter [Harnesses](/de/platform/agents/harnesses); welche Provider und Zugänge die Modelle bedienen — hinterlegte Schlüssel über das gemessene Gateway oder Anbieter-Abos auf dem Konto des Anbieters — ist Sache von [KI-Anbieter](/de/platform/admin/providers).
