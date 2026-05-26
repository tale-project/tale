---
title: Mitglieder und Rollen
description: Die kanonische Berechtigungsmatrix der sechs Rollen — wer in einer Tale-Organisation was sieht und tut, und wie Admins Mitglieder einladen, bearbeiten und entfernen.
---

Jede Person in einer Tale-Organisation hat genau eine von sechs Rollen, und diese Rolle entscheidet, welche Bildschirme sie sieht, welche Schaltflächen aktiv sind und welche API-Aufrufe durchgehen. Diese Seite ist für Admins und Inhaber, die die Organisation betreiben, und sie dient gleichzeitig als kanonische Referenz, auf die der Rest der Doku verweist, wenn eine Funktion „Redakteur oder höher" oder „nur Entwickler" verlangt. Dieselbe Person kann in verschiedenen Organisationen verschiedene Rollen halten — Rollen gelten pro Organisation, nicht pro Nutzer.

Die Rollen-Liste ist geschlossen: `Inhaber`, `Admin`, `Entwickler`, `Redakteur`, `Mitglied`, `Deaktiviert`. Es gibt keinen Baukasten für eigene Rollen, und die Matrix unten ist die Quelle der Wahrheit — wenn eine Schaltfläche für deine Rolle ausgeblendet ist, steht der Grund hier.

## Mitglieder verwalten

Öffne **Einstellungen > Mitglieder**. Die Tabelle listet alle Nutzer der Organisation mit E-Mail, Anzeigename, Rolle und Beitrittsdatum sowie einem Aktionsmenü pro Zeile für Admins.

- **Mitglied hinzufügen** — öffnet einen Dialog für E-Mail, optionales Anfangs-Passwort, Anzeigename und Rolle. Existiert die E-Mail bereits in Tale, wird dieses Konto der Organisation zugewiesen, statt ein Duplikat zu erzeugen. Neue Konten mit Passwort werden mit **Nutzer muss das Passwort beim Login aktualisieren** markiert, damit das Anfangs-Passwort die erste Anmeldung nicht überlebt.
- **Mitglied bearbeiten** — Anzeigename, Rolle oder neues Passwort setzen. Admins können ihre eigene Rolle nicht aus diesem Dialog heraus ändern (dafür gibt es weiter unten **Eigentümerschaft übertragen**). Einen Admin auf eine niedrigere Rolle herabzustufen wird blockiert, wenn dadurch weniger als zwei Admins in der Organisation übrig bleiben.
- **Zwei-Faktor zurücksetzen** — deaktiviert die TOTP-Einrichtung des Mitglieds, beendet alle aktiven Sitzungen und erzwingt eine neue Einrichtung beim nächsten Login. Greife darauf zurück, wenn jemand seinen Authenticator verloren und alle Backup-Codes aufgebraucht hat. Jede Zurücksetzung wird im Audit-Log festgehalten.
- **Mitglied entfernen** — löst das Mitglied aus dieser Organisation. Das zugrunde liegende Konto bleibt bestehen; der Zugriff auf andere Organisationen, in denen es Mitglied ist, bleibt erhalten.
- **Eigentümerschaft übertragen** — nur für den aktuellen Inhaber verfügbar. Befördert das gewählte Mitglied zum Inhaber und stuft den bisherigen Inhaber auf Admin herab. Jede Organisation hat genau einen Inhaber.

Für die Anmelde-Mechanik (Passwort, Microsoft Entra ID SSO, vertrauenswürdige Reverse-Proxy-Kopfzeilen, Passwort-Rotation) siehe [Authentifizierung](/de/self-hosted/admin/authentication). Für die organisationsweite Zwei-Faktor-Richtlinie siehe [Zwei-Faktor-Authentifizierung](/de/platform/admin/two-factor-authentication).

## Die sechs Rollen

