---
title: Word- & Excel-Add-in
description: Ein KI-Panel in Word und Excel über deine Tale-Instanz betreiben — mit Office Agents.
---

Microsoft Word und Excel haben keinen eingebauten Weg, einen eigenen LLM-Endpunkt mitzubringen, und die meisten Office-KI-Add-ins sind an die Cloud ihres Anbieters gebunden. [Office Agents](https://github.com/hewliyang/office-agents) ist ein MIT-lizenziertes Add-in, das ein KI-Chat-Panel in Word, Excel und PowerPoint einblendet und jeden OpenAI-kompatiblen Endpunkt als Modell-Backend akzeptiert. Das macht es zum besten aktuellen Fit für Tale: Nutzer bearbeiten ihr Dokument, das Panel ruft einen Tale-Agent, jede Anfrage landet in deinen eigenen Ausführungs-Logs.

Das Ergebnis am Ende ist ein sideloaded Panel in Word und Excel, das mit deiner Tale-Instanz spricht — das Modell, der Wissens-Scope, der Ton und der Audit-Trail liegen alle in Tale; das Add-in ist nur die Editor-seitige UI. Office Agents ist ausdrücklich nicht produktionsreif und nicht auf AppSource veröffentlicht, also deckt dieses Tutorial den Pilot-Pfad ab; der Abschluss nennt die Route für die org-weite Auslieferung.

## Bevor du beginnst

Du brauchst Admin- oder Inhaber-Zugriff in Tale (nur diese Rollen können API-Schlüssel erstellen) sowie einen bereits konfigurierten Agent für dokumentschreibende Arbeit — zusammenfassen, umschreiben, extrahieren, entwerfen. Diesen Agent gut zu tunen ist der Unterschied zwischen einem nützlichen Panel und einer Spielerei; [Den ersten Agent end-to-end bauen](/de-CH/tutorials/editor/first-agent-end-to-end) deckt die Konfiguration ab.

Auf dem Arbeitsplatz, der Office Agents ausführen wird, brauchst du Node.js, `git` und installierte Microsoft-365-Desktop-Apps. Office.js-Sideloading braucht die installierten Clients — Office im Web geht auch, aber mit anderer Sideload-Mechanik. Der Leser dieser Seite ist die Person, die das Sideloading durchführt, typischerweise ein Power-User oder Pilot-Lead.

## Schritt 1 — Einen Tale-API-Schlüssel erstellen

Öffne **Einstellungen > API-Schlüssel** und klicke **Erstellen**. Benenne den Schlüssel nach dem Arbeitsplatz oder der Pilot-Gruppe (`office-agents-lab`), kopiere das `tale_...`-Token sofort — es wird genau einmal angezeigt — und halte es für Schritt 4 bereit. Nur Admins und Inhaber können API-Schlüssel erstellen; siehe [Mitglieder und Rollen](/de-CH/platform/admin/members-and-roles).

Der Schritt hat funktioniert, wenn die API-Schlüssel-Liste den neuen Eintrag mit Letzte-Nutzung-Zeitstempel von „Nie" zeigt.

## Schritt 2 — Office Agents lokal klonen und starten

Office Agents wird als Dev-Server-Add-in ausgeliefert, nicht als verpacktes Binary, also läuft es aus einem lokalen Checkout. Folge der Projekt-README unter [github.com/hewliyang/office-agents](https://github.com/hewliyang/office-agents) für die autoritativen Installationsschritte; die Kurzversion:

```bash
git clone https://github.com/hewliyang/office-agents.git
cd office-agents
# folge den Install- und Start-Befehlen der README für den Office-Host, den du brauchst
```

Das Repository ist ein Monorepo mit einem Paket pro Office-Host (Word, Excel, PowerPoint). Starte den Dev-Server zuerst für den Host, den du pilotierst — beide haben eigene Befehle in der README.

Der Schritt hat funktioniert, wenn der Dev-Server eine „ready"-Zeile und eine localhost-URL druckt.

## Schritt 3 — Das Add-in in Word und Excel sideloaden

Office Agents registriert sich über Microsofts Add-in-Sideload-Ablauf. Die aktuellen Docs liegen unter [Sideload an Office add-in](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/test-debug-office-add-ins); die Dateistruktur unterscheidet sich pro OS:

- **Windows**: Manifest in `%LOCALAPPDATA%\Microsoft\Office\OfficeAddins` ablegen.
- **macOS**: Manifest in `~/Library/Containers/com.microsoft.<Office-app>/Data/Documents/wef/` platzieren.
- **Office im Web**: Manifest aus dem **Home**-Menüband im **Add-ins**-Menü hochladen.

Starte Word oder Excel neu, nachdem das Manifest am Platz ist — die Desktop-Apps scannen das Sideload-Verzeichnis beim Start, nicht im laufenden Betrieb.

Der Schritt hat funktioniert, wenn der Office-Agents-Knopf im Menüband des Office-Hosts erscheint, den du registriert hast.

## Schritt 4 — Das Add-in auf Tale zeigen

Öffne das Office-Agents-Panel in Word oder Excel, öffne seinen **Settings**-Dialog und konfiguriere:

| Feld          | Wert                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| Anbieter      | **OpenAI-compatible** (Label variiert je Release — „Custom" geht auch)                                   |
| Basis-URL     | `https://<deine-tale-instanz>/api/v1`                                                                    |
| API-Schlüssel | Das `tale_...`-Token aus Schritt 1                                                                       |
| Modell        | Eine Modell-ID, die `GET /api/v1/models` zurückgibt — siehe [API-Referenz](/de-CH/develop/api-reference) |
| CORS-Proxy    | Aktivieren, wenn Tale auf einer anderen Origin läuft als das sideloaded Add-in                           |

Speichern. Das Panel spricht jetzt mit Tale.

Der Schritt hat funktioniert, wenn der Settings-Dialog ohne Fehler schliesst und das „Test"-Feature des Panels oder die erste Anfrage Inhalt zurückgibt.

## Schritt 5 — End-to-End testen

Fahre eine Anfrage in jedem Office-Host, um Routing und Rendering beide zu bestätigen:

- **Excel**: öffne ein Blatt mit kurzer Tabelle, wähle einen Bereich, frag „Fass diese Daten in drei Punkten zusammen". Der Agent sollte mit der Zusammenfassung im Panel antworten.
- **Word**: öffne ein Dokument, wähle einen Absatz, frag „Schreib das für ein nicht-technisches Publikum um". Dasselbe erwartete Ergebnis.

Öffne dann die Konversationshistorie des Agents in Tale und bestätige, dass beide Anfragen als neue Threads erscheinen. Der Thread, das verwendete Modell und alle Tool-Calls werden genauso protokolliert, als hätte der Nutzer aus der Tale-UI gechattet.

Der Schritt hat funktioniert, wenn beide Office-Anfragen eine Antwort erzeugen und beide Threads in der Historie des Agents erscheinen.

## Vertrauensgrenze

Was in jeder Richtung über das Netz geht:

- **Von Word oder Excel zu Tale**: der ausgewählte Text, der Prompt des Nutzers und alle Systemanweisungen, die Office Agents ergänzt. Office Agents liest den ausgewählten Bereich — nicht das ganze Dokument — und sendet nur das.
- **Von Tale zum Modell-Anbieter**: der Prompt, den der Agent sendet, genau wie es eine Chat-UI-Anfrage täte. Um diese Strecke im Netz zu halten, kombiniere dieses Tutorial mit [Lokalen Anbieter verbinden](/de-CH/tutorials/admin/connect-local-provider).
- **Vom Office-Host zu Microsoft**: Telemetrie, die deine Microsoft-365-Tenancy-Policy ohnehin steuert — Tale ändert das nicht.
- **API-Schlüssel im Transit**: das `tale_...`-Token liegt im Office-Agents-Einstellungsspeicher auf jedem Arbeitsplatz. Widerrufe den Schlüssel (und rotiere ihn auf dem Arbeitsplatz), sobald ein Laptop den Besitzer wechselt.

Der Office-Host sieht das Reasoning des Modells, Tool-Calls oder Wissensdatenbank-Lookups nicht — das bleibt alles im Ausführungs-Log von Tale. Das Panel sieht immer nur die finale Completion.

## Fehlerbehebung

- **401 Unauthorized** — der API-Schlüssel wurde widerrufen oder falsch getippt. Regeneriere in **Einstellungen > API-Schlüssel** und füge in die Office-Agents-Einstellungen neu ein.
- **404 auf `chat/completions`** — der Basis-URL fehlt das `/api/v1`-Suffix.
- **Modell nicht gefunden** — die Modell-ID beachtet Gross-/Kleinschreibung und muss exakt zu `GET /api/v1/models` passen. Aus der Antwort kopieren, nicht aus dem **KI-Anbieter**-UI-Label.
- **CORS-Fehler in der Add-in-Konsole** — entweder den CORS-Proxy in den Office-Agents-Einstellungen aktivieren oder die Origin des Add-ins zur Allow-Liste deines Tale-Reverse-Proxys hinzufügen.
- **Sideload-Manifest abgelehnt** — prüfe das Manifest-XML gegen [Microsofts Schema](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/add-in-manifests); der Office-Agents-Dev-Server druckt Validierungsfehler beim Start.

## Wo das einsetzt

Das Office-Add-in-Tutorial routet Microsoft-365-Verkehr zu einem Tale-Agent, ohne den Bearbeitungs-Workflow des Nutzers zu ändern. Dieselbe OpenAI-kompatible API-Oberfläche, die das Add-in nutzt, ist voll dokumentiert in der [API-Referenz](/de-CH/develop/api-reference); der Agent, den das Add-in ruft, wird über [Den ersten Agent end-to-end bauen](/de-CH/tutorials/editor/first-agent-end-to-end) gebaut; der Pro-Konversations-Audit-Trail liegt in der Chat-Historie unter [Konversationen](/de-CH/platform/workspace/conversations).

Für eine org-weite Auslieferung jenseits des Pilots ist der haltbare Pfad, Office Agents intern zu forken und sein Manifest über [Microsoft 365 Centralized Deployment](https://learn.microsoft.com/en-us/microsoft-365/admin/manage/manage-deployment-of-add-ins) oder Intune zu veröffentlichen, sodass jeder Platz das Add-in automatisch bekommt — Sideloading ist für einen Pilot in Ordnung, skaliert aber nicht. Zwei engere Alternativen — Excel-nur [LLMExcel](https://github.com/liminityab/LLMExcel) und Word-nur [gptlocalhost](https://gptlocalhost.com) — folgen demselben Basis-URL- + API-Schlüssel-Muster, falls Office Agents nicht passt.
