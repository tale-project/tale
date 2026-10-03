---
title: "Human-in-the-Loop: KI prüfen und genehmigen"
description: "Gestalte sinnvolle Prüfpunkte für KI-Agenten. Trenne Rückfragen, Ergebnisprüfung und Aktionsgenehmigung und plane den menschlichen Prüfaufwand."
slug: "human-in-the-loop-ai-agent-workflows"
topicId: "T02"
reviewed: "2026-10-03"
draft: false
coverAlt: "Drei getrennte Objekte stehen für eine Frage, ein geprüftes Ergebnis und eine Schranke vor einer Aktion."
---

Ein Agent bereitet eine Supportankündigung vor, und jemand klickt auf „Genehmigen“. Was hat das Team damit festgestellt? Vielleicht, dass die Nachricht korrekt ist. Vielleicht nur, dass die Person Zugriff auf die Schaltfläche hatte. Vielleicht wurde eine richtige Nachricht für den falschen Empfängerkreis genehmigt.

Ein KI-Workflow mit Human-in-the-Loop bezieht Menschen an ausgewählten Entscheidungspunkten ein. Die Schwierigkeit liegt darin, diese Punkte sinnvoll zu wählen und der Person eine Entscheidung vorzulegen, die sie tatsächlich verbessern kann. **Ein Prüfpunkt verdient menschliche Aufmerksamkeit, wenn die Person fehlende Entscheidungsbefugnis, relevante Kenntnisse oder Urteilsvermögen einbringt, die der Ablauf sonst nicht ausreichend bereitstellt.** Ein verlangter Klick belegt nichts davon.

Dieser Leitfaden behandelt eine zu korrigierende Ankündigung, einen abzulehnenden Versandvorschlag und eine überlastete Prüfwarteschlange. Jedes Problem verlangt eine andere Lösung.

## Jeder Prüfpunkt braucht eine eindeutige Bedeutung

Drei Entscheidungen tragen häufig dieselbe Bezeichnung „Genehmigung“, obwohl sie unterschiedliche Folgen haben.

| Interaktion | Entscheidung | Folge |
| --- | --- | --- |
| Rückfrage | Welche fehlende Tatsache oder Präferenz gilt? | Der Bearbeiter darf diese Information verwenden |
| Ergebnisprüfung | Erfüllt genau dieses Arbeitsergebnis seine Kriterien? | Die Arbeit abnehmen oder Änderungen verlangen |
| Aktionsgenehmigung | Darf genau dieser Vorgang ausgeführt werden? | Einen Versuch erlauben oder verhindern |

Diese Unterscheidung wirkt sich auf den Ablauf aus. Die Antwort „Verwende den regionalen Supportprozess“ nimmt die spätere Beschreibung dieses Prozesses noch nicht ab. Eine abgenommene Ankündigung ist nicht für alle denkbaren Empfänger genehmigt. Die Erlaubnis zum Versand belegt keine Zustellung.

