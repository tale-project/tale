---
title: Dein erster Tag mit der Tale-API
description: Der Einstieg für Entwickler — erstelle einen API-Schlüssel, mach deine erste authentifizierte Anfrage und lerne, wo die API-Oberfläche wohnt.
---

Dieser Einstieg ist für die Person, die Tale mit anderen Systemen verdrahtet. In zehn Minuten erstellst du einen API-Schlüssel, machst deine erste authentifizierte Anfrage und weißt, an welche Tür du für Chat, Workflows und Dokumente klopfst.

Du brauchst die Rolle **Entwickler** oder höher (darunter sind die API-Einstellungen ausgeblendet) auf einer laufenden Instanz — der [Quickstart](/de/get-started/quickstart) hilft, wenn du keine hast. Ersetze unten `your-host.example.com` durch den Host deiner Instanz.

<Steps>

<Step title="Erstelle einen API-Schlüssel">

Für einen Berechtigungsnachweis, den deine Skripte halten können, öffne **Einstellungen > API > REST** und klicke auf **API-Schlüssel erstellen**. Benenne ihn nach dem System, das ihn nutzen wird — Schlüssel werden nach Namen gelistet, und in einem Jahr schlägt „zapier-bridge“ jedes „test“. Der Schlüsselwert erscheint genau einmal, bei der Erstellung; leg ihn in deinen Secret-Manager, nicht in den Code.

<Frame caption="Die REST-API-Einstellungen — Schlüssel werden hier erstellt und widerrufen.">

![Die Einstellungsseite für REST-API-Schlüssel mit dem Knopf API-Schlüssel erstellen und einer leeren Schlüsselliste.](/images/get-started/settings-api-keys.webp)

</Frame>

</Step>

<Step title="Mach die erste Anfrage">

Der kürzeste nützliche Aufruf listet die Agents, die dein Schlüssel sehen kann. Der Schlüssel reist als Bearer-Token mit; den Arbeitsbereichs-Kontext leitet Tale aus dem Schlüssel selbst ab:

```bash
curl -sS https://your-host.example.com/api/v1/agents \
  -H "Authorization: Bearer $TALE_API_KEY"
```

<Check>

Ein JSON-Array von Agents — samt dem eingebauten Assistenten — beweist Schlüssel, Header und Route. Ein `401` heißt: Der Token-Header ist fehlerhaft, oder der Schlüssel wurde widerrufen.

</Check>

</Step>

</Steps>

## Der Rest der Oberfläche

Alles Weitere sind Variationen dieser Anfrage. Die OpenAI-kompatiblen Endpunkte (`/api/v1/chat/completions`, `/api/v1/models`) bedeuten: Bestehende SDKs funktionieren, sobald du die Basis-URL tauschst. Workflows laufen per Slug über `/api/v1/workflows/<slug>/run` mit demselben Bearer-Schlüssel — oder werden von außen über Webhook-URLs der Form `/api/workflows/wh/<token>` gefeuert; das Token in der URL ist der Berechtigungsnachweis. Dokumente laden über `/api/v1/documents` hoch. Die [API-Referenz](/de/develop/api-reference) ist das vollständige Inventar mit Auth, Datenformen und Limits.

## Wo du jetzt stehst

Du hältst einen funktionierenden Berechtigungsnachweis und hast die Anfrageform gesehen, die jeder Endpunkt teilt. Von hier aus macht [Tale aus einem Skript aufrufen](/de/tutorials/developer/call-tale-from-a-script) aus dem curl eine echte Integration, [einen Workflow per Webhook auslösen](/de/tutorials/developer/trigger-automation-via-webhook) behandelt die Push-Richtung, und [Webhooks](/de/develop/webhooks) dokumentiert die Payloads, die Tale dir sendet.
