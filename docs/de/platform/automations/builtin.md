---
title: Mitgelieferte Automatisierungen
description: Wähle einen mitgelieferten Mail-, GitHub- oder GlitchTip-Workflow, prüfe Eingaben und Verbindungen und erfahre vor dem Deployment, was er liest oder schreibt.
---

Tale enthält zwölf Automatisierungspakete: drei für die Postfach-Synchronisierung, drei für Zusammenfassungen, zwei für die GitHub-Prüfung, Issue-Importe für GitHub und GlitchTip sowie zwei Pakete, die diese Importe selbstständig fortsetzen. Jedes beginnt mit Version 1 und **Nicht live**. Die vier Issue-Pakete beginnen ohne Zeitplan; die anderen Pakete enthalten Zeitpläne, die anfangs ausgeschaltet sind: Nachdem du eine Version live geschaltet hast, bietet der Editor **Trigger einschalten** an. Prüfe Eingaben, Modell, Verbindungen und Schreibvorgänge, bevor ein Inhaber, Admin oder Entwickler eine Version live schaltet.

<Frame caption="Der Automatisierungskatalog zeigt Paketnamen, Versionszahlen und Live-Status.">

![Der Automatisierungskatalog listet GitHub- und Mail-Pakete mit einer Version und dem Status Nicht live.](/images/platform/automations-catalog.webp)

</Frame>

## Mit einem Paket beginnen

Öffne **Automatisierungen**, wähle ein Paket und prüfe seine Nodes im [Workflow-Editor](/de/platform/automations/editor). Der benötigte Connector muss verbunden sein. Die Pakete nennen ein Modell: Bedient es beim Hinzufügen keiner deiner Anbieter, bekommt jede `llm`-Node ein vergleichbares Modell, das sie bedienen, und die Nachricht von Version 1 sagt, welches. Ein Paket, das hinzukam, bevor ein Anbieter verbunden war — wie jedes Paket einer neuen Organisation —, behält sein Modell, und die Validierung warnt beim Speichern davor — wähle mit **Modell wechseln** ein bedientes Modell, das es in allen Schritten auf einmal ersetzt. Ein Testlauf verwendet simulierte Antworten. Er prüft den Ablauf, belegt aber keinen Zugriff auf dein echtes Postfach oder Repository.

