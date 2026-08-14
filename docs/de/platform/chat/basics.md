---
title: Chat-Grundlagen
description: Was zwischen dem Druck auf Senden und der landenden Antwort passiert — die Wahlen in der Eingabezeile, was das Modell bekommt, die drei Abruf-Tools und wie du Denkverlauf und Quellen liest.
---

Diese Seite ist das mentale Modell für alles im Chat-Tab. Sie benennt die Teile der Eingabezeile, verfolgt eine Nachricht vom Tastendruck bis zur gestreamten Antwort, sagt genau, was das Modell in die Hand bekommt und was es unterwegs aufrufen darf, und zeigt, wie du liest, was zurückkam. Lies sie einmal, und die übrigen Chat-Seiten sind Variationen desselben Ablaufs.

<Frame caption="Der Chat-Tab mit einer gestreamten Antwort über der Eingabezeile.">

![Ein Chat-Thread zeigt eine Nutzerfrage zu Onboarding-Feedback und eine Assistenten-Antwort mit einer Markdown-Tabelle aus drei Themen.](/images/platform/chat-thread-reply.webp)

</Frame>

## Die Eingabezeile

Die Eingabezeile ist der Eingabestreifen am unteren Bildschirmrand. Das Nachrichtenfeld sendet mit **Enter** und bricht die Zeile mit **Shift+Enter** um. Ein Picker neben dem `+`-Menü hält die Modellwahl — **Auto**, der Standard, lässt Tale pro Nachricht ein Modell wählen, oder du benennst eines — und, bei einem benannten Modell, das ihn anbietet, den Denkaufwand. Mehr Wahlen gibt es nicht, mit Absicht: kein Agent-Picker, kein Skill-Picker, keine Stellschraube dafür, wo der Zug läuft. Das `+`-Menü trägt **Fotos & Dateien hinzufügen** und, wo ein Chat ihn hergibt, den **Arena-Modus** ([Arena-Modus](/de/platform/chat/arena-mode)); **Antworten vorlesen** ([Sprachmodus](/de/platform/chat/voice-mode)) ist der Lautsprecher-Schalter neben dem Mikrofon, und das Mikrofon diktiert ins Feld.

Während eine Antwort streamt, wird aus dem Senden-Knopf Stopp. Stoppen behält alles, was schon gestreamt ist — die Antwort bleibt stehen, wie sie ist, notfalls mitten im Satz.

### Anhänge

Zieh Dateien vom Desktop irgendwo auf die Eingabezeile — beim Überfahren sagt eine Einblendung **Dateien hier ablegen zum Hochladen** —, füge einen Screenshot direkt ins Nachrichtenfeld ein oder wähle Dateien über **Fotos & Dateien hinzufügen** im `+`-Menü. Der Chat nimmt Bilder, Dokumente (PDF, Office, OpenDocument, CSV), textbasierte Dateien und Audio/Video. Jedes Bild liegt als kleine Miniatur über dem Feld: Ein Klick zoomt hinein, das ✕ entfernt es. Alles andere erscheint als benannter Chip mit Verarbeitungsstatus: Das Transkriptionsmodell deiner Organisation macht aus Audio und Video Text, Dokumente werden für den Abruf indexiert. Senden wartet auf keinen Fortschrittsbalken — eine Nachricht, die du abschickst, während Dateien noch verarbeiten, parkt über der Eingabezeile und geht von selbst raus, sobald alles bereit ist; ihr ✕ verwirft die wartende Nachricht und legt den Text zurück ins Feld. Bis zu zehn Dateien reisen mit einer Nachricht.

Füge einen Videolink ein (YouTube, Vimeo, Bilibili und Co.) und auch er wird zum Chip: Tale holt im Hintergrund die Untertitel — oder extrahiert und transkribiert die Tonspur, wenn es keine gibt — und das Transkript reist mit deiner Nachricht wie eine hochgeladene Aufnahme. Nur ein fehlgeschlagener Video-Chip hält das Senden auf, weil das Warten darauf nie enden würde: Versuch es erneut oder entferne ihn, alles andere reiht sich ein.

Ein Modell, das Bilder sehen kann, bekommt die Pixel selbst, mitten in deinen Worten; bei einem, das es nicht kann, sagt die Eingabezeile das schon beim Anhängen — dieses Modell sähe nur die Dateinamen. Audio erreicht das Chat-Modell nie als Bytes: das Modell bekommt das Transkript als Text, deine Blase behält die Worte, die du getippt hast (plus den Audio-Chip). Der Inhalt eines Dokuments erreicht den Assistenten über seine Wissenswerkzeuge — die Runde nennt ihm die angehängten Dateien und er liest sie mit `rag_fetch`; rechne also mit einem Abrufschritt vor der Antwort. Ein Format ohne Textextraktion (alte Office-Dateien wie `.doc`) hängt trotzdem an, aber der Assistent sieht nur den Namen — und sagt das, statt zu raten.

