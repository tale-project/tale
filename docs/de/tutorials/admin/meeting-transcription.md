---
title: Meeting-Transkription
description: Meeting-Audio lokal mit Meetily aufzeichnen und über einen Tale-Agent zusammenfassen.
---

Tale transkribiert Audio nicht serverseitig — das Diktat im Chat läuft komplett im Browser, und die Plattform hat keinen Whisper-Endpoint. Für einen vollständigen Meeting-Capture-Workflow (System-Audio aufnehmen, transkribieren, zusammenfassen, speichern) koppelst du Tale mit einem lokalen Tool, das den Audio-Pfad übernimmt. [Meetily](https://github.com/Zackriya-Solutions/meetily) ist ein MIT-lizenzierter, 100 % lokaler Meeting-Recorder, der mit Whisper.cpp auf dem Gerät transkribiert und nur das Transkript an ein LLM zum Zusammenfassen schickt.

Diese Trennung ist wichtig: Roh-Audio verlässt das Gerät nicht, Whisper läuft auf dem Laptop der vortragenden Person, und Tale sieht immer nur Text. Deine bestehenden Row-Level-Security-, Audit- und Governance-Regeln decken den kompletten sensiblen Pfad ab, weil alles, was Tale erreicht, bereits ein Konversations-Thread ist.

## Was du baust

Einen Meeting-Flow, in dem Meetily Audio lokal aufzeichnet und transkribiert und dann das Transkript an einen Tale-Agent übergibt, der eine strukturierte Zusammenfassung liefert — Teilnehmende, Entscheidungen, To-dos — abgelegt als normaler Konversations-Thread.

## Voraussetzungen

- Eine Tale-Instanz, über HTTPS erreichbar, mit Admin-Zugriff und mindestens einem [Agent](/de/platform/agents/create), der zum Zusammenfassen taugt. Der Systemprompt aus Schritt 1 unten ist ein guter Startpunkt.
- Meetily auf der Workstation installiert, die das Meeting aufnimmt — siehe das [aktuelle Release](https://github.com/Zackriya-Solutions/meetily/releases) des Projekts. macOS und Windows sind unterstützt.
- Ein Tale-API-Schlüssel (`tale_...`) aus **Einstellungen > API-Schlüssel**.

## Schritt 1 — Einen Zusammenfassungs-Agent konfigurieren

Lege einen eigenen Agent an, damit Zusammenfassungen dein gewünschtes Modell, deinen Ton und dein Format nutzen. Ein Start-Systemprompt:

```text
Du bist der Meeting-Zusammenfassungs-Agent.

Input: ein Rohtranskript eines Meetings, eventuell mit unsauberen Sprecher-Labels.
Output in Markdown:
1. Ein Absatz Zusammenfassung.
2. Entscheidungen — Bullet-Liste, jeweils mit verantwortlicher Person.
3. To-dos — Bullet-Liste im Format „Owner — Aufgabe — Fälligkeit (falls genannt)".
4. Offene Fragen — Bullet-Liste mit Punkten, die aufkamen, aber nicht geklärt wurden.

Regeln:
- Nichts erfinden. Bei Unklarheit ausdrücklich sagen.
- Sprache des Transkripts beibehalten.
- Nie Roh-Zitate länger als einen Satz.
```

Wähle die Modellvoreinstellung **Erweitert** — der Qualitätssprung zählt mehr als Kosten bei einem einmaligen Call pro Meeting. Siehe [Agent erstellen](/de/platform/agents/create) und [Agent-Konzepte](/de/platform/agents/concepts) für den Rest der Konfiguration.

## Schritt 2 — Meetily installieren

Lade Meetily von der Release-Seite des Projekts herunter und installiere es; die Projekt-Docs unter [meetily.ai](https://meetily.ai) und das [GitHub-README](https://github.com/Zackriya-Solutions/meetily) decken die OS-spezifischen Schritte ab, einschließlich der Erstfreigabe für System-Audio. Stelle sicher, dass du ein kurzes Testclip aufnehmen kannst und ein Transkript erscheint, bevor du weitermachst — das bestätigt, dass Whisper lokal läuft.

## Schritt 3 — Meetily auf Tale zeigen lassen

Wähle in Meetilys `Settings > LLM provider` (Label variiert je Version) **Custom OpenAI-compatible** und setze:

| Feld     | Wert                                                                               |
| -------- | ---------------------------------------------------------------------------------- |
| Base URL | `https://<deine-tale-instanz>/api/v1`                                              |
| API key  | Das `tale_...`-Token aus den Voraussetzungen                                       |
| Model    | Den Agent-Slug des Zusammenfassungs-Agents aus Schritt 1 — z. B. `meeting-summary` |

Speichern. Meetily nutzt jetzt den Tale-Agent für jede erzeugte Zusammenfassung.

## Schritt 4 — Ein Meeting aufnehmen und zusammenfassen

Klicke beim nächsten Meeting oben **Start recording**. Meetily zeigt live Transkription in einem Seitenbereich — Audio wird auf der CPU/GPU des Laptops transkribiert, nichts wird hochgeladen. Am Ende des Meetings klicke **Stop** und dann **Generate summary**. Das Transkript wird an Tale gepostet, der Agent läuft, und die Zusammenfassung erscheint neben dem Transkript in Meetily.

In Tale ist die Anfrage ein normaler Konversations-Thread unter dem Zusammenfassungs-Agent — sichtbar in der Konversationshistorie, nach deinen [Genehmigungen](/de/platform/workspace/approvals) und [Richtlinien](/de/platform/admin/governance) regiert und im Arbeitsbereich durchsuchbar.

## Datenschutz-Hinweise

- **Audio verlässt das Gerät nicht.** Whisper.cpp läuft lokal.
- **Das Transkript verlässt das Gerät** — zu deiner Tale-Instanz, per HTTPS, hinter deinem Reverse-Proxy und deiner Auth. Kein Dritter sieht es.
- **Retention** folgt Tales Regeln. Liegt deine Org-Retention bei sieben Tagen, läuft der Zusammenfassungs-Thread auf diesem Zeitplan ab; siehe [Richtlinien](/de/platform/admin/governance).
- **Zugriff** auf die Zusammenfassung wird über den [Tab Wissen](/de/platform/agents/create#tab-wissen) des Agents und die [Team](/de/platform/admin/teams)-Regeln beschnitten — Standard-Agent-RLS.

## Troubleshooting

- **Kontextfenster-Fehler bei langen Meetings** — das Transkript übersteigt das Eingabelimit des Modells. Optionen: die Modellvoreinstellung des Agents auf eine mit größerem Kontext wechseln oder das Transkript in den Summary-`Settings` von Meetily vorab chunken. Siehe [Agent-Konzepte — Modell](/de/platform/agents/concepts#modell).
- **Zusammenfassungen in falscher Sprache** — entweder war das Transkript sprachlich gemischt, oder der Systemprompt pinnt die Ausgabesprache nicht. Zieh die Regel-Sektion des Prompts an.
- **Leere Zusammenfassung** — das Transkript ist in Tale angekommen, aber der Agent hat abgelehnt. Den Konversations-Thread in der Tale-UI auf die tatsächliche Modell-Antwort prüfen; wurde der Agent durch [Richtlinien](/de/platform/admin/governance) gesperrt, steht der Grund dort.
- **401 Unauthorized** — API-Schlüssel widerrufen oder vertippt; in **Einstellungen > API-Schlüssel** neu erzeugen.

## Weiter

- Dasselbe Transkript durch einen Workflow statt einen einzelnen Agent-Call schicken: [Eine Automatisierung per Webhook auslösen](/de/tutorials/developer/trigger-automation-via-webhook).
- Den Zusammenfasser mit einem vollständig lokalen Modell-Backend betreiben: [Lokalen Anbieter verbinden](/de/tutorials/admin/connect-local-provider).
