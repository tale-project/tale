---
title: Auftragsverarbeiter
description: Die Drittparteien, die Tale Cloud zur Lieferung des Dienstes einsetzt, was jede davon verarbeitet und wo die Verarbeitung stattfindet.
noindex: true
---

Ein Auftragsverarbeiter ist eine Drittpartei, die Tale beauftragt, personenbezogene Kundendaten in seinem Auftrag zu verarbeiten. Die Liste unten bezieht sich auf Tale Cloud; Self-hosted-Betreiber kontrollieren ihre eigene Infrastruktur, und die Auftragsverarbeiter-Liste solcher Deployments sind die Anbieter, die du wählst. Wesentliche Ergänzungen werden 30 Tage im Voraus angekündigt, und Org-Inhaber werden per E-Mail benachrichtigt.

Lies das, wenn ein Auditor fragt, wer sonst noch deine Daten berührt. Komm zurück, wenn ein Beschaffungs-Review die aktuelle Anbieterliste und den Standort jedes einzelnen braucht. Diese Seite spiegelt **Anhang A** der [Auftragsverarbeitungsvereinbarung](/de/legal/data-processing-agreement) — beide werden in derselben Änderung aktualisiert. Die Endpunkte und Datenflüsse der Tale-Plattform selbst sind in der öffentlichen [API-Dokumentation](https://demo.tale.dev/docs) beschrieben.

## Keine Nutzung von Kundendaten zum Modell-Training

Tale nutzt Kundendaten — Prompts, Eingaben, Ausgaben, Embeddings, Audio, Bilder oder daraus abgeleitete Artefakte — nicht zum Training, Fine-Tuning oder zur Verbesserung von KI-Modellen. Jeder unten genannte KI-Auftragsverarbeiter ist über seine Enterprise- oder API-Bedingungen mit Tale vertraglich an dasselbe gebunden. Eine Abweichung ist nur durch eine gesonderte, beidseitig unterzeichnete Opt-in-Vereinbarung möglich; die fortgesetzte Nutzung der Leistungen, Einstellungs-Schalter im Produkt oder implizite Zustimmung gelten nicht. Die bindende Klausel steht in [Auftragsverarbeitungsvereinbarung § 5](/de/legal/data-processing-agreement#5-ki-verarbeitung--keine-nutzung-zum-training-oder-zur-verbesserung).

## Aktuelle Auftragsverarbeiter

Jeder Name verlinkt auf die öffentlich zugängliche AVV (oder gleichwertige Bedingungen) des jeweiligen Anbieters. Zertifizierungen und Trust-Seiten stehen im nächsten Abschnitt. Der Verarbeitungsort wird pro Kunde gewählt: Schweiz für Schweizer Kunden, Europäische Union für alle übrigen Kunden. Tale routet jeden Aufruf an eine Region, die der Datenresidenz-Wahl des Kunden entspricht.

| Auftragsverarbeiter                                             | Zweck                                                                           | Datenkategorien                                                                 | Standort                                         | Training auf Kundendaten                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------- |
| [Exoscale](https://www.exoscale.com/dpa/)                       | Cloud-Hosting für die Tale-Cloud-Middleware (VMs und Container-Runtime).        | Anwendungs-Daten in Transit und at rest auf der gehosteten Runtime und Storage. | Schweiz (Schweizer Kunden) / EU (übrige Kunden). | Nein (nur Infrastruktur; kein KI-Training).                 |
| [OpenRouter](https://openrouter.ai/privacy)                     | LLM-Inferenz (Chat, Vision, Embeddings).                                        | Prompts und Antworten für den jeweiligen Inferenz-Aufruf.                       | Schweiz (Schweizer Kunden) / EU (übrige Kunden). | Nein — vertraglich untersagt.                               |
| [OpenAI](https://openai.com/policies/data-processing-addendum/) | Ausschließlich Audio-Verarbeitung: Speech-to-Text (Whisper) und Text-to-Speech. | Audio-Payloads und transkribierter oder synthetisierter Text des Aufrufs.       | Schweiz (Schweizer Kunden) / EU (übrige Kunden). | Nein — vertraglich untersagt (Enterprise-/API-Bedingungen). |
| [Vercel AI Gateway](https://vercel.com/legal/dpa)               | Bild-Verarbeitung und -Generierung.                                             | Bild-Prompts und generierte Bilder des jeweiligen Aufrufs.                      | Schweiz (Schweizer Kunden) / EU (übrige Kunden). | Nein — vertraglich untersagt.                               |

Zwei Hinweise zu den KI-Auftragsverarbeitern (OpenRouter, OpenAI, Vercel AI Gateway): jeder wird nur eingesetzt, wenn die jeweilige Funktion einen Aufruf an ihn routet. Eine Org, die keine Audio-Funktionen nutzt, sendet keine Daten an OpenAI; eine, die keine Bild-Generierung nutzt, sendet keine Daten an Vercel AI Gateway. Modell-Anbieter, die über OpenRouter erreichbar sind (Anthropic, Google, Meta, Mistral usw.), sind Upstream-Anbieter von OpenRouter und keine direkten Auftragsverarbeiter von Tale — sie unterliegen den eigenen Vertragsbedingungen von OpenRouter.

## Zertifizierungen und Trust-Seiten

Jeder Auftragsverarbeiter führt eigene Sicherheitszertifizierungen und veröffentlicht sie auf seiner Trust-Seite:

- **Exoscale** — ISO/IEC 27001:2022, ISO/IEC 27017, ISO/IEC 27018, SOC 2 Type II, PCI DSS v4.0, HDS, BSI C5, TISAX. Trust-Seite: [exoscale.com/compliance](https://www.exoscale.com/compliance/).
- **OpenRouter** — keine gesondert veröffentlichten Zertifizierungen. Der Anbieter operiert unter seinen [Terms of Service](https://openrouter.ai/terms) und der [Privacy Policy](https://openrouter.ai/privacy); für grenzüberschreitende Übermittlungen gelten EU-Standardvertragsklauseln.
- **OpenAI** — SOC 2 Type 2, ISO/IEC 27001:2022, ISO/IEC 27701:2019, CSA STAR (API- und ChatGPT-Enterprise-Tarife). Trust-Seite: [trust.openai.com](https://trust.openai.com).
- **Vercel AI Gateway** — abgedeckt durch die Enterprise-Zertifizierungen von Vercel: SOC 2 Type 2, ISO/IEC 27001, PCI DSS, HIPAA, TISAX L2, EU-US- / Swiss-US- / UK-Data-Privacy-Framework. Trust-Seite: [security.vercel.com](https://security.vercel.com/).

## Umfang der Verarbeitung

Für jeden Auftragsverarbeiter:

- **Exoscale** betreibt die Tale-Cloud-Middleware, den Anwendungs-State und die unterstützende Infrastruktur auf VMs und Container-Infrastruktur in der vom Kunden gewählten Region (Schweiz für Schweizer Kunden, EU für übrige). Verschlüsselung at rest stellt Exoscales Storage-Schicht bereit.
- **OpenRouter** verarbeitet Prompts und Antworten des jeweiligen LLM-Aufrufs (Chat, Vision, Embeddings). Die Daten gehen über die OpenRouter-API und werden auf Tales Seite nicht als separate Kopie gespeichert.
- **OpenAI** verarbeitet Audio-Payloads für Speech-to-Text (Whisper) und den Texteingang für Text-to-Speech. OpenAI wird nicht für Chat oder andere Nicht-Audio-Inferenz eingesetzt.
- **Vercel AI Gateway** verarbeitet Bild-Prompts und die generierten Bilder des jeweiligen Aufrufs. Es wird nicht für Chat, Audio oder Embedding-Workloads eingesetzt.

## Unter-Auftragsverarbeiter

Jeder Auftragsverarbeiter oben beauftragt eigene Auftragsverarbeiter (Cloud-Hosting, CDN, Secret-Stores). Ihre Listen sind öffentlich und von der Trust-Seite jedes Anbieters verlinkt; Tale verfolgt wesentliche Änderungen an den Upstream-Listen über denselben 30-Tage-Hinweis-Mechanismus.

## Self-hosted: was sich ändert

Wenn du Tale auf eigener Infrastruktur betreibst, sind die einzigen Daten, die Tale in deinem Auftrag verarbeitet, der Support- und Update-Verkehr, dem du zustimmst (Image-Pulls aus der Registry, optionale Telemetrie, Support-Tickets). Die Hosting- und Modell-Anbieter in der Tabelle oben werden von dir betrieben, nicht von Tale; die Auftragsverarbeiter-Liste deines Deployments ist der Stack, den du zusammenstellst.

## Wo das hingehört

Auftragsverarbeiter sind das Anbieter-Inventar; die [Auftragsverarbeitungsvereinbarung](/de/legal/data-processing-agreement) ist der Vertrag, unter dem sie operieren (Anhang A ist die kanonische Liste); die [Datenschutzerklärung](/de/legal/privacy) ist die nutzerseitige Erklärung; [Vertrauen und Compliance](/de/cloud/trust-and-compliance) ist der operative Beleg. Ein Auditor will die vier meist zusammen — die Anbieterliste, den Vertrag, die Erklärung und die Kontrollen — daher sind die verlinkten Seiten wechselseitig konsistent und werden in derselben Änderung aktualisiert.
