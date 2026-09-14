---
title: Automatisierungen erstellen oder importieren
description: Wähle einen Ausgangspunkt, importiere ein geprüftes Paket und bereite Skills, Einstellungen und Ergebnisse für den Einsatz vor.
---

Unter **Automatisierungen** findest du die Workflows deiner Organisation. Inhaber, Admins und Entwickler können sie verwalten. Prüfe zuerst, ob eine [mitgelieferte Automatisierung](/de/platform/automations/builtin) zur Aufgabe passt. Andernfalls erstellst du einen Entwurf und testest ihn, bevor du ihn live schaltest.

<Frame caption="Die Seite Automatisierungen — jede Zeile ist eine Automatisierung mit ihrer Versionszahl und der Version, die live ist, oder Nicht live.">

![Die Seite Automatisierungen mit den mitgelieferten E-Mail- und GitHub-Automatisierungen, jede Zeile mit Versionszahl und Deployment-Status.](/images/platform/automations-catalog.webp)

</Frame>

## Einen Ausgangspunkt wählen

Jede Zeile zeigt Name, Projektzuordnungen, Versionsanzahl und Live-Version oder **Nicht live**. Öffne sie, um Ablauf und Läufe zu prüfen. Im Bereich **Projekte** legst du fest, welche Boards die Automatisierung nutzen können. Ohne Projektzuordnung steht sie der Organisation zur Verfügung.

Das Menü **Neue Automatisierung** bietet drei Wege:

| Auswahl | Geeignet, wenn … | Danach |
| --- | --- | --- |
| **Aus einem Ziel** | du das Ergebnis kennst, aber Hilfe beim Aufbau brauchst. | Der Builder erstellt einen prüfbaren Workflow-Entwurf. |
| **Leer (Trigger + Agent)** | du den Ablauf selbst konfigurieren möchtest. | Benenne ihn, wähle das Modell und ergänze Anweisungen und Ausstattung im Editor. |
| **Paket hochladen** | eine Workflow-Datei oder ein wiederverwendbares Pack vorliegt. | Tale prüft die Dateien und speichert eine Entwurfsversion. |

Mitgelieferte Automatisierungen werden beim Erstellen der Organisation eingerichtet. Für den automatischen Einsatz brauchen sie dennoch ihre Konfiguration und eine Live-Version. Der [Workflow-Editor](/de/platform/automations/editor) führt durch Eingaben, Test, Ergebnisprüfung und Live-Schaltung.

## Ein Paket importieren

Ein Pack enthält die erforderliche `workflow.yml`, optional das Manifest `automation.yml` und bei Bedarf Skill-Bundles:

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

<Steps>

<Step title="Dateien auswählen">

Wähle **Neue Automatisierung > Paket hochladen**. Lade Workflow und optionales Manifest einzeln hoch oder wähle genau eine `.zip` mit dem Pack. Für mitgelieferte Skills brauchst du die ZIP-Datei. Markdown-Notizen außerhalb von `skills/`, versteckte Dateien und Build-Reste wie `node_modules/` und `__pycache__/` werden ignoriert.

</Step>

<Step title="Ziel festlegen">

Wähle unter **Installieren in** die **Organisation** oder ein bestehendes Projekt. Ein Manifest mit `scope: project` verlangt ein Projekt. Importierst du eine bestehende Automatisierung in ein weiteres Projekt, kommt diese Zuordnung hinzu; frühere bleiben erhalten. Unter **Projekte** kannst du später alle Zuordnungen bearbeiten.

<Frame caption="Paket hochladen — die Dateien oder eine Zip, und wo die Automatisierung installiert wird.">

![Der Dialog zum Paket-Upload mit seiner Ablagezone und dem Auswahlfeld Installieren in, gesetzt auf Organisation.](/images/platform/automations-upload-dialog.webp)

</Frame>

</Step>

<Step title="Prüfen und speichern">

Wähle **Paket hochladen** und behebe gemeldete Fehler im Workflow, Manifest oder Skill. Erst nach erfolgreicher Prüfung werden Automatisierung und mitgelieferte Skills geschrieben. Ein erneuter Import derselben Automatisierung ergänzt eine Entwurfsversion; die bisherige Historie bleibt erhalten.

</Step>

<Step title="Vor der Live-Schaltung prüfen">

Mit **Später** öffnest und testest du den Entwurf anschließend im Editor. Der Erfolgsdialog bietet auch an, die angezeigte Version direkt live zu schalten. Der Upload allein ändert die Live-Version nicht. Richte benötigte Zugangsdaten ein und prüfe die Skills vor der Freigabe für den Betrieb.

</Step>

</Steps>

