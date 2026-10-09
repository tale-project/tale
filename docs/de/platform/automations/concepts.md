---
title: Automatisierungskonzepte
description: Verstehe Workflow-Schritte, gespeicherte Versionen, Bereitstellung, Trigger und den Verlauf einzelner Läufe.
---

Nutze eine Automatisierung für Arbeit mit einem wiederholbaren Ablauf. Der Workflow beschreibt die Schritte; gespeicherte Versionen erhalten jede Fassung, die Bereitstellung wählt die Version für Live-Läufe und ein Trigger kann sie nach Zeitplan oder Ereignis starten. Jeder Lauf zeigt Eingabe, Ergebnisse und Aktionen.

Lieber erst zusehen? Episode 5 öffnet die Triage-Automatisierung von vorne bis hinten und entscheidet eine Freigabekarte vor der Kamera, mit Untertiteln — aufgenommen auf der früheren Version, wo die Karte im Chat saß; in dieser Version sitzt sie auf der Detailseite des Laufs.

<Video src="/videos/de/tutorials/ep5-automations/ep5-automations.de.mp4" poster="/videos/de/tutorials/ep5-automations/ep5-automations.de.webp" captions="/videos/de/tutorials/ep5-automations/ep5-automations.de.vtt" lang="de" title="Episode 5 — Automatisierungen & Freigaben" caption="Episode 5 — Automatisierungen & Freigaben (3:11)">

</Video>

## Das Workflow-Dokument

Der `name` identifiziert die Automatisierung. Verwende kleingeschriebene Segmente mit Bindestrichen; `/` fasst verwandte Automatisierungen in Ordnern zusammen, etwa `billing/dunning-reminder`. Das erste Segment darf kein reservierter Seitenname sein: `asks`, `builder`, `catalog`, `listing`, `metrics`, `runs`, `serving-preview` oder `upload`.

Das Dokument enthält außerdem eine `description`, ein JSON-Schema `inputs` für die Eingabe eines Laufs, die ausführenden `nodes` und einen `output`-Ausdruck für das Ergebnis. Seine `tests` beschreiben Beispiele und erwartete Ergebnisse, die vor der Bereitstellung geprüft werden.

```yaml
name: billing/dunning-reminder
description: Einen Kunden an eine überfällige Rechnung erinnern.
inputs:
  type: object
  properties:
    invoiceId: { type: string }
  required: [invoiceId]
nodes:
  - id: invoice
    type: transform
    input:
      id: '{{ input.invoiceId }}'
    code: 'return { id: input.id, daysLate: 14 };'
  - id: message
    type: llm
    model: openai/gpt-4o-mini
    prompt: 'Schreibe eine höfliche Erinnerung zu Rechnung {{ nodes.invoice.output.id }}.'
output:
  text: '{{ nodes.message.output.text }}'
tests:
  - name: erzeugt eine Erinnerung
    input: { invoiceId: 'inv-1' }
```

Der `ui`-Block speichert die Positionen auf dem Canvas. Verschieben ändert die Anordnung, nicht die Ausführung einer Node.

### Kanten entstehen, sie werden nicht deklariert

Es gibt keine Kantenliste. Eine Node liest eine andere, indem sie sie referenziert — `{{ nodes.invoice.output.id }}` —, und genau diese Referenz _ist_ die Kante, die der Canvas zeichnet. Die Reihenfolge ergibt sich aus einer topologischen Sortierung über diese abgeleiteten Kanten. Deshalb verschwindet mit einer gelöschten Referenz auch ein Pfeil, und deshalb weist die Plattform zwei Nodes zurück, die einander lesen.

Templates nutzen eine einzige `{{ }}`-Grammatik aus JavaScript-Ausdrücken über `input`, `nodes.<id>.output` und, innerhalb einer iterierenden Node, `item` und `index`.

### Die Ablaufsteuerung sitzt an der Node

Verzweigen und Wiederholen sind Felder an einer Node statt eigener Schritttypen. Der Canvas zeigt sie deshalb als Badges an genau der Box, die sie betreffen.

