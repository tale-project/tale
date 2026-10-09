---
title: Automatisierungsläufe prüfen und Fehler beheben
description: Erfahre, warum ein Lauf fehlschlug oder ein Schritt übersprungen wurde, was jeder Schritt gelesen und zurückgegeben hat, spiel den Lauf ab und führe ihn erneut, ab einem Schritt oder im Vergleich mit einem anderen Lauf aus.
---

Öffne eine Automatisierung, wechsle zum Tab **Läufe** und wähle einen Eintrag. Prüfe zuerst Status, Version und Modus, dann die betroffene Node. Ein erfolgreicher Testlauf belegt den simulierten Ablauf. Er beweist nicht, dass ein echtes externes Konto dieselbe Aktion akzeptiert.

<Frame caption="Ein abgeschlossener Testlauf: Status, Modus, Version, Starter und Zeiten über dem Workflow, mit dem Ergebnis jeder Node.">

![Die Seite eines Testlaufs von Triage GitHub issues, markiert mit Succeeded, Test und v1 und von dir gestartet, mit Start- und Endzeit über dem Workflow-Graphen, in dem die Nodes issues, open issues, score und report jeweils Succeeded zeigen; unter dem Graphen beginnt die Liste der Auswirkungen des Laufs.](/images/platform/automation-run-detail.webp)

</Frame>

## Den Laufstatus lesen

Der Tab **Läufe** zeigt die Läufe, die du sehen kannst, neueste zuerst, und lädt ältere beim Scrollen nach; **Filter** grenzt sie nach Status und Modus ein. Läufe der Organisation selbst sehen Inhaber, Admins und Entwickler. Einen Lauf in einem Projekt und die Frage, auf die er wartet, sehen nur diejenigen von ihnen, die dieses Projekt öffnen können. Jede Zeile nennt Version, Zeitpunkt, Modus und Auslöser oder sagt, warum der Lauf fehlschlug oder worauf er wartet. Im Detail siehst du Workflow, Node-Ergebnisse und Laufzeiten. Ein nicht abgeschlossener Lauf hat keinen Endzeitpunkt. Die Tabs bleiben beim Prüfen eines Laufs sichtbar. Mit **Läufe** kehrst du zur Liste zurück, mit **Editor** zum Bearbeiten des Workflows.

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

## Verstehen, warum ein Lauf fehlschlug {#failures}

Ein fehlgeschlagener Lauf öffnet sich mit einer Karte, die sagt, wo und warum er fehlschlug: **Der Lauf ist bei Greet fehlgeschlagen**, ein kurzer Titel für das Problem, etwa **Ein gelesener Wert fehlt**, was das bedeutet, die konkrete Ursache und **So behebst du es**. Bei einem fehlenden Wert nennt die Ursache den Ausdruck, das gelesene Feld und den Schritt, dessen Ausgabe nichts enthielt; die Behebung schlägt einen Zugriff vor, der nicht fehlschlagen kann, etwa `nodes.fetch_customer.output.customer?.email`. Die eigene Meldung der Engine steht unter **Technische Details**.

