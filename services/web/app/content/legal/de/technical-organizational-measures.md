---
title: Technische und organisatorische Maßnahmen
description: Die technischen und organisatorischen Maßnahmen, die die Ruler GmbH zum Schutz personenbezogener Daten umsetzt, die im Auftrag von Tale-Kunden verarbeitet werden.
noindex: true
---

**Letzte Aktualisierung:** 01.05.2026

Dieses Dokument beschreibt die technischen und organisatorischen Maßnahmen ("TOM"), die die Ruler GmbH ("Tale") zum Schutz personenbezogener Daten umsetzt, die im Auftrag ihrer Kunden verarbeitet werden, wie in Abschnitt 7 der [Auftragsverarbeitungsvereinbarung](/de/legal/data-processing-agreement) referenziert. Es gilt für Tale Cloud. Self-Hosted-Deployments werden vom Kunden betrieben; dort bestimmt und setzt der Kunde eigene Maßnahmen um, während Tale gehärtete Defaults und dokumentierte Kontrollen bereitstellt.

Tale überprüft diese Maßnahmen mindestens einmal jährlich und kann sie aktualisieren, sofern das Gesamtniveau des Schutzes personenbezogener Daten nicht wesentlich abnimmt.

## 1. Vertraulichkeit

### 1.1 Zutrittskontrolle — physisch

Tale betreibt keine eigenen Rechenzentren. Die physische Infrastruktur wird durch die in Anhang A der [Auftragsverarbeitungsvereinbarung](/de/legal/data-processing-agreement) gelisteten Unterauftragsverarbeiter bereitgestellt. Jeder Anbieter ist nach ISO/IEC 27001 (oder gleichwertig) zertifiziert und betreibt Zutrittskontrollen einschließlich 24/7-Personal, Videoüberwachung, Badge- oder biometrischem Zugang, Schleusen und Besucherprotokollen. Nachweise sind auf Anfrage über die Trust-Seiten der Unterauftragsverarbeiter verfügbar.

### 1.2 Zugangskontrolle — Systeme

a) Multi-Faktor-Authentifizierung ist für jeden Tale-Mitarbeitenden mit Produktionszugang obligatorisch.

b) Zugang zu Produktionssystemen wird nach dem Least-Privilege- und Need-to-Know-Prinzip vergeben und mindestens vierteljährlich überprüft.

c) Personalzugang wird über einen zentralen Identitätsanbieter bereitgestellt und innerhalb eines Werktags nach Rollenwechsel oder Austritt entzogen.

d) Privilegierte Operationen erfordern ein genehmigtes Change-Ticket und werden mit Akteur, Aktion und Zeitstempel protokolliert.

e) Der Kundenzugang zur Plattform wird per E-Mail und Passwort (mit optionalem WebAuthn- oder TOTP-Zweitfaktor) oder per SSO (OIDC) authentifiziert, wenn der Kunde dies konfiguriert hat.

### 1.3 Zugriffskontrolle — Daten

a) Personenbezogene Daten werden auf Anwendungsebene mandantenisoliert; jede Datenbankabfrage ist auf die anfragende Organisation eingegrenzt.

b) Produktionsdaten werden nie in Nicht-Produktionsumgebungen kopiert. Für Entwicklung und Tests werden synthetische oder anonymisierte Daten verwendet.

c) Vom Kunden ausgestellte API-Keys werden im Ruhezustand gehasht und sind über die Admin-Oberfläche widerrufbar.

### 1.4 Trennungskontrolle

a) Jede Kundenorganisation ist ein separater logischer Mandant; Mandantenkennungen sind in jeder Zeile der Datenbank vorhanden und werden auf Abfrageebene durchgesetzt.

b) Backups werden pro Mandantenschlüssel verschlüsselt; eine Wiederherstellung in einen anderen Mandanten wird auf Ebene der Schlüsselverwaltung verhindert.

c) Workloads laufen in isolierten Containern; Netzwerkrichtlinien verhindern mandantenübergreifenden Verkehr.

### 1.5 Pseudonymisierung und Verschlüsselung

