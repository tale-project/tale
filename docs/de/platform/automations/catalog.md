---
title: Automatisierungen in deine Organisation bringen
description: Woher Automatisierungen kommen — die mitgelieferten Packs, mit denen jede Organisation startet, Entwürfe vom Canvas und hochgeladene Pakete, inklusive Zips, die ihre Skills gleich mitinstallieren.
---

Die Seite **Automatisierungen** in der Seitenleiste listet jede Automatisierung der Organisation und ist die Tür, durch die neue hereinkommen. Eine Organisation startet mit den mitgelieferten Packs, auf dem Canvas baust du neue von Grund auf, und **Paket hochladen** nimmt ein Pack an, das du anderswo gebaut hast — als einzelne Dateien oder als eine Zip, die auch die Skill-Bundles des Packs installiert. Die Seite verwalten dürfen Inhaber, Admins und Entwickler; alles, was ein Upload anlegt, bleibt ein Entwurf, bis du ihn deployst — nichts Laufendes ändert sich, nur weil eine Datei gelandet ist.

Diese Seite behandelt, woher Automatisierungen kommen und was ein hochgeladenes Paket enthalten darf. Der Umgang mit einer einzelnen — Canvas, Versionen, Testläufe, Deployen — steht auf [Der Workflow-Editor](/de/platform/automations/editor); das Modell darunter auf [Automatisierungskonzepte](/de/platform/automations/concepts); was die mitgelieferten Packs tun, auf [Mitgelieferte Automatisierungen](/de/platform/automations/builtin).

<Frame caption="Die Seite Automatisierungen — jede Zeile ist eine Automatisierung mit ihrer Versionszahl und der Version, die live ist, oder Nicht live.">

![Die Seite Automatisierungen mit den mitgelieferten E-Mail- und GitHub-Automatisierungen, jede Zeile mit Versionszahl und Deployment-Status.](/images/platform/automations-catalog.webp)

</Frame>

## Was die Liste zeigt

Jede Zeile ist eine Automatisierung: ihr Name, wie viele Versionen sie hat, und entweder die Live-Version oder **Nicht live**. Die Org-Seite listet Automatisierungen auf Organisationsebene; eine Automatisierung, die zu einem Projekt gehört, lebt stattdessen im **Automatisierungen**-Tab dieses Projekts — wo eine Automatisierung erscheint, entscheidet ihr erster Save, und danach zieht sie nie um. Klicke eine Zeile an und du landest auf der Seite der Automatisierung, wie [Der Workflow-Editor](/de/platform/automations/editor) sie beschreibt.

**Neue Automatisierung** bietet zwei Wege, bei null zu starten: **Aus einem Ziel** übergibt deine Beschreibung dem Builder, der die Nodes für dich baut; **Leer (Trigger + Agent)** legt eine Ein-Agent-Automatisierung an, die du selbst verdrahtest — benenne sie, wähle das Modell des Agenten, und den Rest (Prompt, gewährte Tools und Secrets, Trigger) setzt du auf dem Canvas. Die mitgelieferten Packs brauchen gar keinen Installationsschritt: Jede Organisation wird bei ihrer Anlage damit ausgestattet, bereit zum Deployen.

## Ein Paket hochladen

Ein Pack ist ein Verzeichnis: `workflow.yml` (das Automatisierungsdokument — erforderlich), `automation.yml` (das Manifest — optional) und, wenn das Pack eigenes Wissen mitbringt, ein Ordner pro Skill unter `skills/`.

```text
review-invoices/
├── workflow.yml
├── automation.yml
└── skills/
    └── invoice-rules/
        ├── SKILL.md
        └── references/
            └── checklist-rules.md
```

Zum Hochladen öffnest du **Automatisierungen**, wählst im Menü **Neue Automatisierung** den Punkt **Paket hochladen** und gibst eine der beiden Formen desselben Packs an:

- **Die Dateien** — `workflow.yml`, plus `automation.yml`, wenn das Pack eine mitbringt. Richtig für ein Pack, das nur aus seinem Dokument besteht.
- **Eine `.zip` des Pack-Verzeichnisses** — Pflicht, wenn das Pack Skills mitbringt, denn nur die Zip kann deren Ordner tragen. Markdown-Notizen außerhalb von `skills/` — etwa ein README — ignoriert der Upload, genauso wie Dotfiles und Build-Reste (`__pycache__/`, `node_modules/`); zippe das Verzeichnis also, wie es ist, ruhig direkt nach einem Testlauf. Die Zip bleibt unter 20 MiB.

