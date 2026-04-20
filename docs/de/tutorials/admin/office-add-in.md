---
title: Word- & Excel-Add-in
description: Ein AI-Panel in Word und Excel über deine Tale-Instanz betreiben — mit Office Agents.
---

Microsoft Word und Excel haben keinen eingebauten Weg, einen eigenen LLM-Endpoint zu nutzen — die meisten Office-AI-Add-ins sind an die Cloud ihres Anbieters gebunden. [Office Agents](https://github.com/hewliyang/office-agents) ist ein MIT-lizenziertes Add-in, das ein AI-Chat-Panel in Word, Excel und PowerPoint einblendet und jeden OpenAI-kompatiblen Endpoint als Modell-Backend akzeptiert. Das macht es zum aktuell besten Fit für Tale: Nutzer arbeiten am Dokument, das Panel ruft einen Tale-Agent, jede Anfrage landet in deinen eigenen Protokollen.

Office Agents ist ausdrücklich **nicht produktionsreif** und wird **nicht im Microsoft AppSource veröffentlicht** — die Installation erfolgt ausschließlich per Sideload über einen lokalen Dev-Server. Behandle das heute als Power-User-/Pilot-Workflow, nicht als Ein-Klick-Rollout für die gesamte Organisation. Der Abschnitt am Ende zeigt den Weg zur breiten Verteilung.

## Was du baust

Ein per Sideload installiertes AI-Chat-Panel in Word und Excel, das jede Anfrage über deine Tale-Instanz an einen Agent routet, den du kontrollierst. Modell, Wissensumfang, Ton und Audit-Trail liegen alle in Tale — das Add-in ist nur die UI auf Editor-Seite.

## Voraussetzungen

- Eine Tale-Instanz, über HTTPS erreichbar, mit Admin-Zugriff.
- Ein [Agent](/de/platform/agents/create), konfiguriert für die Dokumentarbeit, die du willst — zusammenfassen, umschreiben, extrahieren, entwerfen. Gute Abstimmung hier ist der Unterschied zwischen nützlichem Add-in und Spielerei.
- Node.js + git auf der Workstation, auf der Office Agents läuft.
- Installierte Microsoft-365-Desktop-Apps (Office.js-Sideloading braucht die installierten Clients — Office im Web geht auch, mit anderen Sideload-Schritten).

## Schritt 1 — Einen Tale-API-Schlüssel erstellen

Navigiere zu **Einstellungen > API-Schlüssel** und klicke **Erstellen**. Benenne ihn nach Workstation oder Team (`office-agents-lab`), kopiere das `tale_...`-Token und halte es bereit. Siehe [Mitglieder und Rollen](/de/platform/admin/members-and-roles) — nur Admins und Owner dürfen API-Schlüssel anlegen.

## Schritt 2 — Office Agents lokal klonen und starten

Folge dem README unter [github.com/hewliyang/office-agents](https://github.com/hewliyang/office-agents). Kurzfassung:

```bash
git clone https://github.com/hewliyang/office-agents.git
cd office-agents
# Install- und Start-Kommandos gemäß README
```

Das Repository ist ein Monorepo mit einem Package pro Office-Host (Word, Excel, PowerPoint). Starte den Dev-Server für den gewünschten Host — Excel und Word haben eigene Kommandos; das README ist maßgebend.

## Schritt 3 — In Word und Excel sideloaden

Office Agents wird als Dev-Server-Add-in geliefert, das du über Microsofts Sideload-Flow registrierst. Microsofts aktuelle Docs stehen unter [Sideload an Office add-in](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/test-debug-office-add-ins). Der Ablauf unterscheidet sich pro OS:

- **Windows:** Manifest nach `%LOCALAPPDATA%\Microsoft\Office\OfficeAddins` ablegen.
- **macOS:** Manifest in `~/Library/Containers/com.microsoft.<Office-app>/Data/Documents/wef/` ablegen.
- **Office im Web:** Manifest über **Home > Add-Ins** hochladen.

Nach dem Sideloading öffnest du Word oder Excel und siehst den Office-Agents-Button im Menüband.

## Schritt 4 — Das Add-in auf Tale zeigen lassen

Öffne das Office-Agents-Panel, dann den Dialog `Settings`, und setze:

| Feld       | Wert                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------- |
| `Provider` | **OpenAI-compatible** (oder „Custom" — Label variiert)                                      |
| Base URL   | `https://<deine-tale-instanz>/api/v1`                                                       |
| API key    | Das `tale_...`-Token aus Schritt 1                                                          |
| Model      | Einen Agent-Slug aus `GET /api/v1/models` — siehe [API-Referenz](/de/develop/api-reference) |
| CORS proxy | Aktivieren, wenn Tale auf einem anderen Origin als das sideloadete Add-in läuft             |

Speichere. Das Panel spricht jetzt mit Tale.

## Schritt 5 — End-to-End testen

- **Excel:** eine Tabelle mit einer kurzen Datenreihe öffnen, einen Bereich markieren und im Panel „Fasse diese Daten in drei Stichpunkten zusammen" eingeben. Der Agent sollte mit deinem Tale-Modell antworten.
- **Word:** ein Dokument öffnen, einen Absatz markieren und „Schreibe das für ein nicht-technisches Publikum um" eingeben. Gleiches erwartetes Ergebnis.
- **In Tale prüfen:** die Konversationshistorie des Agents öffnen und bestätigen, dass die Anfrage als neuer Thread auftaucht. Thread, verwendetes Modell und etwaige Tool Calls sind genauso protokolliert, als hätte der Nutzer aus der Tale-UI gechattet.

## Troubleshooting

- **401 Unauthorized** — API-Schlüssel widerrufen oder vertippt; in **Einstellungen > API-Schlüssel** neu erzeugen.
- **404 auf `chat/completions`** — Base-URL fehlt das Suffix `/api/v1`.
- **Model not found** — Slug ist case-sensitive und muss exakt `GET /api/v1/models` entsprechen.
- **CORS-Fehler in der Add-in-Konsole** — entweder den CORS-Proxy in den `Settings` von Office Agents aktivieren oder den Origin des Add-ins in den Allowed Origins deines Tale-Reverse-Proxies ergänzen.
- **Sideload-Manifest abgelehnt** — Manifest-XML gegen [Microsofts Schema](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/add-in-manifests) prüfen; der Dev-Server in Office Agents gibt Validierungsfehler beim Start aus.

## Breiter Rollout

Sideloading eignet sich für einen Pilot, skaliert aber nicht. Für eine ganze Organisation ist der tragfähige Weg:

1. Office Agents intern forken und sein Manifest über [Microsoft 365 Centralized Deployment](https://learn.microsoft.com/en-us/microsoft-365/admin/manage/manage-deployment-of-add-ins) oder Intune ausrollen, damit jeder Seat es automatisch bekommt.
2. Eine Audit-Richtlinie auf Agent-Ebene in Tale ausrollen — alle Anfragen landen ohnehin in der Konversationshistorie des Agents, Governance läuft zentral.
3. Upstream im Auge behalten: sobald Office Agents Produktionsreife erreicht und im AppSource erscheint, auf das gehostete Manifest umsteigen.

## Vollständig Open-Source-Alternativen

Wenn Office Agents nicht passt, folgen zwei schmalere Add-ins demselben Base-URL-/API-Schlüssel-Muster aus Schritt 4:

- **Nur Excel** — [LLMExcel](https://github.com/liminityab/LLMExcel) (MIT).
- **Nur Word** — [gptlocalhost](https://gptlocalhost.com) / LocPilot.

Die Konfiguration ist identisch: auf `https://<deine-tale-instanz>/api/v1` mit einem `tale_...`-Schlüssel und einem Agent-Slug als Modell zeigen.
