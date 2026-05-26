---
title: Tiefenrecherche
description: Der Researcher-Agent — offene Webrecherche mit Live-Plan, zitierten Quellen über Tavily und einem sauberen PDF-Bericht am Ende.
---

Die Tiefenrecherche ist ein Composer-Modus, der eine Frage an einen spezialisierten **Researcher**-Agent übergibt. Der Agent plant die Arbeit als Liste von Unterfragen, sucht im offenen Web mit Tavily, liest die vielversprechendsten Seiten, verfolgt den Fortschritt in einer To-do-Karte, die du live mitlesen kannst, und schliesst mit einem PDF-Bericht ab, der jede genutzte Quelle zitiert. Greif danach, wenn die Frage offen ist, die Antwort Belege braucht, und du sonst eine Stunde mit zwanzig Browser-Tabs verbringen würdest.

Diese Seite deckt die Tiefenrecherche-Oberfläche von Anfang bis Ende ab — wann du sie wählst, wie der Ablauf aussieht, das Budget, das sie davor bewahrt, ewig zu laufen, und woher die zitierten Quellen kommen. Die Mechanik des Agents hat dieselbe Form wie jeder andere Tale-Agent (siehe [Agent-Konzepte](/de/platform/agents/concepts)); was hier ungewöhnlich ist, ist der Live-To-do-Plan und die Tavily-Integration, die die Suchen antreibt.

## Wann du danach greifst

Tiefenrecherche schlägt einen einfachen Chat bei Fragen, deren Wert nicht das bestehende Wissen des Modells ist, sondern das Zusammenfügen aktueller, belegter Information. Drei Signale, dass das der richtige Modus ist:

- Die Frage ist offen („was ist der aktuelle Konsens zu…", „vergleiche die drei führenden…").
- Du willst Zitate — ein Zitat ohne URL ist eine Vermutung.
- Du nimmst zwei bis zehn Minuten Wartezeit für einen geschriebenen Bericht statt einer Chat-Antwort in Kauf.

Für schmale Faktenfragen („was ist die Hauptstadt des Senegal") ist ein einfacher Chat schneller und genauso korrekt. Für Fragen zu deinen eigenen Daten („was hat der Kunde am letzten Dienstag im Call gesagt") ist ein Agent mit [Wissens](/de/platform/agents/knowledge)-Bindungen die richtige Form — Tiefenrecherche liest nur das offene Web, nicht deine Wissensdatenbank.

## Tiefenrecherche öffnen

Öffne Chat. Der Composer zeigt einen **Deep research**-Knopf (Teleskop-Icon) neben dem Agent-Picker; klick ihn, und der Composer wechselt in den Researcher-Agent. Tipp die Frage und sende. Die Antwortansicht wechselt vom üblichen Streaming-Text zu einer **research plan**-Karte mit drei bis sieben To-do-Einträgen, die der Agent als Unterfragen gewählt hat.

Der Deep-research-Knopf ist sichtbar, wenn ein Redakteur oder höher die **Tavily**-Integration unter [Einstellungen > Integrationen](/de/platform/integrations/overview) gebunden hat; ohne Tavily zeigt der Agent eine Einzeiler-Bitte an einen Admin, sie zu verbinden.

## Der Recherche-Plan

Der Plan ist eine Liste von `pending`-To-do-Einträgen, die der Agent aus deiner Frage erzeugt hat. Bei komplexen Fragen pausiert der Agent nach dem ersten Plan und bittet dich um Bestätigung — eine **Proceed with this plan?**-Karte erscheint mit einem Ja/Nein-Feld. Klick Ja, um zu starten; klick Nein, und der Agent läuft nicht weiter. Triviale Fragen überspringen die Bestätigung.

Sobald er läuft, arbeitet der Agent die To-dos einzeln ab:

1. Setzt das aktuelle To-do auf `in_progress`.
2. Sucht bis zu dreimal über Tavily zu diesem To-do.
3. Liest bis zu zwei der vielversprechendsten URLs vollständig über Tavilys Extract-Operation.
4. Setzt das To-do auf `done` mit einer Ein-Satz-Erkenntnis.

Die Karte aktualisiert sich live, sobald jeder Schritt landet. Du kannst zusehen, wie das Modell seine Argumentation formt; taucht mitten im Lauf eine neue Unterfrage auf, fügt der Agent sie der Liste hinzu.

## Suchen und Extraktionen

