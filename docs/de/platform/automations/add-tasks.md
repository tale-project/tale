---
title: Aufgaben aus einer Automatisierung anlegen
description: Erstelle mit dem Schritt task.create eine Aufgabe in einem Projekt — mit Titel, zuständiger Person, Status, Fälligkeitsdatum und Labels — einmal pro Ausführung des Schritts, liste mit task.list die Aufgaben eines Projekts auf und erfahre, was abgelehnt wird.
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

## Die Aufgaben eines Projekts auflisten

Ein Schritt `task.list` liest die Aufgaben eines Projekts, die neueste oder die älteste zuerst, um über sie zu berichten — eine tägliche Übersicht, die Zahl der Aufgaben, die auf eine Prüfung warten. Er liest ein Projekt so, wie ein Erstellen dort es darf, und ändert nichts; deshalb wartet er nie auf eine Freigabe.

```yaml
nodes:
  - id: open
    type: task.list
    input:
      projectId: '{{ input.projectId }}'
      status: [todo, in_progress]
      createdSince: '2026-10-17'
      limit: 20
```

| Eingabe        | Was sie enthält                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projectId`    | Das Projekt, das gelesen wird.                                                                                                                    |
| `status`       | Nur Aufgaben in diesen Status — `backlog`, `todo`, `in_progress`, `in_review`, `done` und `cancelled`; fehlt es, jeder Status.                    |
| `createdSince` | Nur Aufgaben, die ab diesem Zeitpunkt erstellt wurden: Epoch-Millisekunden, ein Datum wie `2026-10-17` (sein Beginn in UTC) oder Datum und Uhrzeit nach ISO. |
| `createdBefore` | Nur Aufgaben, die vor diesem Zeitpunkt erstellt wurden, gleich geschrieben. Mit `createdSince` ergibt das ein Zeitfenster: Eines, das dort beginnt, wo das letzte endete, listet keine Aufgabe doppelt. |
| `order` | `newest`, die neuesten zuerst, wie wenn es fehlt, oder `oldest`, die ältesten zuerst. |
| `after` | Mit `order: oldest` nur die Aufgaben nach dieser Stelle: dem `next`, das eine frühere Auflistung zurückgab. Leer beginnt bei der ersten. |
| `limit`        | Höchstens so viele Aufgaben, bis zu 200; fehlt es, 50.                                                                                            |

Der Schritt gibt `{ tasks, hasMore, next }` zurück. Jede Aufgabe trägt ihre `taskId`, `number`, `title`, `status`, `priority`, `assignee` (mit `type`, `id` und `name`), `dueDate`, `createdAt` und die `url`, die sie öffnet. Archivierte Aufgaben fehlen, und `hasMore` sagt, dass mehr Aufgaben passen, als `limit` zurückgegeben hat. Mit den ältesten zuerst nennt `next` dann die zuletzt aufgelistete Aufgabe: Gib sie als `after` mit, und die nächste Auflistung macht dahinter weiter, auch an Aufgaben derselben Millisekunde vorbei. Die [Vorlage](/de/platform/automations/templates#task-digest) **Tägliche Aufgabenübersicht** baut darauf auf.

<Frame caption="Der Lauf der Daily task digest mit ausgewähltem Schritt Tasks: das Projekt und der Zeitpunkt, ab dem er las, und die sieben Aufgaben, die er zurückgab.">

![Die Seite eines erfolgreichen Live-Laufs von Daily task digest mit ausgewähltem Schritt Tasks, einem Schritt Tasks · List tasks. Sein Tab Last run sagt, dass er task.list ausgeführt und since aus dem Schritt Window gelesen hat; unter Received stehen projectId, createdSince und limit 50, unter Returned eine Liste mit 7 Aufgaben.](/images/platform/automation-task-list-run.webp)

</Frame>

## Eine Aufgabe und einen bestimmten Lauf lesen

Ein Schritt `task.get` liefert normalerweise Titel, Status, Projekt und Beschreibung der Aufgabe. Mit `agentRunId` liest du einen bestimmten Lauf dieser Aufgabe. `agentRun` enthält dann `id`, `taskId`, `agentId`, `status`, `execId`, `startedAt`, `launchedAt` und `settledAt`. Die Zeitstempel sind Millisekunden seit der Unix-Epoche; die letzten beiden können `null` sein. Fehlt der Lauf oder gehört er zu einer anderen Aufgabe oder Organisation, lautet die Antwort `agentRun: null`. Es wird kein neuerer Lauf eingesetzt. Ohne `agentRunId` bleibt die bisherige Antwort unverändert.

Mit `includeIds: true` liefert `task.list_comments` zu jedem Kommentar die native `messageId` neben `authorType`, `authorId`, Inhalt und Zeitstempel. Die Standardantwort bleibt gleich; `truncated` kennzeichnet weiterhin unvollständige Historie. Eine ID im Kommentartext ist nicht die native Identität des Kommentars.

Diese Abfragen reservieren keine Kapazität und erlauben weder einen Start noch einen Befehl oder eine Veröffentlichung. Fehlt ein Feld oder lehnt eine ältere Plattform die Anfrage ab, bleibt die Identität unbekannt. Die eigene aktuelle Ausführung liest ein Aufgabenagent über die [Arbeitsbereichsauskunft](/de/platform/projects/project-agents#current-execution).

```yaml
nodes:
  - id: task
    type: task.get
    input:
      taskId: '{{ input.taskId }}'
      agentRunId: '{{ input.agentRunId }}'
  - id: comments
    type: task.list_comments
    input:
      taskId: '{{ input.taskId }}'
      includeIds: true
      limit: 10
```

## Wenn ein Schritt scheitert

| Fehler                                                       | Was geschehen ist                                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| **Das Projekt der Aufgabe gehört nicht zur Automatisierung** | Die Automatisierung ist im Projekt nicht installiert, oder der Lauf wurde in einem anderen Projekt gestartet.             |
| **Die zuständige Person der Aufgabe ist unbekannt**          | Kein Mitglied der Organisation und kein Agent des Projekts trägt diesen Namen, oder sie dürfen im Projekt nicht arbeiten. |

Nichts, was der Schritt begonnen hat, bleibt gespeichert, wenn er scheitert.
