---
title: Meeting-Transkription
description: Meeting-Audio lokal mit Meetily aufzeichnen und über einen Tale-Agent zusammenfassen.
---

Tale unterstützt Audio-Transkription auf zwei Wegen, und dieses Tutorial beschreibt den **vollständig lokalen** Weg. Wenn du nur gelegentliche Aufnahmen zusammenfassen willst, ist der einfachere Pfad eine Audio- oder Video-Datei in den Chat zu ziehen — die serverseitige Transkriptions-Pipeline der Plattform übernimmt das (siehe [Chat-Anhänge](/de/platform/chat/attachments#audio-und-video-transkription)). Für einen vollständigen Meeting-Capture-Workflow, bei dem die Roh-Audiodaten das Laptop der vortragenden Person nie verlassen, koppelst du Tale mit einem lokalen Tool, das den Audio-Pfad übernimmt. [Meetily](https://github.com/Zackriya-Solutions/meetily) ist ein MIT-lizenzierter, 100 % lokaler Meeting-Recorder, der mit Whisper.cpp auf dem Gerät transkribiert und nur das Transkript an ein LLM zum Zusammenfassen schickt.

Diese Trennung ist wichtig: Roh-Audio verlässt das Gerät nicht, Whisper läuft auf dem Laptop der vortragenden Person, und Tale sieht immer nur Text. Deine bestehenden Row-Level-Security-, Audit- und Governance-Regeln decken den kompletten sensiblen Pfad ab, weil alles, was Tale erreicht, bereits ein echter Agent-Konversations-Thread ist.

Wähle den serverseitigen Pfad, wenn Komfort zählt und du deinem konfigurierten Transkriptions-Anbieter das Audio anvertraust; wähle diesen Meetily-Pfad, wenn Compliance oder Netzwerkrichtlinien verlangen, dass Audio-Bytes die Gerätegrenze nie überschreiten.

## Was du baust

Einen Meeting-Flow, in dem Meetily Audio lokal aufzeichnet und transkribiert und dann das Transkript an einen Tale-Agent übergibt, der eine strukturierte Zusammenfassung liefert — Teilnehmende, Entscheidungen, To-dos — abgelegt als normaler Konversations-Thread unter diesem Agent.

## Voraussetzungen

- Eine Tale-Instanz, über HTTPS erreichbar, mit Admin-Zugriff und mindestens einem [Agent](/de/platform/agents/create), der zum Zusammenfassen taugt. Der Systemprompt aus Schritt 1 unten ist ein guter Startpunkt.
- Meetily auf der Workstation installiert, die das Meeting aufnimmt — siehe das [aktuelle Release](https://github.com/Zackriya-Solutions/meetily/releases) des Projekts. macOS und Windows sind unterstützt.

## Schritt 1 — Einen Zusammenfassungs-Agent konfigurieren

Lege einen eigenen Agent an, damit Zusammenfassungen dein gewünschtes Modell, deinen Ton und dein Format nutzen. Ein Start-Systemprompt:

```text
Du bist der Meeting-Zusammenfassungs-Agent.

Input: ein Rohtranskript eines Meetings, eventuell mit unsauberen Sprecher-Labels.
Output in Markdown:
1. Ein Absatz Zusammenfassung.
2. Entscheidungen — Bullet-Liste, jeweils mit verantwortlicher Person.
3. To-dos — Bullet-Liste im Format „Owner — Aufgabe — Fälligkeit (falls genannt)“.
4. Offene Fragen — Bullet-Liste mit Punkten, die aufkamen, aber nicht geklärt wurden.

Regeln:
- Nichts erfinden. Bei Unklarheit ausdrücklich sagen.
- Sprache des Transkripts beibehalten.
- Nie Roh-Zitate länger als einen Satz.
```

Wähle ein leistungsfähiges Modell — Qualität zählt mehr als Kosten bei einem einmaligen Call pro Meeting. Siehe [Agent erstellen](/de/platform/agents/create) für den Rest der Konfiguration.

## Schritt 2 — Webhook für den Agent anlegen

Öffne den **Webhook**-Tab des Agents und klicke **Erstellen**. Tale erzeugt eine URL im Format `https://<deine-tale-instanz>/api/agents/wh/<TOKEN>`. Kopiere sie — in Schritt 4 trägst du sie in Meetily ein.

Behandle die Webhook-URL wie einen API-Schlüssel: Wer sie hat, kann diesen Agent aufrufen. Webhook deaktivieren oder löschen entzieht den Zugriff.

## Schritt 3 — Meetily installieren

Lade Meetily von der Release-Seite des Projekts herunter und installiere es; die Projekt-Docs unter [meetily.ai](https://meetily.ai) und das [GitHub-README](https://github.com/Zackriya-Solutions/meetily) decken die OS-spezifischen Schritte ab, einschliesslich der Erstfreigabe für System-Audio. Stelle sicher, dass du ein kurzes Testclip aufnehmen kannst und ein Transkript erscheint, bevor du weitermachst — das bestätigt, dass Whisper lokal läuft.

## Schritt 4 — Meetily auf den Tale-Webhook zeigen lassen

Wähle in Meetilys `Settings > LLM provider` (Label variiert je Version) **Custom OpenAI-compatible** und setze:

| Feld     | Wert                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL | Die Webhook-URL aus Schritt 2 (z. B. `https://<tale>/api/agents/wh/<TOKEN>`)                                                          |
| API key  | Ein beliebiger, nicht-leerer Wert — das Credential ist der Token in der URL                                                           |
| Model    | Eine Modell-ID aus `supportedModels` des Agents (z. B. `openai/gpt-4o`). Unbekannte Werte fallen still zurück auf das Standardmodell. |

Speichern. Meetily hängt `/chat/completions` automatisch an die Base URL an; jede erzeugte Zusammenfassung fliesst jetzt durch den konfigurierten Tale-Agent.

## Schritt 5 — Ein Meeting aufnehmen und zusammenfassen

Klicke beim nächsten Meeting oben **Start recording**. Meetily zeigt live Transkription in einem Seitenbereich — Audio wird auf der CPU/GPU des Laptops transkribiert, nichts wird hochgeladen. Am Ende des Meetings klicke **Stop** und dann **Generate summary**. Das Transkript wird an Tale gepostet, der Agent läuft, und die Zusammenfassung erscheint neben dem Transkript in Meetily.

In Tale wird die Anfrage zu einem echten Konversations-Thread unter dem Zusammenfassungs-Agent — sichtbar in der Konversationshistorie des Agents, im Usage-Ledger der Org gezählt, im Audit-Log markiert und nach den Team- und Wissens-Regeln des Agents regiert.

## Datenschutz-Hinweise

- **Audio verlässt das Gerät nicht.** Whisper.cpp läuft lokal.
- **Das Transkript verlässt das Gerät** — zu deiner Tale-Instanz, per HTTPS, hinter deinem Reverse-Proxy und deiner Auth. Kein Dritter sieht es.
- **Retention** folgt Tales Regeln. Liegt deine Org-Retention bei sieben Tagen, läuft der Zusammenfassungs-Thread auf diesem Zeitplan ab; siehe [Richtlinien](/de/platform/admin/governance).
- **Zugriff** auf die Zusammenfassung wird über den [Tab Wissen](/de/platform/agents/create#tab-wissen) des Agents und die [Team](/de/platform/admin/teams)-Regeln beschnitten — Standard-Agent-RLS.
- **Client-Systemprompt.** Jede `system`-Nachricht, die Meetily schickt, wird hinter den eigenen Systemprompt des Agents gehängt — Agent-Regeln rahmen Identität und Ausgabeformat, Meetilys Prompt liefert Use-Case-Details.

## Troubleshooting

- **Kontextfenster-Fehler bei langen Meetings** — das Transkript übersteigt das Eingabelimit des Modells. Wechsle im Agent zu einem Modell mit grösserem Kontext oder chunke das Transkript in Meetilys Summary-Einstellungen vorab. Siehe [Agent-Konzepte — Modell](/de/platform/agents/concepts#modell).
- **Meetily hat ein Timeout** — der client-seitige Timeout von Meetily liegt bei 300 Sekunden. Bei langsamen Providern kann ein langes Transkript das überschreiten. Optionen: schnelleres Modell wählen, Transkript kürzen, oder nach Fertigstellung der Generierung erneut probieren (der Thread in Tale enthält weiterhin die vollständige Zusammenfassung).
- **Zusammenfassungen in falscher Sprache** — entweder war das Transkript sprachlich gemischt, oder der Systemprompt pinnt die Ausgabesprache nicht. Zieh die Regel-Sektion des Prompts an.
- **Leere oder abgelehnte Zusammenfassung** — den Konversations-Thread des Agents in Tale prüfen; die vollständige Modell-Antwort (inklusive Ablehnungs- oder Governance-Meldungen) steht dort.
- **401 Unauthorized** — die Webhook-URL ist ungültig oder der Webhook ist deaktiviert. Prüfe Einstellungen > Agent > **Webhook**-Tab; aktiv schalten oder löschen und neu erstellen.

## Wo das hingehört

Was du gebaut hast, ist eine datenschutzfreundliche Meeting-Aufnahme: Rohaudio bleibt auf dem Laptop, nur das Transkript überquert das Netzwerk, und Tale behandelt die Zusammenfassung als normale Agent-Konversation — auditierbar, retentionsgebunden, wissens-eingegrenzt. Der Trade-off zur serverseitigen Transkription ist eine Frage der Vertrauensgrenze: Meetily verschiebt die Audio-Verarbeitung unter deine Endpunkt-Policy, zum Preis einer zusätzlichen Desktop-Abhängigkeit. Wenn deine Compliance-Lage serverseitige Transkription erlaubt, ist der einfachere Weg, die Aufnahme direkt in den Chat zu ziehen.

Zwei Richtungen, denselben Fluss weiterzuziehen: dasselbe Transkript per [Eine Automatisierung per Webhook auslösen](/de/tutorials/developer/trigger-automation-via-webhook) durch einen Workflow statt einen einzelnen Agent-Call schicken, oder das Modell selbst on-device packen mit [Lokalen Anbieter verbinden](/de/tutorials/admin/connect-local-provider), damit auch die Zusammenfassung das Netzwerk nicht verlässt.
