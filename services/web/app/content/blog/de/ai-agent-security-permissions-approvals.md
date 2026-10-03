---
title: "Welche Zugriffe braucht dein KI-Agent?"
description: "Leite aus einer Rechercheaufgabe ab, was ein KI-Agent lesen und ändern darf, welche Zugangsdaten er braucht und wann eine eigene Freigabe nötig ist."
slug: ai-agent-security-permissions-approvals
topicId: T07
reviewed: '2026-10-03'
draft: false
coverAlt: "Verschachtelte Rahmen begrenzen die Zugänge einer Aufgabe und zeigen ihre dokumentierten Spuren."
---

Gib einem KI-Agenten die Zugriffe, die er für seine aktuelle Aufgabe braucht. Wer eine Produktankündigung vorbereitet, muss vielleicht Projektnotizen lesen und einen Entwurf erstellen können. Dafür braucht der Agent weder E-Mails zu versenden noch die Ankündigung zu veröffentlichen oder Projektberechtigungen zu ändern.

Trenne zunächst **Informationen lesen, Ergebnisse erstellen und eine Aktion ausführen**. Ein Konto bündelt oft alle drei Möglichkeiten, obwohl die Aufgabe nur einen Teil davon erfordert. Eine sinnvolle Ausgangskonfiguration lässt den Agenten nützliche Arbeit erledigen und hält unnötige Aktionen außer Reichweite.

## Übersetze die Aufgabe in eine kurze Zugriffsliste

Nehmen wir einen Recherche-Agenten, der Produktangaben prüft und anhand eines internen Briefings und der Anbieterseiten eine Ankündigung entwirft. Eine Person prüft den Entwurf, bevor etwas versendet wird. Daraus ergibt sich diese Zugriffsliste:

| Bedarf | Erlauben | Nicht bereitstellen |
| --- | --- | --- |
| Produkteinführung verstehen | Ausgewähltes Projektbriefing und Referenzen lesen | Andere Projekte, Personaldaten und fremde Kundendateien |
| Angaben der Anbieter prüfen | Benötigte öffentliche Quellen abrufen | Unnötige angemeldete Browsersitzungen und Formularübermittlungen |
| Ankündigung vorbereiten | Bericht und Entwurf im Ausgabebereich des Projekts erstellen | Ausgangsbriefing bearbeiten oder auf der Live-Website veröffentlichen |
| Ergebnis übergeben | Dateien und Quellen zur Prüfung zurückgeben | Zugangsdaten für Postfächer, soziale Netzwerke oder umfassende Verwaltung |

Das ist ein Vorschlag für dieses Beispiel. Prüfe, ob deine Tools diese Grenzen tatsächlich durchsetzen können. Bietet ein Dienst nur ein Konto mit weitreichenden Rechten an, macht das Wort „lesen“ im Prompt daraus keinen Lesezugriff. Nutze eine enger begrenzte Integration, stelle einen freigegebenen Export bereit oder lass eine Person diesen Teil der Arbeit übernehmen.

Dasselbe gilt für Daten. Der Zugriff auf ein Projekt rechtfertigt nicht automatisch den Zugriff auf jedes Dokument, das die bedienende Person öffnen kann. Stelle dem Agenten die benötigten Quellen bereit und ergänze weitere, wenn eine konkrete Aufgabe sie erfordert.

![Die Befugnisse eines Agenten hängen von seiner Identität, den zugänglichen Daten, seinen Tools und Zugangsdaten, den Freigaben und den aufbewahrten Nachweisen ab.](/blog/diagrams/de/T07-diagram.svg)

## Setze die Grenze auch außerhalb des Prompts durch

Die Anweisung „Versende niemals das interne Briefing“ beschreibt, was du erwartest. Dem Agenten keine Zugangsdaten zum Versenden zu geben, begrenzt dagegen, was er tun kann. Beides ist sinnvoll: Klare Anweisungen helfen bei der Arbeit, während Tool-Berechtigungen die Folgen eines Fehlers oder einer irreführenden Quelle begrenzen.

Eine Anbieterseite könnte den Agenten etwa auffordern, das interne Briefing per E-Mail zu schicken, um „die Kompatibilität zu prüfen“. Die Seite darf die Aufgabe nicht ändern. Der Recherche-Agent sollte die Aufforderung ignorieren. Seine Ausstattung sollte den Versand außerdem verhindern, falls er ihr trotzdem folgt. OWASP empfiehlt in seinen [Hinweisen zu übermäßigen Agentenbefugnissen](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/), verfügbare Funktionen, Berechtigungen und selbstständige Aktionen zu begrenzen.

