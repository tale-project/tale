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

**Skills, Connectors & Tools** bestimmen, was der Agent jenseits seines Workspace erreicht; die Liste folgt dem Team-Zugriff des Projekts, nicht deiner persönlichen Sichtbarkeit. Skills stellen Referenz-Bundles in die Sandbox, Connectors vermitteln einen verbundenen Dienst, und **Plattform-Tools** lassen den Agenten die eigenen Daten deiner Organisation lesen und schreiben — Aufgaben, Kontakte, Produkte, Dokumente und Wissen finden und lesen und, wenn du ein Schreib-Tool gibst, Aufgaben erstellen, kommentieren, zwischen Spalten verschieben, ein externes Element mit einer Aufgabe abgleichen oder ein Dokument speichern. Ein Schreib-Tool ist mit _Schreibt Daten_ markiert: Das Gewähren ist die Berechtigung, ein Agent mit `Aufgaben erstellen` legt also ohne weitere Freigabe echte Aufgaben an. Lesen und Schreiben bleiben auf das Projekt beschränkt — ein Agent sieht nie das Board eines anderen Projekts.

**Secrets** geben dem Agenten einen API-Schlüssel als Umgebungsvariable — der Ausweg für einen Dienst ohne Connector. Lege eines an (ein Name wie `GLITCHTIP_TOKEN` und das Token), und der Agent erhält es in seiner Shell und ruft die API dieses Dienstes direkt auf, mit der Doku des Anbieters. Der Wert wird verschlüsselt gespeichert und nie wieder angezeigt; hinterlege nur gering privilegierte, rotierbare Tokens, denn der laufende Agent kann sie lesen. Secrets gehören der Organisation, dasselbe wird also über mehrere Agenten hinweg genutzt und an einer Stelle rotiert.

**Anweisungen** reisen bei jedem Lauf als stehende Anweisung mit — was dieser Agent verantwortet, wie er arbeiten soll und welche Grenzen er einhalten muss.

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
