---
title: KI-Anbieter
description: KI-Modell-Anbieter über JSON-Konfigurationsdateien einrichten, selbst gehostete Inferenz-Backends anbinden und Secrets entweder verschlüsselt (SOPS) oder als Klartext speichern.
---

Anbieter verbinden Tale mit KI-Modellen über OpenAI-kompatible HTTP-APIs — OpenRouter, OpenAI direkt, Anthropic, Together, Groq oder ein selbst gehosteter Ollama- oder vLLM-Server. Diese Seite ist die Referenz für die On-Disk-Anbieter-Konfiguration unter `TALE_CONFIG_DIR/providers/`: das JSON-Schema, die Secret-Storage-Modi, die Routing-Regeln zur Modellwahl und die Per-Anbieter-Passthrough-Muster. Für das UI-Gegenstück, das Admins über die App erreichen, ist [KI-Anbieter](/de/platform/admin/providers) die Platform-Referenz.

Die UI-Form und die Datei-Form sind gleichwertig. Die App schreibt dasselbe JSON, wenn ein Admin aus **Einstellungen > Anbieter** speichert, das du auch von Hand schreiben würdest; wähle, was zu deinem Change-Management-Ablauf passt. UI-Bearbeitungen sind schneller für tägliche Anpassungen; Datei-Bearbeitungen committen sauber in git und passen zu Infrastructure-as-Code-Operatoren.

## Ein durchgespieltes Beispiel

Leg diese beiden Dateien unter `$TALE_CONFIG_DIR/providers/` ab, gib der Secrets-Datei Besitzer-Lese-Rechte, und Tale nimmt den Anbieter beim nächsten Reload auf — kein Neustart nötig.

`openrouter.json`:

```json
{
  "displayName": "OpenRouter",
  "description": "Multi-Anbieter-Gateway für Chat- und Vision-Modelle.",
  "baseUrl": "https://openrouter.ai/api/v1",
  "defaults": {
    "chat": "anthropic/claude-opus-4.7"
  },
  "providerOptions": {
    "provider": { "allow_fallbacks": false, "data_collection": "deny" }
  },
  "models": [
    {
      "id": "anthropic/claude-opus-4.7",
      "displayName": "Claude Opus 4.7",
      "tags": ["chat", "vision"],
      "cost": {
        "inputCentsPerMillion": 1500,
        "outputCentsPerMillion": 7500
      }
    }
  ]
}
```

`openrouter.secrets.json` (Klartext-Form; die SOPS-verschlüsselte Form steht weiter unten):

```json
{ "apiKey": "sk-or-v1-..." }
```

Der Dateinamenstamm (`openrouter`) ist der interne Slug des Anbieters. Die beiden Dateien teilen den Stamm; unpassende Namen bedeuten, dass das Geheimnis die Laufzeit nie erreicht.

## Datei-Layout

Anbieter-Konfiguration lebt im Unterverzeichnis `providers/` von `TALE_CONFIG_DIR`. Jeder Anbieter bekommt zwei Dateien: eine öffentliche Konfiguration, die committet werden darf, und eine Secrets-Datei, die den API-Schlüssel hält.

```text
$TALE_CONFIG_DIR/
  providers/
    openrouter.json          # öffentliche Konfiguration — committfähig
    openrouter.secrets.json  # API-Schlüssel — nie committen
    openai.json
    openai.secrets.json
```

Die öffentliche `.json`-Datei hält die Basis-URL, die Modellliste, das Kostenschema und den optionalen `providerOptions`-Block. Die `.secrets.json`-Geschwisterdatei hält nur den API-Schlüssel; sie ist SOPS-verschlüsselt, wenn `SOPS_AGE_KEY` gesetzt ist, und Klartext im Dateimodus `0600` sonst. `tale init` fügt `**/*.secrets.json` zur Projekt-`.gitignore` hinzu, damit keine der beiden Formen versehentlich in der Versionskontrolle landet.

## Schema der öffentlichen Konfiguration

Das Schema unten benennt jedes Top-Level-Feld. `displayName`, `baseUrl` und mindestens ein Modell sind das praktische Minimum; alles andere hat entweder sinnvolle Voreinstellungen oder steuert das Kosten-Ledger.

