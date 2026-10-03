---
title: "Wo braucht ein KI-Workflow menschliche Freigaben?"
description: "Lege fest, wo ein KI-Workflow eine Person braucht, was sie prüfen muss und warum ein korrekter Entwurf noch keine Erlaubnis zum Versand ist."
slug: "human-in-the-loop-ai-agent-workflows"
topicId: "T02"
reviewed: "2026-10-03"
draft: false
coverAlt: "Drei getrennte Objekte stehen für eine Frage, ein geprüftes Ergebnis und eine Schranke vor einer Aktion."
---

Plane einen menschlichen Prüfpunkt dort ein, wo jemand fehlende Informationen liefern, ein Ergebnis beurteilen oder eine Aktion erlauben muss. Jeder Prüfpunkt braucht eine konkrete Frage. „Die Arbeit des Agenten freigeben“ lässt zu viel offen: Jemand kann den Text einer Nachricht gutheißen und dabei übersehen, wer sie erhalten soll.

Schreib zuerst auf, was der Agent erstellen und was er verändern darf. Entscheide dann, bei welchen Schritten dein Wissen oder deine Zustimmung nötig ist. Eine interne Notiz zu entwerfen und sie an Kunden zu senden hat unterschiedliche Folgen, auch wenn der Text derselbe ist.

## Kläre, was die Person entscheidet

Drei Arten von Entscheidungen solltest du auseinanderhalten:

| Prüfpunkt | Welche Frage wird beantwortet? | Was folgt daraus? |
| --- | --- | --- |
| Rückfrage | Welche Richtlinie, Zielgruppe oder Präferenz gilt? | Der Agent arbeitet mit der fehlenden Information weiter |
| Ergebnisprüfung | Entspricht diese Fassung dem Auftrag? | Ergebnis annehmen oder Änderungen verlangen |
| Aktionsfreigabe | Darf genau dieser Vorgang ausgeführt werden? | Den Versuch erlauben oder verhindern |

Eine Rückfrage gehört vor die Arbeit, die von der Antwort abhängt. Eine Ergebnisprüfung braucht etwas Konkretes, das sich beurteilen lässt. Eine Aktionsfreigabe gehört vor den Eingriff, den du kontrollieren willst. Dabei müssen der tatsächliche Inhalt und das Ziel des Vorgangs sichtbar sein.

![Rückfragen liefern fehlende Informationen. Ergebnisprüfungen nehmen Arbeit an oder verlangen Änderungen. Aktionsfreigaben erlauben oder verhindern einen konkreten Vorgang.](/blog/diagrams/de/T02-diagram.svg)

Diese Entscheidungen können im selben Gespräch fallen. Trotzdem braucht jede eine eigene Antwort. Wenn du sowohl eine Mitteilung als auch ihren Versand freigibst, halte fest, für welche Fassung und welche Empfänger die Entscheidung gilt.

## Auch eine korrekte Nachricht kann die Falschen erreichen

Nehmen wir eine erfundene Support-Mitteilung. Die maßgebliche Vorgabe P-17 lautet: **Ab Montag soll das regionale Support-Team ungelöste Zugangsprobleme an die diensthabende Leitung eskalieren.** Der erste Versand ist für eine interne Testgruppe vorgesehen.

Der Entwurf des Agenten, Fassung 2, lautet: „Alle Support-Teams müssen Zugangsprobleme sofort eskalieren.“ Das klingt eindeutig, verändert aber drei Dinge: für wen die Regel gilt, welche Probleme erfasst sind und ab wann sie anzuwenden ist.

Bei der inhaltlichen Prüfung müssen diese Punkte zurückgegeben werden. Fassung 3 stellt den regionalen Geltungsbereich, die Bedingung „ungelöst“ und den Beginn am Montag wieder her. Der Text kann nun angenommen werden.

Anschließend schlägt der Workflow vor, r3 an `all-support` zu senden. Das ist das falsche Ziel; der Auftrag erlaubt nur `regional-support-test`. Den Versand abzulehnen bedeutet nicht, dass der Text erneut überarbeitet werden muss. Der Vorgang braucht einen korrigierten Empfänger und danach eine neue Freigabe. Prüfe vorher die Identität oder Mitgliederliste der Gruppe, nicht nur ihren beruhigend klingenden Namen.

