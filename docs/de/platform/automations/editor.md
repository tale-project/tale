---
title: Der Workflow-Editor
description: Lies eine Automatisierung im Canvas, folge ihren möglichen Pfaden, ändere Felder einer Node, speichere eine Version und schalte sie live oder kehre zu einer früheren zurück.
---

Im Workflow-Editor liest du, was eine Automatisierung tut, änderst ihre Felder und wählst die gespeicherte Version für Live-Läufe. Größere Änderungen, etwa neue Nodes, kommen von einem Coding-Agent über MCP. Änderungen brauchen Entwickler-, Admin- oder Inhaberrechte. Speichern, Testen und Bereitstellen sind getrennte Schritte: Die Arbeit an einem Entwurf lässt die bereitgestellte Version bestehen.

Öffne **Automatisierungen** und wähle einen Eintrag. Er öffnet sich im Tab **Editor**. Öffnest du eine Automatisierung im Tab **Automatisierungen** eines Projekts, beginnt der Navigationspfad mit diesem Projekt: Wähle den Projektnamen, um zum Projekt zurückzukehren, oder **Automatisierungen**, um zu seinen Automatisierungen zurückzukehren. Ob du eine Automatisierung in einem Projekt oder in der Liste öffnest, die Navigationsleiste markiert **Automatisierungen**. Für einen neuen Ablauf beginne mit [Automatisierungen erstellen oder importieren](/de/platform/automations/catalog).

| Tab | Wofür du ihn nutzt |
| --- | --- |
| **Editor** | Den Workflow lesen und ändern, eine gespeicherte Version testen und die Live-Version wählen. |
| **Allgemein** | Festlegen, was die Automatisierung startet und welche Projekte sie nutzen können. |
| **Läufe** | Die letzten Ausführungen prüfen und den vollständigen Datensatz eines Laufs öffnen. |

Die Auswahl **Version** bleibt auf Desktop und Smartphone rechts neben den Tabs Editor, Allgemein und Läufe. Sie zeigt Versionsnachrichten, Datum, Testergebnisse und die Live-Markierung. Wähle eine Zeile, um diese Version zu öffnen. Am Desktop stehen die Laufaktionen neben den Tabs, zusammen mit **Speichern** und **Verwerfen**; unter **Allgemein** stehen dort nur **Speichern** und **Verwerfen**. Ein Punkt an einem Tab kennzeichnet dessen ungespeicherte Änderungen. Beim Verlassen des Tabs oder einem Versionswechsel fragt Tale, wie du damit fortfahren möchtest.

Auf dem Smartphone startet eine geöffnete Automatisierung mit kompakter Navigation. Der Canvas des Editors nutzt die verfügbare Höhe, und Lauf- und Bereitstellungsaktionen stehen in einer Leiste am unteren Rand des Canvas. Wenn du eine Node auswählst, öffnen sich ihre Felder — mit Speichern und Verwerfen — in einem Bereich am unteren Bildschirmrand.

<Frame caption="Auf dem Smartphone nimmt der Canvas die Höhe des Bildschirms ein, und seine Laufaktionen stehen in einer Leiste am unteren Rand.">

![Der Editor von Triage the Gmail inbox auf dem Smartphone: kompakte Navigation mit Editor, General und Runs, der Canvas mit Start, Inbox und Due und eine Leiste am unteren Rand des Canvas mit Deploy v1, Test run und No problems.](/images/platform/automation-editor-canvas-mobile.webp)

</Frame>

<Frame caption="Wähle auf einem breiten Bildschirm eine Node, um ihre Felder neben dem Canvas zu prüfen.">

![Der Workflow-Editor zeigt die Nodes von Gmail triage inbox zwischen Start und Ende, eine in Worten formulierte Bedingung über einer Node und die Felder der ausgewählten Node neben dem Canvas.](/images/platform/automation-editor-canvas.webp)

</Frame>

