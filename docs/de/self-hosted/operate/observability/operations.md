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
| `db-data`-Volume > 80 % voll                | warn        | Das operative Postgres geht bei voll auf read-only         |
| `knowledge-db-data`-Volume > 80 % voll      | warn        | Ingestion scheitert, wenn die Korpus-Datenbank voll ist    |
| `tale-knowledge-db` von convex unerreichbar | warn        | Wissens-Suche liefert leer; Ingestion stockt               |
| Anbieter-Anfrage-Fehlerrate > 20 %          | warn        | Der Upstream-LLM-Anbieter hat einen schlechten Tag         |
| Tägliches Backup nicht geschrieben          | page        | Restore-Drill scheitert zum schlimmsten Zeitpunkt          |
| TLS-Cert-Erneuerung gescheitert             | warn        | Erneuert 30 T vor Ablauf — du hast Zeit                    |

Die ersten zwei Pages sind die wirklich kundenwirksamen. Die warns fangen Trends, bevor sie ins Page-Gebiet kippen.

## Log-Signale, nach denen man greppen sollte

Logs kommen über stdout pro Container, aufgefangen vom `json-file`-Driver von Docker. Die vier Phrasen, die konsistent Ärger bedeuten:

- `panic` oder `unexpected error` in `tale-convex`-Logs — Convex-Action-Crash.
- `decryption failed` in `tale-platform`-Logs — SOPS-age-Schlüssel-Mismatch mit der Datei auf Platte.
- `429 Too Many Requests` wiederholt von einem Anbieter — Rate-Limit getroffen, Agents fangen an zu scheitern.
- `connection refused` oder `ECONNREFUSED` zu `knowledge-db` in `tale-convex`-Logs — das Backend erreicht die Korpus-Datenbank nicht; Ingestion und Wissens-Suche scheitern.

Leite diese als abgeleitete Alerts an deinen Aggregator weiter; die Metric-Endpoints zeigen sie nicht als Gauges.

## Oncall-Checkliste

Wenn eine Page landet, folgen die ersten fünf Minuten jedes Mal derselben Form.

1. **Bestätige, dass der Alert echt ist.** Öffne `$SITE_URL` im Browser. Lädt die UI und Chat funktioniert, schaust du auf ein Metrik- oder Scraper-Problem, nicht ein kundenwirksames.
2. **Identifiziere den Container.** `docker compose ps` zeigt, welcher unhealthy ist; `docker compose logs --tail=200 <service>` zeigt den letzten Fehler.
3. **Starte den wahrscheinlichsten Schuldigen neu.** `docker compose restart <service>` löst einen überraschenden Anteil der Vorfälle — Prozess-Crashes, abgestandene File-Watcher, erschöpfte Verbindungs-Pools. Die Architektur ist gebaut, um einen einzelnen Container-Restart sauber zu überleben.
4. **Prüf Upstream-Anbieter.** `https://status.openai.com`, `https://status.anthropic.com`, etc. Brennt der Anbieter, scheitern Agents; Tale ist nicht die Ursache.
5. **Page die diensthabende Ingenieurin, wenn das benutzerwirksame Symptom nach einem Restart bleibt.** Nicht früher eskalieren — die meisten Vorfälle lösen sich in den ersten drei Schritten.

## Was Oncall nicht braucht

Ein `tale-knowledge-db`-Ausfall ist ein warn, kein page. Der Web-Crawl-Plan absorbiert Stunden von Downtime ohne Benutzerwirkung, und die Dokument-Ingestion versucht es erneut, statt Arbeit zu verwerfen — Uploads sitzen in „indexing", bis die Korpus-Datenbank zurück ist. Die Wissens-Suche liefert in der Zwischenzeit leer, aber Chats, die kein Wissen abrufen, arbeiten weiter. Fang das im warn-Band und fix es zu Geschäftszeiten.

## Antwortzeit-SLAs

Zwei Antwortzeit-Budgets werden als erstklassige Signale verfolgt: interaktive Dialog-Eingabe und langlaufende Operationen wie Evaluierungen. Beide werden als **Mittelwert** über ein gleitendes Fenster verifiziert — die vertragliche Zahl ist ein Durchschnitt, keine Obergrenze pro Anfrage — und beide sind so verdrahtet, dass Prometheus alarmiert, sobald der Durchschnitt über das Budget driftet.

