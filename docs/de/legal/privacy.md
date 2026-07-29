---
title: Datenschutzerklärung
description: Was Tale erhebt, warum, wie lange es aufbewahrt wird, wer es noch verarbeitet und welche Rechte du an deinen Daten hast.
noindex: true
---

Diese Erklärung beschreibt, wie Tale personenbezogene Daten verarbeitet, wenn du Tale Cloud, die Docs-Seite, die Marketing-Seite oder die Features im Produkt nutzt. Die Form ist dieselbe, ob du Endnutzer, Org-Admin oder Besucher der Docs bist — verschiedene Oberflächen erheben verschiedene Daten, und jede wird unten benannt. Die Erklärung gilt für Tale Cloud; selbst gehostete Instanzen werden von der Organisation betrieben, die sie betreibt, und Verantwortlicher ist diese Organisation, nicht Tale.

Lies das, wenn du wissen willst, was Tale über dich speichert, warum, und wie du es entfernen kannst. Komm zurück, wenn sich die Erklärung ändert — wesentliche Änderungen werden auf der Status-Page angekündigt und an Org-Inhaber per E-Mail geschickt.

## Was wir erheben

Drei Eimer an Daten existieren, jeder mit eigener Aufbewahrungsregel:

- **Konto-Daten.** Name, E-Mail, Organisation, Rolle und die Credentials, mit denen du dich anmeldest. Nötig, um den Dienst zu betreiben.
- **Produkt-Daten.** Alles, was du ins Produkt steckst — Agents, Workflows, Dokumente, Konversationen, Knowledge-Einträge, Connector-Credentials. Gespeichert, solange die Parent-Org existiert; gelöscht beim Org-Löschen oder über den Datenauskunfts-Workflow.
- **Betriebs-Daten.** Server-Logs, Audit-Pfade, Support-Ticket-Inhalte, Performance-Metriken. An dein Konto oder deine Org gebunden, solange die Daten für Sicherheit, Debugging und Compliance nützlich sind — typisch bis zu 90 Tage für Logs und unbefristet für Audit-Pfade.

Wir verkaufen keine personenbezogenen Daten. Wir nutzen Produkt-Daten nicht, um Modelle zu trainieren — deine Konversationen und Dokumente sind in keinem Modell-Trainingssatz, weder unserem noch dem eines Anbieters, ausser wo du ein Feature ausdrücklich aktiviert hast, das das verlangt, und der Einwilligungs-Prompt bestätigt wurde.

## Warum wir es erheben

Die rechtliche Grundlage für jeden Eimer ist eine von:

- **Vertragsnotwendigkeit.** Konto-Daten und die Produkt-Daten, die du anlegst, existieren, weil du uns gebeten hast, den Dienst bereitzustellen. Wir können die Plattform ohne sie nicht betreiben.
- **Berechtigtes Interesse.** Betriebs-Daten werden erhoben, um die Plattform sicher zu halten, Ausfälle zu debuggen und vertragliche SLAs zu erfüllen.
- **Einwilligung.** Marketing-Kommunikation, Analytik auf der Marketing-Seite und jedes Feature, das Daten über den Vertrag hinaus verarbeitet, sind einwilligungsbasiert — opt-in, widerrufbar und protokolliert.

Die Aufschlüsselung der Rechtsgrundlage pro Datenkategorie steht im Auftragsverarbeitungs-Vertrag, der Enterprise-Kunden auf Anfrage zur Verfügung steht.

## Wie lange wir es aufbewahren

| Daten                 | Aufbewahrung                                                                         |
| --------------------- | ------------------------------------------------------------------------------------ |
| Konto-Daten           | Lebensdauer der Org plus 30 Tage nach Löschung                                       |
| Produkt-Daten         | Lebensdauer der Org; sofortige Löschung bei Org-Löschen                              |
| Dokumente und Uploads | Lebensdauer des Parent-Datensatzes; soft-gelöschte Datensätze nach 30 Tagen gepurged |
| Server-Logs           | 90 Tage                                                                              |
| Audit-Logs            | Org-konfigurierbarer Boden; Standard 365 Tage, keine Obergrenze                      |
| Backups               | 30 Tage, verschlüsselt at rest                                                       |

Löschungen folgen dem dokumentierten Datenauskunfts-Workflow im Produkt — siehe die In-Product-Governance-Seite für die Betreiber-Oberfläche.

## Auftragsverarbeiter

Tale Cloud nutzt eine kleine Anzahl Dritter, um den Dienst zu liefern. Jeder ist auf der [Auftragsverarbeiter-Seite](/de/legal/subprocessors) benannt, lokalisiert und im Umfang beschrieben. Wesentliche Änderungen an der Auftragsverarbeiter-Liste werden 30 Tage vor Wirksamwerden angekündigt; Org-Inhaber können über den Support widersprechen und den Vertrag kündigen, wenn der neue Auftragsverarbeiter nicht akzeptabel ist.

## Deine Rechte

Du hast die Rechte aus der DSGVO (und die entsprechenden FADP-Rechte für Schweizer Betroffene): Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch. Die Mechanik:

- **Auskunft und Übertragbarkeit.** Exportier deine Daten aus dem Produkt oder über die API; Roh-Exporte org-bezogener Daten sind auf Anfrage verfügbar.
- **Berichtigung.** Bearbeite Konto-Daten und Produkt-Daten im Produkt. Für Daten, die du nicht erreichst (Server-Logs, Audit-Einträge mit deiner User-ID), reich eine Anfrage über den Support ein.
- **Löschung.** Nutz den Datenauskunfts-Workflow unter **Einstellungen > Governance > Datenauskunfts-Anfragen**. Die Löschung erreicht jeden Dienst, der die Daten hält, einschliesslich Backups via Schlüsselzerstörung.
- **Einschränkung und Widerspruch.** Reich über den Support ein; Tale bestätigt innerhalb von fünf Werktagen.

Kontakt: `privacy@tale.dev`. Für Beschwerden ist die Aufsichtsbehörde die Datenschutzbehörde des Landes, in dem du wohnst.

## Wo das hingehört

Datenschutz ist der Datenverarbeitungs-Vertrag; [Vertrauen und Compliance](/de/cloud/trust-and-compliance) ist der operative Beleg dahinter. Wenn du wissen willst, welche Dritten deine Daten berühren, ist [Auftragsverarbeiter](/de/legal/subprocessors) die Liste; wenn du selbst hostest, verlassen die Daten deine Infrastruktur nicht, und diese Erklärung gilt nur für deine Nutzung der eigenen Oberflächen von Tale (der Docs- und Marketing-Seiten).