Prüfe nach dem Versuch, ob die Nachricht zugestellt wurde. Eine Freigabe erlaubt die Ausführung; sie belegt nicht, was danach tatsächlich geschehen ist.

## Gib der prüfenden Person genug, um widersprechen zu können

Niemand sollte den Auftrag erst aus einem Chatverlauf zusammensuchen müssen. Für die Versandentscheidung könnte diese kurze Anfrage als Grundlage dienen:

> - **Entscheidung:** Dürfen wir Mitteilung r3 an `regional-support-test` senden?
> - **Inhalt:** Link zum genauen Text von r3, geprüft anhand von P-17.
> - **Empfänger:** Link zur aktuellen Mitgliederliste der Gruppe.
> - **Änderung:** Der vorige Vorschlag nannte fälschlich `all-support`.
> - **Bei Ablehnung:** Diesen Versand stoppen und die Begründung an die verantwortliche Person zurückgeben.

Lege die Originalquelle neben den Vorschlag. Die Zusammenfassung einer Richtlinie durch den Agenten kann denselben Fehler enthalten wie sein Entwurf. Wer die Mitteilung prüft, braucht P-17 und keine weitere überzeugend formulierte Erklärung von P-17.

Wähle die prüfende Person passend zur Entscheidung: Für den Inhalt braucht es jemanden, der die Vorgabe versteht, für den Versand jemanden, der ihn genehmigen darf. Das kann dieselbe Person sein. Zugriff auf eine Freigabeansicht allein begründet keine dieser Zuständigkeiten.

## Vermeide Freigaben ohne sinnvollen Prüfauftrag

Fehlende Pflichtfelder, ungültige Adressen und verbotene Zielkennungen lassen sich meist durch feste Validierungsregeln abfangen. Führe diese Prüfungen aus, bevor jemand den Vorschlag lesen muss. Menschliche Aufmerksamkeit ist für Bedeutung, Ausnahmen und Zuständigkeit nötig.

Bei rückgängig zu machender interner Arbeit kann eine Stichprobe abgeschlossener Ergebnisse genügen. Bei einer neuen Kundenzusage, einer Zahlung oder einer Veröffentlichung im Namen des Unternehmens muss möglicherweise jeder Vorschlag von einer verantwortlichen Person geprüft werden. Vorgeschriebene Freigaben deiner Organisation bleiben bestehen.

Beobachte im Pilotversuch, was die Prüfenden tatsächlich tun. Gehen die meisten Anfragen zurück, weil die Quelle fehlt, verbessere die Vorlage. Kommt das Team nicht hinterher, begrenze den Workflow oder organisiere eine qualifizierte Vertretung. Eine wachsende Warteschlange ist ein Grund, den Ablauf zu ändern, nicht Schweigen als Zustimmung zu werten.

## Halte fest, worauf sich die Freigabe bezieht

Ändern sich Nachricht, Empfänger oder zugrunde liegende Vorgabe, kann eine frühere Entscheidung ihre Gültigkeit verlieren. Nenne deshalb Fassung und Geltungsbereich im Protokoll. So sieht die nächste Person, was weiterhin gilt. Lassen sich Quelle oder Ziel nicht prüfen, bleibt die Aktion offen; halte fest, wer die fehlenden Belege liefern kann.

In Tale werden Aufgabenergebnisse zur Prüfung zurückgegeben. Wartende Workflows unterscheiden Rückfragen von Freigaben für schreibende Connector-Aktionen. Ein falscher Vorgang lässt sich auf der Freigabekarte nicht bearbeiten: Lehne ihn ab, korrigiere Eingabe oder Workflow und starte einen neuen Lauf. [Aufgabenergebnisse prüfen](https://docs.tale.dev/de/platform/projects/task-automation), [wartende Workflows](https://docs.tale.dev/de/platform/automations/approvals-in-workflows).

Nimm die [Vorlage für eine Prüfanfrage](/blog/worksheets/de/T02-review-packet.md) und einen bestehenden Workflow. Beginne mit dessen nächster folgenreicher Aktion und formuliere den einen Satz, den die prüfende Person beantworten muss. Solange dieser Satz unklar bleibt, ist der Workflow noch nicht bereit für eine Freigabeschaltfläche.
