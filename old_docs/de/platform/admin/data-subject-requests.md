---
title: Anfragen betroffener Personen
description: GDPR-Art.-17-Löschanträge direkt aus der Admin-Oberfläche einreichen — mit SLA-Verfolgung, einmaliger Art.-12(3)-Verlängerung und Audit-verkettetem Beleg.
---

Anfragen betroffener Personen ist die Stelle, an der Org-Admins GDPR-Art.-17-Löschanträge bearbeiten, ohne das Produkt zu verlassen. Jede Einreichung legt einen dauerhaften Beleg mit einer 30-Tage-SLA-Frist an, lässt die Lösch-Kaskade als Hintergrund-Job laufen und schreibt einen Audit-Log-Eintrag für jeden Zustandsübergang — eingereicht, blockiert, ausgeführt, verlängert, wiederholt, teilweise, fehlgeschlagen. Die Seite ist nach dem Oberbegriff DSR benannt, nicht nur nach „Löschung", damit künftige Art.-16-(Berichtigung)- und Art.-20-(Portabilität)-Abläufe auf derselben Oberfläche landen können, ohne die Route umzubenennen; heute ist nur Art. 17 implementiert.

Zielgruppe ist der Compliance-Admin der Organisation. Mitglieder, Redakteure und Entwickler sehen diese Seite nicht. Die Oberfläche ist **Einstellungen > Richtlinien > Anfragen betroffener Personen**.

## Identitätsprüfung läuft außerhalb

Tale ist vom Design her admin-vermittelt — es gibt kein Self-Service-Portal für die betroffene Person. Der Admin, der die Anfrage einreicht, **ist** der Identitätsprüfungs-Punkt, weil er die Identität der Person über den eigenen Prozess der Organisation bestätigt hat, bevor er den Dialog öffnet (HR-Offboarding, ticketbasierter Support-Ablauf, persönliche Prüfung). Das Produkt fügt keine eigene IDV-Stufe ein.

Dieser Vertrag macht den Admin zur autoritativen Stelle für die Anfrage. Die Rechtsabteilung sollte die getippte Bestätigungs-Phrase im Datei-Dialog als die IDV-Schranke werten: das Durchtippen der Phrase ist ein bewusstes, im Audit-Log festgehaltenes Signal, dass der Admin die Person geprüft hat.

## Eine Anfrage einreichen

Klicke oben auf der Seite auf **Anfrage einreichen**. Der Dialog fragt vier Felder ab:

- **Betroffene Person** — irgendein aktives Mitglied der Organisation, gewählt aus einer Suchliste. Die Auswahl ist dieselbe wie im Legal-Hold-UI.
- **Rechtsgrundlage** — einer von sieben strukturierten Codes, die auf GDPR Art. 17(1)(a)–(f) abbilden, plus die operative `contract_termination`-Grundlage für HR-Offboarding. Aufsichtsbehörden erwarten Anfragen klassifiziert nach Rechtsgrundlage; deshalb tragen Produkt-DSR-Tools (OneTrust, TrustArc, Ketch) alle einen strukturierten Code neben der Erzählung.
- **Begründungs-Erzählung** — Freitext, mindestens 10 Zeichen, der den Prüfungskontext beschreibt. Die Erzählung wird in den Beleg und ins Audit-Log geschrieben.
- **Getippte Bestätigung** — tippe `ERASE`, um die Sende-Schaltfläche zu aktivieren. Die Phrase ist locale-stabil, damit die Tipp-Anforderung über jede Sprache gleich ist.

Beim Absenden läuft die Kaskade als Hintergrund-Job: Gelöscht werden die Chat-Threads der Person, die RAG-indexierten Dokumente, die Datei-Metadaten-Blobs und neun je-Tabelle-Subjekt-Kategorien; danach werden personenbezogene Daten aus allen Audit-Log-Zeilen entfernt, die die Person verfasst hat.

Steht die Person unter einem aktiven Legal Hold — organisationsweit oder per Custodian — wird die Anfrage **an der Schranke abgelehnt**. Ein Inline-Panel zeigt die Anzahl gehaltener Threads und Dokumente plus einen Deep-Link zur Legal-Hold-Seite. Der Beleg wird dennoch im Zustand **blockiert** eingelegt, damit der Aufsichts-Audit-Pfad strukturierten Beweis hat, dass die Anfrage eingegangen ist.

## SLA-Badge und die Art.-12(3)-Verlängerung

Jede Anfrage trägt eine 30-Tage-Frist, gezählt ab dem Einreichungs-Datum. Listen- und Detail-Ansicht rendern ein SLA-Countdown-Badge mit vier Eimern:

- **Grün** — mehr als 7 Tage übrig.
- **Gelb** — 7 Tage oder weniger übrig.
- **Rot** — überfällig.
- **Grau** — terminaler Status (fertig oder fehlgeschlagen); der Countdown ist gegenstandslos.

