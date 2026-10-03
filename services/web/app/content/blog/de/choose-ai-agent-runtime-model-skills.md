---
title: "Welche Laufzeitumgebung passt zu deinem KI-Agenten?"
description: "Unterscheide Laufzeitumgebung und Modell, schließe ungeeignete Konfigurationen aus und vergleiche die übrigen an einer echten Aufgabe deines Teams."
slug: choose-ai-agent-runtime-model-skills
topicId: T09
reviewed: '2026-10-03'
draft: false
coverAlt: "Getrennte, zusammenpassende Bauteile bilden eine Agentenkonfiguration."
---

Ein Modell erzeugt Antworten und schlägt Aktionen vor. Die Laufzeitumgebung eines Agenten, auch Harness genannt, steuert die Sitzung darum herum: Sie ruft Tools auf, arbeitet mit Dateien und gibt Ergebnisse an das Modell zurück. Die Modellwahl beantwortet deshalb nur einen Teil der Frage. Du brauchst auch Software, die die Aufgabe mit deinen Dateien, Tools und Zugriffsregeln erledigen kann.

Beginne mit einer Aufgabe, die dein Team bereits gut kennt. Schließe Konfigurationen aus, die sie unter euren Betriebsbedingungen nicht erledigen können. Vergleiche die verbleibenden Kandidaten anschließend an dieser Aufgabe. Eine Funktionsliste hilft bei der Vorauswahl; entscheiden kannst du anhand der fertigen Arbeit.

## Verstehe, welchen Teil du auswählst

Angenommen, du brauchst einen Recherchebericht aus einem internen Dokument und mehreren öffentlichen Quellen. Das Modell kann die Frage verstehen und der Lauf trotzdem scheitern, weil er das Dokument nicht öffnen, eine Quelle nicht erreichen oder keine bearbeitbare Datei zurückgeben kann.

Dafür lohnt es sich, die Teile der Konfiguration auseinanderzuhalten:

- Die **Laufzeitumgebung** steuert die Arbeitssitzung und den Einsatz der Tools.
- **Modell und Anbieter** bestimmen, welches Modell antwortet und wie du darauf zugreifst.
- **Skills** liefern wiederverwendbare Anweisungen und Ressourcen für eine Art von Arbeit.
- **Tools und Zugangsdaten** bestimmen, welche Aktionen verfügbar sind.
- Der **Arbeitsbereich** enthält die Dateien, die der Agent liest, erstellt und später wieder benötigt.

