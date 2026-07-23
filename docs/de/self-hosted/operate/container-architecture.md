---
title: Container-Architektur
description: Welcher Container welchen Job in einer laufenden Tale-Instanz hat, der Request-Pfad einer Chat-Nachricht und wie ein Ausfall jedes Containers aussieht.
---

Eine Tale-Instanz besteht aus acht Containern, verdrahtet durch docker compose. Die Architektur-Seite hat behandelt, wofür jeder Container da ist; diese Seite ist die Operator-Version — welcher Container welchen Job besitzt, wie eine Chat-Nachricht durch sie fliesst und wie der Fehlermodus aussieht, wenn einer von ihnen stirbt.

Lies das, wenn du Bereitschaft hast. Komm zurück, wenn du entscheidest, welchen Container du während eines Upgrades zuerst rollst.

## Die acht Container, mit ihren Jobs

| Container                  | Job                                                                                          | Ausfälle betreffen                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `tale-proxy`               | TLS-Terminierung + Edge-Routing                                                              | Jeden Ingress — kein Client erreicht die UI                                 |
| `tale-platform`            | UI-Server, statische Asset-Auslieferung                                                      | Browser sieht 502; die API ist erreichbar                                   |
| `tale-convex`              | Backend Actions/Queries/Mutations + WebSocket, plus In-Process-RAG, Crawling und Dokumentgen | UI lädt, aber ohne Daten; laufende Chats stocken; Ingestion stockt          |
| `tale-db`                  | Operatives Postgres für Convex                                                               | Convex fällt in Read-only; Writes blockieren                                |
| `tale-knowledge-db`        | Postgres des Wissens-Korpus (Dokument-Chunks, Embeddings, gecrawlte Seiten)                  | Wissens-Suche liefert leer; Ingestion scheitert                             |
| `tale-sandbox-llm-gateway` | LLM-Gateway für Sandbox-Agents                                                               | Sandboxierte Agents erreichen kein Modell; Chat ist unbetroffen             |
| `tale-sandbox-egress`      | Netzwerk-Egress für sandboxierten Code                                                       | **Code-ausführen**-Tool scheitert mit „Egress denied"; Web-Render scheitert |
| `tale-sandbox`             | Sandbox-Laufzeit + Headless-Browser für Web-Render und Dokumentgenerierung                   | **Code-ausführen**, Web-Crawl-Render und Dokumentgenerierung scheitern alle |

Ein Container ist dem öffentlichen Netz exponiert (`tale-proxy` für HTTPS, optional `tale-sandbox-egress` ausgehend für die Sandbox); der Rest nur intern. Der Opt-in-Sidecar `tale-controller` (das `controller`-Profil) ist standardmäßig aus; aktiviert startet er `tale-convex` auf eine signierte Anfrage neu, damit eine Datenresidenz-Änderung greifen kann, ohne der Plattform Docker-Zugriff zu geben.

## Der Request-Pfad

Eine Chat-Nachricht macht einen Durchlauf durch die Container:

1. Browser → `tale-proxy` (TLS terminiert).
2. `tale-proxy` → `tale-platform` für HTML/JS, → `tale-convex` für API + WebSocket.
3. `tale-convex` liest die Provider-Config der Organisation, wählt das Modell, öffnet einen Stream zum Upstream-Provider.
4. Holt der Agent Wissen: `tale-convex` fährt die RAG-Suche im Prozess und fragt `tale-knowledge-db` direkt ab — kein separater Retrieval-Dienst im Pfad.
5. Führt der Agent Code aus: `tale-convex` → `tale-sandbox` → `tale-sandbox-egress` für ausgehende Netzwerk-Aufrufe.
6. Der Provider-Stream gibt Tokens durch `tale-convex` zurück an den Browser über den WebSocket.

Der heisse Pfad ist kurz. Fühlt sich die Chat-Latenz falsch an, ist der Container, der schuld ist, fast immer der Upstream-Provider, nicht Tale; die Metric-Endpoints auf `tale-convex` (das jetzt auch die RAG- und Crawl-Timings trägt) zeigen die Zeit in jedem Sprung.

## Die Sandbox-Ebene

