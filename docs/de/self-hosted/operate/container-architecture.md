---
title: Container-Architektur
description: Welcher Container in einer laufenden Tale-Instanz welche Aufgabe besitzt, der Anfragepfad einer Chat-Nachricht und wie ein Ausfall jedes Containers aussieht.
---

Eine Tale-Instanz besteht aus neun Containern, verdrahtet über docker compose, plus einem kleinen Video-Ingestion-Sidecar. Die Architekturseite behandelte, wofür jeder Container da ist; diese Seite ist die Operator-Version — welcher Container welche Aufgabe besitzt, wie eine Chat-Nachricht durch sie fließt und wie der Fehlermodus aussieht, wenn einer von ihnen stirbt.

Lies das, wenn du Bereitschaft hast. Komm zurück, wenn du entscheidest, welchen Container du bei einem Upgrade zuerst rollst.

## Die Container und ihre Aufgaben

| Container                  | Aufgabe                                                                           | Crash betrifft                                                              |
| -------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `tale-proxy`               | TLS-Terminierung + Edge-Routing                                                   | Jeden Ingress — kein Client erreicht die UI                                 |
| `tale-platform`            | Web-Tier: SPA + statische Assets, Branding, der Config-SSE-Watch                  | Browser sieht die Ladeseite; die API bedient gecachte Tabs weiter           |
| `tale-backend-api`         | Jede Anwendungstür: App-API, Auth, der SSE-Hinweis-Stream, die Maschinentüren     | UI lädt, aber keine Daten; Anmeldung, Chat und Uploads scheitern            |
| `tale-backend-worker`      | Job-Runner: Schedules, Agent-Turns, Ingestion, Crawling, RAG-Indexierung, Doc-Gen | Chat antwortet weiter; Hintergrund-Jobs, Automationen und Ingestion stocken |
| `tale-db`                  | Operatives Postgres — der `tale_app`-Speicher und der `tale_knowledge`-Korpus     | Schreibvorgänge blockieren; Wissenssuche liefert leer                       |
| `tale-object-store`        | S3-kompatibler Blob-Store (Uploads, Anhänge, generierte Medien)                   | Jeder Up-/Download scheitert; laufende Chats ohne Dateien laufen weiter     |
| `tale-sandbox-llm-gateway` | LLM-Gateway für Harness-Turns                                                     | Harness-Turns erreichen kein Modell; Chat ist unbetroffen                   |
| `tale-sandbox-egress`      | Netz-Egress für sandboxten Code                                                   | `Run code` scheitert mit „egress denied“; Web-Rendering scheitert           |
| `tale-sandbox`             | Sandbox-Laufzeit + Headless-Browser für Web-Rendering und Dokumentgenerierung     | `Run code`, Web-Crawl-Rendering und Dokumentgenerierung scheitern alle      |

Ein Container ist dem öffentlichen Netz exponiert (`tale-proxy` für HTTPS); der Rest ist rein intern. Der `tale-bgutil-provider`-Sidecar ist Best-Effort — sein Ausfall verschlechtert nur die YouTube-Video-Link-Ingestion.

## Der Anfragepfad

Eine Chat-Nachricht macht einen Roundtrip durch die Container:

1. Browser → `tale-proxy` (TLS terminiert).
2. `tale-proxy` → `tale-platform` für die SPA-Hülle und Assets, → `tale-backend-api` für die App-API (`/api/app/*`, `/api/auth/*`) und den `/events`-SSE-Stream.
3. `tale-backend-api` liest die Provider-Config der Org, wählt das Modell und öffnet einen Stream zum Upstream-Provider, wobei es Tokens über die `/events`-SSE-Bahn zurückreicht.
4. Ruft der Agent Wissen ab: das Backend führt die RAG-Suche direkt gegen die `tale_knowledge`-Datenbank von `tale-db` aus — kein separater Retrieval-Service im Pfad.
5. Führt der Agent Code aus: `tale-backend-api` → `tale-sandbox` → `tale-sandbox-egress` für jeglichen ausgehenden Netzverkehr.
6. Schwerere Arbeit, die ein Agent-Turn abzweigt — Dokument-Ingestion, Generierung, eine geplante Automation — nimmt `tale-backend-worker` auf, nicht die api.

Der Hot-Path ist kurz. Fühlt sich die Chat-Latenz falsch an, ist der Schuldige fast immer der Upstream-Provider, nicht Tale; der Metrics-Endpunkt auf `tale-backend-api` zeigt die in jedem Hop verbrachte Zeit.

