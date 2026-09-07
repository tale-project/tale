---
title: Installation
description: Zwei Wege, Tale zu betreiben — die CLI, oder ein Stack, den du selbst schreibst (Compose oder Kubernetes).
---

Tale zu installieren hat zwei Formen. Die CLI umhüllt Docker Compose, sodass du keine Datei editierst. Den Stack selbst zu schreiben ist der Weg, wenn genau dieser Wrapper das ist, was du nicht fahren kannst — eine Compose-Datei, oder ein Kubernetes-Mapping desselben Vertrags.

## Die CLI

Installier die CLI, dann `tale init` und entweder `tale dev` oder `tale deploy`. Dasselbe Projektverzeichnis ist die Einheit: ein Laptop-Trial wird ohne Neu-Init zum Produktions-Host.

- [Quickstart](/de/self-hosted/install/quickstart) — `tale init`, dann `tale dev` oder `tale deploy`.
- Nach dem ersten Boot macht [Erster Admin](/de/self-hosted/install/first-admin) das erste Konto zum **Owner**. Alle danach kommen per Einladung.
- [CLI installieren](/de/self-hosted/install/cli-install) ist der Installer und die Remote-Workstation-Hälfte (`DOCKER_HOST`).

## Den Stack selbst schreiben

Es gibt kein offizielles Helm-Chart. Der Vertrag ist derselbe, ob du Compose schreibst oder Kubernetes: welche Services Zustand halten, die DNS-Namen, die Probes, die Volumes, und was eine Datei, die du pflegst, nicht für dich tut.

[Compose selbst fahren](/de/self-hosted/install/own-compose) ist diese Seite.

## Wo das hingehört

Wähl danach, was du betreiben willst. Der [Quickstart](/de/self-hosted/install/quickstart) ist der CLI-Weg — Laptop oder Produktions-Host. Der Compose-oder-Cluster-Weg ist für Air-Gap und bestehende Automation.

Einmal installiert, sind die [Konfigurations](/de/self-hosted/configuration/environment-reference)-Seiten jede Umgebungsvariable und Provider-Datei, und [Betrieb](/de/self-hosted/operate/container-architecture) deckt Upgrades, Backups und Observability ab.
