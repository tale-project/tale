---
title: Vorlagen für Automatisierungen
description: Sieh dir die Automatisierungen an, die Tale mitliefert, prüfe in der Vorschau, was eine tut und braucht, und mach sie mit ein paar Antworten zu deiner eigenen — als Entwurf oder gleich gestartet.
---

Eine neue Organisation beginnt ohne Automatisierungen. Alles, was Tale mitliefert — E-Mail-Synchronisierungen, das Sichten des Posteingangs, Issue-Synchronisierungen, Code-Reviews, Übersichten und Benachrichtigungen —, ist eine Vorlage in einem gemeinsamen Katalog. Du siehst dir eine Vorlage in der Vorschau an, beantwortest ein paar Fragen, etwa für welches Projekt sie arbeitet, welches Postfach sie liest oder wann sie läuft, und Tale legt daraus deine eigene Automatisierung an, die du wie jede andere änderst. Nur die Rollen Inhaber, Admin und Entwickler legen Automatisierungen an.

## Katalog durchsuchen

1. Öffne **Automatisierungen** und wähle **Automatisierung erstellen** › **Aus einer Vorlage**. Solange deine Organisation keine Automatisierung hat, öffnet **Vorlagen ansehen** in der leeren Liste denselben Katalog.
2. Grenze den Katalog mit den Kategorien ein — **Alle**, **Inbox**, **Issues**, **Code-Review**, **Aufgaben**, **Benachrichtigungen** und **Webhooks** — oder suche nach dem Namen.

Jede Karte zeigt das Produkt, mit dem die Vorlage arbeitet, was sie in einer Zeile tut und wann sie läuft. **Zuerst verbinden** kennzeichnet eine Vorlage, die einen Connector braucht, den deine Organisation noch nicht verbunden hat. **Im Einsatz** sagt, dass du schon eine Automatisierung aus ihr angelegt hast, und wie viele.

![Der Dialog Templates mit seinen Kategorien von All bis Webhooks, der Suche und einem Raster von Vorlagenkarten, jede mit dem Logo ihres Produkts, ihrem Namen, wann sie läuft, und einer Zeile; einige Karten zeigen Connect first oder In use.](/images/platform/automation-template-catalog.webp)

## Vorlage ansehen

Wähle eine Karte, um ihre Vorschau zu öffnen.

| Teil | Was er zeigt |
| --- | --- |
| **So funktioniert es** | Ihre Schritte der Reihe nach, in einfachen Worten. |
| **Was sie ändert** | Was sie anlegt, ändert oder sendet — und was sie nie tut. |
| **Wann sie läuft** | Den Zeitplan, das Plattformereignis oder den Webhook, der sie startet. |
| **Was sie braucht** | Die Connectors, die sie nutzt, und ob sie verbunden sind. **Verbinden** öffnet **Einstellungen** › **Connectors**. Eine Vorlage, die nur mit dem arbeitet, was eine andere hereinholt, etwa eine Zusammenfassung der Inbox, die eine E-Mail-Synchronisierung füllt, verweist stattdessen auf **Passt zu**. |
| **Passt zu** | Vorlagen, die neben ihr laufen sollen, etwa die E-Mail-Synchronisierung, die die Inbox füllt, die eine Sichtung liest. |
| **Ablauf** | Ihre Schritte so, wie der Editor sie zeigen wird, nur zum Lesen. |

![Die Vorschau von Triage the Gmail inbox: was sie tut, ihre Markierungen Inbox und In use, How it works in vier nummerierten Schritten, What it changes, When it runs alle 6 Stunden in deiner Zeitzone, What it needs mit Gmail als nicht verbunden und einem Link Connect, Works with Sync Gmail emails und ihr Ablauf, nur zum Lesen gezeichnet von Start bis zum Schritt Inbox, über Use this template.](/images/platform/automation-template-preview.webp)

## Vorlage verwenden

1. Wähle in der Vorschau **Vorlage verwenden**.
2. Beantworte ihre Fragen. **Name** beginnt mit dem Namen der Vorlage; ändere ihn, um deine Automatisierungen auseinanderzuhalten. Eine Frage nach Zugangsdaten bietet die an, die für ihren Connector in Betrieb sind; ist sie freiwillig, sagt ihre erste Wahl, was es heißt, sie leer zu lassen, etwa die Standardverbindung. Ein Zeitplan beginnt in deiner eigenen Zeitzone, und du kannst eine andere wählen.
3. Lass **Jetzt starten** eingeschaltet, um Version 1 live zu schalten und ihren Trigger im selben Schritt einzuschalten. Ausgeschaltet wird die Automatisierung als Entwurf mit ausgeschaltetem Trigger angelegt, den du im [Editor](/de/platform/automations/editor) live schaltest. **Jetzt starten** steht nicht zur Verfügung, solange ein Connector, den die Vorlage braucht, nicht verbunden ist. Verlangt eine Frage Zugangsdaten dieses Connectors, gibt es noch nichts zu wählen: Verbinde ihn zuerst und lege die Automatisierung dann an.
4. Wähle **Automatisierung erstellen**. Die neue Automatisierung öffnet sich.