Frameworks setzen diese Entscheidungen unterschiedlich um. Die Human-in-the-Loop-Middleware von LangChain dokumentiert beispielsweise konfigurierbare Entscheidungen bei unterbrochenen Tool-Aufrufen. Ihre Antwortmöglichkeiten sind Implementierungsdetails, die du prüfen musst, und keine allgemeingültige Bedeutung einer Genehmigungsschaltfläche. [Mehr zur Middleware](https://docs.langchain.com/oss/python/langchain/human-in-the-loop).

Formuliere die Entscheidung in einem Satz, bevor du die Oberfläche gestaltest: „Darf dieser Workflow Ankündigung r3 an die regionale Support-Testgruppe senden?“ Kann der Satz weder Material noch Folge benennen, ist der Prüfpunkt zu ungenau für eine verlässliche Entscheidung.

![Drei getrennte Entscheidungspunkte: Rückfragen liefern Informationen, Ergebnisprüfungen nehmen Arbeit ab oder verlangen Änderungen, und Aktionsgenehmigungen erlauben oder verweigern einen bestimmten Vorgang. Eine Erlaubnis belegt keine erfolgreiche Ausführung.](/blog/diagrams/de/T02-diagram.svg)

## Veranschaulichendes Beispiel: das Richtige ablehnen

Das folgende Beispiel einer Serviceankündigung verwendet erfundene Dokumente und Empfänger. Es erläutert eine Prüfmethode und beschreibt keinen gemessenen Betrieb.

Eine prozessverantwortliche Person hat Hinweis P-17 genehmigt: Ab Montag soll das regionale Supportteam ungelöste Zugriffsprobleme an die diensthabende Leitung eskalieren. Ein Agent erstellt Ankündigung r2. Das Team möchte die Verteilung zunächst intern testen, bevor es einen größeren Empfängerkreis berücksichtigt.

Der inhaltliche Kern des ersten Prüfpakets sieht so aus:

| Feld im Prüfpaket | Ausgefülltes Beispiel |
| --- | --- |
| Erbetene Entscheidung | Ankündigung r2 als korrekte Information zum regionalen Prozess abnehmen |
| Vorgeschlagene Aussage | „Alle Supportteams müssen Zugriffsprobleme sofort eskalieren“ |
| Maßgeblicher Beleg | P-17: regionales Team; ungelöste Zugriffsprobleme; gültig ab Montag |
| Kriterien | Zielgruppe, Eskalationsbedingung und Gültigkeitsdatum erhalten |
| Prüfergebnis | Geltungsbereich erweitert; Bedingung „ungelöst“ entfernt; Datum fehlt |
| Entscheidung | Änderungen an diesen drei Punkten verlangen |

Der Prüfer braucht keinen Konfidenzwert des Modells, um das Problem zu erkennen. Der Vergleich des vorgeschlagenen Satzes mit dem maßgeblichen Hinweis zeigt es direkt. Die Änderungen sind erheblich: Der Entwurf erweitert, wer handeln muss, welche Fälle gemeint sind und ab wann der Prozess gilt.

Revision 3 stellt alle drei Bedingungen wieder her. Der Prüfer kann nun ihre Richtigkeit abnehmen. Die Verteilung bleibt eine separate Entscheidung. Angenommen, der Versandvorschlag nennt `all-support` statt der vorgesehenen Gruppe `regional-support-test`. Dann ist dieser Vorgang abzulehnen. Eine erneute Prüfung der bereits abgenommenen Formulierung würde den falschen Empfänger nicht korrigieren.

Nach der Korrektur nennt der neue Vorschlag Revision 3 und die vorgesehene Testgruppe. Die Person prüft die tatsächliche Gruppenidentität oder die verfügbaren Belege zur Mitgliedschaft, statt sich auf das beruhigende Wort „test“ zu verlassen. Die Genehmigung erlaubt anschließend den Versuch. Ein Zustellfehler wird als Ausführungsfehler erfasst und nicht als Hinweis darauf, dass die vorherige Entscheidung verweigert wurde.

Jeder Eingriff hat so einen Zweck. Die Rückfrage klärt den Umfang, die Ergebnisprüfung korrigiert die Bedeutung, die Aktionsentscheidung begrenzt die Verteilung und die Ergebniskontrolle verifiziert die Ausführung.

## Ein Mensch kann Befugnis einbringen, ohne die Genauigkeit zu erhöhen

Manche Entscheidungen erfordern eine Person, weil die Organisation ihr die Befugnis vorbehält. Andere Prüfpunkte sollen Fehler aufdecken. Das sind unterschiedliche Begründungen mit unterschiedlichen Nachweisanforderungen.

Eine Metaanalyse von 2024 mit 106 Experimenten ergab, dass Kombinationen aus Mensch und KI im Durchschnitt besser abschnitten als Menschen allein, aber schlechter als die jeweils bessere Bedingung aus Mensch allein und KI allein. Sie berücksichtigte Veröffentlichungen bis Juni 2023 und verlangte alle drei Vergleichsbedingungen. Daher belegt sie weder die Leistung eines heutigen Agenten-Prüfverfahrens noch, ob eine vorgeschriebene Genehmigung entfallen sollte. [Lies die endgültige Studie und ihre Methodik](https://www.nature.com/articles/s41562-024-02024-1).

Die praktische Aufgabe ist, den menschlichen Beitrag zu benennen. Im Ankündigungsbeispiel weiß die prozessverantwortliche Person, welche Richtlinie gilt. Der Faktenprüfer vergleicht den Entwurf mit dieser Richtlinie. Die Person, die die Verteilung genehmigt, kontrolliert den vorgesehenen Empfängerkreis. Würde man alle drei Entscheidungen einfach der gerade erreichbaren Person zuweisen, blieben diese Beiträge unbelegt.

Wenn es um Genauigkeit geht, gib dem Prüfer Belege, mit denen er widersprechen kann. Eine vom Agenten erzeugte Begründung hilft vielleicht bei der Orientierung im Paket, ersetzt aber nicht den ursprünglichen Nachweis. Lass den Prüfer bei folgenreichen Aussagen die relevante Quellenbedingung benennen, bevor er die Formulierung akzeptiert. Das ist unser Vorschlag für die Prüfung und keine Behauptung, dass eine bestimmte Oberfläche validiert wurde.

Eine Studie von Buçinca und Kollegen fand, dass bewusstere Interaktion übermäßiges Vertrauen verringern konnte, zugleich aber schlechtere Nutzerbewertungen erhielt. Das spricht dafür, sowohl Entscheidungsqualität als auch Prüfaufwand zu betrachten. Es rechtfertigt keine zusätzlichen Hürden an jeder Stelle. [Lies das Experiment von 2021](https://arxiv.org/abs/2102.09692).

## Aufmerksamkeit dort einsetzen, wo sie das Ergebnis verändern kann

Ein fehlendes Pflichtdatum lässt sich oft automatisch erkennen. Ob „ungelöst“ in einer überarbeiteten Richtlinie dasselbe bedeutet, erfordert Interpretation. Ob eine Nachricht an einen bestimmten Empfängerkreis gehen darf, erfordert die passende Befugnis und aktuelle Angaben zum Ziel.

Automatische Prüfungen sollten vermeidbare Arbeit abfangen, bevor das Paket zur Prüfung kommt. Sie können fehlende Felder zurückweisen, geänderte Dateirevisionen erkennen oder bei eindeutigen Regeln eine erlaubte Zielkennung prüfen. Sie belegen nicht, dass jeder formal gültige Satz die beabsichtigte Bedeutung erhält.

Im Beispiel ist folgende Arbeitsteilung sinnvoll:

| Prüfung | Ausgangspunkt | Begründung |
| --- | --- | --- |
| Pflichtfelder des Pakets vorhanden | Festgelegte Validierung | Die erforderliche Struktur ist bekannt |
| Ankündigung erhält die Bedingungen von P-17 | Inhaltliche Prüfung | Eine flüssige Umformulierung kann die Bedeutung ändern |
| Ziel entspricht dem genehmigten Empfängerkreis | Exakte Kennungsprüfung und passende Genehmigung | Richtiger Inhalt entscheidet nicht über die Verteilung |
| Zustellung ist tatsächlich erfolgt | Ausführungsnachweis | Eine Genehmigung allein belegt keine Wirkung |

Diese Wahl sollte sich ändern, wenn sich die Aufgabe ändert. Eine rückgängig zu machende interne Formatkorrektur braucht möglicherweise Stichproben und einen einfachen Korrekturweg statt einer Einzelgenehmigung. Eine Nachricht, die eine neue Servicezusage macht, kann dagegen eine fachlich zuständige Person erfordern, selbst wenn Grammatik, Quellen und Empfänger stimmen. Vorgeschriebene organisatorische Genehmigungen bleiben vorgeschrieben. Ein kleineres Prüfvolumen erlaubt nicht automatisch, sie abzuschaffen.

## Prüfen, ob die Warteschlange zu bewältigen ist

Ein Betriebsmodell, das jeden Vorschlag einer ohnehin ausgelasteten Person zuweist, verschiebt womöglich nur den Engpass.

Betrachte eine beispielhafte Kapazitätsrechnung: Pro Arbeitstag kommen 24 neue Vorschläge an, jede Prüfung dauert vier Minuten und die zugewiesene Person hat täglich 60 Minuten dafür. Nacharbeit und Schwankungen bleiben zunächst unberücksichtigt.

Der Eingang erfordert `24 × 4 = 96 Minuten`. Die verfügbare Zeit reicht für `60 ÷ 4 = 15 Prüfungen`. Unter diesen Annahmen bleiben täglich neun Vorschläge unbearbeitet; nach fünf Tagen sind 45 zusätzliche Vorschläge offen. Das ist eine Rechnung mit erfundenen Eingaben und keine Vorhersage tatsächlicher Wartezeiten. Schwankender Eingang, schwierigere Fälle und wiederholte Prüfungen erfordern weitere Messungen.

Der Ablauf braucht eine Antwort, bevor dringende Anfragen die Warteschlange füllen. Das Team könnte unnötige Vorschläge vermeiden, wiederkehrende Mängel in Prüfpaketen beheben, qualifizierte Vertretung einplanen oder den Pilotumfang verkleinern. Ähnliche Entscheidungen gemeinsam zu bearbeiten kann wiederholten Vorbereitungsaufwand senken. Das Paket muss trotzdem Ausnahmen und den Geltungsbereich jeder Entscheidung bewahren. Überfällige Arbeit automatisch zu akzeptieren würde die Genehmigungsregeln ändern; es behebt keinen Personalmangel.

Miss im Pilotbetrieb sowohl den Eingang als auch die tatsächliche Bearbeitungszeit. Erfasse Änderungswünsche ebenso wie Genehmigungen: Ein Vorschlag, der dreimal zurückkommt, beansprucht dreimal Kapazität. Ziel ist ein Prüfverfahren, das Menschen bei der erwarteten Arbeitsmenge sorgfältig durchführen können.

## Entscheidungen an Versionen binden und die Wiederaufnahme festlegen

Ein Prüfnachweis sollte genau benennen, was untersucht wurde. „Am Dienstag genehmigt“ reicht nicht, wenn am Mittwoch jemand den Empfängerkreis ändert.

Bei der Ankündigung kann eine spätere Textkorrektur eine neue Inhaltsprüfung verlangen, während der geprüfte Empfängerkreis unverändert bleibt. Ein anderes Ziel verlangt eine neue Aktionsentscheidung, auch wenn der Inhalt weiterhin abgenommen ist. Ein neuer Prozesshinweis kann die Faktenprüfung ungültig machen. Halte fest, welche Entscheidung betroffen ist und warum sie erneut nötig wird. Vermeide sowohl pauschal weiterverwendete Genehmigungen als auch unnötige Wiederholungen unabhängiger Prüfungen.

Fehlende Belege sind ein zulässiges Ergebnis. Der Prüfer kann antworten: „Keine Entscheidung möglich: Gruppenmitgliedschaft nicht einsehbar“, ergänzt um eine zuständige Person für die fehlende Angabe. Der Vorgang bleibt damit ungenehmigt. Ebenso sollte ein Prüfer ohne nötige Fachkenntnis die Entscheidung weitergeben, statt Systemzugriff mit Kompetenz gleichzusetzen.

Die [Prüfpaket-Vorlage](/blog/worksheets/de/T02-review-packet.md) trennt erbetene Entscheidung, Gegenbelege, Revision, Befugnis und beobachtete Wirkung. Ihre Kapazitätsfelder helfen zu prüfen, ob der vorgesehene Ablauf dauerhaft tragfähig ist.

## Die Unterscheidung in Tale anwenden

Tales Dokumentation trennt zur Prüfung eingereichte Aufgabenergebnisse von Workflow-Rückfragen und Genehmigungen für Connector-Schreibvorgänge. Halte bei einer Projektaufgabe die Abnahmekriterien neben dem Ergebnis fest, damit der Prüfer die Arbeit beurteilen kann. Eine erfolgreiche Ausführung entscheidet noch nicht über die Abnahme. [Mehr zu Delegation und Prüfung](https://docs.tale.dev/de/platform/projects/task-automation).

Bei einem vorgeschlagenen Connector-Schreibvorgang zeigt die dokumentierte Genehmigungskarte die Eingabe, bearbeitet sie aber nicht. Eine Ablehnung verhindert den Vorgang und lässt die Ausführung fehlschlagen. Ein korrigierter Workflow oder eine korrigierte Eingabe erfordert eine neue Ausführung. [Mehr zu wartenden Workflows](https://docs.tale.dev/de/platform/automations/approvals-in-workflows).

Die betrieblich benannte genehmigende Person ist außerdem vom Plattformzugriff zu unterscheiden. Laut Tales öffentlichem Leitfaden werden Connector-Genehmigungen keiner benannten Genehmigungsgruppe zugewiesen. Inhaber, Admins und Entwickler können die Ausführungsdetails öffnen. Über eine mit einer Aufgabe verknüpfte Karte kann jeder entscheiden, der diese Aufgabe öffnen kann. Gleiche dieses dokumentierte Zugriffsverhalten mit der Verantwortung ab, die dein Ablauf verlangt. [Mehr zu Vorgangsgenehmigungen](https://docs.tale.dev/de/platform/approvals/concepts).

Connector-Genehmigungen gelten für einen festgelegten Kontrollweg. Gehe nicht davon aus, dass sie jede Aktion über direkte Sandbox-Tools oder gewährte Zugangsdaten abfangen. Prüfe diese Zugriffswege beim Einrichten des Ablaufs. [Mehr zu Laufzeitumgebungen und Zugangsdaten](https://docs.tale.dev/de/platform/agents/harnesses).

Bring zur [Tale-Demo](/de/request-demo) die fehlerhafte Ankündigung, die korrigierte Revision und den Versandvorschlag mit dem falschen Ziel mit. Eine hilfreiche Vorführung macht alle drei Entscheidungen unterscheidbar und erhält genügend Belege, um die Folgen jeder Entscheidung zu erklären.
