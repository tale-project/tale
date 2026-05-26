---
title: Status-Page
description: Tales öffentliche Status-Page — was sie abdeckt, wie Incidents pro Service skopiert sind, wo der RSS-Feed lebt und worin sie sich von deinen Self-hosted-Metriken unterscheidet.
---

Die Status-Page ist die kanonische Aufzeichnung der Verfügbarkeit von Tale Cloud. Jeder rotierbare Service hat seine eigene Status-Zeile, die Incident-Historie wird für den Audit-Pfad geführt, und die Seite ist der Kanal, den Tale während eines Incidents nutzt — bevor E-Mails rausgehen, bevor Support-Tickets beantwortet sind, wird die Seite aktualisiert.

Lies das, wenn etwas sich seltsam verhält und du wissen willst, ob es nicht nur dich trifft. Abonnier den Feed, wenn du auf deiner Seite für die Integration verantwortlich bist — die Seite sagt dir, welcher Service degradiert ist, damit du den Alarm zum richtigen Team routen kannst, ohne die falsche Bereitschaft zu wecken.

## Ein durchgespieltes Abonnement

Die Status-Page liegt unter `https://status.tale.dev`. Abonnieren ist eine URL:

```bash
curl -sS https://status.tale.dev/history.rss
```

Der RSS-Feed trägt jeden Status-Wechsel — offen, Update, gelöst — für jeden Service. E-Mail-Abonnement ist dasselbe Ein-Klick-Formular auf der Seite; der E-Mail-Kanal liefert dieselben Events mit fünf Minuten Debounce.

## Umfang pro Service

| Service    | Was er abdeckt                                                                          | Wann er rot wird                                            |
| ---------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `platform` | Die TanStack-Start-+-Convex-Anwendung — Agents, Workflows, Integrations, UI.            | UI nicht erreichbar; API gibt 5xx; Auth defekt.             |
| `rag`      | Der Python-FastAPI-Dokumentdienst — Indexierung, Retrieval.                             | Dokument-Uploads stocken; Retrieval ist leer.               |
| `crawler`  | Der Crawl4AI-Web-Extraktionsdienst — verwendet von Document-Ingest und Tavily-Fallback. | Web-gezogene Dokumente scheitern; Deep Research stockt.     |
| `proxy`    | Der Caddy-Edge — TLS-Terminierung, HTTP-Routing.                                        | Gesamter Tale-Cloud-Verkehr betroffen.                      |
| `db`       | TimescaleDB — dauerhafter Zustand für die Convex-Schicht und Plattform-Metadaten.       | Schreiben abgelehnt; die platform-Zeile wird ebenfalls rot. |

Jede Zeile trägt die letzten 90 Tage Uptime als Sparkline. Ein Incident liest sich als farbiges Band auf der Zeile; ein Klick aufs Band öffnet den Verlauf — erstes Update, Folge-Updates, Auflösung, Post-Mortem, wenn eines ansteht.

## Incident-Historie

Die Historie wird unbefristet aufbewahrt. Jeder Incident hält die betroffenen Services fest, die Kundenwirkungs-Aussage, den Verlauf und das Post-Mortem, wenn der Incident die Schwere-Schwelle reisst, die eines verlangt. Die Schwelle steht auf der Seite selbst; die Faustregel ist alles mit Cross-Org-Kundenwirkung und einer Dauer über 30 Minuten.

Die Seite gehört der Bereitschafts-Rotation. Updates werden vom Engineer geschoben, der die Seite hält, nicht von einem automatisierten System — die Wahl ist bewusst, weil die Seite auch das Dokument ist, das nach dem Vorfall zu Kunden und Auditoren geht.

## Self-hosted: was sich ändert

Selbst gehostete Instanzen erscheinen nicht auf Tales Status-Page — die Seite deckt nur Tale Cloud ab. Für dein eigenes Deployment ist die Observability-Oberfläche im Produkt der richtige Kanal: Container-Gesundheit von `tale status`, Anfrage-Metriken aus den Caddy-Logs und das In-Product-Audit-Log für Control-Plane-Events. Die [Observability-Troubleshooting-Seite](/de/self-hosted/operate/observability/troubleshooting) bildet Symptome auf Logs ab.

Wenn du eine selbst gehostete Instanz betreibst und eine kundenseitige Status-Page willst, betreib eines der quelloffenen Status-Page-Projekte gegen deine eigenen Probes — Tale liefert heute keines für Self-hosted-Betreiber aus.

## Wo das hingehört

Die Status-Page ist der operative Kanal; [Vertrauen und Compliance](/de/cloud/trust-and-compliance) ist der Audit-Kanal und listet die Seite als Beleg für die Infrastruktur-Verfügbarkeits-Kontrolle. Wenn du Tale in eine Pipeline verdrahtest und die Integration auf einen Tale-Ausfall reagieren soll, ist der RSS-Feed der Eingang; wenn du das hier liest, weil gerade etwas in deiner Integration scheitert, listet die [API-Referenz](/de/develop/api-reference) die Error-Codes, auf die du verzweigen solltest.
