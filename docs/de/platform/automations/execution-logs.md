---
title: Automatisierungsläufe prüfen und Fehler beheben
description: Verfolge einen Lauf bis zur betroffenen Node, prüfe protokollierte Schreibvorgänge und entscheide über Stopp, Korrektur oder Neustart.
---

Öffne eine Automatisierung, wechsle zum Tab **Läufe** und wähle einen Eintrag. Prüfe zuerst Status, Version und Modus, dann die betroffene Node. Ein erfolgreicher Testlauf belegt den simulierten Ablauf. Er beweist nicht, dass ein echtes externes Konto dieselbe Aktion akzeptiert.

## Den Laufstatus lesen

Der Tab **Läufe** zeigt die letzten 50 Läufe, neueste zuerst. Jede Zeile nennt Version, Zeitpunkt, Modus und Auslöser oder eine Fehler- beziehungsweise Wartebegründung. Im Detail siehst du Workflow, Node-Ergebnisse und Laufzeiten. Ein nicht abgeschlossener Lauf hat keinen Endzeitpunkt. Die Tabs bleiben beim Prüfen eines Laufs sichtbar. Mit **Läufe** kehrst du zur Liste zurück, mit **Editor** zum Bearbeiten des Workflows.

| Status | Bedeutung | Nächster Schritt |
| --- | --- | --- |
| **In der Warteschlange** | Angenommen, wartet auf die Ausführung. | Warte und prüfe bei ausbleibendem Fortschritt die Kapazität. |
| **Läuft** | Der Ablauf wird verarbeitet. | Beobachte den Fortschritt der Nodes. |
| **Wartet** | Entscheidung, Antwort, Agentenarbeit oder Abfragebedingung steht aus. | Lies, worauf der Lauf wartet. |
| **Erfolgreich** | Erreichte Nodes sind abgeschlossen und die Ausgabe liegt vor. | Prüfe Ausgabe und Auswirkungen. |
| **Fehlgeschlagen** | Der Lauf endete mit einem unbehandelten Fehler. | Öffne die betroffene Node und lies ihren Fehler. |
| **Gestoppt** | Der Lauf wurde abgebrochen. | Prüfe bereits ausgeführte Arbeit vor einem Neustart. |

Eine ausstehende Freigabe oder Frage braucht eine Person. Ein arbeitender Agent oder eine wiederholte Abfrage kann ohne Eingriff fortfahren. Eine Entscheidung oder Antwort kann auch abgelehnt werden oder ablaufen. Entscheide anhand der Begründung, nicht allein nach **Wartet**. [Freigaben in Workflows](/de/platform/automations/approvals-in-workflows) erklärt die Entscheidungsfelder.

## Die betroffene Node untersuchen

Wähle eine Node auf dem Canvas des Laufs. **Aufgelöste Eingabe** zeigt die Werte nach der Vorlagenauswertung, **Ausgabe** das Ergebnis des Schritts. So unterscheidest du einen falschen Verweis von einem Dienstausfall.

Node-Zustände sind unter anderem **Gelaufen**, **Übersprungen**, **Fehlgeschlagen**, **Nie erreicht** und **Noch nicht erreicht**. Eine Node kann wegen einer falschen Bedingung, einer Abhängigkeit, eines anderen Zweigs oder einer Weiterlaufregel übersprungen werden. Das ist nicht immer ein Fehler.

Beispielsweise kann eine Erinnerungs-Node den Kundennamen, aber eine leere Rechnungs-ID erhalten. Prüfe die Ausgabe davor. Verwendet der Datensatz inzwischen ein anderes Feld, korrigiere den Verweis statt der Mail-Zugangsdaten. Prüfe danach die aufgelöste Eingabe in einem neuen Testlauf.

Anwendungen erhalten über die [Lauf-API](/de/develop/api-reference) zusätzlich `failureCode`, wenn die Ursache eines fehlgeschlagenen Laufs klassifiziert wurde. `approval_rejected` bedeutet etwa, dass eine Person die Aktion abgelehnt hat; bei `llm_output_invalid` entsprach die Modellantwort nicht der geforderten Struktur. Ältere Fehler können ohne Code vorliegen. Der Code hilft bei der Untersuchung, belegt aber weder die Unbedenklichkeit noch den Erfolg eines neuen Versuchs.

