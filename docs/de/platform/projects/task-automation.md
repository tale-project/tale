---
title: Eine Aufgabe an einen Agenten delegieren
description: Starte einen Agenten, prüfe sein Ergebnis, fordere Änderungen an und setze fehlgeschlagene Läufe fort oder brich sie ab.
---

Ein Projektagent bearbeitet eine Aufgabe und legt das Ergebnis einer Person zur Prüfung vor. Weise ihm die Arbeit zu, starte den Lauf und halte Rückmeldungen an der Aufgabe fest. Du musst die Aufgabe ändern dürfen: Redakteure und höhere Rollen dürfen das bei jeder Aufgabe im Projekt, Mitglieder bei den Aufgaben, die sie erstellt haben oder die ihnen zugewiesen sind. Außerdem müssen Anbieter, passende Agent-Laufzeit und Sandbox-Kapazität verfügbar sein.

<Frame caption="Agentenarbeit nutzt dasselbe Board wie menschliche Arbeit: Sie startet unter In Bearbeitung und wartet unter In Prüfung auf die Abnahme.">

![Das Aufgabenboard zeigt Arbeit in Backlog, Zu erledigen, In Bearbeitung, In Prüfung, Erledigt und Abgebrochen.](/images/platform/projects-task-board.webp)

</Frame>

## Die Aufgabe vorbereiten und starten

1. Erstelle eine [Aufgabe](/de/platform/projects/tasks) mit gewünschtem Ergebnis, Abschlusskriterien und Eingabedateien.
2. Wähle unter **Zuständig** einen [Projektagenten](/de/platform/projects/project-agents).
3. Lege unter **Reviewer** fest, wer das Ergebnis prüfen soll. Ohne benannten Reviewer geht die Anfrage an den Ersteller der Aufgabe oder des Projekts. Reviewer brauchen Bearbeitungszugriff auf das Projekt. Hat ein Mitglied die Aufgabe erstellt, erhält es deshalb keine Prüfanfrage; es verfolgt die Aufgabe, erfährt, wenn sie **In Prüfung** erreicht, und kann das Ergebnis selbst annehmen, es sei denn, deine Organisation verlangt ein unabhängiges Review und es hat den Lauf selbst gestartet.
4. Klicke auf **Agent starten** oder verschiebe die Aufgabe nach **In Bearbeitung**.