Zum Wechseln musst du nicht zur Liste zurück: Klick im Navigationspfad auf den Namen der aktuellen Automatisierung. Das Menü zeigt alle Automatisierungen der Organisation, auch nach einem Wechsel in ein anderes Projekt. Nur eine Automatisierung, die ausschließlich Projekten zugeordnet ist, die du nicht öffnen kannst, fehlt darin. Oben stehen Automatisierungen ohne Projektzuordnung, darunter die mit Projektzuordnung. Eine waagerechte Linie trennt die beiden Gruppen. Such nach Name oder Slug und wähle einen Eintrag. Der aktuelle Tab bleibt geöffnet. Aus einem Laufdetail gelangst du zur Liste **Läufe** der anderen Automatisierung. Eine ausgewählte Versionsnummer wird nicht übernommen: Im **Editor** erscheint deren neueste gespeicherte Version.

## Den Canvas lesen

Tale zeichnet den Canvas aus dem Dokument der Automatisierung und ordnet ihn selbst an: **Start** steht oben, **Ende** unten, und jede Node steht unter den Nodes, die sie liest. So liest sich der Canvas von oben nach unten in der Reihenfolge, in der ein Lauf vorgeht. Niemand platziert einen Kasten, und Zeichnen verbindet nichts. Eine Linie entsteht aus einer Referenz wie `{{ nodes.draft.output.text }}`; um zu ändern, was eine Node liest, änderst du die Referenz.

### Start und Ende

**Start** zeigt, was einen Lauf startet und was er erhält. Unter **Startet** steht der Trigger in Worten, etwa ein Zeitplan mit Zeitzone und nächstem Lauf, und ob der Trigger aus ist oder auf eine Live-Version wartet. Danach folgt **Von Hand, über die API oder MCP**, denn diese Starts sind immer möglich. Unter **Eingabe** stehen die Felder der Laufeingabe mit ihrem Typ und der Angabe, ob sie Pflicht sind. Würde der Trigger Läufe mit einer Eingabe starten, die die Automatisierung ablehnt, sagt Start das.

**Ende** zeigt, was ein erfolgreicher Lauf zurückgibt und wie ein Lauf enden kann. Unter **Gibt zurück** steht die Ausgabe, etwa **Die Ausgabe von Report**, oder ihre Felder mit den Nodes, aus denen sie stammen; ein Feld, das bei manchen Läufen leer bleibt, trägt **kann leer sein**. Unter **Endet** stehen die drei Ausgänge: **Erfolgreich** gibt die Ausgabe zurück, **Fehlgeschlagen** tritt ein, wenn eine der Nodes fehlschlägt, die den Lauf stoppen, und **Gestoppt**, wenn jemand den Lauf stoppt.

### Nodes

Jede Node ist ein Kasten. Die erste Zeile zeigt ihr Symbol und ihren Titel, der aus ihrer ID entsteht: Aus `open_issues` wird **Open issues**. Die nächste Zeile nennt die Art der Node: Connector und Aktion, etwa **GitHub · Issues auflisten**, **Transformation**, **Sprachmodell** oder **Agent** mit ihrem Modell oder die Automatisierung, die sie aufruft. Weiß Tale, was die Node zurückgibt, zeigt eine Zeile die Struktur, etwa `{ issues: object[] }`. Die unterste Zeile sagt, was die Node liest, etwa **Liest Issues und die Laufeingabe (owner, repo)**, oder **Liest keine andere Node**.

Chips und kleine Symbole ergänzen, was die Anordnung nicht zeigen kann. **Läuft bei Fehler weiter** markiert eine Node, deren Fehler der Lauf hinnimmt, und **Läuft nie** eine Node, die keine Kombination von Bedingungen erreicht. Ein Schild markiert eine Node, die Daten in einem verbundenen Dienst ändert; dort kann ein Live-Lauf auf eine Freigabe warten. Eine Sprechblase markiert einen Agent, der eine Frage stellen kann, und eine durchgestrichene Nadel ein Modell ohne festen Anbieter. Zeig auf ein Symbol, um seinen Satz zu lesen; ein Screenreader hört ihn mit dem Kasten. Ein Kasten mit Problemen zeigt ihre Anzahl in seiner ersten Zeile.

### Bedingungen und Zweige

Die Bedingung einer Node (`when`) steht als Pille über ihr und sagt die Bedingung in Worten, etwa „total von Score größer als 1.000 ist“. Die Node darunter läuft nur, wenn die Bedingung zutrifft. Ist eine andere Node ihre Alternative (`elseOf`), teilt sich die Bedingung in zwei Linien: **Ja** führt zur Node links, die läuft, wenn die Bedingung zutrifft, und **Nein** zu ihrer Alternative rechts. Eine Bedingung, die Tale nicht in Worte fassen kann, zeigt den Ausdruck selbst in Codeschrift.

