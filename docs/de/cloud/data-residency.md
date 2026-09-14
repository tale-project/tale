---
title: Datenresidenz in der Cloud verstehen
description: Speicherort und Datenflüsse zu Anbietern und Konnektoren vor der Cloud-Nutzung prüfen.
---

Datenresidenz betrifft den Speicherort und den Ort der Verarbeitung. Mit einer Cloud-Region legst du den Standort des gehosteten Dienstes fest. Daraus folgt nicht automatisch, wo jeder Modellanbieter oder angebundene Dienst deine Daten verarbeitet.

## Das Hosting klären

Kläre vor der Einrichtung die primäre Region, Sicherungsstandorte, Aufbewahrung, Wiederherstellungsziele und den Supportablauf mit Tale. Maßgeblich sind der Dienstleistungsvertrag und die Datenschutzvereinbarungen für deine Installation. Aus einer Regionsbezeichnung im Produkt lässt sich weder ein Sicherungsstandort noch eine Wiederherstellungsgarantie ableiten.

Tale betreibt den Cloud-Dienst. Konfigurationsdateien, Datenbank-Zugangsdaten und Umgebungsvariablen des Hosts liegen beim Betreiber. Die [Referenz für den Eigenbetrieb](/de/self-hosted/configuration/data-residency) erklärt das technische Modell.

## Den Weg einer Anfrage verfolgen

Eine Chatnachricht erreicht deine Tale-Instanz. Nutzt der Assistent Wissen, lädt er passende Inhalte aus dem Wissensspeicher der Organisation. Die Nachricht und der ausgewählte Kontext gehen anschließend an den Modellanbieter dieser Antwort. Ein Werkzeug kann weitere Dienste aufrufen, etwa eine Website oder eine angebundene Anwendung.

| Datenfluss | Was du klären solltest |
| --- | --- |
| Gespeicherte Chats, Dokumente und Konfiguration | Vereinbarte Hosting- und Sicherungsstandorte |
| Wissensindexierung | Welcher Embedding-Anbieter Dokumentinhalte erhält |
| Modellinferenz | Endpunkt, Verarbeitungsbedingungen und Aufbewahrung des gewählten Anbieters |
| Konnektoren und Webwerkzeuge | Welche externen Systeme Anfragen und Inhalte erhalten |
| Betriebsdaten | Vereinbarter Umgang mit Logs, Sicherungen und Supportzugriff |

Ein Anbieter kann regionale oder lokal betriebene Endpunkte anbieten. Prüfe den tatsächlich konfigurierten Endpunkt. Der Markenname allein belegt keinen Verarbeitungsort.

<Tip>

Prüfe neben dem Chatmodell auch den Embedding-Anbieter. Ein Dokument kann schon während der Indexierung an ihn gesendet werden, bevor jemand eine Frage dazu stellt.

</Tip>

## Eine neue Integration prüfen

Bestimme vor dem Anbinden, welche Daten die geplante Aufgabe sendet und welches Konto der Konnektor nutzt. Prüfe die Verarbeitungsbedingungen, begrenze den Zugriff und teste mit unkritischen Beispieldaten. Halte die Entscheidung in deiner [Sicherheitsprüfung](/de/cloud/trust-and-compliance) fest.

## Die Region wechseln

Stimme einen Regionswechsel mit Tale ab. Der Migrationsplan muss gespeicherte Daten, Sicherungen, externe Endpunkte, Unterbrechungen und die Abnahme berücksichtigen. Eine zweite Organisation verschiebt die Daten der ersten nicht.

Die [Migrationsplanung](/de/cloud/migrate-to-self-hosted) enthält Fragen und Prüfschritte, die auch beim Wechsel zwischen Cloud-Regionen gelten.
