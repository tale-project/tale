---
title: Anbieter
description: Das Zwei-Datei-Anbieter-Format auf Platte — `<name>.json` für die öffentliche Form, `<name>.secrets.json` für die Schlüssel — plus der Workflow zum Hinzufügen, Austauschen und Deaktivieren eines Modell-Anbieters.
---

Tale speichert jeden Modell-Anbieter als zwei Dateien unter `providers/` — eine `<name>.json` für die öffentliche Form (Base-URL, Modelle, Capabilities) und eine `<name>.secrets.json` für die API-Schlüssel. Die Trennung existiert, damit die Config sicher zu committen ist und die Secrets die verschlüsselte Behandlung bekommen, die SOPS ihnen gibt. Der `tale-platform`-Container liest beide beim Boot und beobachtet sie auf Änderungen; den Container neu zu starten ist nicht nötig, um Edits aufzunehmen.

Die Referenz ist das Dateiformat auf Platte und die Reihenfolge der Operationen, wenn du einen Anbieter hinzufügst. Der UI-gesteuerte Flow ("Einstellungen > Anbieter") sitzt auf denselben Dateien; beide erzeugen identische Resultate.

## Die Config-Datei

`providers/<name>.json` beschreibt die öffentliche Form des Anbieters. Der `displayName` taucht in der UI auf, das `models`-Array nennt alles, was durch diesen Anbieter erreichbar ist, und jedes Modell deklariert seine Tags (`chat`, `vision`, `embedding`, `transcription`, `text-to-speech`).

```json
{
  "displayName": "OpenRouter",
  "description": "Chat, Vision, Embeddings, Sprache und Bildgenerierung über einen Key.",
  "baseUrl": "https://openrouter.ai/api/v1",
  "secretsEnv": "TALE_PROVIDER_KEY_OPENROUTER",
  "defaults": {
    "transcription": "openai/whisper-1",
    "text-to-speech": "openai/gpt-4o-mini-tts-2025-12-15"
  },
  "models": [
    {
      "id": "openai/whisper-1",
      "displayName": "Whisper v1",
      "tags": ["transcription"],
      "transcriptionMode": "json-base64",
      "cost": { "centsPerAudioMinute": 0.6 }
    }
  ]
}
```