## Bereits erfolgte Änderungen prüfen

Die Auswirkungen protokollieren Connector-Schreibvorgänge mit Node, Connector und Eingabe. Tests verwenden festgelegte Ersatzantworten; Live-Aktionen können externe Systeme ändern. Fehlen protokollierte Auswirkungen, zeigt der Lauf das ausdrücklich an.

Lies diese Liste vor einer Wiederholung. Ein späterer Fehler macht eine frühere Nachricht oder Änderung nicht rückgängig. Ist die Zustellung entscheidend, prüfe auch den empfangenden Dienst. Die Auswirkungen bleiben beim Lauf, bis Löschung oder Aufbewahrungsregeln den Datensatz entfernen. Sie sind kein eigenständiges dauerhaftes Archiv.

## Fortsetzung und automatische Wiederholungen verstehen

Der Ablauf speichert abgeschlossene Nodes als Checkpoints und setzt danach fort. Geht eine Fortsetzung verloren, kann der nicht abgeschlossene Lauf nach einer Wartefrist wieder aufgenommen werden. Ein separater neuer Lauf besitzt eigene Checkpoints und kann Schreibvorgänge wiederholen. Neu starten ist deshalb etwas anderes als den bestehenden Lauf fortzusetzen.

Ein geeigneter Agentenfehler erlaubt nach dem ersten Versuch bis zu drei automatische Wiederholungen. Frühere Checkpoints bleiben erhalten; der Kopfbereich zeigt den Wiederholungszähler. Arbeitet ein Versuch mindestens fünfzehn Minuten, wird dieses Wiederholungsbudget erneuert. Abonnement-Pools können für einen neuen Versuch ein anderes Konto wählen.

Ein Agentenschritt schlägt auch fehl, wenn sein Modell überhaupt nichts liefert: keinen Text, keinen Tool-Aufruf und keine erzeugten Tokens. So kann ein Modellserver antworten, der mitten in der Antwort ausfällt. Der Lauf meldet dann auf Englisch „The model returned an empty answer, so the agent did nothing this turn.“ Auch dieser Fehler erhält diese Wiederholungen. Hat das Modell nur Tools verwendet oder erzeugte Tokens ohne sichtbaren Text gemeldet, etwa für Denkschritte, gilt das als Antwort. Der Schritt scheitert dann nicht aus diesem Grund.

Ein ausgeschöpftes Ausführungszeitfenster, eine abgelaufene Frage oder eine Ablehnung wegen des Budgets erhält diese Wiederholungen nicht. Jeder Versuch verbraucht eigene Ressourcen; frühere Kosten entfallen nicht. Kann ein erneuter Versuch die Ursache nicht beheben, stoppe den Lauf und korrigiere die Abhängigkeit vor dem Neustart.

## Stoppen oder den Workflow korrigieren

Wähle bei einem nicht abgeschlossenen Lauf **Lauf stoppen**, wenn du ihn abbrechen möchtest. Der Abbruch verhindert weitere Arbeit an den Ausführungsgrenzen des Ablaufs. Bereits erfolgte Änderungen werden nicht zurückgesetzt. Endet der Lauf, bevor der Abbruch ihn erreicht, bleibt sein abgeschlossenes Ergebnis erhalten.

Korrigiere einen Dokumentfehler im Editor an der betroffenen Eingabe oder Node und speichere eine Version mit aussagekräftiger Nachricht. Teste mit typischen Eingaben und prüfe Werte und Ausgabe, nicht nur den Erfolgsstatus. Schalte die geprüfte Version live. Zeitpläne und Webhooks verwenden danach diese Version; der ältere fehlgeschlagene Lauf dokumentiert weiterhin die alte.

Ist gar kein Lauf entstanden, prüfe den [Trigger](/de/platform/automations/triggers). Ein deaktivierter Trigger, eine fehlende Live-Version oder abgelehnte Eingaben können den Start verhindert haben.
