---
title: KI-Anbieter
description: KI-Modell-Anbieter über JSON-Konfigurationsdateien einrichten, selbst gehostete Inferenz-Backends anbinden und Secrets entweder verschlüsselt (SOPS) oder als Klartext speichern.
---

Anbieter verbinden Tale über OpenAI-kompatible HTTP-APIs mit KI-Modellen. Admins können Anbieter im laufenden Betrieb unter **Einstellungen > KI-Anbieter** anlegen und bearbeiten — siehe [KI-Anbieter](/de/platform/admin/providers) für den UI-Weg und das Feature-Konzept. Diese Seite beschreibt die Konfigurationsform auf der Platte: die JSON-Dateien in `TALE_CONFIG_DIR/providers/`, ihr Schema, die Speicherung von Secrets (SOPS-verschlüsselt oder als Klartext) und wie du Tale auf selbst gehostete Inferenz-Backends wie Ollama, vLLM, LocalAI oder faster-whisper-server zeigen lässt.

Die UI-Form und die Dateiform sind gleichwertig — beim Speichern aus **Einstellungen > KI-Anbieter** schreibt die App dasselbe JSON. Wähle, was zu deinem Change-Management-Workflow passt: UI-Änderungen sind schneller für tägliche Anpassungen, Dateiänderungen landen sauber in Git und eignen sich für Infrastructure-as-Code-Betreiber.

## Dateistruktur

Die Anbieter-Konfiguration liegt im Unterverzeichnis `providers/` von `TALE_CONFIG_DIR`. Den Wert der Variable pro Deployment-Variante findest du in der [Environment-Referenz](/de/self-hosted/configuration/environment-reference).

```text
$TALE_CONFIG_DIR/
  providers/
    openrouter.json          # public config — committable
    openrouter.secrets.json  # API key — never commit (encrypted or plaintext)
    openai.json
    openai.secrets.json
```

- `providers/<name>.json` — öffentliche Konfiguration: Base-URL, Modell-Definitionen, Tags, Defaults.
- `providers/<name>.secrets.json` — der API-Schlüssel. SOPS-verschlüsselt, wenn `SOPS_AGE_KEY` gesetzt ist, sonst Klartext-JSON mit Modus `0600`. Committe niemals — `tale init` ergänzt `**/*.secrets.json` in der `.gitignore` des Projekts.

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

### Anbieter-Optionen (fortgeschritten)

