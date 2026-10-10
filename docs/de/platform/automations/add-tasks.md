---
title: Aufgaben aus einer Automatisierung anlegen
description: Erstelle mit dem Schritt task.create eine Aufgabe in einem Projekt — mit Titel, zuständiger Person, Status, Fälligkeitsdatum und Labels — einmal pro Ausführung des Schritts, und erfahre, was abgelehnt wird.
---

Verwende einen `task.create`-Schritt, wenn eine Automatisierung Arbeit an eine Person oder einen Agenten übergeben soll: eine Antwort, um die eine E-Mail bittet, ein Formular zum Nachfassen, eine fehlgeschlagene Prüfung. Er erstellt die Aufgabe in einem Projekt, in dem die Automatisierung installiert ist, und die Aufgabe nennt die Automatisierung als ihre Erstellerin. Ein Live-Lauf erstellt sie, ein Testlauf antwortet mit einem Mock.

## Eine Aufgabe erstellen

```yaml
nodes:
  - id: ticket
    type: task.create
    input:
      projectId: '{{ input.projectId }}'
      title: 'Reply to {{ input.from }}'
      description: '{{ input.body }}'
      assignee: ada@example.com
      status: todo
      dueDate: '2026-10-17'
      labels: [support]
```

| Eingabe       | Was sie enthält                                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `projectId`   | Das Projekt, in das die Aufgabe kommt. Die Automatisierung muss darin installiert sein, und ein Lauf, der in einem Projekt gestartet wurde, erstellt Aufgaben nur dort.                    |
| `title`       | Der Titel der Aufgabe. Einer mit mehr als 200 Zeichen wird gekürzt und endet mit „…“.                                                                                                      |
| `description` | Die Beschreibung der Aufgabe, in Markdown.                                                                                                                                                 |
| `assignee`    | Die E-Mail-Adresse oder Benutzer-ID eines Mitglieds oder ein Agent des Projekts mit seinem Namen oder Handle.                                                                              |
| `status`      | `backlog`, der Standard, `todo` oder `in_progress`. Eine Aufgabe eines Agenten, die mit `in_progress` erstellt wird, startet seinen Lauf.                                                  |
| `dueDate`     | Ein Datum wie `2026-10-17` oder ein ISO-Datum mit Uhrzeit. Ein Datum allein fällt in fast jeder Zeitzone auf diesen Tag.                                                                   |
| `labels`      | Namen von Labels. Der Katalog des Projekts erhält die, die er noch nicht hat, wenn die Person, die den Lauf gestartet hat, das Projekt bearbeiten darf oder ein Trigger ihn gestartet hat. |

Der Schritt gibt `{ taskId, number, title, url }` zurück; `url` öffnet die Aufgabe in Tale.

<Frame caption="Ein Live-Lauf in Customer onboarding portal: Der Schritt hat Absender und Betreff der E-Mail aus der Laufeingabe gelesen und die Aufgabe erstellt.">

![Die Seite eines erfolgreichen Live-Laufs von Follow up on support emails mit ausgewähltem Schritt Ticket, einem Schritt Tasks · Create task. Sein Tab Last run sagt, dass er task.create ausgeführt und from, subject und projectId aus der Laufeingabe gelesen hat; unter Received stehen der Titel der Aufgabe, eine Liste mit 1 Label und der Status todo. Unter dem Canvas listet der Lauf 1 effect.](/images/platform/automation-task-create-run.webp)

</Frame>

## Eine Aufgabe pro Ausführung des Schritts

Der Schritt erstellt bei jeder Ausführung eine Aufgabe: einmal pro Lauf und in einer Schleife einmal pro Element oder Durchgang. Wird ein Lauf unterbrochen, nachdem die Aufgabe erstellt wurde, und läuft er weiter, gibt der Schritt die schon erstellte Aufgabe zurück, statt eine zweite zu erstellen.

Die Aufgabe wird mit den Rechten der Person erstellt, die den Lauf gestartet hat, wie auf dem Board; ein Lauf, den ein Trigger gestartet hat, erstellt sie als die Automatisierung. Andere Automatisierungen können bei ihrer Erstellung starten und sehen sie als von einer Automatisierung erstellt.

## Wenn ein Schritt scheitert

| Fehler                                                       | Was geschehen ist                                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| **Das Projekt der Aufgabe gehört nicht zur Automatisierung** | Die Automatisierung ist im Projekt nicht installiert, oder der Lauf wurde in einem anderen Projekt gestartet.             |
| **Die zuständige Person der Aufgabe ist unbekannt**          | Kein Mitglied der Organisation und kein Agent des Projekts trägt diesen Namen, oder sie dürfen im Projekt nicht arbeiten. |

Nichts, was der Schritt begonnen hat, bleibt gespeichert, wenn er scheitert.
