---
title: Mitgelieferte Automatisierungen
description: Wähle einen mitgelieferten Mail-, GitHub- oder GlitchTip-Workflow, prüfe Eingaben und Verbindungen und erfahre vor dem Deployment, was er liest oder schreibt.
---

Tale enthält zehn Automatisierungspakete: drei für die Postfach-Synchronisierung, drei für Zusammenfassungen, zwei für die GitHub-Prüfung sowie Issue-Importe für GitHub und GlitchTip. Jedes beginnt mit Version 1 und **Nicht live**. Die Issue-Importer laufen manuell; die anderen Pakete enthalten Zeitpläne. Prüfe Eingaben, Modell, Verbindungen und Schreibvorgänge, bevor ein Inhaber, Admin oder Entwickler eine Version live schaltet.

<Frame caption="Der Automatisierungskatalog zeigt Paketnamen, Versionszahlen und Live-Status.">

![Der Automatisierungskatalog listet GitHub- und Mail-Pakete mit einer Version und dem Status Nicht live.](/images/platform/automations-catalog.webp)

</Frame>

## Mit einem Paket beginnen

Öffne **Automatisierungen**, wähle ein Paket und prüfe seine Nodes im [Workflow-Editor](/de/platform/automations/editor). Der benötigte Connector muss verbunden sein, und das Modell jeder `llm`-Node muss eines sein, das deine Organisation bedient — die Pakete nennen ein Modell, das deine Anbieter womöglich nicht anbieten; die Validierung warnt beim Speichern davor. Wähle vor einem Live-Lauf im Feld **Modell** der Node ein bedientes Modell. Ein Testlauf verwendet simulierte Antworten. Er prüft den Ablauf, belegt aber keinen Zugriff auf dein echtes Postfach oder Repository.

Die Pakete werden beim Anlegen der Organisation hinzugefügt. Ändert sich ein mitgeliefertes Paket, bleiben deine bestehenden Versionen erhalten; nur der mitgelieferte Name und die Beschreibung werden aktualisiert. Ein gelöschtes Paket bleibt gelöscht. Eigene Änderungen ergeben neue Versionen, die du getrennt live schaltest.

## E-Mails in die Inbox synchronisieren

Diese Workflows übernehmen alle fünf Minuten neue Nachrichten in Konversationen. Jeder stellt die Ansicht **Inbox** bereit: Nach dem Live-Schalten erscheint sie im Bereich [Start](/de/platform#home), und das Formular zum Verfassen bietet das verbundene Postfach an. Vorher hat **Start** keine Ansicht **Inbox**, und ein Link zur Inbox verweist auf **Automatisierungen**.

| Automatisierung | Benötigter Connector | Zeitplan |
| --- | --- | --- |
| Gmail-E-Mails synchronisieren | Gmail | Alle 5 Minuten |
| Outlook-E-Mails synchronisieren | Outlook | Alle 5 Minuten |
| E-Mails über SMTP/IMAP synchronisieren | IMAP/SMTP | Alle 5 Minuten |

Verbinde zuerst das passende Postfach. Prüfe nach dem ersten Live-Lauf das [Ausführungsprotokoll](/de/platform/automations/execution-logs) und ob die erwarteten Nachrichten im Bereich **Start** in der Ansicht **Inbox** erscheinen.

## Aktuelle E-Mails zusammenfassen lassen

Diese Workflows lesen alle sechs Stunden die neuesten Nachrichten aller verbundenen Postfächer ihrer Art. Sie liefern eine Zusammenfassung und benennen Nachrichten, die offenbar heute eine Antwort brauchen. Die Zusammenfassung ist die Ausgabe des Laufs; öffne ihn zum Lesen. Ins Postfach wird nichts zurückgeschrieben, und der Status von Konversationen bleibt unverändert.

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
4. Öffne **Läufe** und wähle den Durchlauf. **Importierte Aufgaben** verlinkt die zugehörigen Tale-Aufgaben. Wenn ein weiterer Stapel verbleibt, übernimmt **Import fortsetzen** Quelle, Ziel und Fortsetzungsposition für den nächsten Durchlauf.

Jede Synchronisierung sucht neue Issues und aktualisiert bis zu 500 verknüpfte Issues, beginnend mit den am längsten nicht geprüften. Das gilt auch für verknüpfte Issues, die nicht mehr zum Suchfilter passen. Wiederhole den Durchlauf, um große Bestände aktuell zu halten. GitHub-Pull-Requests sind ausgeschlossen. Wiederholungen verwenden innerhalb eines Tale-Projekts dieselbe Quellidentität. Wird ein Repository oder Projekt umbenannt, ändert sich der Link zur Quelle, ohne eine zweite Aufgabe anzulegen. Auch nach dem Verschieben in ein anderes Repository oder Quellprojekt bleiben Issues verknüpft und werden über die bisherigen Importe aktualisiert, sofern die Verbindung auf den neuen Ort zugreifen kann.

Die Quellenkarte einer Aufgabe zeigt den aktuellen Titel, die Beschreibung und den Status der Quelle getrennt an. Beim Import kürzt Tale Titel über 200 UTF-16-Codeeinheiten und Beschreibungen über 20.000 (die meisten Emojis zählen doppelt) in der Aufgabe auf diese Länge und beendet sie mit „…“; die Quellenkarte und das verknüpfte Issue behalten den vollständigen Text. Wird ein Issue geschlossen oder behoben, bleiben Status, Titel, Beschreibung, Zuweisung und Priorität der Tale-Aufgabe erhalten. Ist ein Issue nicht mehr erreichbar, bleiben seine zuletzt bekannten Angaben sichtbar. Authentifizierungsfehler und Ratenbegrenzungen lassen den Durchlauf fehlschlagen, statt das Issue als gelöscht zu kennzeichnen. Prüfe und erledige die Arbeit weiterhin in Tale.

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

Die mitgelieferten GitHub-Zeitpläne liefern weder `owner` noch `repo`. Das Live-Schalten allein macht diese geplanten Läufe deshalb nicht ausführbar. Ein Zeitplan sendet nur `trigger` und `firedAt`; die erforderliche Repository-Eingabe fehlt damit, und der Start wird abgelehnt. Starte manuell mit den benötigten Eingaben oder passe Schema und Repository-Konfiguration an, bevor du geplante Läufe aktivierst. Ein abgelehnter geplanter Start erscheint am [Trigger](/de/platform/automations/triggers) als `start_refused`.

</Note>

Lies vor dem Live-Schalten die aufgelöste Eingabe und Ausgabe des Testlaufs. Prüfe für einen Live-Lauf zusätzlich die Connector-Berechtigungen und nötige Freigaben. Die [Ausführungsprotokolle](/de/platform/automations/execution-logs) erklären Wartezustände, Fehler und protokollierte Schreibvorgänge.
