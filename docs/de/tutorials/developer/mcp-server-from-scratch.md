---
title: Einen MCP-Server von Grund auf hochziehen
description: Verdrahte einen Model-Context-Protocol-Server als eigene Connector, damit jeder Agent in der Org seine Tools aufrufen kann.
---

Ein Model-Context-Protocol-Server (MCP-Server) ist ein Prozess, der eine Liste von Tools über ein kleines JSON-RPC-Protokoll bereitstellt. Tale registriert einen MCP-Server einmal auf Org-Ebene; ab dann kann jeder Agent, der diesen Server in seinem Tools-Tab führt, dessen Tools aufrufen. Dieser Spaziergang führt einen brandneuen MCP-Server von „leerem Repo" zu „aus einem Chat von einem Agent aufgerufen" auf einer Tale-Instanz.

Du brauchst eine Developer-Rolle, einen Host, der den MCP-Server laufen lassen kann (dein Laptop reicht für den Spaziergang; für Produktion ein Managed-Service oder Container) und eine HTTPS-URL, die Tale erreicht. Cloud-Orgs erreichen öffentliche URLs standardmässig; selbst gehostete Instanzen brauchen Netzwerk-Zugang dorthin, wo der MCP-Server läuft.

## Bevor du beginnst

Bestätige zwei Dinge. Du hast Node 20 oder Python 3.11 installiert — die offiziellen MCP-SDKs zielen auf diese Laufzeiten. Die Tale-Instanz erreicht die URL deines MCP-Servers — für lokale Entwicklung tut's ein `ngrok`-Tunnel oder Äquivalent; für Produktion host den Server irgendwo mit einem stabilen HTTPS-Endpoint. Die konzeptuelle Seite von MCP in Tale lebt in [Agent-Tools](/de/platform/agents/tools); dieser Spaziergang ist die Verdrahtung.

## Schritt 1 — Den Server gerüstartig anlegen

Der erste Zug ist, den minimalen MCP-Server zu generieren — ein Tool, ein Handler. Das offizielle SDK erledigt die Protokoll-Klempnerei, damit du nur das Tool schreibst.

```bash
npm create mcp-server@latest hello-tale
cd hello-tale
```

Öffne `src/index.ts` und ersetz das Beispiel-Tool durch eines, das die aktuelle Zeit in einer benannten Zeitzone zurückgibt:

```ts
server.tool(
  'current_time',
  'Return the current time in a given timezone',
  { timezone: z.string() },
  async ({ timezone }) => {
    const now = new Date().toLocaleString('en-US', { timeZone: timezone });
    return { content: [{ type: 'text', text: now }] };
  },
);
```

Lass den Server lokal laufen:

```bash
npm run start
```

Der Server lauscht standardmässig auf `http://localhost:3000/mcp`. Das Gerüst steht; in Tale weiss noch nichts davon.

## Schritt 2 — Auf HTTPS verfügbar machen

MCP-Server, die Tale aufrufen kann, brauchen eine HTTPS-URL mit gültigem Zertifikat. Für lokale Entwicklung: einen `ngrok`-Tunnel auf Port 3000 zeigen lassen und die öffentliche URL kopieren, die der Tunnel ausgibt. Für Produktion host den Server hinter deinem normalen Ingress — Caddy, Nginx, eine Managed Function, alles, was TLS terminiert.

Verifiziere, dass die öffentliche URL auf einen Health-Check antwortet:

```bash
curl -sS "https://abcd.ngrok.app/mcp/health"
```

Eine 200 bestätigt Erreichbarkeit. Eine 502 oder ein Timeout heisst, der Tunnel leitet nicht weiter; starte ihn neu oder check die Firewall.

## Schritt 3 — Den Server in Tale registrieren

Ein erreichbarer MCP-Server ist für Tale unsichtbar, bis du ihn registrierst. Öffne **Einstellungen > Connectors > MCP-Server** und klick **Neuer Server**. Füll aus:

- **Name** — `Hello Tale time`
- **URL** — die öffentliche HTTPS-URL aus Schritt 2 (z.B. `https://abcd.ngrok.app/mcp`)
- **Auth** — Bearer-Token, falls dein Server eines verlangt, fürs Spaziergang keines

Klick **Speichern**. Tale ruft die Methode `list_tools` des Servers auf, um den Tool-Bestand zu entdecken; das Panel zeigt `current_time` mit Beschreibung. Der Server ist nun org-weit registriert.

## Schritt 4 — Den Server an einen Agent hängen und das Tool aufrufen

Ein registrierter Server ist nur erreichbar für Agenten, die sich anmelden. Öffne einen beliebigen Agent, klick **Tools > MCP**, schalte **Hello Tale time** ein und speicher. Öffne einen Chat mit dem Agent und frag „what time is it in Tokyo right now". Der Chat rendert eine `current_time`-Tool-Call-Karte; sie auszuklappen zeigt `{ "timezone": "Asia/Tokyo" }` und den Zeitstempel, den dein Server zurückgegeben hat, und die Antwort des Agenten nutzt den Zeitstempel.

## Wo das eingesetzt wird

Ein MCP-Server ist die richtige Form, wenn ein Tool ausserhalb von Tale leben muss — Code, der deinem Team gehört, ein Dienst in einem anderen Netz, eine Drittanbieter-API, die du umschnürst. Eigene Tools aus [Ein eigenes Tool bauen](/de/tutorials/developer/build-a-custom-tool) sind die richtige Form, wenn das Tool einmalig ist und in den Einstellungen einer Org lebt.

Fürs grössere Bild, wie Tools erweitern, was ein Agent kann, siehe [Agent-Tools](/de/platform/agents/tools). Für die Verdrahtung einer Connector, die statt eigenem Code eine Drittanbieter-API umschliesst, ist [Connectors-Überblick](/de/platform/connectors/overview) die nächste Lektüre.
