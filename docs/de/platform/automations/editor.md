---
title: Der Workflow-Editor
description: Prüfe und ändere Knoten, gib Testdaten ein, speichere eine Version und schalte sie live oder kehre zu einer früheren zurück.
---

Im Workflow-Editor änderst du den Ablauf einer Automatisierung und wählst die gespeicherte Version für Live-Läufe. Änderungen brauchen Entwickler-, Admin- oder Inhaberrechte. Speichern, Testen und Bereitstellen sind getrennte Schritte: Die Arbeit an einem Entwurf lässt die bereitgestellte Version bestehen.

Öffne **Automatisierungen** und wähle einen Eintrag. Er öffnet sich im Tab **Editor**. Für einen neuen Ablauf beginne mit [Automatisierungen erstellen oder importieren](/de/platform/automations/catalog).

| Tab | Wofür du ihn nutzt |
| --- | --- |
| **Editor** | Den Workflow ändern, eine gespeicherte Version testen und die Live-Version wählen. |
| **Allgemein** | Festlegen, was die Automatisierung startet und welche Projekte sie nutzen können. |
| **Läufe** | Die letzten Ausführungen prüfen und den vollständigen Datensatz eines Laufs öffnen. |

Die Auswahl **Version** bleibt auf Desktop und Smartphone rechts neben den Tabs Editor, Allgemein und Läufe. Sie zeigt Versionsnachrichten, Datum, Testergebnisse und die Live-Markierung. Wähle eine Zeile, um diese Version zu öffnen. Am Desktop stehen die Laufaktionen neben den Tabs, zusammen mit **Speichern** und **Verwerfen**; unter **Allgemein** stehen dort nur **Speichern** und **Verwerfen**. Ein Punkt an einem Tab kennzeichnet dessen ungespeicherte Änderungen. Beim Verlassen des Tabs oder einem Versionswechsel fragt Tale, wie du damit fortfahren möchtest.

Auf dem Smartphone startet eine geöffnete Automatisierung mit kompakter Navigation. Die Arbeitsfläche des Editors nutzt die verfügbare Höhe. Lauf- und Bereitstellungsaktionen befinden sich innerhalb der Arbeitsfläche neben den Zoom-Steuerelementen. Wenn du einen Knoten auswählst, öffnen sich seine Felder — mit Speichern und Verwerfen — in einem Bereich am unteren Bildschirmrand.

<Frame caption="Wähle auf einem breiten Bildschirm einen Knoten, um seine Felder neben dem Canvas zu prüfen.">

![Der Workflow-Editor zeigt verbundene Knoten und die Felder des ausgewählten Knotens neben dem Canvas.](/images/platform/automation-editor-canvas.webp)

</Frame>

Zum Wechseln musst du nicht zur Liste zurück: Klick im Navigationspfad auf den Namen der aktuellen Automatisierung. Das Menü zeigt alle Automatisierungen der Organisation, auch nach einem Wechsel in ein anderes Projekt. Nur eine Automatisierung, die ausschließlich Projekten zugeordnet ist, die du nicht öffnen kannst, fehlt darin. Oben stehen Automatisierungen ohne Projektzuordnung, darunter die mit Projektzuordnung. Eine waagerechte Linie trennt die beiden Gruppen. Such nach Name oder Slug und wähle einen Eintrag. Der aktuelle Tab bleibt geöffnet. Aus einem Laufdetail gelangst du zur Liste **Läufe** der anderen Automatisierung. Eine ausgewählte Versionsnummer wird nicht übernommen: Im **Editor** erscheint deren neueste gespeicherte Version.

## Den Canvas lesen

Jeder Kasten ist ein Knoten. Seine Beschriftung nennt Schritt und Typ; **Liest** zeigt verwendete Ausgaben anderer Knoten. Pfeile entstehen aus Referenzen wie `{{ nodes.draft.output.text }}`. Ändere die Referenz, um eine Abhängigkeit zu ändern. Das Zeichnen eines Pfeils erstellt keine Abhängigkeit.

Kennzeichnungen zeigen Bedingungen und Schleifen wie `when`, `else of`, `for each`, `repeat until` und `continue on error`. Eine Zykluswarnung bedeutet, dass mehrere Knoten voneinander abhängen. Entferne die kreisförmige Referenz, bevor du eine ausführbare Version speicherst.

## Einen Knoten bearbeiten

