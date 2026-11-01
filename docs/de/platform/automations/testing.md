---
title: Eine Automatisierung testen
description: Schreib Tests für eine Automatisierung im Editor, führ sie auf deinem Entwurf oder einer gespeicherten Version aus und lies, was ein fehlgeschlagener Test gefunden hat.
---

Ein Test führt eine Automatisierung mit einer Eingabe deiner Wahl aus und prüft, was herauskommt: die Ausgabe, die Aktionen, die sie auslöst, und welche Schritte laufen. Tests gehören zum Dokument der Automatisierung, deshalb behält jede Version ihre eigenen. Tale führt sie beim Speichern aus und vor jedem Live-Schalten noch einmal; eine Version, deren Tests fehlschlagen, lässt sich nicht live schalten. Zum Schreiben und Ausführen von Tests brauchst du die Rolle Entwickler, Admin oder Inhaber.

## Die Tests öffnen

Wähle im [Workflow-Editor](/de/platform/automations/editor) **Tests** neben **Probleme**. Die Schaltfläche zählt die Ergebnisse, etwa zwei grüne Häkchen und ein rotes Kreuz, und öffnet den Tab **Tests** im Bereich unter dem Canvas; der andere Tab ist **Probleme**. Auf dem Smartphone öffnet sich die Liste in einem eigenen Bereich.

Jede Zeile ist ein Test, in der Reihenfolge des Dokuments: sein Status, sein Name und bei einem fehlgeschlagenen Test das Erste, was schiefging. Die Zeile über der Liste sagt, woher die Ergebnisse stammen: **Auf deinem Entwurf ausgeführt** oder die letzte Prüfung der Version, etwa **Geprüft beim Live-Schalten von Version 3** mit dem Datum. Ein Test steht auf **Noch nicht ausgeführt**, bis er ein Ergebnis hat, auf **Konnte nicht laufen**, wenn die Automatisierung selbst nicht laufen konnte, und auf **Seit diesem Ergebnis geändert**, sobald sich die Automatisierung oder der Test nach seinem Lauf geändert hat; das Ergebnis bleibt sichtbar, damit du siehst, was es verändert hat.

<Frame caption="Alle ausführen bei den Bestellrabatten: Der Test der großen Bestellung schlägt fehl, und sein Ergebnis sagt, wie die Ausgabe hätte lauten sollen.">

![Der Editor von Order discounts mit Tests in der Kopfzeile, die ein Häkchen und ein Kreuz zeigt, und dem Tab Tests unter dem Canvas: Small order pays full price ist bestanden, und Big order gets 10% off ist fehlgeschlagen, weil 2 geprüfte Felder fehlen oder anders sind. Neben dem Canvas listet der Tab Result des fehlgeschlagenen Tests discount: expected 240, got 120 und total: expected 2160, got 2280 und sagt, dass 1 weiteres Feld nicht geprüft wird.](/images/platform/automation-tests.webp)

</Frame>

## Einen Test hinzufügen

1. Wähle im Tab **Tests** die Option **Test hinzufügen** und, falls sich ein Menü öffnet, **Leerer Test**. Neben dem Canvas öffnet sich ein Test namens **Neuer Test**, mit einem Platzhalter für jedes Feld, das die Eingabe des Laufs verlangt.
2. Füll den Test unter **Einrichtung** aus: **Name**, die **Eingabe**, die der Lauf als JSON erhält, unter **Simulierte Ausgaben** und **Simulierte Fehler** die Schritte, für die der Test einspringt, und unter **Erwartungen**, was der Lauf tun muss. Deine Änderungen gehen beim Tippen in den Entwurf ein.
3. Speichere den Entwurf, um den Test zu behalten. Beim Speichern laufen alle Tests, und die Version behält das Ergebnis.

Eine neue simulierte Ausgabe beginnt leer: `{}` für eine Node oder `[]`, wenn sie einmal pro Element läuft. **Ausgabe des letzten Laufs verwenden** übernimmt die Ausgabe aus dem Lauf auf dem Canvas, wenn du das wählst. Prüfe diesen Wert vor dem Speichern.

