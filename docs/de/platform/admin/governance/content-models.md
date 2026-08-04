---
title: Inhalte und Modelle
description: Modell-Ebenen-Kontrollen — welche Modelle pro Rolle oder Team erlaubt sind und das Default-Modell, auf dem jede Benutzergruppe landet. Admins und Inhaber lesen das, wenn eine Compliance-Regel eine Last an ein freigegebenes Modell bindet oder wenn ein Team einen günstigeren Default braucht.
---

Inhalte und Modelle ist die Oberfläche, auf der du entscheidest, welche LLMs die Personen in deiner Organisation erreichen können und auf welchem jede Gruppe per Default landet. Sie verbindet eine Zulassungs- oder Sperrliste pro Bereich (Organisation, Team, Rolle, Benutzer) mit einer Default-Modell-Regel, die der Resolver anwendet, wenn weder ein Agent noch eine Konversation die Wahl überschrieben hat. Admins und Inhaber lesen diese Seite, wenn eine Compliance-Regel eine Last an ein freigegebenes Modell bindet, wenn ein Team auf einem günstigeren Modell als der Rest der Organisation landen soll, oder wenn ein neues Modell eines bestehenden Anbieters erreichbar gemacht werden muss.

<Frame caption="Governance > Inhalte & Modelle — der verpflichtende System-Prompt-Präfix und -Suffix über den Default-Modell-Regeln pro Bereich.">

![Die Governance-Seite Inhalte und Modelle zeigt die Felder für den verpflichtenden System-Prompt-Präfix und -Suffix, gefüllt mit den Hausregeln der Organisation, über einer Tabelle mit drei Default-Modell-Regeln — einem Default für alle Benutzer und je einer Rollen-Regel für Entwickler und Mitglied, jede auf ein OpenRouter-Modell festgelegt.](/images/platform/governance-content-models.webp)

</Frame>

## Ein durchgespielter Default

Um das Default-Modell für die Redakteur-Rolle zu setzen, öffne **Einstellungen > Richtlinien > Standardmodelle** und klick auf **Regel hinzufügen**. Wähle **Rolle** als Bereich, **Redakteur** als Ziel, dann wähle den Anbieter und das Modell. Speichern, und die nächste Anfrage eines Redakteurs ohne expliziten Per-Agent- oder Per-Konversations-Override landet auf dem Modell der Regel. Engere Bereiche gewinnen — eine Benutzerregel schlägt eine Team-Regel schlägt eine Rollen-Regel schlägt den Org-Default.

## Die zwei Ebenen

**Modellzugriff** ist die Zulassungs- oder Sperrliste, die regelt, welche Modelle ein Bereich überhaupt nutzen darf. Ein Modell, das nicht auf der Zulassungsliste steht, ist für diesen Bereich unsichtbar — die Auswahl blendet es aus und der Resolver weigert sich, daran zu binden, selbst wenn ein Agent es gepinnt hat. Greif zur Zulassungsliste, wenn ein Regulierer die freigegebenen Modelle benennt; greif zur Sperrliste, wenn ein einzelnes Modell überall sonst nicht erreichbar sein soll.

**Standardmodelle** ist die Resolver-Regel, die das Modell auswählt, wenn nichts anderes es getan hat — kein Per-Agent-Override, kein Per-Konversations-Override. Der Default wirkt in dem Moment, in dem der Benutzer einen frischen Chat startet, und wirkt als Fallback, wenn das gepinnte Modell eines Agents nicht erreichbar ist.

## Bereiche und Vorrang

Beide Ebenen tragen einen Bereich: Organisation, Team, Rolle oder Benutzer. Der Resolver wertet von eng nach weit aus — Benutzer schlägt Team schlägt Rolle schlägt Org-Default. Die Modellzugriffs-Ebene kombiniert mit der Default-Modell-Ebene; der Default, den der Resolver wählt, muss auch die Zugriffsprüfung für denselben Bereich bestehen, andernfalls fällt der Resolver auf das nächste erlaubte Modell zurück.

## Zulassungs- und Sperrlisten-Warnungen

Der Default-Modell-Editor zeigt eine Warnung, wenn eine Regel ein Modell nennt, das die Zulassungsliste für denselben Bereich nicht erlaubt, oder wenn die Sperrliste für denselben Bereich es blockiert. Die Warnung blockiert das Speichern nicht — der Resolver wird zur Anfragezeit zurückfallen — aber sie markiert die Diskrepanz, damit du das eine oder das andere korrigieren kannst.

## Das Modell, das Bilder liest

Nicht jedes Modell kann sehen. Öffnet ein Agent auf einem reinen Textmodell einen Screenshot, eine eingescannte Rechnung oder eine gerenderte Folie, gibt Tale dieses Bild an ein zweites Modell und liefert dem Agenten die Abschrift zurück. Das läuft über das Gateway, es gelangt also kein Provider-Schlüssel in die Sandbox — und Modelle, die Bilder ohnehin lesen, überspringen den Umweg ganz.

**Modell für Bilder** legt fest, wer diese Arbeit übernimmt. Bleibt es auf **Automatisch**, wählt Tale selbst: bevorzugt ein empfohlenes Modell für Bilder, sonst das günstigste, das deine Zugänge erreichen. Die Zeile unter der Auswahl nennt immer das Modell, das die Bilder gerade liest, und warum es gewählt wurde — die Frage „welches Modell liest unsere Bilder" bleibt damit nie offen.

Lege ein Modell fest, wenn diese Wahl stehen bleiben soll. Automatisch liest einen aktuellen Provider-Katalog, das günstigste erreichbare Modell wechselt also mit jeder neuen Veröffentlichung — ein festgelegtes Modell hält die Strecke auf dem, das du getestet hast. Angeboten werden nur Modelle, die tatsächlich abschreiben können: Modelle, die Medien erzeugen, und kostenlose Zugänge fallen heraus, weil beide ein Bild annehmen und die Anfrage dann verweigern. Ist ein festgelegtes Modell später nicht mehr erreichbar — der Zugang wurde rotiert, die Zulassungsliste enger, der Provider hat es entfernt — protokolliert Tale das und fällt auf Automatisch zurück, statt deine Agenten blind arbeiten zu lassen.

## Wo das hingehört

Inhalte und Modelle ist die Schleuse, die jeder Chat und jeder Agent zur Anfragezeit durchläuft. Modellzugriff mit Standardmodellen zu kombinieren erlaubt dir, eine enge Compliance-Haltung auszuliefern, ohne jedem Agent-Autor das Modell aufzuzwingen, das in diesem Quartal genehmigt ist. Die Begleitseite ist [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits) — sie deckt die Kosten- und Anfragen-Limits ab, die zusätzlich zu den hier getroffenen Modellwahlen gelten.
