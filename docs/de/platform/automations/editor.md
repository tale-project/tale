---
title: Der Workflow-Editor
description: Das Betriebshandbuch zum Editor-Tab einer Automatisierung — wo ihr Workflow lebt, wie du ihn startest, pausierst und deaktivierst, wie du editierst und wie die versionierte Historie funktioniert. Lies das, wenn du einen Workflow täglich betreibst, nicht wenn du das Modell lernst.
---

Diese Seite ist das Betriebshandbuch zum Workflow in einer Automatisierung — der Oberfläche hinter dem Tab **Editor**. Das mentale Modell — was eine Automatisierung bündelt und was eine Definition, ein Trigger und eine Ausführung sind — lebt auf [Automatisierungskonzepte](/de/platform/automations/concepts). Diese Seite ist die praktische Hälfte: wo der Workflow lebt, wie du ihn aus der UI startest, wie du ihn ohne Löschen pausierst, wie du editierst und wie die versionierte Historie funktioniert. Redakteure und Entwickler lesen das, wenn sie täglich mit einem Workflow arbeiten.

## Wo Workflows leben

Workflows haben keinen eigenen Tab in der Seitenleiste. Ein Workflow gehört zu der Automatisierung, die er antreibt — öffne die Automatisierung, und ihr Tab **Editor** ist der Workflow; von dort aus verwaltest du alles Weitere. Ein direkter Link auf einen Workflow funktioniert weiter, wenn ihn jemand teilt; Lesezeichen und die Links auf Genehmigungs-Karten und Ausführungs-Ansichten landen auf dem Workflow selbst. Jede Oberfläche, die diese Seite behandelt (der Editor, der Ausführungen-Tab, die Versionshistorie), hängt an einem einzelnen Workflow, den du geöffnet hast.

## Einen Workflow starten

Drei Pfade feuern einen Workflow.

Der Tab **Trigger** am Workflow hängt die Produktionspfade an: **Zeitpläne** feuern per Cron, **Webhooks** nehmen einen externen POST entgegen, und **Ereignisse** abonnieren interne Signale wie `task.created`. Die [Trigger-Referenz](/de/platform/automations/triggers) deckt jeden einzelnen in Tiefe ab.

**Workflow testen** in der Editor-Toolbar öffnet das Test-Panel und feuert einen einmaligen Lauf. Füge die Eingabe-JSON ein, die der Lauf erhalten soll, klick auf **Ausführen**, und der Lauf taucht im Ausführungen-Tab mit seiner ID auf. Greif zum Test-Panel, wenn du an einem Workflow iterierst und das volle Ausführungsjournal sehen willst, ohne erst einen Trigger zu verdrahten.

Während der Lauf läuft, spiegelt die Canvas ihn live: Jeder Schritt trägt ein Status-Badge — ein Spinner während der Ausführung, ein Häkchen bei Erfolg, ein Warnsymbol bei Fehlern, ein Pause-Symbol beim Warten auf Eingabe — und ein Banner über der Canvas zeigt, welcher Lauf gerade angezeigt wird. Klick auf ein Badge, um Dauer, Fehler und eine Vorschau der Ausgabe des Schritts zu prüfen. Der angezeigte Lauf hängt am URL-Parameter `execution` und übersteht damit ein Neuladen; schließt du das Banner, verschwinden die Badges.

Das Test-Panel spiegelt denselben Feed als Schrittliste: Jeder ausgeführte Schritt erscheint mit seinem Live-Status, wiederholte oder geschleifte Schritte tragen einen Versuchszähler, und ein fehlgeschlagener Schritt zeigt seine Fehlermeldung direkt darunter — klick auf den Namen des Schritts, um direkt zu seinen Einstellungen zu springen. Schlägt ein Lauf fehl, bevor irgendein Schritt lief — nie gestartet, Zeitlimit überschritten oder abgebrochen —, nennt das Panel stattdessen diesen Grund. Testläufe validieren die Eingabe zudem serverseitig gegen das Schema des Start-Schritts: Ein fehlendes oder falsch typisiertes Feld wird mit einer feldgenauen Meldung abgewiesen, bevor der Lauf überhaupt entsteht.

Der **Debuggen**-Button im selben Panel startet den Lauf im Schritt-für-Schritt-Modus. Die Engine hält vor jedem Schritt an: Der pausierte Schritt trägt ein Debug-Badge auf der Canvas, und das Panel zeigt, welcher Schritt als Nächstes dran ist, samt den Variablen des Laufs und der Ausgabe jedes abgeschlossenen Schritts — so prüfst du, was ein Schritt gleich erhält, bevor er läuft. **Schritt** führt den pausierten Schritt aus und hält vor dem nächsten wieder an, **Fortsetzen** lässt den Rest des Workflows ohne weitere Pausen durchlaufen, **Stoppen** bricht den Lauf ab. Debug-Läufe erscheinen im Ausführungen-Tab mit dem Badge _Pausiert (Debug)_, solange sie pausiert sind, und mit `debug` als Auslöser.

