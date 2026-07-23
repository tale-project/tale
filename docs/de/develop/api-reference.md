---
title: API-Referenz
description: Wie du Tale von aussen aufrufst — Authentifizierung, Endpoints, Fehlermodell, Rate Limits und der OpenAI-kompatible Chat-Endpoint. Die einzige Quelle der Wahrheit für die Tale-API-Oberfläche.
i18nLintExclude:
  - terminology-loanword
---

Die Tale-API ist die Oberfläche, zu der Integratoren greifen, wenn sie ausserhalb des Produkts sind und es skripten wollen. Authentifizierung ist ein API-Key in einem Header; die Datenebene ist JSON über HTTPS; eine Teilmenge der Chat-Endpoints spricht das OpenAI-Chat-Completions-Format, sodass bestehende OpenAI-Client-Bibliotheken unverändert funktionieren.

Diese Seite ist die kanonische Inventur der API-Oberfläche, des Auth-Modells und der Fehler-Form. Sie listet nicht jedes Payload-Feld auf — das lebt neben jeder Endpoint-Gruppe auf den verlinkten Unterseiten. Lies sie, bevor du die API aufrufst; komm zurück, wenn du nicht sicher bist, welcher Header den Key trägt oder was ein 429 bedeutet.

## Ein durchgespielter Request

Der kürzeste nützliche Request — liste die Agents, die dein Key sehen kann — ist ein curl:

```bash
curl -sS https://your-host.example.com/api/v1/agents \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Accept: application/json"
```

Eine erfolgreiche Antwort ist JSON: `{ "agents": [ { "id": "...", "name": "...", "visibleInChat": true, ... }, ... ] }`. Jeder List-Endpoint gibt dieselbe Form zurück — ein Top-Level-Objekt mit einer Array-Eigenschaft, die nach der Ressource benannt ist.

## Authentifizierung

API-Keys werden in der UI unter **Einstellungen > API-Keys** von jedem mit der Rolle Entwickler oder höher erzeugt. Jeder Key hat einen Namen, einen Besitzer und einen Scope; der Scope folgt der Rolle des ausgebenden Benutzers zur Zeit der Erstellung. Keys werden bei der Erstellung einmal gezeigt; Tale zeigt den rohen Key nie wieder an.

Übergib den Key als Bearer-Token: `Authorization: Bearer <key>`. Der Key authentifiziert den Request; der Organisations-Kontext wird aus dem Key abgeleitet. Ein Key kann nicht ausserhalb seiner ausstellenden Organisation genutzt werden.

Cookies authentifizieren die Browser-Session; API-Aufrufe aus dem Browser innerhalb des Produkts nutzen Cookies. Server-seitige Skripte nutzen den API-Key.

## Endpoint-Gruppen

| Gruppe                                             | Methode      | Pfad                               | Auth nötig | Hinweise                                                   |
| -------------------------------------------------- | ------------ | ---------------------------------- | ---------- | ---------------------------------------------------------- |
| Agents                                             | verschiedene | `/api/v1/agents/...`               | API-Key    | List, get, run.                                            |
| Chat                                               | verschiedene | `/api/v1/chat/...`                 | API-Key    | Stream Chat-Completions gegen einen Agent oder ein Modell. |
| OpenAI-kompatibel                                  | POST         | `/api/v1/chat/completions`         | API-Key    | OpenAI-Chat-Completions-Form; bestehende SDKs nutzen.      |
| OpenAI-kompatibel                                  | POST         | `/api/v1/images/generations`       | API-Key    | Bilder generieren; OpenAI-Images-Form.                     |
| OpenAI-kompatibel                                  | GET          | `/api/v1/models`                   | API-Key    | Verfügbare Modelle im OpenAI-Format auflisten.             |
| Automatisierungs-Webhooks                          | POST         | `/api/automations/webhook/<token>` | URL-Token  | Einen Lauf der deployten Version von außen starten.        |
| Wissen — Dokumente                                 | verschiedene | `/api/v1/documents/...`            | API-Key    | Upload, list, get, delete.                                 |
| Wissen — Kontakte, Produkte, Lieferanten, Websites | verschiedene | `/api/v1/<entity>/...`             | API-Key    | List, get, create, update.                                 |
| Konversationen                                     | verschiedene | `/api/v1/conversations/...`        | API-Key    | List nach Status, get, write messages.                     |
| Dateien                                            | verschiedene | `/api/v1/files/...`                | API-Key    | Upload, get, delete. Von Uploads genutzt.                  |

Exakte Feld-Formen für jeden Endpoint leben im OpenAPI-Dokument, das die Plattform zur Build-Zeit emittiert; lad es in einem Swagger- oder Stoplight-Viewer, um Request- und Response-Schemas mit Beispielen zu sehen. Die Endpoint-Gruppen in der Tabelle oben sind die High-Level-Inventur; das OpenAPI-Dokument ist die Feldebenen-Referenz.

## OpenAI-kompatible Endpoints

`POST /api/v1/chat/completions` akzeptiert einen Payload in OpenAI-Chat-Completions-Form und gibt eine streaming- oder nicht-streaming-Antwort in derselben Form zurück. Das Feld `model` wird als Agent-ID interpretiert — übergib eine Agent-ID, um durch die Anweisungen, das Wissen und die Tools dieses Agents zu routen. Übergib einen rohen Modellnamen (z. B. `gpt-4o`), um Agents zu überspringen und den Provider direkt aufzurufen.