Art. 12(3) der DSGVO erlaubt dem Verantwortlichen, das Antwort-Fenster für komplexe Anfragen um bis zu zwei weitere Monate zu verlängern, **aber die Verlängerung muss der betroffenen Person innerhalb des ursprünglichen Monats mit Begründung mitgeteilt werden**. Die Aktion **Frist verlängern** in der Detail-Schublade setzt diese Einschränkung um:

- Verfügbar, solange die Anfrage nicht-terminal ist und die ursprüngliche Frist nicht abgelaufen ist.
- 1 bis 60 Tage hinzufügen, mit einer Pflicht-Begründung von mindestens 10 Zeichen.
- Jede Anfrage darf **höchstens einmal** verlängert werden — ein zweiter Versuch wird mit dem Fehler „bereits verlängert" abgelehnt.
- Das SLA-Badge zeigt die verlängerte Frist, sobald eine Verlängerung gewährt wurde, sonst die ursprüngliche Frist — eine gewährte Verlängerung ändert Farbe und Countdown sofort.

Das Audit-Log hält fest, wer die Verlängerung gewährt hat, die Begründung und die neue Frist.

## Teilweise, blockierte oder fehlgeschlagene Läufe wiederholen

Drei Zustände sind aus der **Wiederholen**-Aktion der Detail-Schublade wiederholbar:

- **teilweise** — die Kaskade lief, aber einige Kategorien wurden durch einen währenddessen gesetzten Hold übersprungen, oder die Seiten-Versuchs-Obergrenze wurde an einem bestimmten Thread erreicht.
- **blockiert** — die Anfrage wurde beim Einreichen an der Legal-Hold-Schranke abgelehnt. Den hinderlichen Hold aufheben, dann wiederholen.
- **fehlgeschlagen** — die Kaskade ist abgestürzt (RAG-Dienst unerreichbar, vorübergehender Infrastruktur-Fehler) oder wurde vom Watchdog nach der 30-Minuten-Action-Obergrenze eingesammelt.

Die Hold-Schranke läuft beim Prozessor-Start erneut, sodass das Fenster im Operator-Intervall „Hold aufheben, dann wiederholen" geschlossen ist.

## Was der Beleg zeigt

Die Detail-Schublade rendert den vollständigen Art.-17-/-19-Beleg für eine Anfrage:

- Status-Badge plus SLA-Countdown.
- Subjekt-Kennung, Rechtsgrundlage, Begründungs-Erzählung, wer eingereicht hat und wann, aktuelle SLA-Frist (mit Verlängerungs-Info, sofern relevant).
- Zähler: gelöschte und avisierte Threads, entfernte RAG-Dokumente, gelöschte Dokumente, durch Hold übersprungene Dokumente, Fehlermeldung bei Misserfolg.
- Audit-Zeitleiste: jede GDPR-Löschungs-Audit-Log-Zeile mit Subjekt-Bezug, geordnet nach Ketten-Zeitstempel.

**Es wird kein gelöschter PII-Inhalt gerendert** — nur Aggregat-Zähler und Kennungen. Der Beleg ist sicher, ihn direkt an die Aufsichtsbehörde oder an die Person zu übergeben.

## Heutiger Geltungsbereich, künftiger Geltungsbereich

Heute liefert die Seite nur GDPR-Art.-17-Löschung aus. Die bewussten Ausschlüsse der v1-Schnittlinie:

- Art. 16 Berichtigung und Art. 20 Portabilität — landen als zusätzliche Anfrage-Arten auf derselben DSR-Seite, ohne Route-Umbenennung.
- Self-Service-Portal für die betroffene Person — Tale ist vom Design her admin-vermittelt.
- Identitätsprüfung im Produkt — wird außerhalb durch die Organisation des Admin gehandhabt.
- E-Mail-Benachrichtigung an die Person bei Abschluss — verschoben in den E-Mail-Infrastruktur-Track.
- Bulk-Anfragen (Einreichungen über Claims-Management-Dienstleister).
- Mehr-Rechtsraum-Vorlagen (CCPA, LGPD) — zuerst GDPR.
- KI-gestützte Redaktion — Tale löscht, statt zu redigieren.

## Wo das hingehört

Anfragen betroffener Personen ist die Compliance-Notausstiegsluke, die beweist, dass Tale das Recht auf Löschung ernst nimmt. Sie liegt neben [Richtlinien](/de/platform/admin/governance) (Aufbewahrung, Legal Hold, Audit-Logging) — zusammen decken diese drei Seiten die Datenlebenszyklus-Steuerungen ab, die eine Datenschutzbeauftragte braucht, um unter DSGVO ein belastbares Argument zu bauen. Greife zu dieser Seite, wenn eine geprüfte Anfrage einer betroffenen Person hereinkommt; greife zu Richtlinien, wenn die Frage „Was ist unsere Aufbewahrungs-Voreinstellung?" lautet.

Externe Referenzen:

- [DSGVO Art. 12 — Transparente Informationen und Modalitäten](https://gdpr-info.eu/art-12-gdpr/)
- [DSGVO Art. 17 — Recht auf Löschung](https://gdpr-info.eu/art-17-gdpr/)