| Budget          | Statistik  | Ziel  | Fenster | Zugrundeliegende Serie        |
| --------------- | ---------- | ----- | ------- | ----------------------------- |
| Dialog-Eingabe  | Mittelwert | ~1 s  | 30 Min  | `tale_dialog_ttft_seconds`    |
| Lange Operation | Mittelwert | ~40 s | 6 Std   | `tale_long_operation_seconds` |

Jedes Ziel reitet zudem auf dem Plattform-Metrik-Endpoint als `tale_sla_target_seconds{sla,statistic}`, sodass ein Grafana-Panel die Budget-Linie direkt aus Prometheus zeichnet, statt sie fest zu verdrahten. Die zugrundeliegenden Latenz-Serien sind die Convex-Funktions-Ausführungs-Histogramme auf `/metrics/convex`; relabel oder record sie auf die Namen oben, damit die Rules auflösen. Die Plattform liefert die fertigen Recording- und Alerting-Rules unter `/metrics/sla-rules` (hinter demselben Bearer-Token wie die anderen Metrik-Pfade) — hole sie einmal und referenziere die Datei unter `rule_files:`, oder füge das Äquivalent ein:

```yaml
groups:
  - name: tale-sla-recording
    rules:
      - record: tale_sla_dialog_ttft:mean30m
        expr: rate(tale_dialog_ttft_seconds_sum[30m]) / rate(tale_dialog_ttft_seconds_count[30m])
        labels:
          sla: dialog_ttft
      - record: tale_sla_long_operation:mean6h
        expr: rate(tale_long_operation_seconds_sum[6h]) / rate(tale_long_operation_seconds_count[6h])
        labels:
          sla: long_operation
  - name: tale-sla-alerts
    rules:
      - alert: TaleSlaDialogTtftBreached
        expr: tale_sla_dialog_ttft:mean30m > 1
        for: 15m
        labels:
          severity: warn
          sla: dialog_ttft
        annotations:
          summary: 'Dialog input response time: mean response time over 30m exceeds the 1s SLA'
          description: Mean time-to-first-token for an interactive chat / dialog turn.
      - alert: TaleSlaLongOperationBreached
        expr: tale_sla_long_operation:mean6h > 40
        for: 30m
        labels:
          severity: warn
          sla: long_operation
        annotations:
          summary: 'Long operation response time: mean response time over 6h exceeds the 40s SLA'
          description: Mean end-to-end time for long-running operations such as evaluations.
```

Ein Breach hier ist ein **warn**, kein page: ein driftender Durchschnitt ist eine Degradation, die zu Geschäftszeiten zu verfolgen ist, und die `for:`-Fenster warten bewusst eine kurze Spitze aus, bevor sie feuern. Das ~1-s-Dialog-Budget versöhnt sich mit dem lockereren ~3-s-Warm-Time-to-First-Token im manuellen Performance-Plan — jene ~3 s sind eine Obergrenze pro Anfrage für ein einzelnes kaltes, Auto-geroutetes erstes Token (das erste Text-Delta per Provider-SSE) inklusive Modell- und Netzwerk-Zeit, während die ~1 s hier der Steady-State-Mittelwert über Dialog-Turns ist, sodass gelegentliche erste Tokens, die die Obergrenze erreichen, mit einem Sub-Sekunden-Mittelwert vereinbar sind. Den 1-s-Mittelwert auf Live-Anbietern zu halten, kann noch die Backend-Overhead-Optimierung brauchen, die im Feature-Issue verfolgt wird; dieser Alert bestätigt, ob das Ziel erreicht ist.

## Wo das hingehört

Die Signale oben sind die proaktive Seite des Betreibens einer Tale-Instanz; die reaktive Seite ist [Troubleshooting](/de/self-hosted/operate/observability/troubleshooting), und die Konfiguration, die die Metriken in Prometheus bekommt, ist [Observability-Konfiguration](/de/self-hosted/configuration/observability-config). Hast du `METRICS_BEARER_TOKEN` noch nicht gesetzt, ist jede Schwelle oben unbeobachtet — fang dort an.