| Feld             | Beschreibung                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `displayName`    | Label, das in der UI und in Modellauswahlfeldern angezeigt wird.                                                                                             |
| `description`    | Optionale Erklärung, die in der Anbieterliste angezeigt wird.                                                                                                |
| `baseUrl`        | OpenAI-kompatibler Endpunkt. Tale hängt `/chat/completions`, `/embeddings`, `/audio/transcriptions` und so weiter an.                                        |
| `defaults`       | Per-Fähigkeit-Standardmodell, wenn keine explizite Wahl existiert. Schlüssel: `chat`, `vision`, `embedding`, `image-generation`, `transcription`.            |
| `models[*].id`   | Muss dem Modellnamen entsprechen, den der vorgelagerte Endpunkt akzeptiert (`llama3.3` für Ollama; `Systran/faster-whisper-base` für faster-whisper-server). |
| `models[*].tags` | Eines oder mehrere von `chat`, `vision`, `embedding`, `image-generation`, `image-edit`, `transcription`. Steuert, wo das Modell in der UI erscheint.         |
| `models[*].cost` | Optionale Preisgestaltung. Siehe Kostentabelle unten.                                                                                                        |

### Kosten-Felder

Die Preisgestaltung wird pro Modell deklariert, damit das Nutzungs-Ledger Kosten-Schätzungen berechnen kann. Token-basierte Modelle nutzen die Pro-Million-Felder; Bild- und Audiomodelle nutzen Pro-Einheit-Felder.

| Feld                    | Gilt für                         | Beschreibung                                                   |
| ----------------------- | -------------------------------- | -------------------------------------------------------------- |
| `inputCentsPerMillion`  | chat, vision, embedding          | Preis pro Million Input-Tokens.                                |
| `outputCentsPerMillion` | chat, vision                     | Preis pro Million Output-Tokens.                               |
| `imageCentsPerImage`    | `image-generation`, `image-edit` | Fester Preis pro generiertem Bild.                             |
| `centsPerAudioMinute`   | `transcription`                  | Preis pro Audio-Minute. OpenAI Whisper ist `0.6` ($0.006/min). |

Lass den `cost`-Block weg für selbst gehostete Backends, in denen Ausgaben betrieblich statt pro Aufruf sind. Die Nutzung wird trotzdem geloggt; die Kostenspalte liest `0`.

### Anbieter-Optionen

Tale leitet beliebige anbieterspezifische Anfrage-Body-Felder über einen optionalen `providerOptions`-Block weiter. Der Block ist sowohl auf der Top-Level-Ebene des Anbieters als auch pro Modell erlaubt; Per-Modell-Werte überschreiben Anbieter-Werte für denselben Schlüssel.

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

Drei Regeln regieren `providerOptions`. Schreibe die **innere** Anfrage-Body-Form — Tale grenzt sie zur Aufrufzeit unter den tatsächlichen Anbieternamen ab, also wickle nicht in `{ "openrouter": { ... } }`. **Merge-Vorrang** läuft Anbieter-Ebene, dann Modell-Ebene, mit geteilten Schlüsseln auf Tiefe 2 gemergt (Unter-Schlüssel mergen mit Modell-Gewinn, Arrays ersetzen vollständig). Und eine geschlossene Liste **abgelehnter Schlüssel** wird still entfernt, weil sie den von Tale aufgelösten Anfrage-Body zerstören oder Daten leaken würde:

| Kategorie           | Schlüssel                                                                                                                                                                                                                                                                                                                                 | Begründung                                                                                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI-SDK-reserviert   | `user`, `reasoningEffort`, `textVerbosity`, `strictJsonSchema`                                                                                                                                                                                                                                                                            | Der OpenAI-kompatible Adapter entfernt diese. Stattdessen auf Agent-Ebene setzen.                                                                                                                                       |
| Body-Überschreibung | `model`, `messages`, `tools`, `tool_choice`, `stream`, `temperature`, `max_tokens`, `max_completion_tokens`, `top_p`, `frequency_penalty`, `presence_penalty`, `response_format`, `stop`, `seed`, `n`, `logit_bias`, `logprobs`, `top_logprobs`, `stream_options`, `store`, `metadata`, `prompt`, `size`, `reasoning_effort`, `verbosity` | Würden den von Tale aufgelösten Body zerstören, Kosten still verstärken (`n`), Nutzungs-Telemetrie brechen (`stream_options`), Daten upstream leaken (`store`, `metadata`) oder die Reasoning-Token-Obergrenze umgehen. |