a) Personenbezogene Daten werden während der Übertragung mit TLS 1.2 oder höher verschlüsselt, mit erzwungenem HSTS auf jedem öffentlichen Endpunkt.

b) Personenbezogene Daten werden im Ruhezustand mit AES-256 (oder gleichwertig) auf Speicherebene verschlüsselt.

c) Verschlüsselungsschlüssel werden vom Key Management Service des Cloud-Unterauftragsverarbeiters verwaltet; eine Schlüsselrotation erfolgt mindestens einmal jährlich.

d) Wo Pseudonymisierung ohne Funktionsverlust möglich ist, bevorzugt Tale pseudonyme Kennungen gegenüber Klartextidentifikatoren in Logs und Analysen.

## 2. Integrität

### 2.1 Weitergabekontrolle

a) Sämtlicher Eingangs- und Ausgangsverkehr über öffentliche Netze wird während der Übertragung verschlüsselt.

b) Interner Service-zu-Service-Verkehr verwendet authentifiziertes mTLS oder signierte Tokens.

c) Aufrufe an KI-Unterauftragsverarbeiter werden in eine Region geroutet, die der Datenresidenzwahl des Kunden entspricht (Schweiz oder EU); das Routing wird serverseitig durchgesetzt.

### 2.2 Eingabekontrolle

a) Jede administrative Aktion in der Plattform wird in einem unveränderlichen Audit-Log mit Akteur, betroffener Ressource und Zeitstempel erfasst.

b) Audit-Logs werden für die vom Kunden konfigurierte Dauer aufbewahrt (Default 365 Tage, ohne Obergrenze) und werden durch Snapshot-Wiederherstellungen nicht verändert.

c) System-Logs von Infrastrukturkomponenten werden 90 Tage aufbewahrt und sind nur für autorisiertes Tale-Personal zugänglich.

## 3. Verfügbarkeit und Belastbarkeit

### 3.1 Verfügbarkeitskontrolle

a) Anwendungsdienste laufen in redundanten Konfigurationen hinter Load Balancern, mit automatischem Failover zwischen Verfügbarkeitszonen innerhalb der gewählten Region.

b) Das Monitoring deckt Verfügbarkeit, Fehlerraten, Latenz und Queue-Tiefe ab; On-Call-Engineers werden bei Schwellwertüberschreitungen alarmiert.

c) Die Statusseite von Tale veröffentlicht Vorfallsbenachrichtigungen und historische Verfügbarkeitsdaten.

### 3.2 Wiederherstellbarkeit

a) Tale erstellt täglich Snapshots der Anwendungsdatenbanken und stündlich des Objektspeichers. Snapshots werden im Ruhezustand mit vom Cloud-Unterauftragsverarbeiter verwalteten Schlüsseln verschlüsselt.

b) Eine Disaster-Recovery-Replik wird innerhalb der vom Kunden gewählten Region vorgehalten (Genf für die Schweiz, Dublin für die Europäische Union).

c) Wiederherstellungen aus Snapshots werden vom Kunden über den Support angestoßen und erfüllen das im Service Agreement genannte Recovery Time Objective.

d) Die Backup-Integrität wird mindestens vierteljährlich durch Wiederherstellung eines repräsentativen Snapshots in eine isolierte Umgebung verifiziert.

### 3.3 Kapazität und Leistung

a) Produktionsumgebungen sind auf die erwartete Spitzenlast dimensioniert und werden mit wachsender Auslastung horizontal skaliert.

b) Rate-Limits und Back-Pressure-Mechanismen verhindern, dass ein einzelner Mandant den Dienst für andere beeinträchtigt.

## 4. Verfahren zur regelmäßigen Überprüfung, Bewertung und Evaluierung

### 4.1 Schwachstellenmanagement

a) Tale führt bei jedem Commit automatisiertes Dependency-Scanning durch und verfolgt Sicherheits­hinweise zu allen Produktions­abhängigkeiten.

b) Sicherheits­patches werden innerhalb der in Tales Schwachstellen­management­richtlinie vorgegebenen Fristen eingespielt: kritisch innerhalb von 7 Tagen, hoch innerhalb von 30 Tagen, mittel innerhalb von 90 Tagen.

