---
title: Automatisierungsläufe prüfen und Fehler beheben
description: Verfolge einen Lauf bis zur betroffenen Node, prüfe protokollierte Schreibvorgänge und entscheide über Stopp, Korrektur oder Neustart.
---

Öffne eine Automatisierung, wechsle zum Tab **Läufe** und wähle einen Eintrag. Prüfe zuerst Status, Version und Modus, dann die betroffene Node. Ein erfolgreicher Testlauf belegt den simulierten Ablauf. Er beweist nicht, dass ein echtes externes Konto dieselbe Aktion akzeptiert.

<Frame caption="Ein abgeschlossener Testlauf: Status, Modus, Version, Starter und Zeiten über dem Workflow, mit dem Ergebnis jeder Node.">

![Die Seite eines Testlaufs von Triage GitHub issues, markiert mit Succeeded, Test und v1 und von dir gestartet, mit Start- und Endzeit über dem Workflow-Graphen, in dem die Nodes issues, open issues, score und report jeweils Ran zeigen; unter dem Graphen beginnt die Liste der Auswirkungen des Laufs.](/images/platform/automation-run-detail.webp)

</Frame>

## Den Laufstatus lesen

Der Tab **Läufe** zeigt die letzten 50 Läufe, die du sehen kannst, neueste zuerst. Läufe der Organisation selbst sehen Inhaber, Admins und Entwickler. Einen Lauf in einem Projekt und die Frage, auf die er wartet, sehen nur diejenigen von ihnen, die dieses Projekt öffnen können. Jede Zeile nennt Version, Zeitpunkt, Modus und Auslöser oder eine Fehler- beziehungsweise Wartebegründung. Im Detail siehst du Workflow, Node-Ergebnisse und Laufzeiten. Ein nicht abgeschlossener Lauf hat keinen Endzeitpunkt. Die Tabs bleiben beim Prüfen eines Laufs sichtbar. Mit **Läufe** kehrst du zur Liste zurück, mit **Editor** zum Bearbeiten des Workflows.

| Status | Bedeutung | Nächster Schritt |
| --- | --- | --- |
| **In der Warteschlange** | Angenommen, wartet auf die Ausführung. | Warte und prüfe bei ausbleibendem Fortschritt die Kapazität. |
| **Läuft** | Der Ablauf wird verarbeitet. | Beobachte den Fortschritt der Nodes. |
| **Unterbrochen — wird fortgesetzt** | Der Server, auf dem der Lauf lief, ist ausgefallen; ein anderer übernimmt ihn innerhalb von etwa anderthalb Minuten. | Warte; du musst nichts tun. |
| **Wartet** | Entscheidung, Antwort, Agentenarbeit oder Abfragebedingung steht aus. | Lies, worauf der Lauf wartet. |
| **Zurückgehalten** | Das Ergebnis der vor dem Upgrade begonnenen Arbeit ist unbekannt. | Prüfe die Angaben zur Sperre; geh nicht davon aus, dass eine Wiederholung sicher ist. |
| **Erfolgreich** | Erreichte Nodes sind abgeschlossen und die Ausgabe liegt vor. | Prüfe Ausgabe und Auswirkungen. |
| **Fehlgeschlagen** | Der Lauf endete mit einem unbehandelten Fehler. | Öffne die betroffene Node und lies ihren Fehler. |
| **Gestoppt** | Der Lauf wurde abgebrochen. | Prüfe bereits ausgeführte Arbeit vor einem Neustart. |

Eine ausstehende Freigabe, eine Frage oder ein Schritt, der vielleicht schon gelaufen ist, braucht eine Person. Ein arbeitender Agent oder eine wiederholte Abfrage kann ohne Eingriff fortfahren. Eine Entscheidung oder Antwort kann auch abgelehnt werden oder ablaufen. Entscheide anhand der Begründung, nicht allein nach **Wartet**. [Freigaben in Workflows](/de/platform/automations/approvals-in-workflows) erklärt die Entscheidungsfelder.

## Ein nach dem Upgrade zurückgehaltener Lauf

**Zurückgehalten** bedeutet, dass Tale das Ergebnis der vor dem Upgrade begonnenen Arbeit nicht prüfen kann. Der Lauf wird weder automatisch fortgesetzt noch erneut ausgeführt; seine Aufgabe bleibt reserviert. Gespeicherte Checkpoints und Auswirkungen bleiben lesbar. Fehlende Auswirkungen beweisen nicht, dass ein externer Dienst nichts erhalten hat.

Lass den Lauf während der Prüfung zurückgehalten. **Stopp anfordern** bittet Tale, die zuordenbaren Sitzungen zu stoppen, und erklärt die Unsicherheit vor deiner Bestätigung. **Stopp angefordert** bestätigt nicht, dass die Arbeit gestoppt wurde: Die Sperre bleibt, bis der Stopp der bisherigen Arbeit bestätigt ist. Frühere externe Aktionen werden nicht rückgängig gemacht. Ändert sich die Sperre bei offenem Bestätigungsdialog, schließ ihn und prüfe die aktuellen Angaben.

