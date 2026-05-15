---
title: Status-Seite
description: Die öffentliche /status-Oberfläche — was jede Komponente meldet, was das Rollup bedeutet und wie externe Monitore sie konsumieren.
---

Tale exponiert auf jeder Instanz eine öffentliche Status-Oberfläche unter `/status` (HTML) und `/status.json` (JSON). Beide spiegeln denselben Probe: einen fünf Sekunden gecachten Health-Check gegen die drei internen Backends — Anwendung, Wissensdatenbank, Web- & Dokumentendienste —, zusammengeführt zu einem einzelnen Urteil aus `operational` / `degraded` / `outage`. Die Seite ist für zwei Leser: den Betreiber, der eine einzelne URL prüfen will, bevor er einen Vorfall meldet, und den externen Monitoring-Agent, der Tales öffentliche Oberfläche pollt.

Diese Seite ist die Drahtreferenz: was jedes Feld bedeutet, welche Werte es annehmen kann und was die Seite absichtlich nicht sagt. Für Pro-Anfrage-Fehlerraten oder KI-Anbieter-Verfügbarkeit ist der Observability-Stack unter [Operations](/de/self-hosted/operate/observability/operations) die richtige Oberfläche.

## Durchgespieltes Beispiel — den Status-Feed abrufen

Der kleinstmögliche Monitor-Probe ist ein GET gegen `/status.json`:

```bash
curl -s https://your-tale-instance.com/status.json
```

Wenn alles gesund ist, ist die Antwort:

```json
{
  "status": "operational",
  "checkedAt": "2026-05-15T13:45:07.123Z",
  "components": [
    { "id": "convex", "status": "operational" },
    { "id": "rag", "status": "operational" },
    { "id": "crawler", "status": "operational" }
  ]
}
```

Beide Endpoints antworten mit `200 OK` und `Cache-Control: public, max-age=5` — auch während eines Ausfalls, damit externe Monitore eine stabile Antwortform statt eines Timeouts bekommen.

## Die beiden Endpoints