Wähle einen Kasten, um seine Felder zu öffnen. Auf einem breiten Bildschirm erscheint der Bereich neben dem Canvas; ohne ausgewählten Knoten nutzt der Canvas die ganze Breite. Auf schmaleren Bildschirmen öffnen sich die Felder in einem Dialog über dem Canvas. Ein `transform` hat **Code**, ein `llm` Felder für Prompt, Modell und Ausgabeschema. Ein `agent` ergänzt Agent-Laufzeit und Ausstattung. Die **Modell**-Auswahl einer `llm`- oder `agent`-Node listet die Modelle, die die verbundenen Anbieter deiner Organisation bedienen; ein nicht aufgeführtes Modell lässt sich eingeben, doch **Probleme** warnt dann, dass ein Live-Lauf an dieser Node fehlschlägt, bis sein Anbieter verbunden ist. **Eingabe** enthält JSON-Werte und Referenzen für diesen Knoten. Unvollständiges JSON wird gemeldet und ändert den Knoten nicht.

Öffne **Ablaufsteuerung** für Bedingungen und Wiederholungen. Hat der Knoten welche, ist der Abschnitt schon offen. Mit **Schließen** kehrst du zum Canvas zurück. Auf einem breiten Bildschirm schließt sich der Bereich auch, wenn du auf den leeren Canvas klickst oder Escape außerhalb eines Textfelds drückst. Trigger und Projekteinstellungen der Automatisierung findest du im Tab **Allgemein**. [Automatisierungsgrundlagen](/de/platform/automations/concepts) erklärt Knotentypen und Ausdrücke.

## Probleme finden und beheben

Während du bearbeitest, prüft Tale den Entwurf so, wie es auch jedes Speichern prüft. Kurz nachdem du aufhörst zu tippen, zeigt die Schaltfläche **Probleme** neben **Speichern**, was die Prüfung gefunden hat: ein rotes Fehlersymbol und ein gelbes Warnsymbol, jeweils mit ihrer Anzahl, oder **Keine Probleme**. Auf dem Smartphone sitzt die Schaltfläche in der Leiste über dem Canvas. Ein Fehler ist etwas, woran ein Lauf scheitern würde, etwa eine Referenz auf einen Knoten, den es nicht gibt. Eine Warnung ist etwas, das schiefgehen kann, etwa das Lesen der Ausgabe eines Knotens, der manchmal übersprungen wird. Ein Knoten mit Problemen zeigt dieselben Zahlen auf seinem Kasten, und ein Feld mit einem Problem erklärt es direkt darunter.

Klicke auf **Probleme**, um sie aufzulisten. Auf einem breiten Bildschirm öffnet sich die Liste unter dem Canvas, auf schmaleren Bildschirmen in einem eigenen Bereich. Jeder Eintrag sagt, was falsch ist, wo, warum und wie du es behebst. **Technische Details** zeigt die Meldung der Engine selbst, und der Code neben dem Titel hilft dir bei der Suche oder im Support. **Alle**, **Fehler** und **Warnungen** filtern die Liste, Escape schließt sie.

Wähle einen Eintrag oder drücke darauf die Eingabetaste, um dorthin zu gelangen: Der Knoten öffnet sich, sein Feld erhält den Fokus, und wo das Feld den Text so zeigt, wie er gespeichert ist, ist die Stelle markiert, die das Problem verursacht. Ein Problem ohne eigenes Feld, etwa ein Modell, das deine Organisation nicht bereitstellt, steht unter **Probleme in dieser Node** oben in den Feldern des Knotens. Ein Problem in einem Teil der Automatisierung, den der Editor nicht zeigt, etwa in ihrer Ausgabe oder ihren Tests, sagt, dass es sich hier nicht bearbeiten lässt; ändere diesen Teil über MCP, die API oder ein hochgeladenes Paket.

Solange Fehler bestehen, ist **Speichern** deaktiviert und nennt den Grund, zum Beispiel „Behebe 1 Fehler, um zu speichern“. Auf dem Smartphone steht **Speichern** unter den Feldern eines Knotens; dort öffnet **Probleme anzeigen** neben diesem Grund die Liste. Warnungen verhindern weder das Speichern noch das Bereitstellen. Kann Tale den Entwurf nicht prüfen, etwa weil die Verbindung abgebrochen ist, zeigt die Schaltfläche **Prüfung fehlgeschlagen**, und du kannst trotzdem speichern: Jedes Speichern wird auf dem Server erneut geprüft. Wird ein Speichern oder Bereitstellen wegen Fehlern abgelehnt, öffnet sich die Liste mit den Problemen des Servers und beginnt beim ersten Fehler.

