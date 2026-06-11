---
title: Workflows
description: Das Betriebshandbuch zum Workflows-Feature — die Listenansicht, wie du einen Workflow startest, wie du ihn pausierst und deaktivierst, wie du editierst und wie die versionierte Historie funktioniert. Lies das, wenn du Automatisierungen täglich betreibst, nicht wenn du das Modell lernst.
---

Workflows ist das Betriebshandbuch zum Feature. Das mentale Modell — was ein Workflow, ein Trigger, ein Schritt und eine Ausführung sind — lebt auf [Automatisierungs-Konzepte](/de/platform/automations/concepts). Diese Seite ist die andere Hälfte: wie die Listenansicht aufgebaut ist, wie du einen Workflow aus der UI startest, wie du ihn ohne Löschen pausierst, wie du editierst und wie die versionierte Historie funktioniert. Editor- und Entwickler-Rollen lesen das, wenn sie täglich mit Workflows arbeiten.

Das Feature erreichst du über **Automatisierungen** in der Seitenleiste. Die Listenansicht ist der Einstieg; jede andere Oberfläche (der Editor, der Ausführungen-Tab, das Metriken-Dashboard) hängt an einem einzelnen Workflow, den du aus der Liste geöffnet hast.

## Die Listenansicht

Die Liste zeigt jeden Workflow in der Organisation. Die Toolbar trägt eine Suchbox, einen Button **Automatisierung erstellen** und einen Menüeintrag **Aus Datei hochladen** für den Import einer Workflow-JSON. Die Spalten sind Workflow-Name, Beschreibung, die Trigger-Menge, der Zeitstempel des letzten Laufs und ein Zeilen-Aktionsmenü (umbenennen, duplizieren, löschen).

Die Liste lädt beim Scrollen lazy nach. Die Suche matched gegen Name und Beschreibung. Ein Klick auf eine Zeile öffnet den Workflow.

## Einen Workflow starten

Drei Pfade feuern einen Workflow.

Der **Triggers**-Tab am Workflow hängt die laufenden Pfade an: ein manueller Trigger zeigt einen Button unter **Automatisierungen > Manuelle Läufe**, den Mitglieder klicken können, ein Schedule-Trigger feuert per Cron, ein Webhook-Trigger nimmt einen externen POST entgegen, ein Event-Trigger abonniert interne Ereignisse. Die [Triggers-Referenz](/de/platform/automations/triggers) deckt jeden einzelnen in Tiefe ab.

Das **Automatisierung testen**-Panel in der Editor-Toolbar feuert einen einmaligen Lauf direkt aus dem Editor. Fügst du die Eingabe-JSON ein, die der Lauf erhalten soll, klickst **Ausführen**, taucht der Lauf im Ausführungen-Tab mit seiner ID auf. Greif zum Test-Panel, wenn du an einem Workflow iterierst und das volle Ausführungsjournal sehen willst, ohne erst einen Trigger zu verdrahten.

Während der Lauf läuft, spiegelt die Canvas ihn live: Jeder Schritt trägt ein Status-Badge — ein Spinner während der Ausführung, ein Häkchen bei Erfolg, ein Warnsymbol bei Fehlern, ein Pause-Symbol beim Warten auf Eingabe — und ein Banner über der Canvas zeigt, welcher Lauf gerade angezeigt wird. Klick auf ein Badge, um Dauer, Fehler und eine Vorschau der Ausgabe des Schritts zu prüfen. Der angezeigte Lauf hängt am URL-Parameter `execution` und übersteht damit ein Neuladen; schließt du das Banner, verschwinden die Badges.

