---
title: Erreichbarkeit der Instanz prüfen
description: Lies den öffentlichen Status, überwache die JSON-Antwort und unterscheide Ausfälle von fehlgeschlagenen Aktionen.
---
Öffne `/status` auf deinem Tale-Host, um die Erreichbarkeit ohne Anmeldung zu prüfen. Überwachungssysteme lesen dieselbe Übersicht unter `/status.json`. Sie umfasst Backend und Bereitstellungsspeicher, bestätigt aber nicht die Funktion jedes Modells oder jeder organisationsspezifischen Verbindung.

## Das Statusdokument abrufen

Setze `TALE_BASE_URL` auf die Instanz-URL und frage ihren Status ab:

```bash
curl --fail-with-body --silent --show-error \
  "$TALE_BASE_URL/status.json"
```

Prüfe den JSON-Inhalt, nicht nur den HTTP-Status. Bei der lokalen Prüfung mit nicht erreichbarem Objektspeicher lieferte der Endpunkt HTTP `200` und dieses eingeschränkte Ergebnis:

```json
{
  "status": "degraded",
  "checkedAt": "2026-09-14T04:31:20.847Z",
  "components": [
    { "id": "backend", "status": "operational" },
    { "id": "database", "status": "operational" },
    { "id": "object-store", "status": "outage" }
  ]
}
```

Hier beantwortet die App Anfragen und erreicht ihre Datenbank; Dateioperationen müssen aber untersucht werden. Eine Überwachung, die jedes HTTP `200` als gesund wertet, übersieht diesen Fehler.

## Komponenten einordnen

| Feld oder Komponente | Bedeutung |
| --- | --- |
| `status: operational` | Alle gemeldeten Komponenten sind erreichbar. |
| `status: degraded` | Einige Komponenten sind nicht erreichbar. |
| `status: outage` | Alle gemeldeten Komponenten sind nicht erreichbar. |
| `checkedAt` | Zeitpunkt der Statusprüfung in UTC. |
| `backend` | Erreichbarkeit des Anwendungsbackends. |
| `database` | Zusammengefasster Zustand von Anwendungs- und Bereitstellungs-Wissensdatenbank. |
| `object-store` | Zustand des Dateispeichers der Bereitstellung. |

Komponenten melden `operational` oder `outage`. Antwortet das Backend nicht, lässt sich der Zustand abhängiger Speicher nicht feststellen; auch sie erscheinen als nicht erreichbar. Dein Parser sollte neue Komponenten-IDs akzeptieren.

## Eine Überwachung einrichten

Der JSON-Endpunkt braucht keinen API-Schlüssel und verbraucht kein Schlüsselbudget. Sein Ergebnis bleibt fünf Sekunden zwischengespeichert. Speicherprüfungen im Backend werden separat aktualisiert; jede Abfrage startet deshalb nicht sofort einen neuen Speichertest. Setze eine Zeitüberschreitung und alarmiere nach deinem Betriebsbedarf bei wiederholten Fehlern oder einem eingeschränkten Zustand.

`/status.json` erlaubt ursprungsübergreifende Lesezugriffe mit `Access-Control-Allow-Origin: *`. `HEAD` liefert Kopfzeilen ohne Inhalt, `OPTIONS` nennt `GET, HEAD, OPTIONS`. Verwende `GET`, wenn die Überwachung die Komponenten auswerten soll.

## Prozessantwort und Funktionsbereitschaft unterscheiden

`/api/health` am produktiven Webserver ist eine kleine Prozessprüfung. Sie eignet sich für Container-Liveness, ersetzt aber nicht die Abhängigkeitsprüfungen des Statusdokuments. Ein Vite-Entwicklungsserver kann den Pfad anders weiterleiten und `404` liefern. Nutze dort `/status.json` für die laufende App.

Ein grüner Status prüft weder Guthaben noch Freischaltung oder Erreichbarkeit externer Modelle. Er führt auch keinen vollständigen Upload, keine Wissensabfrage, keinen Chat und keine Automation aus. Ergänze einen kontrollierten Ende-zu-Ende-Test für die Aktion, von der deine Integration abhängt.

## Einen Fehler untersuchen

Bei eingeschränkten Komponenten führt [Fehlerbehebung](/de/self-hosted/operate/observability/troubleshooting) zu den passenden Protokollen. Scheitert ein API-Aufruf bei gesundem Instanzstatus, prüfe den [API-Fehlercode](/de/develop/api-reference). `429` bezeichnet ein [Ratenlimit](/de/develop/rate-limits), keinen Instanzausfall.

Cloud-Instanzen bieten dieselben Statuspfade auf ihrem Host. Informationen zu Störungen und Nachweisen findest du unter [Vertrauen und Compliance](/de/cloud/trust-and-compliance).
