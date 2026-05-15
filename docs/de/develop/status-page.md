---
title: Status-Seite
description: Die öffentliche /status-Oberfläche — was jeder Service meldet, was das Rollup bedeutet und wo es im Monitoring-Stack des Betreibers einsetzt.
---

Tale stellt einen öffentlichen `/status`-Endpoint auf jeder Instanz bereit. Er liefert ein kleines, deterministisches JSON-Dokument plus eine HTML-Darstellung, die den Zustand der Plattform-Services zusammenfasst: welche erreichbar sind, welche degradiert sind und welches Rollup-Urteil daraus folgt. Die Seite richtet sich an zwei Zielgruppen — die Betreiberin, die die Instanz fährt und eine einzelne URL prüfen will, bevor sie einen Incident meldet, und den externen Integrator, der einen Monitoring-Agenten gegen die öffentlichen Oberflächen von Tale fährt.

Diese Seite deckt den Vertrag ab: was auf der Seite steht, wie das JSON aussieht, was du scrapen kannst und was `/status` **nicht** verrät (dafür gibt es Observability-Tools wie Prometheus und Sentry).

## Was auf der Seite steht

Die Seite zeigt oben ein Rollup-Urteil — **Alle Systeme laufen** wenn jeder abhängige Service gesund antwortet, **Teilausfall** wenn mindestens ein Service degradiert antwortet, **Grosser Ausfall** wenn mindestens ein Service ungesund antwortet. Unter dem Rollup listet eine Pro-Service-Aufschlüsselung jeden Service der Plattform mit seinem aktuellen Zustand, dem Zeitstempel der letzten Prüfung und (in der Cloud) einer kleinen Historie kürzlicher Incidents.

Das Urteil wird serverseitig alle 30 Sekunden aktualisiert; die Seite pollt und rendert neu, sodass ein lange offener Tab aktuell bleibt, ohne manuell zu aktualisieren.

## JSON-Form

Derselbe Inhalt ist als maschinenlesbares JSON unter `/status.json` verfügbar — nützlich für eine Uptime-Probe oder einen Status-Dashboard-Aggregator. Die Form:

```json
{
  "rollup": "operational",
  "services": [
    {
      "name": "platform",
      "status": "healthy",
      "lastCheckedAt": "2026-04-19T08:30:00Z"
    },
    {
      "name": "rag",
      "status": "healthy",
      "lastCheckedAt": "2026-04-19T08:30:00Z"
    },
    {
      "name": "crawler",
      "status": "degraded",
      "lastCheckedAt": "2026-04-19T08:30:00Z"
    }
  ]
}
```

`rollup` ist einer von `operational`, `partial_outage`, `major_outage`. Der `status` jedes Service-Eintrags ist einer von `healthy`, `degraded`, `unhealthy`. Die Form ist über Versionen stabil; neue Felder können hinzukommen, bestehende werden weder umbenannt noch entfernt.

## Was du scrapen kannst

Für eine Dritt-Monitoring-Probe GET `/status.json` im Intervall, das zum Alert-Fenster passt (1–5 Minuten sind typisch). Die Antwort ist klein (~500 Byte) und der Endpoint ist nicht authentifiziert; er ist bewusst nicht hinter Sign-In gesperrt, damit externe Monitore ihn erreichen.

Für interne Alarme, die tiefer als das Rollup gehen, scrape stattdessen die Prometheus-Endpoints, die unter [Operations](/de/self-hosted/operate/observability/operations) dokumentiert sind — `/status` ist eine grobe Oberfläche für „ist die Plattform erreichbar", keine Metrik-Ebene-Gesundheitsansicht.

## Was nicht auf der Seite steht

`/status` meldet keine Pro-Anfrage-Fehlerraten, keine KI-Anbieter-Verfügbarkeit und keine Queue-Tiefe. Es zeigt auch keine internen Services — Datenbank, Proxy, Hintergrund-Worker — weil deren Fehlermodi ohnehin durch einen der nutzerseitigen Services laufen. Für Pro-Anfrage-Fehlerraten nutze den Sentry-Stack, dokumentiert unter [Operations](/de/self-hosted/operate/observability/operations); für KI-Anbieter-Verfügbarkeit ist die Status-Seite des Anbieters die massgebliche Quelle.

## Wo das einsetzt

Die Status-Seite ist die leichtgewichtigste Betreiber-Oberfläche — die URL, die jemand abruft, bevor er einen Incident meldet, der Endpoint, den ein Dritt-Monitor pollt. Für Tag-zu-Tag-Observability auf einer selbst gehosteten Instanz deckt [Operations](/de/self-hosted/operate/observability/operations) ab, was du scrapen und alerten musst; für die In-App-Kommunikation nach einem Upgrade ist [Was ist neu](/de/platform/admin/changelog) der Changelog-Dialog.
