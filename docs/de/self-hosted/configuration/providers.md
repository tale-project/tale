---
title: KI-Anbieter
description: KI-Modell-Anbieter über JSON-Konfigurationsdateien einrichten, selbst gehostete Inferenz-Backends anbinden und Secrets mit SOPS verschlüsseln.
---

Anbieter verbinden Tale über OpenAI-kompatible HTTP-APIs mit KI-Modellen. Admins können Anbieter im laufenden Betrieb unter **Einstellungen > KI-Anbieter** anlegen und bearbeiten — siehe [KI-Anbieter](/de/platform/admin/providers) für den UI-Weg und das Feature-Konzept. Diese Seite beschreibt die Konfigurationsform auf der Platte: die JSON-Dateien in `TALE_CONFIG_DIR/providers/`, ihr Schema, SOPS-verschlüsselte Secrets und wie du Tale auf selbst gehostete Inferenz-Backends wie Ollama, vLLM, LocalAI oder faster-whisper-server zeigen lässt.

Die UI-Form und die Dateiform sind gleichwertig — beim Speichern aus **Einstellungen > KI-Anbieter** schreibt die App dasselbe JSON. Wähle, was zu deinem Change-Management-Workflow passt: UI-Änderungen sind schneller für tägliche Anpassungen, Dateiänderungen landen sauber in Git und eignen sich für Infrastructure-as-Code-Betreiber.

## Dateistruktur

Die Anbieter-Konfiguration liegt im Unterverzeichnis `providers/` von `TALE_CONFIG_DIR`. Den Wert der Variable pro Deployment-Variante findest du in der [Environment-Referenz](/de/self-hosted/configuration/environment-reference).

```text
$TALE_CONFIG_DIR/
  providers/
    openrouter.json          # public config — committable
    openrouter.secrets.json  # SOPS-encrypted API key — committable
    openai.json
    openai.secrets.json
```

- `providers/<name>.json` — öffentliche Konfiguration: Base-URL, Modell-Definitionen, Tags, Defaults.
- `providers/<name>.secrets.json` — der API-Schlüssel, SOPS-verschlüsselt. Committe die unverschlüsselte Form niemals.

Der Dateistamm (`<name>`) ist der interne Slug des Anbieters. Er muss zwischen der öffentlichen Datei und der zugehörigen Secrets-Datei übereinstimmen.

## Schema der öffentlichen Konfiguration

```json
{
  "displayName": "OpenAI",
  "description": "OpenAI API (Whisper for speech-to-text).",
  "baseUrl": "https://api.openai.com/v1",
  "defaults": {
    "chat": "gpt-4o",
    "transcription": "whisper-1"
  },
  "models": [
    {
      "id": "whisper-1",
      "displayName": "Whisper v1",
      "description": "Speech-to-text. Billed per minute of audio; 25 MB file ceiling.",
      "tags": ["transcription"],
      "cost": { "centsPerAudioMinute": 0.6 }
    }
  ]
}
```

| Feld             | Zweck                                                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `displayName`    | Label, das in der UI und in Modell-Pickern erscheint.                                                                                                       |
| `description`    | Optionaler Erklärtext in der Anbieter-Liste.                                                                                                                |
| `baseUrl`        | OpenAI-kompatibler Endpunkt. `/chat/completions`, `/embeddings`, `/audio/transcriptions` usw. hängt Tale selbst an.                                         |
| `defaults`       | Default-Modell pro Capability, wenn keine explizite Auswahl vorliegt. Schlüssel: `chat`, `vision`, `embedding`, `image-generation`, `transcription`.        |
| `models[*].id`   | Muss exakt dem Modellnamen entsprechen, den der Endpunkt akzeptiert (z. B. `llama3.3` für Ollama, `Systran/faster-whisper-base` für faster-whisper-server). |
| `models[*].tags` | Eines oder mehrere von `chat`, `vision`, `embedding`, `image-generation`, `image-edit`, `transcription` — steuert, wo das Modell erscheint.                 |
| `models[*].cost` | Optionale Preisangaben — siehe Kostentabelle unten.                                                                                                         |

### Kostenfelder

Preise werden pro Modell deklariert, damit das Usage-Ledger Kostenschätzungen berechnen kann. Token-abgerechnete und pro-Einheit-abgerechnete Modelle nutzen unterschiedliche Felder:

