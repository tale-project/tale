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

Bei einer ganzen Website wird aus einer URL nur der Hostname verwendet. Ein eingefügter Pfad beschränkt den Crawl nicht auf diesen Pfad. Nutze dafür die URL-Liste. Eine `http://`-Adresse wird abgewiesen, weil der Crawler nur über HTTPS holt, und ein Punkt am Ende fällt weg. Schreibweisen mit und ohne `www` zählen als dieselbe Website; beide hinzuzufügen führt zu einer Duplikatmeldung.

Wähle das **Scan-Intervall** und **Speichern**. Standard sind sechs Stunden; die Auswahl reicht von einer Stunde bis zu dreißig Tagen. Der Scheduler übernimmt neue Quellen. Das Speichern bedeutet nicht, dass bereits alle Seiten abgerufen und indexiert wurden.

<Frame caption="Für eine ganze Website genügen Domain und Scan-Intervall. Für eine bestimmte Seitenauswahl nutze die URL-Liste.">

![Der Dialog Website hinzufügen zeigt Domain und Scan-Intervall mit sechs Stunden als Standard.](/images/platform/websites-add-dialog.webp)

</Frame>

## Eine URL-Liste gezielt halten

Eine URL-Liste ruft nur die angegebenen Adressen ab und folgt keinen weiteren Links. Sie darf Seiten mehrerer Websites enthalten. Tale fasst sie zu einer Quelle pro Website zusammen. Eine weitere Liste für eine vorhandene URL-Listenquelle ergänzt Adressen, ohne bestehende zu entfernen, und aktualisiert ihr Scan-Intervall.

Nutze vollständige öffentliche URLs. Verlinkte PDF- und moderne Office-Dateien lassen sich indexieren, wenn sie lesbaren Text enthalten. Bilder und Scans ohne extrahierbaren Text werden dadurch nicht durchsuchbar.

## Entdeckung und Aktualisierung verstehen

Bei einer ganzen Website nutzt der Crawler Startseite und veröffentlichte Sitemaps, einschließlich Sitemap-Indizes und in `robots.txt` angegebener Sitemaps. Fehlen brauchbare Sitemaps, folgt er Links innerhalb der Domain von der Startseite aus. Seiten, die weder in Sitemaps noch über erreichbare Links vorkommen, können fehlen. Nutze eine URL-Liste, wenn bestimmte Seiten enthalten sein müssen.

Scans arbeiten schrittweise: Unveränderte Inhalte werden übersprungen, geänderte erneut indexiert, neue Seiten hinzugefügt und entfernte aus dem Index genommen — ebenso Seiten, die die `robots.txt` inzwischen verbietet. Die Seitenzähler der Zeile folgen dem Scan, während Seiten landen, nach dem Entdecken und nach jedem gespeicherten Batch, die Tabelle bewegt sich also, während ein Scan läuft. Eine URL-Liste aktualisiert ihre feste Auswahl nach demselben Zeitplan. Nach erfolgreicher Indexierung ist keine gesonderte Veröffentlichung nötig.

Der Crawler besucht die Seiten ohne Anmeldung. Eine URL macht private Inhalte nicht zugänglich. Bei jeder Anfrage stellt er sich als `TaleBot/<version> (+https://docs.tale.dev/platform/knowledge/crawling)` vor, sodass eine `robots.txt`-Gruppe ihn beim Namen nennen kann — `User-agent: TaleBot` —, um allein ihn zu erlauben, zu drosseln oder abzuweisen.

Der Crawler hält sich an die `Disallow`-Regeln der `robots.txt` für den Agenten `*` auf jedem Weg, über den eine URL hereinkommen kann — die Sitemaps, der Linklauf und die Links, die eine gerenderte JavaScript-Seite preisgibt — und noch einmal vor jedem Abruf: Eine Seite, die eine Regel abdeckt, wird nie geholt, und eine Seite, die eine später hinzugekommene Regel abdeckt, verlässt den Index beim nächsten Scan. Ausdrücklich angegebene URLs filtern die Regeln nicht: Eine gelistete Adresse ist deine Anweisung. Liefert ein Abruf den HTTP-Header `X-Robots-Tag: noindex` oder `none` oder trägt die Seite ein HTML-Tag `<meta name="robots" content="noindex">`, wird der Inhalt nicht indexiert — auch bei einer URL-Liste —, und was ein früherer Scan von der Seite gespeichert hat, fällt weg. Diese Regeln sind Höflichkeit, kein Zugriffsschutz: Wenn du die Quellwebsite verwaltest, verlass dich nicht auf den Crawler als Zugangskontrolle.

Verwende HTTPS am Standardport. Adressen mit einem abweichenden Port wie `:8001` werden abgewiesen. Private Adressen und Weiterleitungen in private Netze sind gesperrt, sofern der Betreiber solche internen Quellen nicht ausdrücklich für seine Installation freigegeben hat.

## Die Crawl-Grenzen berücksichtigen

