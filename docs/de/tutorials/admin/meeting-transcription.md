---
title: Meeting-Transkription
description: Meeting-Audio lokal mit Meetily aufzeichnen und über einen Tale-Agent zusammenfassen.
---

Tale unterstützt Audio-Transkription auf zwei Wegen, und dieses Integrationen-Tutorial läuft die **vollständig lokale** Variante durch. Brauchst du nur Ad-hoc-Aufnahmen zusammenzufassen, ist eine Audio- oder Video-Datei in den Chat zu ziehen der kürzeste Weg — die Transkriptions-Pipeline der Plattform erledigt das serverseitig, dokumentiert unter [Chat-Anhänge](/de/platform/chat/attachments#audio-and-video-transcription). Für einen vollen Meeting-Capture-Workflow, in dem das rohe Audio nie den Laptop des Vortragenden verlässt, koppele Tale mit [Meetily](https://github.com/Zackriya-Solutions/meetily) — einem MIT-lizenzierten, vollständig lokalen Meeting-Recorder, der mit Whisper.cpp auf dem Gerät transkribiert und nur das Transkript an ein LLM zur Zusammenfassung sendet.

Das Ergebnis am Ende ist ein Meeting-Ablauf, bei dem Audio-Bytes die Endgerätegrenze nie überschreiten, die resultierende Zusammenfassung aber als normaler Tale-Konversationsthread mit vollem Audit- und Aufbewahrungs-Schutz landet.

## Bevor du beginnst

Du brauchst Admin- oder Inhaber-Zugriff in Tale sowie eine Tale-Instanz, die per HTTPS vom aufnehmenden Laptop erreichbar ist. Du brauchst außerdem mindestens einen [Agent](/de/platform/agents/create), der für die Zusammenfassung getunt ist; der Systemprompt in Schritt 1 ist ein Ausgangspunkt zum Einfügen. Auf dem aufnehmenden Laptop brauchst du Meetily installiert — siehe das [neueste Release](https://github.com/Zackriya-Solutions/meetily/releases) des Projekts, das Builds für macOS und Windows ausliefert.

Kein Tale-seitiges Feature-Flag, keine Pro-Nutzer-Berechtigung über Admin hinaus.

## Schritt 1 — Einen Zusammenfassungs-Agent konfigurieren

Ein dedizierter Agent gibt Zusammenfassungen das Modell, den Ton und die Struktur, die du willst, und hält die Meeting-Threads aus der Historie des allgemeinen Chat-Agents heraus. Öffne **Agents > Agent erstellen** und füge den Prompt unten als Systemanweisungen ein:

```text
Du bist der Meeting-Summary-Agent.

Eingabe: ein rohes Transkript eines Meetings, möglicherweise mit unsauberen Sprecher-Labels.
Ausgabe, in Markdown:
1. Eine Zusammenfassung in einem Absatz.
2. Entscheidungen — Stichpunktliste, jeweils mit verantwortlicher Person.
3. Aktionspunkte — Stichpunktliste im Format „Verantwortlicher — Aufgabe — Fälligkeitsdatum (falls genannt)".
4. Offene Fragen — Stichpunktliste der angesprochenen, aber nicht geklärten Punkte.

Regeln:
- Erfinde keine Inhalte. Ist etwas unklar, sag das.
- Erhalte die Sprache des Transkripts.
- Verwende niemals wörtliche Zitate länger als einen Satz.
```

Wähle ein leistungsfähiges Modell — Qualität zählt mehr als Kosten bei einem Einmal-pro-Meeting-Aufruf. Die restliche Konfiguration des Agents folgt [Einen Agent erstellen](/de/platform/agents/create).

Der Schritt hat funktioniert, wenn die Chat-Vorschau des Agents die Vier-Abschnitts-Struktur auf einem kurzen Test-Transkript erzeugt, das du in den Composer einfügst.

## Schritt 2 — Einen Webhook für den Agent erstellen

Öffne den **Webhook**-Tab des Agents und klicke **Erstellen**. Tale generiert eine URL der Form `https://<deine-tale-instanz>/api/agents/wh/<TOKEN>` — das Token besteht aus 64 Hex-Zeichen und ist die einzige Anmeldeberechtigung. Wer die URL hält, kann diesen Agent aufrufen; behandle sie wie einen API-Schlüssel, und deaktiviere oder lösche den Webhook, um den Zugriff zu widerrufen.

Meetily spricht OpenAI-kompatible Chat-Completions, also nutze beim Konfigurieren in Schritt 4 den `/chat/completions`-Subpfad:

```text
https://<deine-tale-instanz>/api/agents/wh/<TOKEN>/chat/completions
```

Der Schritt hat funktioniert, wenn der Webhook-Tab die URL mit Kopier-Knopf und einem aktiven „Aktiv"-Toggle zeigt.

## Schritt 3 — Meetily installieren

Lade Meetily aus der Releases-Seite des Projekts herunter und installiere es. Die Projekt-Docs unter [meetily.ai](https://meetily.ai) und die [GitHub-README](https://github.com/Zackriya-Solutions/meetily) decken die Pro-OS-Installation ab, einschließlich der Erstlauf-Berechtigungen für Systemaudio. Nimm einen kurzen Testclip auf — fünfzehn Sekunden Lesen eines beliebigen Absatzes — und bestätige, dass das Live-Transkript im Seitenbereich erscheint.

Der Schritt hat funktioniert, wenn das Testtranskript zu dem passt, was du gesagt hast — das bestätigt, dass Whisper lokal auf dem Laptop läuft.

## Schritt 4 — Meetily auf den Tale-Webhook zeigen

Öffne in Meetilys Einstellungen das LLM-Anbieter-Panel (das genaue Label variiert je Release — aktuelle Builds verwenden **Settings > Models** oder **Settings > LLM provider**). Wähle die Option **Custom OpenAI-compatible** und konfiguriere:

| Feld          | Wert                                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Basis-URL     | Die `/chat/completions`-URL aus Schritt 2 — z. B. `https://<deine-tale-instanz>/api/agents/wh/<TOKEN>/chat/completions`          |
| API-Schlüssel | Beliebiger nicht-leerer Wert — das URL-Token ist die Anmeldeberechtigung                                                         |
| Modell        | Eine Modell-ID aus den `supportedModels` des Agents (z. B. `openai/gpt-4o`); nicht erkannte Werte fallen auf den Standard zurück |

Speichern. Meetily sendet Zusammenfassungen jetzt durch den konfigurierten Tale-Agent.

Der Schritt hat funktioniert, wenn Meetilys Einstellungs-UI den gespeicherten Anbieter zeigt und „Test" (falls vorhanden) eine 200-Antwort liefert.

## Schritt 5 — Ein Meeting aufzeichnen und zusammenfassen

Klicke **Start recording** oben im nächsten Meeting. Meetily transkribiert lokal — CPU oder GPU des Laptops erledigt die Arbeit, und während des Meetings wird nichts hochgeladen. Wenn das Meeting endet, stoppe die Aufzeichnung und klicke **Generate summary**. Das Transkript wird per POST an Tale gesendet, der Agent läuft, und die strukturierte Zusammenfassung erscheint in Meetily neben dem Transkript.

In Tale wird die Anfrage zu einem echten Konversationsthread unter dem Zusammenfassungs-Agent — sichtbar in der Historie des Agents, gegen die Nutzungs-Buchhaltung der Organisation gezählt, im Audit-Log markiert und durch die Team- und Wissens-Regeln des Agents gesteuert.

Der Schritt hat funktioniert, wenn sowohl Meetily die Zusammenfassung zeigt als auch die Konversationshistorie des Agents einen neuen Thread mit demselben Inhalt zeigt.

## Vertrauensgrenze

Was in jeder Richtung über das Netz geht:

- **Audio**: verlässt nie den aufnehmenden Laptop. Whisper.cpp läuft lokal; zu keinem Punkt des Ablaufs wird die rohe Aufnahme hochgeladen.
- **Transkript**: geht vom Laptop über HTTPS zu deiner Tale-Instanz, unter deinem Reverse-Proxy und der bestehenden Auth. Es geht nicht zu einem Dritten — Meetily spricht direkt mit Tale.
- **Tales ausgehender Modell-Aufruf**: von Tale zu welchem Anbieter auch immer das Modell des Agents serviert. Um auch diese Strecke im Netz zu halten, kombiniere dieses Tutorial mit [Lokalen Anbieter verbinden](/de/tutorials/admin/connect-local-provider) — das Zusammenfassungs-LLM bleibt dann ebenfalls lokal.
- **Client-Systemprompt**: jede `system`-Nachricht, die Meetily sendet, wird hinter den eigenen Systemprompt des Agents gehängt. Der Prompt des Agents rahmt Identität und Output-Form; Meetilys Prompt fügt Use-Case-Details hinzu.

Aufbewahrung folgt Tales Standardregeln — der Zusammenfassungs-Thread läuft auf der Frist ab, die deine Org-Aufbewahrungsrichtlinie setzt, und der Zugriff ist durch den [Wissen-Tab des Agents](/de/platform/agents/create#knowledge-tab) und [Team-Regeln](/de/platform/admin/teams) eingegrenzt.

## Fehlerbehebung

- **Kontextfenster-Fehler bei langen Meetings** — das Transkript überschreitet das Input-Limit des Modells. Wechsle den Agent auf ein Modell mit grösserem Kontext oder zerteile das Transkript in Meetilys Summary-Einstellungen vor. Siehe [Agent-Konzepte — Modell](/de/platform/agents/concepts#model).
- **Meetily lief in den Timeout** — Meetilys clientseitiger Timeout sind 300 Sekunden, und ein langes Transkript auf einem langsamen Anbieter kann ihn überschreiten. Wechsle auf ein schnelleres Modell, kürze das Transkript oder versuche es erneut; der Thread in Tale hält die volle Zusammenfassung weiterhin, auch wenn Meetily aufgegeben hat.
- **Zusammenfassungen landen in der falschen Sprache** — das Transkript war sprachgemischt, oder der Prompt hat die Ausgabesprache nicht festgelegt. Straffe den „Regeln"-Abschnitt der Agent-Anweisungen.
- **401 Unauthorized** — das Webhook-Token ist ungültig oder der Webhook ist deaktiviert. Prüfe den **Webhook**-Tab des Agents, schalte Aktiv ein oder generiere neu.

## Wo das einsetzt

Was du gebaut hast, ist eine datenschutzfreundliche Meeting-Aufnahme: rohes Audio bleibt auf dem Laptop, nur das Transkript geht übers Netz, und Tale behandelt die Zusammenfassung als normale Agent-Konversation — auditierbar, aufbewahrungs-gebunden, wissens-gescopt. Der Kompromiss gegenüber dem serverseitigen Transkriptions-Pfad ist eine Sache der Vertrauensgrenze: Meetily schiebt die Audio-Handhabung unter deine Endgeräte-Policy, zu den Kosten einer zusätzlichen Desktop-Abhängigkeit.

Zwei Richtungen von hier: führe Transkripte durch eine Automatisierung statt eines einzelnen Agent-Aufrufs mit [Eine Automatisierung per Webhook auslösen](/de/tutorials/developer/trigger-automation-via-webhook), oder schließe die Schleife auf der Modellseite mit [Lokalen Anbieter verbinden](/de/tutorials/admin/connect-local-provider), sodass auch das Zusammenfassungs-LLM im Netz bleibt.