## Die Sandbox-Ebene

Sandboxte Code-Ausführung läuft in `tale-sandbox` mit `tale-sandbox-egress` als einziger Netznaht. Die Zwei-Container-Trennung ist Absicht: `tale-sandbox` selbst hat kein ausgehendes Netz; jede Anfrage, die der sandboxte Code stellt, läuft durch `tale-sandbox-egress`, das Cloud-Metadaten- und Private-Range-Ziele auf IP-Ebene blockiert und — wenn der Operator `SANDBOX_EGRESS_ALLOWLIST` setzt — obendrauf eine Default-Deny-Hostname-Allowlist erzwingt. Ist der Egress-Container aus, scheitert sandboxter Code, der das Netz braucht, geschlossen mit „egress denied“ — kein stiller Timeout.

Die Sandbox-Laufzeit bringt Chromium und Playwright mit, sodass das Backend sie für die Headless-Arbeit wiederverwendet, die es nicht im Prozess erledigen kann: eine JavaScript-Seite bei einem Web-Crawl rendern und generiertes HTML in ein PDF oder Bild verwandeln. Diese Jobs laufen als ephemere Sandbox-Ausführungen statt als Nutzer-Code, reiten aber auf derselben Egress- und Isolationsnaht. Die Sandbox ist der einzige Container, der halbwegs nicht vertrauenswürdigen Code ausführt (nutzergelieferte Skill-Skripte, `Run code`-Aufrufe von Agents); der Rest des Stacks führt den eigenen Code der Plattform aus.

## Fehlermodi — wie der Ausfall jedes Containers aussieht

**`tale-proxy` aus.** Der TLS-Handshake scheitert; jeder Client sieht einen Verbindungsfehler. Im Host sind die Plattform- und Backend-Container noch oben — starte zuerst den Proxy neu.

**`tale-platform` aus.** Der Browser bekommt die Ladeseite des Proxys statt der App-Hülle; die API läuft weiter. Bestehende Tabs mit gecachten Assets sprechen weiter mit dem Backend und merken es womöglich erst beim Neuladen.

**`tale-backend-api` aus.** Der Browser lädt die UI-Hülle, aber nichts füllt sich, und Anmeldung, Chat und Uploads scheitern alle — das ist der Container, von dem jede Anwendungsanfrage abhängt. Beide Plattform-Farben zeigen auf dieselbe api, das ist also per Design ein Single Point of Failure; ein Neustart ist sicher (Sessions sind serverseitig, Clients verbinden den SSE-Stream neu).

**`tale-backend-worker` aus.** Chat antwortet weiter — die api bedient ihn —, aber geplante Automationen, Agent-Task-Läufe, Dokument-Ingestion und RAG-Indexierung stocken, bis der Worker zurück ist. Jobs sind at-least-once, also nimmt laufende Arbeit beim nächsten Durchlauf wieder auf, statt verloren zu gehen. Skaliere den Worker (`--scale backend-worker=N`), wenn die Job-Queue der Flaschenhals ist.

**`tale-db` aus.** Schreibvorgänge blockieren und die Wissenssuche liefert leer; die App zeigt bei jeder Mutation „Speichern fehlgeschlagen“-Toasts. Das ist der eine Container, dessen Daten nicht ableitbar sind — starte ihn zuerst neu und bestätige, dass er gesund zurückkommt, bevor du dich um den Rest sorgst.

**`tale-object-store` aus.** Jeder Upload und jeder Download einer gespeicherten Datei scheitert; Agents, die Dokumente lesen oder schreiben, geben Fehler, während Chats ohne Dateien weiterlaufen. Ein Neustart des Containers behebt es — die Blobs liegen auf dem `object-store-data`-Volume, nicht im Container.

**`tale-sandbox` / `tale-sandbox-egress` aus.** `Run code`-Tool-Aufrufe geben einen Fehler, und Skill-Skripte scheitern. Weil das Backend Webseiten rendert und Dokumente über die Sandbox-Laufzeit generiert, scheitern auch ein Web-Crawl, der JavaScript-Rendering braucht, und die Dokumentgenerierung geschlossen, während die Sandbox aus ist. Agents, die nichts davon nutzen, laufen weiter.

