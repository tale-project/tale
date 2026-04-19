---
title: Members und Rollen
description: Verwalten, wer Zugriff auf deine Organisation hat und was dort erlaubt ist.
---

Tale nutzt sechs Rollen. Jeder Nutzer hat genau eine Rolle innerhalb einer Organisation. Dieselbe Person kann in verschiedenen Organisationen unterschiedliche Rollen haben.

## Members verwalten

Die Mitglieder-Tabelle unter **Einstellungen > Members** listet alle Nutzer der Organisation mit E-Mail, Anzeigename, Rolle und Beitrittsdatum. Admins können:

- **Members hinzufügen** — E-Mail, optionales Passwort, Anzeigename und Rolle eingeben. Existiert die E-Mail bereits in Tale, wird der Nutzer der Organisation hinzugefügt, ohne dass ein neues Konto entsteht.
- **Members bearbeiten** — Anzeigename, Rolle oder ein neues Passwort für ein Mitglied setzen.
- **Members entfernen** — das Mitglied aus der Organisation entfernen. Das Konto wird nicht gelöscht; der Nutzer verliert lediglich den Zugriff.

Für Authentifizierungsoptionen (Passwort, Microsoft Entra ID SSO, Trusted Headers) siehe [Authentifizierung](/de-CH/admin/authentication).

## Rollen-Übersicht

| Rolle     | Wen sie adressiert                                                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Owner     | Ersteller der Organisation. Gleiche Berechtigungen wie Admin plus Eigentums-Übertragung.                                           |
| Admin     | Vollständige Kontrolle über die Organisation. Verwaltet Members, Einstellungen, Integrationen und sämtliche Inhalte.               |
| Developer | Für Engineers und Integrations-Builder. Vollzugriff auf Daten, aber keine Verwaltung von Members oder Organisations-Einstellungen. |
| Editor    | Für Content- und Support-Teams. Legt Wissensbasis-Inhalte an, bearbeitet Konversationen, verwaltet Agents und bestätigt Aktionen.  |
| Member    | Nur-Lese-Zugriff. Kann den KI-Chat zum Erkunden von Daten nutzen, aber keinen Content anlegen oder bearbeiten.                     |
| Disabled  | Gesperrtes Konto. Kein Zugriff auf Funktionen.                                                                                     |

## Berechtigungs-Matrix

### KI-Chat

| Funktion                         | Member | Editor | Developer | Admin |
| -------------------------------- | ------ | ------ | --------- | ----- |
| Nachrichten erstellen und senden | ✓      | ✓      | ✓         | ✓     |
| Eigenen Chat-Verlauf sehen       | ✓      | ✓      | ✓         | ✓     |
| Agent auswählen                  | ✓      | ✓      | ✓         | ✓     |

### Wissensdatenbank

| Funktion                                   | Member | Editor | Developer | Admin |
| ------------------------------------------ | ------ | ------ | --------- | ----- |
| Alle Wissens-Einträge sehen                | ✓      | ✓      | ✓         | ✓     |
| Dokumente hochladen / bearbeiten / löschen | —      | ✓      | ✓         | ✓     |
| Products, Customers, Vendors verwalten     | —      | ✓      | ✓         | ✓     |
| Website-Crawling konfigurieren             | —      | ✓      | ✓         | ✓     |

### Konversationen

| Funktion                                | Member | Editor | Developer | Admin |
| --------------------------------------- | ------ | ------ | --------- | ----- |
| Konversationen sehen                    | ✓      | ✓      | ✓         | ✓     |
| Kunden antworten                        | —      | ✓      | ✓         | ✓     |
| Schliessen / wieder öffnen / archivieren | —      | ✓      | ✓         | ✓     |
| Als Spam markieren                      | —      | ✓      | ✓         | ✓     |

### Freigaben

| Funktion                         | Member | Editor | Developer | Admin |
| -------------------------------- | ------ | ------ | --------- | ----- |
| Offene Freigaben sehen           | ✓      | ✓      | ✓         | ✓     |
| Aktionen freigeben oder ablehnen | —      | ✓      | ✓         | ✓     |

### Agents

| Funktion                        | Member | Editor | Developer | Admin |
| ------------------------------- | ------ | ------ | --------- | ----- |
| Agent-Liste sehen               | —      | ✓      | ✓         | ✓     |
| Agents erstellen und bearbeiten | —      | ✓      | ✓         | ✓     |

### Automatisierungen

| Funktion                                     | Member | Editor | Developer | Admin |
| -------------------------------------------- | ------ | ------ | --------- | ----- |
| Automatisierungs-Liste sehen                 | —      | —      | ✓         | ✓     |
| Automatisierungen erstellen und bearbeiten   | —      | —      | ✓         | ✓     |
| Automatisierungen publizieren und aktivieren | —      | —      | ✓         | ✓     |
| Ausführungslogs sehen                        | —      | —      | ✓         | ✓     |

### Integrationen und API

| Funktion                               | Member | Editor | Developer | Admin |
| -------------------------------------- | ------ | ------ | --------- | ----- |
| Integrationen sehen                    | —      | —      | ✓         | ✓     |
| Integrationen konfigurieren            | —      | —      | ✓         | ✓     |
| API-Schlüssel erstellen und widerrufen | —      | —      | ✓         | ✓     |

### Organisations-Administration

| Funktion                                  | Member | Editor | Developer | Admin |
| ----------------------------------------- | ------ | ------ | --------- | ----- |
| Organisations-Einstellungen sehen         | —      | —      | —         | ✓     |
| Organisationsname und Branding bearbeiten | —      | —      | —         | ✓     |
| Members hinzufügen und entfernen          | —      | —      | —         | ✓     |
| Rollen der Members ändern                 | —      | —      | —         | ✓     |

## Authentifizierung

Tale unterstützt E-Mail/Passwort, Microsoft Entra ID SSO und Trusted Headers. Alle Methoden lassen sich gleichzeitig nutzen.

Die vollständige Einrichtung beschreibt die [Authentifizierungs-Anleitung](/de-CH/admin/authentication).
