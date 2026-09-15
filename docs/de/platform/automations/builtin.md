---
title: Mitgelieferte Automatisierungen
description: Wähle einen Mail- oder GitHub-Workflow und prüfe vor dem Live-Schalten seine Eingaben, Verbindungen und Schreibvorgänge.
---

Tale enthält acht Automatisierungspakete: drei für die Postfach-Synchronisierung, drei für Zusammenfassungen und zwei für GitHub. Jedes beginnt mit Version 1, einem Zeitplan und **Nicht live**. Nutze sie als Ausgangspunkt. Prüfe Eingaben, Modell, Verbindungen und Schreibvorgänge, bevor ein Inhaber, Admin oder Entwickler eine Version live schaltet.

<Frame caption="Der Automatisierungskatalog zeigt Paketnamen, Versionszahlen und Live-Status.">

![Der Automatisierungskatalog listet GitHub- und Mail-Pakete mit einer Version und dem Status Nicht live.](/images/platform/automations-catalog.webp)

</Frame>

## Mit einem Paket beginnen

Öffne **Automatisierungen**, wähle ein Paket und prüfe seine Nodes im [Workflow-Editor](/de/platform/automations/editor). Der benötigte Connector muss verbunden und das Modell jeder `llm`-Node verfügbar sein. Ein Testlauf verwendet simulierte Antworten. Er prüft den Ablauf, belegt aber keinen Zugriff auf dein echtes Postfach oder Repository.

Die Pakete werden beim Anlegen der Organisation hinzugefügt. Ändert sich ein mitgeliefertes Paket, bleiben deine bestehenden Versionen erhalten; nur der mitgelieferte Name und die Beschreibung werden aktualisiert. Ein gelöschtes Paket bleibt gelöscht. Eigene Änderungen ergeben neue Versionen, die du getrennt live schaltest.

## E-Mails in die Inbox synchronisieren

Diese Workflows übernehmen alle fünf Minuten neue Nachrichten in Konversationen. Jeder stellt die Ansicht **Inbox** bereit: Nach dem Live-Schalten erscheint sie in der Navigation, und das Formular zum Verfassen bietet das verbundene Postfach an. Vorher verweist die Inbox-Seite auf **Automatisierungen**.

| Automatisierung | Benötigter Connector | Zeitplan |
| --- | --- | --- |
| Gmail-E-Mails synchronisieren | Gmail | Alle 5 Minuten |
| Outlook-E-Mails synchronisieren | Outlook | Alle 5 Minuten |
| E-Mails über SMTP/IMAP synchronisieren | IMAP/SMTP | Alle 5 Minuten |

Verbinde zuerst das passende Postfach. Prüfe nach dem ersten Live-Lauf das [Ausführungsprotokoll](/de/platform/automations/execution-logs) und ob die erwarteten Nachrichten in der Inbox erscheinen.

## Aktuelle E-Mails zusammenfassen lassen

Diese Workflows lesen alle sechs Stunden die neuesten Nachrichten aller verbundenen Postfächer ihrer Art. Sie liefern eine Zusammenfassung und benennen Nachrichten, die offenbar heute eine Antwort brauchen. Die Zusammenfassung ist die Ausgabe des Laufs; öffne ihn zum Lesen. Ins Postfach wird nichts zurückgeschrieben, und der Status von Konversationen bleibt unverändert.

| Automatisierung | Benötigter Connector | Zeitplan |
| --- | --- | --- |
| Gmail-Posteingang sichten | Gmail | Alle 6 Stunden |
| Outlook-Posteingang sichten | Outlook | Alle 6 Stunden |
| IMAP-Posteingang sichten | IMAP/SMTP | Alle 6 Stunden |

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
