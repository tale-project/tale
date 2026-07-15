---
title: Prompt-Bibliothek
description: Die Prompt-Bibliothek ist der Ort, an dem du Chat-Prompts zur Wiederverwendung speicherst — persönlich, Team oder organisationsweit. Mitglieder, Redakteure und Entwickler lesen das, wenn sie einen wiederkehrenden Chat-Starter griffbereit halten.
---

Die Prompt-Bibliothek ist die Oberfläche gespeicherter Prompts von Tale. Dort hältst du die Chat-Starter, nach denen du mehr als einmal greifst — einen Schreib-Stimmen-Prompt, den du für jeden Kunden-Mail-Entwurf wiederverwendest, einen Debugging-Prompt, den dein Team weiterreicht, einen Recherche-Prompt, auf den sich die ganze Organisation einigen sollte. Jede Rolle über Deaktiviert kann Prompts speichern und nutzen; der **Sichtbarkeits**-Hebel jedes Prompts entscheidet, wer ihn sonst sieht.

Diese Seite ist die Referenz dafür, was ein Prompt ist, wie sich die drei Sichtbarkeits-Stufen verhalten, wie der Versionsverlauf funktioniert und wie Prompts in einen Chat gelangen. Die Bibliothek liegt unter **Prompts** in der Sidebar; dieselbe Bibliothek erscheint inline im Chat.

<Frame caption="Die Prompt-Bibliothek über dem Chat — bereitgestellte Starter-Prompts mit den Sichtbarkeits-Tabs und Filtern, die die Liste eingrenzen.">

![Der Prompt-Bibliotheks-Dialog offen über dem Chat, listet bereitgestellte Starter-Prompts mit Sichtbarkeits-Tabs und einer Filterzeile darüber.](/images/platform/prompt-library-dialog.webp)

</Frame>

## Was ein Prompt ist

Ein Prompt ist ein gespeicherter Textbrocken — meist eine Frage oder eine Anweisung, die du sonst in den Chat tippen würdest — mit einem Titel und ein paar Metadaten-Feldern. Wenn du in Chat zu einem gespeicherten Prompt greifst, fügt Tale seinen Inhalt in den Chat; du kannst vor dem Senden bearbeiten, der Prompt ist keine verdeckte Systemnachricht.

Jeder Prompt trägt:

- Einen **Titel** (im Picker verwendet; automatisch aus dem Inhalt generiert, wenn du ihn leer lässt).
- Den **Inhalt** (den eigentlichen Prompt-Text).
- Eine **Sichtbarkeit** — `Persönlich`, `Team` oder `Global`.
- Eine optionale **Team**-Bindung (wenn Sichtbarkeit `Team` ist).
- Optionale **Tags** zum Filtern.

Die Bibliothek ist nach Titel und Inhalt suchbar, nach Sichtbarkeit und Tag filterbar und nach Aktualität sortierbar. Der Inline-Picker des Chats ist dieselbe Bibliothek mit denselben Filtern.

## Die drei Sichtbarkeits-Stufen

**Persönlich** ist nur für deine Augen. Ein persönlicher Prompt erscheint in deiner eigenen Bibliothek und nirgendwo sonst; niemand in der Organisation kann ihn sehen. Greif zu persönlich, wenn der Prompt auf deinen eigenen Workflow geformt ist und der Rest des Teams nicht profitieren würde.

**Team** ist mit einem Team geteilt. Wähl das Team beim Speichern; jedes Mitglied dieses Teams sieht den Prompt in seiner Bibliothek. Greif zu Team, wenn der Prompt auf eine bestimmte Funktion geformt ist — der Antwort-Ton-Prompt des Support-Teams, der Bug-Triage-Prompt des Entwickler-Teams — und der Rest der Organisation nicht profitieren würde.

**Global** ist organisationsweit. Jedes Mitglied der Organisation sieht den Prompt in seiner Bibliothek. Greif zu Global, wenn der Prompt eine Entscheidung kodiert, die die ganze Organisation gleich treffen sollte — die Schreibstimme, die die Marke erwartet, die Fragen-Vorlage, mit der jeder Recherchierende starten sollte.

Sichtbarkeit ist beim Speichern setzbar und später bearbeitbar. Einen persönlichen Prompt zu Global hochzustufen ist ein Klick und löst keine Migration auf den Chats aus, die ihn schon nutzten — alte Chats behalten ihren eingefügten Inhalt, die neue Sichtbarkeit wirkt nur auf den Bibliotheks-Eintrag.

## Versionierung

Einen Prompt über einen bestehenden Eintrag zu speichern, erzeugt eine neue Version. Der Versionsverlauf ist aus der Zeile des Prompts erreichbar; jede Version erfasst den Bearbeiter, den Zeitstempel und den Inhalts-Diff. Du kannst per Klick auf jede frühere Version zurückrollen.

Der Versionsverlauf ist der Ort, an den man schaut, wenn ein Kollege einen globalen Prompt bearbeitet hat und der neue Inhalt für deinen Anwendungsfall nicht funktioniert. Rolle auf Bibliotheks-Ebene zurück, wenn alle zurück sollen; kopier die ältere Version in einen persönlichen Prompt, wenn nur du das alte Verhalten willst.

## Einen Prompt im Chat nutzen

Der Chat hat unten einen Prompt-Picker. Öffne ihn, such oder filtere den gewünschten Prompt, und klick ihn an, um den Inhalt in den Chat zu fügen. Der Prompt ist jetzt deine Nachricht — bearbeite ihn, häng Dateien an, füg Kontext hinzu, sende. Einmal gesendet, verhält sich der Prompt wie jede Chat-Eingabe; Tale verfolgt nicht, welche Chats welche Prompts genutzt haben.

Manche Prompts enthalten Template-Variablen — Platzhalter wie `{{customer_name}}` oder `{{topic}}`. Der Picker fragt dich vor dem Einfügen nach jeder Variable; der resultierende Inhalt ist der Prompt mit den befüllten Platzhaltern. Variablen werden im Inhalt des Prompts mit der `{{variable_name}}`-Syntax deklariert.

## Grenzen und Lebenszyklus

Der Inhalt eines Prompts hat ein Größen-Limit — das Bibliotheks-Formular zeigt die aktuelle Auslastung gegen das Maximum, und die Speichern-Schaltfläche ist deaktiviert, wenn du es überschreitest. Das Limit ist großzügig genug, dass die meisten Prompts passen; wenn du anstößt, ist die richtige Antwort meist, dass der Prompt zwei Prompts ist.

Einen Prompt zu löschen ist nur über den Versionsverlauf umkehrbar, wenn du ihn vorher mindestens einmal gespeichert hast. Persönliche Prompts werden bei Account-Löschung dauerhaft gelöscht; Team-Prompts überleben Team-Reorganisationen, außer das Team wird gelöscht; globale Prompts überleben alles außer einem expliziten Löschen.

## Wo das hingehört

Die Prompt-Bibliothek ist die leichteste Form der Wiederverwendung in Tale — leichter als ein Agent (der Anweisungen, Wissen und Tools trägt), leichter als ein Skill (der Anweisungen und ein Skript verpackt). Greif zu einem Prompt, wenn die Wiederverwendung nur der Text ist; greif zu einem Agent, wenn die Wiederverwendung ein konfiguriertes Verhalten ist. Die natürliche nächste Lektüre ist [Starter und Prompts](/de/platform/chat/starters-and-prompts) dafür, wie Prompts im Chat neben den eigenen Startern eines Agents erscheinen.
