---
title: Governance
description: Organisationsweite KI-Richtlinien, Limits, Sicherheits-Kontrollen und Audit-Logs.
---

Governance ist der Ort, an dem Admins die Regeln für den KI-Einsatz in der Organisation festlegen. Sie ist in drei Gruppen organisiert, erreichbar über die linke Navigation unter **Einstellungen > Governance**, plus einer Audit-Log-Seite für Compliance.

## Content & Models

### System-Prompt

Setze einen globalen System-Prompt, der jeder KI-Konversation in der Organisation vorangestellt wird. Damit erzwingst du Ton, Umfang und Sicherheitsregeln, die jeder Agent erbt.

### Default-Modelle

Wähle die Standard-Modelle für Chat, Vision und Embedding, die benutzt werden, wenn Nutzer keines explizit wählen. Modelle kommen aus allen konfigurierten Anbietern — siehe [KI-Anbieter](/de/platform/admin/providers).

### Model Access

Steuere, welche Modelle bestimmten Teams oder Nutzern verfügbar sind. Beschränke teure Frontier-Modelle auf Senior Staff oder gib einem Team nur selbst gehostete Modelle frei.

## Policies & Limits

### Budgets

Setze Ausgabelimits pro Nutzer, pro Team oder für die ganze Organisation. Konfiguriere Zeitraum (täglich, wöchentlich, monatlich) und die Aktion bei Limit-Überschreitung — warnen, neue Requests blockieren oder Chat ganz deaktivieren.

### Upload-Richtlinie {#upload-policy}

Beschränke Datei-Uploads nach Typ, Grösse oder Anzahl. Nützlich, wenn du grosse Binär-Uploads oder ausführbare Dateitypen verhindern willst. Pro MIME-Typ kannst du eine strengere Grenze setzen — z. B. `audio/*` auf 25 MB begrenzen, während das globale Limit bei 100 MB bleibt.

### Aufbewahrung

Konfiguriere, wie lange Konversationen, hochgeladene Dateien und Audit-Daten aufbewahrt werden, bevor sie automatisch gelöscht werden. Siehe [Aufbewahrung](/de/self-hosted/configuration/retention) für die passenden Environment-Standards auf Deployment-Ebene.

### Feature Controls

Schalte Plattform-Features organisationsweit ein oder aus: Datei-Uploads, Web-Suche, Bild-Generierung, Arena-Modus und mehr. Hier deaktivierte Features sind in der UI für alle Nutzer ausgeblendet.

## Security & Monitoring

### Guardrails

Guardrails sind drei Filter-Schichten, die Tale für jede Chat-Nachricht **bevor** sie das Modell erreicht und für jedes Modell-Token **bevor** es beim Nutzer ankommt nacheinander durchläuft. Jede Schicht wird unter **Einstellungen > Richtlinien > Guardrails** unabhängig konfiguriert; eine schreibgeschützte Karte **Guardrails-Übersicht** zeigt, welche Schicht aktiv ist. Die Reihenfolge ist fest:

```mermaid
flowchart LR
  user["Nutzer schickt eine Nachricht."] --> chatFilter["Tale prüft die Inhaltssicherheit."]
  chatFilter --> pii["Tale scannt nach personenbezogenen Daten."]
  pii --> moderation["Tale bewertet die Nachricht beim Moderations-Anbieter."]
  moderation --> model["Das Modell erzeugt eine Antwort."]
  model --> outChatFilter["Tale prüft die Inhaltssicherheit der Output-Tokens."]
  outChatFilter --> outPii["Tale scannt die Output-Tokens nach personenbezogenen Daten."]
  outPii --> outModeration["Tale bewertet die Output-Tokens beim Moderations-Anbieter."]
  outModeration --> reply["Tale streamt die freigegebene Antwort an den Nutzer."]
```

Eine blockierte Nachricht erreicht das Modell nie, ein blockiertes Token wird dem Nutzer nie ausgespielt. Jede Guardrail-Entscheidung (zulassen, maskieren, blockieren) schreibt einen strukturierten Eintrag ins Audit-Log; der rohe Treffer-Text wird nie gespeichert.

#### Inhaltssicherheit

Öffne **Einstellungen > Richtlinien > Inhaltssicherheit**. Lege Kategorien an (zum Beispiel _Vulgaritäten_, _Mitbewerber-Namen_, _vertrauliche Codenamen_), gib jeder eine Wortliste und wähle einen Durchsetzungsmodus — _Aus_, _Warnen_, _Maskieren_ oder _Blockieren_. Kategorien laufen als schnelle Regex-Treffer mit Schutz vor katastrophalem Backtracking, die Latenz dieser Schicht ist also vernachlässigbar. Nutze sie für organisationsspezifische Schlüsselwort-Regeln, die öffentliche Moderation-APIs nicht kennen können.

#### PII-Erkennung {#pii-detection}

Aktiviere automatische Erkennung und Maskierung (oder Blockierung) personenbezogener Daten in Nachrichten. Eingebaute Muster decken Email, Telefon, Kreditkarten- und IBAN-Nummern, US-Adressen und einige nationale Ausweise ab; eigene Regex-Regeln ergänzen interne Formate (Mitarbeiter-ID, Ticket-Nummern, Produkt-SKUs). Jedes Muster wählt seinen eigenen Durchsetzungsmodus. Erkannte PII in Anhängen durchläuft dieselbe Pipeline wie getippte Nachrichten.

#### Moderations-Anbieter

Schicke Chat-Nachrichten an einen externen Klassifikator — OpenAI Moderation, Azure Content Safety, Perspective oder einen beliebigen HTTPS-Endpunkt, der Kategorie-Scores zurückgibt. Wähle ein eingebautes Preset, dann sind URL, Header, Request-Template und Response-Parser für dich ausgefüllt; für alles andere wählst du _Custom JSONPath_ und mappst die Felder selbst. Der API-Schlüssel wird serverseitig AES-verschlüsselt gespeichert und in jedem Header-Wert als `{secretPlaceholder}` referenziert. Mit dem Button **Verbindung testen** schickst du eine Beispielnachricht über den echten Anbieter-Pfad — er prüft Schlüssel, Endpunkt, Request-Template, Response-Parser und Kategorie-Mappings in einem Round-Trip, ohne eine Konversation zu schreiben.

Aus SSRF-Schutz wird nur der konfigurierte Host kontaktiert; Redirects zu anderen Hosts werden abgewiesen. Parallele Aufrufe sind pro Organisation rate-limitiert, damit ein einzelner Chat-Burst dein Moderations-Kontingent nicht erschöpft.

### Usage Dashboard

Sieh Token-Verbrauch, Kosten-Aufschlüsselung und Nutzungs-Trends über die gesamte Organisation. Filter nach Team, Nutzer, Modell oder Zeitraum. Für tiefere Analytics siehe [Usage Analytics](/de/platform/admin/usage-analytics).

## Audit-Logs

Eine zeitlich geordnete Aufzeichnung wichtiger Aktionen in der Organisation. Kategorien umfassen Authentifizierungs-Events, Mitglieder-Änderungen, Daten-Operationen, Integrationen-Updates, Workflow-Publishings, Sicherheits-Events und Admin-Aktionen. Nützlich für Compliance und Fehlersuche.

Admins können Audit-Logs per Button über der Log-Tabelle als **CSV** oder **JSON** exportieren. Exports respektieren den aktuell aktiven Kategorie-Filter.
