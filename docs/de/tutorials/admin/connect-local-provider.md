---
title: Lokalen Anbieter verbinden
description: Ollama oder vLLM als Tale-KI-Anbieter einbinden, damit Agents auf vollständig selbst gehosteten Modellen laufen.
---

Tale verbindet sich mit KI-Modellen über [Anbieter](/de/platform/admin/providers) — jeder OpenAI-kompatible Endpunkt qualifiziert sich, einschließlich lokaler Laufzeiten wie [Ollama](https://ollama.com), [vLLM](https://docs.vllm.ai) und [LocalAI](https://localai.io). Agents gegen einen lokalen Anbieter laufen zu lassen hält Prompts, Completions und Wissensdatenbank-Kontext in deinem Netzwerk; nichts erreicht einen gehosteten Modell-Anbieter. Dieses Integrations-Tutorial führt durch das Hinzufügen von Ollama als Anbieter, das Freischalten eines Modells für Agents und die Bestätigung, dass die Inferenz lokal läuft.

Das Ergebnis am Ende ist ein funktionierender Air-Gap-Pfad: jeder Chat oder jede Automatisierung, die das lokale Modell wählt, routet über Hardware, die du kontrollierst.

## Bevor du beginnst

Du brauchst Admin- oder Inhaber-Zugriff in Tale — beide Rollen können Anbieter bearbeiten. Du brauchst außerdem einen lauffähigen Ollama- oder vLLM-Server, der von deiner Tale-Instanz per HTTP erreichbar ist; die jeweiligen Installations-Leitfäden decken das Setup ab. Läuft Tale selbst in Docker, muss die Laufzeit über das Docker-Netzwerk erreichbar sein (die [Self-hosted-Netzwerk-Referenz](/de/self-hosted/configuration/environment-reference) deckt die Optionen ab). Für Ollama brauchst du zusätzlich mindestens ein heruntergeladenes Modell — `ollama pull <name>` lädt es.

Kein externes Konto, kein API-Schlüssel, kein Feature-Flag.

## Schritt 1 — Die lokale Laufzeit starten und prüfen, dass sie antwortet

Ein Anbieter, der seinen Endpunkt nicht erreicht, ist der häufigste Konfigurationsfehler — also stelle sicher, dass die Laufzeit wirklich serviert, bevor du Tale darauf zeigst. Für Ollama auf demselben Host:

```bash
ollama pull llama3.3
ollama serve
```

Ollama lauscht standardmäßig auf `http://localhost:11434`. Bestätige mit einer Modellliste:

```bash
curl -s http://localhost:11434/api/tags | jq '.models[].name'
```

Läuft Tale in Docker, ist `localhost` im Tale-Container der Container selbst — zeige stattdessen auf den Host. Auf Docker Desktop nutze `http://host.docker.internal:11434`; auf Linux die LAN-IP des Hosts mit einem expliziten `extra_hosts`-Eintrag, oder packe Ollama und Tale ins selbe Docker-Netzwerk.

Der Schritt hat funktioniert, wenn das `curl` oben mindestens einen Modellnamen listet.

## Schritt 2 — Den Anbieter in Tale hinzufügen

Öffne **Einstellungen > KI-Anbieter** und klicke **Anbieter hinzufügen**. Trage ein:

| Feld          | Wert                                                     |
| ------------- | -------------------------------------------------------- |
| Name          | `ollama-local` (Slug, intern verwendet)                  |
| Anzeigename   | `Ollama (lokal)`                                         |
| Basis-URL     | `http://host.docker.internal:11434/v1`                   |
| API-Schlüssel | Ein beliebiger nicht-leerer Wert — Ollama hat keine Auth |

Füge pro Laufzeit-Modell, das du Agents zugänglich machen willst, einen Modell-Eintrag hinzu:

| Feld        | Wert                                       |
| ----------- | ------------------------------------------ |
| ID          | `llama3.3` (muss exakt Ollama entsprechen) |
| Anzeigename | `LLaMA 3.3`                                |
| Tags        | `chat`                                     |

Speichern. Für vLLM ist der Ablauf identisch — die Basis-URL ist, was du für vLLM eingerichtet hast (häufig `http://vllm.internal:8000/v1`), und die Modell-ID muss zum `--served-model-name`-Flag passen.

Der Schritt hat funktioniert, wenn der Anbieter in der KI-Anbieter-Liste mit grünem Health-Indikator erscheint.

## Schritt 3 — Das Modell für einen Agent freigeben

Öffne **Agents**, wähle den Agent, der auf dem lokalen Modell laufen soll, und öffne seine Datei unter `TALE_CONFIG_DIR/agents/<slug>.json`. Füge die Modell-ID zu `supportedModels` hinzu:

```json
{
  "supportedModels": ["llama3.3"]
}
```

Wenn zwei Anbieter dieselbe ID exponieren, präfixe mit dem Anbieter-Slug, um das Routing festzulegen:

```json
{
  "supportedModels": ["ollama-local:llama3.3"]
}
```

Die vollen Routing-Regeln — Anbieter-Reihenfolge, Fallbacks, wann ein Präfix nötig ist — liegen unter [Anbieter — Modelle für Agents verfügbar machen](/de/self-hosted/configuration/providers#making-models-available-to-agents).

Der Schritt hat funktioniert, wenn der Composer des Agents das Modell im Modell-Picker-Dropdown zeigt.

## Schritt 4 — Aus dem Chat testen und bestätigen, dass das Modell die Anfrage bediente

Öffne **Chat**, wähle den Agent, sende einen kurzen Prompt. Die Latenz wird höher sein als bei einem gehosteten Frontier-Modell — das ist erwartet. Öffne dann die Konversationshistorie des Agents (oder **Nutzungs-Analyse**) und bestätige, dass das verwendete Modell `llama3.3` und der Anbieter `ollama-local` war.

Hat ein anderer Anbieter geantwortet, passt entweder die Modell-ID nicht zu Ollamas Liste (Groß-/Kleinschreibung beachten), oder `supportedModels` enthält noch einen Frontier-Modell-Eintrag, der im Routing Vorrang hat.

Der Schritt hat funktioniert, wenn die Thread-Metadaten `ollama-local` als Anbieter zeigen.

## Vertrauensgrenze

Was in jeder Richtung über das Netz geht und was nicht:

- **Von Tale zur lokalen Laufzeit**: HTTP-Anfragen nur über dein privates Netz, die Prompts, Systemanweisungen und etwaige abgerufene Wissensdatenbank-Chunks tragen. Mit Ollama oder vLLM auf demselben Host bleibt der Verkehr auf dem Loopback des Hosts.
- **Von der lokalen Laufzeit zu Tale**: HTTP-Antworten mit den Completions des Modells.
- **Von der lokalen Laufzeit zum Modell-Anbieter**: nichts. Ollama und vLLM servieren Open-Weight-Modelle aus lokalen Dateien; es gibt keinen Upstream-Aufruf.
- **Von Tale zu einem gehosteten Anbieter**: nichts, **vorausgesetzt** jedes Modell, auf das ein Agent zurückfallen könnte, ist ebenfalls lokal. Enthält `supportedModels` ein gehostetes Modell neben dem lokalen, könnte eine Routing-Entscheidung eine Anfrage rausschicken — prüfe die Liste, bevor du Air-Gap beanspruchst.

Der letzte Punkt ist die häufigste Lücke in beanspruchten Air-Gap-Deployments: der lokale Anbieter ist korrekt verdrahtet, aber ein Fallback auf einen gehosteten Anbieter sitzt einen Eintrag weiter in der Agent-Konfiguration.

## Fehlerbehebung

- **Tale erreicht Ollama nicht aus Docker** — `localhost` im Tale-Container ist der Container, nicht der Host. Wechsle zu `host.docker.internal` (Docker Desktop), der LAN-IP des Hosts mit `extra_hosts`-Eintrag, oder einem geteilten Docker-Netzwerk.
- **404 auf das Modell** — die ID beachtet Groß-/Kleinschreibung und muss exakt zu dem passen, was `ollama list` ausgibt. Aus der Laufzeit kopieren, nicht aus der Modell-Karte.
- **Antworten sind leer oder ein Satz** — Ollamas Standard-Kontextfenster ist klein. Ziehe eine grösser-Kontext-Variante (`llama3.3:8k`, `llama3.3:128k`) oder überschreibe `num_ctx` im Modelfile des Modells.
- **API-Schlüssel-Dateiformat-Fehler beim Editieren** — direkt editierte Anbieter-Dateien müssen zum Verschlüsselungsmodus passen: SOPS-verschlüsselt, wenn `SOPS_AGE_KEY` gesetzt ist, Klartext-JSON sonst. Den Schlüssel über die UI zu setzen schreibt die richtige Form für dich. Siehe [Anbieter — Speicherung der Anbieter-Secrets](/de/self-hosted/configuration/providers#provider-secrets-storage).

## Wo das einsetzt

Einen lokalen Anbieter anzubinden ist der Air-Gap-Baustein: ist er einmal da, nutzt jede andere Tale-Oberfläche — Agents, Automatisierungen, Chat — ihn so, wie sie einen gehosteten Anbieter nutzen würde. Der Unterschied ist operativ (eigene Hardware, höhere Latenz, keine Kosten pro Token) und Vertrauensgrenze (kein Verkehr zu einem Modell-Anbieter); das Verhalten ist dasselbe.

Der Lokaler-Anbieter-Pfad passt sauber zu zwei anderen Integrations-Tutorials: [Meeting-Transkription](/de/tutorials/admin/meeting-transcription) hält den Audio-Pfad auf dem Gerät, während das Zusammenfassungs-LLM lokal bleibt, und [Word- & Excel-Add-in](/de/tutorials/admin/office-add-in) routet Office-Verkehr durch Tale zu welchem Anbieter auch immer du konfiguriert hast.
