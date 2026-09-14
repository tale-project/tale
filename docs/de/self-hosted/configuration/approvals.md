---
title: Genehmigungsregeln für Automationen festlegen
description: Lege fest, welche Connector-Schreibaktionen eine Prüfung brauchen, und prüfe die Regelauswertung.
---
Genehmigungsregeln bestimmen, ob eine schreibende Connector-Aktion sofort läuft oder auf eine Person wartet. Standardmäßig brauchen Schreibzugriffe auf externe Systeme eine Genehmigung; interne Connectors mit Plattformauthentifizierung dürfen schreiben. Passe diese Grenze je Organisation an ihren Prüfprozess an.

## Richtlinie der Organisation definieren

Speichere die Regeln in `TALE_CONFIG_DIR/<orgSlug>/governance/approval-policy.yml`. Jede Regel nennt genau einen `connector` oder eine vollständige `action` und danach `decision`.

Dieses Beispiel verlangt eine Prüfung für Schreibaktionen des internen Connectors `task` und erlaubt `imap-smtp.send` ohne eigene Genehmigung:

```yaml
rules:
  - connector: task
    decision: require_approval
  - action: imap-smtp.send
    decision: auto_approve
```

<Warning>

`auto_approve` erlaubt die passende Schreibaktion ohne menschliche Prüfung an dieser Stelle. Prüfe Aktion, Zugangsdaten und vorgesehene Empfänger, bevor du einen externen Schreibzugriff wie den E-Mail-Versand freigibst.

</Warning>

Verwende Bezeichner aus dem ausgelieferten Katalog, keine übersetzten Anzeigenamen. Das Aktionsformat lautet `<connector>.<action>`; zulässige Entscheidungen sind `auto_approve` und `require_approval`.

## Überlappende Regeln auswerten

Eine Aktionsregel hat unabhängig von ihrer Position Vorrang vor einer Connector-Regel. Bei gleich spezifischen Treffern gewinnt die letzte Regel. Ohne Treffer verwendet Tale die oben beschriebene Unterscheidung zwischen intern und extern. Führe jedes Ziel möglichst nur einmal auf, damit das Ergebnis ohne Nachverfolgen von Überschreibungen verständlich bleibt.

Die Richtlinie wirkt auf neue Prüfungen. Eine ausstehende Genehmigung bleibt erhalten, wenn du die Regel lockerst; sie wird nicht automatisch erteilt. Die Datei hebt auch keine unabhängigen Prüfungen auf, etwa die Veröffentlichung einer Automation oder den Abschluss einer prüfpflichtigen Aufgabe.

## Wirkung prüfen

Teste die Regel vor dem Produktiveinsatz mit einer isolierten Automation und unkritischen Daten. Prüfe eine passende Aktion und eine, für die der Standard gelten soll. Kontrolliere ausstehende Genehmigung und Ausführungsverlauf im [Genehmigungsablauf](/de/platform/approvals/configure).

Neue Entscheidungen über Schreibzugriffe lesen die aktuelle Richtlinie und den Organisations-Slug ohne den kurzen Anzeigecache. Ist die Richtlinie ungültig oder ihr Konfigurationsverzeichnis nicht verfügbar, stoppt der Vorgang vor dem Schreiben. Repariere die Konfiguration, bevor du ihn wiederholst. Nur eine fehlende Richtliniendatei in einem verfügbaren Konfigurationsbaum führt zu den Standardregeln. Eine fehlerhafte `.yml`-Datei wird nie durch eine benachbarte `.json` ersetzt. Bereits gespeicherte Freigaben behalten ihre Entscheidung; das gilt sowohl für ausstehende als auch für zuvor genehmigte Vorgänge.