Der **Probelauf**-Button im selben Panel simuliert einen Lauf ohne Seiteneffekte — der Workflow validiert gegen die Eingabe, läuft den Schritte-Graph ab und meldet Fehler und Warnungen, ohne irgendeinen Agent, eine API oder einen Mail-Server zu rufen. Greif zum Probelauf, wenn der Workflow noch nicht sicher genug ist, um ihn von Anfang bis Ende laufen zu lassen.

## Pausieren und deaktivieren

Einen Workflow pausieren, ohne ihn zu löschen, geht über die Trigger — jede Trigger-Zeile hat einen **Aktiv**-Schalter. Schalte jeden Trigger aus, hört der Workflow auf zu feuern; schalte sie wieder an, läuft er weiter. Der Workflow selbst bleibt bestehen und seine Historie bleibt intakt.

Einen Workflow löschen ist permanent. Tale fragt vor dem Löschen nach Bestätigung; die Ausführungen und die Versionshistorie gehen mit dem Workflow weg.

## Editieren

Öffne den Workflow, und der Editor zeigt den Schritte-Graph auf einer Canvas — das ist die Ansicht **Graph**, eine von zwei Arten, dieselbe Definition zu lesen. Wechsle zu **Spezifikation**, und derselbe Workflow liest sich als Beschreibung in normaler Sprache, die du direkt editieren kannst; das Generieren aus beiden Ansichten hält sie synchron, und ein Banner warnt, wenn sie auseinanderdriften. Klick auf einen Schritt im Graphen, um rechts das Panel **Schritt-Editor** zu öffnen; das Panel trägt Name, Typ und Konfiguration des Schritts sowie die Übergänge zu den nächsten Schritten bei Erfolg und Fehler. Die Canvas-Toolbar trägt die Zoom-Steuerung, **Workflow testen** und den Schalter **KI-Editor** — ein Chat, der den Workflow für dich editiert, derselbe [Automatisierungs-Assistent](/de/platform/automations/assistant), hier eingebettet. Schritte direkt auf der Canvas hinzuzufügen ist noch nicht verdrahtet; neue Schritte kommen aus dem KI-Editor oder aus der Spezifikation.

Das Banner **Dieser Workflow ist aktiv — gespeicherte Änderungen gelten für neue Ausführungen.** über der Canvas meint genau das: Änderungen an einem getriggerten Workflow greifen beim nächsten Lauf. Schalte seine Trigger zuerst aus, wenn die Änderungen noch nicht fertig sind.

## Versionierung und Historie

Jedes Speichern schnappschotet eine neue Version des Workflows. **Verlauf** in der Navigation des Workflows listet die Versionen, neueste zuerst, jede mit Zeitstempel und dem Mitglied, das gespeichert hat. Öffnest du eine, zeigt **Änderungen vergleichen** einen Diff gegen die aktuelle Definition; klick auf **Wiederherstellen**, um auf diesen Schnappschuss zurückzurollen. Das Wiederherstellen legt eine neue Version oben auf den Verlauf — der zurückgerollte Zustand ist der neue aktuelle, und die Version, die du ersetzt hast, steht weiter in der Liste.

Die Historie ist pro Workflow, nicht pro Schritt. Wiederherstellen rollt die ganze Definition; partielle Wiederherstellungen leben im Editor (kopier die Schritt-Konfig aus dem Diff und füg sie in die aktuelle Version ein).

Ein Neuinstallieren oder Aktualisieren der Automatisierung, zu der dieser Workflow gehört, rührt diese Schritte nie an — ein Workflow ist von diesem Überschreiben ausgenommen, genau damit deine Änderungen eine Katalog-Aktualisierung überstehen. Deinstallier die Automatisierung und installier sie erneut, um stattdessen ihren neuesten mitgelieferten Workflow zu übernehmen.

## Wo das eingesetzt wird

Diese Seite ist das Betriebshandbuch; [Automatisierungskonzepte](/de/platform/automations/concepts) ist das mentale Modell. Die natürlichen Nachbarn sind [Trigger](/de/platform/automations/triggers) (der Startschuss), [Ausführungsprotokolle](/de/platform/automations/execution-logs) (die Detailansicht pro Lauf) und [Genehmigungen in Workflows](/de/platform/automations/approvals-in-workflows) (die menschliche Schranke zwischen Schritten). Greif zu dieser Seite, wenn du mit einem bestehenden Workflow arbeitest; greif zu den Konzepten, wenn du deinen ersten baust.