| Endpoint       | Verwendung                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/status`      | Menschen-lesbare HTML-Seite. Sprache aus `Accept-Language` gewählt (Englisch, Deutsch, Französisch). Kein JavaScript, kein Auto-Refresh. |
| `/status.json` | Maschinen-lesbarer Feed für externe Monitore — BetterStack, UptimeRobot, Atlassian Statuspage, Datadog Synthetics, alles andere.         |

Beide Endpoints teilen denselben Probe (ein einzelner In-Memory-Cache liegt vor beiden), sodass HTML-Seite und JSON-Feed nicht driften können. Der Unterschied liegt nur in der Darstellung.

## Drahtform (`/status.json`)

| Name                  | Typ    | Beschreibung                                                                                                                  |
| --------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `status`              | string | Rollup-Urteil: `operational` (jede Komponente verfügbar), `degraded` (einige verfügbar, einige nicht), `outage` (alle nicht). |
| `checkedAt`           | string | ISO-8601-Zeitstempel der letzten Probe-Runde.                                                                                 |
| `components`          | array  | Pro-Komponenten-Health. Form und Reihenfolge sind über Versionen hinweg stabil.                                               |
| `components[].id`     | string | Stabiler Komponenten-Identifier: `convex`, `rag` oder `crawler`.                                                              |
| `components[].status` | string | `operational` oder `outage`. Aktuell gibt es keinen Pro-Komponenten-`degraded`-Wert.                                          |

Die Felder sind über Versionen hinweg stabil: neue Felder können hinzukommen, bestehende werden nicht umbenannt oder entfernt. Schlüsselwort-basierte Uptime-Monitore können auf den Case-sensitiven Substring `"status":"outage"` alarmieren und auf diesen Treffer über Upgrades hinweg vertrauen.

## Was jede Komponente abdeckt

Die IDs mappen auf Subsysteme, nicht auf die zugrunde liegenden Stack-Namen — eine bewusste Wahl, damit die öffentliche Oberfläche lesbar bleibt, wenn sich der Stack ändert.

| ID        | Abgedeckt                                                                             |
| --------- | ------------------------------------------------------------------------------------- |
| `convex`  | Das Anwendungs-Backend (Lese-, Schreib-, Realtime-Sync). Ist das aus, ist die UI aus. |
| `rag`     | Die Wissensdatenbank — neue Dokumente indizieren und bestehende durchsuchen.          |
| `crawler` | Web- & Dokumentendienste — Site-Crawls und On-Demand-URL-Fetches.                     |

Das Rollup ist auf Komponenten-Ebene binär: jedes Subsystem ist entweder erreichbar und liefert (`operational`) oder nicht (`outage`). Ein künftiger Pro-Komponenten-`degraded`-Wert (z. B. latenz-basiert) kann landen, ohne Konsumenten zu brechen, weil `status` schon das breitere `OverallStatus`-Vokabular akzeptiert.

## Wie der Probe funktioniert

Eine einzelne Probe-Runde verteilt drei HTTP-Anfragen parallel — eine an jeden Backend-Health-Endpunkt — mit zwei Sekunden Pro-Probe-Timeout. Das Ergebnis wird fünf Sekunden im Prozess-Speicher gecacht, damit eine nicht-authentifizierte `/status`-Route nicht von einem feindlichen Anrufer zu einem Probe-Verstärker gemacht werden kann. Nur der HTTP-Status jedes Upstreams wird inspiziert; Antwort-Bodies werden sofort verworfen, sodass ein sich fehlverhaltender Upstream keine Bytes in die öffentliche Antwort drücken kann.

Der Platform-Prozess selbst ist im Rollup implizit: wenn `/status` überhaupt antwortet, ist die Platform erreichbar. `outage` heisst also, dass jeder Backend-Probe fehlschlug — das ist, was Nutzer effektiv sehen, weil keiner der nutzerseitigen Flows ohne mindestens einen der drei funktioniert.

## Was nicht auf der Seite ist

`/status` ist eine grobkörnige Oberfläche — „ist die Plattform erreichbar" — keine Metrik-Health-Ansicht. Die Seite meldet nicht:

- **Pro-Anfrage-Fehlerraten.** Nutze den Sentry-Stack unter [Operations](/de/self-hosted/operate/observability/operations).
- **KI-Anbieter-Verfügbarkeit.** Die eigene Status-Seite des Anbieters ist die autoritative Quelle dafür.
- **Queue-Tiefe, Latenz-Histogramme oder Pro-Mandanten-Metriken.** Die liegen in den Prometheus-Endpoints, ebenfalls unter Operations abgedeckt.
- **Nur-interne Dienste.** Die Datenbank, der Proxy, die Hintergrund-Worker — ihre Fehlermodi laufen ohnehin durch eine der drei genannten Komponenten, also würde sie separat zu exponieren Rauschen ohne Information hinzufügen.

## Was zu scrapen ist

Für einen externen Uptime-Monitor GET `/status.json` in dem Intervall, das zum Alarm-Fenster passt — 1–5 Minuten sind typisch. Die Antwort ist klein (~500 Bytes) und der Endpunkt ist nicht authentifiziert; er gatet absichtlich nicht hinter einem Login, damit Monitore ihn ohne Anmelde-Provisioning erreichen.

Für internes Alarming, das tiefer geht als das Rollup, scrape stattdessen die Prometheus-Endpoints unter [Operations](/de/self-hosted/operate/observability/operations). `/status` ist die URL, die du in einen Incident-Channel postest; Prometheus ist die URL, die Grafana abfragt.

## Wo das einsetzt

Die Status-Seite ist die leichteste Operator-Oberfläche — die URL, die jemand vor dem Melden eines Vorfalls trifft, der Endpunkt, den ein Drittanbieter-Monitor pollt. Das API-Gegenstück zu dieser Seite ist der Rest der [API-Referenz](/de/develop/api-reference); der tiefere Observability-Stack für Self-hosted-Betreiber liegt unter [Operations](/de/self-hosted/operate/observability/operations), und der In-App-Kommunikations-Kanal für Upgrades und bekannte Probleme ist [What's new](/de/platform/admin/whats-new).