Diese Teile müssen zusammenpassen. Ein Skill zur Erstellung von Tabellen hilft nur, wenn dem Lauf die nötigen Tools zur Verfügung stehen. Ein Modell, das im normalen Chat verfügbar ist, lässt sich nicht zwangsläufig mit der gewählten Laufzeitumgebung und den vorhandenen Zugangsdaten nutzen. Tales [Leitfaden zu Laufzeitumgebungen](https://docs.tale.dev/de/platform/agents/harnesses) beschreibt die unterstützten Kombinationen und ihr Verhalten.

![Laufzeitumgebung, Modell, Anbieter, Skills, Tools und Arbeitsbereich bilden gemeinsam eine Konfiguration. Prüfe ihr Zusammenspiel an der Aufgabe, die du delegieren möchtest.](/blog/diagrams/de/T09-diagram.svg)

## Schließe ungeeignete Optionen aus

Schreibe ein kurzes Briefing, bevor du Kandidaten ausprobierst. Zum Beispiel:

> Vergleiche drei Anbieter anhand der beigefügten Anforderungen und ihrer öffentlichen Produktdokumentation. Erstelle einen bearbeitbaren Vergleich mit einer Quelle für jede wesentliche Aussage. Nach der ersten Recherche ändere ich möglicherweise die Zielgruppe. Hinterlasse deine Quellennotizen, damit jemand anderes weiterarbeiten kann. Kontaktiere keine Anbieter und veröffentliche nichts.

Ergänze die Bedingungen, die für dein Team wirklich zählen: Welche Daten dürfen das Unternehmen verlassen, welche Konten sind verfügbar und welche Ausgabenbegrenzungen müssen greifen? Trenne Anforderungen von Annehmlichkeiten. Sind bearbeitbare Dateien zwingend nötig, reicht eine gut formulierte Antwort ohne diese Dateien nicht aus.

Lass jeden Kandidaten den nötigen Dateizugriff, die Tool-Verbindung und das Ausgabeformat demonstrieren. Nutze die Rolle, mit der auch die echte Aufgabe laufen wird. Eine Konfiguration, die nur mit Administratorzugang funktioniert, ist noch nicht für ein Teammitglied einsatzbereit.

Auch der Zugang zum Anbieter kann die Vorauswahl entscheiden. Unterstützte direkte Abonnementaufrufe in Tale umgehen beispielsweise dessen Gateway-Verbrauchserfassung und Ausgabenlimits. Sind diese Limits zwingend erforderlich, kläre zuerst einen geeigneten Zugangsweg, bevor du die Texte bewertest. Prüfe die aktuelle [Dokumentation zu Laufzeitumgebungen und Zugangsdaten](https://docs.tale.dev/de/platform/agents/harnesses).

## Vergleiche die Arbeit und deinen Korrekturaufwand

Gib den verbleibenden Kandidaten dasselbe Briefing und dieselben Quellen. Lege vorher fest, was den Vergleich brauchbar macht: Er muss die genannten Anforderungen abdecken, belegende Textstellen nennen, fehlende Angaben von einem negativen Befund unterscheiden und die gewünschten Dateien liefern.

Lies die Ergebnisse, statt dich auf die Fertigmeldung des Agenten zu verlassen. Wird aus „auf der Website nicht erwähnt“ die Behauptung „der Anbieter unterstützt das nicht“? Belegen die Quellen die Aussagen im Vergleich? Wie viel müsstest du prüfen und umschreiben, bevor du ihn weitergibst?

Ein erstes vielversprechendes Ergebnis ist ein Anlass für weitere typische Fälle. Nimm eine knappe Quelle, einen Widerspruch und ein Dokument hinzu, das den schwierigen Fällen deines Teams ähnelt. Der [Leitfaden zur Bewertung eines KI-Piloten](/de/blog/evaluate-ai-agents-business-tasks) erklärt, wie du brauchbare Ergebnisse und den menschlichen Aufwand dahinter vergleichst.

Halte beim Testen Laufzeitumgebung, Modell, Anbieter, Skill-Version und freigegebene Tools fest. Du wählst diese gesamte Konfiguration aus. Verwenden zwei Kandidaten verschiedene Modelle und Tools, verrät ein besseres Ergebnis nicht, welcher Teil dafür verantwortlich ist. Für eine praktische Auswahl musst du diese Forschungsfrage nicht lösen. Du solltest das Ergebnis aber nicht als Beweis für ein grundsätzlich überlegenes Modell ausgeben.

## Probiere eine Korrektur und eine Übergabe aus

Eine Recherche bleibt selten beim ersten Briefing. Ändere die Zielgruppe bei jedem Kandidaten von einem technischen Einkäufer zu einer Finanzverantwortlichen, sobald er seine Quellen gesammelt hat. Prüfe, ob der endgültige Vergleich die Änderung berücksichtigt und ob alte Annahmen in den Begleitdateien stehen bleiben. Gib die Korrektur jeweils in derselben Arbeitsphase, statt nach derselben Zahl von Sekunden.

Lass anschließend einen anderen Agenten anhand der gespeicherten Quellennotizen weiterarbeiten. Findet er die Belege und erkennt er, was noch unklar ist? Gespeicherte Dateien, die Fortsetzung eines Gesprächs und die Übergabe an jemand anderen sind unterschiedliche Dinge. Für die Übergabe selbst hilft ein [kurzes Fortsetzungsbriefing](/de/blog/persistent-ai-agent-workspaces-handoffs).

Hast du einen Recherche-Skill eingebunden, prüfe eine seiner konkreten Vorgaben im Ergebnis. Verlangt er etwa die Trennung von beobachteten Fakten und Hypothesen, sollte diese Unterscheidung im Bericht sichtbar sein. Ein Skill in der Konfiguration beweist noch nicht, dass der Agent ihn befolgt hat.

Wähle die Konfiguration, die eure Anforderungen erfüllt und dem Team regelmäßig weniger Restarbeit lässt. Liegen zwei Optionen nahe beieinander, kann eine vertraute Laufzeitumgebung mehr wert sein als ein kleiner Vorteil in einem einzelnen Beispiel. Bewahre einige typische Aufgaben auf, um sie bei Änderungen an Modell, Laufzeitumgebung, Tools oder Skills erneut auszuführen.

Das [Arbeitsblatt zur Auswahl einer Laufzeitumgebung](/blog/worksheets/de/T09-runtime-selection.md) bietet Platz für die Vorauswahl, Konfigurationen und Beobachtungen. Eine brauchbare Entscheidung ist konkret: „Wir nutzen diese Konfiguration für Anbieterrecherchen. Sie verarbeitet unsere Quelldateien, nimmt Korrekturen auf und hinterlässt prüfbare Notizen.“ Damit lässt sich ein begrenzter Pilot beginnen, ohne den besten Agenten für jede denkbare Aufgabe zu behaupten.
