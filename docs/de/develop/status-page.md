---
title: Status-Page
description: Jedes Tale-Deployment liefert seine eigene Status-Page und einen JSON-Zwilling für Monitore — was sie melden, wie du sie pollst und wo das tiefere Betriebssignal liegt.
---

Jedes Tale-Deployment beantwortet die Frage „liegt es nur an mir?" selbst. Die Plattform liefert ohne Anmeldung eine Status-Page unter `https://<dein-host>/status` und dasselbe Urteil als JSON unter `https://<dein-host>/status.json`, damit ein Uptime-Monitor es pollen kann. Die Seite rendert serverseitig eine Gesundheits-Zusammenfassung — operational, degraded oder outage — aus zwei Probes gegen das Backend: seiner Liveness und seinem eigenen Urteil über die Datenspeicher, von denen es abhängt. Ein Betreiber oder ein Endnutzer liest die Verfügbarkeit so ohne Login.

Lies das, wenn etwas sich seltsam verhält und du wissen willst, ob das Deployment steht, oder wenn du einen Monitor verdrahtest, der auf einen Tale-Ausfall reagieren soll, bevor die Retries deiner Connector aufgeben.

## Ein durchgespielter Poll

```bash
curl -sS https://your-host.example.com/status.json
# → { "status": "operational", "checkedAt": "2026-09-12T05:45:20.921Z",
#     "components": [ { "id": "backend", "status": "operational" },
#                     { "id": "database", "status": "operational" },
#                     { "id": "object-store", "status": "operational" } ] }
```

Polle sie aus deinem Monitor im selben Takt wie alles andere; sie kostet kein API-Budget und braucht keinen Schlüssel, und das Urteil ist fünf Sekunden lang gecacht, sodass ein enger Poll nicht zu einem Probe-Sturm wird. Die HTML-Seite unter `/status` ist dasselbe Urteil für einen Menschen. `GET /api/health` ist der billigere Liveness-Probe, den der Container-Healthcheck nutzt — `{"status":"ok","version":"<build>"}`, ohne Anmeldung — und der richtige, wenn du nur wissen willst, ob der Prozess antwortet.

Das JSON antwortet mit `Access-Control-Allow-Origin: *`, ein Browser-Dashboard kann es also direkt und ohne Proxy pollen; `OPTIONS` antwortet auf beiden Türen mit **204** und `Allow: GET, HEAD, OPTIONS`, und `HEAD` liefert nur die Header. Die HTML-Seite trägt keinen CORS-Header — ein Mensch öffnet sie direkt.

## Das JSON

Das Dokument hat drei Felder, und das Vokabular ist geschlossen — verzweige auf genau diese Schreibweisen:

- `status` — das Gesamturteil: `operational`, wenn jede Komponente läuft, `outage`, wenn jede Komponente ausgefallen ist, `degraded` dazwischen.
- `checkedAt` — wann die Probes zuletzt gelaufen sind, ISO 8601 in UTC.
- `components` — ein Eintrag pro Komponente, immer in dieser Reihenfolge, jeder als `{ "id", "status" }` mit `status` entweder `operational` oder `outage`:
  - `backend` — die Anwendungsschicht, die jede Anfrage bedient; jede andere Zeile hängt von ihr ab, ein ausgefallenes Backend reißt sie also alle mit.
  - `database` — die Anwendungsdatenbank und die Wissensdatenbank des Deployments, zu einer Zeile zusammengefasst: ist eine von beiden nicht erreichbar, gilt die Zeile als ausgefallen.
  - `object-store` — der Dateispeicher des Deployments, in dem Dokumente und Uploads liegen.

Eine neue Komponenten-id ist eine additive Änderung: lies die ids, die du kennst, und behandle eine unbekannte als opak. Die Menge der `status`-Schreibweisen wächst nicht ohne einen Hinweis in den [Release-Notes](/de/self-hosted/operate/release-notes/format).

## Was das Urteil abdeckt

Die Zusammenfassung meldet die Verfügbarkeit des Deployments selbst: ob das Backend antwortet und ob die Datenspeicher antworten, von denen es abhängt — das Backend prüft seine eigene Datenbank, die Wissensdatenbank und den Objektspeicher alle dreißig Sekunden und meldet das Ergebnis, sodass eine hängende Datenbank oder ein unerreichbarer Bucket als `degraded` erscheint, mit markierter ausgefallener Zeile, während das Backend selbst grün bleibt. Die Gesundheit der Modellanbieter, die eine Organisation verbunden hat, meldet sie nicht — ein Anbieter-Ausfall zeigt sich am Turn, der ihn gebraucht hätte, als der `errorCode`, den die [API-Referenz](/de/develop/api-reference) beschreibt — und Security-Advisories auch nicht; die haben ihren eigenen [Feed](/de/self-hosted/operate/security/advisories).

## Tieferes Signal

Für Betriebsdetails — Container-Gesundheit von `tale status`, Anfrage-Metriken aus den Caddy-Logs und Control-Plane-Events im In-Product-Audit-Log — bildet die [Observability-Troubleshooting-Seite](/de/self-hosted/operate/observability/troubleshooting) Symptome auf Logs ab.

## Tale Cloud

Tale-Cloud-Deployments liefern dasselbe `/status` und `/status.json` auf ihrem eigenen Host. Einen separaten öffentlichen Status-Host gibt es derzeit nicht; sobald es einen gibt, nennt diese Seite ihn und seinen Abo-Feed.

## Wo das hingehört

Die Status-Page ist der operative Kanal; [Vertrauen und Compliance](/de/cloud/trust-and-compliance) ist der Audit-Kanal. Wenn du das hier liest, weil gerade etwas in deiner Connector scheitert, listet die [API-Referenz](/de/develop/api-reference) die Error-Codes, auf die du verzweigen solltest, und [Rate-Limits](/de/develop/rate-limits) erklärt die 429, die kein Ausfall ist.