Unter der Karte stehen der Schritt und sein Feld, etwa **Greet › input.email**, neben **Im Editor zeigen**: Das öffnet den Editor mit der Version, die der Lauf ausführte, und wählt den Schritt aus. **Schritt zeigen** wählt ihn im Canvas des Laufs aus, und **Ab diesem Schritt wiederholen** bereitet die Wiederholung vor, die [Ab einem Schritt wiederholen](#retry-from-step) beschreibt.

Im Canvas ist die fehlgeschlagene Node rot umrahmt, und ihre unterste Zeile wiederholt den Titel des Fehlers; die Nodes, über die der Lauf zu ihr kam, treten hervor, während die übrigen zurücktreten; und Ende sagt, wo der Lauf fehlschlug, etwa **Fehlgeschlagen bei Propose**. Die Liste **Läufe** nennt die Ursache eines fehlgeschlagenen Laufs mit demselben Titel.

Anwendungen erhalten über die [Lauf-API](/de/develop/api-reference) zusätzlich `failureCode`, wenn die Ursache eines fehlgeschlagenen Laufs klassifiziert wurde. `approval_rejected` bedeutet etwa, dass eine Person die Aktion abgelehnt hat; bei `llm_output_invalid` entsprach die Modellantwort nicht der geforderten Struktur. Ältere Fehler können ohne Code vorliegen. Der Code hilft bei der Untersuchung, belegt aber weder die Unbedenklichkeit noch den Erfolg eines neuen Versuchs.

## Herausfinden, warum ein Schritt lief oder übersprungen wurde {#conditions}

Wähle eine Node im Canvas des Laufs, um ihren Tab **Letzter Lauf** zu öffnen. Ein Schritt, der wegen einer Bedingung lief oder übersprungen wurde, sagt das in einem Satz, etwa **Big order wurde übersprungen, weil seine Bedingung nicht zutraf**. Darunter zeigt **Nur wenn** die Bedingung in Worten, mit dem Wert, den jeder Verweis las, und wie sie ausging, etwa „amount der Laufeingabe (250) nicht größer als 1.000 ist“ und **Nein**. Eine mit `&&` oder `||` verknüpfte Bedingung zeigt jeden Teil mit **Ja** oder **Nein**; ein Teil, den der Lauf nicht prüfen musste, heißt **Nicht geprüft**. Eine als Code geschriebene Bedingung zeigt ihren Code.

Eine Node kann wegen einer nicht erfüllten Bedingung, einer gelaufenen Alternative, eines übersprungenen Schritts, den sie liest, oder einer Weiterlaufregel übersprungen werden; der Satz nennt den Grund und den beteiligten Schritt. Das ist nicht immer ein Fehler.

Im Canvas sagt die unterste Zeile jeder Node, wie sie endete: **Erfolgreich**, **Fehlgeschlagen**, **Übersprungen**, **Nicht ausgeführt**, **Noch nicht erreicht**, **Wiederverwendet** für einen Schritt, den eine Wiederholung aus einem früheren Lauf übernahm, oder bei einem gestoppten Lauf **Hier gestoppt** für die Node, an der der Lauf beim Stoppen stand. Jede Bedingung zeigt, wie sie entschieden hat, **Ja** oder **Nein**.

## Sehen, was ein Schritt gelesen, erhalten und zurückgegeben hat {#step-data}

**Was gelesen wurde** listet jeden Wert, den der Schritt aus der Laufeingabe oder aus anderen Schritten las, in Worten und mit dem gelesenen Wert, etwa „items von Inbox: 3 Elemente“. **Erhalten** zeigt die Eingabe des Schritts nach dem Auswerten seiner Vorlagen, **Zurückgegeben** sein Ergebnis. Zusammen unterscheiden sie einen falschen Verweis von einem Dienstausfall. Ein Wert mit einem Geheimnis ist ausgeblendet und sagt das, und ein zu umfangreicher Wert sagt, dass nur ein Teil davon gespeichert wurde.

Ein Wert erscheint als Baum, den du mit den Pfeiltasten aufklappst. **Werte** und **Struktur** wechseln zwischen den Werten und den Feldern mit ihren Arten, und die Schaltflächen kopieren einen Wert, laden einen grossen herunter oder öffnen ihn im Vollbild. Sind Eingabe und Ausgabe eines Schritts beide Objekte oder beide Listen, listet **Was er geändert hat** die Felder, die der Schritt hinzugefügt, entfernt und geändert hat.

Ein Schritt, der einmal pro Element läuft, listet seine Elemente, jedes mit seinem Ergebnis und bei einem fehlgeschlagenen mit dem Grund. **Nur fehlgeschlagene** grenzt die Liste ein, und ein gewähltes Element zeigt, was es gelesen, erhalten und zurückgegeben hat. Tale speichert die ersten 200 Elemente und jedes fehlgeschlagene. Ein Schritt, der mehr als einen Versuch brauchte oder dessen Versuch ein Neustart unterbrach, listet seine **Versuche**. Ein Schritt, der einen Dienst aufrief, sagt, ob der Aufruf erledigt, fehlgeschlagen oder vielleicht schon gelaufen ist, und was eine Person dazu entschieden hat.

Beispielsweise kann eine Erinnerungs-Node den Kundennamen, aber eine leere Rechnungs-ID erhalten. Prüfe, was sie aus dem Schritt davor gelesen hat. Verwendet der Datensatz inzwischen ein anderes Feld, korrigiere den Verweis statt der Mail-Zugangsdaten. Prüfe die korrigierte Eingabe danach in einem neuen Testlauf.

## Den Lauf abspielen {#play}

Die Leiste unter dem Canvas des Laufs spielt den Lauf ab: Jeder Schritt leuchtet, während er arbeitet, Werte wandern entlang der Linien zu den Schritten, die sie lesen, und jede Bedingung zeigt ihre Entscheidung. Sie öffnet sich am Ende des Laufs, damit du zuerst den ganzen Ablauf siehst. **Abspielen** startet von vorn, **Vorheriges Ereignis** und **Nächstes Ereignis** springen schrittweise, und der Regler geht zu jedem Zeitpunkt; die Uhr zeigt, wie lange der Lauf tatsächlich schon lief, und die Geschwindigkeit ändert das Abspieltempo. Lange Wartezeiten werden verkürzt, damit sie die Wiedergabe nicht aufhalten. Solange ein Lauf noch läuft, folgt ihm die Leiste; springst du zurück, bringt dich **Live folgen** an sein Ende.

**Schritte** neben **Diagramm** zeigt denselben Lauf als seine Schritte in zeitlicher Reihenfolge: wie lange jeder arbeitete, einen Balken dafür, wann er arbeitete, jede Bedingung mit ihrer Entscheidung sowie Wartezeiten und Neustarts. Die Ansicht läuft mit derselben Uhr. Wählst du einen Schritt, öffnet er sich und die Uhr springt an seinen Beginn, und **Diagramm** zeigt den Canvas zu diesem Zeitpunkt.

## Erneut ausführen {#run-again}

**Erneut ausführen** startet einen neuen Lauf derselben Version mit derselben Eingabe und demselben Modus. Ein Testlauf startet sofort; ein Live-Lauf mit Schreibvorgängen fragt zuerst und nennt die Dienste, an die er erneut senden würde. Das Menü daneben bietet:

- **Eingabe bearbeiten und ausführen…** öffnet den Ausführen-Dialog mit der Eingabe dieses Laufs zum Ändern; bestätigst du sie unverändert, wird der Lauf erneut ausgeführt.
- **Erneut mit v6 als Test ausführen**, wenn es eine neuere Version gibt, und **Erneut als Test ausführen** bei einem Live-Lauf.
- **Live mit v5 ausführen**, wenn eine andere Version live ist und deine Rolle Live-Läufe starten darf.
- **Mit dem vorherigen Lauf vergleichen**, **Lauf-ID kopieren** und **Link kopieren**.

Kann ein Live-Lauf nicht erneut live laufen, weil seine Version nicht mehr live ist oder deine Rolle keine Live-Läufe starten darf, sagt **Erneut ausführen** den Grund.

Die Kopfzeile des neuen Laufs nennt seine Herkunft, etwa **Wiederholung von Lauf 1db433 · geänderte Eingabe**, mit **Lauf 1db433 öffnen** und **Damit vergleichen**. Eine Wiederholung ist ein neuer Lauf: Sie sendet ihre Schreibvorgänge erneut und verbraucht, was ein Lauf verbraucht.

## Ab einem Schritt wiederholen {#retry-from-step}

**Ab diesem Schritt wiederholen** zeigt vor dem Start, was die Wiederholung tun wird. **Wiederverwendet** listet die Schritte, deren Ergebnisse der neue Lauf aus diesem übernimmt, und **Läuft erneut** den gewählten Schritt und jeden folgenden Schritt, der von ihm abhängt. Schreiben diese Schritte an einen Dienst und läuft die Wiederholung live, warnt der Dialog, dass die Schreibvorgänge erneut gesendet werden. Die Wiederholung eines Testlaufs bleibt ein Test, weil die Ergebnisse, die sie wiederverwenden würde, erfunden waren.

Tale lehnt eine Wiederholung ab, die es nicht getreu ausführen kann, und sagt warum: Die auszuführende Version hat einen wiederverwendeten Schritt geändert, der Lauf ist noch nicht beendet, oder der Lauf hat keine Eingabe gespeichert. Im Canvas des neuen Laufs sind die übernommenen Schritte als **Wiederverwendet** markiert.

## Zwei Läufe vergleichen {#compare}

**Damit vergleichen** bei einer Wiederholung, **Mit dem vorherigen Lauf vergleichen** im Menü von **Erneut ausführen** oder zwei im Tab **Läufe** ausgewählte Läufe und **Vergleichen** zeigen zwei Läufe nebeneinander. **Was sich unterscheidet** nennt, das Aufschlussreichste zuerst, die ausgeführten Versionen, wie viele Felder ihrer Eingabe sich unterscheiden, den Schritt, an dem sie sich trennten, und warum, etwa eine Bedingung, die anders ausging, wie jeder endete sowie Ausgabe und Schreibvorgänge. Die Tabelle darunter zeigt jeden Schritt, wie jeder Lauf ihn hinterließ und ob seine Daten gleich sind. **A und B tauschen** vertauscht die beiden Läufe. Unterscheiden sich ihre Eingabe oder Ausgabe, zeigen **Eingabe: A → B** und **Ausgabe: A → B** beide nebeneinander, jedes geänderte Feld markiert.

## Bereits erfolgte Änderungen prüfen

Die Auswirkungen protokollieren Connector-Schreibvorgänge mit Node, Connector und Eingabe. Tests verwenden festgelegte Ersatzantworten; Live-Aktionen können externe Systeme ändern. Fehlen protokollierte Auswirkungen, zeigt der Lauf das ausdrücklich an.

Lies diese Liste vor einer Wiederholung. Ein späterer Fehler macht eine frühere Nachricht oder Änderung nicht rückgängig. Ist die Zustellung entscheidend, prüfe auch den empfangenden Dienst. Die Auswirkungen bleiben beim Lauf, bis Löschung oder Aufbewahrungsregeln den Datensatz entfernen. Sie sind kein eigenständiges dauerhaftes Archiv. Wird die Automatisierung gelöscht, bleiben ihre Läufe: Die Laufseite öffnet weiterhin, mit dem Löschdatum markiert und aus der Aufzeichnung des Laufs gezeichnet, bis die Aufbewahrung sie entfernt.

## Fortsetzung und automatische Wiederholungen verstehen

Der Ablauf speichert abgeschlossene Nodes als Checkpoints und setzt danach fort. Ein separater neuer Lauf, etwa einer, den **Erneut ausführen** startet, besitzt eigene Checkpoints und kann Schreibvorgänge wiederholen. Neu starten ist deshalb etwas anderes als den bestehenden Lauf fortzusetzen; eine [Wiederholung ab einem Schritt](#retry-from-step) übernimmt nur die Ergebnisse der Schritte vor diesem Schritt.

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

Korrigiere einen Dokumentfehler im Editor, den du über **Im Editor zeigen** auf der Fehlerkarte oder direkt öffnest, an der betroffenen Eingabe oder Node und speichere eine Version mit aussagekräftiger Nachricht. Teste mit typischen Eingaben und prüfe Werte und Ausgabe, nicht nur den Erfolgsstatus. Schalte die geprüfte Version live. Zeitpläne und Webhooks verwenden danach diese Version; der ältere fehlgeschlagene Lauf dokumentiert weiterhin die alte.

Ist gar kein Lauf entstanden, prüfe den [Trigger](/de/platform/automations/triggers). Ein deaktivierter Trigger, eine fehlende Live-Version oder abgelehnte Eingaben können den Start verhindert haben.