c) Container-Images werden mindestens monatlich neu gebaut, um vorgelagerte Sicherheits­aktualisierungen aufzunehmen.

### 4.2 Penetrationstests

a) Tale beauftragt mindestens jährlich einen externen Penetrationstest. Befunde werden nach Schweregrad behoben, und ein Attestschreiben ist Kunden auf Anfrage unter NDA über den Support verfügbar.

### 4.3 Audits und Zertifizierungen

a) Tale unterhält für Tale Cloud Zertifizierungen nach ISO/IEC 27001 und SOC 2 Type II (oder gleichwertige Standards).

b) Kunden können Kopien des aktuellen SOC-2-Type-II-Berichts und des ISO-27001-Zertifikats beim Support anfordern; beide werden unter NDA ausgehändigt.

### 4.4 Interne Überprüfung

a) Das Security-Team überprüft Zugriffsprotokolle, Konfigurationsabweichungen und Vorfallsmuster fortlaufend wöchentlich.

b) Das Privacy-Team überprüft die Bearbeitung von Betroffenenanfragen und das Aufbewahrungs­verhalten mindestens vierteljährlich.

c) Wesentliche Befunde aus jeder Überprüfung fließen in einen verfolgten Behebungs-Backlog mit Verantwortlichen und Fristen zurück.

## 5. Vorfallreaktion

### 5.1 Vorfallserkennung

a) Produktionssysteme senden Telemetrie an eine zentrale Logging- und Monitoring-Plattform.

b) Automatisierte Alarme alarmieren den diensthabenden Engineer bei Anomalien einschließlich erhöhter Fehlerraten, unbefugter Zugriffsversuche und ungewöhnlicher Daten-Egress-Muster.

### 5.2 Verfahren zur Vorfallreaktion

a) Tale unterhält ein dokumentiertes Verfahren zur Vorfallreaktion, das Erkennung, Eindämmung, Beseitigung, Wiederherstellung und Nachbereitung abdeckt.

b) Das Verfahren wird mindestens einmal jährlich durch eine Tabletop-Übung oder Live-Drill getestet.

c) Schweregrade und Eskalationspfade sind vorab definiert; der diensthabende Engineer ist befugt, ohne Verzögerung an die Geschäftsleitung zu eskalieren.

### 5.3 Kundenbenachrichtigung

a) Tale benachrichtigt betroffene Kunden unverzüglich, in jedem Fall innerhalb von 72 Stunden nach Kenntniserlangung eines Datenschutzvorfalls, der ihre personenbezogenen Daten betrifft, wie in Abschnitt 8 der [Auftragsverarbeitungsvereinbarung](/de/legal/data-processing-agreement) festgelegt.

b) Benachrichtigungen enthalten die nach anwendbarem Datenschutzrecht erforderlichen Informationen: Art des Vorfalls, betroffene Kategorien und ungefähre Zahlen, voraussichtliche Folgen sowie Maßnahmen zur Behebung.

## 6. Personal

### 6.1 Vertraulichkeit

a) Jeder Tale-Mitarbeitende, Auftragnehmer und Berater unterzeichnet eine schriftliche Vertraulichkeitsvereinbarung, die personenbezogene Daten, Quellcode und Kundeninformationen abdeckt. Die Verpflichtung überdauert das Ende der Beauftragung.

### 6.2 Hintergrundprüfungen

a) Hintergrundprüfungen werden bei Tale-Mitarbeitenden mit Produktionszugang durchgeführt, soweit nach lokalem Recht zulässig.

### 6.3 Schulungen

a) Neue Mitarbeitende absolvieren innerhalb der ersten 30 Tage Schulungen zu Sicherheit und Datenschutz.

b) Sämtliches Personal absolviert mindestens jährlich Auffrischungsschulungen, darunter Themen wie Phishing-Sensibilisierung, sichere Entwicklung und Datenumgang.

### 6.4 Offboarding

a) Zugänge werden innerhalb eines Werktags nach Austritt oder Rollenwechsel entzogen.

