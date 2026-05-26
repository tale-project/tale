---
title: Operations
description: Worauf zu alarmieren ist, welche Metriken zählen, und die Oncall-Checkliste, wenn sich eine Tale-Instanz schlecht zu benehmen anfängt.
---

Die Operations-Seite ist das Alert-Playbook — welche Signale es wert sind, jemanden zu wecken, welche eine Kaffee-Runde überstehen können und wie die ersten fünf Minuten eines Vorfalls aussehen. Die Metrik-Oberfläche von Tale lebt hinter `METRICS_BEARER_TOKEN`; diese Seite nimmt an, dass du Prometheus und Grafana gemäss [Observability-Konfiguration](/de/self-hosted/configuration/observability-config) verdrahtet hast und jetzt wissen musst, welche Zahlen du beobachtest.

Der symptomorientierte Index ist in [Troubleshooting](/de/self-hosted/operate/observability/troubleshooting). Diese Seite ist die proaktive Seite — Signale zuerst, Oncall-Checkliste zweitens.

## Signale, auf die zu alarmieren sich lohnt

| Signal                                      | Schweregrad | Warum es zählt                                             |
| ------------------------------------------- | ----------- | ---------------------------------------------------------- |
| `tale-proxy`-Health-Probe scheitert > 1 Min | page        | Jeder Benutzer sieht einen Verbindungsfehler               |
| `tale-platform` HTTP-5xx-Rate > 5 %         | page        | Die UI ist für einen relevanten Anteil der Anfragen kaputt |
| `tale-convex` WebSocket-Reconnect-Storm     | page        | UI lädt, aber keine Daten fliessen                         |
| Postgres-Verbindungen > 80 % des Pools      | warn        | Die nächste Spitze fängt an zu blockieren                  |
| `db-data`-Volume > 80 % voll                | warn        | Postgres geht bei voll auf read-only                       |
| RAG-Indexier-Queue-Tiefe > 100 für 10 Min   | warn        | Uploads stecken in „indexing"                              |
| Anbieter-Anfrage-Fehlerrate > 20 %          | warn        | Der Upstream-LLM-Anbieter hat einen schlechten Tag         |
| Tägliches Backup nicht geschrieben          | page        | Restore-Drill scheitert zum schlimmsten Zeitpunkt          |
| TLS-Cert-Erneuerung gescheitert             | warn        | Erneuert 30 T vor Ablauf — du hast Zeit                    |

Die ersten zwei Pages sind die wirklich kundenwirksamen. Die warns fangen Trends, bevor sie ins Page-Gebiet kippen.

## Log-Signale, nach denen man greppen sollte

Logs kommen über stdout pro Container, aufgefangen vom `json-file`-Driver von Docker. Die vier Phrasen, die konsistent Ärger bedeuten:

- `panic` oder `unexpected error` in `tale-convex`-Logs — Convex-Action-Crash.
- `decryption failed` in `tale-platform`-Logs — SOPS-age-Schlüssel-Mismatch mit der Datei auf Platte.
- `429 Too Many Requests` wiederholt von einem Anbieter — Rate-Limit getroffen, Agents fangen an zu scheitern.
- `connection refused` von `tale-rag` oder `tale-crawler` — die Plattform erreicht einen Geschwister-Container nicht.

Leite diese als abgeleitete Alerts an deinen Aggregator weiter; die Metric-Endpoints zeigen sie nicht als Gauges.

## Oncall-Checkliste

Wenn eine Page landet, folgen die ersten fünf Minuten jedes Mal derselben Form.

1. **Bestätige, dass der Alert echt ist.** Öffne `$SITE_URL` im Browser. Lädt die UI und Chat funktioniert, schaust du auf ein Metrik- oder Scraper-Problem, nicht ein kundenwirksames.
2. **Identifiziere den Container.** `docker compose ps` zeigt, welcher unhealthy ist; `docker compose logs --tail=200 <service>` zeigt den letzten Fehler.
3. **Starte den wahrscheinlichsten Schuldigen neu.** `docker compose restart <service>` löst einen überraschenden Anteil der Vorfälle — Prozess-Crashes, abgestandene File-Watcher, erschöpfte Verbindungs-Pools. Die Architektur ist gebaut, um einen einzelnen Container-Restart sauber zu überleben.
4. **Prüf Upstream-Anbieter.** `https://status.openai.com`, `https://status.anthropic.com`, etc. Brennt der Anbieter, scheitern Agents; Tale ist nicht die Ursache.
5. **Page die diensthabende Ingenieurin, wenn das benutzerwirksame Symptom nach einem Restart bleibt.** Nicht früher eskalieren — die meisten Vorfälle lösen sich in den ersten drei Schritten.

## Was Oncall nicht braucht

`tale-crawler`- und `tale-rag`-Ausfälle sind keine Pages. Der Plan des Crawlers absorbiert Stunden von Downtime ohne Benutzerwirkung; Uploads zu RAG stauen, statt zu scheitern. Fang die im warn-Band und fix sie zu Geschäftszeiten.

## Wo das hingehört

Die Signale oben sind die proaktive Seite des Betreibens einer Tale-Instanz; die reaktive Seite ist [Troubleshooting](/de/self-hosted/operate/observability/troubleshooting), und die Konfiguration, die die Metriken in Prometheus bekommt, ist [Observability-Konfiguration](/de/self-hosted/configuration/observability-config). Hast du `METRICS_BEARER_TOKEN` noch nicht gesetzt, ist jede Schwelle oben unbeobachtet — fang dort an.
