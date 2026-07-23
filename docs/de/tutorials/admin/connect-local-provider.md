---
title: Einen lokalen LLM-Anbieter anbinden
description: Deklariere einen lokalen Ollama-, LM-Studio- oder vLLM-Server als eigenen Provider-Connector auf einer selbst gehosteten Tale-Instanz, hinterleg seine Zugangsdaten und verifiziere, dass ein Chat ihn erreicht, ohne dein Netzwerk zu verlassen.
---

Ein lokaler Anbieter ist der Weg, Modelle im eigenen Perimeter laufen zu lassen — keine ausgehenden API-Aufrufe, keine Rechnung pro Token, kein Transkript bei Dritten. Dieser Durchlauf bringt eine selbst gehostete Tale-Instanz von „ich habe einen Ollama-, LM-Studio- oder vLLM-Endpunkt“ zu „ein Chat in der Organisation ruft ein lokales Modell auf und die Antwort streamt zurück“. Der Durchlauf ist für Admins einer selbst gehosteten Installation; Cloud-Organisationen greifen nicht in dein Netzwerk und überspringen diese Seite.

Du brauchst die Admin-Rolle in Tale, einen lokalen Inferenz-Server, den der `tale-platform`-Container über TLS erreicht, und ein bereits geladenes Modell auf diesem Server. Das Connector-Format und das Zugangsdaten-Modell stehen in [Anbieter](/de/self-hosted/configuration/providers); diese Seite geht einen vollständigen Weg ab und verifiziert das Ergebnis.

## Bevor du beginnst

Prüf vier Dinge. Deine Rolle ist Admin oder Inhaber — **Einstellungen > KI-Anbieter** ist darunter ausgeblendet. Dein lokaler Inferenz-Server beantwortet `GET /v1/models` (oder das Ollama-Pendant `GET /api/tags`) aus dem Tale-Docker-Netz heraus. Mindestens ein Modell ist geladen — Ollama-Nutzer haben `ollama pull llama3.1:8b` oder Ähnliches laufen lassen, LM-Studio-Nutzer haben im Server-Tab ein Modell geladen, vLLM-Nutzer haben den Server mit `--model` auf einen Checkpoint gestartet. Und der Server ist über `https://` erreichbar: Die Base-URL eines Connectors muss eine HTTPS-URL sein, also terminiere TLS vor dem Inferenz-Server — ein Reverse-Proxy mit internem Zertifikat ist die übliche Antwort — statt ihn im Klartext freizulegen.

## Schritt 1 — Den Inferenz-Server aus Tale erreichbar machen

Der erste Zug ist die Bestätigung, dass `tale-platform` den Inferenz-Server per Hostname über TLS erreicht. Ohne das quittiert jeder Modellaufruf einen Verbindungsfehler und kein Modell ist aufrufbar.

Läuft der Inferenz-Server hinter einem Proxy im selben Docker-Netz, ist der erreichbare Hostname der Service-Name dieses Proxys. Setz ein einmaliges curl aus dem `tale-platform`-Container ab, bevor du irgendeine Konfiguration schreibst:

```bash
docker compose exec platform curl -sf https://ollama.internal/api/tags
```

Eine JSON-Liste geladener Modelle ist das Erfolgssignal. Ein Verbindungsfehler heißt: falscher Hostname, nicht vertrauenswürdiges Zertifikat, oder der Inferenz-Server lauscht nicht auf der Schnittstelle, die der Container erreicht.

## Schritt 2 — Den Connector deklarieren

Die mitgelieferten Connectors decken die öffentlichen Anbieter ab; eine Maschine in deinem eigenen Netz ist ein selbst definierter Connector — eine YAML-Datei im Config-Baum der Organisation. Die Datei sagt Tale, wohin Anfragen gehen, welchen Wire-Dialekt der Endpunkt spricht und woher seine Modellliste kommt.

Schreib `$TALE_CONFIG_DIR/<orgSlug>/providers/local-ollama.yml`. Der `name` muss dem Dateinamen-Stamm entsprechen und darf mit keinem mitgelieferten Connector kollidieren:

```yaml
name: local-ollama
displayName: Local Ollama
apiFormat: openai
baseUrl: https://ollama.internal/v1
catalog:
  source: models-endpoint
auth:
  - method: api-key
  - method: env
```

`apiFormat: openai` passt für Ollama, LM Studio und vLLM — alle drei sprechen die OpenAI-Chat-Completions-Form. `catalog.source: models-endpoint` weist Tale an, Modelle über `GET {baseUrl}/models` zu listen statt eine statische Liste mitzubringen; genau das willst du, wenn sich die geladenen Modelle ändern. Eine Datei, die nicht validiert, wird übersprungen und der Grund geloggt — lies also das Plattform-Log, wenn der Connector nicht auftaucht.

