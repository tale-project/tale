---
title: Anbieter
description: Konfiguriere eigene KI-Endpunkte, verstehe Anbieterdefinitionen und übergib Zugangsdaten aus der Bereitstellungsumgebung.
---

Unterscheide bei einem KI-Anbieter drei Dinge: Connector-Definition, Zugangsdaten der Organisation und Modellserver. Der Connector beschreibt Endpunkt und Protokoll, Zugangsdaten steuern den Zugriff, und der Endpunktbetreiber betreibt den Modelldienst.

Diese Seite behandelt eigene Anbieterdefinitionen und Geheimnisse aus der Umgebung. Zugangsdaten und Standardmodelle in der App beschreibt [KI-Anbieter](/de/platform/admin/providers).

## Lokale Anbieterendpunkte

Ein lokaler Inferenzserver braucht eine Anbieterdefinition und die Erlaubnis für das Backend, seinen Host zu erreichen. Die Definition installiert keinen Server und lädt kein Modell.

1. Mache den Inferenzserver für jede Backend-Rolle erreichbar, die ihn aufruft. `localhost` bezeichnet im Container diesen Container, nicht den Hostrechner. Prüfe Namensauflösung, Netzwerkzugriff und gegebenenfalls das TLS-Zertifikat aus dem tatsächlichen Laufzeitnetz.
2. Setze für einen privaten oder Loopback-Endpunkt `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1` in der Backend-Bereitstellungsumgebung. Die Einstellung erlaubt private Anbieterhosts für die gesamte Installation; sie ist keine Freigabeliste einzelner Anbieter. Cloud-Metadatenendpunkte bleiben gesperrt. Erstelle die betroffenen Container neu, um die Änderung zu übernehmen. Ein Neustart behält ihre bestehende Compose-Umgebung.
3. Lege die Anbieterdefinition unter `TALE_CONFIG_DIR/<orgSlug>/providers/local-models.yml` ab oder nutze den [verwalteten Konfigurationsablauf](/de/self-hosted/configuration/config-releases). Halte das native Anbieterschema ein und wähle einen Namen, der nicht mit einer mitgelieferten Definition kollidiert.

Ersetze im Beispiel private IP und Port durch deinen erreichbaren Server. HTTP ist nur für als privat oder Loopback erkannte Hosts zulässig; öffentliche Endpunkte brauchen HTTPS. Ein interner DNS-Name umgeht die Prüfung privater Hosts zur Anfragezeit nicht.

```yaml
name: local-models
displayName: Local models
apiFormat: openai
baseUrl: http://192.168.1.20:8000/v1
catalog:
  source: models-endpoint
auth:
  - method: api-key
  - method: env
```

Die Definition verwendet eine OpenAI-kompatible Chat-API und liest Modelle aus `/v1/models`. Prüfe die tatsächliche Kompatibilität des Servers. Eine Modellliste beweist noch nicht, dass Generierung, Werkzeugaufrufe oder Streaming funktionieren. Kann der Server keine Modelle auflisten, verwende `catalog.source: none` und trage die genauen Modellbezeichner in die Freigabeliste der Zugangsdaten ein. Eigene Anbieter laden keine statische Modelldatei aus dem Organisationsverzeichnis.

Lass anschließend einen Organisationsadmin unter [KI-Anbieter](/de/platform/admin/providers) Zugangsdaten hinzufügen, den Katalog aktualisieren und ein bestimmtes Modell für einen kurzen Chat auswählen. Prüfe die abgeschlossene Anfrage im Protokoll des vorgesehenen Inferenzservers. Für Embeddings, Sprache und Werkzeugverkehr musst du die Ziele getrennt prüfen; ein lokaler Chatendpunkt hält sie nicht automatisch lokal.

## Audiotranskription konfigurieren

Die Organisationsrichtlinie liegt unter `TALE_CONFIG_DIR/<org>/governance/transcription-model.yml` und hat den Richtlinientyp `transcription_model`. Die Seite [Modelle](/de/platform/admin/governance/content-models) bearbeitet dieselbe Auswahl. Eine fehlende Datei oder ein leeres Objekt bedeutet automatische Auswahl:

```yaml
{}
```

Um ein Modell festzulegen, gib beide Felder an. Dieses Beispiel verwendet das mitgelieferte OpenAI-Whisper-Modell und benötigt weiterhin einen aktiven, nutzbaren Zugang der Organisation:

```yaml
providerSlug: openai
modelId: whisper-1
```

Eine unvollständige Festlegung ist ungültig. Ist das festgelegte Modell nicht verfügbar, wechselt Tale nie zu einem anderen Modell. Stelle den Zugang oder die dafür erlaubten Modelle wieder her oder wechsle ausdrücklich zur automatischen Auswahl. Auch Lese- oder Validierungsfehler der Konfiguration verhindern die serverseitige Transkription. Die Richtlinie gilt für Audio- und Videodateien, Videolinks mit Audiotranskription und Serverdiktate. Die Spracherkennung des Browsers bleibt davon unabhängig.

Mit einem aktiven Standardzugang für OpenRouter findet Tale auch die Modelle zur Spracherkennung unter `/models?output_modalities=transcription`. Dafür gelten derselbe Zugang und dessen erlaubte Modelle. Übernimm beim Festlegen eines Modells die genaue Kennung aus diesem Katalog oder behalte die automatische Auswahl bei. Die Schnittstelle beschreibt [OpenRouters Anleitung zur Spracherkennung](https://openrouter.ai/docs/guides/overview/multimodal/stt).

Für einen eigenen OpenAI-kompatiblen Endpunkt verwende `catalog.source: models-endpoint`. Seine Antwort auf `/models` muss das Audiomodell mit einer genauen `id` und entweder `type: transcription` oder `architecture.output_modalities: [transcription]` ausweisen. Bei einem reinen Transkriptionsmodell darf `context_window` fehlen oder `0` sein; andere Modelle brauchen weiterhin einen positiven Wert. Ein Chatmodell mit Audioeingabe oder ein Sprachsynthesemodell gilt nicht automatisch als Transkriptionsmodell.

Tale sendet die Multipart-Felder `file` und `model` mit Bearer-Authentifizierung an `POST <baseUrl>/audio/transcriptions`. Bei OpenRouter fordert Tale `response_format: json` an, weil einige der dort verfügbaren Modelle `verbose_json` ablehnen. Andere kompatible Endpunkte müssen `response_format: verbose_json` unterstützen. Die JSON-Antwort liefert das Transkript als `text`. Tale verwendet zuerst eine gültige `duration`, ersatzweise eine gültige `usage.seconds`. Ist keiner der Werte nutzbar, verwendet Tale eine lokal gemessene Dauer, soweit verfügbar. Zeitangaben in `segments` können Videozeitstempel liefern; ohne sie bleibt das Transkript reiner Text. Ein Katalogeintrag beweist nicht, dass diese API funktioniert. Aktualisiere den Katalog, wähle das Modell, teste eine kurze Aufnahme und prüfe die Anfrage in den Logs dieses Endpunkts.

## Modellzugriff aus der Sandbox prüfen

Chats rufen einen Anbieter aus dem Backend auf. Coding-Agenten verwenden `sandbox-llm-gateway`; ein erfolgreicher Chat belegt daher nicht den Agentenpfad. Der Endpunkt muss aus Backend und Gateway auflösbar und erreichbar sein. Beide HTTPS-Clients müssen seinem Zertifikat vertrauen. Auch ein Name wie `https://models.internal/v1` braucht die Freigabe privater Anbieter, wenn DNS ihn zu einer privaten Adresse auflöst. HTTP bleibt auf die vom Anbieterschema akzeptierten Hostformen begrenzt, etwa private IP-Adressen, `localhost` und `.local`.

Beim Start einer neuen Sandbox-Sitzung prüft das Backend Hostname und DNS-Antworten des eigenen Anbieters, bevor es ihn im Gateway einrichtet. Private Ziele erfordern `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1`; Metadatenziele bleiben auch damit gesperrt. Diese Vorprüfung bindet spätere Gateway-Anfragen nicht an dieselbe DNS-Antwort. Anbieterdefinitionen und DNS müssen deshalb unter der Kontrolle vertrauenswürdiger Betreiber bleiben.

Erstelle die betroffenen Backend-Prozesse mit der aktualisierten Umgebung neu. Starte dann eine neue Sandbox-Sitzung mit dem vorgesehenen Anbieter und Modell sowie einer kompatiblen Agenten-Laufzeit. Prüfe mit einer harmlosen Anfrage die vollständige Antwort und den passenden Eintrag im Inferenzserver-Protokoll. Funktioniert der Chat, aber der Agent erreicht sein Modell nicht, prüfe die Protokolle von `sandbox-llm-gateway`. `SANDBOX_EGRESS_ALLOWLIST` steuert allgemeine Webzugriffe der Sandbox, nicht diese separate Modellverbindung.

Coding-Agenten richten sich außerdem nach dem Kontextfenster, das der Katalog für das Modell meldet: nach `context_length` oder `context_window` in der Modellliste deines Servers unter `/v1/models`, bei einem Anbieter mit `catalog.source: none` nach 128.000 Token. Sorge dafür, dass die Liste den Kontext nennt, den dein Server tatsächlich bereitstellt. Liegt dieses Fenster oder ein niedrigeres [Kontextlimit](/de/platform/admin/governance/policies-and-limits) der Person, die den Lauf gestartet hat, unter 200.000 Token, fasst eine verwaltete Claude-Code-Sitzung ihre Konversation zusammen, bevor der Prompt darüber hinauswächst. Claude Code behandelt jeden Wert unter 100.000 Token wie 100.000. Ein Modell mit weniger Kontext kann also längere Prompts erhalten, als es aufnehmen kann. Setze Claude Code deshalb nur mit Modellen ein, die mindestens so viel Kontext bereitstellen.

Auf einem Modell, das nicht Claude ist, lässt eine verwaltete Claude-Code-Sitzung außerdem die Zuordnungszeile weg, die Claude Code sonst an den Anfang jedes Systemprompts stellt. Diese Zeile ändert sich mit jeder Anfrage, und ein Server, der Prompt-Anfänge zwischenspeichert, müsste sonst bei jedem Schritt die ganze Konversation neu berechnen.

## Wo die Connectoren liegen

Mitgelieferte Definitionen liegen unter `configs/platform/system/providers/<slug>/provider.yml`, ihre statischen Kataloge unter `configs/platform/system/models/<slug>/models.yml`. Anthropic verwendet beispielsweise `providers/anthropic/provider.yml` und `models/anthropic/models.yml`. Die Dateien gehören zum Image und ändern sich mit dessen Version.

<Warning>

Mitgelieferte Dateien sind schreibgeschützte Image-Eingaben und werden beim Upgrade ersetzt. Nutze für externe Anbieter die geprüfte Deployment-Deklaration `configuration` aus [CLI-Installation](/de/self-hosted/install/cli-install#plattform-konfigurieren). Sie erstellt mit dem nativen Schema einen organisationsgebundenen Connector unter `TALE_CONFIG_DIR/<org>/providers/`; Änderungen an Zugangsdaten und Richtlinien nutzen native APIs.

</Warning>

## Was ein Connector deklariert

Eine Definition beschreibt Protokoll, Endpunkt, Katalog und erlaubte Authentifizierungsmethoden. Sie enthält keine Zugangsdaten einer Organisation. Diese beiden Ausschnitte zeigen das Format:

<CodeGroup>

```yaml anthropic.yml
name: anthropic
displayName: Anthropic
apiFormat: anthropic
baseUrl: https://api.anthropic.com
catalog:
  source: static
auth:
  - method: api-key
  - method: env
  - method: subscription-broker
    constraints:
      execution: sandbox
      harness: claude-code
```

```yaml openrouter.yml
name: openrouter
displayName: OpenRouter
apiFormat: openai
baseUrl: https://openrouter.ai/api/v1
catalog:
  source: openrouter-api
auth:
  - method: api-key
  - method: env
```

</CodeGroup>

| Feld | Bedeutung |
| --- | --- |
| `apiFormat` | Anfrageformat: `openai` oder `anthropic`. |
| `wireDialect: openai-modern` | Für Endpunkte im OpenAI-Format: verwendet `max_completion_tokens` und lässt eigene Temperaturwerte bei Reasoning-Modellen weg. Für Endpunkte mit klassischen Feldern bleibt es ungesetzt. |
| `baseUrl` | Fester Endpunkt für alle zugehörigen Zugangsdaten. |
| `endpointMode: per-credential` | Verwendet statt `baseUrl` einen Endpunkt je Zugangsdaten-Eintrag, etwa bei Azure OpenAI. |
| `catalog.source` | `static`, `openrouter-api`, `models-endpoint` oder `none`. Statische Einträge stammen aus dem oben beschriebenen Modellkatalog. |
| `auth` und `constraints` | Erlaubte Zugangsmethoden und Ausführungsbedingungen, etwa ein bestimmter Sandbox-Harness. |

## Umgebungsvariable als Schlüsselquelle {#umgebungsvariable-als-schlusselquelle}

Bei der Authentifizierungsmethode **Umgebungsvariable** speichern die Zugangsdaten einen Variablennamen. Das Backend liest dessen Wert bei der Anfrage aus seiner Prozessumgebung. Übergib ihn über die Geheimnisverwaltung deiner Bereitstellung. Bei dieser Methode wird der API-Schlüssel nicht in der Anwendungsdatenbank gespeichert.

Zulässig sind nur Namen mit dem Präfix `TALE_PROVIDER_KEY_`. Der vollständige Name darf höchstens 40 Zeichen haben; im Suffix sind Buchstaben, Ziffern und Unterstriche erlaubt. Das Formular ergänzt das Präfix automatisch.

```bash
TALE_PROVIDER_KEY_OPENROUTER=sk-or-...
TALE_PROVIDER_KEY_OPENAI_PROD=sk-...
```

<Note>

Das reservierte Präfix verhindert, dass Zugangsdaten auf fremde Geheimnisse wie `SOPS_AGE_KEY` oder `BETTER_AUTH_SECRET` verweisen. Die Validierung lehnt ungültige Namen vor dem Speichern ab.

</Note>

Erstelle nach dem Hinzufügen oder Rotieren des Werts sowohl `backend-api` als auch `backend-worker` mit der aktualisierten Umgebung neu. Ein Compose-Neustart behält alte Werte. Leerraum am Anfang und Ende wird vor der Verwendung entfernt. Prüfe nach dem Ausrollen eine echte Anfrage.

## Broker-Geheimnisse aus der Umgebung

Zugangsdaten vom Typ **Abo-Broker** können das Broker-Geheimnis ebenfalls aus der Bereitstellungsumgebung lesen. Verwende im Feld **Secret aus Umgebungsvariable** das eigene Präfix `TALE_TOKEN_SOURCE_`. Andere Namen werden abgelehnt. Bleibt das Feld leer, wird das Geheimnis verschlüsselt mit den Zugangsdaten gespeichert. Erstelle die verwendenden Prozesse nach der Rotation eines Umgebungswerts neu.

## Organisationseinstellungen bei der Organisation verwalten

Namen von Zugangsdaten, erlaubte Modelle, Standards und Aktivierungszustand bleiben Organisationsdaten. Normalerweise verwaltest du sie unter [KI-Anbieter](/de/platform/admin/providers). Eine verwaltete Konfigurationsversion kann nach Prüfung von Organisation und Betreiber genaue umgebungsgebundene Zugangsdaten über native APIs anlegen. Sie installiert keinen Inferenzserver und belegt kein Modellverhalten. Prüfe nach der Bereitstellung den lokalen Endpunkt wie oben beschrieben.
