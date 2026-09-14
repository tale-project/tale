---
title: Den Wechsel in den Eigenbetrieb planen
description: Eine betreute Cloud-Migration vorbereiten, das Ziel prüfen und einen Rückfallplan vereinbaren.
---

Beim Wechsel von der Cloud in den Eigenbetrieb übernimmt dein Team die Infrastruktur. Plane den Umzug mit Tale und dem Betreiber des Zielsystems, damit Anwendungsdaten, Wissen, Dateien, Konfiguration und Verschlüsselungsschlüssel zusammenpassen.

Die Migration erfolgt mit Unterstützung des Betreibers. Das gemeinsame Produkt bietet keinen organisationsweiten Ablauf aus **Exportieren** und `/_internal/import`, wie ihn ältere Anleitungen beschrieben haben. Einzelne API-Exporte ersetzen keine vollständige Instanzsicherung.

## Festlegen, was erhalten bleiben muss

Liste die Organisationen und Daten, das erlaubte Wartungsfenster, die Zielversion und die Personen für die Abnahme auf. Prüfe die Infrastrukturvoraussetzungen in der [Installationsanleitung](/de/self-hosted/install/quickstart).

| Bereich | Vor dem Umzug zu klären |
| --- | --- |
| Anwendungsdatenbank | Welche Sicherung ist konsistent und welche Versionen können sie wiederherstellen? |
| Wissensspeicher | Welche organisationsbezogenen Speicher, Indizes und Embedding-Einstellungen müssen mitziehen? |
| Dateien und Konfiguration | Welche Objektspeicherdaten und Konfigurationsverzeichnisse gehören zur Installation? |
| Verschlüsselung | Welche Verschlüsselungs- und Signaturschlüssel müssen sicher erhalten bleiben? |
| Externe Dienste | Welche Rückrufadressen, Webhook-Ziele, Zugangsdaten oder Netzwerkregeln ändern sich? |
| Hintergrundarbeit | Welche Ausführungen müssen vor der letzten Kopie enden oder pausieren? |

Arbeite mit dem Betreiber die [Sicherung und Wiederherstellung](/de/self-hosted/operate/backups-and-restore) durch. Eine Sammlung von API-Exporten ersetzt diesen Plan nicht.

## Die Wiederherstellung getrennt proben

Stelle vor dem Umzug eine Kopie in einer isolierten Umgebung wieder her. Kontrolliere ausgehende Automatisierungen und geplante Aufgaben, damit die Probe keine doppelten Nachrichten sendet oder unbeabsichtigte Änderungen auslöst.

Prüfe Anmeldung, Rollen, repräsentative Dokumente, Projektdateien, eine Chatantwort und die Konfiguration wichtiger Integrationen. Vergleiche Anzahlen und ausgewählte Datensätze mit der Quelle. Wenn der Dienst startet, ist erst die erste Prüfung bestanden.

## Umschaltung und Rückfall vereinbaren

Halte fest, wer Schreibzugriffe sperrt, die letzte Kopie erstellt, die Weiterleitung umstellt und das Ziel prüft. Definiere Rückfallkriterien und verhindere, dass beide Instanzen gleichzeitig Änderungen annehmen. Bewahre Quelle und geprüfte Sicherungen bis zur Abnahme auf.

Passe öffentliche Adressen, TLS, SSO-Rückrufadressen und Integrationsziele bei Bedarf an. Sitzungen oder externe Zugangsdaten können eine Erneuerung erfordern. Teste sie, statt ihre Übernahme vorauszusetzen.

## Den Betrieb übergeben

Kläre Überwachung, Sicherungspläne, Zuständigkeit für Wiederherstellungen, Upgrades und Supportkontakte. Dokumentiere die Abnahme und teile dem Team die neue Adresse mit. Zum laufenden Betrieb gehören danach [Upgrades](/de/self-hosted/operate/upgrades), [Beobachtbarkeit](/de/self-hosted/operate/observability/operations) und geprobte Wiederherstellungen.
