---
title: Prompt-Bibliothek
description: Wiederverwendbare Prompt-Vorlagen in der Organisation speichern, durchstöbern und teilen — mit Versionsverlauf, abgestufter Sichtbarkeit und Ein-Klick-Einfügen.
---

Die Prompt-Bibliothek ist eine gemeinsame Sammlung wiederverwendbarer Prompt-Vorlagen. Speichere die Prompts, die das Team oft nutzt, ordne sie nach Kategorie und Tags und teile sie im richtigen Scope — persönliche Entwürfe, teamweite Playbooks oder organisationsweite kanonische Vorlagen. Jede Bearbeitung wird im Versionsverlauf festgehalten, sodass das Vergleichen zweier Versionen und das Zurückrollen eines schlechten Speicherns Sekunden statt einen Nachmittag braucht.

Die Bibliothek ist aus der Composer-Toolbar in jedem Chat erreichbar. Die Zielgruppe ist jeder im Produkt; Sichtbarkeits-Scopes entscheiden, was jede Rolle sieht.

## Prompts durchstöbern

Öffne die Bibliothek aus der Chat-Eingabe-Toolbar — der Dialog listet jeden Prompt, auf den du Zugriff hast. Die Suche filtert quer über Titel, Beschreibung, Inhalt, Kategorie und Tags. Vier Tabs filtern nach Scope: **Alle**, **Global**, **Team**, **Persönlich**. Kategorie- und Tag-Popover engen die sichtbaren Zeilen anhand der Facetten der geladenen Seite ein; filtert ein Filter die aktuelle Seite leer, aber es gibt weitere Seiten, bietet der Leerzustand **Mehr laden** zum Weitersuchen plus **Filter zurücksetzen**. Jede Zeile zeigt den Titel, eine Inhalts-Vorschau, ein Scope-Badge, die Kategorie, die Tags und die aktuelle Version (zum Beispiel `v3`, wenn ein Verlauf existiert).

Klicke **Verwenden** auf einer Zeile, um den Inhalt in die Chat-Eingabe einzufügen.

## Einen Prompt erstellen

Um einen Prompt zu erstellen, öffne die Bibliothek und klicke auf das Plus-Icon. Das Formular fragt sieben Felder ab, drei davon Pflicht:

| Feld             | Pflicht | Was rein muss                                             |
| ---------------- | ------- | --------------------------------------------------------- |
| **Titel**        | Ja      | Ein kurzer Name für den Prompt.                           |
| **Inhalt**       | Ja      | Der Prompt-Text. In Monospace-Schrift angezeigt.          |
| **Beschreibung** | Nein    | Eine kurze Erklärung, was der Prompt tut.                 |
| **Sichtbarkeit** | Ja      | Wer den Prompt sehen kann — Global, Team oder Persönlich. |
| **Team**         | Bedingt | Pflicht, wenn die Sichtbarkeit auf Team steht.            |
| **Kategorie**    | Nein    | Ein Label wie `writing`, `analysis` oder `coding`.        |
| **Tags**         | Nein    | Komma-getrennte Stichworte für Suche und Organisation.    |

Klicke **Erstellen**. Der neue Prompt landet in der Bibliothek mit v1.

### Tag-Eingabe

Das Tags-Feld ist eine Chip-Eingabe. Drücke **Eingabe** oder tippe ein Komma, um einen Tag zu übernehmen; **Backspace** bei leerer Eingabe entfernt den letzten Chip; das × am Chip entfernt ihn. Doppelte Tags werden ohne Hinweis case-insensitiv zusammengelegt (`Foo` und `foo` ergeben einen). Der Zähler unter der Eingabe wird destruktiv, sobald du das Limit erreichst.

## Eine Chat-Nachricht als Prompt speichern

Um eine Nachricht festzuhalten, die du schon gesendet hast, öffne das Nachrichten-Menü in der Konversation und wähle **Als Prompt speichern**. Der Nachrichteninhalt ist vorausgefüllt — füge einen Titel und eine optionale Beschreibung hinzu und speichere. Der neue Prompt landet im Persönlich-Scope und wird sofort veröffentlicht.

## Sichtbarkeits-Scopes

Drei Sichtbarkeitsstufen steuern, wer einen Prompt sieht:

| Scope          | Wer ihn sieht                   | Badge-Farbe |
| -------------- | ------------------------------- | ----------- |
| **Persönlich** | Nur du.                         | Blau.       |
| **Team**       | Mitglieder des gewählten Teams. | Orange.     |
| **Global**     | Alle in der Organisation.       | Grün.       |

Unveröffentlichte Prompts sind unabhängig vom Scope nur für den Ersteller sichtbar.

## Bearbeiten und Löschen

Nur der Prompt-Ersteller oder ein Admin kann einen Prompt bearbeiten oder löschen. Nutze das Kebab-Menü an der Zeile, um diese Aktionen zu erreichen. Das Löschen eines Prompts ist endgültig und lässt sich nicht rückgängig machen.

## Versionsverlauf

Jedes Speichern erzeugt eine neue Version. Um den Verlauf zu durchstöbern, öffne das Kebab-Menü an einer Zeile und wähle **Versionsverlauf** — der Dialog listet jede Version mit Veröffentlichungsdatum und Autor. Prompts, die seit dem Versionierungs-Release nicht bearbeitet wurden, haben noch keinen Verlaufs-Dialog; mit der ersten Bearbeitung entsteht v2, der Menüpunkt wird verfügbar und v1 bleibt als vorheriger Zustand erhalten.

