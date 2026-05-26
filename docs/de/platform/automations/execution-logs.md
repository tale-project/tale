---
title: Ausführungs-Logs
description: Die Pro-Workflow-Lauf-Historie — jede Ausführung mit Status, Dauer, Trigger-Quelle, Schritt-Ein- und Ausgaben und dem vollen Journal dessen, was jeder Schritt getan hat. Entwickler und Redakteure lesen das, wenn ein Lauf scheiterte oder sich seltsam verhielt.
---

Ausführungs-Logs sind die Lauf-Historie für einen einzelnen Workflow. Jedes Mal, wenn ein Trigger den Workflow feuert, öffnet Tale einen neuen Ausführungs-Datensatz und schreibt darauf, während der Lauf voranschreitet — Startzeit, Status, die Eingabe, die der Trigger trug, die Ausgabe, die jeder Schritt emittierte, die Dauer und den Fehler, falls ein Schritt scheiterte. Die Seite ist die Debugging-Oberfläche, auf die jeder andere Automatisierungs-Tab zeigt, wenn etwas schiefging.

Die Liste lebt auf dem Tab **Ausführungen** einer Automatisierung. Öffne die Automatisierung, klick auf **Ausführungen**, und die Tabelle lädt die jüngsten Läufe. Jede Zeile entfaltet sich zu einer JSON-Ansicht der Ausführung, ihrer Variablen und des Schritt-für-Schritt-Journals.

## Die Listenansicht

Die Liste zeigt eine Zeile pro Lauf, sortiert nach Startzeit. Die Spalten sind die Ausführungs-ID, das Status-Badge, die Startzeit (auf die Millisekunde genau), die Dauer und die Trigger-Quelle. Die Toolbar darüber trägt ein Suchfeld (matcht eine Ausführungs-ID), einen Status-Filter, einen Ausgelöst-von-Filter und einen Datumsbereichs-Picker.

| Spalte         | Typ         | Pflicht | Beschreibung                                                                                                                       |
| -------------- | ----------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Ausführungs-ID | String      | ja      | Stabile Kennung für den Lauf. Klick aufs Kopier-Icon, um sie in die Zwischenablage zu legen.                                       |
| Status         | Badge       | ja      | Einer von `running`, `completed`, `failed`, `pending` oder `waiting_for_input` (wenn ein Genehmigungs-Gate den Lauf pausiert hat). |
| Gestartet um   | Zeitstempel | ja      | Wanduhrzeit, zu der der Lauf startete, in der Zeitzone der Org.                                                                    |
| Dauer          | Zahl        | nein    | Wanduhrzeit von Start bis Abschluss. Leer für eine noch laufende Ausführung.                                                       |
| Ausgelöst von  | Enum        | ja      | Einer von `schedule`, `manual`, `webhook`, `event`, `api` oder `system`.                                                           |

Die Seite lädt schrittweise — scroll nach unten und die nächste Seite holt nach. Die ungefähre Zeilenzahl in der Toolbar ist eine billige Schätzung; die exakte Anzahl wird nicht geführt.

## Die entfaltete Ausführungsansicht

Entfalte eine Zeile und Tale rendert eine JSON-Ansicht des Laufs. Die oberste Ebene trägt fünf Felder: die Ausführungs-Metadaten (ID, Status, Start- und Endzeit, die Trigger-Quelle, den Fehler falls vorhanden), den Lauf-Metadaten-Block aus dem Trigger, die Eingabe-Variablen, die der Lauf erhielt, das Schritt-Journal und einen Journal-Fehler-String, falls das Journal nicht geladen werden konnte.

Das Journal ist die Pro-Schritt-Aufzeichnung: jeder Schritt im Lauf emittiert einen Journal-Eintrag mit seinen Eingaben, seinen Ausgaben und seinem Status. Ein gescheiterter Schritt trägt den Fehler-String und die Schritt-Konfiguration, die ihn produziert hat; ein Genehmigungs-Gate-Schritt trägt den Genehmiger und die Entscheidung. Nutz das Journal, um dem Lauf von vorn bis hinten zu folgen und den Schritt zu finden, der sich falsch verhielt.

## Retry und erneuter Lauf

Schritt-Retries sind eingebaut. Jeder Schritt-Typ akzeptiert eine `retryPolicy` (max Versuche und Backoff in Millisekunden) in der Schritt-Konfiguration; vorübergehende Fehler werden bis zur konfigurierten Decke automatisch wiederholt. Der Workflow-weite Default greift, wenn ein Schritt keine eigene Richtlinie deklariert. Öffne das Schritt-Panel im Editor, um die Richtlinie zu prüfen oder zu ändern.

Ein Lauf, der nach seinem Retry-Budget scheitert, bleibt im Ausführungs-Log als `failed`. Um mit denselben Eingaben erneut zu laufen, öffne das Panel **Automatisierung testen** in der Editor-Toolbar, füge das ursprüngliche Eingabe-JSON ein (kopiere es aus dem Variablen-Block der gescheiterten Ausführung) und klick auf **Ausführen**. Der neue Lauf ist eine frische Ausführung mit eigener ID; der vorherige Fehler bleibt für die Audit-Spur im Log.

## Eine durchgespielte Debugging-Sitzung

Ein Tagesbericht-Lauf scheiterte um 08:01. Öffne den Workflow, wechsle auf **Ausführungen** und filtere nach `Status = failed` und `Datum = heute`. Die gescheiterte Ausführung steht oben. Entfalte sie: das Journal zeigt, dass der zweite Schritt (eine Agent-Zusammenfassung) mit `request timed out` fehlerte. Der Variablen-Block des Schritts trägt das Prompt, das der Agent erhielt; Fehler und Prompt zusammen zeigen meist auf die Wurzelursache — zu viele Tokens, ein fehlendes Wissensdokument, ein übereifriger Tool-Aufruf. Behebe das zugrundeliegende Problem, dann lass den Workflow aus dem Test-Panel mit derselben Eingabe erneut laufen, um den Fix zu bestätigen.

## Wo das hingehört

Ausführungs-Logs sind die Quittung, die jeder Workflow hinterlässt; sie sind, wie du weisst, was lief, was es produzierte und wo es brach. Paar sie mit [Metriken](/de/platform/automations/metrics) für dieselben Informationen, aggregiert über Läufe (Erfolgsrate, p50-/p95-Dauer), mit [Trigger](/de/platform/automations/triggers) für den Startschuss, der jede Ausführung öffnet, und mit [Audit-Logs](/de/platform/admin/governance/audit-logs) für die organisationsweite Spur, wer welchen Lauf startete.