Dateien mit abgelehnten Schlüsseln werden beim Laden übersprungen, mit der Begründung in `skippedReasons` geloggt; Geschwister-Anbieter-Dateien laden weiter.

### Gateways gegenüber direkten Anbietern

Derselbe `providerOptions`-Block trägt unterschiedliche **Arten** von Knöpfen, je nachdem, ob der vorgelagerte Dienst ein Routing-Gateway oder ein direkter Anbieter ist.

**Gateways** stehen vor mehreren Backends. Ihre Passthrough-Felder sind Routing-Steuerungen — wähle, welches Backend die Anfrage bedient, in welcher Präzision, mit welcher Fallback-Politik. OpenRouter exponiert Routing unter einem Top-Level-Schlüssel `provider`:

```json
"providerOptions": {
  "provider": {
    "quantizations": ["fp8"],
    "allow_fallbacks": false,
    "data_collection": "deny"
  }
}
```

Vercel AI Gateway routet hauptsächlich über das Modell-ID-Präfix (`anthropic/claude-3.5`) und HTTP-Kopfzeilen (`ai-gateway-order`). Tales `providerOptions` fließt nur in den Anfrage-Body, also liegen Kopfzeilen-Routing-Steuerungen und im Vercel-Dashboard konfigurierte Beobachtbarkeits-Tags außerhalb der Anbieter-Datei:

```json
"providerOptions": {
  "order": ["anthropic", "openai"]
}
```

**Direkte Anbieter** hosten ihre eigenen Modelle. Es gibt keine Routing-Schicht — die Präzision ist pro Modell auf der Anbieterseite fest, und `quantizations` hat keine Bedeutung. Ihre Passthrough-Felder sind Modell-Verhalten-Knöpfe auf der obersten Ebene des Bodys:

```json
"providerOptions": {
  "service_tier": "priority",
  "parallel_tool_calls": false,
  "prompt_cache_key": "agent-foo-v1"
}
```

Tale leitet wortgetreu weiter. Die API-Referenz jedes Anbieters ist die Wahrheitsquelle für die exakten Feldnamen; der vorgelagerte Dienst ignoriert Felder still, die er nicht erkennt, also sieht ein Tippfehler wie ein No-Op aus statt wie ein Fehlschlag.

**Verifizieren, dass es gelandet ist.** Setze `TALE_DEBUG_LLM_WIRE=1` in der Env des convex-Containers. Der Wrapper druckt jede ausgehende Chat-, Embedding- und Bild-LLM-Anfrage auf stdout — URL plus Body-Schlüssel mit `messages` und `input` redigiert — damit du bestätigen kannst, dass das gemergte Options-Feld angekommen ist. Der Wrapper deckt Transkription, Verbindungs-Probes und den Direct-Fetch-Image-Gen-Pfad nicht ab.

**Migration.** Bestehende `.json`-Dateien ohne `providerOptions`-Block funktionieren unverändert weiter; der Block ist optional. Neue Modelle, die in der gebündelten `examples/providers/openrouter.json` hinzukommen, müssen von Hand in deployte Konfigurationen gemergt werden.

## Anbieter-Secrets-Storage

Die beiden On-Disk-Formen — SOPS-verschlüsselt und Klartext — werden zur Ladezeit am Inhalt erkannt. Die Laufzeit wählt den richtigen Pfad, egal welcher Prozess (convex, die CLI oder die Python-Dienste) liest.

### Verschlüsselt (`SOPS_AGE_KEY` gesetzt)

