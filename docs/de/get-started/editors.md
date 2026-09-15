---
title: Einen Projektagenten erstellen und testen
description: Einem Projektagenten einen klaren Auftrag geben, ihn starten und das Ergebnis prüfen.
---

Ein Projektagent ist ein wiederverwendbarer Arbeitsauftrag für Projektaufgaben. Du legst Anweisungen, Laufzeit, Modell und Werkzeuge fest, startest ihn an einer Aufgabe und prüfst das Ergebnis.

## Was du brauchst

Du brauchst Bearbeitungsrechte im Projekt, einen geeigneten Modellanbieter und eine verfügbare Agentenlaufzeit samt benötigter Infrastruktur. Ein funktionierender Chat prüft den Chat-Zugriff des Anbieters. Er belegt nicht, dass Agentenlaufzeit oder Sandbox bereitstehen. Bitte einen Admin, die [Agentenlaufzeiten](/de/platform/agents/harnesses) zu prüfen, wenn keine verfügbar ist.

Erstelle oder öffne zuerst ein Projekt. [Projekte nutzen](/de/tutorials/member/use-projects) erklärt Freigaben und Wissensquellen.

## Einen klaren Auftrag geben

<Steps>

<Step title="Einen Agenten im Projekt erstellen">

Öffne den Tab **Agenten** und wähle **Neuer Agent**. Benenne ihn nach seiner Aufgabe, etwa „Launch-Prüfer“. Wähle unter **Agent-Laufzeit** und **Modell** die passende Kombination, die dein Arbeitsbereich unterstützt. Gibt es mehrere Anbietereinträge für dasselbe Modell, wähle auch den vorgesehenen Anbieter.

<Frame caption="Projektagenten verbinden eine benannte Aufgabe mit Laufzeit und Modell.">

![Der Agenten-Tab des Projekts zeigt Agenten mit ihrer konfigurierten Laufzeit und ihrem Modell.](/images/platform/project-agents-models.webp)

</Frame>

</Step>

<Step title="Prüfbare Anweisungen formulieren">

Beschreibe unter **Anweisungen** die Aufgabe, die Quellen, das Ausgabeformat und die Grenzen. Zum Beispiel:

> Prüfe das an die Aufgabe angehängte Launch-Briefing. Liste fehlende Entscheidungen, unklare Zuständigkeiten und Widersprüche auf. Zitiere zu jedem Befund die betreffende Stelle. Ändere keine Dateien und kontaktiere keine externen Dienste. Fehlt das Briefing, frage danach.

Gewähre nur die **Skills, Connectors & Tools** und **Secrets**, die diese Aufgabe braucht. Speichere mit **Agent erstellen**. Nach dem ersten Ergebnis kannst du den Auftrag überarbeiten.

</Step>

<Step title="Eine konkrete Aufgabe zuweisen und starten">

Erstelle eine Aufgabe mit klarer Beschreibung und den nötigen Eingabedateien. Weise den Agenten zu und wähle dann **Agent starten**. Zuweisen und Starten sind getrennte Aktionen. Beobachte während der Ausführung Status und Aktivität der Aufgabe.

Kann der Agent nicht starten, lies zuerst die angezeigte Ursache. Fehlende Anbieter, nicht verfügbare Laufzeiten, Richtlinien und fehlende Eingaben erfordern unterschiedliche Lösungen.

</Step>

</Steps>

## Das Ergebnis prüfen

Lies den Aufgabenkommentar des Agenten und mögliche Ausgabedateien. Vergleiche sie mit dem Auftrag: Wurde die richtige Quelle geprüft, ist jeder Befund belegt und blieb der Agent im vorgegebenen Rahmen? Eine abgeschlossene Ausführung bedeutet noch kein richtiges Ergebnis.

Halte Prüfung und Abschluss bewusst fest. Gib über die Aufgabenfunktionen Rückmeldung, fordere bei Bedarf einen weiteren Durchlauf an und schließe akzeptierte Arbeit ab. [Projektaufgaben](/de/platform/projects/tasks) erklärt Status und Prüferfeld.

<Tip>

Teste neben einer normalen Aufgabe auch fehlende Eingaben. Ein Agent, der nach einem fehlenden Briefing fragt, hilft mehr als einer, der dessen Inhalt erfindet.

</Tip>

## Schrittweise verfeinern

Verbessere die Anweisung, die zum schlechten Ergebnis geführt hat, und teste eine vergleichbare Aufgabe. Ergänze Werkzeuge nur bei Bedarf. Prüfe vor externen Schreibaktionen das [Genehmigungsverhalten](/de/platform/approvals/concepts). Ein längeres Beispiel findest du unter [Dein erster Agent von Anfang bis Ende](/de/tutorials/editor/first-agent-end-to-end).