Hier abgelegte Dokumente bleiben privat in diesem Chat — sie landen nie in der [Wissens](/de/platform/knowledge/overview)-Bibliothek der Organisation, und kein anderer Chat und niemand sonst kann sie abrufen. Angehängte Dateien gehören zu dem Chat, in dem du sie angehängt hast (ein Chatwechsel leert sie), und eine neu generierte Antwort schickt dieselben Anhänge noch einmal mit — Transkripte und Dokumentzugriff baut die Runde für das Modell aus den gespeicherten Dateien neu auf. Arbeit, die Dateien erzeugt, gehört in einen Task. Ins Mikrofon sprechen ist ein eigener Weg — siehe [Sprachmodus](/de/platform/chat/voice-mode).

<Frame caption="Die Eingabezeile: Nachrichtenfeld, der Picker für Modell und Denkaufwand, Diktat, Senden.">

![Die Chat-Eingabezeile mit ihrem Plus-Menü, dem Modell-Picker auf Auto, dem Mikrofon-Knopf und dem Senden-Knopf.](/images/platform/chat-composer.webp)

</Frame>

## Ein Modell wählen

Der Picker startet auf **Auto**: Tale liest jede Nachricht — Länge, Code, Thema — und wählt ihr ein Modell aus derselben Liste, die der Picker zeigt: ein leichtes für die schnelle Frage, ein starkes für harten oder heiklen Boden. Keine zweite KI entscheidet das (es ist eine schlichte Heuristik auf dem Text), und still ausgewichen wird nie: Das Modell, das deine Antwort beginnt, beantwortet sie auch, und die Nachrichtendetails nennen es. Trägt eine Nachricht Bilder, kommen nur Modelle infrage, die sie sehen können; kann es keines, sagt der Versand das, statt zu raten.

Entscheidest du lieber selbst? Wähl ein Modell aus der Liste — der Picker listet die Modelle, für die die Organisation ein aktives, direkt nutzbares Credential hält; ein Modell, das nur im eigenen Werkzeug seines Anbieters laufen könnte, taucht hier nicht auf. Eine benannte Wahl bleibt deine, bis du sie an Auto zurückgibst, und beides bleibt als Standard für deine nächsten Chats stehen. Auto erscheint nur, wenn es wirklich etwas zu wählen gibt — bei einem einzigen nutzbaren Modell nennt der Picker schlicht dieses.

Bei Modellen mit steuerbarer Denktiefe setzt der zweite Abschnitt des Pickers den Denkaufwand. Die Wahl reist mit dem Gespräch — jeder folgende Zug läuft auf der Stufe, die du gesetzt hast, und Modelle ohne den Regler ignorieren sie. Auf **Standard** antwortet ein Modell, das ohne langes Nachdenken auskommt, genau so — wähl eine Stufe, wenn es länger nachdenken soll. Auf Auto bleibt der Aufwand-Abschnitt aus dem Menü: Wie hart ein Modell nachdenkt, gehört zu der Frage, _welches_ Modell läuft — nagle eines fest, um ihn zu setzen.

## Was das Modell bekommt

Der Prompt entsteht in einer festen Reihenfolge, und die Liste ist bewusst kurz: die verbindlichen Anweisungen der Organisation, der eingebaute Leitfaden des Assistenten, die Regeln für den Umgang mit nicht vertrauenswürdigen Inhalten, eine kurze Zeile Dokumentation pro Tool, dann der aktuelle Zeitstempel mit der Sprachvorgabe für die Antwort und schließlich der vollständige Nachrichtenverlauf — samt jedem Tool-Aufruf und jedem Ergebnis, genau so, wie sie passiert sind.

Mehr kommt nicht dazu. Es gibt keinen Personalisierungs-Block, keine heimlich eingeschobenen Memories, keinen automatischen Wissensabruf und keinen automatischen Web-Kontext. Alles, was das Modell über seine Anweisungen hinaus erfährt, erfährt es über einen Tool-Aufruf — und damit steht es im Transkript, zuordenbar und ablehnbar.

<Info>

Wächst das Gespräch über das Kontextfenster des Modells hinaus, fallen die ältesten Nachrichten weg, und an ihre Stelle tritt ein sichtbarer Hinweis. Zusammengefasst wird nichts: Eine Zusammenfassung wäre ein zweiter Modellaufruf, der genau die Historie erfinden kann, die er bewahren soll — weggefallene Nachrichten dagegen verlieren Information auf eine Art, die du siehst.

</Info>

## Die drei Tools

Der Assistent trägt genau drei Tools, alle drei reiner Lese-Abruf — das ist die Grenze, die Chat ein Gespräch bleiben lässt statt einer Werkbank.

| Tool         | Was es erreicht                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `rag_search` | Das Wissen der Organisation: Dokumente, Wissenseinträge, gecrawlte Website-Seiten, Produkte und Kontakte                              |
| `rag_fetch`  | Der Volltext hinter einer Referenz — ein angehängtes oder gefundenes Dokument über seine Datei-ID, eine gecrawlte Seite über ihre URL |
| `web_fetch`  | Eine öffentliche Webseite, live geholt — der Schritt über das Org-Wissen hinaus; bereits gecrawlte Inhalte liefert `rag_fetch`        |

