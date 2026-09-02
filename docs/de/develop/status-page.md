---
title: Status-Page
description: Tales öffentliche Status-Page — was sie abdeckt, wie Incidents pro Service skopiert sind, wo der RSS-Feed lebt und worin sie sich von deinen Self-hosted-Metriken unterscheidet.
---

Die Status-Page ist die kanonische Aufzeichnung der Verfügbarkeit von Tale Cloud. Jeder rotierbare Service hat seine eigene Status-Zeile, die Incident-Historie wird für den Audit-Pfad geführt, und die Seite ist der Kanal, den Tale während eines Incidents nutzt — bevor E-Mails rausgehen, bevor Support-Tickets beantwortet sind, wird die Seite aktualisiert.

Lies das, wenn etwas sich seltsam verhält und du wissen willst, ob es nicht nur dich trifft. Abonnier den Feed, wenn du auf deiner Seite für die Connector verantwortlich bist — die Seite sagt dir, welcher Service degradiert ist, damit du den Alarm zum richtigen Team routen kannst, ohne die falsche Bereitschaft zu wecken.

## Ein durchgespieltes Abonnement

Die Status-Page liegt unter `https://status.tale.dev`. Abonnieren ist eine URL:

```bash
curl -sS https://status.tale.dev/history.rss
```

Der RSS-Feed trägt jeden Status-Wechsel — offen, Update, gelöst — für jeden Service. E-Mail-Abonnement ist dasselbe Ein-Klick-Formular auf der Seite; der E-Mail-Kanal liefert dieselben Events mit fünf Minuten Debounce.

## Umfang pro Service

| Service    | Was er abdeckt                                                                          | Wann er rot wird                                            |
| ---------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `platform` | Der TanStack-Start-UI-Server und das Node-Backend dahinter — Agents, Workflows, Connectors, UI. | UI nicht erreichbar; API gibt 5xx; Auth defekt.             |
| `rag`      | Der Python-FastAPI-Dokumentdienst — Indexierung, Retrieval.                             | Dokument-Uploads stocken; Retrieval ist leer.               |
| `crawler`  | Der Crawl4AI-Web-Extraktionsdienst — verwendet von Document-Ingest und Tavily-Fallback. | Web-gezogene Dokumente scheitern; Deep Research stockt.     |
| `proxy`    | Der Caddy-Edge — TLS-Terminierung, HTTP-Routing.                                        | Gesamter Tale-Cloud-Verkehr betroffen.                      |
| `db`       | Postgres — dauerhafter Anwendungszustand und die Job-Warteschlange.                     | Schreiben abgelehnt; die platform-Zeile wird ebenfalls rot. |

Jede Zeile trägt die letzten 90 Tage Uptime als Sparkline. Ein Incident liest sich als farbiges Band auf der Zeile; ein Klick aufs Band öffnet den Verlauf — erstes Update, Folge-Updates, Auflösung, Post-Mortem, wenn eines ansteht.

## Incident-Historie

Die Historie wird unbefristet aufbewahrt. Jeder Incident hält die betroffenen Services fest, die Kundenwirkungs-Aussage, den Verlauf und das Post-Mortem, wenn der Incident die Schwere-Schwelle reisst, die eines verlangt. Die Schwelle steht auf der Seite selbst; die Faustregel ist alles mit Cross-Org-Kundenwirkung und einer Dauer über 30 Minuten.

Die Seite gehört der Bereitschafts-Rotation. Updates werden vom Engineer geschoben, der die Seite hält, nicht von einem automatisierten System — die Wahl ist bewusst, weil die Seite auch das Dokument ist, das nach dem Vorfall zu Kunden und Auditoren geht.

## Self-hosted: was sich ändert

Selbst gehostete Instanzen erscheinen nicht auf `status.tale.dev` — die Seite deckt Tale Cloud ab. Jedes Deployment bringt stattdessen seine eigene Status-Page mit, von der Plattform ausgeliefert und ohne Anmeldung erreichbar unter `https://<dein-host>/status`. Sie rendert serverseitig eine Gesundheits-Zusammenfassung — operational, degraded oder outage — aus einem Liveness-Probe gegen die `/ping`-Route der Backend-Schicht, dieselbe Route, die auch der Healthcheck des `backend-api`-Containers nutzt. Ein Betreiber (oder ein Endnutzer, der prüft, ob es nur bei ihm hakt) liest die Verfügbarkeit damit ohne Login. Die maschinenlesbare Form ist `https://<dein-host>/status.json`, die dasselbe Ergebnis als JSON zurückgibt, das ein Uptime-Monitor pollen kann.

Der Probe meldet genau eine Komponente, `backend`, denn diese Schicht bedient jede Anfrage der App: Antwortet sie, fließen Daten. Die Liveness des Plattform-Containers steckt implizit drin — sonst hätte die Status-Page nicht gerendert. Ergebnisse sind fünf Sekunden gecacht und jeder Probe läuft nach zwei Sekunden ab, ein Uptime-Monitor auf `/status.json` kostet das Backend also selbst im kurzen Intervall fast nichts.

Diese Seite meldet die Verfügbarkeit des Deployments selbst. Für tieferes Betriebssignal — Container-Gesundheit von `tale status`, Anfrage-Metriken aus den Caddy-Logs und Control-Plane-Events im In-Product-Audit-Log — bildet die [Observability-Troubleshooting-Seite](/de/self-hosted/operate/observability/troubleshooting) Symptome auf Logs ab.

## Wo das hingehört

Die Status-Page ist der operative Kanal; [Vertrauen und Compliance](/de/cloud/trust-and-compliance) ist der Audit-Kanal und listet die Seite als Beleg für die Infrastruktur-Verfügbarkeits-Kontrolle. Wenn du Tale in eine Pipeline verdrahtest und die Connector auf einen Tale-Ausfall reagieren soll, ist der RSS-Feed der Eingang; wenn du das hier liest, weil gerade etwas in deiner Connector scheitert, listet die [API-Referenz](/de/develop/api-reference) die Error-Codes, auf die du verzweigen solltest.