| Feld                         | Wirkung                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `when`                       | Die Node läuft nur, wenn der Ausdruck wahr ist; abhängige Nodes werden mit übersprungen |
| `elseOf`                     | Läuft genau dann, wenn die genannte Node durch ihr eigenes `when` übersprungen wurde    |
| `forEach`                    | Läuft einmal pro Element einer Sammlung, mit `item` und `index` im Zugriff              |
| `repeatUntil` / `maxRepeats` | Wiederholt, bis der Ausdruck wahr ist, mit Deckel (Standard 5, Maximum 20)              |
| `onError`                    | `fail` bricht den Lauf ab; `continue` notiert den Fehler und überspringt Abhängige      |

### Node-Typen

Vier Typen sind eingebaut, und jede Connector-Aktion sowie jede Plattformfunktion — Wissenssuche, Dokumentoperationen — reiht sich in dieselbe Tabelle daneben ein.

**`transform`** führt reines JavaScript aus, um Daten umzuformen. Ohne Netzwerk und ohne Imports: Der Rumpf liest die aufgelöste `input` der Node und muss einen Wert zurückgeben.

**`llm`** ruft ein Sprachmodell mit einem Prompt-Template auf. `model` ist Pflicht und immer ausdrücklich — eine Automatisierung wählt nie eines für dich (das Auto der Chat-Eingabezeile ist eine reine Chat-Sache). Die Ausgabe ist `{text}` oder das Objekt in Form des Schemas, wenn die Node ein `outputSchema` deklariert. Jeder Aufruf in einem Live-Lauf ist Nutzung des Laufs: Er wird vorher gegen die [Budgetlimits](/de/platform/admin/governance/policies-and-limits) geprüft, und ein Aufruf, den ein Limit ablehnt, lässt die Node mit `budget_exceeded` fehlschlagen, was den Lauf abbricht, außer ihr `onError` ist `continue`.

