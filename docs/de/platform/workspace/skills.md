---
title: Skill-Bibliothek
description: Erstelle wiederverwendbare Anweisungen, importiere ein Skill-Bundle und lege fest, welche Teams und Projektagenten es nutzen können.
---

Ein Skill beschreibt eine wiederkehrende Arbeitsweise: Release Notes schreiben, ein Briefing prüfen oder ein Dokument nach euren Vorgaben erstellen. Er enthält eine Anweisungsdatei `SKILL.md` und bei Bedarf ergänzende Dateien. Pflege ihn unter **Einstellungen > Skills** an einer Stelle und [statte die passenden Agenten damit aus](/de/platform/agents/skills).

Jedes Mitglied kann einen Skill erstellen und seine eigenen bearbeiten. Zum Bearbeiten oder Löschen eines geteilten Skills einer anderen Person brauchst du die Rechte eines Organisationsadministrators.

## Einen kleinen Skill erstellen

<Steps>

<Step title="Den Skill benennen und seinen Einsatz erklären">

Öffne **Einstellungen > Skills**, dann **Skill hinzufügen > Leerer Skill**. Gib einen **Namen** wie `brief-summary` und eine **Beschreibung** ein:

```text
Fasse ein Projektbriefing in Prüftermin, Zuständigkeit und offenen Fragen
zusammen. Nutze den Skill für eine Übergabe oder eine kurze Briefing-Prüfung.
```

Der Name ist eine eindeutige Kurzkennung: Kleinbuchstaben, Ziffern und einzelne Bindestriche, höchstens 64 Zeichen. An der Beschreibung erkennt das Modell, wann der Skill passt. Klicke auf **Erstellen**, um ihn anzulegen und den Editor zu öffnen.

</Step>

<Step title="Die Anweisungen schreiben">

Beschreibe unter **Anweisungen (Body)** einen kurzen Ablauf und ein überprüfbares Ergebnis. Zum Beispiel:

```markdown
Lies das bereitgestellte Briefing. Erstelle eine Tabelle mit drei Zeilen:
Prüftermin, Zuständigkeit und offene Fragen. Zitiere zu jeder Antwort den
belegenden Satz. Schreibe „Nicht angegeben“, wenn eine Information fehlt.
Leite aus einem Prüftermin keinen Veröffentlichungstermin ab.
```

Ergänze Referenzdateien nur, wenn sie für den Ablauf hilfreich sind. Lege ausführliche Beispiele dort ab und erkläre, wann der Agent sie lesen soll.

</Step>

<Step title="Die Zielgruppe wählen und speichern">

Neue Skills beginnen mit der Sichtbarkeit **Organisation**. Wähle unter **Sichtbarkeit** die Option **Teams** und mindestens ein Team, wenn der Inhalt für einen engeren Kreis bestimmt ist. Ein Icon oder Labels können das Wiederfinden erleichtern. Klicke anschließend auf **Speichern**.

Ein neuer Skill wird keinem Agenten automatisch zugeordnet. Öffne den Agenten des gewünschten Projekts und wähle den Skill in seiner Ausstattung. Starte eine kleine Aufgabe mit bekannten Eingaben und prüfe, ob das Ergebnis den Anweisungen entspricht.

</Step>

</Steps>

<Frame caption="Der Skill-Editor vereint Bundle-Dateien, Beschreibung, Labels und Sichtbarkeit. Darunter beginnen die Anweisungen.">

![Der Editor des Skills docx zeigt den Dateibaum, Beschreibung, Labels, die Sichtbarkeit Organisation und die Überschrift Anweisungen.](/images/platform/skill-library-detail.webp)

</Frame>

## Ein vorhandenes Bundle importieren

Nutze **Skill hinzufügen > Zip hochladen** oder **Ordner hochladen**. Im Stammverzeichnis muss `SKILL.md` liegen. Referenzen, Vorlagen und Skripte dürfen mitgeliefert werden:

```text
brief-summary/
├── SKILL.md
└── references/
    └── example-brief.md
```

Die Vorschau zeigt Metadaten, Freigabe, Lizenz und Dateiliste, bevor **Bundle hochladen** etwas speichert. Prüfe Inhalt und Zielgruppe. Fehlt `visibility`, wird der Skill organisationsweit geteilt. Existiert der Name schon, fragt Tale nach dem Ersetzen. Das betrifft auch Agenten, die diesen Skill verwenden.

