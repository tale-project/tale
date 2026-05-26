---
title: Tale als App installieren
description: Installiere Tale als Progressive Web App auf deinem Telefon oder Laptop. Die installierte Version läuft in einem eigenen Fenster, erscheint auf dem Startbildschirm oder im Dock und ist auf Mobilgeräten die empfohlene Variante.
---

Tale ist eine Progressive Web App, das heißt dein Browser kann Tale als eigenständige Anwendung installieren. Die installierte Version öffnet sich in einem eigenen Fenster ohne Adressleiste, lebt auf deinem Startbildschirm oder im Dock und fühlt sich auf dem Mobilgerät an wie eine native App — dieselbe untere Tab-Leiste, dieselben Sicherheitsbereich-Abstände, dieselben Gesten. Es gibt nichts aus einem App-Store herunterzuladen; die Installation ist nur ein Tipp oder Klick im Browser, mit dem du dich ohnehin bei Tale anmeldest.

Diese Seite zeigt dir, wie du Tale auf iOS, Android und dem Desktop installierst. Die Funktionen der installierten Version sind auf jeder Plattform identisch: Du bleibst angemeldet, alle Funktionen laufen, und Tale informiert dich mit einem kleinen Toast in der App, wenn eine neue Version bereit ist. Der Offline-Zugriff ist bewusst eingeschränkt — die Plattform benötigt eine aktive Verbindung zum Backend, und Tale zeigt dir bei Verbindungsverlust einen klaren Offline-Bildschirm und kehrt automatisch zurück, sobald du wieder online bist.

## Auf iPhone oder iPad installieren

Öffne `app.tale.dev` (oder deine selbstgehostete URL) in Safari — Apple erlaubt anderen iOS-Browsern nicht, Web-Apps zu installieren. Tippe auf den **Teilen**-Button in der Symbolleiste, scrolle nach unten und tippe auf **Zum Home-Bildschirm**. Bestätige den Namen und tippe auf **Hinzufügen**. Das Tale-Symbol erscheint auf deinem Startbildschirm, und durch Tippen startet Tale in einem eigenständigen Fenster ohne Safari-Adressleiste. Die Statusleiste passt sich deinem Theme an: hell bei hellem System-Modus, sonst dunkel.

Du bleibst über Starts hinweg angemeldet. Um die App zu entfernen, halte das Symbol gedrückt und wähle **App entfernen**, genauso wie bei jeder nativen App — dein Konto bleibt unverändert.

## Auf Android installieren

Öffne Tale in Chrome, Edge oder einem anderen Chromium-Browser und achte auf den Installations-Hinweis, der in der Adressleiste oder im Drei-Punkte-Menü erscheint. Wähle **App installieren** oder **Zum Startbildschirm hinzufügen**. Tale wird als eigener App-Eintrag installiert, abrufbar aus dem App-Launcher und der Liste der zuletzt verwendeten Apps. Benachrichtigungen werden heute nicht genutzt; die App ist komplett ein Vordergrund-Erlebnis.

Zum Deinstallieren halte das Tale-Symbol gedrückt und wähle **Deinstallieren**, oder entferne die App aus den System-App-Einstellungen.

## Auf dem Desktop installieren

Öffne Tale in Chrome, Edge, Brave oder Arc und klicke auf das Installations-Symbol am rechten Ende der Adressleiste (ein kleiner Monitor mit Pfeil nach unten). Der Browser fragt nach einer Bestätigung; klicke auf **Installieren**. Tale öffnet sich in einem eigenen Fenster ohne Browser-Elemente und erscheint im Dock (macOS), in der Taskleiste (Windows) oder in den Aktivitäten (Linux).

Firefox installiert Web-Apps derzeit nicht als eigenständige Fenster, aber Tale läuft uneingeschränkt in einem normalen Firefox-Tab. Safari auf macOS unterstützt die Installation über das **Ablage**-Menü (**Ablage → Zum Dock hinzufügen** in aktuellen Versionen).

## Was "installiert" dir bringt

Die installierte App lädt schneller als ein frischer Tab, weil die Offline-Hülle und Marken-Assets lokal vom Service-Worker zwischengespeichert werden. Tale ruft trotzdem für jede Aktion das Backend auf — es gibt keinen lokalen Datenspeicher — daher ist eine aktive Verbindung für jede sinnvolle Interaktion nötig. Die Vorteile sind Präsentation, nicht Offline-Fähigkeit:

- Ein eigenes Fenster und Symbol, ohne Browser-Elemente im Weg.
- Mobile Layouts mit einer unteren Tab-Leiste, die Plattform-Konventionen entspricht.
- Sicherheitsbereich-Abstände, damit Inhalte nicht unter den iOS-Notch oder die Android-Gesten-Leiste rutschen.
- Ein kleiner Toast, sobald eine neue Version bereit ist, mit einem Tipp zum Neuladen.

Wenn die Verbindung abreißt, zeigt Tale eine In-App-Überlagerung, die erklärt, dass die Plattform Internet braucht, und verbindet sich automatisch wieder, sobald du Empfang hast. Startest du die App ganz ohne Verbindung, siehst du den eigenständigen Offline-Bildschirm — weiterhin keine Funktion, aber eine klarere Botschaft als eine kaputte Seite.

## Aktualisierungen und Deinstallation

Aktualisierungen werden kontinuierlich ausgerollt. Wenn Tale eine neue Version veröffentlicht, holt die laufende App sie im Hintergrund; die nächste Interaktion löst einen Toast aus, der die Aktualisierung anbietet. Ein Tipp auf **Jetzt aktualisieren** lädt die App in der neuen Version neu, ohne komplette Neuinstallation. Ignorierst du den Toast, wird die neue Version beim nächsten vollständigen Schließen und Öffnen von Tale angewendet.

Zum Deinstallieren auf jeder Plattform entfernst du das Symbol oder den App-Eintrag wie bei jeder anderen Anwendung. Bei einer späteren Neuinstallation ist alles wieder da, weil deine Daten auf dem Server liegen — nichts an der Installation hängt an einem bestimmten Gerät.

Tale zu installieren ist eine der einfachsten Änderungen für deinen Arbeitsalltag. Die mobile Nutzung verbessert sich deutlich, sobald die Adressleiste weg ist, der Desktop hat einen Tab weniger zu verlieren, und der Update-Weg ist eingebaut. Wenn du mehr als ein paar Minuten am Tag in Tale verbringst, installiere es einmal und vergiss die URL.
