---
title: Automatisierungen durchsuchen und installieren
description: Wie der Automatisierungen-Katalog funktioniert — Installiert vs. Alle Automatisierungen, das Seitenpanel, das eine Karte öffnet, der Installations-Assistent mit seiner Vorprüfung, das Neuinstallieren und Deinstallieren, und wie du alle mitgelieferten Automatisierungen auf einmal aktualisierst.
---

Der Automatisierungen-Katalog (**Automatisierungen** in der Seitenleiste) ist der Ort, an dem Inhaber, Admins und Entwickler jede Automatisierung durchsuchen, die der Organisation zur Verfügung steht, und entscheiden, welche installiert sind. Diese Seite deckt den Katalog selbst ab — das Seitenpanel, das eine Karte öffnet, den Installations-Assistenten und die Aktionen Neu installieren, Deinstallieren und Aktualisieren, die danach folgen. Was jede mitgelieferte Automatisierung tatsächlich tut, steht auf [Mitgelieferte Automatisierungen](/de/platform/automations/builtin); das mentale Modell für die Bestandteile, die eine Automatisierung bündelt, steht auf [Automatisierungskonzepte](/de/platform/automations/concepts).

<Frame caption="Der Automatisierungen-Katalog — jede Karte ist eine installierbare Automatisierung; das Bundle installiert alle seine Mitglieder über einen Assistenten.">

![Der Automatisierungen-Katalog auf dem Tab Alle Automatisierungen, mit Karten für die drei E-Mail-Automatisierungen und das Bundle GitHub-Issues lösen, jede mit Icon und Beschreibung.](/images/platform/automations-catalog.webp)

</Frame>

## Installiert und Alle Automatisierungen

