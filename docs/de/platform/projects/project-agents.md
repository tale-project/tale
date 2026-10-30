---
title: Projektagenten erstellen und verwalten
description: Konfiguriere einen Agenten für die Aufgaben eines Projekts, vergib seine Ausstattung und starte eine Aufgabe mit prüfbarem Ergebnis.
---

Erstelle einen Projektagenten, wenn eine wiederverwendbare Konfiguration die Aufgaben dieses Projekts bearbeiten soll. Er verbindet Coding-Laufzeit, Modell, Anweisungen und erlaubte Ausstattung. Jede Aufgabe, an der er arbeitet, läuft in einem [Worker](#run-one-agent-on-several-tasks), einer laufenden Kopie des Agenten in einer eigenen Sandbox. Du brauchst Bearbeitungszugriff auf das aktive Projekt. Mitglieder sehen die Agenten des Projekts im Tab **Agenten**, der ihnen sagt, dass sie einen Redakteur oder Admin um einen neuen bitten können. Bis ein Projekt eigene Agenten hat, können seine Aufgaben an den [Standard-Agenten](#standard-agent) der Organisation gehen. Secret-Zuordnungen und die Zugangsdaten, mit denen ein Agent [auf Repositorys zugreift](#repository-access), dürfen nur Inhaber und Admins ändern.

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

Aus dem Namen macht Tale ein Handle; tippst du es nach `@`, findest du den Agenten: Aus „My Opus Agent #3“ wird `@my-opus-agent-3`. Ist das Handle schon vergeben, an einen anderen Agenten des Projekts oder an ein Mitglied oder eine Automatisierung, die man damit bereits erwähnt, bekommt der Agent das nächste freie: `-02`, dann `-03`. Hört später ein Mitglied oder eine Automatisierung auf das Handle des Agenten, wechselt der Agent ebenso zum nächsten freien. Das Handle steht im Tab **Agenten** und unter **Name**, wenn du den Agenten bearbeitest. Benennst du den Agenten um, ändert sich sein Handle; frühere Erwähnungen nennen weiter diesen Agenten und zeigen seinen neuen Namen.

Du kannst auch bei einer Aufgabe beginnen: Solange das Projekt keinen Agenten hat, öffnet **Agent erstellen …** unter **Zuständig** den Dialog **Neuer Agent** über der Aufgabe und weist ihr den Agenten zu, den du erstellst.

</Step>

<Step title="Modell und Provider auswählen">

Suche unter **Modell** nach Name oder API-ID. Dasselbe Modell kann pro Provider einmal erscheinen. Lies den Provider des Eintrags, bevor du ihn wählst. Damit legst du diese Kombination für künftige Läufe fest. Abonnementeinträge erscheinen nur bei kompatibler Laufzeit, und ein Modell, das Tools nur über die Responses-API von OpenAI aufruft, etwa GPT-6.1 Sol, erscheint nur bei Codex.

Eine ältere Konfiguration kann ein Modell ohne festgelegten Provider enthalten. Der Dialog zeigt, welcher Provider es derzeit bereitstellen würde oder warum kein Zugang verfügbar ist. Wähle einen Eintrag, wenn du den Provider festlegen möchtest.

</Step>

<Step title="Ausstattung vergeben und Anweisungen schreiben">

Füge unter **Skills, Connectors & Tools** die benötigten Bundles, Dienste und Plattformoperationen hinzu. Bei einem neuen Agenten sind die Dokument-Skills `docx`, `pptx`, `xlsx` und `pdf` vorausgewählt, sofern sie für das Projekt verfügbar sind. Sie enthalten Anleitungen für die Arbeit mit Word-, PowerPoint-, Excel- und PDF-Dateien. Entferne die Häkchen bei Skills, die der Agent nicht braucht. Beim Bearbeiten eines bestehenden Agenten bleibt seine gespeicherte Ausstattung erhalten. Verfügbare Skills folgen dem Team-Zugriff des Projekts, nicht nur deiner persönlichen Sichtbarkeit. Ein fehlender Skill kann deshalb eine andere Freigabe brauchen. Nach einer Änderung der Freigabe aktualisiert sich die Liste in jedem offenen Dialog **Neuer Agent** oder Bearbeiten, auch in den Sitzungen anderer Personen, ohne Neuladen. Solange die Liste lädt, zeigt das Menü genau das an, statt keine Skills oder Connectors aufzuführen, und beim Speichern bleibt die Ausstattung des Agenten erhalten. Lässt sich die Liste nicht laden oder aktualisieren, meldet das ein Hinweis unter dem Menü und bietet **Erneut versuchen** an.

<Frame caption="Das Skills-Menü eines neuen Agenten mit bereits eingeschalteten Dokument-Skills; bei jedem Skill steht, wer ihn erstellt hat.">

![Der Dialog Neuer Agent mit geöffnetem Skills-Menü: docx, pdf, pptx und xlsx sind eingeschaltet und als Mitgeliefert gekennzeichnet, brief-summary und release-notes von Alex Rivera sowie visual-aspect-analyzer bleiben aus.](/images/platform/project-agent-document-skills.webp)

</Frame>

Das Suchfeld des Menüs grenzt Skills, Connectors und Tools beim Tippen ein. **Wissen durchsuchen** steht unter **Wissen** als immer aktiv: Jeder Agent durchsucht das Wissen des Projekts, ohne Freigabe.

Beachte **Schreibt Daten**, bevor du ein Plattform-Schreib-Tool vergibst. Es erlaubt echte Operationen innerhalb seiner Zugriffsregeln. Der Connector-Broker bietet Agenten nur Leseaktionen; direkte GitHub-Werkzeuge und ausdrücklich vergebene Secrets haben eigene Zugangswege.

Mit **Aufgabenpriorität und Agentenzuweisung ändern** darf ein Projekt-Agent bestehende Aufgaben priorisieren, einem Agenten desselben Projekts zuweisen (oder einem, den eine Arbeitsverteilung, die dieses Projekt bedient, dort arbeiten lässt) oder die Zuweisung aufheben, ohne Arbeit zu starten. Diese Freigabe ist zunächst ausgeschaltet und steht Agent-Nodes in Automatisierungen nicht zur Verfügung. Der Agent muss die Aufgabe zuerst lesen und bei einer Änderung die gelesenen Werte mitgeben. Hat jemand diese Werte inzwischen geändert, wird die gesamte Anfrage abgelehnt; der Agent muss erneut lesen. Ein Wechsel der Zuständigkeit ist nur bei offenen Aufgaben ohne laufende Ausführung, ausstehende Prüfung oder offene Frage möglich. Eine reine Prioritätsänderung lässt diese Übergaben bestehen. Das Tool ändert weder Status noch Prüfer, beantwortet keine Frage an einen Menschen und startet keinen Lauf. Es steht nur einem aktiven Lauf mit projektweiten Rechten zur Verfügung, nicht einem Lauf, den ein Mitglied gestartet hat.

**Aufgabenergebnisse anderer Agenten prüfen** erlaubt einem benannten Reviewer, über ein abgeschlossenes Ergebnis eines anderen Projektagenten zu entscheiden. Die Berechtigung ist anfangs ausgeschaltet und steht Agent-Nodes in Automatisierungen nicht zur Verfügung. Einen Agenten als Reviewer auszuwählen, erteilt weder diese Berechtigung noch startet es einen Lauf. Er prüft von seiner eigenen Aufgabe aus, mit aktuellen projektweiten Rechten und weiterhin erteilter Review-Berechtigung. Die Entscheidung hält Rückmeldung und Belege fest: Eine Freigabe schließt die geprüfte Aufgabe ab, eine Änderungsanforderung stellt sie ohne neuen Lauf auf **Zu erledigen**. Erforderliche menschliche Kompetenzen und Workflow-Genehmigungen bleiben geschützt. [Einen unabhängigen Reviewer einrichten](/de/platform/projects/task-automation#agent-review) beschreibt den Ablauf.

Mit **Andere Agenten auf Aufgaben starten** kann der Agent einen anderen Agenten dieses Projekts an die Arbeit schicken, etwa als Manager-Agent, der startbereite Arbeit verteilt und einen Agenten weiterarbeiten lässt, nachdem er dessen Frage beantwortet hat. Er nennt dazu eine Aufgabe, optional den Agenten, dem sie zugewiesen werden soll, und eine Nachricht, auf die der gestartete Lauf als Erstes eingeht. Der gestartete Lauf arbeitet im selben Auftrag wie der Lauf des Managers und nennt den Manager als den Agenten, der ihn gestartet hat. Ein so gestarteter Agent kann keine weiteren Agenten starten, ein Lauf, den ein Mitglied gestartet hat, kann gar keine starten, ein Manager kann sich nicht selbst auf einer anderen Aufgabe starten, und eine Aufgabe, die von einer offenen Aufgabe blockiert wird, startet nicht. Ein Agent, der schon an anderen Aufgaben arbeitet, wird trotzdem gestartet: Sein Lauf bekommt einen eigenen [Worker](#run-one-agent-on-several-tasks) oder wartet auf einen, und die Antwort sagt, warum er wartet. Vergib dieses Tool nur an einen Agenten, dessen Anweisungen festlegen, welche Arbeit er verteilen darf. Was ein solcher Lauf darf, beschreibt die [Aufgaben-Automatisierung](/de/platform/projects/task-automation#arbeit-die-eine-automatisierung-oder-ein-anderer-agent-startet).

Mit **Wissenseinträge hinzufügen und bearbeiten** kann der Agent Informationen als [Wissenseinträge](/de/platform/knowledge/knowledge-entries#einen-agenten-informationen-aktuell-halten-lassen) der ganzen Organisation speichern, einen pro Thema. Um einen Eintrag zu ändern, muss er die Version nennen, die er gelesen hat; hat sich der Eintrag inzwischen geändert, wird nichts gespeichert und der Agent führt seine Änderung im aktuellen Text zusammen. Einträge löschen kann er nicht, und ein Lauf, den ein Mitglied gestartet hat, kann keine speichern. Vergib das Tool an einen Agenten, dessen Anweisungen festlegen, welche Informationen sich zu behalten lohnen.

Die Connector-Aufrufe eines Laufs erfolgen im Namen des Mitglieds, das ihn gestartet hat, ob mit **Agent starten**, mit **Erneut ausführen**, durch Verschieben nach **In Bearbeitung** oder durch eine Erwähnung des Agenten mit @. Sie nutzen die [Connector-Zugangsdaten](/de/platform/admin/connectors) der Organisation und werden diesem Mitglied zugeordnet. Verlässt es die Organisation oder wird es deaktiviert, lehnt Tale die Aufrufe ab. Beende den Lauf dann mit **Lauf abbrechen** (oder lass ihn zu Ende laufen) und starte ihn selbst neu, damit er in deinem Namen arbeitet. Startet ein Kommentar den Lauf neu, um ihn zu lenken, wie bei allen Laufzeiten außer Claude Code, erfolgen die Aufrufe ab dann im Namen der Person, die den Kommentar geschrieben hat.

Beschreibe unter **Anweisungen** Verantwortung, Belege und Grenzen. Für den Launch-Prüfer etwa: „Lies das beigefügte Briefing. Berichte über fehlende Freigaben und widersprüchliche Termine mit der zugehörigen Textstelle. Schließe die Aufgabe nicht ab.“

</Step>

<Step title="Prüfen und speichern">

Braucht die Arbeit **Secrets**, ordnet ein Inhaber oder Admin benannte Zugangsdaten der Organisation zu. Der laufende Agent kann ihre Werte lesen. Verwende deshalb eng begrenzte, austauschbare Tokens. Ändert sich ein gemeinsam genutzter Wert, betrifft das auch andere Agenten und Workflow-Nodes mit diesem Namen. Ein Lauf, den ein Mitglied startet, erhält keines dieser Secrets und auch nicht den Git-Zugriff eines zugeordneten GitHub- oder Forgejo-Zugangs: Arbeit, die sie braucht, muss ein Redakteur oder eine höhere Rolle starten.

Gib dem Agenten für ein privates Repository [eigenen Zugriff](#repository-access) über den GitHub- oder Forgejo-Connector oder nutze einen auf dieses Repository beschränkten Schlüssel, und lege die erlaubten Git-Operationen in den Anweisungen fest. Commits tragen die **Commit-Identität** des Agenten. Lass die SSH-Hostprüfung eingeschaltet. Eine selbst gehostete Sandbox leitet Repository-SSH über ihren bestehenden Proxy weiter; [SSH-Zugang zu Repositories](/de/self-hosted/configuration/environment-reference#ssh-repository-access) beschreibt die Einrichtung.

Wähle **Agent erstellen**. Prüfe Laufzeit, Provider und Modell der neuen Zeile. Öffne den Agenten erneut, um gespeicherte Ausstattung und Anweisungen zu kontrollieren.

</Step>

</Steps>

## Dem Agenten eigenen Zugriff auf Repositorys geben {#repository-access}

Ein Agent, der mit dem GitHub- oder Forgejo-Connector ausgestattet ist, kann in seiner Sandbox über HTTPS klonen, fetchen und pushen, und zwar mit [Connector-Zugangsdaten](/de/platform/admin/connectors) der Organisation: GitHub-Zugangsdaten öffnen `github.com`, Forgejo-Zugangsdaten den Host ihrer Instanzadresse. Wenn du nichts anderes wählst, verwendet der Agent die Standard-Zugangsdaten des Connectors.

Sollen Agenten unterschiedlich weit reichen, hinterlege unter **Einstellungen > Connectors** je Reichweite eigene Zugangsdaten, die in GitHub oder Forgejo auf ihre Repositorys beschränkt sind. Ein zentraler Coder bekommt zum Beispiel Zugangsdaten für alle Repositorys der Organisation und der Coder jedes Kunden solche, die nur das Repository dieses Kunden erreichen. Bearbeite dann den Agenten und wähle unter **Zugriff auf Repositorys** die Zugangsdaten für jeden Connector. Diese Wahl können nur Inhaber und Admins ändern.

- Gewählte Zugangsdaten sind die einzigen, die der Agent für diesen Connector verwendet. Werden sie später gelöscht, erhalten die Läufe des Agenten über diesen Connector keinen Zugriff mehr, bis jemand andere wählt. Auf den Standard weichen sie nie aus.
- Git antwortet dem Agenten nur für die Hosts der Connectors, mit denen er ausgestattet ist. Ein Token in einem Secret, etwa `GITHUB_TOKEN`, meldet Git nicht an.
- Das Token erreicht nur den laufenden Turn. Tale schreibt es nie in den Arbeitsbereich oder in ein Log und protokolliert jedes Mal, wenn ein Turn es erhält.
- Ein Lauf, den ein Mitglied startet, und ein Lauf auf dem Board eines anderen Projekts, dessen Starter die volle Ausstattung des Agenten nicht nutzen darf, erhalten keine dieser Zugangsdaten und keines der Secrets des Agenten. Sie committen trotzdem unter der **Commit-Identität** des Agenten.
- Die Connector-Aktionen des Agenten aus seiner Sandbox, etwa das Auflisten von Forgejo-Repositorys, laufen in jedem Lauf des Agenten mit denselben Zugangsdaten, auch im Lauf eines Mitglieds. Diese Aufrufe laufen in Tale und geben die Zugangsdaten nie an die Sandbox. Sind die gewählten Zugangsdaten nicht mehr vorhanden, scheitern sie.
- Diese Wahl gibt es nur für GitHub und Forgejo, die Connectors, deren Zugangsdaten Git-Remotes öffnen.

Lege unter **Commit-Identität** den Namen und die E-Mail-Adresse fest, die die Commits des Agenten tragen. Die Worker eines Agenten gehören keiner Person, deshalb committet jeder seiner Läufe unter dieser Identität, egal wer oder was ihn gestartet hat: eine Person, die [Arbeitsverteilung](/de/platform/projects/dispatch), eine ständige Rolle oder ein Zeitplan. Ohne Identität ist in Git kein Autor eingerichtet, und der Agent muss einen festlegen, bevor er committet.

Über die [REST-API](/de/develop/api-reference#agenten-eines-projekts-verwalten) heißen dieselben Einstellungen `connectorCredentials` und `gitIdentity`; eine [CLI-Deklaration](/de/self-hosted/install/cli-install) setzt sie auf `project-agent`.

## Arbeit zuweisen und starten

Öffne eine Aufgabe desselben Projekts, wähle den Agenten als Zuständigen und klicke auf **Agent starten**. Auch ein Agent eines anderen Projekts kann die Aufgabe übernehmen, solange die [Arbeitsverteilung jenes Projekts dieses Board bedient](/de/platform/projects/dispatch#sources). Zuweisung und Ausführung sind getrennte Aktionen. Ergänze Dateien und Abnahmekriterien vor dem Start. Bearbeitungszugriff auf das Projekt brauchst du dafür nicht: Mitglieder lassen einen Agenten an Aufgaben arbeiten, die sie erstellt haben oder die ihnen zugewiesen sind, Redakteure und höhere Rollen an jeder Aufgabe des Projekts. Ein Lauf, den ein Mitglied startet, bleibt bei dieser Aufgabe, ohne die Secrets des Agenten und in einem eigenen Arbeitsbereich; [Agentenläufe, die ein Mitglied startet](/de/platform/projects/tasks#agentenlaeufe-die-ein-mitglied-startet) zählt auf, was sich ändert.

Der Bericht erscheint als Aufgabenkommentar; gesammelte Dateien werden als Ergebnisse angehängt. Hat ein Admin die [Bildgenerierung](/de/platform/admin/governance/content-models#let-agents-generate-images) eingeschaltet, kann der Agent für die Aufgabe auch Bilder erstellen. Sie erscheinen bei den Ergebnisdateien und zählen für das Mitglied, das den Lauf gestartet hat. Nach erfolgreicher Agentenarbeit steht die Aufgabe **In Prüfung**, damit der benannte menschliche Reviewer oder unabhängige Reviewer-Agent sie beurteilt. Erwähne den Agenten in einem Kommentar, um die Arbeit zu lenken oder fortzusetzen. Die Agent-Laufzeit bestimmt, ob der Hinweis in den laufenden Prozess gelangt oder eine Fortsetzung startet.

Die [Aufgaben-Automatisierung](/de/platform/projects/task-automation) erklärt Fortschritt, Stoppen und Prüfung. Der gewöhnliche Chat-Assistent bleibt davon getrennt, auch mit Projektkontext.

## Die aktuelle Ausführung lesen {#current-execution}

Rufe während eines Aufgabenagenten-Laufs das eigene Werkzeug `workspace_status` mit `{}` auf, um die aktuelle Ausführungsidentität zu lesen. Bei einem laufenden oder wartenden Lauf gleicht die Plattform Organisation, Sitzung und Ausführungs-ID des Tokens mit dem aktuellen Aufgabenlauf ab. Sie liefert `currentExecution` mit `taskId`, `agentId`, `runId`, `execId`, `startedAt`, `launchedAt` und dem serverseitigen `observedAt`. Die Zeitwerte sind Millisekunden seit der Unix-Epoche; bei einem eingereihten Lauf kann `launchedAt` noch `null` sein.

Eine ersetzte oder beendete Ausführung hat keine aktuelle Identität. `null`, ein fehlendes Feld oder eine gescheiterte Abfrage bedeutet unbekannt. Übernimm keine Identität aus früheren Anweisungen oder einem gespeicherten Beleg. Antworten aus Chats, Workflows oder älteren Plattformen können das Feld auslassen. Eine abgelaufene Anmeldung bleibt abgelehnt. Werkzeugliste und Freigaben bleiben unverändert; die Auskunft braucht keine zusätzliche Werkzeugfreigabe. Sie erlaubt weder einen Start noch einen Befehl oder eine Veröffentlichung.

## Einen Agenten an mehreren Aufgaben arbeiten lassen {#run-one-agent-on-several-tasks}

Ein Agent ist eine Konfiguration, ein Worker eine laufende Kopie davon. Jede Aufgabe, an der der Agent gleichzeitig arbeitet, läuft in einem eigenen Worker: einer Sandbox mit eigenem Arbeitsbereich, Arbeitsspeicher und eigenen Prozessen. Zwei Aufgaben teilen sich also nie Dateien und bremsen sich nicht gegenseitig aus. Startest du den Agenten Scribe für „Versionshinweise“ und für „Änderungsprotokoll“, arbeiten beide gleichzeitig, jede in ihrem Worker. Die einzige Ausnahme ist der [Standard-Agent](#standard-agent-runs), wenn eine Person ihn startet: Er bearbeitet die Aufgabe ohne Worker, bis die Arbeit einen braucht.

Worker werden auf das Limit **Agenten-Worker** deiner Organisation unter [Sandboxes](/de/platform/admin/sandboxes#das-relevante-limit-erkennen) angerechnet, das sich alle Agenten der Organisation teilen. Sind alle belegt, wartet ein neuer Lauf, statt zu scheitern, und die Aufgabe zeigt unter **Lauf**, warum: **Wartet auf einen Worker**. Er startet von selbst, sobald ein Worker frei ist, ohne eine automatische Wiederholung zu verbrauchen, und hat ab dann seine volle Arbeitszeit. Inhaber und Admins sehen dort einen Link, um das Limit zu erhöhen. Warten mehrere Läufe, geht ein frei gewordener Worker zuerst an den Agenten mit den wenigsten laufenden Läufen und dann an den Lauf, der am längsten wartet. Einen wartenden Lauf nimmst du mit **Lauf abbrechen** zurück oder indem du die Aufgabe jemand anderem zuweist: Ein Lauf, der noch nicht begonnen hat, wird mit der Neuzuweisung abgebrochen. Die [Arbeitsverteilung](/de/platform/projects/dispatch#limits) eines Projekts kann einen Agenten an bis zu 500 Aufgaben gleichzeitig beschäftigen; wie viele davon zur selben Zeit arbeiten, entscheidet weiterhin dieses Limit.

Der nächste Lauf einer Aufgabe kehrt zu dem Worker zurück, in dem sie zuletzt bearbeitet wurde, wenn dieser frei ist. Der Agent setzt dort das Gespräch fort und findet seine Dateien. Ist der Worker belegt, nimmt der Lauf einen anderen und beginnt neu, mit Beschreibung, Diskussion, Anhängen und Ergebnissen der Aufgabe. Schlägt ein Lauf fehl oder wird er abgebrochen, bleibt sein Worker 15 Minuten lang für diese Aufgabe reserviert, damit eine Wiederholung findet, was der Lauf hinterlassen hat; der Lauf einer anderen Aufgabe nimmt ihn nur, wenn kein anderer Worker frei ist.

## Den Sandbox-Host bei schwerer Arbeit teilen {#heavy-phases}

Die Agenten-Worker aller Organisationen teilen sich den Sandbox-Host des Deployments, und einige Arbeitsschritte belasten ihn besonders: Abhängigkeiten installieren, ein Image bauen, einen ganzen Arbeitsbereich auf Typen prüfen oder linten, eine vollständige Testsuite laufen lassen. Vor einer solchen schweren Phase bittet ein Agent, der an einer Aufgabe arbeitet, den Host um eine Lease. Das kann jeder Aufgabenlauf in einer Laufzeit mit MCP-Kanal von Tale, ohne Werkzeugfreigabe: Tale nennt die Werkzeuge in den Anweisungen des Agenten. Der Agent ruft `host_lease_acquire` mit einer Bezeichnung der Phase (`label`) auf. Kann er es abschätzen, gibt er auch an, wie viel sie auf den Datenträger schreibt, wie viel Arbeitsspeicher sie braucht und wie viele Minuten sie dauert. Die Antwort entscheidet, wie es weitergeht:

- **Gewährt**: Der Agent führt die Phase aus und gibt die Lease danach mit `host_lease_release` frei, damit die Phase des nächsten Agenten beginnen kann.
- **Abgelehnt**: Der Host steht unter Druck, führt schon so viele schwere Phasen aus, wie er gleichzeitig zulässt, oder hätte daneben zu wenig Speicherplatz oder Arbeitsspeicher. Die Antwort nennt den Grund und wie viele Sekunden zu warten ist. Der Agent wartet und fragt dann erneut, statt die Phase auszuführen.
- **Nicht verfügbar**: Der Host lässt sich nicht beurteilen, etwa bei Sandboxes auf Kubernetes, Incus oder einem entfernten Docker-Daemon oder bei einem älteren Sandbox-Dienst. Dort gibt es keine Leases, und der Agent führt die Phase ohne Lease aus.

Ein Lauf hält jeweils nur eine Lease. Jede Lease, die er noch hält, endet mit dem Lauf, ob er abgeschlossen wird, scheitert oder abgebrochen wird; außerdem läuft eine Lease von selbst ab, spätestens zwei Stunden nach ihrer Vergabe. Ein Lauf, der auf eine Lease wartet, arbeitet weiter: Die Wartezeit zählt zu seiner Arbeitszeit. Ein Befehl, der nur ein Paket oder eine Testdatei betrifft, braucht keine Lease. Wie viele schwere Phasen gleichzeitig laufen und wie viel Speicherplatz sie frei lassen müssen, legt der Betreiber fest; siehe [Leases für schwere Phasen](/de/self-hosted/configuration/environment-reference#heavy-phase-leases).

## Der Standard-Agent {#standard-agent}

Auch ein Projekt ohne eigene Agenten kann Arbeit an einen Agenten übergeben. Sofern ein Admin ihn unter [Richtlinien > Modelle](/de/platform/admin/governance/content-models#standard-agent) nicht ausgeschaltet hat, bietet **Zuständig** dort die Option **Standard-Agent** an, und zwar allen, die die Aufgabe zuweisen können, auch Mitgliedern. Wählt jemand sie zum ersten Mal, richtet Tale den Agenten im Projekt ein und weist ihm die Aufgabe zu. Danach startest du ihn wie jeden anderen Agenten oder erwähnst ihn in einem Kommentar. Kann er für dich nicht starten, sagt das Kommentarfeld es dir, und dein Kommentar wird als einfache Erwähnung gespeichert.

<Frame caption="Der Tab Agenten eines Projekts, dessen Aufgaben an den Standard-Agenten gehen.">

![Der Tab Agenten des Projekts Customer onboarding portal mit einer Zeile: der Standard-Agent mit dem Abzeichen Standard, Claude Code, OpenRouter, dem Modell anthropic/claude-haiku-4.5 und vier Ausstattungen. Ein Hinweis sagt, dass Tale ihn für dieses Projekt eingerichtet hat und Agent-Laufzeit, Modell und Anweisungen den Einstellungen der Organisation folgen. Die Zeile hat eine Schaltfläche zum Löschen, aber keine zum Bearbeiten.](/images/platform/project-agents-standard.webp)

</Frame>

Der Tab **Agenten** führt ihn mit dem Abzeichen **Standard**. Niemand bearbeitet ihn: Agent-Laufzeit, Modell und Anweisungen folgen den Einstellungen der Organisation, die Tale bei jedem Start eines Laufs neu liest, und seine Ausstattung sind die Dokument-Skills `docx`, `pptx`, `xlsx` und `pdf`, die das Projekt beim Start eines Laufs nutzen kann. Schaltet ein Admin einen davon ab, fällt er weg, statt den Agenten aufzuhalten. Auf **Automatisch** nutzt jeder Lauf ein Modell, das die Person, die ihn startet, nutzen darf. Er kann also für verschiedene Personen mit verschiedenen Modellen laufen.

Um dem Projekt einen eigenen Agenten zu geben, wähle **Neuer Agent**. Ab dann bietet das Projekt den Standard-Agenten nicht mehr an; der bereits eingerichtete bleibt zuweisbar, bis du ihn löschst. Beim Löschen bleibt der Verlauf seiner Aufgaben erhalten, und solange das Projekt keine Agenten hat, richtet die nächste Aufgabe für den Standard-Agenten ihn wieder ein.

### So läuft ein Lauf des Standard-Agenten {#standard-agent-runs}

Startet eine Person den Standard-Agenten, bearbeitet er die Aufgabe so, wie der [Chat-Assistent](/de/platform/chat/files-and-skills) eine Datei erstellt: mit dem Modell, das für diese Person gewählt wurde, derselben Wissenssuche und demselben Abrufen von Webseiten wie im Chat und den Dokument-Skills, mit denen er ausgestattet ist. Code führt er in einer [leichten Sandbox](/de/platform/admin/sandboxes#light-sandboxes) aus, die in etwa einer Sekunde startet und mit dem Ende des Laufs verschwindet. Eine Person startet ihn mit **Agent starten**, über die API oder mit einer @-Erwähnung in einem Kommentar oder in der Beschreibung. Für einen solchen Lauf startet kein Worker. Der Lauf wartet also nie auf einen Worker und wird nicht auf das Limit **Agenten-Worker** angerechnet: **Lauf** zeigt **Arbeitet…**, sobald er beginnt. Er endet wie jeder Lauf: Seine Abschlussnachricht erscheint als Bericht in den Aufgabenkommentaren. Die Dateien, die er erstellt hat, erscheinen als Ergebnisdateien der Aufgabe, und die Aufgabe wechselt auf **In Prüfung**. **Anzeigen** am Lauf im Verlauf der Aufgabe listet auf, was er getan hat, Tool für Tool.

Der Lauf wird wie eine Chat-Antwort verbucht: auf die Person, die ihn gestartet hat, unter dem Agenten und auf das Projekt. Ein Limit, das diese Person betrifft, verweigert den Lauf, bevor er etwas verbraucht; die Aufgabe sagt dann, dass ein Nutzungslimit ihn gestoppt hat. Eine Organisation führt höchstens vier solche Läufe gleichzeitig aus; der nächste wartet, bis er an der Reihe ist, und beginnt, wenn einer von ihnen endet. Ein Lauf endet nach etwa 50 Minuten, und der Lauf eines Mitglieds liest nur, was dieses Mitglied lesen darf.

Braucht die Arbeit mehr, als eine leichte Sandbox bietet, etwa ein Repository zum Klonen und Testen, eine Browsersitzung oder stundenlange Verarbeitung, übergibt der Agent die Aufgabe stattdessen an seinen vollständigen Arbeitsbereich. Er hält fest, warum und was noch offen ist. Danach startet ein Worker des Agenten und setzt die Arbeit anhand dieser Übergabe fort. Die bereits erstellten Dateien gehören schon zu den Ergebnisdateien der Aufgabe, sodass nichts doppelt gemacht wird. **Lauf** zeigt wieder **Wartet auf einen Worker** oder **Arbeitet…**. Kann dieser Worker nicht starten und wird der Lauf wiederholt, geht die Wiederholung direkt in den vollständigen Arbeitsbereich, mit derselben Übergabe.

Einem Lauf ohne Worker kannst du während der Arbeit keine Hinweise geben. Erwähnst du den Agenten in einem Kommentar oder in der Beschreibung, stoppt der Lauf, und ein neuer startet mit deinem Kommentar als Nachricht; verweigert die Organisation diesen Start, arbeitet der erste Lauf weiter. **Lauf abbrechen** beendet ihn sofort.

Alles andere arbeitet von Anfang an in einem Worker: ein Lauf, den eine Automatisierung, ein Zeitplan oder ein anderer Agent startet; ein Standard-Agent, dessen Agent-Laufzeit ein Admin unter [Richtlinien > Modelle](/de/platform/admin/governance/content-models#standard-agent) festgelegt hat; einer, dessen Modell nur eine Laufzeit bedienen kann, etwa das eines Abos; und jeder Agent, den du selbst anlegst.

## Einen Agenten ändern oder entfernen

Wenn du einen bestehenden Agenten bearbeitest, prüft Tale beim Speichern, ob seine Einstellungen seit dem Öffnen geändert wurden. Hat jemand anderes zuerst gespeichert, wird dein Speichern abgelehnt und deine ungespeicherten Änderungen bleiben im Dialog. Kopiere die Änderungen, die du behalten möchtest, bevor du ihn schließt. Öffne den Agenten dann erneut, um die aktuellen Einstellungen zu laden, und füge deine Änderungen ein, bevor du wieder speicherst.

Bearbeite oder lösche den Agenten über sein Zeilenmenü. Der Standard-Agent hat nur **Agent löschen**. Änderungen gelten für spätere Läufe; ein aktiver Lauf behält seine Startkonfiguration. Die Löschung entfernt Agentenzuweisungen von Aufgaben, erhält aber deren Verlauf. Sie löscht außerdem die [Arbeitsbereiche aller seiner Worker](/de/platform/admin/sandboxes#explain-why-a-workspace-disappeared) samt Dateien, auch die der Mitglieder. Prüfe laufende Arbeit und sichere benötigte Ergebnisse, bevor du den Agenten entfernst.

Scheitert das Erstellen, lies die Begründung: Ein doppelter Name, fehlender Projektzugriff, ein nicht verfügbares Modell und unsichtbare Skills sind unterschiedliche Ursachen. Ein Lauf, der endgültig scheitert, sagt oben in seiner Aufgabe, was schiefging und wer es beheben kann; [Wenn der Agent nicht fertig wird](/de/platform/projects/task-automation#wenn-der-agent-nicht-fertig-wird) zählt die Fälle auf. Neue Anweisungen beheben diese Voraussetzungen nicht.
