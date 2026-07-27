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

**Neue Automatisierung** legt einen leeren Entwurf an, den du auf dem Canvas baust. Die mitgelieferten Packs brauchen gar keinen Installationsschritt: Jede Organisation wird bei ihrer Anlage damit ausgestattet, bereit zum Deployen.

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
            └── vat-rates.md
```

Zum Hochladen öffnest du **Automatisierungen**, wählst im Menü **Neue Automatisierung** den Punkt **Paket hochladen** und gibst eine der beiden Formen desselben Packs an:

- **Die Dateien** — `workflow.yml`, plus `automation.yml`, wenn das Pack eine mitbringt. Richtig für ein Pack, das nur aus seinem Dokument besteht.
- **Eine `.zip` des Pack-Verzeichnisses** — Pflicht, wenn das Pack Skills mitbringt, denn nur die Zip kann deren Ordner tragen. Markdown-Notizen außerhalb von `skills/` — etwa ein README — ignoriert der Upload; zippe das Verzeichnis also, wie es ist. Die Zip bleibt unter 20 MiB.

Wähle vor dem Absenden, wo die Automatisierung installiert wird — Organisation oder ein Projekt: Der erste Upload bindet sie dauerhaft an diese Oberfläche.

<Frame caption="Ein Automatisierungs-Paket hochladen — die Dateien oder eine Zip, und die Oberfläche, an die die Automatisierung gebunden wird.">

![Der Dialog zum Paket-Upload mit seiner Ablagezone und dem Auswahlfeld Installieren in, gesetzt auf Organisation.](/images/platform/automations-upload-dialog.webp)

</Frame>

Der Server validiert, bevor irgendetwas gespeichert wird. Das Dokument durchläuft dieselbe Engine-Validierung wie im Editor — ein Upload, der nicht laufen würde, wird mit den Meldungen der Engine abgelehnt statt kaputt gespeichert — und der `subjects`-Block des Manifests wird zum Task-Vertrag der Automatisierung, genau wie ein Save vom Canvas ihn setzen würde. Was landet, ist eine **Entwurfsversion** hinter dem normalen Deploy-Gate: Kein Trigger läuft, bevor du sie auf der Seite der Automatisierung deployst.

Lädst du das Pack einer bestehenden Automatisierung erneut hoch, entsteht die nächste Version — der Store überschreibt nie Geschichte, jede frühere Version bleibt exakt, wo sie war.

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

## Wo das hingehört

Automatisierungen kommen auf drei Wegen an — mit der Organisation ausgeliefert, auf dem Canvas gebaut oder als Pack hochgeladen — und jeder Weg endet an derselben Stelle: eine Entwurfsversion auf der Seite der Automatisierung, deployt auf dein Kommando. Ein Zip-Upload bestückt zusätzlich die [Skill-Bibliothek](/de/platform/workspace/skills) mit den Bundles, die die Automatisierung braucht, mit einer Bestätigung vor jedem Skill, den er ersetzen würde. [Der Workflow-Editor](/de/platform/automations/editor) ist die nächste Lektüre, um den Entwurf live zu nehmen.