<Frame caption="Die Einrichtung eines Tests: die Eingabe des Laufs als JSON, die simulierten Schritte und was der Test vom Lauf erwartet.">

![Der Tab Setup des Tests Big order gets 10% off neben dem Canvas von Order discounts: Name, eine leere Description, ein Input mit quantity 120 und unitPrice 20, Simulated outputs und Simulated failures mit je einer Auswahl und Expectations, wo die Ausgabe mit Includes geprüft wird.](/images/platform/automation-test-setup.webp)

</Frame>

**Als YAML bearbeiten** zeigt denselben Test als Text, für einen Teil, für den das Formular kein Feld hat; solange sich der Text nicht lesen lässt, behält der Test seine letzte lesbare Fassung. In YAML hat ein Test einen `name`, die `input`, die der Lauf erhält, und `expect`, was der Lauf tun muss:

```yaml
name: Big order gets 10% off
input:
  quantity: 120
  unitPrice: 20
expect:
  outputIncludes:
    discount: 240
    total: 2160
```

- `output` muss genau der Ausgabe des Laufs entsprechen; `outputIncludes` prüft nur die Felder, die es aufführt, und die Ausgabe darf mehr enthalten.
- `nodes` nennt Schritte und was mit jedem passieren muss: `ran`, `skipped` oder `failed`, wenn der Lauf nach dem Fehler weitergeht.
- `effects` listet Aktionen, die der Lauf ausführen muss, etwa eine E-Mail, die gesendet wird, nach Node-Typ; mit `absent: true` eine Aktion, die nicht stattfinden darf.
- `failure` sagt, dass der Lauf fehlschlagen muss, auf Wunsch bei einem bestimmten Schritt und mit einer Meldung, die den angegebenen Text enthält.
- `mocks` gibt einem Schritt eine Ausgabe, die er verwendet, statt seinen Dienst oder sein Modell aufzurufen, und `failures` lässt einen Schritt mit der angegebenen Meldung fehlschlagen.
- `scenarios` gibt einem Schritt, der einen Connector aufruft, einen der Fälle, die seine Aktion mitliefert, wie [Ein Szenario eines Connectors wählen](#scenarios) beschreibt.

Ohne `expect` besteht ein Test, wenn der Lauf erfolgreich ist. Im Menü einer Zeile kopierst du einen Test mit **Duplizieren** oder entfernst ihn mit **Löschen**; **Verwerfen** holt einen gelöschten Test zurück, solange du nicht gespeichert hast.

### Ein Szenario eines Connectors wählen {#scenarios}

Eine Aktion eines Connectors kann Szenarien mitliefern: benannte Fälle dessen, was ihr Dienst antwortet, etwa eine leere Liste, eine abgelehnte Schreibaktion oder ein Ratenlimit. `scenarios` ordnet der ID eines Schritts den Namen eines Szenarios zu, das seine Aktion mitliefert, sodass der Test zeigt, was die Automatisierung in diesem Fall tut. In diesem Test ruft der Schritt `post` `slack.send_message` mit dem Kanal aus der Eingabe auf und erhält die Antwort, die Slack für einen nicht vorhandenen Kanal gibt:

```yaml
name: Slack rejects an unknown channel
input:
  channel: C0000000009
scenarios:
  post: channel_not_found
expect:
  failure:
    node: post
```

Die Eingabe des Schritts wird weiterhin ermittelt und geprüft. Ein Aufruf, dessen Eingabe zum Szenario passt, erhält die Antwort des Szenarios; jeder andere Aufruf erhält die übliche simulierte Antwort des Connectors.

- Antwortet das Szenario mit einer Ausgabe, wird sie zur Ausgabe des Schritts, und der Schritt trägt **Simulierte Ausgabe**, als hätte der Test diese Ausgabe vorgegeben. Eine Schreibaktion hält weiterhin die Aktion fest, die sie ausgeführt hätte.
- Antwortet das Szenario mit einem Fehler, schlägt der Schritt mit der Meldung des Szenarios fehl, als vom Test simuliert markiert, und trägt **Simulierter Fehler**. Der Lauf behandelt ihn wie denselben Fehler des Dienstes, etwa einen verweigerten Zugriff oder ein Ratenlimit, sodass der Rest der Automatisierung damit umgeht wie in einem Live-Lauf.
- Passt keiner der Aufrufe des Schritts zum Szenario, steht es unter **Nicht verwendet**, wie eine nicht verwendete simulierte Ausgabe.

Für einen Schritt springt der Test nur auf eine Weise ein: mit einem Szenario, einer simulierten Ausgabe oder einem simulierten Fehler. Das Formular unter **Einrichtung** hat noch kein Feld für `scenarios`: Schreib sie mit **Als YAML bearbeiten**, und das Formular behält sie so, wie sie geschrieben sind. [Connectors](/de/develop/connectors#scenarios) erklärt, wie eine Aktion ihre Szenarien deklariert und wie ihre Fehler eingeordnet werden. Über den [MCP-Endpunkt](/de/develop/mcp-endpoint#authoring) listet `get_catalog` die Szenarien, die jede Aktion mitliefert.

### Vom Trigger oder einem Pfad ausgehen

Gibt es mehr, wovon ein Test ausgehen kann, öffnet **Test hinzufügen** ein Menü. **Leerer Test** fügt den oben beschriebenen Test hinzu. **Aus der Eingabe des Triggers** beginnt mit der Eingabe, die der gebundene Trigger einem Lauf übergibt: ein Zeitplan, der zu einem festen Zeitpunkt auslöst, die Beispielzustellung eines Webhooks oder das Beispiel eines Ereignisses – so erhält der Test bei jedem Lauf dieselbe Eingabe. **Für einen ungetesteten Pfad** listet die möglichen Pfade, die noch kein Test nimmt, in den Worten der [Pfadliste](/de/platform/automations/editor#paths); hat jeder Pfad einen, steht dort stattdessen **Jeder Pfad hat einen Test**. Der neue Test simuliert jeden Fehler, den der Pfad braucht, und erwartet den Zustand jedes Schritts darauf; seine Beschreibung sagt, welche Bedingungen die Eingabe wahr oder falsch machen muss. **Aus einem Lauf** speichert einen der fünf neuesten Läufe als Test, wie [Einen Lauf als Test speichern](#save-a-run) beschreibt.

### Einen Lauf als Test speichern {#save-a-run}

Ein Lauf, der getan hat, was er sollte, oder einer, der schiefging, wird zu einem eigenen Test. **Aus einem Lauf** im Menü **Test hinzufügen** listet die fünf neuesten Läufe, die Seite eines Laufs und seine Zeile im Tab **Läufe** bieten **Als Test speichern…** in ihren Menüs, und ein [Versuch mit dem Entwurf](/de/platform/automations/editor#try-the-draft) bietet **Als Test speichern** in seinem Streifen. Der Dialog macht aus dem Lauf einen Test, mit seiner Eingabe:

- **Der Test erwartet** folgt dem Ende des Laufs: **Er gibt diese Ausgabe zurück** oder **Seine Ausgabe enthält das** bei einem erfolgreichen Lauf; **Er ist erfolgreich** bei einem fehlgeschlagenen, sodass der Test fehlschlägt, bis der Fehler behoben ist, oder **Er schlägt bei Score fehl**, wenn er bei Score fehlschlug. **Noch nichts** prüft nur, dass der Lauf erfolgreich ist.
- **Mit den Daten dieses Laufs simulieren** listet die Schritte, die ein Modell, einen Agenten, einen Connector oder eine andere Automatisierung aufgerufen haben, jeweils standardmäßig eingeschaltet: Im Test antworten sie so wie im Lauf. Ein Code-Schritt bleibt aus, denn dein Code ist das, was der Test prüft.
- **Auch dieselben Aktionen erwarten** erwartet jede Aktion des Laufs, ohne ihre Eingabe.

**Test hinzufügen** legt den Test in deinen Entwurf und öffnet ihn unter **Einrichtung**; mit dem Speichern des Entwurfs bleibt er erhalten. Werte, die wie Zugangsdaten aussehen, werden weggelassen, und der Dialog sagt, wie viele. Die Eingabe des Laufs und die Ausgaben, die du behältst, werden Teil der Automatisierung, also können alle, die sie öffnen können, sie lesen.

Übernommene Eingaben, Ausgaben und Fehlermeldungen gehören zum verfassten Inhalt der gespeicherten Version. Sie können in aufbewahrten Versionen bleiben, nachdem der ursprüngliche Lauf gelöscht oder durch Aufbewahrungsregeln beziehungsweise eine Löschanfrage entfernt wurde. Einen Test in einer späteren Version zu entfernen, ändert frühere Versionen nicht. Prüfe vor dem Speichern **Eingabe**, **Simulierte Ausgaben**, **Simulierte Fehler** und **Erwartungen** und ersetze personenbezogene Daten durch synthetische Beispiele.

<Frame caption="Ein Live-Lauf von Answer launch questions als Test gespeichert: Er erwartet, was der Lauf zurückgab, und die Suche antwortet wie im Lauf.">

![Der Dialog Save the run as a test: Name From the run of Oct 11, 2026, 12:29 PM; unter The test expects ist It returns this output gewählt; unter Simulate with this run's data ist Related eingeschaltet und antwortet mit der Ausgabe aus dem Lauf; Also expect the same actions ist aus; danach die Zeile dazu, wohin der Test kommt und wer ihn lesen kann, mit Cancel und Add test.](/images/platform/automation-save-as-test.webp)

</Frame>

### Sehen, was die Tests abdecken

Sobald Tests gelaufen sind, sagt die Zeile über der Liste, wie viele der möglichen Pfade der Automatisierung sie nehmen, etwa **Deckt 1 von 2 Pfaden ab**. Wähle sie, um die Pfadliste zu öffnen; dort steht bei jedem Pfad **Getestet von** mit den Tests, die ihn nehmen, oder **Nicht getestet**. Ein Test deckt den Pfad ab, den sein Lauf tatsächlich genommen hat – das ist nicht immer der, für den er geschrieben wurde.

<Frame caption="Alle ausführen bei den Bestellrabatten: Beide Tests überspringen den Schritt Review, also hat der Pfad, auf dem er läuft, noch keinen Test.">

![Der Editor von Order discounts nach Run all, mit Possible paths neben dem Canvas: Path 1, in dem Review läuft, ist Not tested, und Path 2, in dem Review übersprungen wird, ist Tested by Small order pays full price and Big order gets 10% off. Unter dem Canvas zeigt der Tab Tests Covers 1 of 2 paths.](/images/platform/automation-test-coverage.webp)

</Frame>

## Die Tests ausführen

**Alle ausführen** führt jeden Test aus, und **Ausführen** im Menü einer Zeile oder im geöffneten Test führt einen einzelnen aus. Mit ungespeicherten Änderungen laufen die Tests auf deinem Entwurf. Ohne laufen sie auf der angezeigten Version, und ein Lauf aller ihrer Tests wird zum Testergebnis dieser Version, markiert mit **Von Hand geprüft**.

Jede Version behält ihre letzte Prüfung, und [Versionen](/de/platform/automations/editor#versions) zeigt sie, etwa **2 von 3 Tests bestanden · beim Live-Schalten geprüft**. Verhindern fehlschlagende Tests ein Live-Schalten, öffnet sich **Tests** mit dem Fokus auf dem ersten fehlgeschlagenen Test.

Tests laufen immer simuliert: Ein Connector, ein Modell oder ein Agent antwortet mit einem Platzhalter, und außerhalb von Tale wird nichts gesendet oder geändert. Ein Test stoppt nach 10 Sekunden, ein Lauf aller Tests nach 60 Sekunden. Liefen in deiner Organisation gerade viele Tests, bittet Tale dich, ein paar Sekunden zu warten, und sagt, wie viele.

## Ein Ergebnis lesen

Wähle einen Test, um ihn neben dem Canvas zu öffnen. Ein Test mit Ergebnis öffnet sich auf **Ergebnis**: ein Satz für alles, was schiefging, und was es erklärt.

- **Ausgabe**: jedes abweichende Feld, etwa `total: expected 2160, got 2280`, und die Felder, die der Test erwartet, aber nicht erhalten hat.
- **Aktionen**: die Aktion, die der Test erwartet hat, und was stattdessen passiert ist, oder die, die nicht hätte stattfinden dürfen.
- **Schritte**: der Schritt, der entgegen der Erwartung des Tests gelaufen ist, übersprungen wurde oder fehlgeschlagen ist, mit einem Weg, ihn auf dem Canvas zu zeigen.
- **Ein fehlgeschlagener Lauf**: der Schritt, bei dem der Lauf fehlschlug, und warum, in den Worten der [Ausführungsprotokolle](/de/platform/automations/execution-logs).

**Simuliert** nennt die Schritte, für die der Test einspringt, jeweils mit einer simulierten Ausgabe, einem simulierten Fehler oder einem Szenario. **Nicht verwendet** nennt die Schritte, bei denen kein Aufruf verwendet hat, was der Test vorgibt: einen Schritt, den der Lauf übersprungen hat, oder einen, dessen Szenario zu keinem seiner Aufrufe passte und der stattdessen die übliche simulierte Antwort des Connectors erhielt. **Technische Details** zeigt die eigene Meldung der Engine. Ein Ergebnis aus der letzten Prüfung der Version behält keine Schritte; führ den Test aus, um sie zu sehen.

### Den Lauf eines Tests auf dem Canvas zeigen {#show-on-canvas}

**Auf dem Canvas zeigen** im Tab **Ergebnis** oder im Menü einer Testzeile legt den letzten Lauf des Tests anstelle des letzten Laufs auf den Canvas, wo er sich wie ein aufgezeichneter Lauf Schritt für Schritt abspielen lässt. Ein Streifen über dem Canvas nennt den Test, etwa **Test: Big order gets 10% off**, und sagt, wann er lief und ob er bestanden hat: **Bestanden in 4 ms** oder sein erster Fehler. Ein Schritt, für den der Test einspringt, trägt **Simulierte Ausgabe** oder **Simulierter Fehler**. Wähle einen Schritt, um auf seinem Tab **In diesem Test** zu sehen, was er erhalten und zurückgegeben hat. **Ausführen** im Streifen führt den Test erneut aus und zeigt den neuen Lauf, und **Ergebnis ausblenden** zeigt wieder den letzten Lauf. Sobald sich die Automatisierung oder der Test ändert, sagt der Streifen das: Der Lauf zeigt dann nicht mehr, was der Entwurf tut.

## Ein Problem in einem Test beheben

Tale prüft Tests so wie den Rest des Entwurfs. Ein Test, der nie bestehen kann, etwa weil er einen Schritt simuliert, den die Automatisierung nicht hat, oder ein unbekanntes Feld nennt, steht unter **Probleme** mit dem, was zu beheben ist. Dort steht auch ein Test, der ein Szenario für einen Schritt wählt, den die Automatisierung nicht hat, eines wählt, das die Aktion des Schritts nicht mitliefert, oder für einen Schritt auf zwei Weisen einspringt. Bei einem Szenario, das die Aktion nicht mitliefert, nennt das Problem das ähnlichste und listet die Szenarien, die die Aktion mitliefert. Ein solcher Test kann erst laufen, wenn du ihn behebst. Wähle das Problem, um den Test an dieser Stelle in seinem YAML zu öffnen.