Der Katalog öffnet sich auf **Installiert** — die Standardauswahl der Tab-Leiste, und der einzige Tab, auf dem sich ein Bundle in seine eigenen Mitglieder-Karten auflöst, statt einmal als Bundle zu erscheinen. Jedes Mitglied trägt auf seinem Icon eine kleine Markierung mit dem Namen seines Bundles — etwa **Teil von GitHub-Issues lösen** —, damit die Zugehörigkeit sichtbar bleibt, und behält sein eigenes **Neu installieren**/**Deinstallieren** im **⋯**-Menü: Ein Bundle hat schließlich keine eigene Installation, die sich als Einheit verwalten ließe (warum, steht auf [Automatisierungskonzepte](/de/platform/automations/concepts)). Wechsle zu **Alle Automatisierungen**, um stattdessen den vollständigen Katalog zu durchsuchen — mitgeliefert und hochgeladen, installiert oder nicht: Hier ist das Bundle selbst die Karte, über einen Assistenten installiert, und seine versteckten Mitglieder tauchen nie für sich allein auf. **Installiert** verwaltet, was läuft; **Alle Automatisierungen** findet Neues.

## Eine Automatisierung installieren

Klick auf eine Karte, und ihr Seitenpanel öffnet sich — dasselbe Klick-zur-Vorschau-Muster, das [Einstellungen > Integrationen](/de/platform/integrations/overview) für seinen eigenen Katalog nutzt. Das Panel listet, was die Installation hinzufügt: seine Seiten, Workflows, Agents, Skills und die Integrationen, die es braucht, plus das Projekt, das es anvisiert, wenn es projektgebunden ist. Klick auf **Installieren**, und der Assistent öffnet sich.

Der Assistent geht nur die Schritte durch, die diese Automatisierung wirklich braucht: einen Schritt **Projekt**, wenn sie projektgebunden ist und du sie nicht schon von innerhalb eines Projekts geöffnet hast; einen Schritt **Änderungen prüfen**, wenn die Installation bereits vorhandene Dateien überschreiben würde; einen Schritt **Installieren**, der jede benötigte, noch nicht verbundene Integration verbindet; einen Schritt **Agent-Modus** für jeden Agent, der auf deinen eigenen Zugangsdaten statt denen der Plattform laufen kann; und einen Schritt **Fertig**. Das Projekt, das du im Schritt **Projekt** wählst, übernimmt eine doppelte Aufgabe: An dieses Projekt ist auch jeder Zeitplan gebunden, den die Automatisierung installiert, sodass eine Automatisierung, deren Dokument `{{ input.projectId }}` liest, gegen das richtige Projekt läuft, ohne dass dieser Wert irgendwo erneut eingetippt werden muss.

**Fertig** behauptet erst dann Bereitschaft, wenn die Automatisierung es auch ist. Ist jede erforderliche Integration verbunden, steht genau das da; eine erforderliche Eingabe, die das eigene Schema der Automatisierung deklariert und nach der kein Assistent-Schritt fragt, wird stattdessen benannt — du verlässt den Assistenten also im Wissen, was noch fehlt (bei einem Bundle macht der Schritt Fertig dasselbe pro Mitglied). Jeder Einrichtungsschritt lässt sich trotzdem später abschließen, über die eigene Checkliste **Einrichtung abschließen** der Automatisierung.

## Die Prüfung vor der Installation

Eine Automatisierung neu zu installieren oder erneut hochzuladen, wenn sie bereits einige ihrer Dateien geändert hat, löst vor jeder Änderung einen Schritt **Änderungen prüfen** aus. Für eine einzelne Automatisierung listet der Schritt jede Datei, die die Installation überschreiben würde, und bittet dich, das Ersetzen aller durch die Versionen der Automatisierung in einem Schritt zu bestätigen — ein Auswählen einzelner Dateien gibt es nicht. Die Installation eines **Bundles** prüft dagegen pro Mitglied-Automatisierung: Jedes Mitglied bekommt seinen eigenen einklappbaren Abschnitt und seine eigene Bestätigung, sodass du genau siehst, welche der mehreren Automatisierungen des Bundles Dateien berühren, die du geändert hast. So oder so: Das eigene Workflow-Dokument einer Automatisierung ist von dieser Prüfung ausgenommen — mehr dazu im nächsten Abschnitt.

## Neu installieren, deinstallieren und aktualisieren

Jede installierte Karte trägt ein **⋯**-Menü mit **Neu installieren** und **Deinstallieren**; das Menü einer noch nicht installierten Karte bietet stattdessen **Installieren**, plus **Löschen** für einen privaten Upload, den du noch nicht installiert hast. **Neu installieren** durchläuft dieselbe Vorprüfung wie eine frische Installation und behält deine Umgebungsvariablen und Secrets. **Deinstallieren** entfernt die Automatisierung und alles, was sie installiert hat — ihre Agents, Workflows, Seiten sowie deren Umgebungsvariablen und Secrets —, während jede Integration, die sie genutzt hat, für alles andere verbunden bleibt, das sie braucht.

Ein Neuinstallieren rührt das Workflow-Dokument der Automatisierung nie an: Es ist von der Aktualisierung ausgenommen, sodass die Versionen, die du gespeichert hast, und die, die du live geschaltet hast, jedes Neuinstallieren und jede Katalog-Aktualisierung überstehen. Um stattdessen das neueste mitgelieferte Dokument zu holen, deinstallierst du die Automatisierung und installierst sie erneut — Tale wiederholt diesen Hinweis auf der Neuinstallations-Bestätigung.

**Mitgelieferte Automatisierungen aktualisieren**, im selben Menü **Automatisierung hinzufügen** wie **Paket hochladen**, ist eine andere Aktion als die beiden vorigen: Sie gleicht jede mitgelieferte Automatisierung der Organisation in einem Durchgang gegen den mitgelieferten Katalog ab — auch die, die du bearbeitet hast —, statt eine Karte nach der anderen. Sie trägt dieselbe Workflow-Ausnahme und behält Secrets, und weil ein Speichern immer nur anhängt, lässt alles, was sie ändert, jede frühere Version dieser Automatisierung genau dort, wo sie war.

## Eine private Automatisierung hochladen

**Paket hochladen** im selben Menü fügt eine Automatisierung hinzu, die der Katalog nicht mitliefert — leg ein `.zip` ab, oder wähl einen Ordner mit einer `automation.json` in seinem Stammverzeichnis; der Ordner- oder Dateiname wird zum Slug der Automatisierung. Das Hochladen fügt sie nur dem privaten Katalog der Organisation hinzu; installiere sie danach wie jede andere Karte. Erneutes Hochladen über einen bereits vorhandenen Slug bittet dich, das Ersetzen zu bestätigen, bevor es das vorhandene Paket überschreibt.

## Wo das hineinpasst

Der Katalog ist die Eingangstür zu jeder Automatisierung, die die Organisation ausführen kann: Das Seitenpanel zeigt vorab, was eine Installation hinzufügt, der Assistent verbindet, was sie braucht, und Neuinstallieren, Deinstallieren und Aktualisieren halten sie aktuell, ohne einen Workflow anzurühren, an dem du gerade arbeitest. [Mitgelieferte Automatisierungen](/de/platform/automations/builtin) ist die nächste Lektüre dafür, was jede mitgelieferte Automatisierung und das Bundle GitHub-Issues lösen tatsächlich tun; [Automatisierungskonzepte](/de/platform/automations/concepts) ist das mentale Modell, falls du es noch nicht gelesen hast.