Tavily ist der Open-Web-Such-Provider hinter der Tiefenrecherche — die API ist für LLM-Agents optimiert und gibt Such-Treffer mit bereinigten Snippets und Pro-Resultat-Scores zurück. Zwei Operationen zählen:

- **search** — Anfrage in natürlicher Sprache mit Tiefe (`basic` oder `advanced`), Topic (`general` oder `news`, mit einem `days`-Fenster für Aktualität) und einer optionalen Domain-Allowlist oder -Blocklist.
- **extract** — holt den bereinigten Hauptartikel-Text für eine bis fünf URLs. Der Agent ruft das pro To-do auf den zwei besten Treffern auf, wenn ein Snippet nicht reicht.

Tavilys Free Tier sind 1000 Aufrufe pro Monat; Paid Plans schalten `advanced`-Tiefe bei Suche und die Extract-Operation frei. Die Einrichtungsschritte leben auf der Setup-Karte der Integration unter **Einstellungen > Integrationen**.

## Pro-Lauf-Budget

Tiefenrecherche deckelt einen Lauf bei:

- **3 Suchen + 2 Extraktionen pro To-do.** Der Integration-Wrapper lehnt Aufrufe darüber hinaus ab.
- **40 Argumentationsschritte insgesamt** über den ganzen Lauf.
- **25 Minuten Wall-Clock.** Danach hört der Agent auf und synthetisiert mit dem, was er hat.
- **60 Integrationsaufrufe insgesamt pro Lauf** als harte Obergrenze.

Eine dieser Obergrenzen zu treffen stoppt die Suchphase und schiebt den Agent in die Synthese. Brauchst du mehr, lauf die Frage erneut mit engerem Umfang oder zerleg sie in zwei Fragen.

## Der PDF-Bericht

Sobald jedes To-do `done` ist (oder abgebrochen, oder das Budget gegen eine Wand gelaufen ist), ruft der Agent das **pdf**-Tool einmal auf, um einen einzelnen strukturierten Bericht zu erzeugen:

- **Conclusion** — ein bis drei Sätze, die die Frage direkt beantworten.
- **Key points** — drei bis sieben Punkte, jeder mit mindestens einem Inline-Zitat zu einer Tavily-Quelle.
- **Details** — die längere Analyse, nach Unterfrage gruppiert.
- **Sources** — eine deduplizierte Liste jeder zitierten URL.

Das PDF kommt als Anhangskarte im Chat an. Der Agent fügt den Bericht nicht in den Nachrichtentext ein — die Karte ist das Liefer-Ergebnis. Eine kurze Bestätigungszeile in deiner Sprache („Recherche abgeschlossen — den vollständigen Bericht findest du im angehängten PDF.") zeigt auf die Karte.

Für chinesische, japanische und koreanische Berichte ist der Schriftsatz des PDF-Renderers unvollständig; in dem Fall emittiert der Agent denselben strukturierten Bericht direkt im Chat und merkt an, dass ein ins Englische übersetztes PDF auf Anfrage verfügbar ist.

## Fehlerfälle

- **Tavily nicht verbunden.** Der Agent emittiert eine Einzeiler-Bitte an einen Redakteur, Tavily unter **Einstellungen > Integrationen** zu verbinden, und stoppt.
- **Tavily-Kontingent ausgeschöpft.** Die Integration gibt `INTEGRATION_BUDGET_EXHAUSTED` zurück, und der Agent geht zur Synthese mit dem, was er hat. Free Tier trifft das etwa beim tausendsten Aufruf des Monats.
- **Eine bestimmte URL scheitert beim Extrahieren.** Das betroffene To-do wird mit einem Grund als `failed` markiert; andere To-dos laufen weiter.
- **Dein Budget reicht nicht.** Der Lauf stoppt, und der Agent synthetisiert. Die Karte zeigt, welche To-dos übersprungen wurden.

## Wo das hineinpasst

Tiefenrecherche ist das schwerste Ende des Chat-Composers — sie macht in zehn Minuten, was ein Analyst in einem Nachmittag erledigen würde. Paar diese Seite mit [Agent-Konzepte](/de/platform/agents/concepts) (das Vier-Knöpfe-Modell, auf dem der Researcher-Agent gebaut ist) und [Integrationen-Übersicht](/de/platform/integrations/overview) (wo Tavily neben den anderen Integrationen sitzt, die der Agent-Werkzeuggürtel erreichen kann). Willst du deinen eigenen recherche-artigen Agent bauen statt den ausgelieferten zu nutzen, führt dich [Einen Agent erstellen](/de/platform/agents/create) durch den Agent-Bau von Anfang bis Ende.