Die ZIP-Datei darf komprimiert und entpackt jeweils höchstens 20 MiB enthalten: maximal 500 Dateien, 2 MiB je Datei und 20 Skill-Bundles. Entferne bei einer Größenüberschreitung erzeugte Artefakte und trenne unabhängige Inhalte in eigene Skills. Stärkere Komprimierung behebt ein zu großes entpacktes Paket nicht.

## Konflikte bei Skills klären

Die `skills`-Liste im Manifest muss zu den Ordnern unter `skills/` passen. Nicht deklarierte Ordner und deklarierte, aber fehlende Bundles führen zur Ablehnung. Jedes Bundle braucht gültige Metadaten in `SKILL.md`; `name` muss dem Ordnernamen entsprechen.

```yaml
# automation.yml
name: Review invoices
skills:
  - invoice-rules
```

Neue Bundles werden in die [Skill-Bibliothek](/de/platform/workspace/skills) der Organisation aufgenommen. Identische bleiben unverändert. Bei anderem Inhalt hält der Upload an und nennt die betroffenen Slugs. Prüfe sie, bevor du das Ersetzen bestätigst: Das Paket ersetzt diese gemeinsam genutzten Bundles. Die bisherige `SKILL.md` bleibt im jeweiligen Verlauf. Vor der Bestätigung wird weder die Automatisierung noch ein Skill geschrieben.

Ein Workflow darf außerdem Bibliotheks-Skills verwenden, die nicht im Paket liegen. Fehlt einer, meldet der Upload eine Warnung. Installiere ein zugängliches Bundle, bevor du den Agenten startest, der es benötigt. Ein gespeicherter Entwurf bestätigt nicht, dass alle Abhängigkeiten bereitstehen.

## Ein Projekt über Paketformulare einrichten

Ein Manifest kann Formulare vorgeben, die bei der Auswahl seiner Aufgabenvorlage erscheinen. Die Werte gehören zum Projekt. So verwenden zwei Projekte denselben Ablauf mit unterschiedlichen Richtlinien.

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
              label: Strict checklist
```

Ist das Projekt noch nicht eingerichtet, erscheinen Pflichtformulare vor den Aufgabenfeldern. **Speichern und weiter** schreibt die Formulare und setzt die Aufgabenerstellung fort. Später öffnet **Einstellungen** sie als Tabs. Ein Punkt markiert ungespeicherte Änderungen; **Speichern** schreibt alle geänderten Formulare. Beim Schließen mit offenen Änderungen fragt Tale nach.

Speichern ersetzt die flache YAML-Datei des Formulars, etwa `Setup/validation-policy.yaml`. Vorhandene Werte werden übernommen, auch aus einer manuell hochgeladenen Datei. Feldtypen sind `text`, `number`, `boolean` und `select`; gespeichert werden Zeichenketten. Textfelder können ein `pattern` vorgeben. Eintragsbezogene `i18n`-Blöcke übersetzen Titel, Beschriftungen, Hilfe und Optionen. Verschachtelte Daten und Listen gehören in separate Dateien, die der Workflow zusätzlich liest.

## Referenzdateien über ein Upload-Formular bereitstellen

Ein Upload-Formular verwaltet Dateien direkt, statt YAML zu erzeugen:

```yaml
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

`subdir` bestimmt einen Unterordner des Einstellungsordners. `accept` begrenzt die angebotenen Dateiendungen; `match` filtert die angezeigten Namen ohne Beachtung der Großschreibung und lehnt nicht passende Uploads ab. Bei `requireFolder: true` wählst oder erstellst du zuerst einen Unterordner, beispielsweise je Berichtszeitraum.

Uploads gelten sofort und haben kein **Speichern**. Sie blockieren die Aufgabenerstellung nicht. Läufe lesen den aktuellen Ordnerinhalt. Vervollständige deshalb die Referenzen, bevor du darauf angewiesene Arbeit startest.

## Die erwarteten Ergebnisse benennen

Das Manifest kann Dateien für den Bereich **Ergebnis** der Aufgabe festlegen. Sie erscheinen in der angegebenen Reihenfolge; andere Anhänge und Arbeitsdateien bleiben unter **Dateien**.

```yaml
subjects:
  task:
    outcome:
      files:
        - return.xml
        - report.md
        - name: audit-summary.md
          optional: true
```

Eine erforderliche Datei erscheint bis zu ihrer Ablage durch einen Lauf als **Noch nicht bereit**. Eine optionale Datei wird erst angezeigt, wenn sie existiert. Muster unterstützen `*` und `?`, etwa `return-*.xml`. Ohne Vorgaben zeigt das Ergebnis alle von Läufen abgelegten Dateien, neueste zuerst. Eine kurze ausdrückliche Liste hilft, den Abschlussbericht von Arbeitsunterlagen zu unterscheiden.
