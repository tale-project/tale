---
title: Status-Page
description: Jedes Tale-Deployment liefert seine eigene Status-Page und einen JSON-Zwilling für Monitore — was sie melden, wie du sie pollst und wo das tiefere Betriebssignal liegt.
---

Jedes Tale-Deployment beantwortet die Frage „liegt es nur an mir?" selbst. Die Plattform liefert ohne Anmeldung eine Status-Page unter `https://<dein-host>/status` und dasselbe Urteil als JSON unter `https://<dein-host>/status.json`, damit ein Uptime-Monitor es pollen kann. Die Seite rendert serverseitig eine Gesundheits-Zusammenfassung — operational, degraded oder outage — aus einem Liveness-Probe gegen das Backend, sodass ein Betreiber oder ein Endnutzer die Verfügbarkeit ohne Login lesen kann.

Lies das, wenn etwas sich seltsam verhält und du wissen willst, ob das Deployment steht, oder wenn du einen Monitor verdrahtest, der auf einen Tale-Ausfall reagieren soll, bevor die Retries deiner Connector aufgeben.

## Ein durchgespielter Poll

```bash
curl -sS https://your-host.example.com/status.json
# → { "status": "operational", ... }
```

Polle sie aus deinem Monitor im selben Takt wie alles andere; sie kostet kein API-Budget und braucht keinen Schlüssel. Die HTML-Seite unter `/status` ist dasselbe Urteil für einen Menschen. `GET /api/health` ist der billigere Liveness-Probe, den der Container-Healthcheck nutzt — `{"status":"ok","version":"<build>"}`, ohne Anmeldung — und der richtige, wenn du nur wissen willst, ob der Prozess antwortet.

## Was das Urteil abdeckt

Die Zusammenfassung meldet die Verfügbarkeit des Deployments selbst: ob das Backend antwortet und ob die Datenspeicher antworten, von denen es abhängt. Die Gesundheit der Modellanbieter, die eine Organisation verbunden hat, meldet sie nicht — ein Anbieter-Ausfall zeigt sich am Turn, der ihn gebraucht hätte, als der `errorCode`, den die [API-Referenz](/de/develop/api-reference) beschreibt.

## Tieferes Signal

Für Betriebsdetails — Container-Gesundheit von `tale status`, Anfrage-Metriken aus den Caddy-Logs und Control-Plane-Events im In-Product-Audit-Log — bildet die [Observability-Troubleshooting-Seite](/de/self-hosted/operate/observability/troubleshooting) Symptome auf Logs ab.

## Tale Cloud

Tale-Cloud-Deployments liefern dasselbe `/status` und `/status.json` auf ihrem eigenen Host. Einen separaten öffentlichen Status-Host gibt es derzeit nicht; sobald es einen gibt, nennt diese Seite ihn und seinen Abo-Feed.

## Wo das hingehört

Die Status-Page ist der operative Kanal; [Vertrauen und Compliance](/de/cloud/trust-and-compliance) ist der Audit-Kanal. Wenn du das hier liest, weil gerade etwas in deiner Connector scheitert, listet die [API-Referenz](/de/develop/api-reference) die Error-Codes, auf die du verzweigen solltest, und [Rate-Limits](/de/develop/rate-limits) erklärt die 429, die kein Ausfall ist.