![Die Fragen von Tell the reviewer: ihr Name, das Projekt Website relaunch, die Reviewerin Priya Raman, die Nachricht und Start it now angehakt, über Create automation.](/images/platform/automation-template-setup.webp)

Das Anlegen ist ein einziger Schritt: Wird irgendetwas abgelehnt, entsteht nichts, und nichts ist halb gestartet. Kann Tale eine Antwort nicht verwenden — ein Projekt, das du nicht öffnen kannst, jemand, der kein Mitglied der Organisation ist, Zugangsdaten, die nicht in Betrieb sind, eine Zahl außerhalb dessen, was die Frage zulässt —, sagt die Frage, warum. Auch einen Namen, den schon eine andere Automatisierung trägt, lehnt Tale ab; wähle dann einen anderen.

In der Liste **Automatisierungen** eines Projekts ist bei einer Vorlage, die für ein Projekt arbeitet, dieses Projekt schon gewählt, und die neue Automatisierung öffnet sich im Projekt.

Eine Vorlage, die ein Webhook startet, zeigt ihre Adresse einmal, direkt nachdem die Automatisierung angelegt wurde. Kopiere sie, bevor du **Automatisierung öffnen** wählst: Tale behält nur einen Hash ihres Tokens, deshalb lässt sich eine verlorene Adresse nur mit **Token rotieren** ersetzen, wie [Einen Webhook empfangen](/de/platform/automations/triggers#einen-webhook-empfangen) erklärt.

Eine Vorlage nennt ein Modell für ihre Sprachmodell-Schritte. Bedient keiner deiner Anbieter dieses Modell, bekommt jeder solche Schritt ein vergleichbares Modell, das sie bedienen, und die Nachricht von Version 1 sagt, welches. Hat deine Organisation gar keinen Anbieter, behalten die Schritte das Modell der Vorlage, und die Validierung warnt beim Speichern davor: Wähle mit **Modell wechseln** ein bedientes Modell, das es in allen Schritten auf einmal ersetzt.

Eine Organisation, die vor den Vorlagen angelegt wurde, hat womöglich noch die E-Mail-, GitHub- und GlitchTip-Automatisierungen, die eine frühere Version installiert hat. Sie bleiben, wie sie sind, und der Katalog zählt jede, deren Vorlage es noch gibt, als **Im Einsatz**. Die Issue-Importe für GitHub und GlitchTip einer früheren Version haben keine Vorlage mehr: An ihre Stelle treten [GitHub-Issues synchronisieren](#github-sync-issues) und [GlitchTip-Issues synchronisieren](#glitchtip-sync-issues), und ein Import, den du schon hast, zählt für keine der beiden.

## Inbox

Die E-Mail-Synchronisierungen füllen die gemeinsame **Inbox**, die die Vorlagen dieser Kategorie lesen. Schaltest du eine E-Mail-Synchronisierung live, bekommt [Start](/de/platform#home) die Ansicht **Inbox**, und das Formular zum Verfassen bietet ihr Postfach an. Bis eine live ist, hat **Start** keine Ansicht **Inbox**, und ein Link zur Inbox zeigt stattdessen einen Hinweis zur Einrichtung: Inhabern, Admins und Entwicklern öffnet er diesen Katalog auf dem Tab **Inbox**; alle anderen erfahren, dass jemand mit einer dieser Rollen eine E-Mail-Automatisierung live schalten muss.

### Gmail-E-Mails synchronisieren {#gmail-sync-emails}

Holt die E-Mails deiner verbundenen Gmail-Postfächer in die **Inbox**, anfangs alle fünf Minuten. Sie liest den Posteingang jedes Postfachs und, solange du es nicht abschaltest, auch den Ordner „Gesendet“. So enthält ein Verlauf, was die Kundschaft geschrieben und was du direkt aus Gmail geantwortet hast. Sie braucht den Gmail-Connector.

| Frage | Was sie festlegt |
| --- | --- |
| **Wann** | Wie oft ein Durchlauf läuft, in deiner Zeitzone. Anfangs alle fünf Minuten. |
| **Postfach** | Welches verbundene Gmail-Postfach sie liest. **Alle verbundenen Gmail-Postfächer**, die erste Wahl, liest jedes ab da, wo es aufgehört hat; der Name einer Verbindung liest nur dieses Postfach. |
| **Tage zurück** | Wie weit der erste Durchlauf eines Postfachs zurückreicht, 0 bis 90 Tage; anfangs 7. Mit 0 liest sie nur E-Mails, die ab dann ankommen. Ältere E-Mails liest sie nie. |
| **Auch Gesendet lesen** | Ob sie auch den Ordner „Gesendet“ liest. Anfangs eingeschaltet. |
| **E-Mails pro Durchlauf** | Höchstens so viele E-Mails liest ein Durchlauf aus jedem Postfach, 10 bis 100; anfangs 50. |

Jeder Durchlauf macht dort weiter, wo der letzte aufgehört hat, und liest die älteste E-Mail zuerst, Gesendet und Posteingang in der Reihenfolge, in der die E-Mails geschrieben wurden. Deine eigene Nachricht landet also vor der Antwort darauf. Was über einen Durchlauf hinausgeht, beim ersten Durchlauf eines Postfachs oder nach einer Pause, lesen die folgenden Durchläufe, und keine E-Mail wird übersprungen oder doppelt gespeichert. Ihren Stand hält die Synchronisierung an dem Zeitpunkt fest, zu dem Gmail eine E-Mail empfangen hat, nie an dem Datum, das der Absender angibt: Eine falsch gehende Uhr beim Absender lässt sie keine E-Mail überspringen. Eine E-Mail, die du aus der **Inbox** sendest, wird einmal gespeichert, auch wenn ein Durchlauf sie unter Gesendet noch einmal liest.

Bittet Gmail darum, langsamer zu werden, hält der Durchlauf an, behält, was er gelesen hat, und der nächste macht weiter; der Lauf gilt trotzdem als erfolgreich. Eine E-Mail, die gelöscht oder verschoben wurde, nachdem ein Durchlauf sie aufgelistet hat, wird übersprungen. Lässt sich ein Postfach nicht lesen, etwa weil seine Verbindung abgelaufen ist, liest sie die anderen trotzdem und nennt im Lauf das Postfach, das fehlgeschlagen ist. Nur wenn jedes Postfach fehlschlägt, schlägt der Lauf fehl, damit die Fehlerhinweise der Automatisierung verschickt werden.

Die Ausgabe des Laufs listet unter `mailboxes` für jedes Postfach, was der Durchlauf getan hat:

| Feld | Was es sagt |
| --- | --- |
| `listed` | E-Mails, die nach der Stelle ankamen, an der der Durchlauf begann. |
| `fetched` | E-Mails, die er gelesen hat. |
| `ingested` | E-Mails, die zum ersten Mal gespeichert wurden. |
| `duplicates` | E-Mails, die er erneut gelesen hat und die schon gespeichert waren. |
| `skipped` | E-Mails, die sich nicht speichern lassen: ohne Message-ID oder ohne jemanden, dem sie sich zuordnen lassen. |
| `vanished` | E-Mails, die gelöscht oder verschoben wurden, bevor der Durchlauf sie lesen konnte. |
| `capped` | `true`, wenn mehr E-Mails warten, als ein Durchlauf liest. Der nächste Durchlauf macht weiter. |
| `rateLimited`, `retryAfter` | Gmail hat gebeten, langsamer zu werden, und wann es den nächsten Versuch zulässt, sofern es das gesagt hat. |
| `error` | Warum der Durchlauf früher anhielt. |
| `resumeFrom` | Wo der nächste Durchlauf beginnt, je Ordner. |

Die eigenen E-Mails des Postfachs unterscheidet die Synchronisierung von denen der Kundschaft an der Adresse des Postfachs, die der erste Durchlauf aus dem verbundenen Konto erfährt und an der Verbindung als Absenderadresse festhält. Anhänge werden mit ihrer Nachricht gespeichert, deshalb öffnest und lädst du sie in der Konversation. Gmail gibt jeden Anhang nur bis 3,5 MB heraus: Ein größerer erscheint weiterhin mit Name und Größe, aber du öffnest ihn in Gmail.

Die Synchronisierung liest nur. Sie sendet, löscht, verschiebt oder markiert nie eine E-Mail in Gmail, und was nach dem Lesen mit einer E-Mail in Gmail geschieht, etwa dass sie als gelesen markiert oder gelöscht wird, erreicht die **Inbox** nicht. Eine E-Mail, die erst in den Gmail-Posteingang verschoben wird, nachdem die Synchronisierung den Zeitpunkt ihres ersten Eingangs hinter sich gelassen hat, liest sie nicht.

Öffne nach dem ersten Live-Lauf sein [Ausführungsprotokoll](/de/platform/automations/execution-logs) und prüfe, ob die erwarteten Nachrichten in der Ansicht **Inbox** auf **Start** erscheinen.

### Outlook-E-Mails synchronisieren {#outlook-sync-emails}

Arbeitet wie [Gmail-E-Mails synchronisieren](#gmail-sync-emails) für verbundene Outlook-Postfächer, mit denselben Fragen, anfangs alle fünf Minuten. Sie braucht den Outlook-Connector. Ihren Stand hält sie an dem Zeitpunkt fest, zu dem Exchange eine E-Mail empfangen hat, für den Ordner „Gesendete Elemente“ an dem, zu dem sie gesendet wurde. Bittet Outlook darum, langsamer zu werden, nennt der Lauf die Wartezeit, die Outlook angibt. Anhänge werden mit ihrer Nachricht gespeichert.

### E-Mails über SMTP/IMAP synchronisieren {#imap-smtp-sync-emails}

Arbeitet wie [Gmail-E-Mails synchronisieren](#gmail-sync-emails) für Postfächer, die über IMAP und SMTP verbunden sind, mit denselben Fragen, anfangs alle fünf Minuten. Sie braucht den IMAP/SMTP-Connector. Ihren Stand hält sie an dem Zeitpunkt fest, zu dem der Mailserver eine E-Mail angenommen hat, und die Adresse des Postfachs nimmt sie aus der Anmeldung. Gesendete E-Mails liest sie aus dem Ordner, den der Server als Gesendet kennzeichnet, sonst aus dem, den die Verbindung nennt. Bricht der Server die Verbindung während eines Durchlaufs ab, behält der Durchlauf, was er gelesen hat, und der nächste macht weiter; war es das einzige Postfach, schlägt der Lauf fehl.

### Gmail-Posteingang sichten {#gmail-triage-inbox}

Arbeitet auf der **Inbox**, die [Gmail-E-Mails synchronisieren](#gmail-sync-emails) füllt, anfangs alle sechs Stunden in deiner Zeitzone. Jeder Lauf liest die offenen Gmail-Konversationen, deren neueste Nachricht von der Kundschaft stammt und die seit dieser Nachricht kein früherer Durchlauf beurteilt hat — bis zu **Konversationen pro Lauf** (anfangs 20, höchstens 40); die übrigen warten auf den nächsten Lauf. Das Modell entscheidet für jeden Thread, ob eine Person antworten muss und wie dringend es ist.

Was ein Lauf ändert:

- Wo eine Antwort fällig ist, entwirft ein zweiter Modellaufruf eine und legt sie als **Antwortvorschlag** an den Thread: eine Karte über dem Editor, getrennt von allem, was eine Person getippt hat. **In den Editor übernehmen** gibt den Text zum Anpassen und Senden in den Editor; **Verwerfen** lässt ihn fallen, und der Thread bekommt erst wieder einen Vorschlag, wenn die Kundschaft erneut schreibt. Ein Thread, der schon einen Vorschlag trägt, behält ihn, sodass ein Thread nie zwei hat.
- Die **Priorität** des Threads wird auf das Urteil des Modells gesetzt, aber nur, wenn noch niemand eine gesetzt hat. Eine Priorität, die eine Person gewählt hat, bleibt.
- Zuletzt wird das Urteil mit seiner Begründung an jedem Thread festgehalten, damit der nächste Lauf den Thread erst wieder ansieht, wenn die Kundschaft erneut schreibt. Ein Thread, an dem kein Antwortvorschlag abgelegt werden konnte — er wurde inzwischen geschlossen, oder sein Entwurf scheiterte —, wird nicht markiert, und der nächste Lauf versucht ihn erneut; die übrigen Threads werden trotzdem bearbeitet. Konnte kein einziger Antwortvorschlag abgelegt werden, scheitert der Lauf und markiert nichts.

Die Automatisierung sendet nichts. Die Ausgabe des Laufs listet, was gelesen wurde, die Zusammenfassung des Modells, die Threads, die eine Antwort brauchen, mit ihren Links in die Inbox, die hinterlassenen Vorschläge und die Threads, die sie für den nächsten Lauf liegen ließ (`unstamped`). Ein Lauf, bei dem nichts wartet, ruft kein Modell auf.

### Outlook-Posteingang sichten {#outlook-triage-inbox}

Arbeitet wie [Gmail-Posteingang sichten](#gmail-triage-inbox) auf den Outlook-Konversationen, die [Outlook-E-Mails synchronisieren](#outlook-sync-emails) hereinholt.

### IMAP-Posteingang sichten {#imap-smtp-triage-inbox}

Arbeitet wie [Gmail-Posteingang sichten](#gmail-triage-inbox) auf den Konversationen, die [E-Mails über SMTP/IMAP synchronisieren](#imap-smtp-sync-emails) hereinholt.

### Posteingang zusammenfassen {#inbox-summary}

Fasst nach ihrem Zeitplan — anfangs werktags um 08:00 in deiner Zeitzone, solange du ihn nicht änderst — die Konversationen des gewählten Postfachs, die noch auf eine Antwort warten, in je einer Zeile zusammen, die dringendste zuerst, und schickt die Zusammenfassung mit einem Link zur Inbox an das gewählte Mitglied. Ein leerer Posteingang sendet nichts. Sie liest die Inbox, die eine E-Mail-Synchronisierung füllt, und ändert keine Konversation.

## Issues

Die Issue-Vorlagen lesen die Quelle und schreiben Tale-Aufgaben. Sie kommentieren, schließen oder ändern das Issue, den Pull Request oder die Warnung an der Quelle nie und starten keinen Agent.

### GitHub-Issues synchronisieren {#github-sync-issues}

Hält die Aufgaben eines Projekts mit den offenen Issues eines GitHub-Repositorys auf dem gleichen Stand, mit jedem Lauf einen Stapel weiter, anfangs alle 15 Minuten. Sie braucht den GitHub-Connector mit Lesezugriff auf die Issues des Repositorys.

Jeder Lauf liest den nächsten Stapel offener Issues ab der Stelle, an der der letzte Lauf aufgehört hat, die ältesten zuerst, bis zu **Neue Issues pro Lauf** (anfangs 100, 1–500), und legt für jedes Issue, das das Projekt noch nicht hat, eine Aufgabe im **Backlog** an. Ein großes Repository kommt so über mehrere Läufe an; nach dem letzten Issue beginnt der nächste Lauf wieder beim ersten, und ein Issue, das das Projekt schon hat, wird aktualisiert, nie doppelt angelegt. **Nur Issues mit diesen Labels** grenzt ein, was gelesen wird: Bei mehreren Labels braucht ein Issue alle. Pull Requests bleiben außen vor; die liest [GitHub-Pull-Requests synchronisieren](#github-sync-pull-requests).

Jeder Lauf liest außerdem bis zu 50 früher importierte Issues erneut, die am längsten nicht geprüften zuerst, auch geschlossene und solche, die nicht mehr zu den Labels passen, und aktualisiert die Quellenkarte der Aufgabe: den Titel, die Beschreibung und ob das Issue offen oder geschlossen ist. Titel, Beschreibung, Status, Zuständigkeit und Priorität der Aufgabe selbst bleiben in Tale, wie sie sind, und eine Aufgabe bleibt, wo sie ist, wenn ihr Issue auf GitHub geschlossen wird. Ein Issue, das GitHub nicht mehr zeigt, behält seine zuletzt bekannten Angaben und wird als nicht verfügbar markiert. Beim Import kürzt Tale einen Titel über 200 UTF-16-Codeeinheiten oder eine Beschreibung über 20.000 (die meisten Emojis zählen doppelt) auf der Aufgabe auf diese Länge und beendet sie mit „…“; die Quellenkarte und das Issue behalten den vollen Text.

Die Ausgabe eines Laufs ist ein Beleg für das Repository: was er gelesen, angelegt, aktualisiert und übersprungen hat, und ob er das Ende der offenen Issues erreicht hat. Ein Issue, das GitHub nicht zeigen will, wird übersprungen und später erneut versucht. Begrenzt GitHub die Synchronisierung mit einem Rate-Limit, behält der Lauf, was er geschafft hat, und die nächsten Läufe lassen GitHub bis zu dem Zeitpunkt in Ruhe, den GitHub genannt hat. Ein Lauf scheitert nur, wenn das Repository gar nicht gelesen werden konnte; so zählt der Zeitplan eine kaputte Synchronisierung, nicht ein ausgelastetes GitHub. Wähle **GitHub-Zugangsdaten**, wenn deine Organisation mehrere hat; leer nimmt die Standard-Zugangsdaten. Ändern sich die Labels, beginnt der nächste Lauf beim ersten passenden Issue. Wie du mehrere Repositorys in einer Automatisierung synchronisierst, steht unter [Issues nach Zeitplan synchronisieren](/de/platform/automations/triggers#issues-nach-zeitplan-synchronisieren).

### GlitchTip-Issues synchronisieren {#glitchtip-sync-issues}

Hält die Aufgaben eines Projekts mit den ungelösten Issues eines GlitchTip-Projekts auf dem gleichen Stand, mit jedem Lauf einen Stapel weiter, so wie [GitHub-Issues synchronisieren](#github-sync-issues) es für ein Repository tut. Sie braucht den GlitchTip-Connector mit der URL der Instanz und einem Token mit `project:read` und `event:read`; ein Token, das nur Projekte anlegen darf, kann keine Issues lesen. Eine selbst betriebene Instanz muss die Connector-Host-Richtlinie der Installation erlauben.

Jeder Lauf liest den nächsten Stapel, die zuerst gesehenen zuerst, und **Suche** grenzt ihn in der Suchsyntax von GlitchTip ein; leer liest sie alle ungelösten Issues. Jeder Lauf liest außerdem bis zu 50 früher importierte Issues erneut und aktualisiert die Quellenkarte der Aufgabe: den Titel, die Details und ob das Issue ungelöst, gelöst oder ignoriert ist. Eine Aufgabe bleibt, wo sie ist, wenn ihr Issue gelöst wird. **GlitchTip-Zugangsdaten** nennt Instanz und Token, mit denen gelesen wird; leer nimmt die Standard-Zugangsdaten. Ändert sich die Suche, beginnt der nächste Lauf beim ersten passenden Issue.

### GitHub-Pull-Requests synchronisieren {#github-sync-pull-requests}

Hält die Aufgaben eines Projekts mit den offenen Pull Requests eines GitHub-Repositorys auf dem gleichen Stand, mit jedem Lauf einen Stapel weiter, so wie [GitHub-Issues synchronisieren](#github-sync-issues) es für seine Issues tut. **Nur Pull Requests von** beschränkt sie auf die Pull Requests eines Kontos: `renovate[bot]` für die Abhängigkeits-Updates von Renovate, `dependabot[bot]` für die von Dependabot; leer liest die von allen. **Nur Pull Requests mit diesen Labels** grenzt weiter ein, und ein Pull Request braucht jedes genannte Label. **Neue Pull Requests pro Lauf** legt den Stapel fest (anfangs 100, 1–500). Ihre Aufgaben und ihre Stelle im Repository gehören ihr allein, sodass sie neben **GitHub-Issues synchronisieren** für dasselbe Repository und Projekt laufen kann, ohne dass eine die Aufgaben der anderen anfasst. Die Quellenkarte einer Aufgabe zeigt, ob der Pull Request offen oder geschlossen ist; ein gemergter Pull Request gilt als geschlossen.

### GitHub-Sicherheitswarnungen synchronisieren {#github-sync-security-alerts}

Hält die Aufgaben eines Projekts mit den offenen Sicherheitswarnungen eines GitHub-Repositorys auf dem gleichen Stand: eine Aufgabe pro Warnung, anfangs stündlich. Unter **Warnungen** wählst du die Art: Code Scanning, Dependabot oder Secret Scanning. **Ab Schweregrad** liest nur Warnungen ab diesem Grad, auf einer Skala für alle drei Arten: kritisch, hoch, mittel oder jede Warnung. Eine Code-Scanning-Warnung, die keine Sicherheitswarnung ist, zählt mit `error` als hoch, mit `warning` als mittel und mit `note` als niedrig; ein Geheimnis zählt immer als kritisch. **Nur diese Code-Scanning-Werkzeuge** liest die Warnungen der Werkzeuge, die du so nennst, wie GitHub sie zeigt, etwa `CodeQL` oder `Trivy`; leer liest die aller Werkzeuge.

GitHub grenzt jede Liste selbst ein, sodass ein Repository mit Tausenden offener Warnungen eines Scanners nur so weit gelesen wird, wie die Filter reichen: Mit dem Grad hoch und den Werkzeugen, um die du dich kümmerst, kommen nur Warnungen aufs Board, die eine Aufgabe wert sind. Jeder Lauf liest bis zu 100 neue Warnungen und bis zu 50 früher importierte erneut, und die Quellenkarte zeigt eine Warnung als offen, behoben (korrigiert oder ein widerrufenes Geheimnis) oder ignoriert (verworfen). Eine Aufgabe zeigt nie den Wert eines Geheimnisses: Die Synchronisierung bittet GitHub, ihn wegzulassen, und nennt nur die Art des Geheimnisses und wo es gefunden wurde. Die GitHub-Zugangsdaten brauchen Lesezugriff auf die Code-Scanning-, Dependabot- oder Secret-Scanning-Warnungen des Repositorys, je nachdem, was du synchronisierst. Um mehrere Arten in einer Automatisierung zu lesen, nenne sie im Schritt unter `alerts`.

### Forgejo-Issues synchronisieren {#forgejo-sync-issues}

Hält die Aufgaben eines Projekts mit den offenen Issues oder den offenen Pull Requests eines Repositorys auf einer Forgejo-Instanz auf dem gleichen Stand, etwa auf Codeberg oder deiner eigenen, mit jedem Lauf einen Stapel weiter, so wie [GitHub-Issues synchronisieren](#github-sync-issues) es auf GitHub tut. Sie braucht den Forgejo-Connector mit der URL der Instanz und einem Zugangstoken, das das Repository und seine Issues lesen darf; eine selbst betriebene Instanz muss die Connector-Host-Richtlinie der Installation erlauben. **Synchronisieren** legt fest, ob sie Issues oder Pull Requests liest, **Nur Einträge von** beschränkt sie auf die einer Person, etwa `renovate`, und **Nur Einträge mit diesen Labels** auf Einträge mit allen genannten Labels, wie auf GitHub. **Forgejo-Zugangsdaten** nennt Instanz und Token, mit denen gelesen wird; leer nutzt die Standard-Zugangsdaten. Jeder Lauf liest bis zu 100 neue Einträge und bis zu 50 früher importierte erneut.

Jede Aufgabe verlinkt den Eintrag auf der Instanz, die ihre Zugangsdaten nennen. Dasselbe Repository auf zwei Instanzen ergibt zwei Gruppen von Aufgaben, und eine Aufgabe wird nur über Zugangsdaten für ihre eigene Instanz erneut gelesen.

### GitHub-Issues sichten {#github-triage-issues}

Liest anfangs jeden Morgen um 07:00 in deiner Zeitzone die offenen Issues des genannten Repositorys, die sich seit ihrem letzten erfolgreichen Lauf geändert haben, bewertet, ob jedes umsetzbar ist und wie dringend, und schickt dem gewählten Mitglied eine Nachricht mit den umsetzbaren, die dringendsten zuerst, jedes mit seiner Begründung und einem Link zu den Issues des Repositorys. Sie schreibt nichts nach GitHub und legt keine Aufgaben an. Sie braucht den GitHub-Connector mit Lesezugriff auf die Issues des Repositorys.

Ihr erster Lauf sieht sich die zuletzt geänderten Issues an. Danach macht jeder Lauf dort weiter, wo der letzte Lauf für dieses Repository aufgehört hat, die älteste Änderung zuerst, bis zu **Issues pro Lauf** (anfangs 20, höchstens 40); die übrigen warten auf den nächsten Lauf. Ein Issue wird erst wieder bewertet, wenn es sich ändert — ein neuer Kommentar, ein neues Label, ein geänderter Text. Ein Lauf, der scheitert, merkt sich keine Stelle, sodass seine Issues im nächsten Lauf wiederkommen, und ein Lauf für ein anderes Repository lässt die Stelle dieses Repositorys, wie sie ist. Ein Issue, das das Modell nicht bewerten konnte, wird in der Nachricht genannt und erst wieder bewertet, wenn es sich ändert. Pull Requests bleiben außen vor.

Die Ausgabe des Laufs listet, was bewertet wurde, die umsetzbaren Issues mit Priorität und Begründung, die Issues, die nicht bewertet werden konnten, und die Stelle, an der der nächste Lauf beginnt (`position`). Ein Lauf ohne umsetzbare Issues sendet nichts. Sollen die Issues auch als Aufgaben in einem Projekt landen, nutze [GitHub-Issues synchronisieren](#github-sync-issues).

## Code-Review

### GitHub-Pull-Requests prüfen {#github-review-pull-requests}

Sieht sich anfangs alle 30 Minuten die offenen Pull Requests des genannten Repositorys an und prüft die, die das verbundene GitHub-Konto bei ihrem neuesten Commit noch nicht geprüft hat. Ein Sprachmodell liest jeden Diff, und seine Ergebnisse erscheinen als Review-Kommentar zu dem Commit, den es gelesen hat: **Looks ready** oder **Changes suggested**, danach, was es gefunden hat. Ein neuer Push macht den Pull Request wieder fällig; bis dahin wird er nicht erneut geprüft. Sie genehmigt nie, fordert nie Änderungen an und mergt nie; das bleibt bei einer Person. Sie braucht den GitHub-Connector mit einem Token, das die Pull Requests des Repositorys lesen (über die GraphQL-API von GitHub) und kommentieren darf.

| Frage | Was sie entscheidet |
| --- | --- |
| **GitHub-Konto** | Das verbundene Konto, das liest und kommentiert; es zählt seine eigenen Reviews. |
| **Pull Requests pro Lauf** | Wie viele ein Lauf prüft, anfangs 5, höchstens 10; die übrigen warten auf den nächsten Lauf, der am längsten unveränderte zuerst. |
| **Gelesene Diff-Größe in Zeichen** | Wo ein langer Diff gekürzt wird, anfangs 30.000; das Review sagt dann, was es nicht gelesen hat. |

Entwürfe und die eigenen Pull Requests des Kontos bleiben außen vor. Ein Pull Request, dessen Diff GitHub als zu groß nicht darstellt, bekommt statt eines Reviews einen kurzen Hinweis. Ein Pull Request, dessen Diff nicht gelesen werden konnte oder dessen Review scheiterte, bleibt für den nächsten Lauf liegen, und die übrigen werden trotzdem geprüft; scheitert jedes Review eines Laufs, scheitert der Lauf. Die Ausgabe des Laufs listet die geprüften Pull Requests, die für den nächsten Lauf liegen gebliebenen, wie viele noch warten und wie viele als Entwurf, als eigene oder als schon geprüft übersprungen wurden. Sieh dir nach dem ersten Live-Lauf ihr [Ausführungsprotokoll](/de/platform/automations/execution-logs) an.

## Aufgaben

### Neue Aufgaben einordnen {#triage-new-tasks}

Jedes Mal, wenn im gewählten Projekt eine Aufgabe erstellt wird, liest ein Sprachmodell Titel und Beschreibung und kommentiert eine vorgeschlagene Priorität, ihre Begründung und einen ersten konkreten Schritt, in der Sprache der Aufgabe. Sonst ändert sich an der Aufgabe nichts.

### Fragen aus deinen Dokumenten beantworten {#answer-questions}

Wird im gewählten Projekt eine Aufgabe erstellt, deren Titel mit einem Fragezeichen endet, durchsucht sie die Dokumente der Organisation und kommentiert eine Antwort, die nur auf dem Gefundenen beruht, mit den Quellen — oder sagt klar, dass die Dokumente die Frage nicht beantworten. Andere neue Aufgaben bleiben unberührt.

## Benachrichtigungen

Nachrichten dieser Vorlagen und von [Posteingang zusammenfassen](#inbox-summary) kommen in den Benachrichtigungen des Mitglieds an und per E-Mail, wenn seine Einstellungen eine senden; [Mitglieder aus einer Automatisierung benachrichtigen](/de/platform/automations/notify-members) erklärt, wer übersprungen wird.

### Tägliche Aufgabenübersicht {#task-digest}

Listet nach ihrem Zeitplan — anfangs jeden Tag um 09:00 in deiner Zeitzone, solange du ihn nicht änderst — die Aufgaben, die seit der letzten gesendeten Übersicht im gewählten Projekt erstellt wurden, und schickt sie dem gewählten Mitglied als eine Nachricht, je eine Zeile, mit einem Link zu den Aufgaben des Projekts. Die erste Übersicht blickt einen Tag zurück. Jede Übersicht beginnt dort, wo die letzte erfolgreiche endete: Ein auf eine andere Stunde verschobener Zeitplan, eine gescheiterte Übersicht oder Tage, an denen der Server stillstand, lassen keine Aufgabe aus und listen keine doppelt. Die Aufgaben stehen in der Reihenfolge, in der sie erstellt wurden, höchstens 50: Nach einer arbeitsreichen Zeit endet die Übersicht mit …, und die nächste macht hinter ihrer letzten Aufgabe weiter. Eine Übersicht ohne neue Aufgaben sendet nichts.

### Reviewer benachrichtigen {#notify-reviewer}

Wechselt eine Aufgabe des gewählten Projekts in den Status **In Prüfung**, benachrichtigt sie das gewählte Mitglied mit dem Titel der Aufgabe und einem Link dorthin. Andere Statuswechsel senden nichts.

## Webhooks

### Aufgaben per Webhook erstellen {#webhook-create-task}

Ein anderes System — ein Formular, ein Monitoring-Alarm, ein Shop — sendet JSON an die Webhook-Adresse, die der Tab **Allgemein** der Automatisierung zeigt, und im gewählten Projekt entsteht eine Aufgabe: `title` gibt ihr den Namen, `description` den Text. Eine Lieferung ohne Titel wird abgelehnt und erstellt nichts.

Jede Aufgabe wird über ihre Lieferung erkannt: über den Wert des Felds, das **Schlüssel der Lieferung** nennt — anfangs `id`, oder ein verschachteltes Feld wie `alert.id` —, oder bei einer Lieferung ohne dieses Feld über ihren ganzen Inhalt. Eine Lieferung, deren Schlüssel schon einmal kam, aktualisiert den Titel der Aufgabe, die sie erstellt hat, statt eine zweite anzulegen, auch Tage später, wenn sich die Webhook-Adresse an die Lieferung selbst nicht mehr erinnert; eine Beschreibung, die die Aufgabe schon hat, bleibt. **Name des Absenders** (anfangs `webhook`) hält zwei Absender auseinander, deren Schlüssel sich überschneiden könnten: Gib jedem einen eigenen.
