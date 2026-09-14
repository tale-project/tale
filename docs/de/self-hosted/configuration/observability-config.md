---
title: Überwachung einrichten
description: Containerprotokolle lesen, geschützte Messwerte erfassen und das Ziel für Fehlerberichte festlegen.
---
Beginne mit den Containerprotokollen und dem Zustand der Dienste. Ergänze Prometheus-Messwerte für Trends und Alarme sowie eine Fehlererfassung, wenn du vergangene Fehler durchsuchen möchtest. Tale übermittelt diese Daten nur dann an einen externen Überwachungsdienst, wenn du einen einrichtest.

## Anwendungsprotokolle lesen

Container schreiben auf stdout und stderr. Die mitgelieferte Compose-Konfiguration nutzt Dockers Protokolltreiber `json-file`: maximal 10 MB pro Datei und drei Dateien pro Container. Verwende die Dienstnamen aus der Compose-Datei deiner Installation:

```bash
docker compose logs --tail=100 backend-api backend-worker
docker compose logs -f backend-api
```

Mit `Ctrl-C` beendest du die laufende Anzeige; die Container laufen weiter. Suche für Anfragen, Anmeldung und interaktive Chat-Antworten in `backend-api`; für Hintergrundaufgaben, eingereihte Agent-Aufrufe und Dokumentverarbeitung in `backend-worker`. `docker compose ps` zeigt dir Container, die wiederholt neu starten.

`journalctl -u docker` zeigt das Journal des Docker-Daemons. Beim Standardtreiber `json-file` ersetzt es die Containerprotokolle nicht. Für journald oder eine zentrale Protokollsammlung musst du den Docker-Protokolltreiber und die Sammlung gesondert einrichten. Tale liefert keinen Dienst zur Protokollweiterleitung mit. Nach einem Treiberwechsel musst du die betroffenen Container neu erstellen.

## Geschützte Messwerte aktivieren {#metriken}

Setze einen starken `METRICS_BEARER_TOKEN` in der Bereitstellungsumgebung. Übernimm die Änderung über deinen Bereitstellungsablauf, sodass die betroffenen Dienste neu erstellt werden. Ein einfacher Containerneustart lädt die Compose-Umgebungswerte nicht neu. Hinterlege denselben Token in der Geheimnisverwaltung deines Überwachungssystems.

Der Proxy verlangt für diese Routen `Authorization: Bearer <token>`. Ohne konfigurierten Token antworten sie mit **401**.

| Route | Inhalt | Verwendung |
| --- | --- | --- |
| `/metrics/platform` | Prozessmesswerte der Webanwendung und Zielwerte für Antwortzeiten | Prometheus-Abfrageziel |
| `/metrics/backend` | HTTP- und Prozessmesswerte des Backends, Warteschlangen, aktive Generierungen und Entleerungsstatus | Prometheus-Abfrageziel |
| `/metrics/sla-rules` | Generierte Aufzeichnungs- und Alarmregeln als YAML | Als Prometheus-Regeldatei laden |

Das Backend beantwortet Wissensanfragen und verarbeitet Dokumente. HTTP- und Warteschlangenmesswerte helfen, Fehler und Rückstau zu erkennen; sie messen nicht gesondert die Dauer der Suche oder Antwortgenerierung. `BACKEND_UPSTREAM` legt bei einer getrennten Bereitstellung das Backend-Ziel fest. Es entsteht dadurch kein eigener Metrikdienst für die Wissensverarbeitung.

Richte pro Metrikroute einen eigenen Abfrageauftrag ein. Im Beispiel ist `/run/secrets/tale_metrics_token` eine Datei im Prometheus-Container, die ausschließlich den Token enthält. Erstelle sie über deine Geheimnisverwaltung und erlaube Prometheus den Lesezugriff.

```yaml
scrape_configs:
  - job_name: tale-platform
    scheme: https
    metrics_path: /metrics/platform
    authorization:
      credentials_file: /run/secrets/tale_metrics_token
    static_configs:
      - targets: ['tale.example.com']
  - job_name: tale-backend
    scheme: https
    metrics_path: /metrics/backend
    authorization:
      credentials_file: /run/secrets/tale_metrics_token
    static_configs:
      - targets: ['tale.example.com']
```

Frage `/metrics/sla-rules` nicht als Metriken ab. Die generierten Regeln verweisen auf Zeitreihen, die zusätzliche Instrumentierung benötigen. Allein das Laden der Datei weist die Einhaltung der Antwortzeitziele nicht nach. Prüfe die Regeln, bevor du sie über die Regelkonfiguration von Prometheus lädst. Die vollständige Einrichtung beschreibt [Prometheus und Grafana](/de/self-hosted/operate/observability/prometheus-grafana).

## Ziel für Fehlerberichte wählen

