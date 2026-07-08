---
title: Automatisierungen durchsuchen und installieren
description: Wie der Automatisierungen-Katalog funktioniert — das Seitenpanel, das eine Karte öffnet, der Installations-Assistent mit seiner Vorprüfung, das Neuinstallieren und Deinstallieren, und wie du alle mitgelieferten Automatisierungen auf einmal aktualisierst.
---

Der Automatisierungen-Katalog (**Automatisierungen** in der Seitenleiste) ist der Ort, an dem Inhaber, Admins und Entwickler jede Automatisierung durchsuchen, die der Organisation zur Verfügung steht, und entscheiden, welche installiert sind. Diese Seite deckt den Katalog selbst ab — das Seitenpanel, das eine Karte öffnet, den Installations-Assistenten und die Aktionen Neu installieren, Deinstallieren und Aktualisieren, die danach folgen. Was jede mitgelieferte Automatisierung tatsächlich tut, steht auf [Mitgelieferte Automatisierungen](/de/platform/automations/builtin); das mentale Modell für die Bestandteile, die eine Automatisierung bündelt, steht auf [Automatisierungskonzepte](/de/platform/automations/concepts).

## Eine Automatisierung installieren

Klick auf eine Karte, und ihr Seitenpanel öffnet sich — dasselbe Klick-zur-Vorschau-Muster, das [Einstellungen > Integrationen](/de/platform/integrations/overview) für seinen eigenen Katalog nutzt. Das Panel listet, was die Installation hinzufügt: seine Seiten, Workflows, Agents, Skills und die Integrationen, die es braucht, plus das Projekt, das es anvisiert, wenn es projektgebunden ist. Klick auf **Installieren**, und der Assistent öffnet sich.

Der Assistent geht nur die Schritte durch, die diese Automatisierung wirklich braucht: einen Schritt **Projekt**, wenn sie projektgebunden ist und du sie nicht schon von innerhalb eines Projekts geöffnet hast; einen Schritt **Änderungen prüfen**, wenn die Installation bereits vorhandene Dateien überschreiben würde; einen Schritt **Installieren**, der jede benötigte, noch nicht verbundene Integration verbindet; einen Schritt **Agent-Modus** für jeden Agent, der auf deinen eigenen Zugangsdaten statt denen der Plattform laufen kann; und einen Schritt **Fertig**. Jeder Einrichtungsschritt lässt sich überspringen — schliess ihn später über die eigene Checkliste **Einrichtung abschließen** der Automatisierung ab.

## Die Prüfung vor der Installation

Eine Automatisierung neu zu installieren oder erneut hochzuladen, wenn sie bereits einige ihrer Dateien geändert hat, löst vor jeder Änderung einen Schritt **Änderungen prüfen** aus. Für eine einzelne Automatisierung listet der Schritt jede Datei, die die Installation überschreiben würde, und bittet dich, das Ersetzen aller durch die Versionen der Automatisierung in einem Schritt zu bestätigen — ein Auswählen einzelner Dateien gibt es nicht. Die Installation eines **Bundles** prüft dagegen pro Mitglied-Automatisierung: Jedes Mitglied bekommt seinen eigenen einklappbaren Abschnitt und seine eigene Bestätigung, sodass du genau siehst, welche der mehreren Automatisierungen des Bundles Dateien berühren, die du geändert hast. So oder so: Die eigenen Schritte eines Workflows sind von dieser Prüfung ausgenommen — mehr dazu im nächsten Abschnitt.

## Neu installieren, deinstallieren und aktualisieren

Jede installierte Karte trägt ein **⋯**-Menü mit **Neu installieren** und **Deinstallieren**; das Menü einer noch nicht installierten Karte bietet stattdessen **Installieren**, plus **Löschen** für einen privaten Upload, den du noch nicht installiert hast. **Neu installieren** durchläuft dieselbe Vorprüfung wie eine frische Installation und behält deine Umgebungsvariablen und Secrets. **Deinstallieren** entfernt die Automatisierung und alles, was sie installiert hat — ihre Agents, Workflows, Seiten sowie deren Umgebungsvariablen und Secrets —, während jede Integration, die sie genutzt hat, für alles andere verbunden bleibt, das sie braucht.

Ein Neuinstallieren rührt den Workflow der Automatisierung nie an: Workflow-Schritte sind von der Aktualisierung ausgenommen, sodass alles, was du im Editor bearbeitet hast, jedes Neuinstallieren und jede Katalog-Aktualisierung übersteht. Um die neueste mitgelieferte Version eines Workflows zu holen, deinstallierst du die Automatisierung und installierst sie erneut — Tale wiederholt diesen Hinweis sowohl auf der Neuinstallations-Bestätigung als auch auf dem eigenen Tab **Konfiguration** der Automatisierung.

**Mitgelieferte Automatisierungen aktualisieren**, im selben Menü **Automatisierung hinzufügen** wie **Paket hochladen**, ist eine andere Aktion als die beiden vorigen: Sie gleicht jede mitgelieferte Automatisierung der Organisation in einem Durchgang gegen den mitgelieferten Katalog ab — auch die, die du bearbeitet hast —, statt eine Karte nach der anderen. Sie trägt dieselbe Workflow-Ausnahme und behält Secrets; die vorherige Version von allem, was sie ändert, landet im Verlauf der jeweiligen Automatisierung.

## Eine private Automatisierung hochladen

**Paket hochladen** im selben Menü fügt eine Automatisierung hinzu, die der Katalog nicht mitliefert — leg ein `.zip` ab, oder wähl einen Ordner mit einer `automation.json` in seinem Stammverzeichnis; der Ordner- oder Dateiname wird zum Slug der Automatisierung. Das Hochladen fügt sie nur dem privaten Katalog der Organisation hinzu; installiere sie danach wie jede andere Karte. Erneutes Hochladen über einen bereits vorhandenen Slug bittet dich, das Ersetzen zu bestätigen, bevor es das vorhandene Paket überschreibt.

## Wo das hineinpasst

Der Katalog ist die Eingangstür zu jeder Automatisierung, die die Organisation ausführen kann: Das Seitenpanel zeigt vorab, was eine Installation hinzufügt, der Assistent verbindet, was sie braucht, und Neuinstallieren, Deinstallieren und Aktualisieren halten sie aktuell, ohne einen Workflow anzurühren, an dem du gerade arbeitest. [Mitgelieferte Automatisierungen](/de/platform/automations/builtin) ist die nächste Lektüre dafür, was jede mitgelieferte Automatisierung und das Bundle GitHub-Issues lösen tatsächlich tun; [Automatisierungskonzepte](/de/platform/automations/concepts) ist das mentale Modell, falls du es noch nicht gelesen hast.
