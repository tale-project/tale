---
title: Einen lokalen LLM-Anbieter anbinden
description: Häng einen lokalen Ollama-, LM-Studio- oder vLLM-Server an eine selbst gehostete Tale-Instanz, allowliste seine Modelle und verifiziere, dass Agenten ihn erreichen, ohne das Host-Netzwerk zu verlassen.
---

Ein lokaler Anbieter ist der Weg zu Modellen, die innerhalb deines Perimeters laufen — keine ausgehenden API-Calls, keine Rechnung pro Token, kein Transkript bei Dritten. Dieser Walk bringt eine selbst gehostete Tale-Instanz von „Ich habe einen Ollama-, LM-Studio- oder vLLM-Endpunkt" zu „Ein Agent in der Org ruft ein lokales Modell und die Antwort streamt zurück." Der Walk richtet sich an einen Admin auf einem selbst gehosteten Install; Cloud-Orgs greifen nicht in dein Netzwerk und überspringen diese Seite.

Du brauchst die Admin-Rolle in Tale, einen lokalen Inferenz-Server, der vom `tale-platform`-Container erreichbar ist, und ein Modell, das auf diesem Server bereits gezogen oder geladen ist. Die zugrundeliegende Anbieter-Mechanik ist dokumentiert in [Anbieter](/de/self-hosted/configuration/providers); diese Seite walkt den UI-Pfad und verifiziert das Ergebnis End-to-End.

## Bevor du beginnst

Bestätige vier Dinge. Deine Rolle ist Admin oder Inhaber — das **Anbieter**-Panel ist darunter versteckt. Dein lokaler Inferenz-Server läuft und beantwortet `GET /v1/models` (oder das Ollama-Äquivalent `GET /api/tags`) von innerhalb des Tale-Docker-Netzwerks. Mindestens ein Modell ist geladen — Ollama-Nutzer haben `ollama pull llama3.1:8b` oder ähnlich gelaufen, LM-Studio-Nutzer haben ein Modell im Server-Tab geladen, vLLM-Nutzer haben den Server mit `--model` auf ein Checkpoint gestartet. Und der Netzwerkpfad von `tale-platform` zum Inferenz-Host ist auf dem Inferenz-Port offen (typisch `11434` für Ollama, `1234` für LM Studio, `8000` für vLLM).

## Schritt 1 — Den Inferenz-Server aus Tale erreichbar machen

Der erste Zug ist zu bestätigen, dass `tale-platform` den Inferenz-Server per Hostnamen erreicht. Ohne das bringt jeder Modell-Call einen Connection-Error und der Picker zeigt den Anbieter als **error**.

Läuft der Inferenz-Server auf demselben Docker-Host, hängt der erreichbare Hostname davon ab, wo der Server selbst läuft. Ein Ollama-Container im selben Compose-Netzwerk ist `http://ollama:11434`. Ein LM-Studio- oder vLLM-Server, der auf dem Host läuft (außerhalb Compose), ist `http://host.docker.internal:1234` auf macOS und Windows, oder die Bridge-IP des Hosts unter Linux. Lauf einen einmaligen curl aus dem `tale-platform`-Container, um vor dem Öffnen der UI zu verifizieren:

```bash
docker compose exec platform curl -sf http://ollama:11434/api/tags
```

Eine JSON-Liste gezogener Modelle ist das Erfolgs-Signal. Ein Connection-refused-Error heißt, der Hostname ist falsch oder der Inferenz-Server lauscht nicht auf dem Interface, das der Container erreicht.

## Schritt 2 — Den Anbieter in Tale registrieren

Ein erreichbarer Server tut nichts, bis Tale die URL und die Protokoll-Form kennt, die er spricht. Der Anbieter-Eintrag sagt Tale, wohin Anfragen zu schicken sind und welchen OpenAI-kompatiblen Dialekt zu verwenden.

Öffne **Einstellungen > Anbieter** und klick **Anbieter hinzufügen**. Wähl den Anbietertyp, der zu deinem Server passt: **Ollama** für einen Ollama-Server, oder **OpenAI-kompatibel** für LM Studio und vLLM (beide bringen die OpenAI-`/v1`-Form hoch). Füll die **Base-URL** mit dem Wert, den du in Schritt 1 verifiziert hast; lass das API-Key-Feld für Ollama leer, setz es auf einen beliebigen String für LM Studio (der Server ignoriert ihn), setz es auf deinen konfigurierten Token für vLLM, wenn du den Server mit `--api-key` gestartet hast.