b) Geräte werden gelöscht und eingezogen; physische Zugangsmittel werden zurückgegeben und deaktiviert.

## 7. Verwaltung von Unterauftragsverarbeitern

### 7.1 Auswahl

a) Unterauftragsverarbeiter werden nach einer Sicherheits- und Datenschutzprüfung ausgewählt, die ihre Zertifizierungen, Datenschutzverpflichtungen und Verarbeitungsstandorte abdeckt.

### 7.2 Vertragliche Pflichten

a) Jeder Unterauftragsverarbeiter ist vertraglich — durch schriftliche Vereinbarung — an Datenschutzpflichten gebunden, die nicht weniger schützend sind als die in der [Auftragsverarbeitungsvereinbarung](/de/legal/data-processing-agreement) festgelegten, einschließlich der Nicht-Training-Verpflichtung in Abschnitt 5.

### 7.3 Laufende Überprüfung

a) Zertifizierungen und Auditberichte von Unterauftragsverarbeitern werden mindestens jährlich überprüft.

b) Wesentliche Änderungen an der Sicherheits- und Datenschutz­position eines Unterauftragsverarbeiters lösen eine Benachrichtigung an Kunden über den 30-Tage-Mechanismus aus Abschnitt 6.2 der AVV aus.

## 8. Datenminimierung, Aufbewahrung und Löschung

### 8.1 Datenminimierung

a) Die Plattform erhebt nur die personenbezogenen Daten, die zur Bereitstellung der angeforderten Funktionalität erforderlich sind.

b) Kunden steuern selbst, welche Daten sie übermitteln; Tale reichert vom Kunden übermittelte Daten ohne ausdrückliche Einwilligung nicht mit Drittquellen an.

### 8.2 Aufbewahrung

a) Aufbewahrungs­fristen für jede Datenkategorie sind in Tales [Datenschutzerklärung](https://tale.dev/de/legal/privacy-policy) und in der produktinternen Aufbewahrungs­konfiguration dokumentiert.

b) Mindestaufbewahrungs­fristen für Audit-Logs werden vom Kunden konfiguriert; der Plattform-Default beträgt 365 Tage ohne Obergrenze.

### 8.3 Löschung

a) Bei Beendigung der Vereinbarung werden personenbezogene Daten gemäß Abschnitt 13 der [Auftragsverarbeitungsvereinbarung](/de/legal/data-processing-agreement) zurückgegeben oder gelöscht.

b) Die Löschung erstreckt sich auf jeden Speicher, der die Daten enthält, einschließlich Objektspeicher und Backups (letzteres durch Schlüsselzerstörung innerhalb des Backup-Aufbewahrungs­fensters).

c) Kunden können die Löschung einzelner Betroffener über den produktinternen Datenschutz-Anfrage-Workflow auslösen.

## 9. Governance

### 9.1 Richtlinien

a) Tale unterhält schriftliche Informations­sicherheits- und Datenschutz­richtlinien, die mindestens jährlich überprüft werden.

b) Richtlinien­änderungen werden allen Mitarbeitenden mitgeteilt; wesentliche Änderungen gehen mit verpflichtenden Schulungen einher.

### 9.2 Rollen und Verantwortlichkeiten

a) Tale benennt eine Person, die für Informations­sicherheit verantwortlich ist, und eine Person, die für Datenschutz verantwortlich ist. Beide berichten an die Geschäftsleitung.

b) Ihre Kontaktadressen sind `security@tale.dev` und `privacy@tale.dev`.

### 9.3 Risikomanagement

a) Tale unterhält ein Risikoregister, das technische, organisatorische und rechtliche Risiken abdeckt.

b) Risiken werden mindestens vierteljährlich und nach jedem wesentlichen Vorfall überprüft, wobei Mitigationen bis zum Abschluss verfolgt werden.

## 10. Kontakt

Für Fragen zu diesen TOMs oder zur Anforderung von Audit-Nachweisen kontaktiere uns über unser [Kontaktformular](https://tale.dev/de/contact).

**Ruler GmbH**
Seestrasse 4
3700 Spiez
Schweiz