Wähle vor dem Absenden, wo die Automatisierung installiert wird — Organisation oder ein Projekt. Ein Pack, dessen Manifest `scope: project` deklariert, installiert sich nur in ein Projekt; einen organisationsweiten Upload lehnt der Server ab. Die Wahl ist nicht endgültig: Die Installation in ein Projekt bindet die Automatisierung daran, und im Bereich **Projekte** auf ihrer Seite verwaltest du die Bindungen später — binde weitere Projekte oder entferne alle, dann gilt sie organisationsweit.

<Frame caption="Paket hochladen — die Dateien oder eine Zip, und wo die Automatisierung installiert wird.">

![Der Dialog zum Paket-Upload mit seiner Ablagezone und dem Auswahlfeld Installieren in, gesetzt auf Organisation.](/images/platform/automations-upload-dialog.webp)

</Frame>

Der Server validiert, bevor irgendetwas gespeichert wird. Das Dokument durchläuft dieselbe Engine-Validierung wie im Editor — ein Upload, der nicht laufen würde, wird mit den Meldungen der Engine abgelehnt statt kaputt gespeichert — und die Blöcke `subjects` und `settings` des Manifests werden zum Task-Vertrag und zu den [Einstellungsformularen](#einstellungen-die-das-paket-deklariert) der Automatisierung, genau wie ein Save vom Canvas sie setzen würde. Was landet, ist eine **Entwurfsversion** hinter dem normalen Deploy-Gate — kein Trigger läuft, solange keine Version live ist. Der Dialog bietet das Deployen direkt nach dem Upload an: Schalte die neue Version gleich dort live, oder wähle **Später** und deploye von der Seite der Automatisierung, wenn du bereit bist.

Lädst du das Pack einer bestehenden Automatisierung erneut hoch, entsteht die nächste Version — der Store überschreibt nie Geschichte, jede frühere Version bleibt exakt, wo sie war. Wählst du dabei ein Projekt als Ziel, kommt dessen Bindung zu den bestehenden hinzu.

## Skills, die das Paket mitbringt

Eine Zip darf die Skills mitliefern, auf die sich ihr Dokument stützt — die Bundles, die eine Agent-Node lädt oder aus denen ein Script-Schritt läuft. Das Manifest muss sie benennen, und die Deklaration wird in beide Richtungen geprüft: Ein `skills/`-Ordner, den das Manifest nicht deklariert, lehnt den Upload ab — genauso ein deklarierter Slug, den die Zip nicht mitbringt.

```yaml
# automation.yml
name: Review invoices
skills:
  - invoice-rules
subjects:
  task:
    # …der Task-Vertrag, unverändert
```

Jedes mitgebrachte Bundle wird als echter Skill validiert — Frontmatter geparst, `name` gleich seinem Ordner — und in die [Skill-Bibliothek](/de/platform/workspace/skills) der Organisation installiert, sobald der Upload angenommen ist; die Testläufe des Entwurfs finden sie also schon. Was pro Slug passiert, hängt davon ab, was die Bibliothek bereits hält:

- **Neuer Slug** — das Bundle wird installiert.
- **Identisches Bundle** — nichts wird geschrieben; der Upload meldet es als unverändert.
- **Anderer Inhalt** — der Upload hält an und listet die kollidierenden Slugs. Bestätige, um sie durch die Versionen aus dem Paket zu ersetzen; die abgelöste `SKILL.md` bleibt im Verlauf des jeweiligen Skills. Nichts — weder die Automatisierung noch irgendein Skill — wird geschrieben, bevor du bestätigst.

Ein Dokument, das einen Skill referenziert, den weder das Paket mitbringt noch die Bibliothek hält, lädt trotzdem hoch — die fehlende Referenz kommt als Warnung zurück, damit ein Pack einen Skill benennen kann, den du später installierst.

## Einstellungen, die das Paket deklariert

Liest eine Automatisierung bei ihren Läufen Konfiguration, die den Betreibenden gehört — ein Fallprofil, eine Validierungsrichtlinie —, kann das Manifest sie als **Einstellungsformulare** deklarieren. Die Plattform zeigt sie im Erstellen-Dialog des Aufgabenboards und speichert jedes Formular als flache YAML-Datei in einem Projektordner: Niemand bearbeitet eine Datei von Hand, um die Automatisierung zu konfigurieren, und jedes Projekt behält seine eigenen Werte.

```yaml
# automation.yml
settings:
  folder: Setup
  forms:
    - file: validation-policy.yaml
      title: Validation policy
      required: true
      fields:
        - key: method
          label: Validation profile
          type: select
          default: strict_rules
          options:
            - value: strict_rules
              label: Strict checklist (standard)
```

Ein Formular besitzt seine Datei: Speichern schreibt `Setup/validation-policy.yaml` komplett aus den Formularwerten neu, und das Formular füllt sich aus dem, was die Datei enthält — egal ob das Formular sie geschrieben hat oder jemand sie von Hand hochgeladen hat. Felder sind `text`, `number`, `boolean` oder `select`; jeder Wert landet als String, ein `text`-Feld kann ein `pattern` festlegen, und Titel, Beschriftungen, Hilfetexte und Optionsnamen lokalisieren über `i18n`-Blöcke am jeweiligen Eintrag. Alles, was reicher ist als eine flache Schlüssel-Wert-Datei — verschachtelte Blöcke, Listen —, gehört in eine separate, von Hand gepflegte Datei, die der Workflow daneben liest.

Markierst du ein Formular mit `required: true`, erzwingt der Erstellen-Dialog es pro Projekt: Wählt jemand die Aufgabenvorlage der Automatisierung zum ersten Mal in einem Projekt, das noch nicht eingerichtet ist, erscheinen die Formulare vor dem eigentlichen Aufgabenfeld, und das Erstellen geht erst weiter, wenn sie gespeichert sind. Von da an öffnet der Button **Einstellungen** im selben Dialog die Formulare zum Bearbeiten — jedes mit eigenem **Speichern**, aktiv nur, wenn sich etwas geändert hat.

Manche Einstellungen sind Dateien statt Werte — Referenzdokumente, die die Läufe unverändert lesen. Deklariere sie als **Upload-Formular** (`kind: uploads`): Statt eine YAML-Datei zu schreiben, verwaltet das Formular einen Projektordner — mit Drop-Zone, Ordnerauswahl und einer Liste dessen, was schon da ist.

```yaml
# automation.yml
settings:
  folder: Setup
  forms:
    - kind: uploads
      title: Reference documents
      subdir: reference
      accept: ['.pdf', '.json']
      match: '\.(pdf|json)$'
      requireFolder: true
```

`accept` nennt die Endungen, die die Dateiauswahl anbietet, `match` filtert, welche Dateinamen das Panel listet (ohne Groß-/Kleinschreibung — und einen Upload, dessen Name nie passen würde, lehnt das Panel vorab ab, damit nichts landet und dann aus der Liste „verschwindet"), `subdir` bindet das Formular an einen eigenen Unterordner des Einstellungsordners, und `requireFolder: true` verlangt, dass du vor dem Hochladen einen Unterordner wählst oder anlegst — für Material, das pro Zeitraum oder Thema geordnet bleiben muss, statt sich an der Wurzel zu stapeln. Uploads gelten sofort: Ein Upload-Formular hat kein **Speichern**, blockiert nie das Erstellen einer Aufgabe, und Läufe lesen den aktuellen Inhalt des Ordners.

## Ergebnisse, die das Paket deklariert

Ein Pack, dessen Läufe Dokumente in den Ordner einer Aufgabe zurückschreiben,
kann benennen, welche davon die **Ergebnisse** sind — das, wofür jemand die
Aufgabe öffnet. Der Ergebnis-Bereich der Aufgabe zeigt genau diese, immer offen
und in der deklarierten Reihenfolge, während alles andere im Ordner — die
Uploads, die Arbeitsdateien des Laufs — unter **Dateien** eingeklappt bleibt.

```yaml
# automation.yml
subjects:
  task:
    outcome:
      files:
        - return.xml
        - report.md
        - journal.csv
```

Nur das Pack weiß, welche seiner geschriebenen Dateien der Punkt sind, also rät
die Plattform nichts: Ein Name, den noch kein Lauf abgelegt hat, erscheint
trotzdem als zugesagte Zeile mit dem Hinweis _Noch nicht bereit_ — die Aufgabe
benennt also, was sie produzieren wird, bevor sie es produziert. `*` und `?` sind
als Platzhalter erlaubt (`return-*.xml`), für einen Namen, den ein Lauf erst
bildet. Deklarierst du nichts, zeigt der Ergebnis-Bereich jede Datei, die die
Läufe abgelegt haben, die neueste zuerst.

## Wo das hingehört

Automatisierungen kommen auf drei Wegen an — mit der Organisation ausgeliefert, auf dem Canvas gebaut oder als Pack hochgeladen — und jeder Weg endet an derselben Stelle: eine Entwurfsversion auf der Seite der Automatisierung, deployt auf dein Kommando. Ein Zip-Upload bestückt zusätzlich die [Skill-Bibliothek](/de/platform/workspace/skills) mit den Bundles, die die Automatisierung braucht, mit einer Bestätigung vor jedem Skill, den er ersetzen würde. [Der Workflow-Editor](/de/platform/automations/editor) ist die nächste Lektüre, um den Entwurf live zu nehmen.