`SENTRY_DSN` aktiviert die optionale Fehlererfassung. Du kannst Sentry oder einen kompatiblen Dienst wie GlitchTip oder Bugsink verwenden. Browser und Backend nutzen denselben DSN; Backend-Ereignisse enthalten Prozessrolle und Versionsnummer.

```bash
SENTRY_DSN=https://your-key@your-sentry-host/project-id
SENTRY_TRACES_SAMPLE_RATE=0.1
```

Die Abtastrate gilt für Leistungstraces im Browser. Das Backend sendet Fehlerberichte, keine Leistungstraces. In der Entwicklung beträgt die Standardrate für Browsertraces 1.0. Wähle für den Produktivbetrieb einen Wert passend zu deinem Überwachungsbudget. Stackframes werden ohne Schwärzung übertragen; berücksichtige bei der Zielwahl deine Vorgaben zur Datenverarbeitung.

## Aggregierte Nutzungsstatistik mit Umami

Die Erfassung ist standardmäßig ausgeschaltet. Du aktivierst sie für jedes Deployment getrennt mit `UMAMI_URL`, `UMAMI_WEBSITE_ID` und `UMAMI_PROXY_TOKEN`; die [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference) beschreibt die Werte. Verwende je Deployment eine eigene Website-ID. Erstelle den betroffenen Produktionsdienst mit den neuen Umgebungswerten neu; ein neues Image ist nicht nötig. Leere zum Abschalten die Website-ID und wende die Änderung genauso an. Der Vite-Entwicklungsserver stellt diese Konfiguration nicht bereit.

Der Browser lädt den Umami-Tracker von seiner eigenen Origin unter `/_a/script.js` und sendet ausgewählte Ereignisse an `/_a/api/send`. Ein konfigurierter Basispfad steht vor diesen URLs. Nur Website-ID und Proxy-Pfad gelangen in die Browserkonfiguration; Origin und Bearer-Token der Erfassung bleiben auf dem Server.

`UMAMI_URL` muss auf ein Gateway zeigen, das `GET /_collect/script.js` und `POST /_collect/api/send` mit diesem Bearer-Token authentifiziert. Die URL eines normalen Umami-Dashboards allein erfüllt diese Anforderungen nicht. Caddy muss `X-Analytics-Client-IP` aus einer vertrauenswürdigen Client-Adresse neu setzen. Halte die Anwendungsports privat und konfiguriere vertrauenswürdige Proxy-Netze, wenn ein weiterer Proxy vorgeschaltet ist. Der Server leitet die geprüfte IP-Adresse, den User-Agent des Browsers und die nötigen Umami-Header weiter; Browser-Cookies, Zugangsdaten und Referrer-Header entfernt er.

Die Berichte enthalten bekannte öffentliche Seitenpfade oder private Routenvorlagen der Plattform, Referrer-Origins, Browsersprache, Bildschirmgröße, Browser, Betriebssystem, Gerät und ungefähren Standort. Die Erfassung leitet Besuche und Standort aus der IP-Adresse ab, ohne die ursprüngliche Adresse zu speichern. Platzhalter ersetzen private Organisations- und Ressourcen-IDs. Seitentitel, Suchparameter, Fragmente, Formularfelder und Produktinhalte sind ausgeschlossen. Die Marketing-Seite zählt zusätzlich abgeschlossene Kontakt- und Demo-Anfragen ohne deren Inhalt. Es gibt keine websiteübergreifende Identität, automatische Klickerfassung oder Sitzungsaufzeichnung. Do Not Track und Global Privacy Control deaktivieren die Erfassung.

Prüfe nach dem Rollout das Verhalten mit einem Browser, der die Erfassung zulässt:

1. Öffne eine bekannte Seite, wechsle zu einer anderen und prüfe beide Seitenaufrufe in der Umami-Website des Deployments.
2. Prüfe den Anfrageinhalt. Private Routen enthalten Platzhalter, aber keine Suchparameter, Titel oder Formulardaten.
3. Aktiviere Do Not Track oder Global Privacy Control und prüfe, dass die Erfassung stoppt.
4. Blockiere die Erfassung oder teste einen Ausfall. Die normale Navigation muss weiter funktionieren.

## Grenzen kennen

Tale exportiert derzeit keine OpenTelemetry-Traces über OTLP. Ein OpenTelemetry Collector kann die Prometheus-Messwerte erfassen. Aus dem Abfragen von Messwerten entstehen aber keine verteilten Traces. Dafür braucht die Anwendung zusätzlich eine entsprechende Instrumentierung.

Alarmgrenzen und Reaktionsabläufe findest du unter [Betrieb](/de/self-hosted/operate/observability/operations). Bei einem ausgefallenen Dienst helfen die Symptomtabellen der [Fehlersuche](/de/self-hosted/operate/observability/troubleshooting).
