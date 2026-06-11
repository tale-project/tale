---
title: Auftragsverarbeiter
description: Die Drittparteien, die Tale Cloud zur Lieferung des Dienstes einsetzt, was jede davon verarbeitet und wo die Verarbeitung stattfindet.
noindex: true
---

Ein Auftragsverarbeiter ist eine Drittpartei, die Tale beauftragt, personenbezogene Kundendaten in seinem Auftrag zu verarbeiten. Die Liste unten bezieht sich auf Tale Cloud; Self-hosted-Betreiber kontrollieren ihre eigene Infrastruktur, und die Auftragsverarbeiter-Liste solcher Deployments sind die Anbieter, die du wählst. Wesentliche Ergänzungen werden 30 Tage im Voraus angekündigt, und Org-Inhaber werden per E-Mail benachrichtigt.

Lies das, wenn ein Auditor fragt, wer sonst noch deine Daten berührt. Komm zurück, wenn ein Beschaffungs-Review die aktuelle Anbieterliste und den Standort jedes einzelnen braucht. Diese Seite spiegelt **Anhang A** der [Auftragsverarbeitungsvereinbarung](https://tale.dev/de/legal/data-processing-agreement) — beide werden in derselben Änderung aktualisiert. Die Endpunkte und Datenflüsse der Tale-Plattform selbst sind in der öffentlichen [API-Dokumentation](https://demo.tale.dev/docs) beschrieben.

## Keine Nutzung von Kundendaten zum Modell-Training

Tale nutzt Kundendaten — Prompts, Eingaben, Ausgaben, Embeddings, Audio, Bilder oder daraus abgeleitete Artefakte — nicht zum Training, Fine-Tuning oder zur Verbesserung von KI-Modellen. Jeder unten genannte KI-Auftragsverarbeiter ist über seine Enterprise- oder API-Bedingungen mit Tale vertraglich an dasselbe gebunden. Eine Abweichung ist nur durch eine gesonderte, beidseitig unterzeichnete Opt-in-Vereinbarung möglich; die fortgesetzte Nutzung der Leistungen, Einstellungs-Schalter im Produkt oder implizite Zustimmung gelten nicht. Die bindende Klausel steht in [Auftragsverarbeitungsvereinbarung § 5](https://tale.dev/de/legal/data-processing-agreement#5-ki-verarbeitung--keine-nutzung-zum-training-oder-zur-verbesserung).

## Aktuelle Auftragsverarbeiter

Jeder Name verlinkt auf die öffentlich zugängliche AVV (oder gleichwertige Bedingungen) des jeweiligen Anbieters. Zertifizierungen und Trust-Seiten stehen im nächsten Abschnitt. Das Plattform-Hosting folgt der Datenresidenz-Wahl deiner Org: die erste Tabelle gilt für Orgs in der EU/im EWR, die zweite für Schweizer Orgs. KI-Aufrufe (LLM-Inferenz, Audio- und Bild-Verarbeitung) werden für alle Orgs in der EU/im EWR verarbeitet — kein eingesetzter KI-Auftragsverarbeiter betreibt eine Schweizer Region, und keiner dieser Aufrufe wird in Drittstaaten wie den USA verarbeitet.

### Orgs in der EU/im EWR

| Auftragsverarbeiter (Firma)                                                 | Ladungsfähige Adresse                                                                        | Art der Leistung                                                                                                                          | Ort der Verarbeitung                                                                                                                     |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [Akenes SA (Exoscale)](https://www.exoscale.com/dpa/)                       | Boulevard de Grancy 19A, 1006 Lausanne, Schweiz                                              | Bereitstellung der Cloud-Infrastruktur (Rechenzentrum): Hosting der Tale-Cloud-Plattform — VMs, Container-Runtime, Datenbank und Storage. | Deutschland (Region Frankfurt).                                                                                                          |
| [OpenRouter, Inc.](https://openrouter.ai/privacy)                           | 169 Madison Avenue, New York, NY 10016, USA                                                  | Bereitstellung der LLM-Inferenz (Chat, Vision, Embeddings) sowie der Bild-Verarbeitung und -Generierung.                                  | Europäische Union (In-Region-Routing über `eu.openrouter.ai`: Prompts und Antworten werden ausschließlich innerhalb der EU verarbeitet). |
| [OpenAI Ireland Ltd](https://openai.com/policies/data-processing-addendum/) | 1st Floor, The Liffey Trust Centre, 117–126 Sheriff Street Upper, Dublin 1, D01 YC43, Irland | Bereitstellung der Audio-Verarbeitung: Speech-to-Text und Text-to-Speech.                                                                 | Europäische Union/EWR (OpenAI-Datenresidenz-Region Europe, Endpunkt `eu.api.openai.com`).                                                |

### Schweizer Orgs

| Auftragsverarbeiter (Firma)                                                 | Ladungsfähige Adresse                                                                        | Art der Leistung                                                                                                                          | Ort der Verarbeitung                                                                                      |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [Akenes SA (Exoscale)](https://www.exoscale.com/dpa/)                       | Boulevard de Grancy 19A, 1006 Lausanne, Schweiz                                              | Bereitstellung der Cloud-Infrastruktur (Rechenzentrum): Hosting der Tale-Cloud-Plattform — VMs, Container-Runtime, Datenbank und Storage. | Schweiz (Zürich; Disaster-Recovery-Replikat in Genf).                                                     |
| [OpenRouter, Inc.](https://openrouter.ai/privacy)                           | 169 Madison Avenue, New York, NY 10016, USA                                                  | Bereitstellung der LLM-Inferenz (Chat, Vision, Embeddings) sowie der Bild-Verarbeitung und -Generierung.                                  | Europäische Union (In-Region-Routing über `eu.openrouter.ai`).                                            |
| [OpenAI Ireland Ltd](https://openai.com/policies/data-processing-addendum/) | 1st Floor, The Liffey Trust Centre, 117–126 Sheriff Street Upper, Dublin 1, D01 YC43, Irland | Bereitstellung der Audio-Verarbeitung: Speech-to-Text und Text-to-Speech.                                                                 | Europäische Union/EWR (OpenAI-Datenresidenz-Region Europe (EWR + Schweiz), Endpunkt `eu.api.openai.com`). |

Für Schweizer Orgs bleibt das Plattform-Hosting vollständig in der Schweiz. Die KI-Auftragsverarbeiter bieten keine Schweizer Region an; diese Aufrufe werden in der EU/im EWR verarbeitet — alle EU-/EWR-Staaten stehen auf der Staatenliste des Bundesrats nach Art. 16 FADP, die Übermittlung erfordert keine zusätzlichen Garantien.

Zwei Hinweise zu den KI-Auftragsverarbeitern (OpenRouter, OpenAI): jeder wird nur eingesetzt, wenn die jeweilige Funktion einen Aufruf an ihn routet. Eine Org, die keine Audio-Funktionen nutzt, sendet keine Daten an OpenAI; eine, die weder LLM-Inferenz noch Bild-Generierung nutzt, sendet keine Daten an OpenRouter. Modell-Anbieter, die über OpenRouter erreichbar sind (Anthropic, Google, Meta, Mistral usw.), sind Upstream-Anbieter von OpenRouter und keine direkten Auftragsverarbeiter von Tale — sie unterliegen den eigenen Vertragsbedingungen von OpenRouter; das In-Region-Routing beschränkt jeden Aufruf auf Anbieter-Endpunkte innerhalb der EU.

## Zertifizierungen und Trust-Seiten

Jeder Auftragsverarbeiter führt eigene Sicherheitszertifizierungen und veröffentlicht sie auf seiner Trust-Seite:

- **Exoscale (Akenes SA)** — ISO/IEC 27001:2022, ISO/IEC 27017, ISO/IEC 27018, SOC 2 Type II, PCI DSS v4.0, HDS, BSI C5, TISAX. Trust-Seite: [exoscale.com/compliance](https://www.exoscale.com/compliance/).
- **OpenRouter, Inc.** — SOC 2; Nachweise über das zugangsbeschränkte Trust-Portal [trust.openrouter.ai](https://trust.openrouter.ai). Für Übermittlungen außerhalb der EU/des EWR gelten EU-Standardvertragsklauseln.
- **OpenAI Ireland Ltd** — SOC 2 Type 2, ISO/IEC 27001:2022, ISO/IEC 27701:2019, CSA STAR (API- und ChatGPT-Enterprise-Tarife). Trust-Seite: [trust.openai.com](https://trust.openai.com).

## Umfang der Verarbeitung

Für jeden Auftragsverarbeiter:

- **Exoscale (Akenes SA)** betreibt die Tale-Cloud-Middleware, den Anwendungs-State und die unterstützende Infrastruktur auf VMs und Container-Infrastruktur in der von deiner Org gewählten Region (Schweiz: Zürich mit Disaster-Recovery in Genf; EU: Frankfurt). Verschlüsselung at rest stellt Exoscales Storage-Schicht bereit.
- **OpenRouter** verarbeitet Prompts und Antworten des jeweiligen LLM-Aufrufs (Chat, Vision, Embeddings) sowie Bild-Prompts und generierte Bilder. Die Daten gehen über das In-Region-Routing von OpenRouter (`eu.openrouter.ai`) und werden auf Tales Seite nicht als separate Kopie gespeichert.
- **OpenAI** verarbeitet Audio-Payloads für Speech-to-Text und den Texteingang für Text-to-Speech über die EU-Datenresidenz-Region (`eu.api.openai.com`). OpenAI wird nicht für Chat oder andere Nicht-Audio-Inferenz eingesetzt.

## Unter-Auftragsverarbeiter

Jeder Auftragsverarbeiter oben beauftragt eigene Auftragsverarbeiter (Cloud-Hosting, CDN, Secret-Stores). Ihre Listen sind öffentlich und von der Trust-Seite jedes Anbieters verlinkt; Tale verfolgt wesentliche Änderungen an den Upstream-Listen über denselben 30-Tage-Hinweis-Mechanismus.

## Self-hosted: was sich ändert

Wenn du Tale auf eigener Infrastruktur betreibst, sind die einzigen Daten, die Tale in deinem Auftrag verarbeitet, der Support- und Update-Verkehr, dem du zustimmst (Image-Pulls aus der Registry, optionale Telemetrie, Support-Tickets). Die Hosting- und Modell-Anbieter in der Tabelle oben werden von dir betrieben, nicht von Tale; die Auftragsverarbeiter-Liste deines Deployments ist der Stack, den du zusammenstellst.

## Wo das hingehört

Auftragsverarbeiter sind das Anbieter-Inventar; die [Auftragsverarbeitungsvereinbarung](https://tale.dev/de/legal/data-processing-agreement) ist der Vertrag, unter dem sie operieren (Anhang A ist die kanonische Liste); die [Datenschutzerklärung](/de/legal/privacy) ist die nutzerseitige Erklärung; [Vertrauen und Compliance](/de/cloud/trust-and-compliance) ist der operative Beleg. Ein Auditor will die vier meist zusammen — die Anbieterliste, den Vertrag, die Erklärung und die Kontrollen — daher sind die verlinkten Seiten wechselseitig konsistent und werden in derselben Änderung aktualisiert.