Die vollständige Menge der Felder lebt in [`examples/default/providers/`](https://github.com/tale-project/tale/tree/main/examples/default/providers). Der ausgelieferte Default ist eine einzige `openrouter.json`, die Chat, Vision, Embeddings, Transkription, Text-to-Speech und Bildgenerierung abdeckt — ein Key für alles. Um einen Anbieter direkt statt über OpenRouter aufzurufen, füg eine weitere Datei hinzu (z. B. eine `openai.json`, die auf `https://api.openai.com/v1` zeigt); siehe [Modelle out of the box](/de/platform/models) für den vollen Default-Katalog.

`transcriptionMode` wählt, wie der Request-Body eines `transcription`-Modells geformt wird: `json-base64` (OpenRouters `input_audio`-Envelope) oder, wenn weggelassen, `multipart` — der OpenAI/Whisper-`multipart/form-data`-Upload, den auch vLLM, LocalAI und ein direkter OpenAI-Key erwarten. Setz es passend zum Transkriptions-Endpunkt, auf den du zeigst.

### Modell-Capabilities und Auto-Sync

Jedes Modell kann optionale Metadaten deklarieren, die das komplexitätsbasierte Routing und der Adaptive Reasoning Governor nutzen: `contextWindow`, `maxOutputTokens`, `qualityScore` (0–1), `tier` (`draft`/`standard`/`frontier`), `routingTags` (bevorzugte Domänen), `reasoning` (der Steuer-Knopf — `effort` oder `budgetTokens`) und `promptCaching` (`auto-server` oder `explicit-breakpoints`). Was du weglässt, wird zur Laufzeit aus dem OpenRouter-Katalog ergänzt; was du setzt, gewinnt. Setze `"hidden": true`, um ein Modell aus den Auswahllisten (Chat-Eingabe, Agenten-Erstellung) zu entfernen, es aber für Agents auflösbar zu halten, die es bereits referenzieren — so ziehst du eine abgelöste Version zurück, ohne bestehende Workflows zu brechen.

Diese Felder bleiben auch von selbst aktuell: Einmal pro Woche führt Tale frische OpenRouter-Fakten in die Anbieter-Config jeder Organisation zusammen — fügt neuere Flaggschiff-Versionen hinzu, blendet abgelöste aus und aktualisiert Capability-Werte — und verändert dabei nur die Felder, die du nicht angepasst hast. Schalte das pro Organisation mit dem **Wöchentliche Auto-Synchronisierung**-Schalter auf der Modellkatalog-Karte unter **Einstellungen > Anbieter** aus.

## Die Secrets-Datei

`providers/<name>.secrets.json` ist ein flaches JSON-Objekt mit dem API-Schlüssel unter dem Feldnamen, den der Anbieter erwartet:

```json
{
  "apiKey": "sk-..."
}
```

Mit gesetztem `SOPS_AGE_KEY` oder `SOPS_AGE_KEY_FILE` wird diese Datei verschlüsselt auf Platte gespeichert. Mit beiden unset ist sie Klartext mit Dateimodus 0600 — erreich diesen Modus nur auf Platten, die at-rest verschlüsselt sind. Der vollständige Verschlüsselungs-Walkthrough lebt in [Secrets mit SOPS](/de/self-hosted/configuration/secrets-with-sops).

## Umgebungsvariable als Schlüsselquelle {#environment-variable-key-source}

Liegen deine Secrets schon in Kubernetes Secrets, Vault oder einem Cloud-Secret-Manager, kannst du einen Anbieter auf eine **Umgebungsvariable** zeigen statt auf eine Secrets-Datei. Füg ein `secretsEnv` zur Config-Datei hinzu (es nennt die Variable; der Name selbst ist kein Secret und bleibt darum in der committbaren Config):

```json
{
  "displayName": "OpenRouter",
  "baseUrl": "https://openrouter.ai/api/v1",
  "secretsEnv": "TALE_PROVIDER_KEY_OPENROUTER",
  "models": [
    {
      "id": "openai/gpt-4o",
      "displayName": "GPT-4o",
      "tags": ["chat", "vision"],
      "secretsEnv": "TALE_PROVIDER_KEY_OPENAI_DIRECT"
    }
  ]
}
```

Zwei Leitplanken gelten:

- **Reserviertes Präfix (Pflicht).** Der Variablenname muss mit `TALE_PROVIDER_KEY_` beginnen (z. B. `TALE_PROVIDER_KEY_OPENROUTER`). Jeder andere Name wird abgelehnt, sodass eine Config, die eine Variable ohne Präfix nennt, zu keinem Schlüssel auflöst. Das hindert einen Config-Schreib-Akteur daran, `secretsEnv` auf ein fremdes Deployment-Secret (z. B. `SOPS_AGE_KEY`) zu zeigen und es an eine Anbieter-URL senden zu lassen. Die Präfix-Schranke ist fest verdrahtet — es gibt keinen Deployment-Schalter.
- **Länge.** Der Name muss 40 Zeichen oder kürzer sein — die Plattform synct Umgebungsvariablen zu ihrem Convex-Backend, das Variablennamen bei 40 kappt.

Auflösungs-Reihenfolge, höchste zuerst: modell-level `secretsEnv` → anbieter-level `secretsEnv` → die Secrets-Datei (`modelKeys[id]`, dann `apiKey`). Jede Stufe wird übersprungen, wenn sie nichts liefert, sodass eine konfigurierte-aber-leere Variable auf die Datei zurückfällt. Env-Werte werden getrimmt (ein nachgestellter Zeilenumbruch aus einem gemounteten Secret ist eine häufige Ursache für `401`s).

Anders als die Secrets-**Datei** — die der Watcher bei jeder Anfrage neu liest — wird ein Umgebungsvariablen-**Wert** einmal beim Prozessstart gelesen. Ihn zu ändern verlangt einen **Neustart des `tale-platform`-Containers** (er synct Env beim Boot neu zu Convex) und das Neuerstellen der `tale-rag`- / `tale-crawler`-Container (sie lesen `os.environ` direkt). Die Variable muss überall präsent sein, wo der Schlüssel konsumiert wird: die Plattform synct sie automatisch zu Convex; die Python-Services bekommen sie über ihr compose-`env_file`.

## Einen Anbieter hinzufügen

Die Reihenfolge ist wichtig — der Watcher liest die Config-Datei zuerst, um zu wissen, dass der Anbieter existiert, und löst dann das Secret bei der ersten Anfrage auf.

1. Leg die Config-Datei bei `providers/<name>.json` ab.
2. Leg die Secrets-Datei bei `providers/<name>.secrets.json` ab (verschlüsselt oder Klartext, je nach deinem SOPS-Modus).
3. Aktualisiere **Einstellungen > Anbieter** in der UI — der neue Anbieter erscheint innerhalb weniger Sekunden (der Watcher pollt alle 2 s).
4. Wähle das Default-Modell des neuen Anbieters unter **Einstellungen > Modelle**, damit Agents, die "default" auflösen, dort landen.

Ist die Config-Datei fehlerhaft, loggt die Plattform eine Warnung und überspringt den Anbieter; der Rest bleibt erreichbar.

## Einen Schlüssel austauschen

Editier die Secrets-Datei in-place — der Watcher nimmt die Änderung auf, und die nächste Anfrage an diesen Anbieter nutzt den neuen Schlüssel. Bestehende in-flight-Anfragen halten noch den alten Schlüssel; abbrechen und neu versuchen, um die Re-Auflösung zu erzwingen. (Schlüssel, die aus einer [Umgebungsvariable](#environment-variable-key-source) stammen, sind die Ausnahme: den Wert zu ändern verlangt einen Container-Neustart, nicht nur einen Datei-Edit.)

## Einen Anbieter deaktivieren

Entweder lösch beide Dateien, oder setze `"disabled": true` an der obersten Ebene der Config. Das Deaktivieren hält die Datei für später auf Platte (praktisch, wenn du die Modell-Liste behalten willst, aber das Billing stoppen); das Löschen entfernt sie ganz. Agents, die den Anbieter explizit genannt haben, fangen an, bei der nächsten Anfrage zu scheitern — schalt sie vorher auf einen Fallback um.

## Wo das hingehört

Anbieter sind das eine Halb-und-Halb zwischen Server-Config (dieser Seite) und UI (dem **Anbieter**-Bildschirm). Die Schlüssel selbst leben in `providers/*.secrets.json`; das SOPS-Handling lebt in [Secrets mit SOPS](/de/self-hosted/configuration/secrets-with-sops). Die Modell-Level-Defaults, gegen die Agents auflösen, sind unter [Plattform > Modelle](/de/platform/models) dokumentiert.
