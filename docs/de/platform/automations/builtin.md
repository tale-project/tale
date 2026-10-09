---
title: Mitgelieferte Automatisierungen
description: Wähle einen mitgelieferten Mail-, GitHub- oder GlitchTip-Workflow, prüfe Eingaben und Verbindungen und erfahre vor dem Deployment, was er liest oder schreibt.
---

Tale enthält zehn Automatisierungspakete: drei für die Postfach-Synchronisierung, drei für Zusammenfassungen, zwei für die GitHub-Prüfung sowie Issue-Importe für GitHub und GlitchTip. Jedes beginnt mit Version 1 und **Nicht live**. Die Issue-Importer laufen manuell; die anderen Pakete enthalten Zeitpläne, die anfangs ausgeschaltet sind: Nachdem du eine Version live geschaltet hast, bietet der Editor **Trigger einschalten** an. Prüfe Eingaben, Modell, Verbindungen und Schreibvorgänge, bevor ein Inhaber, Admin oder Entwickler eine Version live schaltet.

<Frame caption="Der Automatisierungskatalog zeigt Paketnamen, Versionszahlen und Live-Status.">

![Der Automatisierungskatalog listet GitHub- und Mail-Pakete mit einer Version und dem Status Nicht live.](/images/platform/automations-catalog.webp)

</Frame>

## Mit einem Paket beginnen

Öffne **Automatisierungen**, wähle ein Paket und prüfe seine Nodes im [Workflow-Editor](/de/platform/automations/editor). Der benötigte Connector muss verbunden sein, und das Modell jeder `llm`-Node muss eines sein, das deine Organisation bedient — die Pakete nennen ein Modell, das deine Anbieter womöglich nicht anbieten; die Validierung warnt beim Speichern davor. Wähle vor einem Live-Lauf im Feld **Modell** der Node ein bedientes Modell. Ein Testlauf verwendet simulierte Antworten. Er prüft den Ablauf, belegt aber keinen Zugriff auf dein echtes Postfach oder Repository.

Die Pakete werden beim Anlegen der Organisation hinzugefügt. Ändert sich ein mitgeliefertes Paket, bleiben deine bestehenden Versionen erhalten; nur der mitgelieferte Name und die Beschreibung werden aktualisiert. Ein gelöschtes Paket bleibt gelöscht. Eigene Änderungen ergeben neue Versionen, die du getrennt live schaltest.

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
4. Öffne **Läufe** und wähle den Durchlauf. **Importierte Aufgaben** verlinkt die zugehörigen Tale-Aufgaben. Wenn ein weiterer Stapel verbleibt, übernimmt **Import fortsetzen** Quelle, Ziel und Fortsetzungsposition für den nächsten Durchlauf. Um stattdessen jedes Issue nach Zeitplan zu importieren, merkt sich eine Automatisierung diese Position zwischen ihren Terminen: siehe [Jedes Issue nach Zeitplan importieren](/de/platform/automations/triggers#jedes-issue-nach-zeitplan-importieren).

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

Die mitgelieferten GitHub-Zeitpläne brauchen `owner` und `repo`, ein Zeitplan sendet aber nur `trigger` und `firedAt`. Nachdem du eine Version live geschaltet hast, bietet der Editor deshalb **Trigger prüfen** an, statt den Zeitplan einzuschalten. Öffne im Tab **Allgemein** den Bereich **Feste Eingabe hinzufügen**, wähle **Die 2 fehlenden Felder ergänzen**, ersetze die Platzhalter durch Inhaber und Namen deines Repositorys, schalte **Aktiv** ein und speichere. Jeder geplante Lauf erhält dann diese Werte. Lehnt der Workflow einen Start trotzdem ab, erscheint das am [Trigger](/de/platform/automations/triggers#einen-ausgebliebenen-start-untersuchen) als **Ausgelassen: Die Eingabe des Laufs wurde abgelehnt**.

</Note>

Lies vor dem Live-Schalten die aufgelöste Eingabe und Ausgabe des Testlaufs. Prüfe für einen Live-Lauf zusätzlich die Connector-Berechtigungen und nötige Freigaben. Die [Ausführungsprotokolle](/de/platform/automations/execution-logs) erklären Wartezustände, Fehler und protokollierte Schreibvorgänge.
