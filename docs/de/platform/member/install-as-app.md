---
title: Als App installieren
description: Wie du Tale als Progressive Web App auf Desktop und Mobile installierst — die Menüverknüpfung in Chromium-Browsern, der iOS-Safari-Pfad und was sich ändert, sobald die App installiert ist.
---

Tale ist eine Progressive Web App. Die Installation legt ein Icon ins Dock oder auf den Homescreen, lässt Tale in einem eigenen Fenster ohne Browser-Beiwerk laufen und behält dieselbe Session, die du im Browser hattest. Es gibt keinen separaten nativen Build zum Herunterladen und keine Erweiterung zum Installieren — dieselbe URL, mit der du dich anmeldest, ist dieselbe App, in einer eigenständigen Hülle.

Diese Seite deckt die drei Stellen ab, an denen du die Installation auslöst: die Zeile **App installieren** im Profilmenü von Chromium-Browsern, den Teilen-Schritt in iOS Safari und das Installations-Banner, das Android Chrome von selbst zeigt. Einmal installiert, verhält sich Tale identisch; die Installation ändert nur das Beiwerk drumherum.

## Die Profilmenü-Verknüpfung

In Chrome, Edge, Brave, Arc und den anderen Chromium-Browsern führt Tales Profil-Dropdown eine Zeile **App installieren**, wenn der Browser bereit ist zu installieren. Öffne das Menü über deinen Avatar oben rechts, scroll am Themen-Wechsler und am Sprach-Wechsler vorbei und klick **App installieren**. Der Browser öffnet seine native Installations-Bestätigung; akzeptier sie, und Tale landet binnen ein, zwei Sekunden in deinem Dock (macOS), deiner Taskleiste (Windows) oder deiner App-Liste (ChromeOS).

Die Zeile ist nur da, wenn der Browser sein `beforeinstallprompt`-Event gefeuert hat und die App noch nicht installiert ist. Browser, die dieses Event nicht feuern — Firefox, Safari, alles im privaten Fenster — zeigen die Zeile nicht, also bleibt das Menü einen Eintrag kürzer, statt etwas zu versprechen, was es nicht liefern kann.

## iOS und iPadOS

iOS Safari feuert kein `beforeinstallprompt`, also erscheint die Zeile **App installieren** nicht im Menü. Der Installationspfad liegt stattdessen im Teilen-Sheet von Safari.

Öffne Tale in Safari, tipp auf das Teilen-Symbol in der Symbolleiste, scroll runter zu **Zum Home-Bildschirm**, und bestätige. Tale erscheint auf deinem Home-Bildschirm mit demselben Icon wie das Browser-Favicon. Tipp drauf, und Tale öffnet sich in einem eigenen Fenster — keine Safari-Adressleiste, keine Tab-Leiste, kein Zurück-Knopf außerhalb dessen, was Tale selbst zeigt. Benachrichtigungen funktionieren genauso wie im Browser-Tab; die Installation ist der einzige Unterschied.

Andere iOS-Browser — Chrome, Edge, Firefox auf iOS — sind unter der Haube Safari und haben keinen eigenen Zum-Home-Bildschirm-Eintrag. Der Safari-Pfad ist der einzige iOS-Installationspfad, der eine echte eigenständige App erzeugt.

## Android

Android Chrome regelt die Installation an zwei Stellen. Die erste ist dieselbe Zeile **App installieren** in Tales Profilmenü, identisch zum Desktop-Ablauf. Die zweite ist Chromes eigenes Installations-Banner — eine einzeilige Leiste, die von unten auf der Seite hochfährt, bei Sites, die der Browser für installierbar hält. Tipp **Installieren** im Banner, bestätige im System-Sheet, und Tale landet auf deinem Home-Bildschirm.

Wenn du das Banner einmal weggewischt hast, kommt es meist eine Weile nicht wieder. Die Profilmenü-Verknüpfung funktioniert unabhängig davon, ob das Banner gezeigt wurde oder nicht. Andere Android-Browser — Firefox, Samsung Internet, Brave — haben jeweils ihren eigenen Installationspfad im Browser-Menü, typischerweise beschriftet mit **App installieren** oder **Zum Home-Bildschirm**.

## Nach der Installation

Tale in einem PWA-Fenster ist dasselbe Tale wie in einem Browser-Tab. Die Session, die Chats, die Wissensdatenbank, die Agents — alles davon ist dieselbe Oberfläche. Die Unterschiede sind kosmetisch und klein: kein Browser-Beiwerk um das App-Fenster, ein Icon im Launcher, und auf den meisten Plattformen merkt sich das Fenster Größe und Position zwischen Starts.

Die Deinstallation folgt der Plattform-Konvention. Auf macOS zieh das Icon aus dem Dock; auf Windows rechtsklicke und deinstallier; auf iOS und Android halt das Icon gedrückt und entferne es. Die Deinstallation räumt die PWA-Hülle weg, aber nicht die Session — meld dich wieder über den Browser an, und deine Daten sind dort, wo du sie gelassen hast.

## Wann du dazu greifst

Die Installation lohnt sich, sobald du Tale jeden Tag öffnest und willst, dass es sich wie eine deiner Apps anfühlt statt wie einer deiner Tabs. Installier auch, wenn du das Chat-Fenster auf einem virtuellen Desktop oder in einem Stage-Manager-Slot fixieren willst, den Browser-Tabs nicht respektieren würden. Lass die Installation aus, wenn du dich von vielen Maschinen anmeldest und den Browser-Tab bevorzugst — Tale funktioniert so oder so gleich. Die benachbarte Lektüre ist [Mitglieds-Übersicht](/de/platform/member/overview) — sie ist die Karte dessen, was der Rest der Mitglieder-Oberfläche abdeckt, sobald Tale in deinem Dock sitzt.
