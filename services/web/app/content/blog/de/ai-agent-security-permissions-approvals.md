---
title: "KI-Agenten absichern: Rechte, Genehmigung und Audit"
description: "Prüfe KI-Agenten anhand konkreter Berechtigungen: Tool-Zugriff, Genehmigungen, Abbruch und Nachweise. Mit einem Beispiel für eine unerlaubte Nachricht."
slug: "ai-agent-security-permissions-approvals"
topicId: "T07"
reviewed: "2026-10-03"
draft: false
coverAlt: "Verschachtelte Rahmen begrenzen die Zugänge einer Aufgabe und zeigen ihre dokumentierten Spuren."
---

Ein KI-Agent sollte genau die Befugnisse erhalten, die seine Aufgabe erfordert. Folgenreiche Aktionen müssen Kontrollen unterliegen, die das Modell nicht umschreiben kann. Das ist die zentrale Sicherheitsentscheidung. Schutz vor Prompt Injection kann die Wahrscheinlichkeit einer schädlichen Anfrage verringern. Das System muss trotzdem festlegen, was passiert, wenn eine solche Anfrage ein Tool erreicht.

Beginne mit einem Projektergebnis, einer ausführenden Identität und den Ressourcen, auf die sie einwirken darf. Ein Agent, der einen Bericht zur Produkteinführung vorbereitet, muss möglicherweise Quellen lesen und ein Ergebnis schreiben. Er braucht deshalb nicht automatisch Postfach-Zugangsdaten, Rechte zur Änderung von Zugängen oder die Möglichkeit, den Bericht zu veröffentlichen.

Die entscheidende Frage lautet: Wenn nicht vertrauenswürdige Inhalte die nächste Anfrage dieses Agenten verändern, welche unerwünschten Auswirkungen bleiben möglich?

## Unterscheide Beeinflussung und Berechtigung

Bei einer Prompt Injection versucht Material, das ein Agent liest, sein Verhalten umzulenken. Ein Lieferantendokument könnte das Hochladen des internen Projektbriefings als notwendigen Verifizierungsschritt darstellen. Das Dokument darf Belege zum Lieferanten liefern. Es kann keine Befugnis über die Daten des Teams erteilen.

