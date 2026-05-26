---
title: Auftragsverarbeiter
description: Die Drittparteien, die Tale Cloud zur Lieferung des Dienstes einsetzt, was jede davon verarbeitet und wo die Verarbeitung stattfindet.
noindex: true
---

Ein Auftragsverarbeiter ist eine Drittpartei, die Tale beauftragt, personenbezogene Kundendaten in seinem Auftrag zu verarbeiten. Die Liste unten bezieht sich auf Tale Cloud; Self-hosted-Betreiber kontrollieren ihre eigene Infrastruktur, und die Auftragsverarbeiter-Liste solcher Deployments sind die Anbieter, die du wählst. Wesentliche Ergänzungen werden 30 Tage im Voraus angekündigt, und Org-Inhaber werden per E-Mail benachrichtigt.

Lies das, wenn ein Auditor fragt, wer sonst noch deine Daten berührt. Komm zurück, wenn ein Beschaffungs-Review die aktuelle Anbieterliste und den Standort jedes einzelnen braucht.

## Aktuelle Auftragsverarbeiter

| Auftragsverarbeiter | Zweck                                            | Datenkategorien                                             | Standort           |
| ------------------- | ------------------------------------------------ | ----------------------------------------------------------- | ------------------ |
| Convex              | Anwendungs-Datenbank und Backend-Plattform.      | Konto-Daten, Produkt-Daten, Betriebs-Metadaten.             | Vereinigte Staaten |
| Cloudflare          | DNS, Edge-TLS und DDoS-Schutz für Tale Cloud.    | Verbindungs-Metadaten, IP-Adressen, Request-Header.         | Globaler Edge      |
| Anthropic           | Claude-Modell-API für Chat und Agent-Ausführung. | Prompt- und Response-Payload für gerouteter Claude-Aufrufe. | Vereinigte Staaten |
| OpenAI              | GPT-Modell-API für Chat und Agent-Ausführung.    | Prompt- und Response-Payload für gerouteter OpenAI-Aufrufe. | Vereinigte Staaten |
| OpenRouter          | Modell-Router für Drittanbieter-Modelle.         | Prompt- und Response-Payload für gerouteter Router-Aufrufe. | Vereinigte Staaten |

Zwei Hinweise zu den Modell-Anbietern (Anthropic, OpenAI, OpenRouter): jeder wird nur beauftragt, wenn die Org-Konfiguration des Kunden einen Aufruf an diesen Anbieter routet. Eine Org, die nur Anthropic-Modelle nutzt, hat keinen Datenfluss zu OpenAI oder OpenRouter und umgekehrt. Die konfigurierten Anbieter pro Org sind für Org-Inhaber unter **Einstellungen > Anbieter** sichtbar.

## Umfang der Verarbeitung

Für jeden Auftragsverarbeiter:

- **Convex** verarbeitet alles, was die Plattform speichert — die Datenbank ist das dauerhafte Substrat für Konto-, Produkt- und Betriebs-Daten. Verschlüsselung at rest stellt Convex bereit.
- **Cloudflare** verarbeitet nur Daten der Verbindungs-Schicht. TLS terminiert am Edge und re-verschlüsselt zum Origin; Cloudflare sieht Anwendungs-Schicht-Payloads nur insoweit im Klartext, wie es zum Routen der Anfrage nötig ist.
- **Anthropic, OpenAI, OpenRouter** verarbeitet je das Prompt- und Response-Payload für den spezifischen Inference-Aufruf, der zu ihnen geroutet wird. Die Daten gehen über die API des Anbieters, werden auf Tales Seite nicht als separate Kopie gespeichert, und die Aufbewahrungsrichtlinie des Anbieters gilt für diese Kopie. Tales vertragliche Bedingungen mit jedem Anbieter untersagen die Nutzung von Kunden-Payloads zum Modell-Training.

## Unter-Auftragsverarbeiter

Jeder Auftragsverarbeiter oben beauftragt eigene Auftragsverarbeiter (Cloud-Hosting, CDN, Secret-Stores). Ihre Listen sind öffentlich und von der Trust-Seite jedes Anbieters verlinkt; Tale verfolgt wesentliche Änderungen an den Upstream-Listen über denselben 30-Tage-Hinweis-Mechanismus.

## Self-hosted: was sich ändert

Wenn du Tale auf eigener Infrastruktur betreibst, sind die einzigen Daten, die Tale in deinem Auftrag verarbeitet, der Support- und Update-Verkehr, dem du zustimmst (Image-Pulls aus der Registry, optionale Telemetrie, Support-Tickets). Die Modell-Anbieter, die Datenbank und der Edge in der Tabelle oben werden von dir betrieben, nicht von Tale; die Auftragsverarbeiter-Liste deines Deployments ist der Stack, den du zusammenstellst.

## Wo das hingehört

Auftragsverarbeiter sind das Anbieter-Inventar; die [Datenschutzerklärung](/de/legal/privacy) ist die Erklärung, unter der sie operieren; [Vertrauen und Compliance](/de/cloud/trust-and-compliance) ist der operative Beleg. Ein Auditor will die drei meist zusammen — die Anbieterliste, die Erklärung und die Kontrollen — daher sind die verlinkten Seiten wechselseitig konsistent und werden in derselben Änderung aktualisiert.