Sandboxierte Code-Ausführung läuft in `tale-sandbox`, mit `tale-sandbox-egress` als der einzigen Netzwerk-Naht. Die Zwei-Container-Trennung ist Absicht: `tale-sandbox` selbst hat kein ausgehendes Netz; jeder Request, den der sandboxierte Code macht, geht durch `tale-sandbox-egress`, der Cloud-Metadaten und private Adressbereiche auf IP-Ebene blockiert und — wenn der Operator `SANDBOX_EGRESS_ALLOWLIST` setzt — zusätzlich eine Default-Deny-Hostname-Allowlist durchsetzt. Ist der Egress-Container down, scheitert sandboxierter Code, der das Netz braucht, geschlossen mit „Egress denied" — nicht stiller Timeout.

Die Sandbox-Laufzeit trägt Chromium und Playwright, also nutzt das Convex-Backend sie für die Headless-Arbeit, die es im Prozess nicht erledigen kann, erneut: das Rendern einer JavaScript-Seite während eines Web-Crawls und das Verwandeln von generiertem HTML in ein PDF oder Bild. Diese Jobs laufen als ephemere Sandbox-Ausführungen statt als User-Code, reiten aber dieselbe Egress- und Isolations-Naht. Die Sandbox ist der einzige Container, der eher-nicht-vertrauenswürdigen Code läuft (User-gelieferte Fähigkeits-Skripte, Agent-**Code-ausführen**-Aufrufe); der Rest des Stacks läuft den eigenen Code der Plattform.

## Fehler-Modi — wie der Ausfall jedes Containers aussieht

**`tale-proxy` down.** TLS-Handshake scheitert; jeder Client sieht einen Verbindungsfehler. Im Host sind die Plattform- und Convex-Container weiter up — starte Proxy zuerst neu.

**`tale-platform` down.** Browser bekommt 502 vom Proxy; die API arbeitet weiter. Bestehende Browser-Tabs mit gecachten Assets sprechen weiter mit Convex über den WebSocket und merken es vielleicht erst beim Reload.

**`tale-convex` down.** Browser lädt die UI-Shell, aber nichts wird befüllt. WebSocket-Reconnect schleift. Convex neu zu starten ist sicher — Sessions sind serverseitig; Clients reabonnieren beim Reconnect.

**`tale-db` down.** Convex tritt in seinen degradierten Modus: Reads aus dem Cache, Writes werden gepuffert. Lange Ausfälle zeigen sich irgendwann als „Speichern fehlgeschlagen"-Toasts.

**`tale-knowledge-db` down.** Dokument-Ingestion scheitert und die Wissens-Suche liefert leer — Agents, die Wissen abrufen, bekommen eine leere Ergebnismenge und eine Warnung im Ausführungs-Log. Der Rest der App arbeitet weiter; Chats ohne Wissen sind unbetroffen. Den Container neu zu starten räumt das, und laufende Uploads versuchen es beim nächsten Durchlauf erneut.

**`tale-sandbox` / `tale-sandbox-egress` down.** **Code-ausführen**-Tool-Aufrufe geben einen Fehler zurück und Fähigkeits-Skripte scheitern. Weil das Convex-Backend Webseiten rendert und Dokumente über die Sandbox-Laufzeit generiert, scheitern auch ein Web-Crawl, der JavaScript-Rendering braucht, und die Dokumentgenerierung geschlossen, solange die Sandbox down ist. Agents, die keines davon nutzen, arbeiten weiter.

**`tale-sandbox-llm-gateway` down.** Sandbox-Agents verlieren ihren Pfad zu einem Modell-Provider. Regulärer Chat — der Provider direkt aus Convex aufruft, nicht über das LLM-Gateway — ist unbetroffen.

## Wo das hingehört

Diese Seite ist die Karte des Operators; die [Architektur-Übersicht](/de/self-hosted/overview) ist die Einführung ins selbe Bild, die [Troubleshooting-Seite](/de/self-hosted/operate/observability/troubleshooting) ist der symptomorientierte Index, wenn etwas schiefgegangen ist. Wenn du Alert-Schwellen setzt, benennt [Operations](/de/self-hosted/operate/observability/operations) die Signale, die sich zu verdrahten lohnen.
