---
title: Lokalen Anbieter verbinden
description: Ollama oder vLLM als Tale-KI-Anbieter einbinden, damit Agents auf vollständig selbst gehosteten Modellen laufen.
---

Tale verbindet sich über [KI-Anbieter](/de/platform/admin/providers) zu KI-Modellen — jeder OpenAI-kompatible Endpoint qualifiziert sich, einschließlich lokaler Runtimes wie [Ollama](https://ollama.com), [vLLM](https://docs.vllm.ai) und [LocalAI](https://localai.io). Agents gegen einen lokalen Anbieter laufen zu lassen, hält Prompts, Completions und Wissensdatenbank-Kontext in deinem eigenen Netz; nichts erreicht einen gehosteten Modell-Anbieter. Dieses Tutorial führt durch das Hinzufügen von Ollama als Anbieter, das Anbinden eines Modells an einen Agent und das Aktivieren.

Du brauchst Admin-Zugriff. Ein laufender Ollama- oder vLLM-Server, erreichbar von deiner Tale-Instanz, ist die einzige externe Voraussetzung — siehe die jeweiligen Install-Guides.

## Schritt 1 — Die lokale Runtime starten

Für Ollama auf demselben Host wie Tale:

```bash
ollama pull llama3.3
ollama serve
```

Ollama lauscht standardmäßig auf `http://localhost:11434`. Prüfe die Erreichbarkeit:

```bash
curl -s http://localhost:11434/api/tags | jq '.models[].name'
```

Wenn Tale in Docker läuft, zeige statt auf `localhost` auf den Host — auf Linux nutze `http://host.docker.internal:11434` mit explizitem Docker-Extra-Host oder die LAN-IP des Hosts. Siehe [Self-hosted-Konfiguration](/de/self-hosted/configuration/environment-reference) für die Netzwerk-Optionen.

## Schritt 2 — Den Anbieter in Tale hinzufügen

Navigiere zu **Einstellungen > KI-Anbieter** und klicke **Anbieter hinzufügen**. Fülle aus:

| Feld          | Wert                                               |
| ------------- | -------------------------------------------------- |
| Name          | `ollama-local` (Slug, intern verwendet)            |
| Anzeigename   | `Ollama (lokal)`                                   |
| Base-URL      | `http://host.docker.internal:11434/v1`             |
| API-Schlüssel | Beliebiger nicht-leerer Wert — Ollama auth't nicht |

Füge je Runtime-Modell, das du freigeben willst, einen Modell-Eintrag hinzu:

| Feld        | Wert                                       |
| ----------- | ------------------------------------------ |
| ID          | `llama3.3` (muss exakt Ollama entsprechen) |
| Anzeigename | `LLaMA 3.3`                                |
| Tags        | `chat`                                     |

Speichern. Der Anbieter erscheint in der Liste.

Bei vLLM ist der Ablauf identisch; die Base-URL ist, was du konfiguriert hast (üblich `http://vllm.internal:8000/v1`), und die Modell-ID muss dem `--served-model-name`-Flag entsprechen, mit dem du vLLM gestartet hast.

## Schritt 3 — Das Modell einem Agent zuordnen

Öffne **Agents**, wähle den Agent, der auf dem lokalen Modell laufen soll, und öffne sein JSON unter `TALE_CONFIG_DIR/agents/<slug>.json`. Füge die Modell-ID in `supportedModels` hinzu:

```json
{
  "supportedModels": ["llama3.3"]
}
```

Wenn zwei Anbieter dieselbe Modell-ID definieren, stelle den Anbieter-Slug voran, um das Routing zu pinnen:

```json
{
  "supportedModels": ["ollama-local:llama3.3"]
}
```

Siehe [KI-Anbieter — Modelle für Agents verfügbar machen](/de/self-hosted/configuration/providers#modelle-für-agents-verfügbar-machen) für die vollen Regeln.

## Schritt 4 — Aus dem Chat testen

Öffne **Chat**, wähle den Agent und frag irgendetwas. In **Einstellungen > Usage Analytics** oder der Konversationshistorie des Agents prüfst du, dass die Anfrage von `ollama-local` bedient wurde — die Modell-ID steht in den Thread-Metadaten. Die Latenz ist höher als bei einem gehosteten Frontier-Modell; das ist auf den meisten Maschinen erwartet.

Wenn Tale auf einen anderen Anbieter zurückfällt, passt die Modell-ID entweder nicht zur Ollama-Liste, oder `supportedModels` enthält noch einen Frontier-Modell-Eintrag, der Priorität hat — entfernen oder umsortieren.

## Schritt 5 — In die Muss-Tutorials einbinden

Beide Admin-Muss-Tutorials profitieren von einem lokalen Anbieter:

- **Office Agents** — das Add-in trifft Tale; Tale routet zum lokalen Modell. Keine Änderung auf Add-in-Seite. Siehe [Word- & Excel-Add-in](/de/tutorials/admin/office-add-in).
- **Meeting-Transkription** — Meetily läuft Whisper bereits lokal; ein lokaler Anbieter schließt die Kette, sodass auch das Zusammenfassungs-LLM lokal ist. Siehe [Meeting-Transkription](/de/tutorials/admin/meeting-transcription).

## Troubleshooting

- **Tale erreicht Ollama aus Docker nicht** — `localhost` im Tale-Container ist nicht der Host. Nutze `host.docker.internal` (Docker Desktop), die Host-LAN-IP oder hänge Ollama und Tale ins selbe Docker-Netzwerk.
- **404 auf Modell** — Modell-ID ist case-sensitive und muss dem entsprechen, was `ollama list` ausgibt.
- **Leere oder sehr kurze Antworten** — das Default-Kontextfenster von Ollama ist klein. Ziehe eine Variante mit größerem Kontext oder überschreibe `num_ctx` im `Modelfile` des Modells.
- **Verschlüsselter API-Schlüssel verlangt** — wenn du Anbieter-Dateien direkt editierst, muss die API-Schlüssel-Datei SOPS-verschlüsselt sein. Den Schlüssel über die UI zu setzen übernimmt die Verschlüsselung; siehe [KI-Anbieter — SOPS-verschlüsselte Secrets](/de/self-hosted/configuration/providers#sops-verschlüsselte-secrets).
