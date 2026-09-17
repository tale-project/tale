---
title: Eine Installationsmethode wählen
description: Installiere eine Umgebung mit der Tale-CLI oder setze die dokumentierte Dienstarchitektur mit deinen eigenen Infrastrukturwerkzeugen um.
---

Für eine gewöhnliche Installation nutzt du die Tale-CLI. Ein eigener Stack ist sinnvoll, wenn deine Infrastrukturwerkzeuge die Dienstdefinitionen verwalten müssen. Beide Wege brauchen dieselben Anwendungsdienste und eine verantwortliche Person für Konfiguration und Wartung.

## Mit der CLI installieren

Der [Schnellstart](/de/self-hosted/install/quickstart) führt dich durch Voraussetzungen, Projekterstellung, Start und erste Anmeldung. `tale init` bereitet ein Projektverzeichnis vor. `tale dev` startet eine Entwicklungsinstanz; `tale deploy` führt das Deployment dieser Umgebung aus.

Die CLI übernimmt Containeraktionen. Für Konfiguration, Zugangsdaten, Volumes und Updates bleibst du verantwortlich. Bewahre das Projektverzeichnis zusammen mit seinen Deployment-Einstellungen auf. [CLI installieren](/de/self-hosted/install/cli-install) beschreibt unterstützte Systeme, den Zugriff auf einen entfernten Docker-Host, Befehle und verwaltete Deployments.

## Eigene Dienstdefinitionen verwenden

[Einen eigenen Stack betreiben](/de/self-hosted/install/own-compose) beschreibt Dienste, Volumes, Netzwerk, Bereitschaftsprüfungen und Startreihenfolge. Nutze die Anleitung, wenn du Compose selbst pflegst. [Auf Kubernetes bereitstellen](/de/self-hosted/install/kubernetes) überträgt diesen Vertrag in Deployments, Services und NetworkPolicies und nennt die Prüfungen, die ein Cluster bestehen muss. Tale liefert kein offizielles Helm-Chart.

Für Änderungen am Tale-Quellcode richtest du eine [Entwicklungsumgebung](/de/develop/contributor-setup) ein, statt mit einem Produktionsdeployment zu beginnen.

## Die Ersteinrichtung abschließen

Sobald die Instanz bereit ist, [erstellst du das erste Administratorkonto](/de/self-hosted/install/first-admin), verbindest einen Anbieter und testest einen Chat. Weitere Nutzer fügst du über [Mitglieder und Rollen](/de/platform/admin/members-and-roles) hinzu. Welche Konto- und Anmeldeoptionen verfügbar sind, hängt von deiner Organisation ab.

Richte vor der Arbeit mit Produktionsdaten TLS und Backups ein. Prüfe die [Umgebungseinstellungen](/de/self-hosted/configuration/environment-reference) und lies die [Betriebsarchitektur](/de/self-hosted/operate/container-architecture).