Wenn `SOPS_AGE_KEY` oder `SOPS_AGE_KEY_FILE` gesetzt ist, speichert Tale Secrets [SOPS](https://github.com/getsops/sops)-verschlüsselt mit dem konfigurierten age-Empfänger. `tale init` versorgt einen Schlüssel standardmäßig und nutzt diesen Modus:

```json
{
  "apiKey": "ENC[AES256_GCM,...]",
  "sops": {
    "age": [{ "recipient": "age1...", "enc": "..." }],
    "version": "3.9.4"
  }
}
```

**Schlüssel-Rotation** nutzt die Datei-Form. Zeige `SOPS_AGE_KEY_FILE` auf eine Datei mit einem oder mehreren age-Schlüsseln (einer pro Zeile, `#`-Kommentare erlaubt), dann:

1. Hänge den neuen Schlüssel als neue Zeile in der Schlüsseldatei an.
2. Speichere jeden Anbieter-API-Schlüssel über **Einstellungen > Anbieter** erneut. Jedes Speichern produziert nun Chiffretext, der sowohl mit dem alten als auch dem neuen Schlüssel lesbar ist.
3. Sobald jeder Anbieter erneut gespeichert wurde, entferne den alten Schlüssel. Neue Speicherungen verschlüsseln nur an den neuen Empfänger; bestehende Dateien entschlüsseln weiter, weil sops jeden Schlüssel in der Datei abläuft.

Die Inline-Form `SOPS_AGE_KEY` unterstützt mehrere Schlüssel nicht — wechsel zur Datei-Form für Rotation.

### Klartext (`SOPS_AGE_KEY` nicht gesetzt)

`tale init` versorgt immer einen Schlüssel, also verlangt der Klartext-Modus, dass `SOPS_AGE_KEY` in `.env` nach init explizit gelöscht und Schlüssel über die UI erneut gespeichert werden. Neue Speicherungen produzieren Klartext-JSON im Dateimodus `0600`:

```json
{ "apiKey": "sk-..." }
```

Klartext ist angemessen, wenn ein externes System bereits Anmeldedaten verwaltet — Kubernetes Secrets, eine Vault-injizierte Datei, ein gebundenes Bind-Volume. Die Plattform loggt beim Start eine einmalige Warnung, damit die Storage-Haltung für Operatoren sichtbar bleibt.

### Modi wechseln

Das Dateiformat ist selbstbeschreibend. Eine SOPS-verschlüsselte Datei bleibt nach dem Wechsel zu Klartext entschlüsselbar (vorausgesetzt, du behältst den Schlüssel), und eine Klartext-Datei bleibt nach dem Aktivieren der Verschlüsselung lesbar — Tale verschlüsselt erst beim nächsten Speichern über die UI erneut.

Um unwiederbringlichen Datenverlust zu verhindern, verweigert die Plattform das Überschreiben einer bestehenden SOPS-verschlüsselten Datei mit Klartext, wenn `SOPS_AGE_KEY` nicht mehr gesetzt ist. Stelle den Schlüssel wieder her oder entferne die verschlüsselte Datei, bevor du frische Anmeldedaten speicherst.

## Die gebündelten Beispiele nutzen

Das Repository liefert einsatzbereite Beispiel-Konfigurationen unter `examples/providers/`. Kopiere eine davon in dein Konfigurationsverzeichnis und füge den Schlüssel über die UI hinzu.

### OpenRouter (Multi-Anbieter-Gateway)

```bash
cp examples/providers/openrouter.json $TALE_CONFIG_DIR/providers/
```

Hol einen Schlüssel auf [openrouter.ai/keys](https://openrouter.ai/keys) und füge ihn über **Einstellungen > Anbieter > OpenRouter** hinzu — die App schreibt die passende `openrouter.secrets.json` im jeweils konfigurierten Modus. Die committeten `examples/providers/*.secrets.json`-Dateien sind an den age-Empfänger des Repositories verschlüsselt und nicht als Drop-in-Templates nutzbar.

### OpenAI (Whisper für Transkription)

```bash
cp examples/providers/openai.json $TALE_CONFIG_DIR/providers/
```

Füge deinen OpenAI-Schlüssel über **Einstellungen > Anbieter > OpenAI** hinzu. Das Beispiel deklariert `whisper-1` und `defaults.transcription`, also routen Audio- und Video-Chat-Anhänge hier durch, sobald ein Schlüssel gesetzt ist. Die Endnutzer-Sicht steht unter [Chat-Anhänge](/de/platform/chat/attachments#audio-and-video-transcription).

## Selbst gehostete Inferenz-Backends

Jeder Server, der die OpenAI-HTTP-API spricht, kann ein Anbieter sein. Füge eine JSON-Datei mit der Basis-URL und den Modellen hinzu, die der Server hostet. Häufige Backends:

- [Ollama](https://ollama.com) — `http://localhost:11434/v1`
- [vLLM](https://docs.vllm.ai) — `http://localhost:8000/v1`
- [LocalAI](https://localai.io) — `http://localhost:8080/v1`
- [llama.cpp server](https://github.com/ggerganov/llama.cpp) — `http://localhost:8080/v1`
- [faster-whisper-server](https://github.com/fedirz/faster-whisper-server) — `http://localhost:8000/v1` (nur Transkription)

### Ollama

```json
{
  "displayName": "Ollama (lokal)",
  "baseUrl": "http://localhost:11434/v1",
  "models": [
    { "id": "llama3.3", "displayName": "LLaMA 3.3", "tags": ["chat"] },
    { "id": "mistral", "displayName": "Mistral 7B", "tags": ["chat"] }
  ]
}
```

Ollama braucht keine Authentifizierung. Setze `apiKey` in der Secrets-Datei auf einen beliebigen nicht leeren Platzhalter — das Feld wird vom Schema verlangt, aber die Laufzeit leitet weiter, was auch immer dort steht, an einen Server, der es ignoriert.

### Lokales Whisper

```json
{
  "displayName": "Lokales Whisper",
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

Tale ruft `{baseUrl}/audio/transcriptions` auf und erwartet die OpenAI-`verbose_json`-Antwortform. faster-whisper-server, vLLM und LocalAI unterstützen sie alle.

## Docker-Host-Networking

Wenn Tale in einem Docker-Container läuft und das Inferenz-Backend auf dem Docker-Host (Ollama, vLLM, LocalAI), zeigt `localhost` innerhalb des Containers auf den Container — nicht auf den Host. Die Lösung hängt vom Host-OS ab.

Unter Docker Desktop (Mac, Windows) erreichst du den Host über seinen DNS-Alias: `http://host.docker.internal:<port>/v1`. Unter Linux füge `extra_hosts: ["host.docker.internal:host-gateway"]` zum platform-Service in `compose.yml` hinzu, oder nutze die LAN-IP des Hosts direkt, oder lege Tale und das Backend auf dasselbe Docker-Netzwerk und referenziere das Backend per Service-Name.

## Modelle für Agents verfügbar machen

Ein in einer Anbieter-Datei definiertes Modell ist erreichbar, aber noch nicht sichtbar. Damit es in der Modellauswahl eines Agents erscheint, füge seine `id` zum Array `supportedModels` des Agents in `TALE_CONFIG_DIR/agents/<slug>.json` hinzu:

```json
{
  "supportedModels": ["llama3.3", "anthropic/claude-opus-4.7"]
}
```

Die IDs entsprechen dem `id`-Feld der Modell-Definition des Anbieters exakt. Nur mit `chat` getaggte Einträge erscheinen in der Chat-Modellauswahl; `embedding`-Modelle werden von der Wissensdatenbank aufgegriffen, `transcription`-Modelle von der Audio-Pipeline und so weiter.

### Auf einen bestimmten Anbieter anheften

Wenn dieselbe Modell-ID in mehr als einer Anbieter-Datei definiert ist (`anthropic/claude-opus-4.7` in sowohl `openrouter.json` als auch einer direkten `anthropic.json`), präfixiere den Eintrag mit `<provider>:`, um das Routing anzuheften:

```json
{
  "supportedModels": [
    "openrouter:anthropic/claude-opus-4.7",
    "anthropic:claude-opus-4.7"
  ]
}
```

Einfache Einträge (ohne Doppelpunkt) lösen sich zum ersten Anbieter auf, der die ID definiert. Der Agent-Speicherpfad gibt eine Warnung aus, wenn ein nicht qualifizierter Eintrag mehr als einem Anbieter entspricht; direkte Datei-Bearbeitungen umgehen diese Validierung beim Speichern, also bevorzuge explizites Anheften für Multi-Anbieter-Setups.

## Wo das einsetzt

Die hier beschriebenen Anbieter-Dateien sind die On-Disk-Form derselben Konfiguration, die die UI schreibt, wenn ein Admin aus **Einstellungen > Anbieter** speichert. Wähle, was zur Change-Management-Haltung passt: die UI für tägliche Anpassungen, die Dateien, wenn die Konfiguration in git neben dem Rest der Infrastruktur leben soll. So oder so ist diese Seite die kanonische Referenz dafür, was jedes Feld bedeutet.

[KI-Anbieter](/de/platform/admin/providers) ist das UI-Gegenstück für Admins. [Chat-Anhänge](/de/platform/chat/attachments#audio-and-video-transcription) zeigt, wie hier konfigurierte Transkriptions-Modelle Endnutzer erreichen. [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference) deckt `TALE_CONFIG_DIR` und die anderen Variablen ab, die diese Seite annimmt.