Klick **Speichern**. Tale ruft sofort den Modell-Listen-Endpunkt des Anbieters; die Zeile wird grün und der Modell-Picker füllt sich mit dem, was der Server meldet.

## Schritt 3 — Die Modelle allowlisten, die aufrufbar sein sollen

Ein registrierter Anbieter ohne allowlistete Modelle ist für jeden Agent unsichtbar. Die Allowlist ist der Vertrag zwischen Org und Anbieter — das Modell zu wählen ist das Tor.

In der Anbieter-Zeile öffnest du den Modell-Picker. Jedes Modell aus der Upstream-Liste zeigt eine Checkbox plus das Tag, das Tale abgeleitet hat (`chat`, `embedding`, `vision`). Hak die Modelle ab, die Agenten aufrufen sollen; ein chat-getaggtes Modell ist das, woran ein Agent standardmäßig gebunden ist. Klick **Allowlist speichern**.

Soll das lokale Modell der org-weite Default für neue Chats sein, scroll oben in die Anbieter-Liste und wähl es unter **Standardmodell**. Bestehende Agenten behalten ihre vorherige Bindung; neue landen mit der nächsten Anfrage auf dem lokalen Modell.

## Schritt 4 — Mit einem Agent-Chat verifizieren

Der Beweis, dass die Verdrahtung funktioniert, ist eine Chat-Antwort, die vom lokalen Server streamt. Ohne diesen Schritt weißt du nicht, ob der Modell-Picker bloß richtig _aussieht_.

Öffne oder erstelle einen Agent, setz sein Modell auf eines der lokalen Modelle, die du allowlistet hast, und starte einen Chat mit einem kurzen Prompt (`Antworte mit dem einzelnen Wort "bereit"`). Die Antwort streamt innerhalb weniger Sekunden in Tokens herein; die Tool-Call-Karte des Chats zeigt den Modellnamen und den Anbieter, den du registriert hast.

Tail das Inferenz-Server-Log auf dem Host, während du den Prompt schickst — Ollama loggt die Anfrage-Zeile, LM Studio druckt eine Anfrage-Zusammenfassung, vLLM druckt die Generation-Latenz. Die Anfrage am lokalen Server zu sehen ist die Verifikation, dass der Traffic in deinem Netzwerk bleibt und nicht durch eine externe API springt.

## Troubleshooting

- **Symptom:** Anbieter-Zeile zeigt **error** mit `connection refused`. **Ursache:** Die Base-URL ist vom `tale-platform`-Container nicht erreichbar. **Fix:** Wiederhole den `docker compose exec platform curl` aus Schritt 1; pass den Hostnamen an (oft `host.docker.internal` auf macOS/Windows, die Bridge-IP unter Linux).
- **Symptom:** Der Modell-Picker ist nach **Speichern** leer. **Ursache:** Der Inferenz-Server ist erreichbar, aber es sind keine Modelle geladen. **Fix:** Lauf `ollama pull <model>` oder lad ein Modell in LM Studio / vLLM, dann klick **Modelle aktualisieren** auf der Anbieter-Zeile.
- **Symptom:** Die Chat-Antwort ist ein Fehler-Toast (`model not found`). **Ursache:** Der Modellname, an den der Agent gebunden ist, stimmt nicht mit der Upstream-ID überein. **Fix:** Öffne das Modell-Dropdown des Agenten und wähl aus der Live-Liste neu — Ollama-Tags wie `:latest` zählen Upstream und müssen exakt passen.
- **Symptom:** Das Speichern des Anbieters wird abgelehnt, weil die Base-URL auf `localhost`, `127.0.0.1` oder eine private IP zeigt. **Ursache:** Tale blockiert private und Loopback-Anbieter-Hosts standardmässig als SSRF-Schutz. **Fix:** Nutz stattdessen den netzinternen Hostnamen (`http://ollama:11434`, `http://host.docker.internal:1234`); wenn du auf eine private oder Loopback-Adresse zeigen musst, setz `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1` am platform-Service.

## Wo das hingehört

Ein lokaler Anbieter ist die Naht zwischen Tale und deinen eigenen GPUs — dieselbe Allowlist-Mechanik wie bei einem Cloud-Anbieter, aber kein Traffic verlässt den Host. Die natürlichen nächsten Lesungen sind [Anbieter](/de/self-hosted/configuration/providers) für das Datei-Form-Äquivalent dessen, was du eben in der UI gemacht hast, und [Hardening](/de/self-hosted/operate/security/hardening) für die Egress-Allowlist-Garantien, die einen Agent davon abhalten, versehentlich auf ein Cloud-Modell zurückzufallen, wenn das lokale nicht erreichbar ist.