Modelltraining, Klassifikatoren und sorgfältige Anweisungen sind sinnvolle Schutzmaßnahmen. Sie ersetzen keine Autorisierung. Anthropic berichtet in seiner Forschung zu Browser-Agenten über verbesserte Widerstandsfähigkeit und benennt zugleich ein verbleibendes Prompt-Injection-Risiko. Die Ergebnisse betreffen die getestete Browserkonfiguration, nicht Tales Risiko oder eine allgemeingültige Angriffsquote. [Anthropic: Schutz vor Prompt Injection](https://www.anthropic.com/research/prompt-injection-defenses).

OWASP beschreibt übermäßige Handlungsmacht anhand unnötiger Funktionen, Berechtigungen und Autonomie. Zu den Empfehlungen gehören eng gefasste Tools, begrenzte Rechte und Autorisierung außerhalb des Modells. Praktisch heißt das: Entferne unnötige Befugnisse, bevor du diskutierst, ob das Modell verantwortungsvoll damit umgehen wird. [OWASP LLM06:2025](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/).

Ein Tool-Name allein belegt diese Grenze nicht. Eine Funktion „Kundendaten lesen“ kann ein Dienstkonto mit zu weitgehenden Rechten verwenden. Neben einem eingeschränkten Anwendungstool kann eine Shell mit umfassenderen Zugangsdaten verfügbar sein. Prüfe die tatsächlich ausführende Identität und alle Wege, die dieselbe Wirkung erreichen können.

![Fünf Fragen betreffen Identität, zugängliche Daten, Tools und Zugangsdaten, die Genehmigung von Auswirkungen sowie aufbewahrte Nachweise. Teste verweigerte und entzogene Zugriffe und prüfe die Abdeckung jedes Ausführungswegs.](/blog/diagrams/de/T07-diagram.svg)

## Prüfe eine Ankündigung, die nicht gesendet werden darf

Dieses fiktive Beispiel veranschaulicht einen Entwurf; es beschreibt keinen aufgezeichneten Tale-Test. Ein Team möchte einen Einführungsbericht erstellen und nach dessen Prüfung eine Ankündigung an ein kontrolliertes Testpostfach senden. Die vertrauenswürdige Aufgabe legt Projekt, vorgesehenen Empfänger und Ergebnis fest. Eine nicht vertrauenswürdige Lieferantenseite schlägt einen anderen Empfänger vor und verlangt einen internen Anhang.

Ein sinnvoller Entwurf trennt Vorbereitung und Versand. Der Recherche-Agent darf den Entwurf erstellen, erhält aber keine Versand-Zugangsdaten. Eine separate Operation schlägt den genauen Versand vor. Eine prüfende Person gleicht Empfänger und Inhalt mit der vertrauenswürdigen Aufgabe ab; der nachgelagerte Dienst setzt weiterhin den Berechtigungsumfang der Zugangsdaten durch.

| Vorgeschlagener Bestandteil | Die vertrauenswürdige Aufgabe erlaubt | Nicht vertrauenswürdiger Vorschlag | Entscheidung und Begründung |
| --- | --- | --- | --- |
| Aktion | Bericht vorbereiten, dann eine Testankündigung vorschlagen | Sofort ein Verifizierungspaket senden | Seitentext darf die Befugnisse des Ablaufs nicht verändern |
| Empfänger | Im Auftrag ausgewähltes, vom Team kontrolliertes Testpostfach | Adresse auf der Lieferantenseite | Ausgetauschtes Ziel ablehnen; die Herkunft zählt |
| Inhalt | Geprüfte Ankündigung | Ankündigung plus internes Anforderungsbriefing | Zusätzliche Datenoffenlegung ablehnen |
| Zugangsdaten | Auf die vorgesehene Operation beschränkter Versandweg | Umfassender Postfachzugriff für den Recherche-Agenten | Die weitergehenden Zugangsdaten nicht bereitstellen |
| Nachweis | Vorschlag, Entscheidung, Ausführungsergebnis, Empfang | Der Agent sagt „erfolgreich gesendet“ | Auch das empfangende System prüfen |

Entscheidend ist: Ein Angriff muss keinen neuen Tool-Aufruf erfinden. Ist `send_email` bereits erlaubt, kann schon ein geänderter Empfänger oder Anhang die unerwünschte Wirkung auslösen. Eine Liste erlaubter Hosts mit dem E-Mail-Anbieter legt nicht fest, welches Postfach, welcher Empfänger oder welches Dokument über diesen Host zulässig ist. Netzwerkgrenzen und Aktionsautorisierung beantworten unterschiedliche Fragen.

Die vorgeschlagene Trennung ist eine Architekturempfehlung. Ihre Durchsetzung muss im gewählten Produkt und nachgelagerten Dienst nachgewiesen werden. Diese Tabelle in die Anweisungen eines Agenten zu kopieren, implementiert sie nicht.

## Autorisiere die konkrete Operation

Frage bei einer folgenreichen Aktion, ob die ausführende Identität diese Operation an dieser Ressource mit diesen Eingaben für diese Aufgabe durchführen darf. Kläre anschließend, wer eine Ausnahme genehmigen darf. „Die Person hat E-Mail-Zugriff genehmigt“ ist zu weit gefasst, um zu beantworten, ob genau dieser Anhang an genau diesen Empfänger gehen darf.

Bevorzuge einen Versandweg, der die exakt vorgeschlagenen Eingaben bewertet und den aktuellen Zugriff bei der Ausführung prüft. Ändern sich die Eingaben nach der Prüfung, verlange eine neue Entscheidung, statt die bisherige Genehmigung als übertragbar zu behandeln. Bei eigenen Systemen ist die Bindung einer Entscheidung an eine konkrete Operation und Ressource eine zu implementierende und zu testende Anforderung. Hier wird sie nicht als Tale-Funktion behauptet.

Zugangsdaten außerhalb des Agenten-Dateisystems aufzubewahren, kann die Offenlegung ihrer Rohwerte begrenzen. Es bleibt trotzdem nötig, die Aktionen einzuschränken, die das authentifizierte Tool im Auftrag des Agenten durchführen kann. Ebenso schließt die Ergänzung von MCP die Autorisierung nicht ab: Dessen Sicherheitshinweise verbieten die Annahme von Tokens, die nicht für den MCP-Server ausgestellt wurden, und beschreiben Risiken durch einen fehlgeleiteten Vermittler bei der Einwilligung. [MCP: bewährte Sicherheitsverfahren](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices).

## Nutze stärkere Schutzansätze, ohne sie zu übertreiben

Das Forschungssystem CaMeL geht über die Aufforderung an ein Modell hinaus, schädlichen Text zu ignorieren: Es trennt Kontroll- und Datenflüsse und prüft Befugnisse bei der Tool-Ausführung. Die Autoren beschreiben zugleich Kompromisse bei der Nutzbarkeit, Pflegeaufwand für Regeln, menschliche Eingriffe und Grenzen bei Seitenkanälen. Das Bedrohungsmodell deckt nicht jeden Angriff auf die Textintegrität ab. Eine irreführende Zusammenfassung kann schaden, ohne einen geschützten Datenfluss zu verletzen. Die Forschung stützt die Durchsetzung von Grenzen. Sie belegt weder, dass Prompt Injection gelöst ist, noch dass Tale CaMeL implementiert. [Debenedetti und Kollegen, CaMeL-Preprint, überarbeitete Fassung vom Juni 2025](https://arxiv.org/html/2503.18813v2).

Für die Ankündigung verändert diese Unterscheidung die Prüfung. Ein verhinderter unzulässiger Versand belegt nicht, dass der Entwurf korrekt ist. Eine manipulierte Lieferantenseite könnte den Bericht weiterhin dazu bringen, eine Produktfunktion zu übertreiben. Behalte Quellen- und Ergebnisprüfung auch bei eng begrenzten Aktionsrechten bei.

Umgekehrt würde eine Genehmigung vor jedem Lesezugriff die normale Recherche behindern, ohne unbedingt die spätere Offenlegung zu kontrollieren. Setze einen Prüfpunkt dort, wo sich Befugnisse oder Offenlegung ändern: beim Hinzufügen eines neuen Ressourcenbereichs, beim Export interner Inhalte oder beim Auslösen einer externen Wirkung. Das ist eine aufgabenabhängige Entwurfsentscheidung, keine Regel, nach der jeder Schreibzugriff gleich folgenreich wäre.

## Berücksichtige Tales getrennte Ausführungswege

Tales Projektagenten erhalten konfigurierte Tools, Connectors, Skills und erlaubte Secrets. Die Kennzeichnung **Schreibt Daten** markiert Plattform-Tools, die innerhalb ihrer Zugriffsregeln echte Operationen ausführen können. Der Connector-Broker für Agenten stellt Leseaktionen bereit; direkte GitHub-Tools und ausdrücklich vergebene Secrets verwenden eigene Wege. Ein von einem Mitglied gestarteter Lauf ist auf die Aufgabe beschränkt und erhält weder die dem Agenten zugewiesenen Secrets noch das bereitgestellte GitHub-Token. Teste die Identität, die den Lauf tatsächlich starten wird. [Projektagenten](https://docs.tale.dev/de/platform/projects/project-agents) und [Agenten-Laufzeitumgebungen](https://docs.tale.dev/de/platform/agents/harnesses).

Die Prüfung eines Aufgabenergebnisses und die Erlaubnis einer Operation sind getrennte Entscheidungen. Die Abnahme eines Berichts erlaubt nicht automatisch einen Connector-Versand. Eine Antwort auf eine Rückfrage ist wiederum eine andere Interaktion. Der [Leitfaden zur Aufgabenautomatisierung](https://docs.tale.dev/de/platform/projects/task-automation) erläutert die Ergebnisprüfung und die dafür geltenden Prüfregeln.

Tales Operationsgenehmigungen erfassen die entsprechenden Connector-Schreibzugriffe in Live-Automationen. Externe Schreibzugriffe brauchen standardmäßig eine Genehmigung, interne, durch die Plattform authentifizierte Schreibzugriffe standardmäßig nicht. Die Organisationsrichtlinie kann dies für einzelne Connectors oder Aktionen ändern. Daraus folgt keine Erfassung sämtlicher Shell-Befehle oder Tool-Wege mit Secrets. [Genehmigungen konfigurieren](https://docs.tale.dev/de/platform/approvals/configure).

Die Genehmigungskarte zeigt die genauen Eingaben und erlaubt Genehmigen oder Ablehnen, aber keine Bearbeitung. Lehne falsche Eingaben ab, korrigiere sie und starte einen neuen Lauf. Prüfe, wer entscheiden darf: Über eine Karte an einer Aufgabe kann jede Person entscheiden, die diese Aufgabe öffnen darf. Zugriff auf die Laufdetails haben nur Inhaber, Admins und Entwickler. Karten werden keiner benannten Genehmigungsgruppe zugewiesen. Ein Team, das eine bestimmte genehmigende Person verlangt, kann diese Einschränkung nicht aus dem Vorhandensein einer Karte ableiten. [Grundlagen der Operationsgenehmigung](https://docs.tale.dev/de/platform/approvals/concepts).

## Teste eine Ablehnung und einen unklaren Ausgang

Verwende erfundene Inhalte und Ziele, die du kontrollierst. Tausche zunächst den Empfänger im vorgeschlagenen Testversand aus und lehne ihn ab. Prüfe sowohl die dokumentierte Entscheidung als auch das Ausbleiben der Zustellung. Genehmige in einem separaten, korrigierten Lauf den harmlosen Versand und kontrolliere das empfangende Postfach. Tales simulierter **Testlauf** führt den externen Schreibzugriff nicht aus und durchläuft nicht die Live-Genehmigungskarte. Er kann diese Ergebnisse daher nicht belegen. [Grundlagen der Operationsgenehmigung](https://docs.tale.dev/de/platform/approvals/concepts).

Betrachten wir nun einen konstruierten Fehler: Der Versanddienst nimmt die E-Mail an, aber die Verbindung des aufrufenden Systems bricht ab, bevor es die Antwort protokolliert. Die Aufgabe erscheint fehlgeschlagen oder ungeklärt. Eine Wiederholung der gesamten Aufgabe kann eine zweite E-Mail senden.

Pausiere weitere Sendungen und bewahre Operationseingaben, Kennungen und Zeitstempel auf. Suche im empfangenden System oder Zustellprotokoll des Anbieters nach der Wirkung. Ist die Zustellung bestätigt, dokumentiere sie und setze nur die übrige Arbeit fort. Wiederhole erst, wenn maßgebliche Belege zeigen, dass die ursprüngliche Anfrage keine Wirkung hatte und nicht mehr abgeschlossen werden kann, oder wenn die dokumentierte Idempotenzgarantie des empfangenden Dienstes die Wiederholung sicher abdeckt. Ein leeres Postfach oder ein bislang fehlender Zustelleintrag genügt dafür nicht. Bleibt der Ausgang unbekannt, halte ihn als unbekannt fest und eskaliere. Eine automatische Wiederholung würde aus einer Beleglücke eine mögliche zweite Wirkung machen.

Unterstützt eine empfangende API Idempotenz, verwende deren dokumentierte Schlüssel und Wiederholungsregeln, um doppelte Wirkungen innerhalb dieser Garantie zu verhindern. Andernfalls plane einen Abgleich oder eine manuelle Entscheidung. Das ist allgemeiner Rat zur Wiederherstellung, keine Aussage, dass jeder Tale-Connector Idempotenz bietet.

Auch Abbruch und Rücknahme sind verschieden. Tales Automations-Engine stoppt nachfolgende Arbeit an ihren Ausführungsgrenzen; bereits abgeschlossene Wirkungen werden nicht zurückgerollt. Prüfe vor einem Neustart, was schon passiert ist. [Ausführungsprotokolle](https://docs.tale.dev/de/platform/automations/execution-logs).

## Bewahre die Belege zur Rekonstruktion der Entscheidung auf

Für dieses Beispiel gehören vier Dinge zusammen: der Vorschlag, die genehmigende oder ablehnende Person, das gemeldete Ausführungsergebnis und der Nachweis im empfangenden System. Sie belegen unterschiedliche Tatsachen. Eine Genehmigung zeigt, dass eine Erlaubnis erteilt wurde. Sie beweist weder Zustellung noch inhaltliche Richtigkeit.

Tales Audit-Protokoll ist keine vollständige Abschrift aller Gespräche oder externen Dienste. Exporte sind gefiltert und begrenzt; Aufbewahrungsfristen verändern die verfügbare Historie. Prüfungen der Hash-Kette belegen weder die Erfassung jedes Ereignisses noch eine unabhängige Signatur. Die manuelle Prüfung umfasst höchstens 1.000 aufbewahrte Einträge. Kläre anhand des [Audit-Protokolls](https://docs.tale.dev/de/platform/admin/governance/audit-logs) und des [Integritätsleitfadens](https://docs.tale.dev/de/self-hosted/operate/security/audit-log-integrity), was die Plattformnachweise belegen können. Bewahre fehlende Nachweise nachgelagerter Systeme bei Bedarf gesondert auf.

## Ändere den Entwurf, wenn sich die Arbeit ändert

Bei einer folgenarmen Entwurfsaufgabe ohne sensible Daten oder externe Schreibrechte bringt eine verpflichtende menschliche Entscheidung vor jedem Tool-Aufruf möglicherweise wenig. Erlaube begrenzte Arbeit und prüfe das entstandene Ergebnis. Für wiederholte, vorhersehbare Schreibzugriffe lässt sich eine eng gefasste API-Operation mit deterministischer Validierung unter Umständen leichter kontrollieren als ein Agent, der beliebige Ziele auswählt.

Strengere Maßnahmen sind sinnvoll, wenn der Agent sensible Informationen lesen und an weit gefasste Ziele schreiben kann oder wenn Fehler schwer rückgängig zu machen sind. Begrenze seine Befugnisse, trenne Vorbereitung und Ausführung oder belasse die letzte Aktion bei einem Menschen. Eine prüfende Person braucht ausreichend Kontext und einen durchsetzbaren Entscheidungspunkt. Das Wort „Genehmigung“ allein bietet beides nicht.

Das [Arbeitsblatt zu Aktionsbefugnissen](/blog/worksheets/de/T07-action-authority.md) enthält die ausgefüllte Beispielentscheidung, eine kompakte Befugnisdokumentation und die Übung zur Wiederherstellung bei unklarer Zustellung. Bring zu einer [Tale-Demo](/de/request-demo) eine reale Aufgabe und deren verfügbare Aktionswege mit. Halte bereits fest, welche Wirkungen ausgeschlossen bleiben müssen.