<Warning>

Der Import startet keine Aufgabe und führt keine Dateien aus. Sobald du den Skill zuordnest, leiten seine Anweisungen aber einen Coding-Agenten an, der Tools, Zugangsdaten und eine Shell nutzen kann. Prüfe fremde Anweisungen und Skripte vor der Verwendung. Ein Skill bildet keine zusätzliche Berechtigungsgrenze.

</Warning>

## Die Freigabe verstehen

| Sichtbarkeit | Wer ihn lesen kann | Welche Projektagenten ihn nutzen können |
| --- | --- | --- |
| **Organisation** | Alle Mitglieder der Organisation | Agenten aller Projekte |
| **Teams** | Mitglieder der ausgewählten Teams | Agenten in Projekten mit einem passenden Team |

Der Projektzugriff bestimmt die verfügbare Ausstattung, auch wenn du persönlich mehr Skills lesen kannst. Ein organisationsweites Projekt kann organisationsweite Skills nutzen. Ältere private Skills bleiben für ihren Inhaber sichtbar, lassen sich aber keinem Agenten zuordnen. Neue private Skills werden nicht angenommen.

Eine Einschränkung der Sichtbarkeit verlangt eine Bestätigung, weil Agenten dadurch Zugriff verlieren können. Das Löschen hat dieselbe praktische Folge: Ein Lauf, der das fehlende Bundle benötigt, kann es nicht bereitstellen. Prüfe die Verwendung eines geteilten Skills, bevor du ihn einschränkst oder entfernst.

## Dateireferenz

Eine minimale `SKILL.md` sieht so aus:

```markdown
---
name: brief-summary
description: Fasse ein Projektbriefing zusammen. Nutze dies für Übergaben und Prüfungen.
visibility: org
---

Lies das Briefing. Nenne Prüftermin, Zuständigkeit und offene Fragen.
Zitiere Belege und kennzeichne fehlende Informationen mit „Nicht angegeben“.
```

| Feld | Bedeutung |
| --- | --- |
| `name` | Entspricht dem Ordnernamen. `anthropic` und `claude` sind reserviert. |
| `description` | Wann und warum das Modell den Skill lesen soll; höchstens 1.024 Zeichen. |
| `visibility` / `teams` | `org` oder `team` mit Team-IDs. Die Oberfläche trägt diese Werte ein. |
| `license` | Die vom Autor angegebenen Nutzungsbedingungen. |
| `recommended-packages` | Empfohlene Abhängigkeiten; der Import installiert sie nicht. |
| `disable-model-invocation` | Bittet um ausdrückliche Verwendung. Diese Metadaten sind eine Anweisung, keine Zugriffsbeschränkung. |
| `icon` / `labels` | Darstellung in der Bibliothek; bis zu acht Labels. |

Unbekannte Frontmatter-Schlüssel bleiben erhalten. Die Frontmatter darf bis zu 16 KB groß sein, die gesamte `SKILL.md` bis zu 512 KB. Häufig gelesene Anweisungen sollten deutlich kürzer bleiben.

## Aktualisieren und Probleme lösen

Öffne eine Zeile, um Beschreibung, Anweisungen, Labels und Sichtbarkeit zu ändern. Unter **Bundle** kannst du ergänzende Dateien prüfen. Agenten sind nicht an eine bestimmte Fassung gebunden: Beim nächsten Bereitstellen wird das aktuelle Bundle verwendet. Teste gemeinsame Änderungen deshalb mit einer typischen Aufgabe.

Findet ein Agent den Skill nicht, prüfe seine Ausstattung und die Sichtbarkeit für das Projekt. Ignoriert er einen zugeordneten Skill, präzisiere die Beschreibung und prüfe `disable-model-invocation`. [Skills für Agenten](/de/platform/agents/skills) erklärt, wie das zugeordnete Bundle bereitgestellt und dem Agenten genannt wird.

Prüfe bei einem Importfehler, ob `SKILL.md` im Stammverzeichnis liegt, gültige Frontmatter enthält und einen gültigen Namen hat. Die Fehlermeldung nennt abgelehnte Pfade oder Größenlimits. Zum Entfernen öffne das Bundle und wähle nach Prüfung der betroffenen Agenten **Skill löschen**.
