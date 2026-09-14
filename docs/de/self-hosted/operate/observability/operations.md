---
title: Betrieb überwachen und Störungen bearbeiten
description: Wähle aussagekräftige Signale, ordne Metriken richtig ein und untersuche Störungen, ohne wichtige Hinweise zu verlieren.
---

Überwache die Aufgaben, die Nutzer abschließen müssen, ebenso wie die darunterliegenden Dienste. Eine erfolgreiche HTTP-Prüfung beweist nicht, dass Anmeldung, Dateidownload, Wissenssuche oder Automatisierung funktionieren. Lege die Dringlichkeit anhand der Auswirkungen auf deine Instanz fest und gib jedem Alarm einen Verantwortlichen und ein Wiederherstellungsverfahren.

[Observability konfigurieren](/de/self-hosted/configuration/observability-config) erklärt Endpunkte und Zugriffstoken. [Prometheus und Grafana](/de/self-hosted/operate/observability/prometheus-grafana) zeigt ein Beispiel für die Erfassung.

## Signale mit einer sinnvollen Reaktion wählen

| Signal | Untersuchung | Wann eskalieren? |
| --- | --- | --- |
| Öffentliche URL, Zertifikat oder Anmeldung schlägt fehl | Prüfe den öffentlichen Zugang von außerhalb des Hosts, danach Proxy- und Backend-Protokolle. | Nutzer erreichen einen benötigten Dienst nicht oder ein Zertifikat läuft ohne funktionierende Erneuerung bald ab. |
| Mehr 5xx-Antworten im Backend | Vergleiche `tale_backend_http_requests_total` nach `route` und `status` mit der betroffenen Aktion. | Fehler betreffen aktive Nutzer oder wichtige Integrationen. |
| Ein Speicher ist nicht erreichbar | Prüfe `tale_backend_store_up` und die Überwachung des Speichers selbst. | Benötigte Daten, Suche oder Dateizugriffe sind blockiert. |
| Wartende oder fehlgeschlagene Jobs häufen sich | Prüfe `tale_backend_jobs{state=...}`, Worker und beispielhafte Lauf-Fehler. | Der Rückstand baut sich nicht ab oder eine Frist ist gefährdet. |
| Speicherplatz oder freie Verbindungen werden knapp | Nutze Host- und Datenbanküberwachung; Tale liefert nicht alle diese Metriken. | Handle mit genug Vorlauf, um Kapazität zu schaffen oder die Ursache zu beseitigen. |
| Eine geplante Sicherung oder Kopie fehlt | Prüfe Backup-Job, vollständiges Manifest und externes Ziel. | Der maximal zulässige Datenverlust wird überschritten. |
| Anbieter drosselt oder verweigert Anfragen | Lies Anbieterantwort und Lauf-Fehler; prüfe Kontingent, Zugangsdaten und Anbieterstatus. | Benötigte Arbeit scheitert oder wartet länger als erlaubt. |

Ein Alarm bei 80 % Plattenbelegung kann ein Ausgangspunkt sein. Wachstumsrate und benötigte Reaktionszeit sind jedoch aussagekräftiger als ein pauschaler Prozentwert. Eine Störung der Wissenssuche kann für ein Team kritisch sein. Verschiebe sie nicht automatisch, nur weil die Oberfläche noch lädt.

## Den passenden Prüfendpunkt wählen

Verwende diese Pfade auf der öffentlichen Origin einer Produktionsinstallation hinter dem mitgelieferten Proxy:

| Pfad | Was eine erfolgreiche Antwort belegt |
| --- | --- |
| `/health` | Caddy antwortet mit `OK`. Der Endpunkt bleibt beim Neustart der Plattform erreichbar. |
| `/api/health` | Der Webprozess der Plattform beantwortet seine Lebenszeichenprüfung. |
| `/status.json` | Der öffentliche Abhängigkeitsbericht ist abrufbar. Prüfe die Bewertung der einzelnen Komponenten; Ergebnisse werden fünf Sekunden zwischengespeichert. |
| `/status` | Derselbe Verfügbarkeitsbericht als lesbare Webseite. |

Prüfe neben dem HTTP-Status den erwarteten Antwortinhalt. Ein unbekannter Frontend-Pfad wie `/healthz` kann die App-Hülle mit `200` zurückgeben; das ist kein Zustandsbericht. [Statusseite](/de/develop/status-page) beschreibt das Antwortformat.

## Aussagekraft der Metriken verstehen