| Grenze | Auswirkung auf die Abdeckung |
| --- | --- |
| 10.000 erfasste URLs je Website | Bei größeren Websites können Seiten unentdeckt bleiben. Nutze eine gezielte URL-Liste für die benötigten Inhalte. |
| Drei Minuten für die Seitensuche, höchstens 50 Sitemap-Abrufe | Große oder langsame Sitemap-Sammlungen werden möglicherweise nicht vollständig erfasst. |
| 25 MiB und 30 Sekunden je Inhaltsabruf | Zu große Downloads und langsame Antworten schlagen fehl (`timeout` für das Download- und das 20-Sekunden-Darstellungsbudget); ebenso eine Seite hinter mehr als fünf Weiterleitungen (`redirect_limit_exceeded`). |
| Fünf Minuten Verarbeitungsbudget je Abschnitt, bis zu 200 Fortsetzungen | Lange Scans laufen abschnittsweise weiter. Ein bereits begonnener Abruf oder Darstellungsvorgang kann das Abschnittsbudget überschreiten; daraus ergibt sich keine garantierte Gesamtdauer. |
| Fünf aufeinanderfolgende Fehler bei einer automatisch entdeckten URL | Der Crawler plant diese URL nicht mehr ein. Ausdrücklich gelistete URLs werden bei jedem Scan erneut berücksichtigt, und eine gelistete Seite, die die Website mit 404 beantwortet, bleibt mit dieser Antwort in der Liste. |

Du kannst weder eine eigene Seitenobergrenze noch Pfadfilter festlegen oder einen laufenden Scan per Schaltfläche stoppen. Eine URL-Liste begrenzt die angefragte Auswahl; die genannten Grenzen gelten weiterhin.

## Die indexierten Inhalte prüfen

Die Tabelle zeigt **Status**, die Seitenzahl unter **Indexiert**, **Gescannt** und **Intervall**. Öffne die Quellzeile, um die Seitenliste, Wort- und Chunk-Anzahl sowie den letzten Abruf zu prüfen. Klappe eine Seite auf, um die gespeicherten Textabschnitte zu lesen. Bei einem fehlgeschlagenen Abruf stehen dort Ursache und Anzahl aufeinanderfolgender Fehler.

| Status | Bedeutung |
| --- | --- |
| **Wird gescannt** | Ein Scan läuft; eine gerade hinzugefügte Quelle beginnt hier. |
| **Aktiv** | Ein Scan ist erfolgreich abgeschlossen. Prüfe die einzelnen Seiten für die Abdeckung. |
| **Fehler** | Der Scan ist fehlgeschlagen oder nach den Abrufversuchen sind keine Inhalte gespeichert. Öffne die Quelle für die Ursache. |
| **Lösche…** | Die Quelle wird entfernt. |

Die Seitenansicht bietet auch eine Suche im indexierten Inhalt. Suche nach einer auffälligen Formulierung der Seite, bevor du dich im Chat darauf verlässt. Stelle anschließend eine konkrete Frage und prüfe den Quellenbeleg.

## Eine fehlende Seite untersuchen

Prüfe zuerst Adresse, Quelltyp und letzte Scan-Zeit. Öffne danach die Quelle und lies die Fehlermeldung der betroffenen Seite.

| Gemeldetes Problem | Prüfung oder Abhilfe |
| --- | --- |
| Zertifikat nicht vertrauenswürdig | Der Website-Betreiber muss ein abgelaufenes, selbst signiertes, zum falschen Host gehörendes oder anderweitig nicht vertrauenswürdiges TLS-Zertifikat korrigieren. Weitere Scans beheben es nicht. |
| Private Adresse, unzulässige Weiterleitung oder ungültige URL | Nutze die vorgesehene öffentliche HTTPS-Adresse. Frage bei Bedarf deinen Betreiber nach zugelassenen internen Quellen. |
| HTTP-Fehler, Netzwerkfehler oder Zeitüberschreitung | Öffne die Originalseite und prüfe ihre Erreichbarkeit. Nach der Reparatur kann ein späterer Scan wieder erfolgreich sein. |
| Antwort zu groß | Veröffentliche ein kleineres Dokument oder teile die Quelle auf. Die Abrufgrenze beträgt 25 MiB. |
| Quelle untersagt die Indexierung | Die Antwort enthält `X-Robots-Tag: noindex` oder `none`, oder die Seite trägt `<meta name="robots" content="noindex">`. Der Website-Verantwortliche muss diese Vorgabe ändern, bevor Tale den Inhalt indexieren kann. |
| Nicht unterstützter Inhalt oder kein lesbarer Text | JSON-/XML-Endpunkte, Binärdownloads, Bilder oder Scans liefern möglicherweise keinen verwertbaren Seitentext. Stelle eine HTML-Seite oder ein unterstütztes Dokument mit extrahierbarem Text bereit. |
| Darstellung oder Textextraktion fehlgeschlagen | Prüfe, ob die öffentliche Seite lädt und sich das Originaldokument öffnen lässt. Repariere oder exportiere eine beschädigte Quelle erneut. |

Ein späterer erfolgreicher Abruf entfernt den vorherigen Fehler. Nach einer fehlgeschlagenen Aktualisierung kann die früher indexierte Fassung weiterhin verfügbar sein: **Aktiv** und die Anzahl indexierter Seiten belegen nicht, dass jede Seite aktuell ist. Vergleiche gespeicherte Textabschnitte und Abrufdatum mit dem Original, bevor du dich auf eine kürzliche Änderung verlässt.

Zeigt die Quelle **Pausiert**, haben wiederholte Verbindungsfehler zur Wissensdatenbank die Scans angehalten. Lass einen Administrator die Verbindung unter **Einstellungen > Datenresidenz** korrigieren und wähle danach **Scans fortsetzen**.