## Die betroffene Node untersuchen

Wähle eine Node auf dem Canvas des Laufs. **Aufgelöste Eingabe** zeigt die Werte nach der Vorlagenauswertung, **Ausgabe** das Ergebnis des Schritts. So unterscheidest du einen falschen Verweis von einem Dienstausfall.

Node-Zustände sind unter anderem **Gelaufen**, **Übersprungen**, **Fehlgeschlagen**, **Nie erreicht**, **Noch nicht erreicht** und bei einem gestoppten Lauf **Hier gestoppt** für die Node, an der der Lauf beim Stoppen stand. Eine Node kann wegen einer falschen Bedingung, einer Abhängigkeit, eines anderen Zweigs oder einer Weiterlaufregel übersprungen werden. Das ist nicht immer ein Fehler.

Beispielsweise kann eine Erinnerungs-Node den Kundennamen, aber eine leere Rechnungs-ID erhalten. Prüfe die Ausgabe davor. Verwendet der Datensatz inzwischen ein anderes Feld, korrigiere den Verweis statt der Mail-Zugangsdaten. Prüfe danach die aufgelöste Eingabe in einem neuen Testlauf.

Anwendungen erhalten über die [Lauf-API](/de/develop/api-reference) zusätzlich `failureCode`, wenn die Ursache eines fehlgeschlagenen Laufs klassifiziert wurde. `approval_rejected` bedeutet etwa, dass eine Person die Aktion abgelehnt hat; bei `llm_output_invalid` entsprach die Modellantwort nicht der geforderten Struktur. Ältere Fehler können ohne Code vorliegen. Der Code hilft bei der Untersuchung, belegt aber weder die Unbedenklichkeit noch den Erfolg eines neuen Versuchs.

## Bereits erfolgte Änderungen prüfen

Die Auswirkungen protokollieren Connector-Schreibvorgänge mit Node, Connector und Eingabe. Tests verwenden festgelegte Ersatzantworten; Live-Aktionen können externe Systeme ändern. Fehlen protokollierte Auswirkungen, zeigt der Lauf das ausdrücklich an.

Lies diese Liste vor einer Wiederholung. Ein späterer Fehler macht eine frühere Nachricht oder Änderung nicht rückgängig. Ist die Zustellung entscheidend, prüfe auch den empfangenden Dienst. Die Auswirkungen bleiben beim Lauf, bis Löschung oder Aufbewahrungsregeln den Datensatz entfernen. Sie sind kein eigenständiges dauerhaftes Archiv. Wird die Automatisierung gelöscht, bleiben ihre Läufe: Die Laufseite öffnet weiterhin, mit dem Löschdatum markiert und aus der Aufzeichnung des Laufs gezeichnet, bis die Aufbewahrung sie entfernt.

## Fortsetzung und automatische Wiederholungen verstehen

Der Ablauf speichert abgeschlossene Nodes als Checkpoints und setzt danach fort. Ein separater neuer Lauf besitzt eigene Checkpoints und kann Schreibvorgänge wiederholen. Neu starten ist deshalb etwas anderes als den bestehenden Lauf fortzusetzen.

Ein Lauf kann während der Ausführung auf einen anderen Server wechseln. Ein Server, der aktualisiert oder neu gestartet wird, gibt seine Läufe beim nächsten Schritt weiter: Der laufende Schritt wird noch fertig, und der nächste Server macht mit dem folgenden Schritt weiter oder, wenn der Schritt einmal pro Element läuft, mit dem nächsten Element. Arbeitet ein Schritt 20 Sekunden nach Beginn des Neustarts noch, wird er unterbrochen und läuft auf dem nächsten Server noch einmal. Hält ein Server ohne Vorwarnung an, übernimmt ein anderer seine Läufe innerhalb von etwa anderthalb Minuten. Abgeschlossene Schritte laufen nicht noch einmal. Im Kopfbereich des Laufs steht dann **Nach einem Neustart fortgesetzt** oder die Zahl der Neustarts, mit dem Zeitpunkt des letzten Wechsels und seinem Grund: Der Server wurde aktualisiert oder neu gestartet, oder er hat nicht mehr geantwortet. Bis ein anderer Server den Lauf übernommen hat, zeigt sein Status **Unterbrochen — wird fortgesetzt**.

Eine Ausnahme ist ein Schritt, der gerade etwas an einen externen Dienst sendete, als sein Server stoppte: Tale kann nicht erkennen, ob der Dienst es erhalten hat, und sendet es deshalb nicht von selbst noch einmal. Stattdessen wartet der Lauf, und seine Seite nennt den Schritt, den Connector, was der Schritt gesendet hat und, wenn der Schritt je Element läuft, das Element. Prüfe den Dienst und wähle dann, wie es weitergeht:

- **Erneut ausführen** sendet es noch einmal. Hatte der Dienst es schon erhalten, passiert es zweimal; Tale fragt deshalb vorher nach.
- **Überspringen** setzt den Lauf fort, als hätte der Schritt nichts zurückgegeben. Wähle das, wenn der Dienst das Gesendete schon erhalten hat.
- **Lauf fehlschlagen lassen** stoppt den Lauf an dieser Stelle und erfasst ihn als fehlgeschlagen mit dem Code `effect_in_doubt`. Was der Lauf schon getan hat, wird nicht rückgängig gemacht; Tale fragt deshalb vorher nach.

Diese Wahl trifft jede Person, die den Lauf stoppen darf. Der Lauf wartet, bis jemand entscheidet; eine Benachrichtigung gibt es nicht, und die Liste der Läufe zeigt den Schritt, auf den er wartet.

Ein geeigneter Agentenfehler erlaubt nach dem ersten Versuch bis zu drei automatische Wiederholungen. Frühere Checkpoints bleiben erhalten; der Kopfbereich zeigt den Wiederholungszähler. Arbeitet ein Versuch mindestens fünfzehn Minuten, wird dieses Wiederholungsbudget erneuert. Abonnement-Pools können für einen neuen Versuch ein anderes Konto wählen. Hat ein Abo-Broker das Konto erneuert, während der Schritt arbeitete, und lehnt der Anbieter deshalb das alte Token ab, läuft die Wiederholung mit einem neuen Token weiter, ohne eine der drei Wiederholungen zu verbrauchen; eine dritte solche Unterbrechung in Folge zählt wie jeder andere Fehler. Konnte der Schritt nicht starten, weil alle Konten des Pools nach Erreichen eines Rate-Limits pausierten, beginnt die Wiederholung, sobald das erste Konto wieder verfügbar ist, spätestens eine Minute später, und setzt die Konversation fort, die der abgelehnte Versuch fortsetzen sollte. Diese Wartezeit verbraucht eine der drei Wiederholungen, außer der abgelehnte Versuch wiederholte selbst einen Fehler durch ein Rate-Limit. Hatte der fehlgeschlagene Versuch seine Konversation bereits angekündigt, setzt die Wiederholung genau diese Konversation über dem erhaltenen Arbeitsbereich fort – der Agent macht dort weiter, wo der Abbruch ihn traf, statt von vorn zu überlegen; ein Versuch, der vorher starb oder dessen Sandbox-Sitzung verschwunden ist, beginnt neu. Ein Schritt mit Gemini CLI beginnt immer neu, weil diese Laufzeit eine Konversation mit einem Werkzeugaufruf nicht wiederaufnehmen kann; [Eine Agent-Laufzeit wählen](/de/platform/agents/harnesses) erklärt die Ausnahme.

Ein Agentenschritt schlägt auch fehl, wenn sein Modell überhaupt nichts liefert: keinen Text, keinen Tool-Aufruf und keine erzeugten Tokens. So kann ein Modellserver antworten, der mitten in der Antwort ausfällt. Der Lauf meldet dann auf Englisch „The model returned an empty answer, so the agent did nothing this turn.“ Auch dieser Fehler erhält diese Wiederholungen. Hat das Modell nur Tools verwendet oder erzeugte Tokens ohne sichtbaren Text gemeldet, etwa für Denkschritte, gilt das als Antwort. Der Schritt scheitert dann nicht aus diesem Grund.

Ein ausgeschöpftes Ausführungszeitfenster, eine abgelaufene Frage oder eine Ablehnung wegen des Budgets erhält diese Wiederholungen nicht. Jeder Versuch verbraucht eigene Ressourcen; frühere Kosten entfallen nicht. Kann ein erneuter Versuch die Ursache nicht beheben, stoppe den Lauf und korrigiere die Abhängigkeit vor dem Neustart.

## Stoppen oder den Workflow korrigieren

Wähle bei einem nicht abgeschlossenen Lauf **Lauf stoppen**, wenn du ihn abbrechen möchtest, und bestätige. Der Abbruch verhindert weitere Arbeit an den Ausführungsgrenzen des Ablaufs. Bereits erfolgte Änderungen werden nicht zurückgesetzt. Endet der Lauf, bevor der Abbruch ihn erreicht, bleibt sein abgeschlossenes Ergebnis erhalten.

Korrigiere einen Dokumentfehler im Editor an der betroffenen Eingabe oder Node und speichere eine Version mit aussagekräftiger Nachricht. Teste mit typischen Eingaben und prüfe Werte und Ausgabe, nicht nur den Erfolgsstatus. Schalte die geprüfte Version live. Zeitpläne und Webhooks verwenden danach diese Version; der ältere fehlgeschlagene Lauf dokumentiert weiterhin die alte.

Ist gar kein Lauf entstanden, prüfe den [Trigger](/de/platform/automations/triggers). Ein deaktivierter Trigger, eine fehlende Live-Version oder abgelehnte Eingaben können den Start verhindert haben.