Das Backend liefert Prozessmetriken, Anzahl und Dauer von HTTP-Antworten, Job-Zähler, laufende Generierungen, offene Hinweis-Streams, den Drain-Zustand und die Speichererreichbarkeit. Prüfe die tatsächlich ausgegebenen Zeitreihen deiner Version, bevor du Alarme darauf aufbaust.

- `tale_backend_store_up` prüft die **Bereitstellungsstandards** für Anwendungsdatenbank, Wissensdatenbank und Bucket. Organisationsspezifische Verbindungen brauchen eine eigene Überwachung.
- Speicherprüfungen werden 30 Sekunden zwischengespeichert. Eine Bucket-Antwort `403` gilt als erreichbar, weil dem Schlüssel lediglich das Auflisten fehlen kann. Der Wert `1` beweist nicht, dass sich ein bestimmtes Objekt hoch- oder herunterladen lässt.
- `/ready` beschreibt die Bereitschaft für einen Rollout. Externe Speicher fließen nicht ein; ein bereites Replikat kann daher von einem ausgefallenen Speicher abhängen.
- Die öffentliche Backend-Metrik-URL kann verschiedene API-Replikate erreichen. Prozessmetriken beschreiben das antwortende Replikat. Job- und Generierungszähler lesen gemeinsamen Datenbankzustand. Addiere diese gemeinsamen Zähler nicht so, als hätte jedes Replikat eine eigene Warteschlange.

Prüfe die Lücken mit einem kontrollierten Ablauf: Melde dich mit einem Überwachungskonto an, lies einen bekannten Datensatz und teste die benötigte Datei- oder Wissensfunktion. Nutze dafür einen eigenen Bereich und vermeide Versandaktionen oder andere externe Änderungen.

## Latenzziele von Messwerten trennen

Tale stellt `tale_sla_target_seconds` und eine Regelvorlage unter `/metrics/sla-rules` bereit. Die aktuellen Ziele sind im Mittel 1 Sekunde bis zum ersten Token über 30 Minuten sowie 40 Sekunden für lange Operationen über 6 Stunden. Das sind Zielwerte, keine Messwerte und keine Zusage, dass deine Instanz sie erreicht.

Die erzeugten Regeln erwarten Histogramme namens `tale_dialog_ttft_seconds` und `tale_long_operation_seconds`. Das Backend liefert diese beiden Latenzreihen nicht automatisch. Sein HTTP-Histogramm misst die Anfragebearbeitung; das entspricht weder der Zeit bis zum ersten Token noch der vollständigen Dauer eingereihter Arbeit. Instrumentiere die tatsächlichen Start- und Endpunkte der Operation und prüfe vorhandene Messwerte, bevor du diese Regeln aktivierst. Eine leere Abfrage bedeutet fehlende Daten, keine bestandene Latenzprüfung.

## Vor Zustandsänderungen untersuchen

1. Halte betroffene Organisation, URL oder Aktion, Fehlercode, Zeitraum und Ausmaß fest. Prüfe, ob sich der Fehler ohne Datenänderung nachvollziehen lässt.
2. Lies `tale status` und `tale logs <service>`. Bei selbst verwalteten Bereitstellungen verwendest du den Compose-Dienstnamen mit `docker compose ps` und `docker compose logs --tail=200 <service>`.
3. Gleiche Netzwerkfehler im Browser mit API-/Worker-Protokollen und dem Speicher- oder Anbieterstatus ab. Sichere relevante Protokolle, bevor ein Neustart sie rotiert oder Zusammenhänge verdeckt.
4. Behebe die ermittelte Ursache: Kapazität, Verbindung, Konfiguration, Zugangsdaten oder Prozessausfall. Erstelle betroffene Container nach Änderungen an Umgebungswerten neu; `docker compose restart` behält deren bisherige Umgebung.
5. Prüfe nach der Wiederherstellung die ursprüngliche Aktion und zugehörige wartende Arbeit. Halte fest, welche unterbrochenen Anfragen oder Jobs ausdrücklich wiederholt werden müssen, und ergänze den Störungsverlauf.

Eskaliere, sobald dein Störungsprozess es verlangt. Ein Neustart kann laufende Arbeit unterbrechen. Er ist weder ein verpflichtender Diagnoseschritt noch ein Grund, die Eskalation aufzuschieben. [Fehlerbehebung](/de/self-hosted/operate/observability/troubleshooting) ordnet häufige Symptome gezielteren Prüfungen zu.