| Feld                    | Gilt für                         | Hinweise                                                                   |
| ----------------------- | -------------------------------- | -------------------------------------------------------------------------- |
| `inputCentsPerMillion`  | Chat, Vision, Embedding          | Preis pro Million Input-Tokens.                                            |
| `outputCentsPerMillion` | Chat, Vision                     | Preis pro Million Output-Tokens.                                           |
| `imageCentsPerImage`    | `image-generation`, `image-edit` | Fixer Preis pro generiertem Bild. Umgeht die Token-Rechnung.               |
| `centsPerAudioMinute`   | `transcription`                  | Preis pro Audio-Minute. OpenAI Whisper liegt bei `0.6` (d. h. $0.006/min). |

Lass `cost` für selbst gehostete Backends weg, bei denen der Aufwand operativ statt pro Call entsteht — die Nutzung wird trotzdem protokolliert, aber die geschätzte Kostenspalte steht auf `0`.

## SOPS-verschlüsselte Secrets

Die Datei `providers/<name>.secrets.json` enthält den API-Schlüssel und wird mit [SOPS](https://github.com/getsops/sops) unter Verwendung des age-Empfängers des Repos verschlüsselt. Unverschlüsselt sieht sie so aus:

```json
{ "apiKey": "sk-…" }
```

Committe das niemals. Verschlüssle vor dem Commit mit `sops --encrypt --in-place providers/<name>.secrets.json` — Tale entschlüsselt beim Start. Wenn du einen Schlüssel rotierst, verschlüssle die aktualisierte Datei neu und starte neu (oder lass den Config-Watcher die Änderung aufnehmen, je nach Deployment).

Willst du SOPS komplett vermeiden, setze den API-Schlüssel stattdessen über die UI — **Einstellungen > KI-Anbieter > Bearbeiten > API-Schlüssel**. Die App kümmert sich transparent um die Verschlüsselung.

## Mitgelieferte Beispiel-Anbieter nutzen

Das Repo liefert einsatzbereite Beispiel-Configs in `examples/providers/`. Kopiere eine davon in dein Config-Verzeichnis und trage deinen eigenen Schlüssel ein.

### OpenRouter (chat + vision über mehrere Anbieter)

```bash
cp examples/providers/openrouter.json $TALE_CONFIG_DIR/providers/
cp examples/providers/openrouter.secrets.json $TALE_CONFIG_DIR/providers/
```

Hol dir einen Schlüssel auf [openrouter.ai/keys](https://openrouter.ai/keys) und verschlüssle die Secrets-Datei entweder mit deinem eigenen SOPS-Empfänger neu oder aktualisiere sie in der UI unter **Einstellungen > KI-Anbieter > OpenRouter**.

Das Beispiel enthält Modelle mehrerer Hersteller:

| Hersteller | Modelle                                   | Tags         |
| ---------- | ----------------------------------------- | ------------ |
| Anthropic  | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5    | chat, vision |
| OpenAI     | GPT-5.2, GPT-5.2 Instant, GPT-5.2 Pro     | chat, vision |
| Google     | Gemini 3 Pro, Gemini 3 Flash              | chat, vision |
| Mistral    | Mistral Large 3, Mistral Medium 3         | chat         |
| Meta       | LLaMA 4 Maverick, LLaMA 4 Scout           | chat         |
| DeepSeek   | DeepSeek V3.2                             | chat         |
| Moonshot   | Kimi K2.5                                 | chat         |
| Qwen       | Qwen3 Next 80B, Qwen3.5 35B, Qwen3 VL 32B | chat, vision |

### OpenAI (Whisper für Transkription)

```bash
cp examples/providers/openai.json $TALE_CONFIG_DIR/providers/
cp examples/providers/openai.secrets.json $TALE_CONFIG_DIR/providers/
```

Die Datei deklariert `whisper-1` und `defaults.transcription`, sodass Audio- und Video-Anhänge im Chat hierhin geroutet werden, sobald ein Schlüssel gesetzt ist. Den Endbenutzer-Blick findest du unter [Chat-Anhänge](/de/platform/chat/attachments#audio-und-video-transkription).

## Selbst gehostete Inferenz-Backends

Jeder Server, der eine OpenAI-kompatible API bereitstellt, kann als Anbieter dienen. Lege eine JSON-Datei mit Base-URL und den Modell-IDs des Servers an. Häufig genutzte Backends:

- [Ollama](https://ollama.com) — `http://localhost:11434/v1`
- [vLLM](https://docs.vllm.ai) — `http://localhost:8000/v1`
- [LocalAI](https://localai.io) — `http://localhost:8080/v1`
- [llama.cpp server](https://github.com/ggerganov/llama.cpp) — `http://localhost:8080/v1`
- [faster-whisper-server](https://github.com/fedirz/faster-whisper-server) — `http://localhost:8000/v1` (nur Transkription)

### Beispiel — Ollama

```json
{
  "displayName": "Ollama (local)",
  "baseUrl": "http://localhost:11434/v1",
  "models": [
    { "id": "llama3.3", "displayName": "LLaMA 3.3", "tags": ["chat"] },
    { "id": "mistral", "displayName": "Mistral 7B", "tags": ["chat"] }
  ]
}
```

Ollama verlangt keine Authentifizierung; setze `apiKey` in der Secrets-Datei auf einen beliebigen, nicht leeren Platzhalter.

### Beispiel — lokales Whisper für Transkription

```json
{
  "displayName": "Local Whisper",
  "baseUrl": "http://localhost:8000/v1",
  "defaults": { "transcription": "Systran/faster-whisper-base" },
  "models": [
    {
      "id": "Systran/faster-whisper-base",
      "displayName": "Faster-Whisper Base",
      "tags": ["transcription"]
    }
  ]
}
```

Tale ruft `{baseUrl}/audio/transcriptions` auf und erwartet das OpenAI-kompatible `verbose_json`-Response-Format — faster-whisper-server, vLLM und LocalAI unterstützen es alle.

## Docker-Host-Networking

Wenn Tale in einem Docker-Container läuft und das Inferenz-Backend auf dem Docker-Host (Ollama, vLLM, LocalAI), zeigt `localhost` innerhalb des Containers auf den Container, nicht auf den Host. Optionen:

- **Docker Desktop (Mac, Windows)** — nutze `http://host.docker.internal:<port>/v1`.
- **Linux** — ergänze den Platform-Service in `compose.yml` um `extra_hosts: ["host.docker.internal:host-gateway"]`, nutze die LAN-IP des Hosts oder stelle Tale und das Backend ins selbe Docker-Netzwerk und referenziere das Backend per Service-Namen.

## Modelle für Agents verfügbar machen

Ein in einer Anbieter-Datei definiertes Modell ist zunächst nur _erreichbar_. Damit es im Modell-Selector eines Agents erscheint, ergänze seine `id` im Array `supportedModels` des Agents unter `TALE_CONFIG_DIR/agents/<slug>.json`:

```json
{
  "supportedModels": ["llama3.3", "anthropic/claude-opus-4.6"]
}
```

Die IDs müssen exakt dem Feld `id` der Modell-Definition des Anbieters entsprechen. Nur Einträge mit dem Tag `chat` erscheinen im Chat-Modell-Selector; `embedding`-Modelle greift die Wissensdatenbank, `transcription`-Modelle die Audio-Pipeline usw.

### Auf einen bestimmten Anbieter pinnen

Wenn dieselbe Modell-ID in mehr als einer Anbieter-Datei definiert ist (z. B. `anthropic/claude-opus-4.6` sowohl in `openrouter.json` als auch in einer direkten `anthropic.json`), stelle dem Eintrag `<provider>:` voran, um das Routing explizit zu pinnen:

```json
{
  "supportedModels": [
    "openrouter:anthropic/claude-opus-4.6",
    "anthropic:claude-opus-4.6"
  ]
}
```

Einfache Einträge (ohne Doppelpunkt) lösen auf den ersten Anbieter auf, der die ID definiert. Der Speicherpfad des Agents gibt eine Warnung aus, wenn ein unqualifizierter Eintrag auf mehr als einen Anbieter passt, sodass du disambiguieren kannst. Direkte Dateibearbeitung umgeht diese Validierung beim Speichern — der Runtime-Resolver wirft die Warnungen trotzdem, aber explizites Pinnen ist bei Multi-Anbieter-Setups sicherer.

## Siehe auch

- [KI-Anbieter](/de/platform/admin/providers) — Anbieter über die UI verwalten.
- [Chat-Anhänge](/de/platform/chat/attachments#audio-und-video-transkription) — wie `transcription`-getaggte Modelle verwendet werden.
- [Environment-Referenz](/de/self-hosted/configuration/environment-reference) — `TALE_CONFIG_DIR` und verwandte Variablen.