Die Zuweisung allein startet keinen Lauf. Eine bereits zugewiesene Aufgabe kann im **Backlog** bleiben, bis das Team ihren Start beschließt. Nach dem Start verwendet der Agent Beschreibung, Kommentare und Eingabedateien in seiner Sandbox. Die Laufanzeige zeigt, ob er wartet oder arbeitet. Ein Lauf, den ein Mitglied startet, bleibt bei seiner Aufgabe und kommt ohne die Secrets des Agenten aus; [Agentenläufe, die ein Mitglied startet](/de/platform/projects/tasks#agentenlaeufe-die-ein-mitglied-startet) zählt auf, was sich ändert.

Agenten erhalten die Anweisung, Aktualisierungen, Berichte, zugehörige Aufgaben und Rückfragen in der Sprache von Titel und Beschreibung der Aufgabe zu verfassen. Ist daraus keine Sprache erkennbar, verwenden sie die Standardsprache der Organisation für Agenten. Eine Kennung, ein Quartal oder eine automatisch ausgefüllte Titelvorlage legt keine Sprache fest. Ein Wechsel deiner Oberflächensprache ändert die Sprache der Aufgabe nicht; du kannst den Agenten ausdrücklich um einen Sprachwechsel bitten.

Fortschrittskommentare eines Workflows können Übersetzungen für jede unterstützte Oberflächensprache enthalten. Derselbe gespeicherte Kommentar erscheint dann in der jeweils gewählten Sprache. Kommentare ohne Übersetzungen behalten ihren ursprünglichen Text.

## Das Ergebnis lesen und annehmen

Der Agent schreibt seinen Bericht als Aufgabenkommentar und legt erzeugte Dateien als Ergebnisse ab. Danach wechselt die Aufgabe auf **In Prüfung**. Der Reviewer erhält eine Benachrichtigung und bei eingerichtetem E-Mail-Versand auch eine E-Mail.

Bereitgestellte oder übersprungene Dateien führt Tale in einem separaten Systemkommentar in deiner Oberflächensprache auf. Dort steht auch, wenn der Bericht fehlt oder gekürzt wurde. Der Bericht selbst bleibt in der Sprache der Aufgabe.

Lies den Bericht, öffne die Dateien und vergleiche sie mit den Abschlusskriterien. Setze die Aufgabe erst auf **Erledigt**, wenn du die Arbeit annimmst. Tale hält die menschliche Entscheidung fest. Ein Agent darf seine eigene Aufgabe nicht als erledigt markieren.

**Reviewer** steuert Benachrichtigung und Prüfwarteschlange. Auch alle anderen, die die Aufgabe ändern dürfen, können das Ergebnis annehmen: Redakteure und höhere Rollen oder das Mitglied, dem die Aufgabe gehört. Ein Wechsel des Reviewers ändert nicht die Zuständigkeit des Agenten. Verlangt deine Organisation ein unabhängiges Review, kann die Person, die den Lauf gestartet hat, sein Ergebnis nicht annehmen; einen Lauf, den ein Mitglied auf seiner eigenen Aufgabe gestartet hat, nimmt dann ein Redakteur oder eine höhere Rolle an. Einzelheiten stehen unter [Zuständigkeit und Prüfung festlegen](/de/platform/projects/tasks#zustaendigkeit-und-pruefung-festlegen).

Wechselst du den **Reviewer**, solange die Aufgabe unter **In Prüfung** wartet, wandert die offene Anfrage mit: Sie verschwindet aus der Prüfwarteschlange des bisherigen Reviewers, und der neue erhält die Benachrichtigung und bei eingerichtetem E-Mail-Versand auch eine E-Mail. **Reviewer entfernen** gibt die Anfrage an den Ersteller der Aufgabe oder des Projekts zurück.

## Änderungen anfordern

Beschreibe die nötige Änderung in einem Aufgabenkommentar und **erwähne den zuständigen Agenten mit @**. Die Erwähnung ist eine Anweisung: Ein aktiver Agent kann sie während seines Laufs erhalten. Ein wartender Agent beginnt einen Überarbeitungslauf, der das bisherige Gespräch fortsetzt. Das Ergebnis landet erneut unter **In Prüfung**.

Hast du einen Lauf gestartet, lenken deine Erwähnungen ihn auch dann weiter, wenn die Aufgabe an den Agenten übergegangen ist, etwa weil deine Erwähnung ihm eine Aufgabe übergeben hat, die dir zugewiesen war. Startet die Laufzeit des Agenten neu, um einen Kommentar aufzunehmen, wie es alle Laufzeiten außer Claude Code tun, gehört der Rest des Laufs der Person, die den Kommentar geschrieben hat: Er zählt gegen ihre Limits, und seine Connector-Aufrufe erfolgen in ihrem Namen.

Ein Kommentar ohne Erwähnung hält eine Notiz fest, ohne diese Agentenaktion zu starten. Die Erwähnungsauswahl zeigt an, wenn ein Agent nicht reagieren kann, etwa weil die Aufgabenautomatisierung ausgeschaltet oder pausiert ist oder weil du die Aufgabe zwar kommentieren, aber nicht ändern darfst.

Bei einer Aufgabe mit zuständiger Automatisierung erwähnst du diese Automatisierung für einen weiteren Lauf. Die Erwähnung einer anderen Automatisierung überträgt weder die Zuständigkeit noch startet sie diese. [Automatisierungen](/de/platform/automations/concepts) erklärt Workflows mit mehreren Schritten.

Eine Aufgabe kann nur einen eingereihten, laufenden oder wartenden Lauf zugleich haben, egal welche Automatisierung ihn gestartet hat. Ein erneuter Start während dieser Zeit verweist auf den vorhandenen Lauf, auch wenn er eine andere Automatisierung nennt. Nach dessen Ende kann ein weiterer Start einen neuen Lauf erzeugen und die Arbeit wiederholen. Prüfe deshalb den aktuellen Lauf und seine Auswirkungen vor einem weiteren Versuch.

## Einen Manager-Agenten die Warteschlange betreuen lassen

Ein Manager-Agent ist ein Projektagent, der laut seinen Anweisungen das ganze Board liest, startbereite Arbeit verteilt und die Routinefragen anderer Agenten beantwortet, damit Personen nur noch sehen, was ihr Eingreifen braucht. Er liest mit **Aufgaben finden** und **Aufgabe lesen**; keines der beiden Tools ändert etwas.

### Die ganze Warteschlange in Durchgängen lesen

**Aufgaben finden** liefert höchstens 50 Aufgaben auf einmal. Solange eine Seite `isDone: false` meldet, bringt ihr `continueCursor`, als `cursor` mit denselben Argumenten zurückgegeben, die nächste Seite; die letzte Seite meldet `isDone: true`. Ein Cursor, der mit anderen Filtern, einer anderen Reihenfolge oder aus dem Lauf eines anderen Projekts zurückkommt, wird abgelehnt, ebenso ein beschädigter: Er wird nie als erste Seite gelesen. Eine Gesamtzahl erscheint nur, wenn eine einzige Seite alle passenden Aufgaben enthält.

Um eine ganze Warteschlange durchzugehen, verwende `order: "created"`. Die Aufgaben kommen dann nach ihrer Erstellung geordnet, die älteste zuerst, und behalten ihren Platz. So nennt ein Durchgang jede Aufgabe höchstens einmal, in dem Zustand, den sie beim Lesen ihrer Seite hat. Die Standardreihenfolge gruppiert die Aufgaben nach Status und behält darin die Reihenfolge der Spalte bei. Eine Aufgabe, die sich bewegt, während der Manager blättert, kann dabei fehlen oder doppelt erscheinen.

Ein Durchgang kann länger dauern als ein Lauf. Bevor sein Lauf endet, hält der Manager den Zwischenstand in einem Kommentar auf seiner eigenen Aufgabe fest: den Durchgang, dessen Reihenfolge und Filter, den nächsten `continueCursor` und die zuletzt geprüfte Aufgabe. Sein nächster Lauf findet diesen Kommentar mit **Aufgabe lesen** und macht dort weiter. Ist ein Durchgang zu Ende oder wird sein Cursor abgelehnt, beginnt der nächste auf der ersten Seite. Ein fehlgeschlagener Lesevorgang ist keine leere Warteschlange: Der Manager meldet ihn und hört auf.

### Laufende, beendete und wartende Arbeit unterscheiden

**Aufgabe lesen** nennt Unteraufgaben, Blocker und Kommentare mit ihren IDs und blättert mit `commentCursor` zu älteren Kommentaren zurück. Außerdem listet es die Läufe der Projektagenten auf der Aufgabe, den neuesten zuerst, jeweils mit den ersten 500 Zeichen der Nachricht, die ihr Start mitgab, dazu den Automatisierungslauf der Aufgabe und eine offene Prüfanfrage:

- Ein Lauf mit `live: true` ist eingereiht oder läuft, und bis er endet, startet auf der Aufgabe nichts anderes.
- Ein Lauf, der abgeschlossen, fehlgeschlagen oder abgebrochen ist, ist beendet; `settledAt` nennt den Zeitpunkt.
- Ein `workflowRun`, der auf eine Frage (`ask`) oder eine Genehmigung (`approval`) wartet, und eine `pendingReview` warten auf eine Person.

Transkripte, Fehlertexte und Ergebnisse gehören nicht zur Antwort, ebenso wenig etwas aus einem anderen Projekt.

### Eine Routinefrage beantworten

Eine Routinefrage ist eine Frage, die der Manager aus dem beantworten kann, was das Projekt bereits festhält. Schreib dasselbe Vorgehen in die Anweisungen der arbeitenden Agenten und des Managers:

1. Der arbeitende Agent stellt die Frage als Aufgabenkommentar mit einem festen Fragenschlüssel, seinen Belegen und der Frage. Er nennt in seinem Ergebnis die ID des Kommentars und die ID seines Laufs (**Aufgabe lesen** zeigt diesen Lauf auf seiner Aufgabe als den aktiven) und beendet den Lauf, statt darin zu warten. Erwähnt er den Manager in diesem Kommentar, startet das nichts: Ein Kommentar eines Agenten startet nie einen Agenten.
2. Bei seinem nächsten Durchgang antwortet der Manager nur, solange die Aufgabe noch auf diese Frage wartet: Der fragende Lauf ist der neueste Lauf der Aufgabe und beendet, auf der Aufgabe ist kein Lauf aktiv, und die Aufgabe wartet auf die Prüfung genau dieses Laufs (`pendingReview.runId`). Aus diesem Lesevorgang behält er die ID des Laufs und `pendingReview.approvalId`. Hat eine Person die Aufgabe inzwischen weitergebracht, indem sie das Ergebnis angenommen, die Aufgabe abgebrochen oder Änderungen verlangt hat, beantwortet der Manager die Frage nicht mehr, sondern meldet sie.
3. Er schreibt seine Antwort als Kommentar, der die Kommentar-ID der Frage nennt; die Antwort bleibt auf der Aufgabe, was auch immer danach geschieht. Dann setzt er den Agenten mit **Andere Agenten auf Aufgaben starten** fort. Er übergibt `resumeFrom: {runId, approvalId}` mit den beiden IDs, die er behalten hat, dazu eine Nachricht, die mit dem Fragenschlüssel, der ID des Laufs und der Kommentar-ID der Antwort beginnt: **Aufgabe lesen** zeigt später nur die ersten 500 Zeichen der Nachricht eines Starts. Der Start prüft in dem Moment, in dem er geschieht, ob das noch die offene Frage der Aufgabe ist. Nur dann zieht er die offene Prüfanfrage zurück, ohne das Ergebnis anzunehmen, und setzt den Agenten fort.
4. Antwortet der Start mit `stale_question`, wurde die Frage zwischen dem Lesen des Managers und dem Start überholt: Eine Person hat entschieden, es gibt einen neueren Lauf oder eine neuere Prüfanfrage, oder die Zuständigkeit hat sich geändert. Geändert wurde nichts. Der Manager liest die Aufgabe erneut und lässt die überholte Frage fallen. Er startet nicht noch einmal und nie ohne `resumeFrom`.
5. Geht die Rückmeldung des Starts verloren, liest der Manager die Aufgabe erneut, bevor er etwas anderes versucht: Ein neuerer Lauf, dessen Nachricht mit diesem Fragenschlüssel, dieser Lauf-ID und dieser Kommentar-ID der Antwort beginnt, zeigt, dass der Start durchgegangen ist. Wird derselbe Start noch einmal gesendet, antwortet er mit `stale_question` und ändert nichts.

Eine Frage aus einer Daueraufgabe, die ein Zeitplan mit `moveToInProgress: false` startet, wartet auf keine Prüfung. Der Manager schreibt dort nur seine Antwort, und der Lauf beim nächsten Termin des Zeitplans liest sie. Weder der Manager noch sonst jemand startet die Aufgabe vorzeitig, um die Antwort zuzustellen.

Ein Ergebnis annehmen, die Frage einer Automatisierung beantworten und über eine Genehmigung entscheiden bleiben Sache von Personen. Der Manager sieht diese Punkte in **Aufgabe lesen**, damit er sie der zuständigen Person überlässt und meldet.

## Wartende und fehlgeschlagene Läufe behandeln

| Zustand oder Problem | Maßnahme |
| --- | --- |
| Warten auf einen Sandbox-Platz | Die Kapazität der Organisation oder der gemeinsam genutzten Infrastruktur kann ausgeschöpft sein. Warte auf einen Platz oder bitte einen Admin, [Sandboxes](/de/platform/admin/sandboxes) zu prüfen. |
| Automatischer Wiederholungsversuch | Tale wiederholt einen behebbaren Fehler. Beobachte die Versuchszahl und starte keinen zusätzlichen Lauf. |
| Der Lauf bleibt fehlgeschlagen | Lies den Fehler und behebe die Ursache. Nutze dann **Erneut ausführen**, um das Gespräch fortzusetzen. Gelöschte Agenten und Zeitlimits erfordern einen Eingriff. |
| Neuzuweisung wird verweigert | Brich den aktiven Lauf ab, bevor du neu zuweist. |
| Agenten oder Automatisierungen starten eine Aufgabe immer wieder neu | Eine Aufgabe nimmt innerhalb einer Stunde höchstens drei Starts ihres Agenten durch Automatisierungen und andere Agenten an, deren automatische Wiederholungen eingerechnet; der nächste Start wird abgelehnt, eine Wiederholung über die Grenze hinaus startet nicht, und die Zeitleiste zeigt **Ausführung abgelehnt: Agenten-Läufe sind auf dieser Aufgabe pausiert**. Starts durch Personen und deren Wiederholungen zählen nie mit. Für Automatisierungsläufe gibt es keine solche Obergrenze: Erwähnen zwei Automatisierungen einander immer wieder, stoppt allein die Ein-Engine-Regel die Schleife. Brich den aktiven Lauf ab und lies die Zeitleiste, bevor eine von beiden wieder starten darf. |
| Die Aufgabe lässt sich nicht abschließen | Schließe zuerst ihre offenen Teilaufgaben ab. |

Bei behebbaren Fehlern folgen bis zu drei automatische Wiederholungsversuche, die bis auf den unten beschriebenen Fall sofort starten. Ein Lauf, der mindestens fünfzehn Minuten Fortschritt macht, erhält ein neues Versuchskontingent. So kann lange Arbeit Unterbrechungen überstehen. Die Richtigkeit des Ergebnisses musst du trotzdem prüfen.

Eine automatische Wiederholung setzt die Arbeit der Person fort, die den Lauf gestartet hat. Sie startet deshalb nur dort, wo diese Person den Lauf jetzt selbst starten könnte: Das Projekt muss noch aktiv sein, und sie muss die Aufgabe weiterhin ändern dürfen. Archiviert ein Admin das Projekt, verlässt die Person die Organisation oder darf sie die Aufgabe nicht mehr ändern, startet keine weitere Wiederholung, und der Lauf bleibt fehlgeschlagen. Das gilt auch für eine Erwähnung, die den Agenten erst nach dem Ende seines Laufs erreicht. Sobald das Projekt wiederhergestellt ist, kann jeder, der die Aufgabe ändern darf, **Erneut ausführen** nutzen.

Ein Agent, der über einen Abo-Broker arbeitet, kann sein Token mitten in der Arbeit verlieren, wenn der Broker das Konto erneuert. Die Wiederholung setzt die Konversation dann mit einem neuen Token fort, ohne den Versuchszähler zu erhöhen: Sie zeigt denselben Stand wie der Lauf, den sie ersetzt. Zeigte dieser keinen oder hatte er mindestens fünfzehn Minuten gearbeitet und damit ein neues Versuchskontingent erhalten, steht dort **Nach einer Token-Erneuerung fortgesetzt**. Nach zwei solchen Unterbrechungen in Folge zählt eine weitere wie jeder andere Fehler.

Ein Lauf kann auch gar nicht erst starten, weil alle Konten seines Abo-Brokers nach Erreichen eines Rate-Limits pausieren. Seine Wiederholung wird dann sofort eingereiht, startet aber erst, sobald das erste Konto wieder verfügbar ist, spätestens eine Minute später. Die Wartezeit verbraucht keinen Versuch, wenn der abgelehnte Lauf selbst einen Fehler durch ein Rate-Limit wiederholte; sonst zählt der abgelehnte Start als Versuch.

## Arbeit, die eine Automatisierung oder ein anderer Agent startet

Ein Projektagent kann auch an die Arbeit gehen, ohne dass jemand auf **Agent starten** klickt: durch eine [geplante Automatisierung](/de/platform/automations/triggers#einen-projektagenten-nach-zeitplan-starten) oder durch einen anderen Agenten des Projekts, der das Tool **Andere Agenten auf Aufgaben starten** hat, etwa einen Manager-Agenten, der startbereite Arbeit verteilt und Fragen beantwortet. Die Zeitleiste führt einen solchen Lauf als **Automatisierung** mit einem Link zum Automatisierungslauf oder als **delegiert**, gestartet von dem Agenten, der ihn angefordert hat. Der Agent erfährt, wer ihn gestartet hat. Eine mitgegebene Nachricht liest er als Nachricht dieser Automatisierung oder dieses Agenten, nie als Prüfung durch eine Person: Widerspricht sie der Beschreibung oder dem Kommentar einer Person, haben diese Vorrang.

Der Lauf arbeitet im selben Auftrag wie der Lauf, der ihn angefordert hat: im Auftrag der Person, die jenen gestartet hat, oder bei einer Kette, die ein Zeitplan begonnen hat, in niemandes Auftrag; ihre Kosten zählen dann als Automatisierungskosten. Diese Person oder der Zeitplan muss beim Start des Laufs im Projekt handeln dürfen: Verliert die Person die Rolle Redakteur, wird der Zeitplan pausiert oder die Automatisierung aus dem Projekt entfernt, unterbleibt der nächste Start. Ein Agent, den ein anderer Agent gestartet hat, kann keine weiteren Agenten starten, und ein Lauf, den ein Mitglied gestartet hat, kann gar keine starten. Ein solcher Start prüft außerdem, was eine Person übersehen könnte: Eine Aufgabe, die von einer offenen Aufgabe blockiert wird, startet nicht, und ein Agent, der schon an einer anderen Aufgabe arbeitet, wird nicht ein zweites Mal gestartet.

Die Abnahme bleibt Sache einer Person. Ein delegierter Lauf legt sein Ergebnis wie jeder andere unter **In Prüfung** ab. Wird die Arbeit an einer Aufgabe, die dort wartet, wieder aufgenommen, zieht das ihre offene Prüfanfrage zurück, ohne das Ergebnis anzunehmen. Ein Start, der die Karte stehen lässt (`moveToInProgress: false`), wird unter einer Karte, die auf ihre Prüfung wartet, und unter einer erledigten oder abgebrochenen Karte abgelehnt, damit frühere Arbeit nie zur Beurteilung steht, während darunter neue Arbeit läuft. Ein Manager, der die Frage eines Agenten beantwortet, setzt ihn fort und nennt dabei den Lauf, der gefragt hat, und die Prüfung, auf die er wartet. Die Fortsetzung geschieht nur, solange das noch die offene Frage der Aufgabe ist. Hat inzwischen eine Person entschieden (**Erledigt**, **Abgebrochen** oder eine andere Verschiebung), gibt es einen neueren Lauf oder eine neuere Prüfung oder wurde die Zuständigkeit geändert, antwortet der Agent mit `stale_question`, und nichts wird zugewiesen, zurückgezogen, verschoben oder gestartet. Verlangt deine Organisation ein unabhängiges Review, kann die Person, in deren Auftrag der Lauf arbeitet, sein Ergebnis nicht annehmen.

## Arbeit abbrechen oder pausieren

Mit **Lauf abbrechen** stoppst du den aktiven Agenten. Abbrechen kann den Lauf, wer die Aufgabe ändern darf, und auch die Person, die ihn gestartet hat, selbst wenn die Aufgabe inzwischen beim Agenten liegt. Auch das Verschieben einer laufenden Agentenaufgabe aus **In Bearbeitung** kann den Lauf abbrechen. Lies die Bestätigung vorher. Pro Aufgabe kann nur ein Agentenlauf aktiv sein.

Bei einer Aufgabe mit zuständiger Automatisierung stoppt das Verschieben den Lauf und legt die Aufgabe in einem Schritt dort ab, wohin du sie verschoben hast. Wird die Verschiebung abgelehnt, etwa weil du eine übergeordnete Aufgabe mit noch offenen Teilaufgaben nach **Erledigt** verschiebst, arbeitet der Lauf weiter, und die Aufgabe bleibt in **In Bearbeitung**. **Lauf abbrechen** im Bereich der Automatisierung auf der Aufgabe verschiebt sie nach **Abgebrochen**; offene Teilaufgaben verhindern das ebenso. Willst du den Lauf stoppen und die Aufgabe offen lassen, verschiebe sie stattdessen nach **Zu erledigen**.

Ein Admin kann die Aufgabenautomatisierung für die Organisation ausschalten. Neue Läufe starten dann nicht; bestehende Arbeit endet regulär. Organisationslimits und Budgets gelten weiterhin für jeden Lauf. Siehe [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits).

## Die passende Zuständigkeit wählen

Weise einer Person Arbeit zu, die menschliches Urteilsvermögen oder Zugriff außerhalb der Agentenrechte braucht. Nutze einen Projektagenten für eine klar begrenzte Aufgabe mit seinen konfigurierten Dateien und Tools. Eine Automatisierung passt zu festen Abläufen mit mehreren Schritten, Auslösern oder Connector-Freigaben. Mitglieder können nur eine für Aufgaben gebaute Automatisierung wählen, also einen der Einträge unter **Automatisierungen** bei **Zuständig**.

Für den ersten Lauf folge [Deinen ersten Agenten erstellen](/de/tutorials/editor/first-agent-end-to-end). Halte die Aufgabe so klein, dass du ihr Ergebnis selbst prüfen kannst.
