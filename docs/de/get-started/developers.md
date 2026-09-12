---
title: Dein erster Tag mit der Tale-API
description: Der Einstieg für Entwickler — erstelle einen API-Schlüssel, mach deine erste authentifizierte Anfrage und lerne, wo die API-Oberfläche wohnt.
---

Dieser Einstieg ist für die Person, die Tale mit anderen Systemen verdrahtet. In zehn Minuten erstellst du einen API-Schlüssel, machst deine erste authentifizierte Anfrage und weißt, an welche Tür du für Chat, Workflows und Dokumente klopfst.

Du brauchst die Rolle **Entwickler** oder höher (darunter sind die API-Einstellungen ausgeblendet) auf einer laufenden Instanz — der [Quickstart](/de/get-started/quickstart) hilft, wenn du keine hast. Ersetze unten `your-host.example.com` durch den Host deiner Instanz.

<Steps>

<Step title="Erstelle einen API-Schlüssel">

Für einen Berechtigungsnachweis, den deine Skripte halten können, öffne **Einstellungen > API > REST** und klicke auf **API-Schlüssel erstellen**. Benenne ihn nach dem System, das ihn nutzen wird — Schlüssel werden nach Namen gelistet, und in einem Jahr schlägt „zapier-bridge“ jedes „test“. Der Schlüsselwert erscheint genau einmal, bei der Erstellung; leg ihn in deinen Secret-Manager, nicht in den Code. Schlüssel werden hier erzeugt, rotiert und widerrufen und sonst nirgends — nichts unter `/api/v1` erstellt, listet oder widerruft einen —, plane die Rotation also als menschlichen Schritt; sein eigenes Ablaufdatum kann der Schlüssel immerhin kommen sehen, als `key.expiresAt` in `GET /api/v1/me`.

<Frame caption="Die REST-API-Einstellungen — Schlüssel werden hier erstellt und widerrufen.">

![Die Einstellungsseite für REST-API-Schlüssel listet zwei Schlüssel — Production ingest und CI pipeline —, jeder nur mit seinem Schlüssel-Präfix, dem Datum unter Hinzugefügt und der Markierung Nie verwendet, neben dem Knopf API-Schlüssel erstellen.](/images/get-started/settings-api-keys.webp)

</Frame>

</Step>

<Step title="Mach die erste Anfrage">

Die erste Anfrage listet die Modelle auf, die dein Schlüssel im direkten Chat verwenden darf. Der Schlüssel steht als Bearer-Token in der Anfrage. Gehört sein Inhaber nur einer Organisation an, braucht es sonst nichts; gehörst du mehreren an — eine Sandbox-Org und eine echte ist der übliche Fall —, muss jede Anfrage, Lesezugriffe eingeschlossen, die Organisation in `X-Organization-Slug` nennen (ihr Slug steht in der Adresszeile der App, und `GET /api/v1/me` listet jeden Slug, den du senden darfst):

```bash
curl -sS --compressed https://your-host.example.com/api/v1/models \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
```

<Check>

Ein JSON-Objekt mit einem `models`-Array bestätigt Schlüssel, Authentifizierung und Route. Das Array darf leer sein, wenn kein Modell für den direkten Chat verfügbar ist. Bei `401` ist die Autorisierungskopfzeile fehlerhaft oder der Schlüssel widerrufen. Eine `400` mit `"code": "ORG_SLUG_REQUIRED"` heißt: Du gehörst mehreren Organisationen an, und die Anfrage hat keine genannt — füge die Kopfzeile `X-Organization-Slug` hinzu; der Body listet die Slugs, die du senden darfst, unter `data.organizations`.

</Check>

</Step>

</Steps>

## Der Rest der Oberfläche

Projektarbeit startest du mit `POST /api/v1/projects/{id}/automations/{name}/runs`; den Lauf fragst du unter `/api/v1/projects/{id}/runs/{runId}` ab. Projektchats, Aufgaben und Dateien folgen demselben Aufbau `/api/v1/projects/{id}/...`. Die Projekt-ID gehört in die URL. Persönliche Chats ohne Projekt verwenden `/api/v1/threads`; `/api/v1/documents` verwaltet Dokumente der Wissensdatenbank ohne Projektzuordnung. Ein Webhook-Aufrufer verwendet `/api/projects/{id}/automations/webhook/{token}` für eine dort installierte Automatisierung und weist sich mit dem Token aus. Die [API-Referenz](/de/develop/api-reference) erklärt die Zugänge ohne Projekt, die Rechte und die nötige Organisationskopfzeile. Derselbe Schlüssel öffnet auch den [MCP-Endpunkt](/de/develop/mcp-endpoint) für modellgesteuerte Clients.

## Wo du jetzt stehst

Du hältst einen funktionierenden Berechtigungsnachweis und hast die Anfrageform gesehen, die jeder Endpunkt teilt. Von hier aus macht [Tale aus einem Skript aufrufen](/de/tutorials/developer/call-tale-from-a-script) aus dem curl eine echte Connector, [eine Automatisierung per Webhook auslösen](/de/tutorials/developer/trigger-automation-via-webhook) behandelt die Push-Richtung, und der [MCP-Endpoint](/de/develop/mcp-endpoint) ist dieselbe Plattform für MCP-Clients.
