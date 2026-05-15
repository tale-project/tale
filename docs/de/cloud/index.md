---
title: Tale Cloud
description: Tale als Managed-Edition — Ruler GmbH betreibt die Plattform in der Schweiz und in der EU, mit demselben Funktionsumfang wie die selbst gehostete Edition.
---

Tale Cloud ist die Managed-Edition der Plattform. Ruler GmbH betreibt die Infrastruktur, hält sie gepatcht und gesichert, und bindet deinen Mandanten an ein Schweizer oder EU-Rechenzentrum — dein Team konzentriert sich darauf, Agents zu bauen, Wissen zu pflegen und Workflows auszuliefern. Cloud läuft auf demselben Code wie [selbst gehostet](/de/self-hosted), sodass jede unter [Platform](/de/platform) dokumentierte Funktion am ersten Tag verfügbar ist.

Wähle Cloud, wenn Tales Funktionsumfang wichtiger ist als der genaue physische Speicherort der Bytes, wenn ISO-27001- / SOC-2- / DSGVO-Konformität eine harte Anforderung ist, und wenn das Team lieber kein Docker Compose betreibt, keine Upgrades fahrt und keine Metric-Dashboards beobachtet. Wähle [selbst gehostet](/de/self-hosted), wenn Souveränität „hinter unserer Firewall" bedeutet, wenn Air-Gap oder eigenes Netzwerk Pflicht sind, oder wenn ein eigener Build der Plattform auf dem Tisch liegt.

## Cloud vs. selbst gehostet

Die beiden Editionen liefern dasselbe Produkt. Die Unterschiede sind operativer Natur.

| Dimension        | Cloud                                                  | Selbst gehostet                                                |
| ---------------- | ------------------------------------------------------ | -------------------------------------------------------------- |
| Betreiber        | Ruler GmbH                                             | Dein Team                                                      |
| Hosting          | Schweiz oder EU, pro Mandant gebunden                  | Deine Infrastruktur, überall                                   |
| Upgrades         | Automatisch, Blue-Green, Zero-Downtime                 | `tale deploy` in deinem Rhythmus                               |
| Funktionsparität | Identisch zu selbst gehostet                           | Identisch zu Cloud                                             |
| Netzwerk         | Öffentliches HTTPS auf `*.tale.cloud` oder Eigendomain | Was dein VPC und Proxy-Stack hergeben                          |
| Am besten für    | Teams, die Tale ohne operativen Aufwand wollen         | Teams mit Souveränitäts-, Air-Gap- oder Eigenbau-Anforderungen |

## Infrastruktur

Tale Cloud läuft auf [Exoscale](https://www.exoscale.com/), einem Schweizer Cloud-Anbieter. Mandanten werden an eines von [Exoscales europäischen Rechenzentren](https://www.exoscale.com/datacenters/) (Schweiz oder EU) gebunden, und Exoscale hält eine [BSI-C5-Type-2-Attestierung](https://www.exoscale.com/compliance/bsi-c5/), die die Compute-, Storage- und Netzwerk-Infrastruktur abdeckt, auf der Tale läuft.

Dieselbe Fünf-Service-Architektur, die unter [Selbst-hosted-Übersicht](/de/self-hosted/overview) dokumentiert ist, steht hinter der Cloud-Edition — Platform, RAG, Crawler, Datenbank, Proxy — Blue-Green betrieben, sodass Upgrades Anfragen nie verlieren. Der Unterschied: Ruler GmbH betreibt und beobachtet diese Services, sodass der Kunde es nicht muss.

## In diesem Bereich

Die Cloud-Kapitel decken ab, was sich ändert, wenn Tale für dich betrieben wird — Onboarding, Abrechnung, regionale Datenresidenz, die Trust-Posture, und die Untermenge der Admin-Aktionen, die es nur auf Cloud gibt (gehostetes SSO, eigene Domains, Audit-Log-Export). Jedes Kapitel folgt dem Ein-Zeilen-pro-Link-Schema: lies den Titel, scanne die Beschreibung, öffne die Seite, wenn sie deine ist.

- **Cloud-Onboarding** — anmelden, Organisation anlegen, Sitze einladen, einen Anbieter verbinden. _(Seite wird im Rahmen der Doku-Überarbeitung neu geschrieben; bis dahin gilt der [Mitglied-Einstieg](/de/platform/member/overview) — der Produktablauf ist auf beiden Editionen gleich.)_

Jede Funktions-Anleitung — Chat, Wissensdatenbank, Agents, Automatisierungen, Integrationen, Admin — lebt in [Platform](/de/platform) und gilt hier identisch. Sobald der Mandant bereitgestellt ist, ist das der Bereich zum Bleiben.

## Wo das einsetzt

Cloud ist die bequeme Eingangstür zu Tale. Nach dem Onboarding sitzt jede sinnvolle Seite — der Agent-Build-Flow, die Wissensdatenbank-Pflege, der Automatisierungs-Editor, die Governance- und Audit-Oberflächen — unter [Platform](/de/platform). Die Cloud-spezifischen Kapitel behandeln Abrechnung und die Trust-Posture; das Produkt selbst wird einmal für beide Editionen dokumentiert.
