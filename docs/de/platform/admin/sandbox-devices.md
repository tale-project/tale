---
title: Sandboxes auf eigenen Geräten ausführen
description: Verbinde einen Linux- oder macOS-Rechner mit Docker, damit die Sandboxes deiner Agenten und Automatisierungen darauf laufen.
---

Ein Gerät ist ein Rechner, den du mit deiner Organisation verbindest, damit ihre Sandboxes dort laufen statt auf dem Tale-Server: eine freie Workstation, ein Build-Server oder ein Mac, der Kapazität übrig hat. Inhaber und Admins fügen Geräte unter **Einstellungen > Sandboxes** hinzu und entfernen sie. Entwickler sehen die Liste.

## Prüfen, was der Rechner braucht

- Linux auf x86_64 oder arm64 oder macOS auf Apple Silicon oder Intel.
- Docker: Docker Engine unter Linux, unter macOS Docker Desktop, OrbStack oder Colima. Fehlt Docker, bietet die Tale CLI an, es zu installieren.
- Ausgehendes HTTPS zu deiner Tale-Seite. Das Gerät baut die Verbindung zu Tale selbst auf; nichts muss den Rechner von außen erreichen, deshalb funktioniert es auch hinter einem Router oder einer Firewall.
- Speicherplatz für die Sandbox-Images, einige Gigabyte, und für die Arbeitsbereiche, die es aufnehmen wird.

Standardmäßig führt ein Gerät je zwei CPUs und je 4 GiB Arbeitsspeicher, die Docker nutzen kann, eine Sandbox aus, höchstens 16 gleichzeitig, denn jede Agenten-Sandbox erhält 2 CPUs und 4 GiB. Beim Verbinden kannst du eine andere Zahl wählen.

<Warning>

Ein Gerät erledigt die Arbeit deiner Organisation. Die Arbeitsbereiche der Agenten, die Dateien, die sie verarbeiten, und die kurzlebigen Zugangsdaten einer Aufgabe laufen über diesen Rechner, und wer darauf Administratorrechte hat, kann sie lesen. Verbinde nur Rechner, die du kontrollierst und denen du so vertraust wie dem Tale-Server. Umgekehrt bestimmt die Tale-Seite, was auf dem Gerät läuft, auch die Updates, die es selbst installiert: Verbinde einen Rechner nur mit einer Tale-Seite, der du ihn anvertraust.

</Warning>

## Ein Gerät hinzufügen

<Steps>

<Step title="Befehl kopieren">

Öffne **Einstellungen > Sandboxes** und wähle im Bereich **Geräte** die Schaltfläche **Gerät hinzufügen**. Wähle unter **Installieren und verbinden** die Schaltfläche **Befehl kopieren**.

Der Befehl funktioniert einmal und nur innerhalb einer Stunde. Er enthält ein Einmal-Token, das der Rechner gegen eigene Zugangsdaten eintauscht.

</Step>

<Step title="Auf dem Rechner ausführen">

Füge den Befehl in ein Terminal auf dem Rechner ein und führe ihn aus. Er installiert die Tale CLI und verbindet den Rechner:

```text
Connecting this machine to https://your-org.tale.dev as "studio-mac"…
Starting the sandbox device (Tale 0.5.60). The first start downloads the sandbox images, which can take a few minutes…
```

Ist die Tale CLI auf dem Rechner schon installiert, führe den kürzeren Befehl unter **Tale CLI schon installiert? Führe stattdessen das aus** aus.

</Step>

<Step title="Prüfen, ob es online ist">

Sobald der Rechner Tale erreicht, zeigt der Dialog **studio-mac ist verbunden.**, und das Gerät erscheint in der Liste **Geräte** als **Online**. Wähle **Fertig**.

</Step>

</Steps>

Das Gerät läuft nach einem Neustart des Rechners weiter, sofern Docker mitstartet. Wird Tale aktualisiert, bringt sich das Gerät selbst auf dasselbe Release.

## Verstehen, wo Sandboxes laufen

Neue Arbeitsbereiche für Agenten und Automatisierungen starten auf einem verbundenen Gerät mit freiem Platz. Hat keines Platz, starten sie auf dem Tale-Server. Ein Arbeitsbereich bleibt mit seinen Dateien auf dem Rechner, auf dem er gestartet ist; ein Agent, der schon einen Arbeitsbereich auf dem Server hat, nutzt diesen also weiter. Seiten, die beim Crawlen von Websites gerendert werden, bleiben immer auf dem Server.

