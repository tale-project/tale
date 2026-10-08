---
title: Projektagenten erstellen und verwalten
description: Konfiguriere einen wiederverwendbaren Agenten, vergib seine Ausstattung und starte eine Aufgabe mit prüfbarem Ergebnis.
---

Erstelle einen Projektagenten, wenn ein wiederverwendbarer Agent die Aufgaben dieses Projekts bearbeiten soll. Er verbindet Coding-Laufzeit, Modell, Anweisungen und erlaubte Ausstattung. Du brauchst Bearbeitungszugriff auf das aktive Projekt. Mitglieder sehen die Agenten des Projekts im Tab **Agenten**, der ihnen sagt, dass sie einen Redakteur oder Admin um einen neuen bitten können. Bis ein Projekt eigene Agenten hat, können seine Aufgaben an den [Standard-Agenten](#standard-agent) der Organisation gehen. Secret-Zuordnungen dürfen nur Inhaber und Admins ändern.

## Die erste Aufgabe vorbereiten

Wähle ein kleines Ergebnis, etwa die Prüfung eines Launch-Briefings auf fehlende Freigaben. Der Agent braucht passende [Provider-Zugangsdaten](/de/platform/admin/providers) und eine verfügbare [Sandbox](/de/platform/admin/sandboxes). Eine gespeicherte Konfiguration belegt noch keinen erfolgreichen Sandbox-Lauf.

Trenne dauerhafte Anweisungen von der jeweiligen Aufgabe. „Erkenne fehlende Belege und berichte über deine Prüfungen“ gehört zum Agenten. Dokument, Prüfungstermin und Abnahmekriterien gehören zur Aufgabe.

<Frame caption="Der Tab Agenten — die eigenen Agenten des Projekts; jede Zeile nennt Agent-Laufzeit, Provider und Modell.">

![Der Tab Agenten des Projekts Website relaunch mit zwei benannten Agenten — Content editor auf Claude Code und Redirect auditor auf Codex — jede Zeile mit Provider und Modell-ID, neben dem Knopf Neuer Agent.](/images/platform/project-agents-models.webp)

</Frame>

## Den Agenten konfigurieren

<Steps>

<Step title="Namen und Laufzeit wählen">

Öffne den Tab **Agenten** des Projekts und wähle **Neuer Agent**. Gib unter **Name** einen erkennbaren Namen ein und wähle die **Agent-Laufzeit**, also das [Programm für seine Ausführung](/de/platform/agents/harnesses). Namen sind innerhalb des Projekts eindeutig; bis zu 50 Agenten sind möglich.

Aus dem Namen macht Tale ein Handle; tippst du es nach `@`, findest du den Agenten: Aus „My Opus Agent #3“ wird `@my-opus-agent-3`. Ist das Handle schon vergeben, an einen anderen Agenten des Projekts oder an ein Mitglied oder eine Automatisierung, die man damit bereits erwähnt, bekommt der Agent das nächste freie: `-02`, dann `-03`. Das Handle steht im Tab **Agenten** und unter **Name**, wenn du den Agenten bearbeitest. Benennst du den Agenten um, ändert sich sein Handle; frühere Erwähnungen nennen weiter diesen Agenten und zeigen seinen neuen Namen.

Du kannst auch bei einer Aufgabe beginnen: Solange das Projekt keinen Agenten hat, öffnet **Agent erstellen …** unter **Zuständig** den Dialog **Neuer Agent** über der Aufgabe und weist ihr den Agenten zu, den du erstellst.

</Step>

<Step title="Modell und Provider auswählen">

Suche unter **Modell** nach Name oder API-ID. Dasselbe Modell kann pro Provider einmal erscheinen. Lies den Provider des Eintrags, bevor du ihn wählst. Damit legst du diese Kombination für künftige Läufe fest. Abonnementeinträge erscheinen nur bei kompatibler Laufzeit, und ein Modell, das Tools nur über die Responses-API von OpenAI aufruft, etwa GPT-6.1 Sol, erscheint nur bei Codex.

Eine ältere Konfiguration kann ein Modell ohne festgelegten Provider enthalten. Der Dialog zeigt, welcher Provider es derzeit bereitstellen würde oder warum kein Zugang verfügbar ist. Wähle einen Eintrag, wenn du den Provider festlegen möchtest.

</Step>

<Step title="Ausstattung vergeben und Anweisungen schreiben">

Füge unter **Skills, Connectors & Tools** die benötigten Bundles, Dienste und Plattformoperationen hinzu. Bei einem neuen Agenten sind die Dokument-Skills `docx`, `pptx`, `xlsx` und `pdf` vorausgewählt, sofern sie für das Projekt verfügbar sind. Sie enthalten Anleitungen für die Arbeit mit Word-, PowerPoint-, Excel- und PDF-Dateien. Entferne die Häkchen bei Skills, die der Agent nicht braucht. Beim Bearbeiten eines bestehenden Agenten bleibt seine gespeicherte Ausstattung erhalten. Verfügbare Skills folgen dem Team-Zugriff des Projekts, nicht nur deiner persönlichen Sichtbarkeit. Ein fehlender Skill kann deshalb eine andere Freigabe brauchen.

<Frame caption="Das Skills-Menü eines neuen Agenten mit bereits eingeschalteten Dokument-Skills; bei jedem Skill steht, wer ihn erstellt hat.">

![Der Dialog Neuer Agent mit geöffnetem Skills-Menü: docx, pdf, pptx und xlsx sind eingeschaltet und als Mitgeliefert gekennzeichnet, brief-summary und release-notes von Alex Rivera sowie visual-aspect-analyzer bleiben aus.](/images/platform/project-agent-document-skills.webp)

</Frame>

Das Suchfeld des Menüs grenzt Skills, Connectors und Tools beim Tippen ein. **Wissen durchsuchen** steht unter **Wissen** als immer aktiv: Jeder Agent durchsucht das Wissen des Projekts, ohne Freigabe.

Beachte **Schreibt Daten**, bevor du ein Plattform-Schreib-Tool vergibst. Es erlaubt echte Operationen innerhalb seiner Zugriffsregeln. Der Connector-Broker bietet Agenten nur Leseaktionen; direkte GitHub-Werkzeuge und ausdrücklich vergebene Secrets haben eigene Zugangswege.

Mit **Aufgabenpriorität und Agentenzuweisung ändern** darf ein Projekt-Agent bestehende Aufgaben priorisieren, einem Agenten desselben Projekts zuweisen oder die Zuweisung aufheben, ohne Arbeit zu starten. Diese Freigabe ist zunächst ausgeschaltet und steht Agent-Nodes in Automatisierungen nicht zur Verfügung. Der Agent muss die Aufgabe zuerst lesen und bei einer Änderung die gelesenen Werte mitgeben. Hat jemand diese Werte inzwischen geändert, wird die gesamte Anfrage abgelehnt; der Agent muss erneut lesen. Ein Wechsel der Zuständigkeit ist nur bei offenen Aufgaben ohne laufende Ausführung, ausstehende Prüfung oder offene Frage möglich. Eine reine Prioritätsänderung lässt diese Übergaben bestehen. Das Tool ändert weder Status noch Prüfer, beantwortet keine Frage an einen Menschen und startet keinen Lauf. Es steht nur einem aktiven Lauf mit projektweiten Rechten zur Verfügung, nicht einem Lauf, den ein Mitglied gestartet hat.

**Aufgabenergebnisse anderer Agenten prüfen** erlaubt einem benannten Reviewer, über ein abgeschlossenes Ergebnis eines anderen Projektagenten zu entscheiden. Die Berechtigung ist anfangs ausgeschaltet und steht Agent-Nodes in Automatisierungen nicht zur Verfügung. Einen Agenten als Reviewer auszuwählen, erteilt weder diese Berechtigung noch startet es einen Lauf. Er prüft von seiner eigenen Aufgabe aus, mit aktuellen projektweiten Rechten und weiterhin erteilter Review-Berechtigung. Die Entscheidung hält Rückmeldung und Belege fest: Eine Freigabe schließt die geprüfte Aufgabe ab, eine Änderungsanforderung stellt sie ohne neuen Lauf auf **Zu erledigen**. Erforderliche menschliche Kompetenzen und Workflow-Genehmigungen bleiben geschützt. [Einen unabhängigen Reviewer einrichten](/de/platform/projects/task-automation#agent-review) beschreibt den Ablauf.

Mit **Andere Agenten auf Aufgaben starten** kann der Agent einen anderen Agenten dieses Projekts an die Arbeit schicken, etwa als Manager-Agent, der startbereite Arbeit verteilt und einen Agenten weiterarbeiten lässt, nachdem er dessen Frage beantwortet hat. Er nennt dazu eine Aufgabe, optional den Agenten, dem sie zugewiesen werden soll, und eine Nachricht, auf die der gestartete Lauf als Erstes eingeht. Der gestartete Lauf arbeitet im selben Auftrag wie der Lauf des Managers und nennt den Manager als den Agenten, der ihn gestartet hat. Ein so gestarteter Agent kann keine weiteren Agenten starten, ein Lauf, den ein Mitglied gestartet hat, kann gar keine starten, und weder ein Agent, der schon an einer anderen Aufgabe arbeitet, noch eine Aufgabe, die von einer offenen Aufgabe blockiert wird, wird gestartet. Vergib dieses Tool nur an einen Agenten, dessen Anweisungen festlegen, welche Arbeit er verteilen darf. Was ein solcher Lauf darf, beschreibt die [Aufgaben-Automatisierung](/de/platform/projects/task-automation#arbeit-die-eine-automatisierung-oder-ein-anderer-agent-startet).

Mit **Wissenseinträge hinzufügen und bearbeiten** kann der Agent Informationen als [Wissenseinträge](/de/platform/knowledge/knowledge-entries#einen-agenten-informationen-aktuell-halten-lassen) der ganzen Organisation speichern, einen pro Thema. Um einen Eintrag zu ändern, muss er die Version nennen, die er gelesen hat; hat sich der Eintrag inzwischen geändert, wird nichts gespeichert und der Agent führt seine Änderung im aktuellen Text zusammen. Einträge löschen kann er nicht, und ein Lauf, den ein Mitglied gestartet hat, kann keine speichern. Vergib das Tool an einen Agenten, dessen Anweisungen festlegen, welche Informationen sich zu behalten lohnen.

Die Connector-Aufrufe eines Laufs erfolgen im Namen des Mitglieds, das ihn gestartet hat, ob mit **Agent starten**, mit **Erneut ausführen**, durch Verschieben nach **In Bearbeitung** oder durch eine Erwähnung des Agenten mit @. Sie nutzen die [Connector-Zugangsdaten](/de/platform/admin/connectors) der Organisation und werden diesem Mitglied zugeordnet. Verlässt es die Organisation oder wird es deaktiviert, lehnt Tale die Aufrufe ab. Beende den Lauf dann mit **Lauf abbrechen** (oder lass ihn zu Ende laufen) und starte ihn selbst neu, damit er in deinem Namen arbeitet. Startet ein Kommentar den Lauf neu, um ihn zu lenken, wie bei allen Laufzeiten außer Claude Code, erfolgen die Aufrufe ab dann im Namen der Person, die den Kommentar geschrieben hat.

Beschreibe unter **Anweisungen** Verantwortung, Belege und Grenzen. Für den Launch-Prüfer etwa: „Lies das beigefügte Briefing. Berichte über fehlende Freigaben und widersprüchliche Termine mit der zugehörigen Textstelle. Schließe die Aufgabe nicht ab.“

</Step>

<Step title="Prüfen und speichern">

Braucht die Arbeit **Secrets**, ordnet ein Inhaber oder Admin benannte Zugangsdaten der Organisation zu. Der laufende Agent kann ihre Werte lesen. Verwende deshalb eng begrenzte, austauschbare Tokens. Ändert sich ein gemeinsam genutzter Wert, betrifft das auch andere Agenten und Workflow-Nodes mit diesem Namen. Ein Lauf, den ein Mitglied startet, erhält keines dieser Secrets und auch nicht das Token eines zugeordneten GitHub-Zugangs: Arbeit, die sie braucht, muss ein Redakteur oder eine höhere Rolle starten.

Nutze für ein privates Repository einen auf dieses Repository beschränkten Schlüssel und lege die erlaubten Git-Operationen in den Anweisungen fest. Läufe mit Zugangsdaten verwenden den Git-Autorennamen und die E-Mail des Workspace-Besitzers auch ohne GitHub-Connector-Freigabe. Lass die SSH-Hostprüfung eingeschaltet. Eine selbst gehostete Sandbox leitet Repository-SSH über ihren bestehenden Proxy weiter; [SSH-Zugang zu Repositories](/de/self-hosted/configuration/environment-reference#ssh-repository-access) beschreibt die Einrichtung.

Wähle **Agent erstellen**. Prüfe Laufzeit, Provider und Modell der neuen Zeile. Öffne den Agenten erneut, um gespeicherte Ausstattung und Anweisungen zu kontrollieren.

</Step>

</Steps>

## Arbeit zuweisen und starten

Öffne eine Aufgabe desselben Projekts, wähle den Agenten als Zuständigen und klicke auf **Agent starten**. Zuweisung und Ausführung sind getrennte Aktionen. Ergänze Dateien und Abnahmekriterien vor dem Start. Bearbeitungszugriff auf das Projekt brauchst du dafür nicht: Mitglieder lassen einen Agenten an Aufgaben arbeiten, die sie erstellt haben oder die ihnen zugewiesen sind, Redakteure und höhere Rollen an jeder Aufgabe des Projekts. Ein Lauf, den ein Mitglied startet, bleibt bei dieser Aufgabe, ohne die Secrets des Agenten und in einem eigenen Arbeitsbereich; [Agentenläufe, die ein Mitglied startet](/de/platform/projects/tasks#agentenlaeufe-die-ein-mitglied-startet) zählt auf, was sich ändert.

Der Bericht erscheint als Aufgabenkommentar; gesammelte Dateien werden als Ergebnisse angehängt. Hat ein Admin die [Bildgenerierung](/de/platform/admin/governance/content-models#let-agents-generate-images) eingeschaltet, kann der Agent für die Aufgabe auch Bilder erstellen. Sie erscheinen bei den Ergebnisdateien und zählen für das Mitglied, das den Lauf gestartet hat. Nach erfolgreicher Agentenarbeit steht die Aufgabe **In Prüfung**, damit der benannte menschliche Reviewer oder unabhängige Reviewer-Agent sie beurteilt. Erwähne den Agenten in einem Kommentar, um die Arbeit zu lenken oder fortzusetzen. Die Agent-Laufzeit bestimmt, ob der Hinweis in den laufenden Prozess gelangt oder eine Fortsetzung startet.

Die [Aufgaben-Automatisierung](/de/platform/projects/task-automation) erklärt Fortschritt, Stoppen und Prüfung. Der gewöhnliche Chat-Assistent bleibt davon getrennt, auch mit Projektkontext.

## Der Standard-Agent {#standard-agent}

Auch ein Projekt ohne eigene Agenten kann Arbeit an einen Agenten übergeben. Sofern ein Admin ihn unter [Richtlinien > Modelle](/de/platform/admin/governance/content-models#standard-agent) nicht ausgeschaltet hat, bietet **Zuständig** dort die Option **Standard-Agent** an, und zwar allen, die die Aufgabe zuweisen können, auch Mitgliedern. Wählt jemand sie zum ersten Mal, richtet Tale den Agenten im Projekt ein und weist ihm die Aufgabe zu. Danach startest du ihn wie jeden anderen Agenten oder erwähnst ihn in einem Kommentar. Kann er für dich nicht starten, sagt das Kommentarfeld es dir, und dein Kommentar wird als einfache Erwähnung gespeichert.

<Frame caption="Der Tab Agenten eines Projekts, dessen Aufgaben an den Standard-Agenten gehen.">

![Der Tab Agenten des Projekts Customer onboarding portal mit einer Zeile: der Standard-Agent mit dem Abzeichen Standard, Claude Code, OpenRouter, dem Modell anthropic/claude-haiku-4.5 und vier Ausstattungen. Ein Hinweis sagt, dass Tale ihn für dieses Projekt eingerichtet hat und Agent-Laufzeit, Modell und Anweisungen den Einstellungen der Organisation folgen. Die Zeile hat eine Schaltfläche zum Löschen, aber keine zum Bearbeiten.](/images/platform/project-agents-standard.webp)

</Frame>

Der Tab **Agenten** führt ihn mit dem Abzeichen **Standard**. Niemand bearbeitet ihn: Agent-Laufzeit, Modell und Anweisungen folgen den Einstellungen der Organisation, die Tale bei jedem Start eines Laufs neu liest, und seine Ausstattung sind die Dokument-Skills `docx`, `pptx`, `xlsx` und `pdf`, die das Projekt beim Start eines Laufs nutzen kann. Schaltet ein Admin einen davon ab, fällt er weg, statt den Agenten aufzuhalten. Auf **Automatisch** nutzt jeder Lauf ein Modell, das die Person, die ihn startet, nutzen darf. Er kann also für verschiedene Personen mit verschiedenen Modellen laufen.

Um dem Projekt einen eigenen Agenten zu geben, wähle **Neuer Agent**. Ab dann bietet das Projekt den Standard-Agenten nicht mehr an; der bereits eingerichtete bleibt zuweisbar, bis du ihn löschst. Beim Löschen bleibt der Verlauf seiner Aufgaben erhalten, und solange das Projekt keine Agenten hat, richtet die nächste Aufgabe für den Standard-Agenten ihn wieder ein.

## Einen Agenten ändern oder entfernen

Bearbeite oder lösche den Agenten über sein Zeilenmenü. Der Standard-Agent hat nur **Agent löschen**. Änderungen gelten für spätere Läufe; ein aktiver Lauf behält seine Startkonfiguration. Die Löschung entfernt Agentenzuweisungen von Aufgaben, erhält aber deren Verlauf. Sie löscht außerdem die [Sandbox-Arbeitsbereiche](/de/platform/admin/sandboxes#explain-why-a-workspace-disappeared) des Agenten samt Dateien, auch die der Mitglieder. Prüfe laufende Arbeit und sichere benötigte Ergebnisse, bevor du den zugehörigen Agenten entfernst.

Scheitert das Erstellen, lies die Begründung: Ein doppelter Name, fehlender Projektzugriff, ein nicht verfügbares Modell und unsichtbare Skills sind unterschiedliche Ursachen. Ein Lauf, der endgültig scheitert, sagt oben in seiner Aufgabe, was schiefging und wer es beheben kann; [Wenn der Agent nicht fertig wird](/de/platform/projects/task-automation#wenn-der-agent-nicht-fertig-wird) zählt die Fälle auf. Neue Anweisungen beheben diese Voraussetzungen nicht.
