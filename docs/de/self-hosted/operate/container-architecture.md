---
title: Container-Architektur
description: Welcher Container welchen Job in einer laufenden Tale-Instanz hat, der Request-Pfad einer Chat-Nachricht und wie ein Ausfall jedes Containers aussieht.
---

Eine Tale-Instanz besteht aus zehn Containern, verdrahtet durch docker compose. Die Architektur-Seite hat behandelt, wofür jeder Container da ist; diese Seite ist die Operator-Version — welcher Container welchen Job besitzt, wie eine Chat-Nachricht durch sie fliesst und wie der Fehlermodus aussieht, wenn einer von ihnen stirbt.

Lies das, wenn du Bereitschaft hast. Komm zurück, wenn du entscheidest, welchen Container du während eines Upgrades zuerst rollst.

## Die zehn Container, mit ihren Jobs

| Container                  | Job                                                                                                                                          | Ausfälle betreffen                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `tale-proxy`               | TLS-Terminierung + Edge-Routing                                                                                                              | Jeden Ingress — kein Client erreicht die UI                                     |
| `tale-platform`            | UI-Server, statische Asset-Auslieferung, die öffentliche `/status`-Seite                                                                     | Browser sieht 502; die API ist erreichbar                                       |
| `backend-api`              | Jede Anwendungs-Anfrage: Auth, App-API, Maschinen-API, WebDAV, der Live-Update-Stream — und die Wissens-Suche im selben Prozess              | UI lädt, aber ohne Daten; laufende Chats stocken                                |
| `backend-worker`           | Hintergrund-Jobs: Dokument-Ingestion und Embedding, Web-Crawling, Automation-Runs, Retention-Sweeps, der Cron-Plan                           | UI arbeitet weiter; Uploads bleiben auf „Indexieren", Automations feuern nicht  |
| `tale-db`                  | Postgres — die Anwendungsdatenbank, die Job-Warteschlange und das Wissens-Korpus                                                             | Writes werden abgelehnt; die App degradiert auf das, was schon geladen ist      |
| `tale-knowledge-db`        | Postgres des Wissens-Korpus (Dokument-Chunks, Embeddings, gecrawlte Seiten)                                                                  | Wissens-Suche liefert leer; Ingestion scheitert                                 |
| `tale-object-store`        | Der Blob-Store — hochgeladene Dokumente, Chat-Anhänge, Audio, generierte Medien                                                              | Jeder Upload und jeder Download scheitert; der Rest der App arbeitet weiter     |
| `tale-sandbox-llm-gateway` | LLM-Gateway für Harness-Züge                                                                                                                 | Harness-Züge erreichen kein Modell; Chat ist unbetroffen                        |
| `tale-sandbox-egress`      | Netzwerk-Egress für sandboxierten Code                                                                                                       | **Code-ausführen**-Tool scheitert mit „Egress denied"; Web-Render scheitert     |
| `tale-sandbox`             | Sandbox-Laufzeit + Headless-Browser für Web-Render und Dokumentgenerierung                                                                   | **Code-ausführen**, Web-Crawl-Render und Dokumentgenerierung scheitern alle     |

`backend-api` und `backend-worker` sind dasselbe Image wie `tale-platform`, nur in einer anderen Rolle gestartet, und beide skalieren unabhängig — `docker compose up -d --scale backend-worker=3` ist eine unterstützte Topologie, und genau deshalb gibt die ausgelieferte Compose-Datei ihnen keinen festen Container-Namen. Sprich sie über den Service-Namen an. Ein `tale deploy`-Stack nennt sie `<project-id>-backend-api` und `<project-id>-backend-worker`.

`tale-knowledge-db` ist in der ausgelieferten Compose-Datei ein eigener Container. Ein Single-Host-`tale deploy`-Stack faltet das Korpus stattdessen in `tale-db` und gibt diesem Container den Netzwerk-Alias `knowledge-db`, sodass derselbe Connection-String in beiden Fällen auflöst — wenn `tale status` keine Wissensdatenbank zeigt, liegt es daran, und `tale-db` ist der Container, in den du schauen musst.

