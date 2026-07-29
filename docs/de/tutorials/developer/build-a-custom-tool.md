---
title: Ein eigenes Tool bauen
description: Packe eine eigene Funktion als Tool ein, das Agenten aufrufen können, häng es an einen Agent und beobachte, wie es im Chat als Tool-Call erscheint.
---

Ein eigenes Tool ist eine Funktion, die du schreibst und die das Modell eines Agenten beim Namen aufruft. Du deklarierst das Input-Schema und die Rückgabe-Form; Tale kümmert sich um die Serialisierung, die Tool-Call-Karte im Chat und das Zurückreichen des Resultats an das Modell. Dieser Spaziergang führt ein frisches eigenes Tool von „ich habe eine Funktion im Kopf" zu „der Agent ruft sie aus einem Chat heraus auf" auf einer einzigen Instanz.

Du brauchst eine Developer-Rolle in der Org und Zugriff aufs Panel **Einstellungen > Eigene Tools**; alles andere passiert in der UI. Das zugrundeliegende Konzept lebt in [Agent-Tools](/de/platform/agents/tools); diese Seite richtet sich auf die Entwickler-Seite — Schemas, Transport, Fehler.

## Bevor du beginnst

Bestätige zwei Dinge. Erstens: deine Rolle ist mindestens Developer — darunter ist das Panel versteckt. Zweitens: du hast einen Agent, den du bearbeiten kannst; falls nicht, erstelle einen über [Agent erstellen](/de/platform/agents/create), bevor du weitermachst. Der Spaziergang nutzt ein Tool mit einem Input und einem Output namens `lookup_order`, das eine Order-ID nimmt und einen Status-String zurückgibt — die kleinste Form, die das Schema, den Aufruf und das Rendern des Resultats übt.

## Schritt 1 — Das Tool in „Eigene Tools" definieren

Der erste Zug ist das Registrieren von Tool-Name und JSON-Schema. Das Schema ist das, was das Modell sieht; ohne Schema hat das Modell keine Idee, welche Argumente es ausgeben soll, und der Aufruf passiert nie.

Öffne **Einstellungen > Eigene Tools** und klick **Neues Tool**. Gib ihm einen Namen (`lookup_order`), eine Ein-Satz-Beschreibung (`Look up the status of an order by ID`) und ein JSON-Schema für den Input:

```json
{
  "type": "object",
  "properties": {
    "orderId": {
      "type": "string",
      "description": "The order ID, e.g. ORD-12345"
    }
  },
  "required": ["orderId"]
}
```

Speichern. Das Tool ist nun in der Tool-Registry der Org registriert; noch nutzt es kein Agent.

## Schritt 2 — Die Implementierung verdrahten

Ein registriertes Tool ohne Implementierung gibt dem Modell einen Fehler zurück. Tale bietet zwei Implementierungs-Modi: ein Inline-Sandbox-Skript (Python oder JavaScript, in Tales Sandbox ausgeführt) und einen ausgehenden HTTPS-Call (Tale POSTet die Argumente an deinen Endpoint, du gibst JSON zurück).

Wähl für diesen Spaziergang den HTTPS-Modus — das ist die Form, zu der du in Produktion greifst. Im Detail-Panel des Tools setze:

- **Endpoint-URL** — `https://your-api.example.com/lookup-order`
- **Methode** — `POST`
- **Auth-Kopfzeile** — ein Bearer-Token aus deinem Secret-Manager

Tale POSTet `{ "orderId": "..." }` an deinen Endpoint; dein Endpoint gibt `{ "status": "shipped", "carrier": "DHL", "eta": "2026-06-01" }` zurück. Speichern. Das eigene Tool ist verdrahtet.

## Schritt 3 — Das Tool an einen Agent hängen

Ein verdrahtetes Tool ist für Agenten unsichtbar, bis einer von ihnen die Erlaubnis bekommt, es aufzurufen. Öffne den Agent, den du erweitern willst, klick **Tools**, scroll zu **Eigene Tools** und schalte `lookup_order` ein. Speicher den Agent.

Öffne einen Chat mit dem Agent und frag „what is the status of order ORD-12345". Der Chat zeigt zwischen deiner Nachricht und der Antwort eine eingeklappte `lookup_order`-Tool-Call-Karte; sie auszuklappen zeigt die Argumente, die das Modell ausgegeben hat (`{ "orderId": "ORD-12345" }`) und das JSON, das dein Endpoint zurückgegeben hat. Das Modell schreibt die Antwort dann mit dem Tool-Resultat.

## Wo das eingesetzt wird

Ein eigenes Tool ist die Naht zwischen einem Agent und deiner Domäne — Order-Lookup, interne Suche, Rechner, alles, was eine Standard-Connector nicht abdeckt. Das Schema ist das, womit das Modell entscheidet, ob es aufruft — investier die Zeit für eine knappe Beschreibung und nimm nur die Felder, die du brauchst.

Für Tools, die du Org-übergreifend teilen willst, siehe [MCP-Server von Grund auf](/de/tutorials/developer/mcp-server-from-scratch) — MCP ist das Protokoll für „ein Tool, viele Tale-Instanzen". Für die konzeptuelle Seite, was Tools in einem Agent tun, siehe [Agent-Tools](/de/platform/agents/tools).