```yaml
nodes:
  - id: escalate
    type: transform
    when: '{{ nodes.score.output.total > 1000 }}'
    input: { total: '{{ nodes.score.output.total }}' }
    code: 'return { text: "Escalate " + input.total };'
  - id: file
    type: transform
    elseOf: escalate
    input: { total: '{{ nodes.score.output.total }}' }
    code: 'return { text: "File " + input.total };'
```

In diesem Ausschnitt lautet die Bedingung über Escalate „total von Score größer als 1.000 ist“, **Ja** führt zu Escalate und **Nein** zu File. Zeig auf eine Bedingung oder auf ihr **Ja** oder **Nein**, um die Pfade hervorzuheben, die durch sie führen.

### Linien, Rahmen und gestrichelte Kästen

Eine durchgezogene Linie bedeutet, dass die untere Node die Ausgabe der oberen liest. Eine gestrichelte Linie bedeutet, dass die untere Node nach der oberen läuft, ohne ihre Ausgabe zu lesen, etwa weil ihre Bedingung sie liest. Eine gepunktete Linie zu Ende verlässt die letzte Node eines Laufs, deren Ausgabe Ende nicht zurückgibt. Die Linien **Ja** und **Nein** haben eigene Farben.

Ein Rahmen um eine Node zeigt, dass sie mehrmals läuft: einmal für jedes Element einer Liste (**Für jedes Element von …**) oder erneut, bis eine Bedingung zutrifft (**Wiederholt sich, bis …, höchstens 5×**). Ein gestrichelter Kasten ist eine Node, die vielleicht nicht läuft; nach einem Lauf ist es eine Node, die nicht gelaufen ist. **Legende** neben den Zoom-Steuerelementen erklärt jede Art von Linie und Kasten.

### Tastatur und Listenansicht

Das Diagramm ist ein einziger Halt in der Tab-Reihenfolge. Springst du mit Tab hinein, landet der Fokus auf Start; die Pfeiltasten folgen den Linien von Kasten zu Kasten und entlang einer Reihe, Pos1 und Ende springen zu Start und Ende, und die Eingabetaste öffnet den Kasten im Fokus. Ein Screenreader liest zu jedem Kasten Titel, Art und was er liest; bei einer Bedingung hört er, über welche Node sie entscheidet.

Mit dem Ansichtsschalter oben links im Canvas wechselst du zwischen **Canvas**, **Liste** und **Quelltext**. **Liste** zeigt dieselben Nodes in der Reihenfolge des Laufs, jede mit dem, was sie liest, und mit ihrer Bedingung in Worten; auch dort öffnet die Eingabetaste eine Node. Ist der Canvas sehr schmal, beginnt er mit **Liste**. Die Adresse behält die Ansicht und die geöffnete Node, sodass ein geteilter Link beides wieder öffnet.

### Wenn eine neue Version eintrifft {#new-versions}

Während du die Automatisierung ansiehst, kann jemand eine neue Version speichern, etwa ein Coding-Agent über MCP. Siehst du die neueste Version an und hast keine ungespeicherten Änderungen, wechselt der Canvas zur neuen: Die Kästen gleiten an ihre neuen Plätze, neue Kästen blenden sich ein, geänderte erhalten einmal einen Ring, und ein Screenreader hört „Jetzt wird v6 angezeigt.“. Die geöffnete Node bleibt offen, solange es sie noch gibt. Hast du ungespeicherte Änderungen, bewegt sich nichts. Ein Hinweis über dem Canvas meldet **Eine neuere Version wurde gespeichert**, und **v6 zeigen und Entwurf verwerfen** wechselt zu ihr.

## Den möglichen Pfaden folgen {#paths}

Die Bedingungen eines Laufs entscheiden, welche Nodes laufen. Die Pfad-Schaltfläche oben rechts im Canvas zählt die Wege, die ein erfolgreicher Lauf nehmen kann, etwa **3 Pfade**, und öffnet **Mögliche Pfade**. Jeder Pfad nennt die Bedingungen, die über ihn entscheiden, etwa „Triage läuft“ oder „Propose schlägt fehl, der Lauf geht weiter“, und wie viele Nodes auf ihm laufen.