Ein Container ist dem öffentlichen Netz exponiert (`tale-proxy` für HTTPS, optional `tale-sandbox-egress` ausgehend für die Sandbox); der Rest nur intern, der Blob-Store eingeschlossen — Blobs erreichen den Browser über präsignierte URLs, die der Proxy unter dem Bucket-Pfad weiterleitet.

## Der Request-Pfad

Eine Chat-Nachricht macht einen Durchlauf durch die Container:

1. Browser → `tale-proxy` (TLS terminiert).
2. `tale-proxy` → `tale-platform` für HTML, JS und die statischen Assets → `backend-api` für alles unter `/api/`, plus `/events`, `/dav` und die Maschinen-API.
3. `backend-api` liest die Provider-Config der Organisation, wählt das Modell, öffnet einen Stream zum Upstream-Provider und streamt die Tokens über Server-Sent Events zurück an den Browser.
4. Holt der Agent Wissen: `backend-api` fährt die Suche im Prozess und fragt die Korpus-Datenbank direkt ab — kein separater Retrieval-Dienst im Pfad.
5. Führt der Agent Code aus: `backend-api` → `tale-sandbox` → `tale-sandbox-egress` für ausgehende Netzwerk-Aufrufe.
6. Alles, was der Turn aufgeschoben hat — das Indexieren eines neuen Uploads, eine Folge-Automation — committet in derselben Transaktion wie der Write in die Job-Warteschlange, und `backend-worker` nimmt es auf.

Neben dem Token-Stream hält der Browser eine langlebige `GET /events`-Verbindung zu `backend-api`. Sie trägt keine Daten, nur Invalidierungs-Hinweise: Kommt einer an, lädt die App die betroffene Query neu. Ein toter Hinweis-Stream sieht deshalb aus wie eine UI, die von selbst nichts mehr aktualisiert — nicht wie ein Ausfall.

Der heisse Pfad ist kurz. Fühlt sich die Chat-Latenz falsch an, ist der Container, der schuld ist, fast immer der Upstream-Provider, nicht Tale; die Request-Histogramme des Backends auf `/metrics/backend` zeigen die Zeit in jedem Sprung.

## Die Sandbox-Ebene

Sandboxierte Code-Ausführung läuft in `tale-sandbox`, mit `tale-sandbox-egress` als der einzigen Netzwerk-Naht. Die Zwei-Container-Trennung ist Absicht: `tale-sandbox` selbst hat kein ausgehendes Netz; jeder Request, den der sandboxierte Code macht, geht durch `tale-sandbox-egress`, der Cloud-Metadaten und private Adressbereiche auf IP-Ebene blockiert und — wenn der Operator `SANDBOX_EGRESS_ALLOWLIST` setzt — zusätzlich eine Default-Deny-Hostname-Allowlist durchsetzt. Ist der Egress-Container down, scheitert sandboxierter Code, der das Netz braucht, geschlossen mit „Egress denied" — nicht stiller Timeout.

Die Sandbox-Laufzeit trägt Chromium und Playwright, also nutzt das Backend sie für die Headless-Arbeit, die es im Prozess nicht erledigen kann, erneut: das Rendern einer JavaScript-Seite während eines Web-Crawls und das Verwandeln von generiertem HTML in ein PDF oder Bild. Diese Jobs laufen als ephemere Sandbox-Ausführungen statt als User-Code, reiten aber dieselbe Egress- und Isolations-Naht. Die Sandbox ist der einzige Container, der eher-nicht-vertrauenswürdigen Code läuft (User-gelieferte Fähigkeits-Skripte, Agent-**Code-ausführen**-Aufrufe); der Rest des Stacks läuft den eigenen Code der Plattform.

## Fehler-Modi — wie der Ausfall jedes Containers aussieht

**`tale-proxy` down.** TLS-Handshake scheitert; jeder Client sieht einen Verbindungsfehler. Im Host sind die Plattform- und Backend-Container weiter up — starte Proxy zuerst neu.