## Schritt 3 — Die Zugangsdaten hinterlegen

Ein Connector allein ruft nichts auf. Was eine Anfrage autorisiert, sind Zugangsdaten an diesem Connector, und ein Connector hält so viele, wie du brauchst.

Öffne **Einstellungen > KI-Anbieter**. Der neue Connector steht neben den mitgelieferten; klicke dort auf **Zugangsdaten hinzufügen**. Wähl **API-Schlüssel** und füg das Token ein, das dein Server erwartet — LM Studio ignoriert den Wert, vLLM will das Token, das du an `--api-key` übergeben hast. Benenne den Eintrag nach der Maschine, die er erreicht (`GPU-Kiste, Rack 2`), und lass die **Modell-Allowlist** leer, um alles freizugeben, was der Server listet, oder wähl die Teilmenge, die die Organisation aufrufen darf. Der erste Eintrag an einem Connector wird sein Standard.

Soll der Schlüssel lieber auf dem Deployment liegen? Wähl **Umgebungsvariable** und benenne eine Deployment-Variable unter dem reservierten Präfix `TALE_PROVIDER_KEY_`. Das Geheimnis landet dann nie in Tales eigenem Speicher, und dein Betriebsteam besitzt die Rotation.

## Schritt 4 — Mit einem Chat verifizieren

Der Beweis, dass die Verdrahtung sitzt, ist eine gestreamte Chat-Antwort vom lokalen Server. Ohne diesen Schritt weißt du nur, dass die Konfiguration parst.

Öffne einen neuen Chat, öffne die Modell-Auswahl und wähl eines der lokalen Modelle namentlich — ein Modell wird immer explizit gewählt, es gibt also keine Routing-Schicht auszuschließen. Sende einen kurzen Prompt (`Antworte nur mit dem Wort "bereit"`). Die Antwort streamt binnen Sekunden herein.

Verfolg dabei das Log des Inferenz-Servers auf dem Host — Ollama loggt die Request-Zeile, LM Studio druckt eine Request-Zusammenfassung, vLLM die Generierungslatenz. Die Anfrage auf dem lokalen Server auflaufen zu sehen ist die Verifikation, dass der Verkehr in deinem Netz bleibt statt über eine externe API zu springen.

## Troubleshooting

- **Symptom:** Der Connector taucht unter **Einstellungen > KI-Anbieter** nie auf. **Ursache:** Das YAML validiert nicht, oder sein `name` entspricht nicht dem Dateinamen-Stamm. **Behebung:** Lies das Plattform-Log — ein abgelehnter Connector wird mit Datei und Grund geloggt — und korrigier die Datei.
- **Symptom:** Der Connector erscheint, seine Modellliste bleibt leer. **Ursache:** Der Inferenz-Server ist erreichbar, hat aber kein Modell geladen, oder sein `/models`-Endpunkt hat einen Fehler geantwortet. **Behebung:** Lad ein Modell und klicke dann auf der Anbieter-Seite auf **Kataloge aktualisieren**. Kataloge aktualisieren sich nur, wenn du sie aktualisierst.
- **Symptom:** Die Datei wird abgelehnt, weil die Base-URL kein HTTPS ist oder auf `localhost`, `127.0.0.1` oder eine private IP zeigt. **Ursache:** Connector-Base-URLs sind HTTPS-only, und die Host-Policy blockt Loopback- und private Adressen. **Behebung:** Stell einen TLS-terminierenden Reverse-Proxy vor den Inferenz-Server und nimm dessen internen Hostnamen.
- **Symptom:** Die Chat-Antwort ist ein Fehler, der das Modell nennt. **Ursache:** Die Modell-ID passt nicht zur Upstream-ID. **Behebung:** Wähl in der Modell-Auswahl neu — Ollama-Tags wie `:latest` zählen upstream und müssen exakt stimmen.

## Wo das hingehört

Ein lokaler Anbieter ist die Naht zwischen Tale und deinen eigenen GPUs — dieselbe Connector-und-Zugangsdaten-Form wie bei einem öffentlichen Anbieter, aber kein Verkehr verlässt dein Netz. Die natürlichen nächsten Lektüren sind [Anbieter](/de/self-hosted/configuration/providers) für das Connector-Format in voller Länge und den Weg über Umgebungsvariablen, und [Härtung](/de/self-hosted/operate/security/hardening) für die Egress-Garantien, die einen Agent davon abhalten, ein Cloud-Modell zu erreichen, das du nicht vorgesehen hast.
