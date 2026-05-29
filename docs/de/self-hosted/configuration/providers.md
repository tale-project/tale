---
title: Anbieter
description: Das Zwei-Datei-Anbieter-Format auf Platte — `<name>.config.json` für die öffentliche Form, `<name>.secrets.json` für die Schlüssel — plus der Workflow zum Hinzufügen, Austauschen und Deaktivieren eines Modell-Anbieters.
---

Tale speichert jeden Modell-Anbieter als zwei Dateien unter `providers/` — eine `<name>.config.json` für die öffentliche Form (Base-URL, Modelle, Capabilities) und eine `<name>.secrets.json` für die API-Schlüssel. Die Trennung existiert, damit die Config sicher zu committen ist und die Secrets die verschlüsselte Behandlung bekommen, die SOPS ihnen gibt. Der `tale-platform`-Container liest beide beim Boot und beobachtet sie auf Änderungen; den Container neu zu starten ist nicht nötig, um Edits aufzunehmen.

Die Referenz ist das Dateiformat auf Platte und die Reihenfolge der Operationen, wenn du einen Anbieter hinzufügst. Der UI-gesteuerte Flow ("Einstellungen > Anbieter") sitzt auf denselben Dateien; beide erzeugen identische Resultate.

## Die Config-Datei

`providers/<name>.config.json` beschreibt die öffentliche Form des Anbieters. Der `displayName` taucht in der UI auf, das `models`-Array nennt alles, was durch diesen Anbieter erreichbar ist, und jedes Modell deklariert seine Tags (`chat`, `vision`, `embedding`, `transcription`, `text-to-speech`).

```json
{
  "displayName": "OpenAI",
  "description": "Whisper + GPT-4o-mini-tts für Voice-Modus.",
  "baseUrl": "https://api.openai.com/v1",
  "defaults": {
    "transcription": "whisper-1",
    "text-to-speech": "gpt-4o-mini-tts"
  },
  "models": [
    {
      "id": "whisper-1",
      "displayName": "Whisper v1",
      "tags": ["transcription"],
      "cost": { "centsPerAudioMinute": 0.6 }
    }
  ]
}
```

Die vollständige Menge der Felder lebt in [`examples/default/providers/`](https://github.com/tale-project/tale/tree/main/examples/default/providers) — `openai.json`, `openrouter.json` und `vercel-gateway.json` decken die drei Formen ab, die du wahrscheinlich brauchst.

## Die Secrets-Datei

`providers/<name>.secrets.json` ist ein flaches JSON-Objekt mit dem API-Schlüssel unter dem Feldnamen, den der Anbieter erwartet:

```json
{
  "apiKey": "sk-..."
}
```

Mit gesetztem `SOPS_AGE_KEY` oder `SOPS_AGE_KEY_FILE` wird diese Datei verschlüsselt auf Platte gespeichert. Mit beiden unset ist sie Klartext mit Dateimodus 0600 — erreich diesen Modus nur auf Platten, die at-rest verschlüsselt sind. Der vollständige Verschlüsselungs-Walkthrough lebt in [Secrets mit SOPS](/de/self-hosted/configuration/secrets-with-sops).

## Einen Anbieter hinzufügen

Die Reihenfolge ist wichtig — der Watcher liest die Config-Datei zuerst, um zu wissen, dass der Anbieter existiert, und löst dann das Secret bei der ersten Anfrage auf.

1. Leg die Config-Datei bei `providers/<name>.config.json` ab.
2. Leg die Secrets-Datei bei `providers/<name>.secrets.json` ab (verschlüsselt oder Klartext, je nach deinem SOPS-Modus).
3. Aktualisiere **Einstellungen > Anbieter** in der UI — der neue Anbieter erscheint innerhalb weniger Sekunden (der Watcher pollt alle 2 s).
4. Wähle das Default-Modell des neuen Anbieters unter **Einstellungen > Modelle**, damit Agents, die "default" auflösen, dort landen.

Ist die Config-Datei fehlerhaft, loggt die Plattform eine Warnung und überspringt den Anbieter; der Rest bleibt erreichbar.

## Einen Schlüssel austauschen

Editier die Secrets-Datei in-place — der Watcher nimmt die Änderung auf, und die nächste Anfrage an diesen Anbieter nutzt den neuen Schlüssel. Bestehende in-flight-Anfragen halten noch den alten Schlüssel; abbrechen und neu versuchen, um die Re-Auflösung zu erzwingen.

## Einen Anbieter deaktivieren

Entweder lösch beide Dateien, oder setze `"disabled": true` an der obersten Ebene der Config. Das Deaktivieren hält die Datei für später auf Platte (praktisch, wenn du die Modell-Liste behalten willst, aber das Billing stoppen); das Löschen entfernt sie ganz. Agents, die den Anbieter explizit genannt haben, fangen an, bei der nächsten Anfrage zu scheitern — schalt sie vorher auf einen Fallback um.

## Wo das hingehört

Anbieter sind das eine Halb-und-Halb zwischen Server-Config (dieser Seite) und UI (dem **Anbieter**-Bildschirm). Die Schlüssel selbst leben in `providers/*.secrets.json`; das SOPS-Handling lebt in [Secrets mit SOPS](/de/self-hosted/configuration/secrets-with-sops). Die Modell-Level-Defaults, gegen die Agents auflösen, sind unter [Plattform > Modelle](/de/platform/models) dokumentiert.