Zeig auf einen Pfad oder wechsle mit den Pfeiltasten zu ihm, um ihn im Canvas als Vorschau zu sehen. Klick ihn an oder drück die Eingabetaste, damit er angezeigt bleibt: Nodes abseits des Pfads werden gestrichelt und sagen, warum sie nicht laufen, Ende markiert die Ausgaben, die auf diesem Pfad leer bleiben, und ein Screenreader hört, welcher Pfad angezeigt wird. **Alle zeigen** oder Esc zeigt wieder jede Node. Die Liste bleibt offen, während du Nodes auswählst, damit du einen Pfad mit den Feldern einer Node vergleichen kannst.

<Frame caption="Drei Wege, die ein Lauf der Gmail-Triage nehmen kann; Pfad 2 bleibt angezeigt: der Weg, auf dem Propose fehlschlägt und der Lauf weitergeht.">

![Possible paths neben dem Canvas von Triage the Gmail inbox: Path 1 führt 6 von 6 Nodes aus; Path 2, angeheftet, 5 von 6 Nodes, weil Triage läuft und Propose fehlschlägt, während der Lauf weitergeht; Path 3 nur 1 von 6 Nodes, weil Triage übersprungen wird. Darunter sagt Ends the run when it fails, woran Inbox scheitert.](/images/platform/automation-editor-paths.webp)

</Frame>

Unter **Beendet den Lauf, wenn sie fehlschlägt** nennt die Liste die Nodes, deren Fehler den Lauf stoppt, und was jede von ihnen fehlschlagen lassen kann. Zeig auf eine davon, um alle rot einzukreisen; wähle eine aus, um sie zu öffnen.