Tale leitet beliebige anbieterspezifische Request-Body-Felder über einen optionalen `providerOptions`-Block weiter — verfügbar **sowohl** auf Anbieter-Ebene als auch pro Modell. Häufigster Anwendungsfall ist OpenRouters [Anbieter-Routing](https://openrouter.ai/docs/guides/routing/provider-selection) — Quantisierung anpinnen, erlaubte Anbieter wählen, Fallback-Richtlinie usw.

```json
{
  "displayName": "OpenRouter",
  "baseUrl": "https://openrouter.ai/api/v1",
  "providerOptions": {
    "provider": { "allow_fallbacks": false, "data_collection": "deny" }
  },
  "models": [
    {
      "id": "z-ai/glm-5.1",
      "displayName": "GLM 5.1",
      "tags": ["chat"],
      "providerOptions": {
        "provider": { "quantizations": ["fp8"] }
      }
    }
  ]
}
```

**Schreibregeln:**

- Schreib die **innere** Request-Body-Struktur — Tale namespaced sie zur Aufrufzeit unter dem tatsächlichen Anbieternamen. **Nicht** in `{ "openrouter": { ... } }` einwickeln.
- **Merge-Vorrang**: Anbieter-Ebene → Modell-Ebene (Tiefe 2: gemeinsame Top-Level-Schlüssel werden zusammengeführt, Sub-Schlüssel mit Modell-Sieg, Arrays werden vollständig ersetzt).
- Das Dashboard exponiert dasselbe JSON über die Panels **Erweitert — Anbieter-Optionen** unter _Einstellungen → Anbieter → \[Anbieter\]_ (Anbieter-Ebene) und im Modell-Bearbeiten-Dialog (pro Modell).

**Abgelehnte Schlüssel** (die Datei wird beim Laden übersprungen, der Grund landet in `skippedReasons`; benachbarte Anbieter-Dateien laden weiter):

| Kategorie           | Schlüssel                                                                                                                                                                                                                                                                                                                                 | Grund                                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI-SDK-Reserve      | `user`, `reasoningEffort`, `textVerbosity`, `strictJsonSchema`                                                                                                                                                                                                                                                                            | Der OpenAI-kompatible Adapter entfernt diese stillschweigend — auf Agent-Ebene setzen.                                                                                       |
| Body-Überschreibung | `model`, `messages`, `tools`, `tool_choice`, `stream`, `temperature`, `max_tokens`, `max_completion_tokens`, `top_p`, `frequency_penalty`, `presence_penalty`, `response_format`, `stop`, `seed`, `n`, `logit_bias`, `logprobs`, `top_logprobs`, `stream_options`, `store`, `metadata`, `prompt`, `size`, `reasoning_effort`, `verbosity` | Würden Tales aufgelösten Body überschreiben, Kosten still amplifizieren (`n`), Telemetrie kaputt machen (`stream_options`) oder Daten upstream leaken (`store`, `metadata`). |

**OpenRouter-Quantisierungswerte:** `int4`, `int8`, `fp4`, `fp6`, `fp8`, `fp16`, `bf16`, `fp32`, `unknown`.

#### Gateways vs. direkte Anbieter

`providerOptions` spiegelt das jeweilige Upstream-API exakt — aber **welche** Knöpfe verfügbar sind, hängt davon ab, ob es sich beim Upstream um ein Routing-Gateway oder einen direkten Inferenz-Anbieter handelt.

**Gateways** (OpenRouter, Vercel AI Gateway) sitzen vor mehreren Backends und aggregieren sie unter einem Endpunkt. Ihre Passthrough-Felder sind _Routing-Steuerungen_ — auswählen, welches Backend die Anfrage bedient, in welcher Präzision, mit welcher Fallback-Richtlinie. Die zwei bekannten Gateways strukturieren das unterschiedlich:

```json
// OpenRouter — Routing-Optionen unter Top-Level-Schlüssel "provider".
"providerOptions": {
  "provider": {
    "quantizations": ["fp8"],
    "allow_fallbacks": false,
    "data_collection": "deny"
  }
}
```

```json
// Vercel AI Gateway — primäres Routing über das Modell-ID-Präfix
// (z. B. "anthropic/claude-3.5") und HTTP-Header wie `ai-gateway-order`.
// Tales Deny-List lehnt `metadata` ab (PII-Egress-Vektor auf
// /v1/chat/completions-Ebene), Observability-Tags müssen also im
// Vercel-Dashboard statt pro Request konfiguriert werden.
"providerOptions": {
  "order": ["anthropic", "openai"]
}
```

Tales `providerOptions` fließen nur in den Request-Body. Header-Routing-Steuerungen (`ai-gateway-order`, `ai-gateway-only`) und Observability-Tags (`metadata`) sind aktuell nicht über die Anbieter-Konfiguration setzbar; Routing über das Modell-ID-Präfix anpinnen und Tagging im Vercel-Dashboard konfigurieren.

**Direkte Anbieter** (OpenAI, Anthropic, Together AI, Groq, DeepSeek, Mistral) hosten ihre eigenen Modelle. Es gibt **keine Routing-Schicht** und **kein `quantizations`-Feld** — die Präzision ist beim Deployment durch den Anbieter festgelegt. Ihre Passthrough-Felder sind _Modellverhaltens-Knöpfe_ auf oberster Body-Ebene:

```json
// OpenAI — SLA-Stufe, parallele Tools, Prompt-Cache-Routing
"providerOptions": {
  "service_tier": "priority",
  "parallel_tool_calls": false,
  "prompt_cache_key": "agent-foo-v1"
}
```

```json
// Together AI — Moderationsrouting, Sampling-Steuerungen
"providerOptions": {
  "safety_model": "meta-llama/Llama-Guard-4-12B",
  "repetition_penalty": 1.1
}
```

Tale leitet wortgetreu weiter — die exakten Feldnamen und akzeptierten Werte stehen in der API-Dokumentation des jeweiligen Anbieters. Vom Upstream nicht erkannte Felder werden am Gateway stillschweigend ignoriert; ein Tippfehler sieht also wie ein No-Op aus, statt laut zu scheitern.

**Verifikation:** `TALE_DEBUG_LLM_WIRE=1` im Convex-Backend-Process-Env setzen (selbst gehosteter Convex-Container oder lokale `bun run dev` Convex-Shell) und stdout beobachten. Jeder ausgehende Chat-/Embedding-/Bild-LLM-Request, der durch das AI-SDK läuft, gibt URL plus Body-Schlüssel aus (mit `messages`/`input` redigiert), so dass das eingearbeitete `provider:`-Feld (oder andere) verifiziert werden kann. Hinweis: Der Wrapper deckt Transkription, Connection-Test-Probes und den Direct-Fetch-Image-Gen-Pfad nicht ab und redigiert nur `messages`/`input` — andere Body-Felder einschließlich `system`, `tools`, `metadata`, `prompt_cache_key` und `user` werden wortgetreu geloggt.

**Migration:** Bestehende `$TALE_CONFIG_DIR/providers/*.json` ohne `providerOptions`-Block funktionieren unverändert weiter — das Feld ist optional. Neue Modelle in `examples/providers/openrouter.json` (GLM 5.x, Kimi K2.6, Qwen 3.6, Gemma 4) müssen manuell in deployed Configs übernommen werden.

## Speicherung der Anbieter-Secrets

Tale unterstützt zwei On-Disk-Formate für `providers/<name>.secrets.json`. Die Format-Erkennung ist **inhaltsbasiert** — die Datei spricht für sich, und Tale wählt den richtigen Pfad unabhängig davon, welcher Prozess (Convex, CLI, Python-Services) sie liest.

### Verschlüsselter Modus (`SOPS_AGE_KEY` gesetzt)

Wenn `SOPS_AGE_KEY` (oder `SOPS_AGE_KEY_FILE`) in `.env` gesetzt ist, speichert Tale Secrets [SOPS](https://github.com/getsops/sops)-verschlüsselt mit dem konfigurierten age-Empfänger. `tale init` erzeugt automatisch einen Schlüssel und verwendet diesen Modus standardmäßig. Die Datei sieht auf der Platte so aus:

```json
{
  "apiKey": "ENC[AES256_GCM,...]",
  "sops": {
    "age": [{ "recipient": "age1...", "enc": "..." }],
    "version": "3.9.4"
  }
}
```

**Schlüsselrotation** nutzt die Datei-Form der Variable. Mit `SOPS_AGE_KEY_FILE`, das auf eine Datei mit einem oder mehreren age-Schlüsseln zeigt (einer pro Zeile, `#`-Kommentare erlaubt):

1. Hänge den neuen age-Schlüssel als neue Zeile in der Schlüsseldatei an.
2. Speichere jeden API-Schlüssel jedes Anbieters über **Einstellungen > KI-Anbieter** erneut. Jedes Speichern erzeugt nun Geheimtext, der sowohl mit dem alten ALS auch dem neuen Schlüssel lesbar ist.
3. Wenn jeder Anbieter neu gespeichert wurde, entferne den alten Schlüssel aus der Datei. Neue Speicherungen verschlüsseln nur noch für den neuen Empfänger; bestehende Dateien lassen sich weiterhin entschlüsseln, da sops alle Schlüssel in der Datei durchläuft.

Die inline-Form `SOPS_AGE_KEY` unterstützt keine Mehrfachschlüssel — wechsle zu `SOPS_AGE_KEY_FILE` für Rotation.

### Klartext-Modus (`SOPS_AGE_KEY` nicht gesetzt)

`tale init` legt `SOPS_AGE_KEY` immer an, daher erreichst du den Klartext-Modus, indem du `SOPS_AGE_KEY` (und nicht `SOPS_AGE_KEY_FILE`) in `.env` nach dem Init löschst und Schlüssel über **Einstellungen > KI-Anbieter** neu speicherst. Neue Speicherungen erzeugen Klartext-JSON mit Datei-Modus `0600`. Dieser Modus eignet sich für selbst gehostete Setups, die Credentials bereits extern verwalten (Kubernetes Secrets, Vault-injizierte Dateien, gemountete Bind-Volumes usw.):

```json
{ "apiKey": "sk-…" }
```

Die Klartext-Form ist nur für den Eigentümer lesbar und wird über die per Scaffold erzeugte `.gitignore` von Git ausgeschlossen. Die Plattform loggt beim Start einmalig eine Warnung, damit die Speicherposition für Operator:innen sichtbar ist.

### Zwischen Modi wechseln

Das Dateiformat ist selbstbeschreibend, daher bleibt eine SOPS-verschlüsselte Datei nach dem Umschalten in den Klartext-Modus weiterhin entschlüsselbar (sofern du den Schlüssel behältst), und eine Klartext-Datei bleibt nach Aktivierung der Verschlüsselung lesbar — Tale verschlüsselt erst beim nächsten Speichern über die UI neu.

Um unwiederbringlichen Datenverlust zu vermeiden, **weigert sich die Plattform, eine bestehende SOPS-verschlüsselte Secrets-Datei mit Klartext zu überschreiben**, wenn `SOPS_AGE_KEY` nicht mehr gesetzt ist. Behebe das explizit: stelle entweder den Schlüssel wieder her oder entferne die verschlüsselte Datei, bevor du neue Credentials speicherst.

Willst du SOPS komplett vermeiden, setze den API-Schlüssel stattdessen über die UI — **Einstellungen > KI-Anbieter > Bearbeiten > API-Schlüssel**. Die App nutzt den Modus, den die `.env` konfiguriert.

## Mitgelieferte Beispiel-Anbieter nutzen

Das Repo liefert einsatzbereite Beispiel-Configs in `examples/providers/`. Kopiere eine davon in dein Config-Verzeichnis und trage deinen eigenen Schlüssel ein.

### OpenRouter (chat + vision über mehrere Anbieter)

```bash
cp examples/providers/openrouter.json $TALE_CONFIG_DIR/providers/
```

Hol dir einen Schlüssel auf [openrouter.ai/keys](https://openrouter.ai/keys) und trage ihn über die UI unter **Einstellungen > KI-Anbieter > OpenRouter** ein — die App schreibt das passende `openrouter.secrets.json` für dich, im aktuell konfigurierten Modus. (Die mitgelieferten `examples/providers/*.secrets.json` sind SOPS-verschlüsselt für den age-Empfänger des Repos und nicht als Drop-in-Vorlagen geeignet.)

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
```

Trage deinen OpenAI-Schlüssel über **Einstellungen > KI-Anbieter > OpenAI** ein. Die Datei deklariert `whisper-1` und `defaults.transcription`, sodass Audio- und Video-Anhänge im Chat hierhin geroutet werden, sobald ein Schlüssel gesetzt ist. Den Endbenutzer-Blick findest du unter [Chat-Anhänge](/de/platform/chat/attachments#audio-und-video-transkription).

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
