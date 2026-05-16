---
title: KI-Anbieter
description: Tale über OpenAI-kompatible Anbieter mit KI-Modellen verbinden — den Katalog aus der Einstellungen-UI verwalten und Lieferanten-APIs, Gateways und selbst gehostete Inferenz unter einem Dach mischen.
---

Tale spricht mit KI-Modellen über **Anbieter** — jeder Anbieter ist ein OpenAI-kompatibler API-Endpunkt mit einem Katalog an Modell-Definitionen. Der Endpunkt kann ein gehosteter Lieferant sein (OpenAI, Anthropic über OpenRouter, Google), ein Routing-Gateway (OpenRouter, Vercel AI Gateway) oder ein selbst gehosteter Inferenz-Server (Ollama, vLLM, LocalAI, faster-whisper-server). Ein Anbieter exponiert, _welche_ Modelle existieren und _wie_ sie eingesetzt werden — Chat, Vision, Embedding, Bild-Generierung, Bild-Bearbeitung, Transkription. Admins verwalten Anbieter unter **Einstellungen > Anbieter**; Nutzer sehen die resultierenden Modelle dann in der Chat-Modellauswahl und in der Agent-Konfiguration.

Tale liefert einen [OpenRouter](https://openrouter.ai)-Beispiel-Anbieter mit, der über einen einzigen API-Schlüssel Zugriff auf Modelle von OpenAI, Anthropic, Google, Mistral, Meta und anderen gibt — der schnellste Weg von einer frischen Installation zu einem funktionierenden Chat. Mitglieder, Redakteure und Entwickler können Anbieter nicht bearbeiten; der Bildschirm ist Admin-only.

## Anbieter in den Einstellungen verwalten

Öffne **Einstellungen > Anbieter**. Die Listenansicht lässt Admins:

- **Anbieter hinzufügen** — öffnet den Erstellen-Dialog. Name, Anzeigename, Basis-URL, API-Schlüssel und ein oder mehrere Modelle. Jedes Modell trägt eine ID (muss zu dem passen, was der Endpunkt akzeptiert), einen Anzeigenamen, eine optionale Beschreibung und ein oder mehrere Tags.
- **Anbieter bearbeiten** — aufgeteilt in **Details bearbeiten** (Anzeigename, Beschreibung, Basis-URL), **Standards bearbeiten** (das Standard-Modell pro Fähigkeit — siehe unten), den API-Schlüssel und den Modell-Katalog.
- **Anbieter löschen** — entfernt den Anbieter komplett. Agents, die noch eines seiner Modelle referenzieren, zeigen eine Warnung, bis der Agent neu gebunden ist.
- **Verbindung testen** — schickt eine kleine Anfrage an jedes Modell im Katalog und meldet je-Modell-Latenz und Erreichbarkeit. Nutze sie nach einem API-Schlüssel-Tausch oder nach Umstellung der Basis-URL auf einen neuen Endpunkt.

Das in der Anbieter-Liste angezeigte **Beschreibung**-Feld ist für den Menschen — etwa `OpenAI — Whisper für Speech-to-Text` macht den Katalog selbsterklärend, wenn ein Team mehrere mischt. **Standard-Modelle** pro Fähigkeit entscheiden, welches Modell für Chat, Vision, Embedding, Bild-Generierung, Bild-Bearbeitung und Transkription verwendet wird, wenn weder Nutzer noch Agent explizit eines wählen.

## Modell-Tags

Jedes Modell gehört zu einem oder mehreren Tags. Das Tag steuert, wo das Modell wählbar ist.

| Tag                | Wo das Modell angeboten wird                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `chat`             | Die Chat-Modellauswahl und `supportedModels` eines Agents.                                                                                |
| `vision`           | Geeignet für Nachrichten mit Bildanhängen.                                                                                                |
| `embedding`        | Wird von der [Wissensdatenbank](/de/platform/workspace/knowledge-base) für die Dokument-Suche verwendet.                                  |
| `image-generation` | Wird von Bild-Generierungs-Agents verwendet (`/v1/images/generations` oder `/v1/chat/completions` mit Bild-Content-Parts, je nach Modus). |
| `image-edit`       | Wird von Bild-Bearbeitungs-Agents verwendet.                                                                                              |
| `transcription`    | Transkribiert Audio- und Video-Chat-Uploads — siehe [Chat-Anhänge](/de/platform/chat/attachments#audio-and-video-transcription).          |

Ein einzelner Anbieter darf Tags mischen — ein OpenAI-Anbieter kann `chat`-, `vision`- und `transcription`-Modelle nebeneinander exponieren. Modelle ohne Tag sind im übrigen Produkt unsichtbar, sodass der Katalog je Fähigkeit Opt-in ist.

## Wie Modelle in den Chat gelangen

Anbieter definieren, welche Modelle _existieren_. Agents definieren, auf welchen dieser Modelle sie _laufen können_. Öffne den Agent unter **Agents > (Agent-Name)** und füge seinem **Modell**-Abschnitt Modell-IDs hinzu; nur Modelle, die mindestens bei einem Anbieter vorhanden _und_ auf dem Agent gelistet sind, erscheinen in der Chat-Modellauswahl. Der Standard-Chat-Agent ist mit den OpenRouter-Beispiel-Modellen vorkonfiguriert; eigene Agents starten leer, damit der Katalog explizit bleibt.

Wie sich die Auswahl verhält, wenn zwei Anbieter dieselbe Modell-ID definieren, und welche Pinning-Syntax Agents einen bestimmten Anbieter bevorzugen lässt, steht in der Datei-Referenz, die unten verlinkt ist.

## Anbieter-Optionen (Fortgeschritten)

Das Panel **Anbieter-Optionen** leitet ein frei geformtes JSON-Objekt als zusätzliche Felder im Anfrage-Body bei jedem Modell-Aufruf weiter. Tale interpretiert das JSON nicht — es reicht es wortgetreu durch — also wird die Form vom Upstream-API diktiert. Gateways und Direkt-Lieferanten exponieren unterschiedliche Stellschrauben:

- **OpenRouter (Gateway)** — Routing-Steuerung unter einem Top-Level-`provider`-Schlüssel:

  ```json
  { "provider": { "quantizations": ["fp8"], "allow_fallbacks": false } }
  ```

- **Vercel AI Gateway (Gateway)** — routet vor allem über Modell-ID-Präfix und HTTP-Kopfzeilen; Body-Passthrough ist auf Observability-Felder wie `metadata` begrenzt:

  ```json
  { "metadata": { "tale_agent": "support" } }
  ```

- **OpenAI (direkt)** — Modell-Verhaltens-Stellschrauben auf Top-Level:

  ```json
  { "service_tier": "priority", "parallel_tool_calls": false }
  ```

- **Together AI (direkt)** — Moderations- und Decoding-Stellschrauben auf Top-Level:

  ```json
  { "safety_model": "meta-llama/Llama-Guard-4-12B", "repetition_penalty": 1.1 }
  ```

Direkt-Lieferanten exponieren `quantizations` nicht als Anfrage-Feld — die Präzision liegt zur Deploy-Zeit fest, also wähle stattdessen eine andere Modell-ID. Schlüssel wie `model`, `messages`, `max_tokens` und `temperature` werden auf dieser Schicht abgelehnt, weil sie auf den Agent gehören, nicht auf den Anbieter.

Dasselbe Panel existiert auf Modell-Ebene — das Modell-JSON wird auf die Anbieter-Voreinstellungen draufgemerged, sodass ein Modell-Override das gemeinsame Objekt nicht duplizieren muss.

## Selbst gehostete Instanzen: Konfiguration als Dateien

Selbst gehostete Operatoren dürfen Anbieter zusätzlich über JSON-Konfigurationsdateien verwalten — nützlich für Infrastructure-as-Code-Workflows, Massen-Edits oder Deployments, bei denen die UI nicht erreichbar ist. UI und Dateien bleiben synchron; das Speichern aus **Einstellungen > Anbieter** schreibt dasselbe JSON. Geheimnisse dürfen auf der Platte SOPS-verschlüsselt sein und bleiben aus dem UI bearbeitbar.

Für das Datei-Schema, die mitgelieferten Beispiel-Anbieter, die selbst gehosteten Inferenz-Backends (Ollama, vLLM, LocalAI, faster-whisper-server), Docker-Host-Networking und die Pinning-Syntax siehe [Anbieter — Konfigurations-Referenz](/de/self-hosted/configuration/providers).

## Wo das hingehört

Anbieter sind das Tor zwischen Tale und den KI-Modellen, mit denen der Rest der Organisation spricht. Ein Agent wählt eine Modell-Vorlage (Schnell, Standard, Erweitert); jede Vorlage ist an ein bestimmtes Modell eines Anbieters gebunden. Einen Anbieter hinzuzufügen erweitert das Menü; einen Standard zu ändern leitet jeden Agent um, der sich nicht explizit auf ein Modell festgelegt hat.

Die UI, die diese Seite beschreibt, ist die gleiche, die Cloud-Admins verwenden. Selbst gehostete Operatoren haben die Wahl zwischen UI und JSON-Datei-Form, dokumentiert unter [Anbieter — Konfigurations-Referenz](/de/self-hosted/configuration/providers). Sobald die Anbieter-Liste sitzt, leben die Modell-Vorlagen je Agent auf dem Agent selbst — siehe [Agent erstellen](/de/platform/agents/create) für die Agent-Konfiguration.
