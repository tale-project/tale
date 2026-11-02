---
title: Aufgaben aus einer Automatisierung anlegen
description: Erstelle mit dem Schritt task.create eine Aufgabe in einem Projekt — mit Titel, zuständiger Person, Status, Fälligkeitsdatum und Labels — einmal pro Ausführung des Schritts, liste mit task.list die Aufgaben eines Projekts auf, melde mit task.report_gate den Zustand einer Schranke der Arbeitsverteilung eines Projekts und erfahre, was abgelehnt wird.
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

## Den Zustand einer Schranke melden {#report-gate}

Ein Schritt `task.report_gate` meldet den Zustand einer [Schranke](/de/platform/projects/dispatch#arbeit-hinter-einer-schranke-zurueckhalten) der Arbeitsverteilung eines Projekts aus Tale heraus, so wie es ein externes System über die [REST-API](/de/develop/api-reference#dispatch) tut. Eine Automatisierung mit Zeitplan liest das Signal, dem die Schranke folgt, und meldet es; kein Job außerhalb von Tale braucht dafür einen API-Schlüssel. Diese Automatisierung liest über [HTTP-Zugangsdaten](/de/platform/automations/http) mit der Basis-URL `https://api.github.com`, wie viele GitHub-Actions-Läufe in der Warteschlange eines Repositorys warten, und meldet diese Zahl an die Schranke `ci`:

```yaml
nodes:
  - id: queue
    type: http.get
    credential: GitHub API
    input:
      url: /repos/tale-project/tale/actions/runs
      query: { status: queued, per_page: 1 }
  - id: report
    type: task.report_gate
    input:
      projectId: <ID des Projekts>
      key: ci
      value: '{{ nodes.queue.output.body.total_count }}'
      reason: '{{ nodes.queue.output.body.total_count }} workflow runs queued'
```

Installiere die Automatisierung im Projekt und gib ihr einen [Zeitplan](/de/platform/automations/triggers#einen-zeitplan-einrichten) wie `*/5 * * * *`. Melde bei jeder Ausführung, nicht nur, wenn sich das Signal ändert: Eine Schranke, zu der niemand innerhalb von **Veraltet nach (Sekunden)** etwas meldet, öffnet sich wieder oder schließt sich.

| Eingabe     | Was sie enthält                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `projectId` | Das Projekt, dessen Arbeitsverteilung die Schranke deklariert. Die Automatisierung muss darin installiert sein, und das Projekt darf nicht archiviert sein. |
| `key`       | Der Schlüssel der Schranke, wie die Arbeitsverteilung ihn deklariert.                                                               |
| `state`     | `hold` (schließen) oder `open` (öffnen).                                                                                            |
| `value`     | Statt `state` eine Zahl für eine Schranke mit **Schließen ab**: Ab diesem Wert schließt sie sich, und geschlossen öffnet sie sich erst unter **Wieder öffnen unter** wieder. |
| `reason`    | Bis zu 500 Zeichen, angezeigt mit der letzten Meldung der Schranke.                                                                 |

Ein Lauf, den ein Zeitplan oder ein Ereignis gestartet hat, meldet als die im Projekt installierte Automatisierung. Ein Lauf, den eine Person gestartet hat, mit **Jetzt ausführen** oder über die API, meldet nur, solange diese Person das Projekt bearbeiten darf. Der Schritt gibt `{ projectId, key, held, changed, value, reason, reportedBy }` zurück: `held` sagt, ob die Schranke nach der Meldung geschlossen ist, `changed`, ob die Meldung das geändert hat, und `reportedBy` ist `run:` gefolgt von der ID des Laufs. Die Schranke behält diesen Namen als Meldenden, sodass ihre letzte Meldung zum Lauf und zu seiner Automatisierung führt. Die Meldung zählt wie jede andere: Mit ihr beginnt die Frist von **Veraltet nach (Sekunden)** von Neuem, und eine Meldung, die die Schranke öffnet, lässt die zurückgehaltene Arbeit sofort starten.

## Wenn ein Schritt scheitert

| Fehler                                                       | Was geschehen ist                                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| **Das Projekt der Aufgabe gehört nicht zur Automatisierung** | Die Automatisierung ist im Projekt nicht installiert, oder der Lauf wurde in einem anderen Projekt gestartet.             |
| **Das Projekt der Aufgabe gehört nicht zur Automatisierung**, bei einer Meldung an eine Schranke | Das Projekt ist archiviert, oder den Lauf hat eine Person gestartet, die das Projekt nicht bearbeiten darf, oder niemand, der den Zustand seiner Schranken melden darf. |
| **Der Dienst ist fehlgeschlagen**, bei einer Meldung an eine Schranke | Die Arbeitsverteilung deklariert keine Schranke mit diesem Schlüssel (`DISPATCH_GATE_UNKNOWN`), oder der Schritt hat einen `value` an eine Schranke ohne **Schließen ab** gesendet (`DISPATCH_GATE_VALUE_UNJUDGED`). |
| **Die zuständige Person der Aufgabe ist unbekannt**          | Kein Mitglied der Organisation und kein Agent des Projekts trägt diesen Namen, oder sie dürfen im Projekt nicht arbeiten. |

Nichts, was der Schritt begonnen hat, bleibt gespeichert, wenn er scheitert.
