---
title: "Deine erste Automatisierung: tägliche Aufgaben"
description: Lege aus der Vorlage Tägliche Aufgabenübersicht eine Automatisierung an, führe sie einmal von Hand aus und finde die Übersicht in deinen Benachrichtigungen.
---

In diesem Tutorial legst du eine Automatisierung aus einer Vorlage an, führst sie einmal aus und liest, was sie geschickt hat. Die **Tägliche Aufgabenübersicht** listet die Aufgaben, die am letzten Tag in einem Projekt erstellt wurden, und schickt sie jeden Morgen an ein Mitglied; du richtest sie für eines deiner Projekte ein und schickst sie an dich selbst.

Du brauchst die Rolle Inhaber, Admin oder Entwickler und ein Projekt, das du öffnen kannst und in dem in den letzten 24 Stunden mindestens eine Aufgabe erstellt wurde. Hat es keine, lege zuerst eine auf seinem Board an.

## Die Automatisierung anlegen

1. Öffne **Automatisierungen** und wähle **Automatisierung erstellen** › **Aus einer Vorlage**. Solange deine Organisation keine Automatisierung hat, wähle stattdessen **Vorlagen ansehen**.
2. Wähle **Tägliche Aufgabenübersicht**; die Kategorie **Benachrichtigungen** grenzt den Katalog auf sie und ihre Nachbarn ein. Ihre Vorschau sagt, was sie tut und wann sie läuft.
3. Wähle **Vorlage verwenden**.
4. Wähle unter **Projekt** dein Projekt und unter **Senden an** dich selbst.
5. Lass **Wann** auf jeden Tag um 09:00 in deiner Zeitzone und **Jetzt starten** an.
6. Wähle **Automatisierung erstellen**.

Die Automatisierung öffnet sich im Editor. Ihre Version 1 ist live, und ihr Zeitplan ist eingeschaltet.

## Sie jetzt einmal ausführen

Du musst nicht bis 09:00 warten. Wähle im Kopf des Editors **Live ausführen** und bestätige mit **Live ausführen**. Der Lauf listet die Aufgaben des Projekts aus den letzten 24 Stunden und schickt dir die Übersicht.

Unter **Läufe** verfolgst du ihn. Zeigt der Lauf **Erfolgreich**, wähle ihn und dann seinen Schritt **Tasks**: **Returned** listet die Aufgaben, die er gelesen hat.

<Frame caption="Der Lauf mit ausgewähltem Schritt Tasks: die gelesenen Aufgaben, die älteste zuerst.">

![Die Seite eines erfolgreichen Live-Laufs von Daily task digest mit ausgewähltem Schritt Tasks, einem Schritt Tasks · List tasks; unter Returned steht eine Liste mit 7 Aufgaben.](/images/platform/automation-task-list-run.webp)

</Frame>

## Die Übersicht lesen

Öffne deine Benachrichtigungen. Die Übersicht kommt als **Neue Aufgaben** an: je eine Zeile pro Aufgabe mit Nummer, Titel und zuständiger Person, darunter die Zeile **Gesendet von der Automatisierung** mit ihrem Namen. Wähle sie, um die Aufgaben des Projekts zu öffnen.

Ein Tag ohne neue Aufgaben sendet nichts, und der Lauf ist trotzdem erfolgreich.

## Wie es weitergeht

- Ändere unter **Allgemein** im Abschnitt **Trigger**, wann sie läuft.
- Unter [Vorlagen für Automatisierungen](/de/platform/automations/templates) siehst du, was die anderen Vorlagen tun.
- Ändere ihre Schritte im [Editor](/de/platform/automations/editor); [Aufgaben aus einer Automatisierung anlegen](/de/platform/automations/add-tasks) erklärt den Schritt `task.list`, den sie nutzt.
