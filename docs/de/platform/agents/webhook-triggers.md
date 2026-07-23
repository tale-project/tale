---
title: Agent-Webhooks
description: Der Webhook-Tab des Agents — eindeutige URLs, an die externe Systeme POSTen und so ohne die UI mit dem Agent chatten, mit dem Token in der URL als Zugangsnachweis.
---

Der Tab **Webhook** eines Agents erzeugt eindeutige URLs, an die externe Systeme POSTen und mit dem Agent chatten können — nichts in der UI ist beteiligt. Greif dazu, wenn etwas außerhalb von Tale den Agent antworten lassen soll: ein Slack-Bot, ein Formular-Handler, ein geplanter Job.

Diese Seite deckt nur die Webhook-Oberfläche pro Agent ab. Für eingehende Trigger, die eine Automatisierung statt eines Agents starten, siehe [Automatisierungen → Trigger](/de/platform/automations/triggers); für die volle Entwickler-Oberfläche siehe [Entwickeln → API-Referenz](/de/develop/api-reference).

<Frame caption="Der Webhook-Tab — ein aktiver Webhook mit seinem Aktiv-Schalter und dem Zeitpunkt der letzten Auslösung.">

![Der Webhook-Tab des Agenten-Editors mit dem Button Webhook erstellen und einer Tabelle mit einer Webhook-URL, einem Aktiv-Schalter und dem Wert Nie als letzter Auslösung.](/images/platform/agent-editor-webhooks.webp)

</Frame>

## Einen Webhook erstellen

Öffne den Agent, wechsle zu **Webhook** und klicke auf **Webhook erstellen**. Der Dialog zeigt die neue URL genau einmal — sichere sie, denn das in der URL eingebettete Token wirkt als Zugangsnachweis. Es gibt keinen separaten API-Schlüssel und keine Kopfzeile: wer die URL hält, kann mit dem Agent chatten, also behandle sie wie ein Geheimnis.

## Aufrufen

POSTe einen JSON-Body mit einem `message`-Feld; die Antwort ist die Antwort des Agents:

```bash
curl -X POST https://tale.yourcompany.com/api/agents/wh/<token> \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello"}'
```

Drei Felder formen den Aufruf:

- **`stream`** — ergänze `"stream": true`, und die Antwort kommt als Server-Sent Events statt als eine JSON-Antwort.
- **`threadId`** — ohne startet jeder POST eine frische Konversation; übergib die Thread-Id aus einer früheren Antwort, um eine mit intaktem Kontext fortzusetzen.
- **Dateien** — schick `multipart/form-data` mit einem `message`-Feld und einem oder mehreren `file`-Feldern, um Uploads an die Nachricht zu hängen.

Die Aktion **Verwendungsbeispiele** jeder Zeile öffnet fertige Beispiele für all das, ausgefüllt mit der echten URL der Zeile.

## Der OpenAI-kompatible Endpunkt

Ein an die Webhook-URL angehängtes `/chat/completions` stellt einen ChatCompletion-Endpunkt im OpenAI-Stil bereit, sodass fertige OpenAI-Clients auf einen Agent zeigen können: nutze die Webhook-URL als Basis-URL, einen beliebigen nicht-leeren Wert als API-Schlüssel und als Modell-Id eines, das die Organisation anbietet. Der Agent nagelt kein eigenes Modell fest, in diesem Feld trifft also der Aufrufer die Wahl, die sonst der Composer träfe. Datei-Uploads unterstützt nur die Basis-Webhook-URL, nicht dieser Unterpfad.

## Verwalten und widerrufen

Die Tabelle zeigt die URL jedes Webhooks, einen **Aktiv**-Schalter und den Zeitpunkt der letzten Auslösung. Einen Webhook abzuschalten pausiert ihn, ohne die URL zu verlieren; ihn zu löschen ist der Widerruf — jedes System, das die URL noch nutzt, verliert den Zugriff, also stell den Ersatz-Webhook bereit, bevor du den alten stilllegst.

## Wo das hingehört

Webhooks sind die leichte Integrations-Oberfläche pro Agent — richtig, wenn die Integration „dieser eine Agent beantwortet diese eine Sache“ ist. Für reichere Abläufe mit Schritten und Genehmigungen modelliere die Arbeit als [Automatisierung](/de/platform/automations/concepts) und richte den Aufrufer auf den Webhook-Trigger der Automatisierung — [Automatisierung per Webhook auslösen](/de/tutorials/developer/trigger-automation-via-webhook) geht diese Form von Anfang bis Ende durch.