Bestehende OpenAI-SDKs funktionieren mit einer Änderung: zeig die Base-URL auf `https://your-host.example.com/api/v1` und tausch den API-Key. Streaming nutzt Server-Sent Events.

### Vision

Um ein Bild zu senden, gib der User-Nachricht statt eines Strings ein Array-`content` aus Teilen — einen `text`-Teil plus einen oder mehrere `image_url`-Teile, jeder mit einer `data:`-URL oder einer öffentlichen `https`-URL. Das ist die Standard-OpenAI-Vision-Form, ein SDK, das multimodale Nachrichten schon baut, braucht also keine Änderung. Ein einfacher String-`content` funktioniert weiter für reine Text-Turns; nur Bild-Input braucht die Array-Form.

### Bildgenerierung

`POST /api/v1/images/generations` nimmt `{ model, prompt, n?, response_format? }` und gibt die OpenAI-Images-Form zurück — `{ created, data: [...] }`. `response_format` ist `url` (Standard — jeder Eintrag ist eine Download-URL) oder `b64_json` (jeder Eintrag ist Base64-Bild-Bytes); `n` ist auf 4 gedeckelt. Ruf es über das `images.generate` eines beliebigen OpenAI-SDKs auf.

Ein Bildgenerierungs-Modell an `/api/v1/chat/completions` zu übergeben funktioniert ebenfalls: Das generierte Bild kommt an der Assistant-Nachricht als `choices[0].message.images[]` zurück — jeweils eine `image_url` — passend zur Konvention bildfähiger Gateways, sodass der Aufruf gegen ein zurückgegebenes Bild abgerechnet wird statt gegen ein verworfenes. Um ein bestehendes Bild zu bearbeiten, schick dieselbe Anfrage mit einem `text`-Teil und einem `image_url`-Teil mit einer `data:`-URL an ein Modell, das Bearbeitung unterstützt; das bearbeitete Bild kommt auf demselben Weg zurück. Nur `data:`-URLs werden als Bearbeitungs-Eingaben gelesen — Tale holt eine `http`-Bild-URL nie serverseitig.

## Fehlermodell

Fehler landen als JSON: `{ "error": { "code": "<symbol>", "message": "<human>", "details"?: { ... } } }`. Der HTTP-Status ist einer von:

- **400** — fehlerhafter Request (fehlendes Feld, falscher Typ).
- **401** — fehlender oder ungültiger API-Key.
- **403** — der Key ist gültig, hat aber nicht die Rolle, die für die Aktion nötig ist.
- **404** — die Ressource existiert nicht oder der Key kann sie nicht sehen.
- **409** — Konflikt (z. B. doppelter Idempotency-Key mit anderem Body).
- **422** — semantisch ungültig (z. B. ein Agent, auf den ein Workflow-Trigger zeigt, ist archiviert).
- **429** — Rate-Limit getroffen. Siehe [Rate Limits](/de/develop/rate-limits).
- **500** — interner Fehler. Das `details`-Feld des Bodys hat eine Request-ID, die du im Support zitieren kannst.

Der `code` ist ein Symbol (`unauthorized`, `forbidden`, `agent_not_found`, …); die `message` ist menschenlesbar. Clients sollen auf `code` verzweigen, nicht auf die menschliche Nachricht.

## Idempotenz

Jeder Write-Endpoint akzeptiert einen `Idempotency-Key`-Header. Der erste Request mit einem gegebenen Key gelingt; nachfolgende Requests mit demselben Key geben dieselbe Antwort zurück, ohne erneut auszuführen. Der Key ist 24 Stunden gültig.

Ein Webhook-Trigger-Aufruf wird nicht für dich dedupliziert: Ein wiederholter POST startet einen zweiten Lauf. Für den bereits laufenden macht das die Durability sicher — jeder abgeschlossene Knoten bekommt einen Checkpoint, ein wiederaufgenommener Lauf wiederholt also keinen Seiteneffekt. Wäre ein doppelter Lauf trotzdem falsch, führ deinen eigenen Schlüssel im Payload mit und verzweig im ersten Knoten darauf.

## Versionierung

Die API ist nach URL-Präfix versioniert: heute `/api/v1/`. Breaking Changes erscheinen unter einem neuen Präfix; das alte Präfix bleibt mindestens eine Minor-Version verfügbar. Nicht-breaking Ergänzungen landen im aktuellen Präfix.

Die Release Notes nennen die API-Version, gegen die jede Release ausgeliefert wird; pinne deine Client-Bibliothek in Produktion auf die aktuelle Version.

## Wo das hingehört

Die API ist die Naht zwischen Tale und allem ausserhalb. Webhooks sind die andere Hälfte — für Events, die Tale zu dir pushen muss, oder für dich, an Tales Workflows zu pushen, behandelt die [Webhooks-Referenz](/de/develop/webhooks) die Signier- und Idempotenz-Regeln. Wenn du innerhalb des Produkts als Entwickler-Rolle baust — Agents, Workflows, eigene Tools — ist der [Plattform-Reiter](/de/platform) dein Alltag; diese Seite ist für aussen.
