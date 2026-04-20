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

### Upload-Policy

Beschränke Datei-Uploads nach Typ, Größe oder Anzahl. Nützlich, wenn du große Binär-Uploads oder ausführbare Dateitypen verhindern willst.

### Aufbewahrung

Konfiguriere, wie lange Konversationen, hochgeladene Dateien und Audit-Daten aufbewahrt werden, bevor sie automatisch gelöscht werden. Siehe [Aufbewahrung](/de/self-hosted/configuration/retention) für die passenden Environment-Standards auf Deployment-Ebene.

### Feature Controls

Schalte Plattform-Features organisationsweit ein oder aus: Datei-Uploads, Web-Suche, Bild-Generierung, Arena-Modus und mehr. Hier deaktivierte Features sind in der UI für alle Nutzer ausgeblendet.

## Security & Monitoring

### PII-Erkennung

Aktiviere automatische Erkennung und Maskierung (oder Blockierung) von personenbezogenen Daten in Nachrichten. Unterstützt vordefinierte Muster (E-Mail, Telefon, Kreditkartennummern) und eigene Regex-Regeln. Blockierte Nachrichten erreichen das Modell nie.

### Usage Dashboard

Sieh Token-Verbrauch, Kosten-Aufschlüsselung und Nutzungs-Trends über die gesamte Organisation. Filter nach Team, Nutzer, Modell oder Zeitraum. Für tiefere Analytics siehe [Usage Analytics](/de/platform/admin/usage-analytics).

## Audit-Logs

Eine zeitlich geordnete Aufzeichnung wichtiger Aktionen in der Organisation. Kategorien umfassen Authentifizierungs-Events, Mitglieder-Änderungen, Daten-Operationen, Integrationen-Updates, Workflow-Publishings, Sicherheits-Events und Admin-Aktionen. Nützlich für Compliance und Fehlersuche.

Admins können Audit-Logs per Button über der Log-Tabelle als **CSV** oder **JSON** exportieren. Exports respektieren den aktuell aktiven Kategorie-Filter.
