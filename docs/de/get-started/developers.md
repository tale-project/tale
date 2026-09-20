---
title: Deine erste API-Anfrage
description: Erstelle einen Schlüssel, bestimme deine Organisation und finde aufrufbare Modelle.
---
Prüfe zu Beginn einer Integration drei Dinge: Der Schlüssel authentifiziert sich, die Anfrage erreicht die richtige Organisation und dort sind die benötigten Ressourcen verfügbar. Diese Anleitung führt dich mit curl durch diese Prüfungen. Du brauchst eine laufende Instanz und die Berechtigung zum Erstellen von API-Schlüsseln, üblicherweise als Entwickler, Admin oder Inhaber.

## Einen Schlüssel für die Integration erstellen

Öffne **Einstellungen > API > REST** und wähle **API-Schlüssel erstellen**. Vergib einen zweckbezogenen Namen, wähle eine Ablaufzeit und dann **Schlüssel erstellen**. Kopiere den Wert sofort; Tale zeigt das Geheimnis nur einmal.

<Frame caption="Verwende pro Integration einen erkennbaren Schlüssel, den du unabhängig ersetzen oder widerrufen kannst.">

![Im Dialog zum Erstellen eines API-Schlüssels legst du vor der Erstellung einen Namen und die Gültigkeitsdauer fest.](/images/get-started/settings-api-keys.webp)

</Frame>

Lade das Geheimnis aus einem Secret-Manager oder einer privaten Shell-Umgebung in `TALE_API_KEY`. Setze `TALE_BASE_URL` auf deine Instanz, etwa `https://your-host.example.com`. Hänge noch kein `/api/v1` an; die folgenden Befehle ergänzen den Pfad.

## Konto und Organisation bestimmen

Rufe `/me` ohne Organisationsheader auf. Bei einer Mitgliedschaft erhältst du die Identität des Schlüssels und die Organisation. Bei mehreren Mitgliedschaften antwortet der Endpunkt mit `400 ORG_SLUG_REQUIRED` und listet die Auswahl in `data.organizations` auf:

```bash
curl --fail-with-body --silent --show-error "$TALE_BASE_URL/api/v1/me" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

Setze `TALE_ORG_SLUG` auf den gewählten Slug und wiederhole `/me` mit diesem Geltungsbereich. Die Dashboard-URL enthält eine Organisations-ID; verwende sie nicht als Slug. Bei `400` beendet sich curl im ersten Aufruf mit Code 22, gibt den JSON-Inhalt aber trotzdem aus.

```bash
curl --fail-with-body --silent --show-error "$TALE_BASE_URL/api/v1/me" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG"
```

Prüfe in der erfolgreichen Antwort das Konto, die Organisation, die Berechtigungen und `key.expiresAt`, bevor du fortfährst.

Der Schlüssel verwendet die aktuellen Mitgliedschaften und Rechte seines Inhabers. Mehrere Schlüssel eines Kontos erzeugen keine unabhängigen Rollen oder Anfragelimits. Plane den Austausch vor Ablauf; `/api/v1` verwaltet API-Schlüssel nicht für dich.

## Ein verfügbares Modell finden

Gib beim Auflisten der Modelle die Organisation ausdrücklich an:

```bash
curl --fail-with-body --silent --show-error "$TALE_BASE_URL/api/v1/models" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG"
```

<Check>

Eine `200`-Antwort mit dem Array `models` bestätigt diese authentifizierte Anfrage im Organisationskontext. Ein leeres Array bestätigt den Zugriff auf den Endpunkt, aber noch nicht die Bereitschaft für eine Modellantwort.

</Check>

Verwende die `id` eines Modells in Chatanfragen und zusätzlich `providerSlug`, wenn mehrere Anbieter diese ID führen. Ein gelistetes Modell kann dem Anbieterkonto wegen Guthaben oder Tarif trotzdem nicht zur Verfügung stehen. Bitte bei einer leeren Liste einen Admin, Zugangsdaten und Modellzugriff zu prüfen.

## Den ersten Fehler beheben

| Antwort | Nächste Aktion |
| --- | --- |
| `401` | Prüfe Bearer-Schlüssel, Ablaufzeit und Widerruf. |
| `400` mit `ORG_SLUG_REQUIRED` | Wähle einen Slug aus `data.organizations` in dieser Fehlermeldung und sende `X-Organization-Slug`. |
| `404` mit `ORG_SLUG_INVALID` | Der Header benennt keine Organisation, in der der Schlüsselbesitzer Mitglied ist — ein Tippfehler, oder die Organisations-ID aus der Dashboard-URL wurde als Slug eingesetzt. Sende den Slug aus `data.organizations`. |
| `403` | Prüfe Mitgliedschaft und die für die Aktion nötige Berechtigung. |
| `429` | Warte gemäß `Retry-After`; lies [Ratenlimits](/de/develop/rate-limits). |

Meldet curl vor einer JSON-Antwort einen TLS- oder Netzwerkfehler, prüfe Host und Zertifikat. Schalte die Zertifikatsprüfung in Produktivskripten nicht ab.

## Die nächste Aufgabe wählen

| Du möchtest… | Lies weiter bei |
| --- | --- |
| Eine fertige Assistentenantwort ausgeben | [Tale aus einem Skript aufrufen](/de/tutorials/developer/call-tale-from-a-script). |
| Eine Automation aus einem anderen System starten | [Eine Automation per Webhook auslösen](/de/tutorials/developer/trigger-automation-via-webhook). |
| Einen MCP-Client verbinden | [MCP-Endpunkt](/de/develop/mcp-endpoint). |
| Mit Projektdateien, Aufgaben oder Läufen arbeiten | [API-Referenz](/de/develop/api-reference). |

Verwende für projektbezogene Arbeit Routen unter `/api/v1/projects/{id}/...`. Die Projekt-ID gehört in den Pfad, der Organisations-Slug in die Kopfzeile. Halte beide Werte in der Integrationskonfiguration ausdrücklich fest.