Eine Suche ist ehrlich darüber, was sie abgedeckt hat: Das Ergebnis benennt jede durchsuchte Quelle und sagt, welche nicht verfügbar waren — eine Organisation ohne konfiguriertes Embedding-Modell bekommt zum Beispiel „Dokumente und gecrawlte Seiten sind noch nicht durchsuchbar" statt einer stumm leeren Liste, und der Assistent gibt das weiter, statt darum herumzuraten.

Mehr gibt es bewusst nicht — kein Code-Ausführen, kein Datei-Schreiben, keine Connectors, keine Sub-Agents. Diese Fähigkeiten leben auf Aufgaben und in Automatisierungen, wo es Verantwortliche, einen Prüfschritt und ein Audit-Protokoll gibt, das ihnen gewachsen ist.

## Nach einem Arbeitsergebnis fragen

Bitte den Assistenten um eine Präsentation, ein übersetztes Dokument oder ein anderes Artefakt, und er baut es nicht halbfertig im Chat: Er gibt dir die Kurzfassung, wenn eine nützlich ist, und verweist dich dann darauf, eine Aufgabe zu erstellen und sie einem Agent zuzuweisen. Eine Aufgabe hat Verantwortliche, produziert ein prüfbares Ergebnis, und nur ein Mensch setzt sie auf Erledigt — nichts davon kann eine Chat-Antwort bieten. Einen eingefügten Satz zu übersetzen ist Chat-Arbeit; eine Datei zu übersetzen ist Aufgaben-Arbeit.

## Die Antwort lesen

Die Antwort streamt herein, während sie entsteht. Darüber hält der Denkverlauf fest, was der Assistent getan hat, in Reihenfolge:

- Eine einklappbare Zeile **„Hat _n_ s nachgedacht"** trägt das Nachdenken des Modells — ein Klick klappt die Prosa auf.
- Jeder Tool-Aufruf ist eine Schrittzeile — _Durchsucht die Wissensdatenbank nach "…"_, _Liest example.com_ — mit einem Spinner, solange er läuft, und einer Warnung samt Grund, wenn er scheitert. Die Schritte bleiben sichtbar, wenn das Nachdenken eingeklappt ist; sie sind das Protokoll dessen, wonach der Assistent gegriffen hat.

Unter der Antwort listet **Quellen** die Seiten und Dokumente, die der Assistent tatsächlich geladen hat — abgeleitet aus den Tool-Ergebnissen, nicht aus der Prosa, sodass eine Quellenkarte nie eine Lektüre behauptet, die nicht stattgefunden hat. Web-Quellen öffnen in einem neuen Tab.

Die Werkzeugleiste unter einer fertigen Antwort kopiert den Text, zeigt Token-Zahlen und Zeiten (**Du hast gewartet** ab deinem Klick; **Dauer** und **Zeit bis zum ersten Token** ab dem Start der Antwort auf dem Server), nimmt eine Daumen-Bewertung entgegen und forkt den Chat — eine sichtbare Kopie des Gesprächs bis zu diesem Punkt, fortgesetzt als eigener neuer Chat.

## Konversationen versus Chats

Innerhalb von Chat ist die Einheit ein **Chat** — das Wort, das jede Schaltfläche und jeder Toast verwendet. Das Datenmodell dahinter heißt `threads`, und die URL trägt `threads/$threadId`; die Docs folgen der UI und sagen in der Prosa „Chat". Die Kontaktkanal-Inbox, die eine installierte E-Mail-Automatisierung hinzufügt, ist eine andere Oberfläche: Eine Konversation dort ist ein Kontakt-Thread und kein Chat — diese Bedeutung steht unter [Mitgelieferte Automatisierungen](/de/platform/automations/builtin).

## Verlauf und Suche

Die Verlaufs-Sidebar listet jeden Chat, den du in dieser Org fortsetzen kannst, den neuesten zuoberst — deine angehefteten Chats schwimmen obenauf, in Projekte eingeordnete Chats stehen unter ihren Ordnern; eine Auswahl öffnet das volle Transkript. Die Suche dort filtert nach Titel, und die Volltextsuche über Nachrichtentexte läuft pro Chat statt org-weit. Benennst du einen Chat um, überschreibt der eigene Titel den generierten. Löschst du einen Chat, wandert er in den [Papierkorb](/de/platform/admin/governance/trash), wo die Aufbewahrung ihn nach der Schonfrist wegräumt.

## Wo das hineinpasst

Chat-Grundlagen ist die Seite, die der Rest dieses Abschnitts verfeinert: Der [Arena-Modus](/de/platform/chat/arena-mode) schickt einen Prompt durch zwei Modelle nebeneinander, der [Sprachmodus](/de/platform/chat/voice-mode) behandelt das Sprechen statt Tippen, und [Geteilte Chats](/de/platform/chat/shared-threads) das Veröffentlichen eines Transkripts an die Org. Ist aus deiner Frage Arbeit geworden — etwas mit einem Ergebnis am Ende —, sind die [Agent-Konzepte](/de/platform/agents/concepts) die nächste Lektüre: Agents tun auf Aufgaben all das, was Chat bewusst weglässt.