**`agent`** führt einen Agent-Turn eines Coding-Agents (Claude Code, Codex und die übrigen Agent-Laufzeiten) in der Sandbox aus. Er liest bereitgestellte `files`, nutzt `skills`, vermittelte `connectors`, gewährte Plattform-`tools` und eingespielte `secrets` und gibt `{text, files, status}` zurück; `model` ist Pflicht. Hat ein Admin die [Bildgenerierung](/de/platform/admin/governance/content-models#let-agents-generate-images) eingeschaltet, kann er auch Bilder erstellen, die unter seinen `files` zurückkommen. Greif zu `llm`, wenn eine einmalige Completion reicht, und zu `agent` nur, wenn der Schritt Werkzeuge, Dateien oder mehrere Turns braucht — eine live geschaltete Agent-Node läuft als asynchroner Turn, sitzt daher auf der obersten Ebene statt in einer `subautomation` und iteriert nicht mit `forEach`.

**`subautomation`** führt eine andere gespeicherte Automatisierung als einzelne Node aus; ihr Feld `automation` benennt `"name"` oder `"name@version"`. Ohne Version läuft die live geschaltete, und die Verschachtelung endet bei drei Ebenen.

### Strukturierte und unstrukturierte Ausgabe

Eine **strukturierte** Ausgabe hat benannte Felder, die du über `nodes.<id>.output.<field>` referenzierst. Eine **unstrukturierte** Ausgabe enthält freien Text. Verwende dafür `nodes.<id>.output.text` in einem Textausdruck; behandle die Ausgabe nicht wie ein Objekt mit weiteren Feldern.

Ein Werkzeug ohne Ausgabeschema liefert unstrukturierte Ausgabe. Soll daraus strukturierte Eingabe für weitere Schritte entstehen, nutze eine `llm`-Node mit `outputSchema`. Die Validierung nennt bei einem Fehler die ungültige Referenz und die zulässigen Felder oder Kontexte. Korrigiere die Referenz, bevor du erneut speicherst.

## Was Tale vor einem Lauf prüft {#checks}

Tale prüft das ganze Dokument, wenn du es speicherst, wenn du eine Version bereitstellst und wann immer ein Client `validate_automation` aufruft. Ein **Fehler** beschreibt etwas, das sicher scheitert, oder Code, der die Analysegrenzen überschreitet. Er verhindert Speichern wie Bereitstellen. Eine **Warnung** zeigt auf etwas, das scheitern kann oder nichts Nützliches tut. Sie verhindert weder Speichern noch Bereitstellen; du entscheidest selbst, ob du etwas änderst. Jedes Problem nennt seine Node und sein Feld und, in einem Template, einer Bedingung oder in Code, den genauen Ausdruck.

Damit die Prüfung zügig bleibt, gelten für jeden Ausdruck und jeden `transform`-Code Grenzen von 8192 UTF-16-Codeeinheiten, 512 JavaScript-Tokens und 64 Verschachtelungsebenen in der Syntax oder im Syntaxbaum. Leerraum um einen Template-Ausdruck zählt nicht zu seiner Größe; Leerraum im Transform-Code zählt mit. Reiner Text außerhalb von Templates ist kein Code. Diese Grenzen können zuvor gültigen Code ablehnen. Kürze ihn oder verteile die Arbeit auf mehrere Nodes, bevor du erneut speicherst oder bereitstellst.

### Referenzen und Namen {#checks-references}

Jedes `nodes.<id>` muss eine bestehende Node nennen, ihr Ergebnis über `.output` lesen und darf keinen Kreis von Nodes schließen, die einander lesen. Liest eine Referenz ein Feld, das ihre Quelle nicht hat, etwa beim Tippfehler `nodes.calc.output.cuont`, gibt es eine Warnung mit dem ähnlichsten Feld als Vorschlag. Tale meldet auch Namen, die ein Ausdruck nicht sieht, etwa `item` außerhalb von `forEach` oder ein vertipptes `input`, und ein `input.<key>`, das `inputs` nicht deklariert.

### Typen {#checks-types}

Tale kennt die Form der meisten Werte: die Eingabe des Laufs aus `inputs`, die Ausgabe einer Capability aus ihrer Signatur im Katalog, die Ausgabe einer `llm`-Node aus ihrem `outputSchema` und die einer `transform`-Node aus dem Objekt, das ihr Code zurückgibt. Tale warnt, wenn ein Wert an einer Stelle landet, die einen anderen Typ braucht, etwa eine Zahl, wo eine Capability Text erwartet, oder ein Objekt, wo `forEach` eine Liste braucht. Außerdem warnt Tale, wenn ein Wert, der in Text eingesetzt wird, fehlen kann, denn ein fehlender Wert lässt die Node dort scheitern.

### Übersprungene und fehlgeschlagene Nodes {#checks-skips}

Eine Node wird übersprungen, wenn ihr `when` falsch ist, wenn ihr `elseOf`-Partner läuft oder wenn eine Node übersprungen wird, die sie in `input`, `prompt`, `system`, `files`, `code` oder `forEach` liest. Eine Node mit `onError: continue` wird übersprungen, wenn sie fehlschlägt. Die Ausgabe einer übersprungenen Node ist `null`, und eine Node, die eine übersprungene Node in einem dieser Felder liest, wird ebenfalls übersprungen. Ein Lesezugriff in `when` oder `repeatUntil` überspringt die Node nicht: Die Bedingung läuft und liest `null`.

Liest eine Bedingung oder die `output` der Automatisierung ein Feld einer Node, die übersprungen werden kann, schlägt das Lesen also in den Läufen fehl, in denen diese Node nicht lief. Dasselbe passiert, wenn der Wert einer solchen Node in Text steht, etwa in `Summary: {{ nodes.summary.output?.text }}`: `?.` liefert dort keinen Wert, und Text lehnt einen fehlenden Wert ab. Tale warnt bei jedem solchen Lesezugriff und sagt eigens dazu, wenn die Ursache ein Fehler ist, den `onError: continue` toleriert. Sichere den Lesezugriff mit `?.` und einem Ersatzwert ab: `{{ nodes.check.output?.ok ?? false }}` in einer Bedingung, `{{ nodes.summary.output?.text ?? null }}` in der Ausgabe. Alternative Zweige treffen sich in der `output` der Automatisierung, nicht in einer Node, die beide liest:

```yaml
output:
  message: '{{ nodes.summary.output?.text ?? nodes.summary_empty.output?.text }}'
```

### Nodes, die nie laufen können {#checks-unreachable}

Manche Nodes können nie laufen: eine, deren Bedingung immer falsch ist, die Alternative einer Node, die immer läuft, oder eine Node, die zwei Zweige liest, die nie zusammen laufen. Tale warnt bei jeder davon. Eine Node, deren Ausgabe niemand liest und die nichts bewirkt, meldet Tale als unbenutzt.

### Bedingungen und Schleifen {#checks-conditions}

Eine Bedingung, die immer dieselbe Antwort liefert, entscheidet nichts. Text um ein Template macht `when` zum Beispiel zu einem nicht leeren String, und der gilt immer als wahr. Ein `repeatUntil`, das immer falsch ist, durchläuft alle `maxRepeats` Durchgänge, und eines, das das Ergebnis des Durchgangs (`output`) nie liest, liefert nach jedem Durchgang dieselbe Antwort.

### Iteration {#checks-iteration}

`forEach` muss ein einzelnes Template sein, das eine Liste ergibt. Reiner Text, Text um ein Template oder ein fester Wert, der keine Liste ist, ist ein Fehler, denn die Node scheitert bei jedem Lauf. `when` und `forEach` werden einmal gelesen, bevor die Node ihre Elemente durchläuft. `item` und `index` gibt es dort deshalb nicht, und sie dort zu verwenden ist ebenfalls ein Fehler. Eine `agent`-Node kann `forEach` und `repeatUntil` noch nicht verwenden.

### Aufgerufene Automatisierungen {#checks-called-automations}

Eine `subautomation`-Node wird gegen die Version geprüft, die ein Lauf aufrufen würde: die genannte Version, sonst die bereitgestellte, sonst die neueste. Diese Version muss existieren und darf keine `agent`-Node enthalten. Tale warnt, wenn die Eingabe nicht zu ihren `inputs` passt und wenn sie einen Schreibzugriff ausführt, den eine Freigabe aufhalten könnte, denn eine aufgerufene Automatisierung kann nicht warten. Auch ein Zeitplan-Trigger, dessen Starteingabe die `inputs` der Automatisierung ablehnen, wird gemeldet.

### Tests {#checks-tests}

Die Eingabe eines Tests muss zu `inputs` passen, jeder erwartete Effekt muss von einer Node stammen, die ihn ausführt, und ein erwarteter Ausgabewert muss einen Typ haben, den die Automatisierung zurückgeben kann. Ein Test, der gegen eine dieser Regeln verstößt, kann nie bestehen, deshalb warnt Tale, bevor du ihn ausführst.

## Versionen ändern sich nie

Speichern legt eine neue Version an, statt die vorige zu überschreiben. Die Nummerierung beginnt für jede Automatisierung bei 1; jede Version enthält die Änderungsnotiz ihres Autors. Der Workflow einer vorhandenen Version bleibt unverändert.

Ein laufender Workflow behält die Version, mit der er gestartet wurde. Spätere Bearbeitungen ändern seine Schritte nicht. Öffne bei der Prüfung eines älteren Laufs dessen aufgezeichnete Version, um Eingabe und Ablauf zu vergleichen. Unveränderlichkeit ist keine unbegrenzte Aufbewahrung: Beim Löschen einer Automatisierung oder ihrer Historie können die Datensätze entfernt werden.

## Live-Schalten ist ein eigener Schritt

Genau eine Version pro Automatisierung ist live, und diese Version führen die Trigger aus. Eine Version live zu schalten oder auf eine ältere zurückzugehen ist ein einzelner Schritt, der keine Historie umschreibt — die Versionsliste bleibt exakt, wie sie war, und nur der Zeiger wandert. Eine Automatisierung darf auch gar nichts live haben und rein als Entwurf existieren.

Eine Version mit einem fehlgeschlagenen Test lässt sich nicht live schalten; eine Version, deren Tests bestanden sind oder die gar keine Tests hat, schon. Tests liegen im Dokument: Jeder hat einen Namen, eine Eingabe und Erwartungen an die Ausgabe sowie an die Auswirkungen, die der Lauf erzeugen soll. Ob die Tests einer Version bestanden waren, wird beim Speichern festgehalten — das Live-Schalten liest diese festgehaltene Tatsache, statt die Suite erneut laufen zu lassen.

<Note>

Ein Live-Lauf braucht eine bereitgestellte Version. Einen gespeicherten Entwurf kannst du vorher mit **Testlauf** prüfen.

</Note>

## Was einen Lauf startet

Eine gespeicherte Version kannst du manuell testen; die bereitgestellte Version lässt sich live ausführen. Für automatische Starts richtest du eine von drei Trigger-Arten ein: einen Zeitplan, der sich zu festen Uhrzeiten oder in einem Intervall in seiner Zeitzone wiederholt, eine durch ein Token geschützte Webhook-URL oder ein benanntes Plattformereignis. Jeder davon kann eine feste Eingabe mitgeben, die jeder Lauf erhält.

Der Trigger gehört zum Namen der Automatisierung. Bei einer neuen Bereitstellung bleiben Konfiguration und Webhook-URL erhalten; nachfolgende Starts verwenden die neu bereitgestellte Version. Deaktiviere den Trigger, um automatische Starts zu pausieren. [Workflow-Trigger](/de/platform/automations/triggers) erklärt Zeitsteuerung, Anmeldung und die Eingabe jeder Trigger-Art.

## Was ein Lauf festhält

Ein Lauf speichert Status (`queued`, `running`, `waiting`, `success`, `failed` oder `cancelled`), Modus, Auslöser, Eingabe, Ausgabe und einen Checkpoint für jede abgeschlossene Node. Die Ablaufspur zeigt die vom Ausführungssystem versuchten Schritte.

Gibt die Verarbeitung vorübergehend ab, setzt derselbe Lauf anhand seiner Checkpoints fort, ohne abgeschlossene Nodes erneut auszuführen. Die Liste der Auswirkungen erfasst Connector-Schreibaktionen. Sie ist kein vollständiges Verzeichnis der Änderungen durch eine Sandbox oder direkte Werkzeuge. Für die Laufhistorie gelten weiterhin Löschung und Aufbewahrungseinstellungen.

Im Modus **Test** werden externe Aktionen simuliert. **Live** kann sie tatsächlich ausführen und benötigt zum Starten Entwicklerrechte. Unter [Ausführungsprotokolle](/de/platform/automations/execution-logs) erfährst du, wie du gespeicherte Version, aufgelöste Eingaben, Fehler und protokollierte Auswirkungen prüfst.

## Wo ein Mensch entscheidet

Eine erforderliche Freigabe hält den Lauf vor einer geschützten Schreibaktion im Status `waiting` an. Die Freigabe erlaubt den Ausführungsversuch, garantiert aber keinen Erfolg. Ablehnen verhindert die Aktion und lässt den Lauf fehlschlagen. Eine Frage pausiert ebenfalls, verlangt jedoch Informationen statt einer Erlaubnis.

Der Status `waiting` kann auch bedeuten, dass ein Agent noch arbeitet, dass ein Agent-Schritt für seinen Start auf einen Sandbox-Platz wartet oder dass eine Node ihre Bedingung wiederholt prüft. Lies deshalb `waitingFor`: `approval`, `ask` und `in_doubt` brauchen eine Person; `agent`, `room` und `repeat` setzen normalerweise automatisch fort. `in_doubt` heißt, dass ein Schritt gerade etwas an einen externen Dienst gesendet hat, als der Lauf unterbrochen wurde, und Tale nicht erkennen kann, ob der Dienst es erhalten hat. Niemand wird benachrichtigt; entscheide es auf der Seite des Laufs, wie [Automatisierungsläufe prüfen und Fehler beheben](/de/platform/automations/execution-logs) es beschreibt. [Freigaben in Workflows](/de/platform/automations/approvals-in-workflows) erklärt, wie du die menschlichen Anfragen prüfst und beantwortest.

## Chat, Aufgabe oder Automatisierung wählen

| Bedarf | Nutze |
| --- | --- |
| Eine Frage stellen und die Antwort besprechen | Chat |
| Ein geprüftes Ergebnis mit Zuständigkeit erstellen | Eine Projektaufgabe, bei Bedarf einem Agenten zugewiesen |
| Abhängige Schritte ausführen oder auf Zeitplan, Webhook oder Ereignis reagieren | Eine Automatisierung |

Prüfe vor dem Erstellen die [mitgelieferten Automatisierungen](/de/platform/automations/builtin). Ein Webhook startet eine Automatisierung; er ist keine eigene Art von Projektagent.

## Das Modell in die Praxis bringen

Workflow, Versionen, Bereitstellung und Trigger sind getrennte Bestandteile einer Automatisierung. Folge dem [Workflow-Editor](/de/platform/automations/editor), um eine Änderung zu testen und live zu schalten. Die [Ausführungsprotokolle](/de/platform/automations/execution-logs) zeigen, was ein Lauf getan hat.