Die Pakete werden beim Anlegen der Organisation hinzugefügt. Ein Paket, das ein späteres Release hinzufügt, erreicht eine bestehende Organisation, wenn die mitgelieferten Defaults erneut provisioniert werden; auf einem selbst gehosteten Deployment erledigt das [`tale migrate`](/de/self-hosted/install/cli-install#wartung). Ändert sich ein mitgeliefertes Paket, bleiben deine bestehenden Versionen erhalten; nur der mitgelieferte Name und die Beschreibung werden aktualisiert. Ein gelöschtes Paket bleibt gelöscht. Eigene Änderungen ergeben neue Versionen, die du getrennt live schaltest.

## E-Mails in die Inbox synchronisieren

Diese Workflows übernehmen alle fünf Minuten neue Nachrichten in Konversationen. Jeder stellt die Ansicht **Inbox** bereit: Nach dem Live-Schalten erscheint sie im Bereich [Start](/de/platform#home), und das Formular zum Verfassen bietet das verbundene Postfach an. Vorher hat **Start** keine Ansicht **Inbox**. Ein Link zur Inbox zeigt dann einen Hinweis zur Einrichtung: Für Inhaber, Admins und Entwickler verweist er auf **Automatisierungen**; alle anderen erfahren, dass jemand mit einer dieser Rollen eine E-Mail-Automatisierung live schalten muss.

| Automatisierung | Benötigter Connector | Zeitplan |
| --- | --- | --- |
| Gmail-E-Mails synchronisieren | Gmail | Alle 5 Minuten |
| Outlook-E-Mails synchronisieren | Outlook | Alle 5 Minuten |
| E-Mails über SMTP/IMAP synchronisieren | IMAP/SMTP | Alle 5 Minuten |

Ein Durchlauf liest nur den Posteingangsordner des Postfachs. Die eigenen Antworten des Postfachs unterscheidet er von denen der Kundin oder des Kunden an der Postfachadresse, die der erste Durchlauf vom verbundenen Konto erfährt und als Absenderadresse an der Verbindung behält; bei IMAP stammt sie aus dem Login.

Verbinde zuerst das passende Postfach. Prüfe nach dem ersten Live-Lauf das [Ausführungsprotokoll](/de/platform/automations/execution-logs) und ob die erwarteten Nachrichten im Bereich **Start** in der Ansicht **Inbox** erscheinen.

Anhänge werden mit ihrer Nachricht gespeichert, du öffnest und lädst sie also direkt in der Konversation herunter. Aus Gmail übernimmt Tale jeden Anhang nur bis 3,5 MB: Ein größerer erscheint weiterhin mit Name und Größe, öffnen kannst du ihn aber nur in Gmail.

## Die Inbox sichten

Diese Workflows arbeiten alle sechs Stunden auf der **Inbox**, die die Synchronisierungs-Automatisierungen füllen. Jeder liest die offenen Konversationen seines Mail-Connectors, deren neueste Nachricht von der Kundin oder dem Kunden stammt und die seit dem Eintreffen dieser Nachricht noch kein Durchlauf beurteilt hat – höchstens 25 pro Lauf, sofern du `limit` nicht erhöhst, und nie mehr als 100. Das Modell entscheidet für jeden Thread, ob eine Person antworten muss und wie dringend es ist.

Was ein Lauf verändert:

- Das Urteil wird samt Begründung am Thread festgehalten, sodass der nächste Lauf den Thread erst wieder ansieht, wenn sich die Kundin oder der Kunde erneut meldet.
- Die **Priorität** des Threads wird auf das Urteil des Modells gesetzt – aber nur, wenn noch niemand eine gesetzt hat. Eine von einer Person gewählte Priorität bleibt bestehen.
- Wo eine Antwort fällig ist, entwirft ein zweiter Modellaufruf eine und legt sie als **Antwortvorschlag** an den Thread: eine Karte über dem Editor, getrennt von allem, was eine Person selbst getippt hat. **In den Editor übernehmen** gibt den Text zum Anpassen und Senden in den Editor; **Verwerfen** lässt ihn fallen, und der Thread bekommt erst wieder einen Vorschlag, wenn sich die Kundin oder der Kunde erneut meldet. Die Automatisierung sendet nichts. Ein Thread, der bereits einen Vorschlag trägt, behält ihn.

Die Ausgabe des Laufs zeigt, was gelesen wurde, die Zusammenfassung des Modells, die Threads, die eine Antwort brauchen, mit ihren Inbox-Links, und die abgelegten Entwürfe. Ein Lauf, bei dem nichts wartet, ruft kein Modell auf. Stelle zuerst die passende Synchronisierungs-Automatisierung bereit; ohne synchronisierte Konversationen gibt es nichts zu sichten.

| Automatisierung | Benötigter Connector | Zeitplan |
| --- | --- | --- |
| Gmail-Posteingang sichten | Gmail | Alle 6 Stunden |
| Outlook-Posteingang sichten | Outlook | Alle 6 Stunden |
| IMAP-Posteingang sichten | IMAP/SMTP | Alle 6 Stunden |

## Issues importieren und synchronisieren

**GitHub-Issues importieren** und **GlitchTip-Issues importieren** verwenden dasselbe Formular, um Issues als Aufgaben anzulegen. Sie beginnen ohne Zeitplan. Die Importe lesen die Quelle und schreiben Tale-Aufgaben. Sie kommentieren, schließen oder verändern keine Issues in der Quelle und starten keinen Agenten.

1. Verbinde die Quelle unter **Einstellungen > Connectors** und wähle die Standard-Zugangsdaten. GitHub benötigt Repository-Zugriff mit Leserechten für Issues. GlitchTip benötigt die Instanz-URL und ein Token mit `project:read` und `event:read`. Ein Token nur für die Projekteinrichtung kann keine Issues lesen. Selbst gehostete Instanzen müssen durch die Host-Richtlinie des Connectors erlaubt sein.
2. Öffne den Importer und wähle **Testlauf**. Wähle das **Tale-Projekt** und gib den GitHub-Inhaber samt Repository oder die Organisations- und Projektkennung von GlitchTip ein. Optionale Labels oder eine GlitchTip-Suche grenzen die Suche nach neuen Issues ein. **Maximale Anzahl an Issues** erlaubt 1–500; der Standard ist 100.
3. Prüfe das Testergebnis, schalte die Version live und wähle **Live ausführen** mit demselben Ziel und denselben Filtern. Ein Testlauf verwendet Beispieldaten und erstellt keine Aufgaben. Erst ein Live-Durchlauf prüft die tatsächliche Verbindung.
4. Öffne **Läufe** und wähle den Durchlauf. **Importierte Aufgaben** verlinkt die zugehörigen Tale-Aufgaben. Wenn ein weiterer Stapel verbleibt, übernimmt **Import fortsetzen** Quelle, Ziel und Fortsetzungsposition für den nächsten Durchlauf. Um stattdessen jedes Issue nach Zeitplan zu importieren, merkt sich eines der [Pakete, die Importe automatisch fortsetzen](#importe-automatisch-fortsetzen), diese Position zwischen seinen Läufen.

Jede Synchronisierung sucht neue Issues und aktualisiert bis zu 500 verknüpfte Issues, beginnend mit den am längsten nicht geprüften. Das gilt auch für verknüpfte Issues, die nicht mehr zum Suchfilter passen. Wiederhole den Durchlauf, um große Bestände aktuell zu halten. GitHub-Pull-Requests sind ausgeschlossen. Wiederholungen verwenden innerhalb eines Tale-Projekts dieselbe Quellidentität. Wird ein Repository oder Projekt umbenannt, ändert sich der Link zur Quelle, ohne eine zweite Aufgabe anzulegen. Auch nach dem Verschieben in ein anderes Repository oder Quellprojekt bleiben Issues verknüpft und werden über die bisherigen Importe aktualisiert, sofern die Verbindung auf den neuen Ort zugreifen kann.

Die Quellenkarte einer Aufgabe zeigt den aktuellen Titel, die Beschreibung und den Status der Quelle getrennt an. Beim Import kürzt Tale Titel über 200 UTF-16-Codeeinheiten und Beschreibungen über 20.000 (die meisten Emojis zählen doppelt) in der Aufgabe auf diese Länge und beendet sie mit „…“; die Quellenkarte und das verknüpfte Issue behalten den vollständigen Text. Wird ein Issue geschlossen oder behoben, bleiben Status, Titel, Beschreibung, Zuweisung und Priorität der Tale-Aufgabe erhalten. Ist ein Issue nicht mehr erreichbar, bleiben seine zuletzt bekannten Angaben sichtbar. Authentifizierungsfehler und Ratenbegrenzungen lassen den Durchlauf fehlschlagen, statt das Issue als gelöscht zu kennzeichnen. Prüfe und erledige die Arbeit weiterhin in Tale.

### Importe automatisch fortsetzen

**Issues aus mehreren Quellen importieren** hält eine Liste von GitHub-Repositorys und GlitchTip-Projekten importiert, ohne dass jemand **Import fortsetzen** wählen muss. Jeder Lauf importiert den nächsten Stapel jeder Quelle, bis zu ihrem `limit` (standardmäßig 100, höchstens 500), ab der Stelle, an der ihr zuletzt gespeicherter Stapel endete, und speichert, wo dieser Stapel endet. Erreicht ein Stapel das Ende der Liste einer Quelle, ist der Durchgang abgeschlossen. Der nächste Lauf beginnt dann wieder beim ersten Stapel und nimmt dabei neue Issues auf. **Nächsten Stapel einer Issue-Quelle importieren** tut dasselbe für eine einzelne Quelle; die Liste führt es für jede Quelle einmal aus.

Gib einem Lauf das Tale-Projekt und seine Quellen:

```json
{
  "projectId": "<die ID des Projekts>",
  "sources": [
    { "kind": "github", "owner": "deine-organisation", "repo": "dein-repository", "limit": 500 },
    { "kind": "glitchtip", "organization": "deine-organisation", "project": "dein-projekt" }
  ]
}
```

Eine GitHub-Quelle nimmt außerdem `labels` an und eine GlitchTip-Quelle `query`, wie bei den Importern. Damit das Paket nach Zeitplan läuft, schalte eine Version live, lege im Tab **Allgemein** einen Zeitplan an und trage dieses Objekt als seine [feste Eingabe](/de/platform/automations/triggers#feste-eingabe) ein. Um es stattdessen als Schritt deiner eigenen Automatisierung auszuführen, siehe [Jedes Issue nach Zeitplan importieren](/de/platform/automations/triggers#jedes-issue-nach-zeitplan-importieren).

Jede Quelle wird für sich importiert. Schlägt der Import einer Quelle fehl, wird für sie nichts gespeichert. Der nächste Lauf importiert also denselben Stapel erneut, während die anderen Quellen weiterlaufen. Nach drei Läufen ohne Speichern beginnt diese Quelle ihren Durchgang von vorn. Als Ganzes schlägt der Lauf nur fehl, wenn Tale die Positionen des Projekts nicht lesen oder speichern kann, etwa sobald das Projekt archiviert ist.

Die Ausgabe des Laufs ist der Beleg, ein Eintrag pro Quelle in der aufgeführten Reihenfolge:

| Feld | Bedeutung |
| --- | --- |
| `kind`, `source` | Die Quelle, benannt als `owner/repo` oder `organization/project`. |
| `ok`, `error` | `false` und `import_failed`, wenn der Import fehlschlug und nichts gespeichert wurde. |
| `batch`, `resumed`, `restarted` | Welcher Stapel des Durchgangs es war, ob er einen Durchgang fortsetzte und ob ein immer wieder scheiternder Durchgang neu begann. |
| `saved`, `conflict`, `drained` | Ob die Position gespeichert wurde, ob ein anderer Lauf sie vorher verschoben hatte und deshalb nichts gespeichert wurde, und ob dieser Stapel den Durchgang abschloss. |
| `imported`, `created`, `updated`, `skipped`, `truncated`, `nextCursor`, `refreshHasMore` | Was der Importer für den Stapel gemeldet hat. |

Positionen werden pro Tale-Projekt und Quellname gespeichert. Ein Durchgang, den eine deiner eigenen Automatisierungen unter demselben `owner/repo` oder `organization/project` begonnen hat, geht hier also weiter. Die Pakete führen die Issue-Importer deiner Organisation aus, auch eine Version, die du bearbeitet oder live geschaltet hast, und brauchen dieselben Verbindungen. Der Editor warnt, dass sie in einer `subautomation`-Node schreiben: Verlangt deine Freigaberichtlinie, dass eine Person Schreibvorgänge an Aufgaben freigibt, schlägt der Lauf fehl, statt zu warten.

## GitHub-Arbeit prüfen

**GitHub-Issues sichten** liest offene Issues, bewertet ihre Umsetzbarkeit und Priorität und liefert eine sortierte Auswahl mit Begründungen. Der Workflow schreibt nichts nach GitHub und erstellt keine Projektaufgaben. Standardmäßig verarbeitet er höchstens 50 Issues pro Lauf.

**GitHub-Pull-Requests prüfen** liest die Diffs offener Pull Requests und veröffentlicht die Ergebnisse als Review-Kommentare. Standardmäßig verarbeitet er höchstens 10 Pull Requests pro Lauf. Er genehmigt keinen Pull Request und führt ihn nicht zusammen. Prüfe vor einem Live-Lauf das Ziel-Repository: Ein erneuter Lauf kann weitere Kommentare hinzufügen.

| Automatisierung | Benötigter Connector | Mitgelieferter Zeitplan | Schreibvorgänge |
| --- | --- | --- | --- |
| GitHub-Issues sichten | GitHub | Täglich um 07:00 UTC | Keine; lies die Ausgabe des Laufs |
| GitHub-Pull-Requests prüfen | GitHub | Alle 30 Minuten | Ein Review-Kommentar pro verarbeitetem Pull Request |

Beide Workflows benötigen `owner` und `repo`. Gib beim **Testlauf** unter **Eingabe für den Lauf (JSON)** die Werte deines Repositorys ein:

```json
{
  "owner": "deine-organisation",
  "repo": "dein-repository",
  "limit": 5
}
```

<Note>

Die mitgelieferten GitHub-Zeitpläne brauchen `owner` und `repo`, ein Zeitplan sendet aber nur `trigger` und `firedAt`. Nachdem du eine Version live geschaltet hast, bietet der Editor deshalb **Trigger prüfen** an, statt den Zeitplan einzuschalten. Öffne im Tab **Allgemein** den Bereich **Feste Eingabe hinzufügen**, wähle **Die 2 fehlenden Felder ergänzen**, ersetze die Platzhalter durch Inhaber und Namen deines Repositorys, schalte **Aktiv** ein und speichere. Jeder geplante Lauf erhält dann diese Werte. Lehnt der Workflow einen Start trotzdem ab, erscheint das am [Trigger](/de/platform/automations/triggers#einen-ausgebliebenen-start-untersuchen) als **Ausgelassen: Die Eingabe des Laufs wurde abgelehnt**.

</Note>

Lies vor dem Live-Schalten die aufgelöste Eingabe und Ausgabe des Testlaufs. Prüfe für einen Live-Lauf zusätzlich die Connector-Berechtigungen und nötige Freigaben. Die [Ausführungsprotokolle](/de/platform/automations/execution-logs) erklären Wartezustände, Fehler und protokollierte Schreibvorgänge.