Auf dem Smartphone öffnet sich die Liste in einem Bereich am unteren Bildschirmrand. Wählst du einen Pfad, schließt sich der Bereich, und oben im Canvas bleibt eine Pille mit dem Namen des Pfads und **Alle zeigen**. Nimmt jeder Lauf denselben Pfad, sagt die Liste das. Bei mehr als 12 Bedingungen und hingenommenen Fehlern gibt es zu viele Pfade für eine Liste; **Wann sie läuft** sagt trotzdem bei jeder Node, wann sie läuft. Ein Canvas mit einem Zyklus hat keine Pfad-Schaltfläche. [Pfade, die ein Lauf nehmen kann](/de/platform/automations/concepts#paths) erklärt, wie Tale die Pfade ermittelt.

## Eine Node bearbeiten

Wähle einen Kasten, um ihn zu öffnen. Auf einem breiten Bildschirm öffnet sich der Inspektor neben dem Canvas; ohne ausgewählte Node nutzt der Canvas die ganze Breite. Auf schmaleren Bildschirmen öffnet er sich in einem Bereich über dem Canvas. Sein Kopf zeigt den Titel der Node, ihre Art und ihre ID mit **Node-ID kopieren**; darunter stehen die Probleme, die zu ihr gehören. **Wann sie läuft** fasst zusammen, welchen Platz die Node im Ablauf hat: bei jedem Lauf, auf einigen Pfaden oder nie, warum sie übersprungen werden kann und was passiert, wenn sie fehlschlägt, etwa „Schlägt sie fehl, stoppt der Lauf mit ihrem Fehler.“

Danach folgen drei Tabs:

- **Felder** enthält, was du ändern kannst. Ein `transform` hat **Code**, ein `llm` **Prompt**, **System-Prompt**, **Modell** und **Ausgabeschema**, ein `agent` zusätzlich Agent-Laufzeit und Ausstattung. **Eingabe** enthält die JSON-Werte und Referenzen, die die Node erhält.
- **Struktur** zeigt, was die Node erhält und zurückgibt, woher Tale diese Struktur kennt und welche Nodes ihre Ausgabe lesen. Wähle eine lesende Node, um sie zu öffnen. **Als TypeScript zeigen** zeigt dieselbe Struktur als Typ.
- **Letzter Lauf** zeigt **Aufgelöste Eingabe**, **Ausgabe** und Effekte der Node in dem Lauf, den der Canvas zeigt. Der Tab erscheint, solange der Canvas einen Lauf zeigt.

<Frame caption="Der Tab Struktur: was Triage zurückgibt, woher diese Struktur stammt und welche Nodes sie lesen.">

![Der Bereich von Triage, einer Sprachmodell-Node, auf Shape geöffnet: When it runs nennt 2 von 3 Pfaden und übersprungen, wenn ihre Bedingung falsch ist; Returns listet aus ihrem Ausgabeschema items mit action, reason, priority und conversationId sowie summary, darunter Show as TypeScript; Read by bietet Record, Due und The automation output an.](/images/platform/automation-editor-node-shape.webp)

</Frame>

Die **Modell**-Auswahl einer `llm`- oder `agent`-Node listet die Modelle, die die verbundenen Anbieter deiner Organisation bedienen; ein nicht aufgeführtes Modell lässt sich eingeben, doch **Probleme** warnt dann, dass ein Live-Lauf an dieser Node fehlschlägt, bis sein Anbieter verbunden ist.

Öffne **Ablaufsteuerung** für Bedingung, Wiederholung und Fehlerbehandlung der Node; nutzt die Node eines davon, ist der Abschnitt schon offen. **Wenn**, **Für jedes** und **Wiederholen bis** nehmen Ausdrücke auf. **Sonst zu** bietet nur Nodes mit einer Bedingung an, und **Keine** entfernt die Alternative. **Maximale Wiederholungen** erscheint mit **Wiederholen bis** und nimmt eine ganze Zahl von 1 bis 20. **Bei Fehler** wählt zwischen **Lauf stoppen** und **Ohne sie weiterlaufen**; geht der Lauf weiter, wird jede Node übersprungen, die die Ausgabe der fehlgeschlagenen Node liest. Unter einer Bedingung, einer Liste oder einer Alternative sagt ein Satz in Worten, was die Einstellung bewirkt.

Mit **Schließen** kehrst du zum Canvas zurück. Auf einem breiten Bildschirm schließt sich der Bereich auch, wenn du auf den leeren Canvas klickst oder außerhalb eines Textfelds Esc drückst. Trigger und Projekteinstellungen der Automatisierung findest du im Tab **Allgemein**. [Automatisierungsgrundlagen](/de/platform/automations/concepts) erklärt Node-Typen und Ausdrücke.

### Code, Prompts und JSON

Code, Prompts, Bedingungen und JSON-Felder sind Code-Editoren. Sie färben die Syntax und jedes `{{ }}`-Template ein und kennen die Automatisierung. Tippst du `{{` in einen Prompt, erscheinen die schließenden Klammern mit dem Cursor dazwischen; nach `nodes.` siehst du nur die Nodes, die vorher laufen, und nach `.output.` die Felder dieser Node mit ihren Typen. Strg+Leertaste öffnet die Vorschläge überall. Zeig auf eine Referenz, um ihren Typ zu sehen, oder drück ⌘K ⌘I (Strg+K Strg+I), damit der Typ an der Cursorposition angezeigt und vorgelesen wird.

<Frame caption="Nach nodes. in einem Template schlägt der Editor die Nodes vor, die vorher laufen, jede mit ihrer Struktur.">

![Das Feld Prompt von Triage im Code-Editor: Die letzte Zeile ist ein Template mit dem Cursor nach nodes., und die Vorschlagsliste bietet inbox mit der Struktur an, die es zurückgibt, einem Objekt mit einer Liste von conversations.](/images/platform/automation-editor-code.webp)

</Frame>

Kurz nachdem du aufhörst zu tippen, ist ein Problem genau dort unterstrichen, wo es steht. F8 und Umschalt+F8 springen zum nächsten und vorherigen Problem und lesen es vor; ⌘. (Strg+.) wendet eine vorgeschlagene Korrektur an, etwa den ähnlichsten Node-Namen. In einem mehrzeiligen Feld rückt Tab ein; um es mit der Tastatur zu verlassen, drück Esc und dann Tab. **Editor vergrößern** öffnet ein langes Feld in einem größeren Editor, und **Zurück zum Feld** kehrt mit deiner Änderung und deinem Cursor an derselben Stelle zurück.

Ein JSON-Feld wie **Eingabe** ändert die Node erst, wenn sein Text gültiges JSON der richtigen Art ist. Während du tippst, behält die Node ihren letzten gültigen Wert, und das Feld sagt, was fehlt, etwa „Das muss ein JSON-Objekt in geschweiften Klammern sein.“

### Eingaben bei Start, Ausgabe bei Ende

Wähle **Start**, um zu sehen, was die Automatisierung startet. **Trigger** nennt es in Worten; **In Allgemein ändern** öffnet den Tab **Allgemein**, in dem du den Trigger einstellst. Unter **Felder** zeigt **Eingaben** die Felder der Laufeingabe als Baum, und **Eingabeschema** enthält das JSON-Schema dahinter, das du bearbeiten kannst. **Struktur** zeigt die Eingabe so, wie Tale sie liest, und **Letzter Lauf** die Eingabe des angezeigten Laufs.

<Frame caption="Die Felder von Start: der Trigger in Worten, die Felder der Laufeingabe und das JSON-Schema dahinter.">

![Start ist im Canvas ausgewählt, daneben sein Bereich: der Trigger Every 6 hours · UTC, ausgeschaltet, und By hand, the API or MCP, darunter Change in General; unter Fields listet Inputs limit, firedAt und trigger mit ihren Beschreibungen, und Input schema enthält das JSON-Schema in einem Code-Editor.](/images/platform/automation-editor-start.webp)

</Frame>

Wähle **Ende**, um zu sehen, was ein Lauf zurückgibt. **Wie ein Lauf endet** nennt die drei Ausgänge; unter **Fehlgeschlagen** ist jede Node, deren Fehler den Lauf stoppt, eine Schaltfläche, die sie öffnet. Unter **Felder** enthält **Ausgabe** den JSON-Wert, den ein erfolgreicher Lauf zurückgibt, mit Templates wie `{{ nodes.report.output }}`. **Struktur** zeigt die Struktur der Ausgabe und **Letzter Lauf** die Ausgabe des angezeigten Laufs.

## Den Quelltext lesen

Wähle im Ansichtsschalter **Quelltext**, um das ganze Dokument als YAML zu lesen: eingefärbt, mit Zeilennummern, Einklappen und Suche (⌘F oder Strg+F). Jedes Problem, das die Prüfung gefunden hat, ist in der Zeile unterstrichen, die es betrifft. So hat auch ein Problem in einem Teil ohne eigenes Feld, etwa in einem Test oder im Namen, einen Ort, an dem du es liest. Der Quelltext ist schreibgeschützt: **YAML kopieren** kopiert ihn, und **YAML herunterladen** speichert ihn als Datei, die nach Automatisierung und Version benannt ist, etwa `gmail-triage-inbox-v3.yml`; solange du ungespeicherte Änderungen hast, kommt `-draft` dazu. Um das Dokument zu ändern, nutze die Felder oder deinen Coding-Agent.

<Frame caption="Quelltext: das ganze Dokument als eingefärbtes YAML, zum Kopieren oder Herunterladen.">

![Die Ansicht Source von Triage the Gmail inbox: YAML mit Zeilennummern und Einklapp-Markierungen, von name: gmail-triage-inbox bis zu den Nodes inbox und triage, unter der Zeile To change the document, use the fields or your coding agent, darüber Copy YAML, Download YAML und Edit with your coding agent.](/images/platform/automation-editor-source.webp)

</Frame>

## Mit deinem Coding-Agent bearbeiten

Größere Änderungen, etwa neue Nodes oder ein umgebauter Ablauf, kommen von einem Coding-Agent wie Claude Code, Codex oder Cursor, der mit dem MCP-Server von Tale verbunden ist. **Mit deinem Coding-Agent bearbeiten** ist in jeder Ansicht die letzte Schaltfläche oben rechts im Canvas und die Hauptaktion einer Automatisierung, die noch keine Nodes hat. Ihr Dialog zeigt den Namen der Automatisierung, den du dem Agent gibst, **MCP einrichten**, das **Einstellungen > API > MCP** öffnet, und **So verbindest du einen Coding-Agent**, das die Anleitung zum [MCP-Endpoint](/de/develop/mcp-endpoint) öffnet. Der Agent liest die Automatisierung, ändert und prüft sie und speichert eine neue Version, die dann im Canvas erscheint, wie [Wenn eine neue Version eintrifft](#new-versions) beschreibt.

## Probleme finden und beheben

Während du bearbeitest, prüft Tale den Entwurf so, wie es auch jedes Speichern prüft. Kurz nachdem du aufhörst zu tippen, zeigt die Schaltfläche **Probleme** neben **Speichern**, was die Prüfung gefunden hat: ein rotes Fehlersymbol und ein gelbes Warnsymbol, jeweils mit ihrer Anzahl, oder **Keine Probleme**. Auf dem Smartphone sitzt die Schaltfläche in der Leiste über dem Canvas. Ein Fehler ist etwas, woran ein Lauf scheitern würde, etwa eine Referenz auf eine Node, die es nicht gibt. Eine Warnung ist etwas, das schiefgehen kann, etwa das Lesen der Ausgabe einer Node, die manchmal übersprungen wird. Eine Node, eine Bedingung, Start oder Ende mit Problemen zeigt dieselben Zahlen auf ihrem Kasten, und ein Feld mit einem Problem erklärt es direkt darunter.

Klicke auf **Probleme**, um sie aufzulisten. Auf einem breiten Bildschirm öffnet sich die Liste unter dem Canvas, auf schmaleren Bildschirmen in einem eigenen Bereich. Jeder Eintrag sagt, was falsch ist, wo, warum und wie du es behebst. **Technische Details** zeigt die Meldung der Engine selbst, und der Code neben dem Titel hilft dir bei der Suche oder im Support. **Alle**, **Fehler** und **Warnungen** filtern die Liste, Esc schließt sie.

<Frame caption="Eine Referenz auf eine Node, die es nicht gibt: Das Feld markiert sie, Speichern wartet, und Probleme sagt, warum und wie du sie behebst.">

![Der Editor mit einem Fehler: Der Prompt von Triage endet mit einem Template, das nodes.nope.output liest, rot unterstrichen und mit dem Grund unter dem Feld; die Kopfzeile zeigt 1 Fehler neben dem deaktivierten Save, und Problems unter dem Canvas listet Reference to an unknown node bei triage › Prompt mit dem Code REF_UNKNOWN_NODE, dem Grund, warum das Lesen scheitert, und der Behebung.](/images/platform/automation-editor-problems.webp)

</Frame>

Wähle einen Eintrag oder drücke darauf die Eingabetaste, um dorthin zu gelangen: Die Node öffnet sich, ihr Feld erhält den Fokus, und die Stelle, die das Problem verursacht, ist markiert. Ein Problem ohne eigenes Feld, etwa ein Modell, das deine Organisation nicht bereitstellt, steht unter **Probleme in dieser Node** oben in den Feldern der Node. Ein Problem in den Eingaben öffnet **Start**, eines in der Ausgabe öffnet **Ende**, und eines in einem anderen Teil des Dokuments, etwa in einem Test oder im Namen, öffnet **Quelltext** an dieser Zeile. Ein Problem in einer Node, die dein Entwurf nicht mehr hat, sagt „Ändere das mit deinem Coding-Agent.“

Solange Fehler bestehen, ist **Speichern** deaktiviert und nennt den Grund, zum Beispiel „Behebe 1 Fehler, um zu speichern“. Auf dem Smartphone steht **Speichern** unter den Feldern einer Node; dort öffnet **Probleme anzeigen** neben diesem Grund die Liste. Warnungen verhindern weder das Speichern noch das Bereitstellen. Kann Tale den Entwurf nicht prüfen, etwa weil die Verbindung abgebrochen ist, zeigt die Schaltfläche **Prüfung fehlgeschlagen**, und du kannst trotzdem speichern: Jedes Speichern wird auf dem Server erneut geprüft. Wird ein Speichern oder Bereitstellen wegen Fehlern abgelehnt, öffnet sich die Liste mit den Problemen des Servers und beginnt beim ersten Fehler.

Die Prüfung läuft nur für Entwickler, Admins und Inhaber, also die Rollen, die speichern dürfen. [Was Tale vor einem Lauf prüft](/de/platform/automations/concepts#checks) erklärt jede Art von Problem.

## Eine Version speichern und testen

1. Ändere die nötigen Felder und klicke auf **Speichern**.
2. Erkläre die Änderung in der **Notiz zur Version** und wähle **Version speichern**. Eine neue Version entsteht; frühere Fassungen bleiben erhalten. Hat jemand während deiner Bearbeitung eine andere Version gespeichert, lehnt Tale das Speichern ab und fragt nach: **Meine Änderungen verwerfen und neu laden** zeigt die neuere Version, **Trotzdem speichern** legt deine Version darüber an — die neuere bleibt im Versionsverlauf, die aktuelle Version ist dann aber deine.
3. Klicke auf **Testlauf**. Hat der Workflow ein Eingabeschema, tippe die Eingabe als JSON in **Eingabe für den Lauf (JSON)**; beim Tippen eines Schlüssels schlägt das Feld die Feldnamen des Schemas vor, und ⌘Enter (Strg+Enter) startet den Lauf. Öffne **Eingabeschema**, um Pflichtfelder und Typen zu sehen. Ungültiges JSON oder unpassende Werte verhindern den Start.
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

![Der Testlauf-Dialog zeigt JSON-Werte für owner und repo im Code-Editor und das aufgeklappte Eingabeschema als Liste von Feldern.](/images/platform/automation-run-input.webp)

</Frame>

## Bereitstellen und live ausführen

Wähle die getestete Fassung unter **Version** und klicke auf die Schaltfläche daneben, die diese Version nennt, etwa **v3 live schalten**. Die Kennzeichnung **Live** markiert die bereitgestellte Version. Sind die gespeicherten Tests einer Version fehlgeschlagen, lässt sie sich nicht bereitstellen. Behebe die Ursache und speichere eine neue Version.

**Live ausführen** startet die bereitgestellte Version, auch wenn du eine andere ansiehst. Die Bestätigung zeigt den Umfang und bei Bedarf **Eingabe für den Lauf (JSON)** für genau diese Version. Prüfe beides vor dem Bestätigen. Live-Läufe können verbundene Systeme verändern und auf eine [Freigabe](/de/platform/approvals/concepts) warten.

Ein Trigger nutzt ebenfalls die bereitgestellte Version. Richte ihn ein, wenn wiederholte oder extern ausgelöste Läufe gewünscht sind; siehe [Automatisierungstrigger](/de/platform/automations/triggers).

## Ein Ergebnis untersuchen

Sobald die Automatisierung gelaufen ist, zeigt der Canvas ihren letzten Lauf: Die unterste Zeile jeder Node sagt, wie sie endete, etwa **Erfolgreich** oder **Übersprungen**, und jede Bedingung zeigt, wie sie entschieden hat, **Ja** oder **Nein**. Die Augen-Schaltfläche oben rechts im Canvas, **Letzten Lauf ausblenden**, nimmt den Lauf vom Canvas, und **Letzten Lauf einblenden** zeigt ihn wieder. Wähle eine Node und öffne **Letzter Lauf**, um ihre **Aufgelöste Eingabe**, **Ausgabe** und Effekte zu sehen. Häufig findest du so eine falsche Referenz: Vergleiche die Eingabe der fehlgeschlagenen Node mit der Ausgabe der Node, die sie liest.

Wechsle zu **Läufe** und öffne den vollständigen Datensatz. Die Tabs bleiben sichtbar; **Läufe** ist aktiv. Mit **Editor** kehrst du zum Workflow zurück. Prüfe Test- oder Live-Modus und bereits ausgeführte Aktionen, bevor du erneut startest. [Ausführungsprotokolle](/de/platform/automations/execution-logs) erklärt Wartezustände, Fehler, automatische Wiederholungen und Abbruch.

## Zu einer früheren Version zurückkehren oder löschen

Öffne für eine Rückkehr **Version** rechts neben den Tabs, lies die Versionsnachrichten und wähle eine frühere Fassung. Die Zeile öffnet den **Editor** mit dieser Version. Klicke dort auf die Schaltfläche, die sie live schaltet, etwa **v2 live schalten**. Künftige Starts verwenden sie; der Versionsverlauf bleibt erhalten. Eine Nachricht wie „Vorherige Empfängerzuordnung wiederherstellen“ macht die Entscheidung nachvollziehbar.

Zum Löschen gehe zur Liste zurück, öffne das Zeilenmenü und wähle **Löschen**. Lies die Bestätigung mit dem Namen der Automatisierung. Versionen, Bereitstellung, Trigger und Projektzuordnungen werden entfernt. Ein offener Lauf blockiert das Löschen; beende ihn oder warte seinen Abschluss ab. Frühere Läufe unterliegen weiter der Aufbewahrung. Bereits ausgeführte Aktionen werden durch das Löschen nicht rückgängig gemacht.