Die Prüfung läuft nur für Entwickler, Admins und Inhaber, also die Rollen, die speichern dürfen. [Was Tale vor einem Lauf prüft](/de/platform/automations/concepts#checks) erklärt jede Art von Problem.

## Eine Version speichern und testen

1. Ändere die nötigen Felder und klicke auf **Speichern**.
2. Erkläre die Änderung in der **Notiz zur Version** und wähle **Version speichern**. Eine neue Version entsteht; frühere Fassungen bleiben erhalten. Hat jemand während deiner Bearbeitung eine andere Version gespeichert, lehnt Tale das Speichern ab und fragt nach: **Meine Änderungen verwerfen und neu laden** zeigt die neuere Version, **Trotzdem speichern** legt deine Version darüber an — die neuere bleibt im Versionsverlauf, die aktuelle Version ist dann aber deine.
3. Klicke auf **Testlauf**. Hat der Workflow ein Eingabeschema, fülle im Dialog **Eingabe für den Lauf (JSON)** aus. Öffne **Eingabeschema**, um Pflichtfelder und Typen zu prüfen. Ungültiges JSON oder unpassende Werte verhindern den Start.
4. Starte den Test, wechsle zum Tab **Läufe** und öffne seinen Eintrag. Vergleiche aufgelöste Eingabe, Ausgabe und geplante Aktionen mit dem erwarteten Ergebnis.

Braucht ein Workflow `owner` und `repo`, könnte seine Eingabe so aussehen:

```json
{
  "owner": "your-organization",
  "repo": "your-repository"
}
```

Maßgeblich ist das tatsächliche Schema des Workflows. Ein Zahlenfeld braucht eine JSON-Zahl, keinen Text in Anführungszeichen. Prüfe auch den Projektumfang, wenn ein Projektwähler angeboten wird.

**Testlauf** führt die gewählte gespeicherte Version mit deterministischen Mocks aus. Er sendet keine E-Mails und ändert keine externen Datensätze. Ein Entwurf lässt sich vor der Bereitstellung testen. Ein erfolgreicher Mock prüft keine echten Zugangsdaten oder externen Dienste.

<Frame caption="Hat der Workflow Eingaben, gib JSON an und prüfe sein Schema vor dem Teststart.">

![Der Testlauf-Dialog zeigt JSON-Werte für owner und repo und das aufgeklappte Eingabeschema.](/images/platform/automation-run-input.webp)

</Frame>

## Bereitstellen und live ausführen

Wähle die getestete Fassung unter **Version** und klicke auf die Schaltfläche daneben, die diese Version nennt, etwa **v3 live schalten**. Die Kennzeichnung **Live** markiert die bereitgestellte Version. Sind die gespeicherten Tests einer Version fehlgeschlagen, lässt sie sich nicht bereitstellen. Behebe die Ursache und speichere eine neue Version.

**Live ausführen** startet die bereitgestellte Version, auch wenn du eine andere ansiehst. Die Bestätigung zeigt den Umfang und bei Bedarf **Eingabe für den Lauf (JSON)** für genau diese Version. Prüfe beides vor dem Bestätigen. Live-Läufe können verbundene Systeme verändern und auf eine [Freigabe](/de/platform/approvals/concepts) warten.

Ein Trigger nutzt ebenfalls die bereitgestellte Version. Richte ihn ein, wenn wiederholte oder extern ausgelöste Läufe gewünscht sind; siehe [Automatisierungstrigger](/de/platform/automations/triggers).

## Ein Ergebnis untersuchen

**Letzten Lauf einblenden** legt Laufzustände über den Canvas. Wähle einen Knoten für die Angaben zu diesem Lauf: aufgelöste Eingabe, Ausgabe und Effekte. Häufig findest du so eine falsche Referenz. Vergleiche die Eingabe des fehlgeschlagenen Knotens mit der Ausgabe seiner Quelle.

Wechsle zu **Läufe** und öffne den vollständigen Datensatz. Die Tabs bleiben sichtbar; **Läufe** ist aktiv. Mit **Editor** kehrst du zum Workflow zurück. Prüfe Test- oder Live-Modus und bereits ausgeführte Aktionen, bevor du erneut startest. [Ausführungsprotokolle](/de/platform/automations/execution-logs) erklärt Wartezustände, Fehler, automatische Wiederholungen und Abbruch.

## Zu einer früheren Version zurückkehren oder löschen

Öffne für eine Rückkehr **Version** rechts neben den Tabs, lies die Versionsnachrichten und wähle eine frühere Fassung. Die Zeile öffnet den **Editor** mit dieser Version. Klicke dort auf die Schaltfläche, die sie live schaltet, etwa **v2 live schalten**. Künftige Starts verwenden sie; der Versionsverlauf bleibt erhalten. Eine Nachricht wie „Vorherige Empfängerzuordnung wiederherstellen“ macht die Entscheidung nachvollziehbar.

Zum Löschen gehe zur Liste zurück, öffne das Zeilenmenü und wähle **Löschen**. Lies die Bestätigung mit dem Namen der Automatisierung. Versionen, Bereitstellung, Trigger und Projektzuordnungen werden entfernt. Ein offener Lauf blockiert das Löschen; beende ihn oder warte seinen Abschluss ab. Frühere Läufe unterliegen weiter der Aufbewahrung. Bereits ausgeführte Aktionen werden durch das Löschen nicht rückgängig gemacht.