Der **Debuggen**-Button im selben Panel startet den Lauf im Schritt-für-Schritt-Modus. Die Engine hält vor jedem Schritt an: Der pausierte Schritt trägt ein Debug-Badge auf der Canvas, und das Panel zeigt, welcher Schritt als Nächstes dran ist, samt den Variablen des Laufs und der Ausgabe jedes abgeschlossenen Schritts — so prüfst du, was ein Schritt gleich erhält, bevor er läuft. **Schritt** führt den pausierten Schritt aus und hält vor dem nächsten wieder an, **Fortsetzen** lässt den Rest des Workflows ohne weitere Pausen durchlaufen, **Stoppen** bricht den Lauf ab. Debug-Läufe erscheinen im Ausführungen-Tab mit dem Badge _Pausiert (Debug)_, solange sie pausiert sind, und mit `debug` als Auslöser.

Der **Dry run**-Button im selben Panel simuliert einen Lauf ohne Seiteneffekte — der Workflow validiert gegen die Eingabe, läuft den Schritte-Graph ab und meldet Fehler und Warnungen, ohne irgendeinen Agent, eine API oder einen Mail-Server zu rufen. Greif zum Dry Run, wenn der Workflow noch nicht sicher ist, ihn von Anfang bis Ende laufen zu lassen.

## Pausieren und deaktivieren

Einen Workflow pausieren, ohne ihn zu löschen, geht über die Trigger — jeder Trigger hat einen **Aktiviert**-Schalter. Schalte jeden Trigger aus, hört der Workflow auf zu feuern; schalte sie wieder an, läuft er weiter. Der Workflow selbst bleibt in der Liste und seine Historie bleibt intakt.

Einen Workflow löschen ist permanent und steht im Zeilen-Aktionsmenü der Listenansicht. Tale fragt vor dem Löschen nach Bestätigung; die Ausführungen und die Versionshistorie gehen mit dem Workflow weg.

## Editieren

Öffne den Workflow, und der Editor zeigt den Schritte-Graph auf einer Canvas. Ein Klick auf einen Schritt öffnet sein Panel rechts; das Panel trägt Name, Typ, Konfiguration und die Übergänge zu den nächsten Schritten bei Erfolg und Fehler. Die Toolbar am Canvas-Oberrand trägt **Fokus** (Graph zoomen), **AI-Assistent** (ein Chat, der den Workflow für dich editiert), **Automatisierung testen** und **Schritt hinzufügen**.

Ein Banner über der Canvas warnt, wenn der Workflow aktive Trigger hat — Änderungen an einem getriggerten Workflow wirken sofort, ein Speichern mitten in der Iteration kann das Verhalten eines laufenden Runs ändern. Pausier die Trigger zuerst, wenn die Änderungen noch nicht fertig sind.

## Versionierung und Historie

Jeder Speichervorgang schnappschotet eine neue Version des Workflows. Der **Historie**-Tab in der linken Editor-Schiene listet die Versionen, neueste zuerst, jede mit Zeitstempel und dem Mitglied, das gespeichert hat. Ein Klick auf eine Zeile öffnet einen Diff gegen die aktuelle Definition; ein Klick auf **Wiederherstellen** rollt auf diesen Schnappschuss zurück. Das Wiederherstellen legt eine neue Version oben auf der Historie an — der zurückgerollte Zustand ist der neue aktuelle, und die Version, die du ersetzt hast, steht weiter in der Liste.

Die Historie ist pro Workflow, nicht pro Schritt. Wiederherstellen rollt die ganze Definition; partielle Wiederherstellungen leben im Editor (kopier die Schritt-Konfig aus dem Diff und füg sie in die aktuelle Version ein).

## Wo das eingesetzt wird

Workflows ist das Betriebshandbuch; [Automatisierungs-Konzepte](/de/platform/automations/concepts) ist das mentale Modell. Die natürlichen Nachbarn sind [Triggers](/de/platform/automations/triggers) (der Startpunkt), [Ausführungs-Logs](/de/platform/automations/execution-logs) (die Detailansicht pro Lauf), [Metriken](/de/platform/automations/metrics) (die organisationsweite Aggregation) und [Genehmigungen in Workflows](/de/platform/automations/approvals-in-workflows) (die menschliche Schranke zwischen Schritten). Greif zu dieser Seite, wenn du mit einem bestehenden Workflow arbeitest; greif zu den Konzepten, wenn du deinen ersten baust.