| Rolle       | Wozu diese Rolle gedacht ist                                                                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inhaber     | Die Person, die die Organisation erstellt hat. Gleiche Berechtigungen wie Admin, plus Eigentümerschaft übertragen und Organisation löschen. Genau ein Inhaber pro Organisation.                    |
| Admin       | Volle Kontrolle über die Organisation. Verwaltet Mitglieder, Anbieter, Branding, Richtlinien, Aufbewahrung, Audit-Log und alles, was darunter steht.                                               |
| Entwickler  | Der Sitz fürs Bauen und Integrieren. Erstellt und bearbeitet Agents und Automatisierungen, konfiguriert Integrationen und MCP-Server, verwaltet API-Schlüssel. Kein Zugriff auf Admin-Oberflächen. |
| Redakteur   | Der Kuratierungs-Sitz. Lädt Wissen hoch und bearbeitet es, verwaltet Produkte, Kunden, Lieferanten und Websites, antwortet in Konversationen, entscheidet Freigaben und bearbeitet Agents.         |
| Mitglied    | Nur-Lese-Konsument. Chattet mit KI und Agents, liest die Wissensdatenbank, liest Konversationen und Freigaben. Kann keine dieser Oberflächen beschreiben.                                          |
| Deaktiviert | Gesperrtes Konto. Anmeldung wird für diese Organisation abgelehnt. Der zugrunde liegende Nutzer-Datensatz bleibt, damit das Konto durch eine Rollen-Änderung reaktiviert werden kann.              |

`Inhaber` ist eine strikte Obermenge von `Admin` — jede Admin-Berechtigung weiter unten gehört auch dem Inhaber. Die Matrix führt ab hier `Admin` auf, um die Spalten kurz zu halten.

## Berechtigungs-Matrix

Die Matrix ist nach Produktbereich gegliedert. `✓` heißt, die Rolle hat die Aktion; `—` heißt, die Aktion ist für die Rolle ausgeblendet oder wird abgelehnt.

### KI-Chat

| Aktion                           | Mitglied | Redakteur | Entwickler | Admin |
| -------------------------------- | -------- | --------- | ---------- | ----- |
| Nachrichten erstellen und senden | ✓        | ✓         | ✓          | ✓     |
| Eigenen Chat-Verlauf sehen       | ✓        | ✓         | ✓          | ✓     |
| Im Chat einen Agent auswählen    | ✓        | ✓         | ✓          | ✓     |

### Wissensdatenbank

| Aktion                                        | Mitglied | Redakteur | Entwickler | Admin |
| --------------------------------------------- | -------- | --------- | ---------- | ----- |
| Alle Wissens-Einträge sehen                   | ✓        | ✓         | ✓          | ✓     |
| Dokumente hochladen, bearbeiten oder löschen  | —        | ✓         | ✓          | ✓     |
| Produkte, Kunden, Lieferanten verwalten       | —        | ✓         | ✓          | ✓     |
| Website-Crawling hinzufügen und konfigurieren | —        | ✓         | ✓          | ✓     |

### Konversationen

| Aktion                                             | Mitglied | Redakteur | Entwickler | Admin |
| -------------------------------------------------- | -------- | --------- | ---------- | ----- |
| Konversationen sehen                               | ✓        | ✓         | ✓          | ✓     |
| Kunden antworten                                   | —        | ✓         | ✓          | ✓     |
| Konversation schließen, erneut öffnen, archivieren | —        | ✓         | ✓          | ✓     |
| Konversation als Spam markieren                    | —        | ✓         | ✓          | ✓     |

### Freigaben

| Aktion                           | Mitglied | Redakteur | Entwickler | Admin |
| -------------------------------- | -------- | --------- | ---------- | ----- |
| Offene Freigaben sehen           | ✓        | ✓         | ✓          | ✓     |
| Aktionen freigeben oder ablehnen | —        | ✓         | ✓          | ✓     |

### Agents

| Aktion                          | Mitglied | Redakteur | Entwickler | Admin |
| ------------------------------- | -------- | --------- | ---------- | ----- |
| Agent-Liste sehen               | —        | ✓         | ✓          | ✓     |
| Agent erstellen oder bearbeiten | —        | ✓         | ✓          | ✓     |
| Agent löschen                   | —        | ✓         | ✓          | ✓     |

### Automatisierungen

| Aktion                                         | Mitglied | Redakteur | Entwickler | Admin |
| ---------------------------------------------- | -------- | --------- | ---------- | ----- |
| Automatisierungs-Liste sehen                   | —        | —         | ✓          | ✓     |
| Automatisierung erstellen oder bearbeiten      | —        | —         | ✓          | ✓     |
| Automatisierung veröffentlichen und aktivieren | —        | —         | ✓          | ✓     |
| Ausführungslogs sehen                          | —        | —         | ✓          | ✓     |