**`tale-sandbox-llm-gateway` aus.** Harness-Turns verlieren ihren Pfad zu einem Modell-Provider. Regulärer Chat — der Provider direkt aus dem Backend aufruft, nicht über das LLM-Gateway — ist unbetroffen.

## Wenn `tale-db` nach einem Absturz zurückkommt: der Suchindex der Wissensdatenbank

Ein harter Stopp von `tale-db` — Absturz, Kill, Neustart des Hosts — kann im BM25-Suchindex (pg_search) des Wissenskorpus einen genullten Block hinterlassen. Die Tabellen sind intakt, aber jeder neue Chunk, der in den Korpus geschrieben wird, bringt den Datenbankserver zum Absturz („corrupted page pointers“), der Server startet neu, und der nächste Indexierungsjob wiederholt den Zyklus. Der Index ist abgeleitete Daten, ein Neuaufbau verliert also nichts — und das Backend erledigt ihn selbst.

Beim Start prüft jeder Backend-Container (api und worker) jeden BM25-Index der Wissensdatenbank mit `pdb.verify_index`, bevor er Anfragen bedient oder Jobs abarbeitet; die eigene Wissensdatenbank einer Organisation prüft das Backend genauso, sobald es sie zum ersten Mal anfasst. Ein Advisory Lock auf der Wissensdatenbank sorgt dafür, dass ein Container repariert und die anderen überspringen. Was dann passiert, hängt von der Indexgröße ab:

- Bis `KNOWLEDGE_INDEX_REPAIR_INLINE_MAX_BYTES` (Standard 1 GiB): Der Container baut den Index an Ort und Stelle neu auf (`REINDEX INDEX`) und prüft ihn erneut, bevor er weitermacht. Der Start verzögert sich um den Neuaufbau — bei einem kleinen Korpus Sekunden.
- Darüber: Der Start läuft weiter, ein Hintergrundjob baut den Index neu auf, ohne Lesezugriffe zu blockieren (`REINDEX INDEX CONCURRENTLY`), und Dokumente, die währenddessen hochgeladen werden, bekommen den Grund „index rebuilding“ in ihren Indexierungsstatus, statt die Datenbank abstürzen zu lassen. Sobald der neu aufgebaute Index die Prüfung besteht, stellt das Backend sie automatisch wieder in die Warteschlange.

Das Backend protokolliert die ganze Sequenz; so sieht ein reparierter Index in `docker logs tale-backend-api` aus:

```text
[knowledge] the deployment-default knowledge database: BM25 index private_knowledge.idx_pk_chunks_bm25 is unhealthy (2.9 MB) — rebuilding it now: pdb.verify_index raised: assertion `left == right` failed
[knowledge] the deployment-default knowledge database: rebuilt BM25 index private_knowledge.idx_pk_chunks_bm25 (2.9 MB, inline, 96 ms) — re-verified healthy (4 checks)
```

Jede Reparatur — und jeder Neuaufbau, der den Index nicht gesund gemacht hat — schreibt außerdem eine Zeile ins Audit-Log (Akteur `system`; Aktion `knowledge_index_repaired`, `knowledge_index_rebuild_scheduled` oder `knowledge_index_repair_failed`) und meldet sich in der Admin-Glocke jeder Organisation, deren Korpus in dieser Datenbank liegt. Eine Reparatur ist ein Versuch pro Index und Container-Start: Besteht der neu aufgebaute Index die Prüfung weiterhin nicht, hält das Backend an, weist Schreibzugriffe auf diesen Korpus mit einer klaren Fehlermeldung ab, und die Glocke sagt es dir — dann baust du den Index von Hand neu auf (`REINDEX INDEX private_knowledge.idx_pk_chunks_bm25` in der Datenbank `tale_knowledge`) oder stellst die Datenbank aus einem Backup wieder her. Wiederholte Reparaturen nach Neustarts deuten darauf hin, wie der Container gestoppt wird; `KNOWLEDGE_INDEX_REPAIR_DISABLED=1` schaltet die Prüfung ganz ab.

## Wo das hingehört

Diese Seite ist die Karte des Operators; die [Architektur-Übersicht](/de/self-hosted/overview) ist die Einführung ins selbe Bild, die [Troubleshooting](/de/self-hosted/operate/observability/troubleshooting)-Seite ist der symptomorientierte Index, wenn etwas schiefgegangen ist. Wenn du Alert-Schwellen setzt, benennt [Betrieb](/de/self-hosted/operate/observability/operations) die Signale, die sich zu verdrahten lohnen.
