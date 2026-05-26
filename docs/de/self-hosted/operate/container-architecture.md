---
title: Container-Architektur
description: Welcher Container welchen Job in einer laufenden Tale-Instanz hat, der Request-Pfad einer Chat-Nachricht und wie ein Ausfall jedes Containers aussieht.
---

Eine Tale-Instanz besteht aus acht Containern, verdrahtet durch docker compose. Die Architektur-Seite hat behandelt, wofür jeder Container da ist; diese Seite ist die Operator-Version — welcher Container welchen Job besitzt, wie eine Chat-Nachricht durch sie fliesst und wie der Fehlermodus aussieht, wenn einer von ihnen stirbt.

Lies das, wenn du Bereitschaft hast. Komm zurück, wenn du entscheidest, welchen Container du während eines Upgrades zuerst rollst.

## Die acht Container, mit ihren Jobs

| Container             | Job                                           | Ausfälle betreffen                               |
| --------------------- | --------------------------------------------- | ------------------------------------------------ |
| `tale-proxy`          | TLS-Terminierung + Edge-Routing               | Jeden Ingress — kein Client erreicht die UI      |
| `tale-platform`       | UI-Server, statische Asset-Auslieferung       | Browser sieht 502; die API ist erreichbar        |
| `tale-convex`         | Backend Actions/Queries/Mutations + WebSocket | UI lädt, aber ohne Daten; laufende Chats stocken |
| `tale-db`             | Postgres für Convex                           | Convex fällt in Read-only; Writes blockieren     |
| `tale-rag`            | Dokument-Indexierung + Vektor-Retrieval       | Uploads stauen; Agents verlieren RAG-Ergebnisse  |
| `tale-crawler`        | Website-Entitäts-Abruf                        | Crawl-Plan pausiert; bestehender Inhalt bleibt   |
| `tale-sandbox-egress` | Netzwerk-Egress für sandboxierten Code        | **Code-ausführen** scheitert mit „Egress denied" |
| `tale-sandbox`        | Sandbox-Laufzeit                              | **Code-ausführen** scheitert; Fähigkeits-Skripte |

Zwei Container sind dem öffentlichen Netz exponiert (`tale-proxy` für HTTPS, optional `tale-sandbox-egress` ausgehend für die Sandbox); sechs nur intern.

## Der Request-Pfad

Eine Chat-Nachricht macht einen Durchlauf durch fünf der Container:

1. Browser → `tale-proxy` (TLS terminiert).
2. `tale-proxy` → `tale-platform` für HTML/JS, → `tale-convex` für API + WebSocket.
3. `tale-convex` liest die Provider-Config der Organisation, wählt das Modell, öffnet einen Stream zum Upstream-Provider.
4. Holt der Agent Wissen: `tale-convex` → `tale-rag` für Vektor-Suche.
5. Führt der Agent Code aus: `tale-convex` → `tale-sandbox` → `tale-sandbox-egress` für ausgehende Netzwerk-Aufrufe.
6. Der Provider-Stream gibt Tokens durch `tale-convex` zurück an den Browser über den WebSocket.

Der heisse Pfad ist kurz. Fühlt sich die Chat-Latenz falsch an, ist der Container, der schuld ist, fast immer der Upstream-Provider, nicht Tale; die Metric-Endpoints auf `tale-convex` und `tale-rag` zeigen die Zeit in jedem Sprung.

## Die Sandbox-Ebene

Sandboxierte Code-Ausführung läuft in `tale-sandbox`, mit `tale-sandbox-egress` als der einzigen Netzwerk-Naht. Die Zwei-Container-Trennung ist Absicht: `tale-sandbox` selbst hat kein ausgehendes Netz; jeder Request, den der sandboxierte Code macht, geht durch `tale-sandbox-egress`, der die Allowlist der [Run-Code-Richtlinie](/de/platform/admin/governance/run-code-policy) anwendet, bevor er ihn durchlässt. Ist der Egress-Container down, scheitert sandboxierter Code, der das Netz braucht, geschlossen mit „Egress denied" — nicht stiller Timeout.

Die Sandbox ist der einzige Container, der nicht-vertrauenswürdigen Code läuft (User-gelieferte Fähigkeits-Skripte, Agent **Code-ausführen**-Aufrufe). Der Rest des Stacks läuft den eigenen Code der Plattform.

## Fehler-Modi — wie der Ausfall jedes Containers aussieht

**`tale-proxy` down.** TLS-Handshake scheitert; jeder Client sieht einen Verbindungsfehler. Im Host sind die Plattform- und Convex-Container weiter up — starte Proxy zuerst neu.

**`tale-platform` down.** Browser bekommt 502 vom Proxy; die API arbeitet weiter. Bestehende Browser-Tabs mit gecachten Assets sprechen weiter mit Convex über den WebSocket und merken es vielleicht erst beim Reload.

**`tale-convex` down.** Browser lädt die UI-Shell, aber nichts wird befüllt. WebSocket-Reconnect schleift. Convex neu zu starten ist sicher — Sessions sind serverseitig; Clients reabonnieren beim Reconnect.

**`tale-db` down.** Convex tritt in seinen degradierten Modus: Reads aus dem Cache, Writes werden gepuffert. Lange Ausfälle zeigen sich irgendwann als „Speichern fehlgeschlagen"-Toasts.

**`tale-rag` down.** Uploads bleiben im „Indexiert"-Zustand; Agents, die Wissen abrufen wollen, bekommen eine leere Ergebnismenge und eine Warnung im Ausführungs-Log. Rag neu zu starten entleert die Queue.

**`tale-crawler` down.** Website-Entitäts-Aktualisierung stoppt. Bestehender gecrawlter Inhalt bleibt verfügbar. Keine nutzersichtbare Auswirkung für Stunden; der Plan des Crawlers absorbiert kurze Ausfälle.

**Sandbox-Container down.** **Code-ausführen**-Tool-Aufrufe geben einen Fehler zurück; Fähigkeits-Skripte scheitern. Agents, die keines von beiden nutzen, arbeiten weiter.

## Wo das hingehört

Diese Seite ist die Karte des Operators; die [Architektur-Übersicht](/de/self-hosted/overview) ist die Einführung ins selbe Bild, die [Troubleshooting-Seite](/de/self-hosted/operate/observability/troubleshooting) ist der symptomorientierte Index, wenn etwas schiefgegangen ist. Wenn du Alert-Schwellen setzt, benennt [Operations](/de/self-hosted/operate/observability/operations) die Signale, die sich zu verdrahten lohnen.