### Zwei Versionen vergleichen

Drücke **Eingabe** auf einer Version (oder klicke **Mit aktueller vergleichen**), um ein Side-by-Side-Diff zu öffnen. Das Diff ist zeilen-basiert, optimiert für Prosa. Mit `−` markierte Zeilen sind im aktuellen Inhalt, aber nicht im verglichenen Snapshot vorhanden; mit `+` markierte Zeilen sind im Snapshot — genau diese würde **Wiederherstellen** zurückbringen. Metadaten-Änderungen (Titel, Beschreibung, Kategorie, Tags, Scope) erscheinen über dem Inhalts-Diff mit Vorher/Nachher-Werten. Screenreader-Nutzende hören jede hinzugefügte oder entfernte Zeile mit explizitem Präfix angesagt.

### Eine Version wiederherstellen

Drücke **R** oder **Umschalt+Eingabe** auf einer Version (oder klicke **Wiederherstellen** in der Vergleichsansicht), um den Prompt auf diesen Snapshot zurückzurollen. Das Wiederherstellen ist umkehrbar — es erzeugt eine neue Version v(aktuell + 1), die den Inhalt und die Metadaten des Snapshots trägt; die bisher aktuelle Version bleibt im Verlauf und lässt sich später wiederherstellen, falls nötig.

Hat jemand anderes eine neue Version gespeichert, während dein Verlaufs-Dialog offen war, schlägt das Wiederherstellen mit **Versionsverlauf hat sich geändert — aktualisiere und versuch es erneut** fehl. Schliesse und öffne den Dialog neu, um den aktuellen Stand zu sehen, bevor du es erneut versuchst.

### Tastaturkürzel im Verlaufs-Dialog

| Taste                        | Aktion                                              |
| ---------------------------- | --------------------------------------------------- |
| **↑ / ↓**                    | Zwischen Versionen wechseln.                        |
| **Pos1 / Ende**              | Zur neuesten / ältesten Version springen.           |
| **Eingabe**                  | Vergleichsansicht für die fokussierte Zeile öffnen. |
| **R** / **Umschalt+Eingabe** | Die fokussierte Version wiederherstellen.           |
| **Esc**                      | Den Dialog (oder die Vergleichsansicht) schliessen. |

## Gleichzeitige Bearbeitung

Öffnest du einen Prompt zum Bearbeiten, während jemand anderes eine neue Version veröffentlicht, zeigt das Formular ein Banner **Neuere Version verfügbar**. Klicke **Neueste laden**, um das Formular auf den aktuellen Snapshot zu re-ankern, bevor du speicherst. Deine ungespeicherten Bearbeitungen werden verworfen, daher eskaliert die Warnung zu destruktiv, wenn das Formular dirty ist.

## Limits

Die Pro-Prompt-Obergrenzen werden serverseitig erzwungen und clientseitig gespiegelt:

| Feld            | Obergrenze                                   |
| --------------- | -------------------------------------------- |
| Inhalt          | 16 KiB (UTF-8).                              |
| Titel           | 200 Zeichen.                                 |
| Beschreibung    | 2 000 Zeichen.                               |
| Kategorie       | 100 Zeichen.                                 |
| Tag (pro Stück) | 50 Zeichen.                                  |
| Tags (Anzahl)   | 20 pro Prompt.                               |
| Verlauf         | 12 Versionen (älteste fällt beim Speichern). |

Erreicht der Verlauf die Obergrenze, fällt die älteste Version heraus (FIFO) und ein Audit-Eintrag **history truncated** wird geschrieben.

## Rate-Limits

Mutationen auf Prompts sind pro Nutzer rate-limitiert, damit Massen-Operationen freundlich bleiben. Bei Treffer eines Limits zeigt ein Toast den Hinweis, dass das Speichern zu schnell läuft, und die Aktion läuft sauber weiter, sobald das Fenster sich zurücksetzt.

## Nutzungs-Tracking

Jeder Prompt verfolgt, wie oft er eingefügt wurde. Der Nutzungs-Zähler erscheint auf der Prompt-Karte und aktualisiert sich, sobald jemand den Prompt für eine Konversation wählt — ein nützliches Signal, um Vorlagen zu finden, die das Team leise tragen, und solche, die sich als Einmal-Sachen erwiesen haben.

## Wo das einsetzt

Die Prompt-Bibliothek ist die Wiederverwendungs-Oberfläche für Text im Chat-Composer. Sie existiert aus demselben Grund wie Versionskontrolle: der Prompt, den du letzte Woche geschrieben hast und der endlich die richtige Antwort lieferte, sollte einmal gespeichert sein und aus jeder Konversation erreichbar — nicht aus einer Chat-Verlaufs-Suche herausgekramt. Persönliche Scopes sind für Entwürfe; Team-Scopes für gemeinsame Playbooks; organisationsweite Scopes für kanonische Vorlagen, zu denen die ganze Firma greifen soll.

Für Prompts, die das KI-Verhalten dauerhaft ändern statt nur eine Nachricht rahmen, bearbeite die Anweisungen des Agents unter [Agent erstellen](/de/platform/agents/create) — die Anweisungen sind der Prompt, der vor _jeder_ Nachricht in einer Agent-Konversation läuft, während ein Bibliotheks-Prompt der Körper einer einzelnen Nachricht ist.