**`tale-platform` down.** Browser bekommt 502 vom Proxy; die API arbeitet weiter. Bestehende Browser-Tabs mit gecachten Assets sprechen weiter mit dem Backend und merken es vielleicht erst beim Reload.

**`backend-api` down.** Browser lädt die UI-Shell, aber nichts wird befüllt, und die öffentliche `/status`-Seite liest `outage` — ihr einziger Probe ist das `/ping` dieser Schicht. Neu zu starten ist sicher: Sessions liegen in Postgres, und der Browser baut seinen Hinweis-Stream wieder auf und lädt beim Reconnect neu.

**`backend-worker` down.** Vor dem User bricht nichts — und genau deshalb übersieht man diesen Ausfall leicht. Anfragen werden weiter bedient, aber nichts Aufgeschobenes läuft: Uploads bleiben auf „Indexieren", Automations feuern nicht, geplante Sweeps stehen. Die Arbeit ist nicht verloren — pg-boss hält die Jobs in Postgres, und der Worker arbeitet den Rückstand ab, sobald er zurück ist. Achte auf `tale_backend_jobs{state="created"}`, das auf `/metrics/backend` steigt, denn der Container selbst hat keinen Healthcheck (er bedient kein HTTP), `tale status` wird also immer nur `running` sagen.

**`tale-db` down.** Jeder Write wird abgelehnt und die meisten Reads mit ihm; die Anmeldung scheitert, und die Job-Warteschlange nimmt keine Arbeit mehr an. Hier degradiert nichts sanft — die Datenbank ist der Speicher der Wahrheit für die Anwendung, die Warteschlange und die Sessions.

**`tale-knowledge-db` down.** Dokument-Ingestion scheitert und die Wissens-Suche liefert leer — Agents, die Wissen abrufen, bekommen eine leere Ergebnismenge und eine Warnung im Ausführungs-Log. Der Rest der App arbeitet weiter; Chats ohne Wissen sind unbetroffen. Den Container neu zu starten räumt das, und laufende Uploads versuchen es beim nächsten Durchlauf erneut. Auf einem Stack, der das Korpus in `tale-db` gefaltet hat, sind dieser und der Ausfall darüber derselbe Ausfall.

**`tale-object-store` down.** Eine Datei hochzuladen scheitert, und eine bereits hochgeladene zu öffnen auch — eine Dokumentliste rendert weiter aus der Datenbank, aber jeder Download antwortet 5xx. Chat, Aufgaben und Automations, die keine Dateien anfassen, sind unbetroffen. Eine Organisation mit eigenem S3-Bucket läuft weiter, während der gebündelte Store down ist.

**`tale-sandbox` / `tale-sandbox-egress` down.** **Code-ausführen**-Tool-Aufrufe geben einen Fehler zurück und Fähigkeits-Skripte scheitern. Weil das Backend Webseiten rendert und Dokumente über die Sandbox-Laufzeit generiert, scheitern auch ein Web-Crawl, der JavaScript-Rendering braucht, und die Dokumentgenerierung geschlossen, solange die Sandbox down ist. Agents, die keines davon nutzen, arbeiten weiter.

**`tale-sandbox-llm-gateway` down.** Harness-Züge verlieren ihren Pfad zu einem Modell-Provider. Regulärer Chat — der Provider direkt aus dem Backend aufruft, nicht über das LLM-Gateway — ist unbetroffen.

## Wo das hingehört

Diese Seite ist die Karte des Operators; die [Architektur-Übersicht](/de/self-hosted/overview) ist die Einführung ins selbe Bild, die [Troubleshooting-Seite](/de/self-hosted/operate/observability/troubleshooting) ist der symptomorientierte Index, wenn etwas schiefgegangen ist. Wenn du Alert-Schwellen setzt, benennt [Operations](/de/self-hosted/operate/observability/operations) die Signale, die sich zu verdrahten lohnen.
