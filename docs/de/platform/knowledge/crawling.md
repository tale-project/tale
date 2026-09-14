---
title: Websites zum Wissen hinzufügen
description: Wähle öffentliche Seiten für die Indexierung, lege ein Intervall fest und untersuche fehlende oder veraltete Inhalte.
---

Füge eine Website hinzu, wenn dein Team Fragen zu öffentlichen, veränderlichen Inhalten stellen möchte. Tale ruft die ausgewählten Seiten ab und indexiert ihren lesbaren Text für die Wissenssuche. Zum Verwalten brauchst du Redakteurrechte oder höher. Seiten hinter einer Anmeldung benötigen einen anderen Importweg, etwa [Dokumente](/de/platform/knowledge/documents).

## Eine Website oder einzelne Seiten hinzufügen

Öffne **Wissen > Websites** und klicke auf **Website hinzufügen**. Wähle vor der Adresse den Quelltyp:

| Quelltyp | Wann er passt | Eingabe |
| --- | --- | --- |
| **Gesamte Website** | Du möchtest Inhalte innerhalb einer Domain entdecken lassen | Eine **Domain**, etwa `example.com` |
| **URL-Liste** | Du brauchst bestimmte Seiten oder öffentliche Dokumente | Eine Adresse pro Zeile unter **URLs** |

Bei einer ganzen Website wird aus einer URL nur der Hostname verwendet. Ein eingefügter Pfad beschränkt den Crawl nicht auf diesen Pfad. Nutze dafür die URL-Liste. Schreibweisen mit und ohne `www` zählen als dieselbe Website; beide hinzuzufügen führt zu einer Duplikatmeldung.

Wähle das **Scan-Intervall** und **Speichern**. Standard sind sechs Stunden; die Auswahl reicht von einer Stunde bis zu dreißig Tagen. Der Scheduler übernimmt neue Quellen. Das Speichern bedeutet nicht, dass bereits alle Seiten abgerufen und indexiert wurden.

<Frame caption="Für eine ganze Website genügen Domain und Scan-Intervall. Für eine bestimmte Seitenauswahl nutze die URL-Liste.">

![Der Dialog Website hinzufügen zeigt Domain und Scan-Intervall mit sechs Stunden als Standard.](/images/platform/websites-add-dialog.webp)

</Frame>

## Eine URL-Liste gezielt halten

Eine URL-Liste ruft nur die angegebenen Adressen ab und folgt keinen weiteren Links. Sie darf Seiten mehrerer Websites enthalten. Tale fasst sie zu einer Quelle pro Website zusammen. Eine weitere Liste für eine vorhandene URL-Listenquelle ergänzt Adressen, ohne bestehende zu entfernen, und aktualisiert ihr Scan-Intervall.

Nutze vollständige öffentliche URLs. Verlinkte PDF- und moderne Office-Dateien lassen sich indexieren, wenn sie lesbaren Text enthalten. Bilder und Scans ohne extrahierbaren Text werden dadurch nicht durchsuchbar.

## Entdeckung und Aktualisierung verstehen

Bei einer ganzen Website nutzt der Crawler Startseite und veröffentlichte Sitemaps, einschließlich Sitemap-Indizes und in `robots.txt` angegebener Sitemaps. Fehlen brauchbare Sitemaps, folgt er Links innerhalb der Domain von der Startseite aus. Seiten, die weder in Sitemaps noch über erreichbare Links vorkommen, können fehlen. Nutze eine URL-Liste, wenn bestimmte Seiten enthalten sein müssen.

Scans arbeiten schrittweise: Unveränderte Inhalte werden übersprungen, geänderte erneut indexiert, neue Seiten hinzugefügt und entfernte aus dem Index genommen. Eine URL-Liste aktualisiert ihre feste Auswahl nach demselben Zeitplan. Nach erfolgreicher Indexierung ist keine gesonderte Veröffentlichung nötig.

Der Crawler besucht die Seiten ohne Anmeldung. Es gibt weder ein Anmeldefeld noch eine Pfadliste zum Ein- oder Ausschließen für die ganze Website. Eine URL macht private Inhalte nicht zugänglich.

## Die indexierten Inhalte prüfen

Die Tabelle zeigt **Status**, **Indexiert**, **Gescannt** und **Intervall**. Bewege den Zeiger über den Prozentwert für abgerufene und gesamte Seitenzahl. Öffne die Quelle und **Seiten anzeigen**, um URLs, Wort- und Chunk-Anzahl sowie den letzten Abruf zu prüfen.

| Status | Bedeutung |
| --- | --- |
| **Inaktiv** | Wartet zwischen Scans. |
| **Wird gescannt** | Ein Scan läuft. |
| **Aktiv** | Ein Scan ist erfolgreich abgeschlossen. Prüfe die einzelnen Seiten für die Abdeckung. |
| **Fehler** | Der letzte Scan ist fehlgeschlagen. Untersuche die Ursache. |
| **Lösche…** | Die Quelle wird entfernt. |

Die Seitenansicht bietet auch eine Suche im indexierten Inhalt. Suche nach einer auffälligen Formulierung der Seite, bevor du dich im Chat darauf verlässt. Stelle anschließend eine konkrete Frage und prüfe den Quellenbeleg.

## Eine fehlende Seite untersuchen

Prüfe zuerst Adresse, Quelltyp und letzte Scan-Zeit. Bei einem Fehler zeigt die Zeile Ursache und aufeinanderfolgende Fehlversuche: HTTP-Fehler, blockierte private Adresse, Darstellungsfehler oder nicht unterstützte Textextraktion. Korrigiere die Quelle oder warte, bis die Website wieder erreichbar ist.

Eine URL-Listenseite wird bei späteren Scans erneut versucht, solange sie enthalten bleibt. Eine automatisch entdeckte Seite wird nach fünf fehlgeschlagenen Scans aufgegeben. Ein erfolgreicher Abruf entfernt den früheren Fehler. Läuft der Scan ohne Probleme, fehlt aber eine Information, vergleiche den indexierten Text mit dem Original. Ein erfolgreicher Scan garantiert nicht, dass jedes sichtbare Element als Text durchsuchbar ist.

Zeigt die Quelle **Pausiert**, haben wiederholte Verbindungsfehler zur Wissensdatenbank die Scans angehalten. Lass einen Administrator die Verbindung unter **Einstellungen > Datenresidenz** korrigieren und wähle danach **Scans fortsetzen**.
