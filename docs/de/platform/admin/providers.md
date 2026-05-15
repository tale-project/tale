---
title: KI-Anbieter
description: Tale über Anbieter mit KI-Modellen verbinden — OpenAI-kompatible Endpunkte, verwaltet über die Einstellungen-UI.
---

Tale spricht mit KI-Modellen über **Anbieter** — jeder Anbieter ist ein OpenAI-kompatibler API-Endpunkt (OpenAI, OpenRouter, Anthropic über OpenRouter, Google, selbst gehostetes Ollama, vLLM usw.) samt Katalog an Modell-Definitionen. Ein Anbieter legt fest, _welche_ Modelle es gibt und _wie_ sie genutzt werden können (Chat, Vision, Embedding, Bild-Generierung, Transkription). Admins verwalten Anbieter unter **Einstellungen > KI-Anbieter** im laufenden Betrieb; Nutzer sehen die resultierenden Modelle im Chat-Modell-Picker und in der Agent-Konfiguration.

Tale liefert einen [OpenRouter](https://openrouter.ai)-Beispiel-Anbieter mit, der über einen einzigen API-Schlüssel Zugriff auf Modelle von OpenAI, Anthropic, Google, Mistral, Meta und anderen gibt — der schnellste Weg, einen Chat-Arbeitsbereich durchgehend lauffähig zu machen.

## Anbieter in den Einstellungen verwalten

Öffne **Einstellungen > KI-Anbieter**. Admins können:

- **Einen Anbieter hinzufügen** mit Namen, Display-Namen, Base-URL, API-Schlüssel und einem oder mehreren Modellen. Jeder Modell-Eintrag trägt eine ID (muss dem vom Endpunkt akzeptierten Namen entsprechen), einen Display-Namen, eine optionale Beschreibung und ein oder mehrere Tags.
- **Einen Anbieter bearbeiten**, um Display-Namen, Beschreibung, Base-URL, API-Schlüssel, Default-Modelle pro Capability und den Modell-Katalog zu aktualisieren.
- **Einen Anbieter löschen**, um ihn vollständig zu entfernen. Agents, die noch auf die Modelle des Anbieters verweisen, zeigen eine Warnung, bis du einen Ersatz auswählst.

Die in der Anbieter-Liste angezeigte **Beschreibung** hilft Nutzern, den Einsatzzweck zu verstehen (z. B. "OpenAI — Whisper für Speech-to-Text"). Mit **Default-Modellen** pro Capability legst du vorab fest, welches Modell für Chat, Vision, Embedding, Bild-Generierung und Transkription greift, wenn Nutzer keines explizit wählen.

## Modell-Tags

Jedes Modell gehört zu einem oder mehreren Tags. Tags steuern, wo das Modell im Produkt auftaucht:

| Tag                | Wo das Modell erscheint                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `chat`             | Erscheint im Chat-Modell-Selector und kann in `supportedModels` von Agents referenziert werden.                                     |
| `vision`           | Qualifiziert für Nachrichten mit Bild-Anhängen.                                                                                     |
| `embedding`        | Wird von der [Wissensdatenbank](/de/platform/workspace/knowledge-base) für Dokument-Retrieval genutzt.                              |
| `image-generation` | Wird von Bild-Generierungs-Agents genutzt.                                                                                          |
| `image-edit`       | Wird von Bild-Bearbeitungs-Agents genutzt.                                                                                          |
| `transcription`    | Transkribiert Audio- und Video-Uploads im Chat — siehe [Chat-Anhänge](/de/platform/chat/attachments#audio-und-video-transkription). |

Ein einzelner Anbieter kann Tags mischen — ein OpenAI-Anbieter kann `chat`-, `vision`- und `transcription`-Modelle nebeneinander bereitstellen.

## Modelle im Chat verfügbar machen

Anbieter legen fest, welche Modelle es _gibt_. Agents legen fest, auf welchen davon sie _laufen dürfen_. Öffne den Agent unter **Agents > (Agent-Name)** und ergänze Modell-IDs in der Modell-Liste; nur Modelle, die in mindestens einem Anbieter vorhanden und am Agent gelistet sind, erscheinen im Chat-Modell-Selector.

Der Standard-Chat-Agent ist mit den OpenRouter-Beispiel-Modellen vorkonfiguriert. Eigene Agents starten leer — wähle die Modelle aus, die der Agent unterstützen soll. Wie sich der Selector verhält, wenn zwei Anbieter dieselbe Modell-ID definieren (und wie Pinning funktioniert), steht in der unten verlinkten Anbieter-Referenz.

## selbst gehostet-Instanzen: Konfiguration als Dateien

selbst gehostet-Betreiber können Anbieter zusätzlich zur UI über JSON-Konfigurationsdateien verwalten — nützlich für Infrastructure-as-Code-Workflows, Bulk-Änderungen oder Deployments, in denen die UI nicht erreichbar ist. UI und Dateien bleiben synchron; das Speichern aus **Einstellungen > KI-Anbieter** schreibt dasselbe JSON.

Für das Datei-Schema, mitgelieferte Beispiel-Anbieter, SOPS-verschlüsselte Secrets, selbst gehostete Inferenz-Backends (Ollama, vLLM, LocalAI, faster-whisper-server), Docker-Host-Networking und die Syntax zum Anbieter-Pinning siehe [KI-Anbieter — Konfigurationsreferenz](/de/self-hosted/configuration/providers).

## Wo das hingehört

Anbieter sind das Tor zwischen Tale und den KI-Modellen, mit denen der Rest der Organisation spricht. Ein Agent wählt eine Modellvoreinstellung (Schnell / Standard / Erweitert); jede Voreinstellung bindet an ein bestimmtes Modell, das auf einem Anbieter definiert ist. Einen Anbieter hinzuzufügen, erweitert das Menü; einen Standard zu ändern, leitet jeden Agent um, der sich nicht explizit auf ein Modell festgelegt hat.

Die UI-Oberfläche dieser Seite ist dieselbe, die Cloud-Admins nutzen; selbst gehostete Operatoren haben die Wahl zwischen der UI und der JSON-Dateiform unter [KI-Anbieter — Konfigurationsreferenz](/de/self-hosted/configuration/providers). Sobald die Anbieter-Liste steht, leben die Modellvoreinstellungen jedes Agents auf dem Agent selbst — siehe [Agent erstellen](/de/platform/agents/create).
