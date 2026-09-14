---
title: Tale auf deiner Infrastruktur betreiben
description: Wähle eine Installationsmethode, kläre die Verantwortung für den Betrieb und finde die passenden Konfigurations- und Wartungsanleitungen.
kind: index
---

Mit selbst gehostetem Tale bestimmt deine Organisation, wo die Anwendung läuft, wo Daten gespeichert werden und welche Modelle sie nutzt. Die Open-Source-Plattform bietet dieselben Produktfunktionen wie die Enterprise-Ausgabe. Dein Team betreibt die Infrastruktur und legt fest, welche externen Dienste sie erreichen darf.

## Den passenden Einstieg wählen

| Dein Vorhaben | Einstieg |
| --- | --- |
| Eine lokale Instanz testen oder eine neue Umgebung installieren | [Schnellstart zur Installation](/de/self-hosted/install/quickstart) |
| Dienste, Datenhaltung und Netzwerkverbindungen verstehen | [Architekturübersicht](/de/self-hosted/overview) |
| Ein eigenes Compose- oder Kubernetes-Deployment aufsetzen | [Einen eigenen Stack betreiben](/de/self-hosted/install/own-compose) |
| Den Quellcode der Anwendung ändern | [Entwicklungsumgebung einrichten](/de/develop/contributor-setup) |
| Eine bereits betriebene Instanz nutzen | [Deine erste Nachricht senden](/de/get-started/quickstart) |

## Die Betriebsverantwortung klären

Lege fest, wer Zugriff, TLS, Updates, Backups, Überwachung und Störungen betreut, bevor du weitere Nutzer hinzufügst. Richte einen KI-Anbieter ein. Für durchsuchbare Dokumente brauchst du außerdem ein Embedding-Modell und den Wissensspeicher. Teste einen Upload und einen vollständigen Chat, bevor du die Instanz freigibst.

Selbst zu hosten bedeutet nicht, dass jede Anfrage im eigenen Netzwerk bleibt. Ein konfigurierter Modellanbieter, Connector, Webcrawler oder externer Überwachungsdienst kann Daten erhalten. Prüfe die tatsächlichen Ziele anhand der [Sicherheitshärtung](/de/self-hosted/operate/security/hardening) und der Anbieterkonfiguration. Für eine isolierte Installation müssen Images, Modelle, Zugangsdaten und Abhängigkeiten lokal verfügbar sein.

## Die Instanz konfigurieren und warten

Die [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference) beschreibt Deployment-Variablen; die Konfigurationsanleitungen behandeln Organisationseinstellungen. Die [Container-Architektur](/de/self-hosted/operate/container-architecture) erklärt die Abhängigkeiten im Betrieb. [Backups und Wiederherstellung](/de/self-hosted/operate/backups-and-restore) hilft dir bei der Wiederherstellungsplanung.

Soll Tale den Dienst für dein Team betreiben, lies [Tale Cloud](/de/cloud). Die Plattformanleitungen gelten für beide Hosting-Varianten.