### Integrationen, MCP, API-Schlüssel

| Aktion                                  | Mitglied | Redakteur | Entwickler | Admin |
| --------------------------------------- | -------- | --------- | ---------- | ----- |
| Integrationen sehen                     | —        | —         | ✓          | ✓     |
| Integrationen konfigurieren             | —        | —         | ✓          | ✓     |
| MCP-Server konfigurieren                | —        | —         | ✓          | ✓     |
| API-Schlüssel erstellen oder widerrufen | —        | —         | ✓          | ✓     |

### Organisations-Administration

| Aktion                                                        | Mitglied | Redakteur | Entwickler | Admin |
| ------------------------------------------------------------- | -------- | --------- | ---------- | ----- |
| Organisations-Einstellungen sehen                             | —        | —         | —          | ✓     |
| Organisationsname und Branding bearbeiten                     | —        | —         | —          | ✓     |
| KI-Anbieter konfigurieren                                     | —        | —         | —          | ✓     |
| Richtlinien konfigurieren (Budgets, Aufbewahrung, Guardrails) | —        | —         | —          | ✓     |
| Audit-Log lesen und exportieren                               | —        | —         | —          | ✓     |
| Mitglieder hinzufügen oder entfernen                          | —        | —         | —          | ✓     |
| Rollen der Mitglieder ändern                                  | —        | —         | —          | ✓     |
| Teams verwalten                                               | —        | —         | —          | ✓     |
| Anfragen betroffener Personen einreichen                      | —        | —         | —          | ✓     |

### Nur für den Inhaber

Nur der Inhaber kann das hier:

- **Eigentümerschaft übertragen** an ein anderes Mitglied (stuft den bisherigen Inhaber auf Admin herab).
- **Organisation löschen** — entfernt deren Agents, Automatisierungen, Anbieter und Integrationen; alle Mitglieder verlieren den Zugriff. Das lässt sich nicht rückgängig machen.

## Wie Rollen-Prüfungen erzwungen werden

Rollen werden serverseitig bei jedem Lese-, Schreib- und Hintergrund-Aufruf geprüft — die ausgeblendeten Schaltflächen im UI sind eine Bequemlichkeit, nicht die Schranke. Eine Seite, die „nicht erscheinen sollte", wird trotzdem mit dem Fehler „unzureichende Rolle" abgelehnt, wenn du sie per URL ansteuerst. Die Rolle Deaktiviert umgeht die übrige Matrix: Der Zugriff-verweigert-Bildschirm ist die einzige Oberfläche, die ein deaktivierter Nutzer sieht.

Die Zwei-Admins-Mindestregel wird beim Wechsel der Rolle und beim Entfernen von Mitgliedern erzwungen, damit eine Organisation nie ohne oder mit nur einem Admin dasteht. Diese Regel bindet den Inhaber nicht: Eine Organisation mit einem Inhaber und einem Admin ist zulässig, weil der Inhaber selbst Admin ist.

## Wo das hingehört

Mitglieder und Rollen ist die Seite, die jede andere Admin-Seite voraussetzt. [Authentifizierung](/de/self-hosted/admin/authentication) entscheidet, _wer sich überhaupt anmelden darf_ und über welche Methode; [KI-Anbieter](/de/platform/admin/providers) entscheidet, _welche Modelle die Organisation auf Kosten bringt_; [Richtlinien](/de/platform/admin/governance) entscheidet, _welche Regeln für ihr Tun gelten_ — keine dieser Fragen hat eine nützliche Antwort, bevor du entschieden hast, wer was darf, und das lebt hier.

Der nächste Schritt hängt davon ab, weshalb du gekommen bist. Für die Anmeldung jenseits von E-Mail und Passwort deckt [Authentifizierung](/de/self-hosted/admin/authentication) SSO und vertrauenswürdige Kopfzeilen ab. Um Wissen und Konversationen über die Organisation hinweg zu trennen, ist [Teams](/de/platform/admin/teams) die Seite. Um zu prüfen, wer was getan hat, lebt das Audit-Log unter [Richtlinien](/de/platform/admin/governance).
