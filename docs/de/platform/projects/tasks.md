---
title: Aufgaben auf dem Projektboard verwalten
description: Erstelle Aufgaben, lege Verantwortliche fest, verfolge den Fortschritt und prüfe die Ergebnisse an einem Ort.
---

Eine Aufgabe hält zusammen, worum es bei einer Arbeit geht: Ziel, Zuständigkeit, Status, Dateien und die Diskussion zum Ergebnis. Nutze das Projektboard sowohl für menschliche Arbeit als auch für Aufgaben, die du einem Agenten überträgst. Wer ein Projekt öffnen kann, kann darin Aufgaben erstellen. [Wer eine Aufgabe ändern darf](#wer-aufgaben-erstellen-und-aendern-darf), hängt von deiner Rolle ab und davon, ob es deine Aufgabe ist. Das Projekt muss aktiv sein: Ein archiviertes Projekt bleibt schreibgeschützt, bis ein Administrator es wiederherstellt.

<Frame caption="Das Board ordnet Aufgaben nach Status. Unter Liste siehst du dieselben Aufgaben als Zeilen.">

![Das Aufgabenboard des Projekts Website relaunch zeigt Karten in Backlog, Zu erledigen, In Bearbeitung, In Prüfung, Erledigt und Abgebrochen.](/images/platform/projects-task-board.webp)

</Frame>

## Eine Aufgabe mit klarem Ergebnis erstellen

1. Öffne **Aufgaben** im Projekt und klicke auf **Aufgabe erstellen**.
2. Benenne unter **Titel** das gewünschte Ergebnis, etwa „Launch-Briefing prüfen“.
3. Erkläre in der **Beschreibung**, was benötigt wird und wie das Ergebnis geprüft werden soll. Füge benötigte Dateien als Anhänge hinzu.
4. Wähle bei Bedarf **Status**, **Priorität** und **Zuständig**. Eine neue Aufgabe startet mit **Zu erledigen**, Priorität **Mittel** und heute als **Startet am**. Für noch nicht beschlossene Vorschläge nutze **Backlog**; gibt es noch kein Startdatum, entferne es. Liegt **Startet am** nach **Fällig am**, steht das unter den Daten, und **Aufgabe erstellen** wartet, bis du es korrigierst.
5. Klicke auf **Aufgabe erstellen** oder drücke im Titel oder in der Beschreibung **⌘+Enter** (**Strg+Enter** unter Windows und Linux); **Enter** im Titel springt zur Beschreibung. Eine Meldung bestätigt die neue Aufgabe, mit **Öffnen**, um zu ihr zu gelangen. Ist unter **Zuständig** ein Agent eingetragen, legt **Erstellen und Agent starten** die Aufgabe an und startet den Agenten in einem Schritt.

Um mehrere Aufgaben nacheinander zu erstellen, schalte vor dem Erstellen unten links im Dialog **Weitere erstellen** ein. Der Dialog bleibt dann offen: Titel, Beschreibung und Anhänge werden für die nächste Aufgabe geleert, Status, Priorität, Zuständig, Daten, Wiederholung und Labels bleiben, wie du sie gesetzt hast. Tale merkt sich den Schalter in diesem Browser.

Auf dem **Board** erstellt jede Spalte in ihrem eigenen Status: Das **+** neben dem Spaltennamen öffnet denselben Dialog mit diesem Status, und **Aufgabe hinzufügen** am Ende der Spalte braucht nur einen Titel. Tippe ihn und drücke **Enter**, um die Aufgabe mit Priorität **Mittel**, heute als Start und mit der Priorität oder Zuständigkeit, nach der das Board gefiltert ist, in diese Spalte zu legen; das Feld bleibt für die nächste offen, **Esc** schließt es.

Ein Titel darf bis zu 200 Zeichen lang sein, eine Beschreibung bis zu 20.000; die meisten Emojis zählen doppelt. Eine längere Beschreibung, ob eingefügt oder von einem früheren Import in der Aufgabe hinterlassen, wird nicht gekürzt: Das Feld nennt die Grenze und zählt die Länge, und **Aufgabe erstellen** oder **Speichern** bleibt nicht verfügbar, bis du sie kürzt.

Tale vergibt eine Kennung aus dem Projektkürzel, etwa `WEB-1`. Verwende sie in Verweisen auf die Arbeit, damit ähnlich benannte Aufgaben unterscheidbar bleiben.

Auch ein Gespräch kann eine Aufgabe anstoßen: **Aufgabe erstellen** im Kopf des Chats öffnet denselben Dialog mit deiner Anfrage, den Dateien des Chats und einem Link zurück, und der Chat verfolgt die Aufgabe danach über seinem Nachrichtenfeld. Siehe [Aus einem Chat eine Aufgabe machen](/de/platform/chat/basics#create-task-from-chat).

Eine Automatisierung, die für Aufgaben gebaut ist, kann in **Aufgabe erstellen** auch eine Vorlage anbieten: Ihr Name steht dann über dem Formular neben **Leere Aufgabe**. Wähle sie, gib den Namen ein, den die Automatisierung verlangt, etwa ein Quartal, und klicke auf **Aufgabe erstellen**; zuständig ist dann die Automatisierung. Gibt es für diesen Namen schon eine Aufgabe, öffnet Tale diese, statt eine zweite anzulegen, und meldet **Für dieses Subjekt existiert bereits eine Aufgabe.** Mitglieder können sie dort lesen und kommentieren, ändern sie aber nur, wenn es ihre eigene ist. Vorlagen, die im Projekt Ordner oder Einstellungsdateien anlegen, stehen nur Redakteuren und höheren Rollen zur Verfügung.

<Tip>

Eine hilfreiche Beschreibung nennt Ausgangsmaterial, gewünschtes Ergebnis und Abschlusskriterium. Zum Beispiel: „Vergleiche den Prüftermin im angehängten Briefing mit den Gesprächsnotizen. Halte Abweichungen in einem Kommentar fest und nenne beide Dateien als Quelle.“

</Tip>

<Frame caption="Die Aufgabendetails stellen Beschreibung, Anhänge, Teilaufgaben und Kommentare neben Zuständigkeit und Status.">

![Die Aufgabe Sign off the launch checklist zeigt den Beschreibungsbereich, Anhänge, Teilaufgaben, Kommentare, Status, Zuständigkeit, Reviewer, Termine, Wiederholung, Labels und Abhängigkeiten.](/images/platform/project-task-detail.webp)

</Frame>

## Wer Aufgaben erstellen und ändern darf

Wer ein Projekt öffnen kann, kann darin Aufgaben erstellen. Redakteure und höhere Rollen dürfen jede Aufgabe im Projekt ändern. Auf Aufgaben, die sie selbst erstellt haben oder die ihnen zugewiesen sind, können Mitglieder:

- Titel, Beschreibung, Anhänge, Teilaufgaben, Termine, Priorität, Labels und Wiederholung bearbeiten.
- Die Aufgabe sich selbst, einem anderen Mitglied des Projekts, einem seiner Agenten oder einer für Aufgaben gebauten Automatisierung zuweisen.
- Den Agenten starten, lenken oder stoppen, auch mit einer @-Erwähnung in einem Kommentar.
- Den Status ändern und ein Ergebnis annehmen, indem sie die Aufgabe auf **Erledigt** setzen.
- Die Aufgabe archivieren oder wiederherstellen.

Das gilt auch für die Teilaufgaben unter einer solchen Aufgabe, egal wer sie angelegt hat, etwa ein Agent, der die Arbeit aufgeteilt hat. Sie hindern ein Mitglied also nie daran, seine Aufgabe abzuschließen. Um **Reviewer** zu ändern, brauchst du Bearbeitungsrechte für das Projekt, auch auf einer selbst erstellten oder dir zugewiesenen Aufgabe.

Aufgaben anderer können Mitglieder lesen und kommentieren. Erwähnen sie dort einen Agenten, bleibt das eine gewöhnliche Erwähnung, die nichts startet. Eigene Kommentare kann jede Person auf jeder Aufgabe bearbeiten und löschen, die sie lesen darf; Inhaber und Admins können auch Kommentare anderer löschen.

Eine archivierte Aufgabe lässt sich lesen, aber nicht ändern. Bis jemand sie wiederherstellt, kann niemand sie kommentieren, ihre Kommentare bearbeiten oder löschen oder ihre Abhängigkeiten ändern; eine Aufgabe, die sie blockiert, kann sie unter **Blockiert von** trotzdem entfernen. Ein Agentenlauf, der schon an der Aufgabe gearbeitet hat, legt sein Ergebnis dort weiterhin ab.

Gibst du eine Aufgabe, die dir zugewiesen war, an jemand anderen weiter, an eine Person oder einen Agenten, gibst du damit auch das Recht ab, sie zu ändern – es sei denn, du hast sie erstellt. Einen Lauf, den du gestartet hast, behältst du aber in der Hand: Übergibt deine @-Erwähnung die Aufgabe an einen Agenten, kannst du diesen Lauf mit weiteren Erwähnungen lenken und mit **Lauf abbrechen** stoppen, bis er endet.

Eine Abhängigkeit gehört zu der Aufgabe, die durch sie blockiert wird. Mitglieder halten Abhängigkeiten deshalb nur für ihre eigenen Aufgaben fest: unter **Blockiert von** bei einer eigenen Aufgabe oder unter **Blockiert** bei jeder Aufgabe, die sie öffnen können, wobei sie eine eigene Aufgabe als die blockierte wählen. Einstellungen, Agenten, Dateien und der Label-Katalog des Projekts bleiben bei Redakteuren und höheren Rollen; Mitglieder wählen aus den Labels, die das Projekt schon hat. Löschen können nur Inhaber und Admins; alle anderen, die eine Aufgabe ändern dürfen, archivieren sie stattdessen.

Für Automatisierungen gilt eine engere Regel, denn eine Automatisierung handelt in eigenem Namen, mit den Connector-Zugangsdaten der Organisation, und nicht im Namen der Person, die sie startet. Mitglieder können eine Aufgabe nur einer für Aufgaben gebauten Automatisierung übergeben, also einem der Einträge unter **Automatisierungen** bei **Zuständig**, oder der Automatisierung, der die Aufgabe schon gehört. Auch starten oder um Änderungen bitten können Mitglieder nur solche Automatisierungen. Alle anderen bleiben Redakteuren und höheren Rollen vorbehalten.

### Agentenläufe, die ein Mitglied startet

Ein Lauf, den jemand ohne Bearbeitungsrecht für das Projekt startet, etwa ein Mitglied, bleibt bei seiner Aufgabe:

- Seine Plattform-Tools ändern nur diese Aufgabe und die Teilaufgaben darunter: Der Agent legt neue Aufgaben nur als Teilaufgaben dieser Aufgabe an, verwendet nur Labels, die das Projekt schon hat, und kann keine Einträge aus anderen Systemen ins Projekt synchronisieren.
- Er kann keine Dokumente im Projekt speichern und keine Wissenseinträge schreiben. Die Dateien, die er erzeugt, landen trotzdem unter **Ergebnisdateien** an der Aufgabe.
- Der Lauf erhält weder die **Secrets** des Agenten noch das Token eines zugeordneten GitHub-Zugangs. Der Agent erfährt, welche Zugangsdaten zurückgehalten wurden, und soll in seinem Bericht darauf hinweisen, wenn die Arbeit sie braucht; dann muss ein Redakteur oder eine höhere Rolle ihn starten. Die Connectors des Agenten funktionieren weiter und handeln im Namen der Person, die den Lauf gestartet hat.
- Er arbeitet in einem eigenen Arbeitsbereich, der für die Läufe dieser Person mit diesem Agenten bestehen bleibt: Dateien aus Läufen, die Redakteure gestartet haben, liegen dort nicht, und was dieser Lauf hinterlässt, erreicht jene Läufe nie. Spätere Läufe derselben Person mit dem Agenten finden ihn wieder, bis Tale ihn löscht: wenn die Person die Organisation verlässt, wenn der Agent gelöscht wird oder sobald ihn so viele Tage kein Lauf genutzt hat, wie die Organisation unter [**Tage ohne Nutzung**](/de/platform/admin/sandboxes#delete-unused-workspaces-automatically) festlegt.

Der Lauf kann weiterhin die Aufgaben und das Wissen des Projekts lesen und behält diese Grenzen auch, wenn ein Redakteur ihn später lenkt. Ein Lauf, den ein Redakteur oder eine höhere Rolle startet, hat auf jeder Aufgabe die volle Ausstattung des Agenten. Der Kommentar eines Mitglieds kann das ändern: Startet die Laufzeit des Agenten neu, um den Kommentar aufzunehmen, wie es [alle Laufzeiten außer Claude Code](/de/platform/agents/harnesses) tun, zählt der Rest des Laufs als Lauf des Mitglieds, mit denselben Grenzen für seine Tools und Zugangsdaten.

## Zuständigkeit und Prüfung festlegen

**Zuständig** bestimmt, wer die Arbeit übernimmt: eine Person, ein Projektagent oder eine im Projekt verfügbare Automatisierung. Unter **Reviewer** wählst du eine Person, einen Projektagenten oder den **Projektstandard** für die Prüfung des Ergebnisses. Diese Auswahl ändern darf nur, wer das Projekt bearbeiten kann. Auch ein menschlicher Reviewer braucht Bearbeitungszugriff. Ein Reviewer-Agent muss zum selben Projekt gehören und ein anderer Agent sein als der, der das Ergebnis erstellt hat.

Einen Agenten zuweisen und seinen Lauf starten sind zwei Entscheidungen. Klicke nach der Zuweisung auf **Agent starten** oder verschiebe die Aufgabe nach **In Bearbeitung**. Lies [Aufgaben automatisieren](/de/platform/projects/task-automation), bevor du Arbeit mit verbundenen Diensten oder Dateiergebnissen startest.

Hat das Projekt keinen eigenen Agenten, bietet **Zuständig** die Option **Standard-Agent** an, den Agenten der Organisation für solche Projekte. Wählst du sie, richtet Tale den Agenten im Projekt ein und weist ihm die Aufgabe zu; [Der Standard-Agent](/de/platform/projects/project-agents#standard-agent) erklärt, wie er arbeitet. Redakteure und höhere Rollen können stattdessen **Agent erstellen …** wählen: **Neuer Agent** öffnet sich über der Aufgabe, und der Agent, den du erstellst, wird ihr zugewiesen. Kann der Standard-Agent für sie nicht laufen, etwa weil ein Admin ihn ausgeschaltet hat, erfahren Mitglieder, dass sie einen Redakteur oder Admin bitten können, im Tab **Agenten** des Projekts einen Agenten hinzuzufügen.

<Frame caption="Zuständig bietet in einem Projekt ohne eigene Agenten den Standard-Agenten der Organisation an.">

![Die Liste für Zuständig, bis zum Abschnitt Agenten gescrollt: der Standard-Agent mit der Beschreibung, dass er der Agent der Organisation für Projekte ohne eigene Agenten ist, darunter der Eintrag zum Erstellen eines Agenten und die Fußzeile, dass der Standard-Agent die Aufgaben übernimmt, bis das Projekt eigene Agenten hat.](/images/platform/project-task-standard-agent.webp)

</Frame>

Ist das Review einer Person zugewiesen, erhält sie die Anfrage, ohne allein über das Ergebnis entscheiden zu dürfen. Auch alle anderen, die die Aufgabe ändern dürfen, können es annehmen: Redakteure und höhere Rollen oder das Mitglied, dem die Aufgabe gehört. Verlangt deine Organisation ein unabhängiges Review, darf die Person, die den geprüften Agentenlauf gestartet hat, sein Ergebnis nicht annehmen; stammt es nicht aus einem Agentenlauf, gilt das für den Ersteller der Aufgabe. Erforderliche menschliche Kompetenzen gelten weiterhin. Ein Review, das einem Agenten zugewiesen ist, braucht dessen Entscheidung oder eine ausdrückliche Übertragung an eine berechtigte Person, bevor ein Mensch es freigeben kann.

Kann die Review-Richtlinie der Organisation nicht gelesen werden oder ist sie ungültig, wird die menschliche Freigabe abgelehnt, auch nach einer Übertragung vom Agenten an eine Person. Ein Organisationsadministrator muss zuerst eine gültige Richtlinienkonfiguration wiederherstellen. Änderungen anzufordern oder ein Review zurückzuziehen funktioniert weiterhin wie bisher.

### Den Standard-Reviewer des Projekts festlegen {#review-default}

Öffne im Tab **Allgemein** den Abschnitt **Aufgabenreviews**, wähle unter **Standard-Reviewer** die gewünschte Option und speichere die Projektänderungen. Anfangs ist **Person** ausgewählt: Zuerst kommt der Aufgabenersteller, dann der Projektersteller zum Zug, sofern die jeweilige Person das Projekt bearbeiten darf. Wähle einen unabhängigen Projektagenten, um ihm neue Reviews zuzuweisen. Das startet den Agenten nicht und erteilt ihm keine Review-Berechtigung; [Einen unabhängigen Reviewer einrichten](/de/platform/projects/task-automation#agent-review) erklärt die weiteren Schritte.

Aufgaben mit **Projektstandard** übernehmen diese Auswahl, wenn ein neues Review beginnt. Eine ausdrücklich benannte Person oder ein Agent bleibt für die jeweilige Aufgabe ausgewählt. Bereits ausstehende Reviews behalten ihren gespeicherten Reviewer, auch wenn sich der Projektstandard ändert. Hat jemand den Standard während deiner Bearbeitung geändert, verwirf deinen veralteten Entwurf und wähle erneut.

Ein Agent als Standard gilt nur für Ergebnisse aus einem nativen Projektagentenlauf, wenn die Organisation weder eine unabhängige menschliche Prüfung noch Kompetenznachweise verlangt. Reicht eine Person oder Automation Arbeit ohne einen solchen Lauf ein, greift die menschliche Prüferkette. Zum Speichern einer Agentenauswahl braucht der Agent die Review-Berechtigung; eine Aufgabe kann nicht ihren ausführenden Agenten als Reviewer wählen. Ein bereits ausstehendes Review wechselt bei einer geänderten Berechtigung, Zuweisung oder Richtlinie nicht automatisch den Reviewer.

### Ein ausstehendes Review übertragen {#transfer-review}

Öffne die Aufgabe und lies **Aktuelles Review** unter **Reviewer**. Dort steht, wer die ausstehende Prüfung übernommen hat; das kann vom aktuellen Projektstandard abweichen. Wählst du einen anderen Reviewer, überträgst du auch dieses Review, ohne die Zuständigkeit für die Arbeit zu ändern oder einen Lauf zu starten. Mit **Projektstandard** überträgst du es an die aktuelle Standardauswahl des Projekts. Haben sich Reviewer oder Ergebnis seit dem Laden geändert, wird die Übertragung abgelehnt. Prüfe den aktualisierten Stand, bevor du erneut wählst.

Ein Agent darf nur ein abgeschlossenes Ergebnis eines anderen Projektagenten prüfen. Weist du die Aufgabe jemand anderem zu, bleibt der ursprüngliche Agent als Ersteller des Ergebnisses vermerkt; die ausstehende Entscheidung des prüfenden Agenten ist jedoch blockiert. Soll die neue Zuweisung bestehen bleiben, übertrage die Prüfung dieses Ergebnisses ausdrücklich an eine berechtigte Person. Die Prüfrichtlinie der Organisation gilt weiterhin.

Ein laufender Prozess oder eine offene Frage kann die Übertragung an einen Agenten verhindern. Gibt es keinen unterstützten abgeschlossenen Agentenlauf oder verlangt die Richtlinie eine unabhängige menschliche Prüfung oder Kompetenznachweise, wähle eine berechtigte Person. Ist ein Agent nicht verfügbar oder fehlt ihm die Review-Berechtigung, zeigt die Aufgabe den Grund an; die Prüfung geht nicht stillschweigend an dich zurück.

Das aktuelle Review erklärt auch eine unzulässige Selbstprüfung, eine geänderte Zuweisung der Umsetzung und eine nicht lesbare Richtlinie. Behebe die angezeigte Ursache oder übertrage die Prüfung ausdrücklich; das Ergebnis des Laufs bleibt aufgezeichnet. Eine wiederholte Aufgabe behält einen ausdrücklich gewählten Agenten auch dann als Reviewer, wenn er gelöscht wurde oder seine Berechtigung verloren hat. Korrigiere diese Auswahl, statt unbemerkt einen anderen Reviewer zu übernehmen.

## Fortschritt mit dem Status zeigen

Ändere den **Status** in den Aufgabendetails oder ziehe die Karte auf dem **Board** in eine andere Spalte. Die Statusauswahl lässt sich auch mit der Tastatur bedienen.

| Status | Bedeutung |
| --- | --- |
| **Backlog** | Vorgeschlagene Arbeit, die noch nicht beschlossen ist. |
| **Zu erledigen** | Arbeit, die begonnen werden kann. |
| **In Bearbeitung** | Die Arbeit läuft. Bei einer Agentenaufgabe startet der Wechsel hierhin den Lauf. |
| **In Prüfung** | Ein Ergebnis wartet auf seinen menschlichen Reviewer oder Reviewer-Agenten. |
| **Erledigt** | Die abgeschlossene Arbeit wurde angenommen. |
| **Abgebrochen** | Die Arbeit wird nicht weitergeführt. |

Bei Agentenaufgaben kann ein Statuswechsel die Ausführung starten oder abbrechen. Lies deshalb den Aktionshinweis vor dem Verschieben. Ein Agent liefert sein Ergebnis unter **In Prüfung** ab; auf **Erledigt** darf er es nicht selbst setzen.

### Den Ablauf einer verbundenen Quelle nutzen

Eine Aufgabe, deren verbundenes Quellsystem den Geschäftsablauf steuert, kann in ihren Details **Ablauf der Quelle** anzeigen. Wähle die Aktion der Quelle, ergänze ihre Felder und klicke auf **Anfrage senden**. Die Quelle prüft deine Identität, Rolle und Übergangsregeln, bevor sie die Aufgabe aktualisiert. Trage erforderliche Prüfnotizen, Abschlussbelege oder Wiedereröffnungsgründe in diesem Formular ein; eine Board-Spalte kann diese Angaben nicht erfassen und zwei Quellphasen, die beide als **In Prüfung** erscheinen, nicht unterscheiden.

Während die Quelle eine Anfrage prüft, zeigt die Aufgabe den ausstehenden Zustand und verhindert eine zweite Anfrage. Das angenommene Ergebnis oder der Ablehnungsgrund bleibt nach dem Neuladen sichtbar. Bei einer Ablehnung bleibt der gültige Quellzustand erhalten; lies den Grund, bevor du eine weitere Aktion anfragst. Eine Quelle kann für einen archivierten Datensatz eine geschützte Wiedereröffnung anbieten. Diese Aktionen verlangen ein verifiziertes, aktives Konto und das Recht, die Aufgabe zu bearbeiten.

## Entscheidungen an der Aufgabe festhalten

Öffne die Aufgabe, um Beschreibung, Anhänge, Termine, Labels, Teilaufgaben oder Kommentare zu ergänzen. Halte Fragen, Entscheidungen und Rückmeldungen in Kommentaren fest, die spätere Prüfer nachvollziehen können.

Mit `@` im Kommentarfeld öffnest du die Erwähnungsauswahl. Eine Erwähnung des zuständigen Agenten ist eine Anweisung: Sie kann einen laufenden Agenten steuern oder einen neuen Lauf auslösen, wenn er gerade nicht arbeitet. Ein Kommentar ohne Erwähnung hält die Diskussion fest, ohne diese Agentenaktion anzufordern.

Erwähnungen in der Beschreibung der Aufgabe wirken beim Speichern genauso: Die genannten Personen werden benachrichtigt, und ein genannter Agent wird gesteuert oder startet einen Lauf, wie oben beschrieben. Startet er einen Lauf, wechselt die Aufgabe nach **In Bearbeitung**, egal in welcher Spalte du sie angelegt hast. Bearbeitest du die Beschreibung später, zählen nur die Erwähnungen, die du hinzufügst. Formulierst du den Text um eine bestehende Erwähnung herum um, wird niemand erneut benachrichtigt. Der Agent liest die Beschreibung so, wie sie beim Start seines Laufs lautet. Änderst du sie, solange der Lauf noch wartet, arbeitet er also mit deiner neuen Fassung.

Nutze **Teilaufgaben** für Ergebnisse, die sich einzeln prüfen lassen. Eine Teilaufgabe nennt oben in ihren Details die übergeordnete Aufgabe (**Teil von …**); klicke darauf, um zu ihr zurückzukehren. Solange noch eine Teilaufgabe offen ist, lässt sich die übergeordnete Aufgabe nicht nach **Erledigt** oder **Abgebrochen** verschieben. Alle anderen Status bleiben verfügbar, auch **Zu erledigen**. Unter **Abhängigkeiten** siehst du, welche Aufgaben diese Aufgabe blockieren und welche sie selbst blockiert. Kreisförmige Abhängigkeiten sind nicht zulässig.

Änderst du ein Feld, zeigt die **Aktivität** der Aufgabe seinen Wert davor und danach. Leerst du ein Feld, steht dort, was übrig bleibt, etwa **Kein Fälligkeitsdatum** oder **Nicht zugewiesen**, und nicht bloß der alte Wert. Titel, Beschreibungen, Labels und Dateinamen erscheinen genau so, wie sie geschrieben wurden, auch wenn der Text einem Statusnamen wie `done` entspricht. Status, Prioritäten, Datumsangaben und die Angaben für ein leeres Feld erscheinen in deiner Sprache.

## Wiederkehrende Aufgaben einrichten

Kommt dieselbe Arbeit regelmäßig wieder, etwa ein wöchentlicher Statusbericht, gib der Aufgabe eine Wiederholung. Jedes Mal, wenn du sie abschließt, steht die nächste Aufgabe in **Zu erledigen** bereit, fällig am nächsten Tag, den die Wiederholung vorsieht.

Klicke in den Details der Aufgabe oder im Dialog **Aufgabe erstellen** auf **Wiederholen** direkt unter **Fällig am** und wähle, wie sich die Aufgabe wiederholt. Deine Wahl wird gespeichert, sobald du sie anklickst:

- **Nie**
- **Täglich**
- **Jeden Werktag**, von Montag bis Freitag
- **Wöchentlich am …**, **Monatlich am …** oder **Jährlich am …**: Sie richten sich nach dem Tag des Fälligkeitsdatums. Hat die Aufgabe keines, zählt ihr Startdatum, wenn es noch bevorsteht, sonst der heutige Tag.

<Frame caption="Wähle die Wiederholung in den Aufgabendetails; die Vorschau zeigt die nächsten Fälligkeiten.">

![Das Menü Repeat der Aufgabe Sign off the launch checklist listet Never, Daily, Every weekday, nach dem Fälligkeitsdatum benannte wöchentliche, monatliche und jährliche Optionen, von denen die wöchentliche ausgewählt ist, und Custom, darunter die nächsten Fälligkeiten und die Option, die nächste Aufgabe am Fälligkeitstag zu erstellen.](/images/platform/project-task-repeat.webp)

</Frame>

**Nächste Fälligkeiten** zeigt, wann die nächsten drei Aufgaben fällig werden. Hat die Aufgabe noch kein Fälligkeitsdatum, bekommt sie eines, sobald du eine Wiederholung wählst: den ersten passenden Tag ab heute oder ab ihrem Startdatum, wenn dieses später liegt. Eine monatliche Wiederholung am 31. fällt in kürzeren Monaten auf den letzten Tag des Monats. Entfernst du das Fälligkeitsdatum einer Aufgabe, die sich schon wiederholt, bleibt die Wiederholung bestehen: Die nächste Aufgabe entsteht dann, wenn du diese abschließt, fällig am ersten passenden Tag danach, und **Wiederholen** weist beim Öffnen darauf hin. Jede Änderung an der Wiederholung gibt der Aufgabe wieder ein Fälligkeitsdatum.

Liegen die Termine außerhalb des unterstützten Datumsbereichs, weist die Vorschau darauf hin. Wähle ein früheres Start- oder Fälligkeitsdatum, bevor du die Wiederholung festlegst.

### Eine eigene Wiederholung festlegen

Für jeden anderen Rhythmus wählst du in derselben Liste **Benutzerdefiniert**. Wähle **Tag**, **Woche**, **Monat** oder **Jahr**, lege fest, wie oft die Aufgabe wiederkommt, und wähle die Wochentage, den Tag im Monat oder das Datum, etwa alle 2 Wochen am Dienstag und Donnerstag. **Nächste Fälligkeiten** passt sich jeder Änderung an. Mit **Speichern** übernimmst du die Wiederholung. **Abbrechen**, **Escape** oder ein Klick außerhalb der Liste verwerfen deine Änderungen; der Pfeil zurück führt zur Liste und behält sie bei.

### Die nächste Aufgabe am Fälligkeitstag erstellen

Normalerweise entsteht die nächste Aufgabe, sobald du diese auf **Erledigt** oder **Abgebrochen** setzt. Soll die Arbeit pünktlich wiederkommen, auch wenn die letzte Runde noch nicht fertig ist, öffne **Wiederholen** bei einer wiederkehrenden Aufgabe, wähle unter den Terminen **Nächste Aufgabe am Fälligkeitstag erstellen** und klicke auf **Speichern**. Die nächste Aufgabe entsteht dann zu Beginn des Fälligkeitstags, um Mitternacht in der Zeitzone der Person, die die Wiederholung eingerichtet hat, auch wenn diese Aufgabe noch offen ist. Ist die Aufgabe schon fällig, erscheint die nächste innerhalb weniger Minuten, und schließt du die Aufgabe vor ihrem Fälligkeitstag ab, entsteht die nächste sofort. In der Aktivität der Aufgabe steht **System** als Urheber. **Wiederholen** zeigt dann ein Kalendersymbol, und der Tooltip des Wiederholungssymbols auf dem **Board** und in der **Liste** endet mit **nächste Aufgabe am Fälligkeitstag**.

Offene Aufgaben halten eine solche Serie nicht mehr auf, deshalb können sie sich stapeln, wenn niemand sie abschließt. Eine Serie hat nie mehr als 10 offene Aufgaben: Die nächste wartet, bis jemand eine davon abschließt. Änderst du die Wiederholung oder wählst erst **Nie** und dann wieder eine Wiederholung, zählen die noch offenen Aufgaben der Serie weiterhin mit.

### Was die nächste Aufgabe mitbringt

Die nächste Aufgabe hat eine eigene Kennung und beginnt in **Zu erledigen**. Sie übernimmt Titel, Beschreibung, Priorität, Labels, Anhänge, Zuständigkeit, Reviewer, die Personen, die die Aufgabe verfolgen, und die Wiederholung. Ihre Teilaufgaben kommen mit, jede wieder in **Zu erledigen** und mit Terminen, die um denselben Schritt verschoben sind, samt den Abhängigkeiten zwischen ihnen. Kommentare, Abhängigkeiten zu anderen Aufgaben, archivierte Teilaufgaben und die Dateien, die ein Agent erzeugt hat, bleiben bei der vorherigen Aufgabe. Personen kommen nur mit, solange sie noch Zugriff haben: die Zuständigkeit, solange sie noch so vergeben werden kann, der Reviewer, solange er das Projekt noch bearbeiten darf, und wer die Aufgabe verfolgt, solange er das Projekt noch sehen kann. Wer die Aufgabe nicht mehr verfolgt, verfolgt auch die nächste nicht, selbst wenn er sie erstellt hat.

Die nächste Aufgabe ist am ersten passenden Tag nach dem Fälligkeitsdatum der vorherigen fällig, und ein Startdatum liegt wieder gleich viele Tage davor. Dieses Fälligkeitsdatum liegt nie in der Vergangenheit: Schließt du eine Aufgabe verspätet ab, ist die nächste heute oder am nächsten passenden Tag fällig. So sammeln sich für verpasste Termine keine überfälligen Aufgaben an.

Unter **Wiederholen** verweist die vorherige Aufgabe auf die nächste, etwa mit **Nächste Aufgabe: WEB-13**. Öffnest du die vorherige Aufgabe wieder und schließt sie erneut ab, entsteht keine zweite. Auf dem **Board** und in der **Liste** kennzeichnet ein Wiederholungssymbol die Aufgabe, die die Serie gerade weiterführt; sein Tooltip nennt die Wiederholung.

### Eine Serie beenden

Schließt du eine wiederkehrende Aufgabe ab, nennt die Meldung **Nächste Aufgabe erstellt** das Fälligkeitsdatum der nächsten und bietet **Wiederholung beenden** an. Dieselbe Schaltfläche bleibt bei der Aufgabe, die die nächste erstellt hat, unter **Wiederholen** neben **Nächste Aufgabe**, solange sich die nächste Aufgabe noch wiederholt. Hat noch niemand die nächste Aufgabe angefasst (sie steht unverändert in **Zu erledigen**, ohne Kommentare und ohne Agentenlauf), wird sie samt ihren Teilaufgaben entfernt. Andernfalls bleibt sie bestehen und wiederholt sich nicht mehr. In beiden Fällen endet die Serie: Bei der Aufgabe, von der aus du sie beendet hast, zeigt **Wiederholen** dann **Nie**, und der Tooltip lautet **Die Serie wurde beendet.** Hast du die Schaltfläche unter **Wiederholen** verwendet, springt der Fokus danach auf **Wiederholen**. Du kannst auch bei der neuesten Aufgabe der Serie **Wiederholen** auf **Nie** stellen.

**Wiederholung beenden** wirkt nur auf Aufgaben, die du ändern darfst: auf die, bei der du es verwendest, und auf die späteren Aufgaben der Serie, die du ebenfalls ändern darfst. Frühere Aufgaben zeigen ihre Wiederholung weiterhin an. Gehört eine spätere Aufgabe inzwischen jemand anderem, etwa weil sie neu zugewiesen wurde, behält sie ihre Wiederholung, und die Serie geht von ihr aus weiter; eine nächste Aufgabe wird dann nicht entfernt.

Löschst du die neueste Aufgabe einer Serie, endet die Serie. Die Aufgabe davor erstellt keine weitere, auch wenn du sie wieder öffnest und erneut abschließt: Sie zeigt kein Wiederholungssymbol, und ihr Feld **Wiederholen** bleibt gesperrt, mit dem Tooltip **Die nächste Aufgabe wurde gelöscht. Diese Aufgabe kann sich nicht noch einmal wiederholen.** Löschst du eine frühere Aufgabe, geht die Serie bei der neuesten weiter.

### Wenn sich die Wiederholung nicht ändern lässt

Zeige auf **Wiederholen** oder setze den Tastaturfokus darauf, um zu lesen, warum das Feld gesperrt ist:

- Hat eine Aufgabe ihre nächste Aufgabe schon erstellt, führt diese die Serie weiter, und die Aufgabe selbst wiederholt sich nicht mehr, auch wenn du sie wieder öffnest. Solange die Serie weitergeht, änderst du die Wiederholung bei der nächsten Aufgabe; **Nächste Aufgabe** öffnet sie. Wurde die Serie beendet oder die nächste Aufgabe gelöscht, zeigt **Wiederholen** das an.
- Jede andere Aufgabe in **Erledigt** oder **Abgebrochen** behält die Wiederholung, mit der sie abgeschlossen wurde. Öffne sie wieder, um die Wiederholung zu ändern.
- Eine Teilaufgabe hat keine eigene Wiederholung. Solange sich die übergeordnete Aufgabe wiederholt, steht bei **Wiederholen** zum Beispiel **Mit WEB-3**, und jede nächste Aufgabe der übergeordneten bringt eine neue Kopie der Teilaufgabe mit. Eine archivierte Teilaufgabe hat kein Feld **Wiederholen**: Sie kommt nicht wieder. Folgt eine Arbeit ihrem eigenen Rhythmus, braucht sie eine eigene Aufgabe.
- Eine Aufgabe, die einer Automatisierung gehört, wiederholt sich nicht. Weist du eine wiederkehrende Aufgabe einer Automatisierung zu, endet ihre Serie.
- Im Dialog **Aufgabe erstellen** zeigt das Feld **Wiederholen** den Wert **Nie**, solange **Status** auf **Erledigt** oder **Abgebrochen** steht oder eine Automatisierung zuständig ist.

## Das Ergebnis vor dem Abschluss prüfen

Vergleiche bei menschlicher Arbeit das Ergebnis mit dem Abschlusskriterium in der Beschreibung. Lies bei Agentenarbeit den Bericht in den Kommentaren und prüfe die erzeugten Dateien. Ein beendeter Lauf zeigt, dass der Agent nicht mehr arbeitet. Ob das Ergebnis angenommen wurde, siehst du an der erfassten Review-Entscheidung.

Setze die Aufgabe auf **Erledigt**, sobald sie die Anforderung erfüllt. Soll ein Agent nacharbeiten, beschreibe die nötige Änderung in einem Kommentar und erwähne ihn darin. [Aufgaben automatisieren](/de/platform/projects/task-automation) erklärt Wiederholungen, Nacharbeit und Abbruch.

## Deine Aufgaben aus Start öffnen

[Start](/de/platform#home) listet die offenen Aufgaben, die dir zugewiesen sind oder auf dein Review warten, aus allen Projekten, die du lesen darfst; **Aufgaben** über der Liste zeigt nur sie. Öffnest du dort eine Aufgabe, erscheint sie als eigene Seite neben der Seitenleiste von **Start** und nicht im Dialog des Boards:

- Oben steht der Auftrag als Karte: Beschreibung, Anhänge und Teilaufgaben.
- Darunter folgt die Diskussion wie ein Gespräch, mit den ältesten Einträgen zuerst und nach Tagen gegliedert; das Datum bleibt oben stehen, während du durch seinen Tag scrollst. Deine eigenen Kommentare stehen rechts, wie in einem Chat. Die der anderen, Personen und Agenten, stehen links unter ihrem Namen, bei einem Agenten mit dem Hinweis **Agent**, und mit der Uhrzeit. Von einem langen Kommentar, etwa dem Bericht eines Agenten, siehst du den Anfang; **Weiterlesen** öffnet den Rest an Ort und Stelle, **Weniger anzeigen** klappt ihn wieder zu.
- Der Verlauf der Aufgabe steht als kurze Zeilen zwischen den Kommentaren, etwa Statuswechsel, Zuweisungen und Agentenläufe. Drei oder mehr hintereinander werden zu einer Zeile zusammengefasst, etwa **5 Änderungen**, mit den Namen derer, die sie gemacht haben; wähle sie aus, um jede einzeln zu sehen.
- Das Kommentarfeld steht ganz unten. Zum Senden drückst du **⌘+Enter** oder **Ctrl+Enter** oder klickst auf die runde Senden-Schaltfläche; **Enter** allein beginnt eine neue Zeile. Mit `@` erwähnst du einen Agenten oder eine Person, mit derselben Wirkung wie im Dialog des Boards. Was du noch nicht gesendet hast, bleibt für diese Aufgabe im Feld stehen, hier wie im Dialog des Boards. Solange du woanders arbeitest, zeigt die Zeile der Aufgabe in **Start** den Hinweis **Entwurf**.
- **Details** neben der Diskussion enthält Status, Priorität, Zuständigkeit, Reviewer, Termine, Wiederholung, Labels und Abhängigkeiten, dazu **Verfolgen** und **Archivieren**. Inhaber und Administratoren der Organisation finden dort zusätzlich **Löschen**: Es entfernt die Aufgabe samt Teilaufgaben, Kommentaren und Dateien endgültig und stoppt ihre laufenden Agentenläufe. **Details ausblenden** am Ende der Kopfzeile blendet diesen Bereich aus, **Details einblenden** holt ihn zurück. Ist das Fenster zu schmal für beides nebeneinander, öffnet **Details einblenden** die Details stattdessen in einem Fenster über der Diskussion — von der Seite oder, auf dem Smartphone, vom unteren Bildschirmrand.

**Board** in der Kopfzeile öffnet das Aufgaben-Board des Projekts. Öffnest du eine Aufgabe dort, erscheint sie weiterhin im Dialog des Boards, mit derselben Titelzeile; beide Ansichten bearbeiten dieselbe Aufgabe. **Als Seite öffnen**, das Vergrößern-Symbol neben **Schließen** im Dialog, öffnet die Aufgabe hier auf ihrer eigenen Seite, und **Zurück** im Browser führt zum Board mit offenem Dialog. Eine Beschreibung, die du gerade bearbeitest, wird nicht übernommen; speichere sie vorher. **Link kopieren** im Dialog kopiert denselben Seitenlink. **Link kopieren**, das Link-Symbol neben **Board**, kopiert den Link zu dieser Aufgabenseite. Die Kennung der Aufgabe, etwa `WEB-2`, kopierst du mit einem Klick darauf in der Zeile unter dem Titel. Eine kurze Meldung bestätigt jede Kopie.

## Aufgaben finden, die Aufmerksamkeit brauchen

Grenze das Board mit **Filter** ein oder wechsle zur **Liste**, um Zeilen zu überfliegen. Lass Vorschläge im [Backlog](/de/platform/projects/backlog), bis sie begonnen werden sollen. Nutze Labels für Unterscheidungen, die keinen eigenen Status brauchen.

**Tasks durchsuchen** grenzt das Board zusammen mit **Filter** ein. Jede Aufgabe, die zu beidem passt, erscheint, egal wie viele es sind. Die Suche findet Aufgaben, deren Titel, Beschreibung oder Kennung, etwa `WEB-12`, jedes eingegebene Wort enthält, und Aufgaben mit einem Kommentar, der alle diese Wörter enthält. Das Board fasst bis zu 2.000 Aufgaben. In einem größeren Projekt sagt ein Hinweis, dass nur die ersten 2.000 angezeigt werden; über die Suche erreichst du die übrigen.

Können die Aufgaben nicht geladen werden, sagt das Board das, statt leere Spalten zu zeigen, und deine Suche und deine Filter bleiben, wie sie sind. Wähle **Erneut versuchen**, um sie zu laden. Schlägt eine Aktualisierung fehl, bleiben die angezeigten Aufgaben stehen, und ein Hinweis sagt, dass sie dem zuletzt geladenen Stand entsprechen. Ein Hinweis erscheint auch, wenn die Abhängigkeiten oder die Aktivität der Agenten und Reviews nicht geladen werden können, denn dann sind blockierte Aufgaben, laufende Agenten, offene Fragen und ausstehende Reviews möglicherweise nicht markiert. **Erneut versuchen** in einem Hinweis lädt nur, was fehlgeschlagen ist.

Mit der Tastatur drückst du **Enter** auf **Filter**: Das Panel öffnet sich beim ersten Filter, **Zuständig**. Mit **Enter** klappst du ihn auf, mit **Tab** erreichst du seine Optionen. Die Pfeiltasten wählen eine aus, und das Board folgt sofort. Die **Leertaste** wählt die Option, auf der der Fokus steht, und hebt die Auswahl auf, wenn sie schon gewählt ist. **Tab** führt zum nächsten Filter, und **Escape** schließt das Panel.

In den Ansichten **Board** und **Liste** erreichst du den Aufgabentitel mit **Tab**. Drücke dann **Enter**, um die Aufgabe zu öffnen.

Kannst du die Aufgabe bearbeiten, drückst du auf ihrem Titel die **Leertaste**, um sie aufzunehmen. Verschiebe sie mit den Pfeiltasten und lege sie mit der **Leertaste** wieder ab. **Escape** bricht das Verschieben ab und lässt die Aufgabe, wo sie war. Ein Screenreader nennt die Aufgabe beim Aufnehmen und sagt beim Verschieben ihren Status und ihre Position an.

Prüfe bei einer abgelehnten Änderung zuerst den Zustand der Aufgabe: Ein aktiver Agentenlauf verhindert die Neuzuweisung, offene Teilaufgaben verhindern den Abschluss, und deine Rolle und ob es deine Aufgabe ist, entscheiden darüber, ob du sie überhaupt ändern darfst.