Sobald deine Organisation ein Gerät hat, zeigt die Liste **Arbeitsbereiche**, wo jeder Arbeitsbereich läuft: **Auf dem Server** oder auf einem Gerät mit dessen Namen. Solange ein Gerät offline ist, schlägt Arbeit, die einen seiner Arbeitsbereiche braucht, mit der Meldung fehl, dass das Gerät nicht verbunden ist. Starte sie erneut, sobald das Gerät wieder online ist; Arbeitsbereiche wechseln nie von selbst auf einen anderen Rechner.

Sandboxes auf einem Gerät erreichen das Internet über die eigene Verbindung des Rechners, und zwar über denselben Egress-Proxy wie auf dem Server. Der Proxy sperrt Adressen privater Netze, deshalb erreichen die Sandboxes keine anderen Rechner in deinem lokalen Netz.

Verbundene Geräte heben außerdem die Obergrenze für die [Arbeitslimits](/de/platform/admin/sandboxes#ein-arbeitslimit-aendern) deiner Organisation: Deren Summe darf die Kapazität der Bereitstellung plus die Sandboxes deiner Geräte nutzen.

## Die Geräteliste lesen

| Spalte | Was sie zeigt |
| --- | --- |
| **Gerät** | Der Name, mit dem sich der Rechner verbunden hat, und sein Betriebssystem. |
| **Status** | **Online**, **Wird aktualisiert**, **Update nötig**, **Update fehlgeschlagen** oder **Offline**. |
| **Sandboxes** | Die gerade laufenden Sandboxes und wie viele das Gerät gleichzeitig ausführt. |
| **Rechner** | CPUs und Arbeitsspeicher, die Docker auf dem Rechner nutzen kann. |
| **Version** | Das Tale-Release, mit dem das Gerät läuft. |
| **Zuletzt gesehen** | **Jetzt**, solange es verbunden ist, sonst der letzte Kontakt. |

Ein Gerät mit einem anderen Release als der Server übernimmt keine neuen Sandboxes, bis es aktualisiert ist. **Update nötig** heißt, dass sich das Gerät nicht selbst aktualisiert; **Update fehlgeschlagen** heißt, dass sein letztes automatisches Update nicht geklappt hat. Führe in beiden Fällen `tale sandbox update` auf dem Rechner aus.

## Ein Gerät vom Rechner aus betreuen

Führe diese Befehle auf dem Gerät selbst aus:

| Befehl | Was er tut |
| --- | --- |
| `tale sandbox status` | Zeigt die Verbindung, die Organisation, das Release und die gerade laufenden Sandboxes. |
| `tale sandbox logs --follow` | Verfolgt das Log des Geräts. |
| `tale sandbox update` | Bringt das Gerät sofort auf das Release des Servers, mit den aktuellen Adressen des Servers für seine Sandboxes. |
| `tale sandbox disconnect` | Entfernt das Gerät aus seiner Organisation, stoppt seine Sandboxes und löscht ihre Arbeitsbereiche vom Rechner. Mit `--keep-data` bleiben die Arbeitsbereiche erhalten. |

## Ein Gerät entfernen

Öffne in der Liste **Geräte** das Zeilenmenü des Geräts, wähle **Entfernen** und bestätige. Das Gerät führt ab sofort keine Sandboxes mehr für deine Organisation aus. Seine Arbeitsbereiche bleiben auf dem Rechner, sind von Tale aus aber nicht mehr erreichbar; ihre Agenten starten beim nächsten Lauf mit neuen Arbeitsbereichen.

Um auch den Rechner aufzuräumen, führe dort `tale sandbox disconnect` aus.

## Ein Gerät reparieren, das sich nicht verbindet

- **Der Befehl ist abgelaufen oder wurde schon verwendet.** Wähle erneut **Gerät hinzufügen**, um einen neuen Befehl zu erhalten.
- **Das Gerät ist gestartet, hat den Server aber noch nicht erreicht.** Führe auf dem Rechner `tale sandbox logs --follow` aus und prüfe, ob er HTTPS-Verbindungen zu deiner Tale-Seite aufbauen kann, auch über einen Proxy dazwischen.
- **Die Verbindung scheitert mit einem Zertifikatsfehler.** Der Rechner muss dem TLS-Zertifikat deiner Tale-Seite vertrauen. Eine Bereitstellung mit selbstsigniertem Zertifikat kann keine Geräte aufnehmen.
- **Gerät hinzufügen ist nicht verfügbar, und der Bereich sagt, dass der Sandbox-Dienst keine Geräte annimmt.** Die Bereitstellung läuft ohne ihren Geräte-Hub. Bei einer selbst gehosteten Bereitstellung schaltet ihn der Betreiber ein, wie unter [Sandbox-Geräte](/de/self-hosted/configuration/environment-reference#sandbox-devices) beschrieben.