Prüfe jeden Weg, der denselben Dienst erreichen kann. Ein Connector mit Lesezugriff hilft wenig, wenn der Agent zusätzlich ein Postfach-Token in seiner Shell nutzen kann. Auch die Freigabe des Hostnamens eines E-Mail-Dienstes ist weiter gefasst als die Erlaubnis für einen bestimmten Empfänger oder Anhang.

In Tale stellt der Connector-Broker Agenten nur Leseaktionen bereit. Schreibende Plattform-Tools, direkte GitHub-Werkzeuge und ausdrücklich freigegebene Secrets haben eigene Zugriffsregeln. Prüfe die tatsächliche Ausstattung anhand des [Leitfadens zu Projektagenten](https://docs.tale.dev/de/platform/projects/project-agents). Leite die gesamten Befugnisse nicht aus den Einschränkungen eines einzelnen Connectors ab.

## Entscheide gesondert über den Versand

Soll die Aufgabe später auch den Versand umfassen, ergänze diesen Schritt bewusst. Lass die Zugriffe des Recherche-Agenten unverändert und nutze einen separaten, begrenzten Versandweg. Vor der Entscheidung sollte die prüfende Person Empfänger, Betreff, Nachricht und Anhänge genau sehen können.

In Tale können Connector-Schreibaktionen in laufenden Automationen nach den Regeln der Organisation eine Genehmigung erfordern. Dadurch wartet aber nicht jeder Shell-Befehl auf eine Genehmigungskarte. Prüfe die geltenden [Genehmigungsregeln](https://docs.tale.dev/de/platform/approvals/configure).

Eine Tale-Genehmigungskarte erlaubt das Genehmigen oder Ablehnen der vorgeschlagenen Eingabe, nicht deren Bearbeitung. Wer die Aufgabe öffnen kann, kann über eine dort angezeigte Karte entscheiden. Die Karte wählt keine benannte Gruppe von Genehmigenden aus. Prüfe, ob dieser Personenkreis zu deinen Anforderungen passt. [Details zu Aktionsgenehmigungen](https://docs.tale.dev/de/platform/approvals/concepts)

Einen Entwurf anzunehmen und seinen Versand zu erlauben sind zwei verschiedene Entscheidungen. Auch eine einwandfreie Ankündigung kann an den falschen Empfänger adressiert sein. Der Beitrag über [menschliche Freigaben in KI-Workflows](/de/blog/human-in-the-loop-ai-agent-workflows) hilft dir, den Prüfpunkt und die nötigen Informationen festzulegen.

## Teste, was der Agent nicht tun können darf

Führe eine harmlose Aufgabe mit derselben Rolle, denselben Tools und denselben Arten von Zugangsdaten aus, die das Team tatsächlich nutzen wird. Ein erfolgreicher Test als Administrator zeigt nicht, was andere Personen tun können.

Versuche neben der normalen Aufgabe, ein nicht freigegebenes Testdokument zu lesen und ohne Genehmigung an ein kontrolliertes Testpostfach zu senden. Prüfe die Zugriffsverweigerung, die Aktionsprotokolle des Versanddienstes und das Testpostfach. Es darf kein Sendeauftrag angenommen worden sein. Nutze erfundene Inhalte und eigene Testkonten. Ziel ist ein brauchbarer Entwurf, während die ausgeschlossenen Aktionen weiterhin nicht möglich sind.

Ergänzt du einen Genehmigungsschritt, teste ihn in einem kontrollierten Live-Lauf. Tales Test mit simulierten Antworten führt keine externen Schreibaktionen aus und zeigt keine echten Aktionsgenehmigungen. Lehne eine vorgeschlagene Aktion ab und prüfe, dass sie nicht stattgefunden hat. Teste die Genehmigung in einem separaten, korrigierten Lauf. Der [Leitfaden zu Aktionsgenehmigungen](https://docs.tale.dev/de/platform/approvals/concepts) erklärt diesen Unterschied.

Bewahre die Zugriffsliste bei der Konfiguration des Agenten auf. Im [Arbeitsblatt zu Aktionsbefugnissen](/blog/worksheets/de/T07-action-authority.md) kannst du Tools, Verweise auf Zugangsdaten und Tests verweigerter Zugriffe festhalten. Prüfe die Liste erneut, wenn die Aufgabe ein neues Ziel oder eine neue Aktion erhält, besonders wenn ein bisheriger Entwurfshelfer veröffentlichen oder versenden soll.
