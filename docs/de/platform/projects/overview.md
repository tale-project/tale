---
title: Projekte
description: Halte Referenzmaterial, Gespräche und Aufgaben eines Teams für ein gemeinsames Vorhaben zusammen.
---

Ein Projekt vereint Dateien, Anweisungen, Gespräche und Aufgaben für ein Vorhaben. Nutze es, wenn Kontext über einen einzelnen Chat hinaus erhalten bleiben soll oder ein Ergebnis Zuständigkeit und Prüfung braucht. Mit [Projekte nutzen](/de/tutorials/member/use-projects) erstellst du ein Projekt und stellst eine Frage zu seiner Referenzdatei.

<Video src="/videos/de/tutorials/ep6-projects/ep6-projects.de.mp4" poster="/videos/de/tutorials/ep6-projects/ep6-projects.de.webp" captions="/videos/de/tutorials/ep6-projects/ep6-projects.de.vtt" lang="de" title="Episode 6 — Projekte mit KI" caption="Episode 6 — Projekte mit KI (2:47)">

</Video>

<Frame caption="Die Aufgabenübersicht zeigt Vorschläge, laufende Arbeit und Ergebnisse zur Prüfung nebeneinander.">

![Website relaunch zeigt Aufgabenkarten in Backlog, Zu erledigen, In Bearbeitung, In Prüfung, Erledigt und Abgebrochen.](/images/platform/projects-task-board.webp)

</Frame>

## Den nächsten Schritt finden

<CardGroup cols="2">

<Card title="Projektzugriff verstehen" icon="compass" href="/de/platform/projects/concepts">
Erfahre, was das Projekt teilt, welche Chats persönlich bleiben und wie Teams den Zugriff bestimmen.
</Card>

<Card title="Referenzdateien verwalten" icon="folder-open" href="/de/platform/projects/manage-files">
Lade Dateien hoch, ordne sie, prüfe die Indexierung und verwalte gelenkte Revisionen.
</Card>

<Card title="Aufgaben erstellen und verfolgen" icon="list-checks" href="/de/platform/projects/tasks">
Lege Zuständigkeit, Prüfung, Termine und Abnahmekriterien fest und verfolge den Fortschritt.
</Card>

<Card title="Einen Projektagenten einrichten" icon="bot" href="/de/platform/projects/project-agents">
Wähle Harness, Modell, Tools und Anweisungen für einen Agenten, der Aufgaben übernimmt.
</Card>

<Card title="Agentenarbeit starten und prüfen" icon="workflow" href="/de/platform/projects/task-automation">
Starte eine Aufgabe, prüfe das Ergebnis, fordere Nacharbeit an und behebe fehlgeschlagene Läufe.
</Card>

<Card title="Vorgeschlagene Arbeit sichten" icon="gauge" href="/de/platform/projects/backlog">
Prüfe Ideen im Backlog, bevor du sie in die geplante Arbeit des Teams übernimmst.
</Card>

</CardGroup>

Alle Projekte, die du öffnen kannst, stehen im Bereich [Start](/de/platform#home) unter **Projekte**; **Alle Projekte** öffnet dort die vollständige Liste. Ein Projekt öffnet sich mit seinem Aufgaben-Board, und **Allgemein**, **Chats**, **Wissen** und **Agenten** ergänzen die Aufgabenansichten. Für Inhaber, Admins und Entwickler fügt eine zugeordnete Automatisierung **Automatisierungen** hinzu; Projektadministratoren können die [**Umgebung**](#environment-credentials) konfigurieren. Installierte Apps können weitere Tabs ergänzen. Für den Einstieg mit Dateien, Chats und Aufgaben sind sie nicht nötig.

## Zugangsdaten für das Projekt {#environment-credentials}

Öffne im Projekt den Tab **Umgebung**, um verschlüsselte Zugangsdaten für dieses Projekt zu speichern. Nur Projektadministratoren sehen den Tab und können die gespeicherten Namen ansehen und Zugangsdaten verwalten. In einem archivierten Projekt ist der Tab schreibgeschützt. Stelle das Projekt wieder her, bevor du Zugangsdaten änderst.

Wähle **Variable hinzufügen**, gib einen Namen wie `SERVICE_TOKEN` und den Wert ein und wähle **Speichern**. Der Editor verlangt eindeutige Namen nach `^[A-Za-z_][A-Za-z0-9_]*$`: Buchstaben, Ziffern und Unterstriche, wobei am Anfang keine Ziffer stehen darf. Der Server wandelt Namen zusätzlich in Großbuchstaben um und verlangt einen Buchstaben am Anfang sowie höchstens 64 Zeichen. Verwende daher Großbuchstaben und beginne mit einem Buchstaben. Namen, die sich nur in der Groß- und Kleinschreibung unterscheiden, bezeichnen dieselben gespeicherten Zugangsdaten.

Gespeicherte Werte werden nie wieder angezeigt. Um einen Wert zu ersetzen, gib den neuen Wert in der bestehenden Zeile ein und wähle **Speichern**. Zum Löschen wählst du **Entfernen**, bestätigst und wählst anschließend **Speichern**.

Der Tab beschreibt Zugangsdaten für Aufgaben-Runtimes wie Hermes und OpenClaw. Derzeit werden die Zugangsdaten des Projekts jedoch nur gespeichert und nicht an Agentenläufe übergeben. Damit ein laufender Agent Umgebungsvariablen erhält, nutze die Zugangsdaten der Organisation, die du beim [Einrichten des Agenten](/de/platform/projects/project-agents#den-agenten-konfigurieren) unter **Secrets** freigibst. Diese Freigaben gelangen zur Laufzeit an die Aufgaben-Runtime, auch an Agentenknoten einer Automatisierung mit eigenen Freigaben. Ein von einem Mitglied gestarteter Lauf erhält keine davon. Der normale Chat-Assistent erhält diese Umgebungsvariablen nicht.

Kann die Liste der Zugangsdaten beim ersten Laden nicht abgerufen werden, bleibt der Editor ausgeblendet. Wähle vor dem Bearbeiten **Erneut versuchen**. Schlägt eine Aktualisierung fehl, bleiben die letzte Liste und dein Entwurf erhalten; eine Warnung weist auf die möglicherweise veraltete Anzeige hin.
