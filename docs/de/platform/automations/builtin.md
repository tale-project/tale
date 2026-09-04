---
title: Mitgelieferte Automatisierungen
description: Was jede der acht mitgelieferten Automatisierungen tut — Mail-Sync und Sichtung für Gmail, Outlook und IMAP sowie Issue-Bewertung und Pull-Request-Prüfung für GitHub — und welchen Connector jede braucht, bevor du sie live schaltest.
---

Tale liefert acht Automatisierungen mit, und jede Organisation startet mit allen: drei, die ein Postfach in die gemeinsame **Inbox** holen, drei, die zusammenfassen, was dort ankam, und zwei für GitHub — eine bewertet offene Issues, eine prüft offene Pull Requests. Jede kommt als Version 1 an, mit bereits gebundenem Zeitplan und dem Badge **Nicht live**; es läuft also nichts, bis ein Inhaber, Admin oder Entwickler den nötigen Connector verbindet und die Automatisierung live schaltet. Diese Seite benennt, was jedes Paket tut, wie oft es läuft und was es braucht; die Mechanik des Live-Schaltens steht in [Der Workflow-Editor](/de/platform/automations/editor).

<Frame caption="Die Seite Automatisierungen einer frischen Organisation — jedes gesäte Paket ist eine Version mit dem Badge Nicht live, bis du es live schaltest.">

![Die Seite Automatisierungen mit den gesäten Automatisierungen github-review-pull-requests, github-triage-issues, gmail-triage-inbox, imap-smtp-triage-inbox und outlook-triage-inbox, jede mit einer Version und dem Badge Nicht live, unter den Buttons Paket hochladen und Neue Automatisierung.](/images/platform/automations-catalog.webp)

</Frame>

## Wie die Pakete ankommen

Die Pakete werden beim Anlegen der Organisation gesät, nicht aus einem Katalog installiert. Das Säen achtet darauf, was schon da ist: Ein Paket, von dem die Organisation bereits irgendeine Version hält, bleibt unangetastet — nur der mitgelieferte Name und die Beschreibung werden aufgefrischt —, und ein Paket, das du gelöscht hast, bleibt gelöscht; ein späteres Deploy holt es nie zurück. Öffne ein Paket wie jede Automatisierung, um sein Dokument auf dem Canvas zu lesen, seine [Ausführungsprotokolle](/de/platform/automations/execution-logs) zu verfolgen, seinen [Trigger](/de/platform/automations/triggers) zu ändern oder es zu bearbeiten — eine Änderung wird eine neue Version, die du live schaltest, wenn du bereit bist.

## Ein Postfach in die Inbox holen

**Gmail-E-Mails synchronisieren**, **Outlook-E-Mails synchronisieren** und **E-Mails über SMTP/IMAP synchronisieren** sind dieselbe Automatisierung dreimal, je einmal pro Postfach-Art. Jede holt alle fünf Minuten neue Nachrichten in Konversationen und deklariert die Ansicht **Inbox**: Sobald eine davon live ist, erscheint **Inbox** in der Navigation, und das Verfassen-Formular bietet das verbundene Postfach an — bis dahin verweist die Inbox-Seite auf **Automatisierungen**. Jede braucht zuerst ihren verbundenen Mail-Connector.

| Automatisierung                        | Braucht   | Zeitplan       |
| -------------------------------------- | --------- | -------------- |
| Gmail-E-Mails synchronisieren          | Gmail     | Alle 5 Minuten |
| Outlook-E-Mails synchronisieren        | Outlook   | Alle 5 Minuten |
| E-Mails über SMTP/IMAP synchronisieren | IMAP/SMTP | Alle 5 Minuten |

## Zusammenfassen, was ankam

**Gmail-Posteingang sichten**, **Outlook-Posteingang sichten** und **IMAP-Posteingang sichten** lesen alle sechs Stunden die neuesten Nachrichten jedes verbundenen Postfachs ihrer Art und schreiben eine Zusammenfassung: kurz, was eingegangen ist, und welche Nachrichten heute offensichtlich eine Antwort brauchen. Die Zusammenfassung ist der Output des Laufs — öffne den Lauf in den [Ausführungsprotokollen](/de/platform/automations/execution-logs), um sie zu lesen. Ins Postfach wird nichts zurückgeschrieben, und keine Konversation wechselt ihren Status.

| Automatisierung             | Braucht   | Zeitplan       |
| --------------------------- | --------- | -------------- |
| Gmail-Posteingang sichten   | Gmail     | Alle 6 Stunden |
| Outlook-Posteingang sichten | Outlook   | Alle 6 Stunden |
| IMAP-Posteingang sichten    | IMAP/SMTP | Alle 6 Stunden |

## Issues bewerten und Pull Requests auf GitHub prüfen

**GitHub-Issues sichten** listet einmal täglich um 07:00 UTC die offenen Issues eines Repositorys, bewertet jedes danach, ob es umsetzbar und wie dringend es ist, und liefert eine sortierte Auswahl mit einem Satz Begründung pro Issue. Es liest nur: Nach GitHub wird nichts geschrieben, und auf keinem Board entsteht eine Aufgabe — die Auswahl ist ein Bericht, auf den ein Mensch reagiert. **GitHub-Pull-Requests prüfen** liest alle dreißig Minuten den Diff jedes offenen Pull Requests, prüft ihn und hinterlässt die Ergebnisse als Review-Kommentar am Pull Request. Genehmigt und gemergt wird nie — das bleibt beim Menschen. Beide brauchen den verbundenen GitHub-Connector.

| Automatisierung             | Braucht | Zeitplan             | Schreibt                                              |
| --------------------------- | ------- | -------------------- | ----------------------------------------------------- |
| GitHub-Issues sichten       | GitHub  | Täglich um 07:00 UTC | Nichts — die sortierte Liste ist der Output des Laufs |
| GitHub-Pull-Requests prüfen | GitHub  | Alle 30 Minuten      | Einen Review-Kommentar pro offenem Pull Request       |

## Wo das hingehört

Acht Pakete, zwei Familien: Mail in die Inbox geholt und zusammengefasst, GitHub bewertet und geprüft — jedes eine normale Automatisierung, die du wie deine eigenen live schaltest, bearbeitest und versionierst. [Automatisierungen in deine Organisation bringen](/de/platform/automations/catalog) behandelt das Bauen auf dem Canvas und das Hochladen eigener Pakete; [Der Workflow-Editor](/de/platform/automations/editor) das Live-Schalten einer Version; [Projekt-Backlog](/de/platform/projects/backlog) erklärt den Board-Status für vorgeschlagene Arbeit — und warum nichts Mitgeliefertes ihn von selbst füllt.
