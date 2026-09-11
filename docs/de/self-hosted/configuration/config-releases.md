---
title: Client-Konfigurationen veröffentlichen
description: Ein versioniertes Automatisierungspaket mit der Tale-CLI aus einem Client-Repository erstellen, prüfen und bereitstellen und danach die nativen Workflow- und Skill-Dateien verifizieren.
---

Die Tale-CLI veröffentlicht Automatisierungspakete aus dem Repository eines Clients in einer bestehenden Organisation und einem Projekt. Der vollständige Quell-Commit kennzeichnet jedes neue Release; damit kannst du Workflow und eigene Skill-Dateien ohne zusätzlichen Commit generierter Archive reproduzieren. Das Client-Repository enthält die Inhalte und fachlichen Tests. Deine Deployment-Automatisierung wählt Ziel, Quell-Commits und CLI-Revision und ruft die Tale-Befehle auf.

Dieser Leitfaden behandelt nur die Konfiguration. Für Instanz und Konfiguration zusammen nutzt du die [Befehle für verwaltete Deployments](/de/self-hosted/install/cli-install#verwaltete-deployments); die CLI übernimmt auch Runtime-Vorbereitung, Rollout und native Provisionierung.

## Bevor du beginnst

Installiere die [Tale-CLI](/de/self-hosted/install/cli-install) und lege eine Revision fest, die Paketformat und APIs des Zielservers unterstützt. Konfigurationsbefehle wählen Quelle und Ziel explizit. Sie brauchen weder eine lokale `tale.json` noch einen Docker-Kontext oder ein benachbartes Tale-Checkout. Der enthaltene Parser und Validator prüfen unterstützte Felder; sie ergänzen keine neueren Serverfunktionen auf einer älteren Instanz.

Du brauchst einen committeten Client-Deskriptor und ein Paket, eine bestehende Organisation und ein Projekt sowie eine berechtigte native Sitzung. Trägt das Paket eigene Skills, verwende die native Benutzer-ID dieser Sitzung als Build-Inhaber. Projekt-, Organisations- und externe Identitäts-IDs sind davon getrennt.

Für eine neue Instanz ohne native IDs nutzt du ein verwaltetes Deployment mit expliziter neuer Identität, symbolischem Projekt und `skillOwner: "operator"`. Es überträgt geprüfte Quellen und kompiliert erst nach dem Nachweis des nativen Betreibers; die eigenständigen Release-Befehle brauchen weiter aufgelöste IDs. Halte [private Inferenzdeklarationen](/de/self-hosted/configuration/private-inference) im selben Client-Quellbaum.

Die Beispiele verwenden den synthetischen Client `example-team` mit der Automatisierung `document-review`. Übergib das vollständige Sitzungscookie über `TALE_CONFIG_COOKIE` aus deinem Secret Manager. Es gehört weder in Argumente und Quellen noch in Archive, Belege oder Logs.

## Schritt 1 — Inhalte im Client-Repository halten

Lege den Deskriptor unter `tale/client.json`, Pakete unter `tale/packs/` und fachliche Tests daneben ab. Bewahre dort auch vorhandene historische Release-Kataloge auf. Pfade im Deskriptor beziehen sich auf dessen Verzeichnis.

Ergänze `.tale/` in der `.gitignore` des Clients, falls der Eintrag fehlt. Standard-Builds halten dort lokale Sperrdaten; Befehle mit explizitem Ausgabeziel koordinieren sich neben ihrer Ausgabe. Die gepflegte Konfiguration liegt in `tale/` ohne Punkt.

```json
{
  "schemaVersion": 1,
  "clientId": "example-team",
  "sourceRepository": "https://github.com/example-team/client-app",
  "automations": [
    {
      "name": "document-review",
      "displayName": "Document review",
      "packPath": "packs/document-review",
      "releasesPath": "releases/document-review",
      "logicalSkillSlugs": ["record-check"],
      "requiredExternalSkills": []
    }
  ]
}
```

`logicalSkillSlugs` nennt die mitgelieferten Skill-Verzeichnisse. `requiredExternalSkills` nennt bereits in Tale installierte Abhängigkeiten: Die CLI prüft ihr Vorhandensein, dieses Release legt ihre Bytes aber nicht fest. Zugangsdaten, Zielhosts und Projekt-IDs gehören in die Deployment-Konfiguration. Committe Deskriptor und Paket; der Compiler liest Git-Objekte statt uncommitteter Änderungen.

## Schritt 2 — Den Quell-Commit bauen und prüfen

Setze `CONFIG_REPO` auf das Checkout, `CONFIG_SOURCE_COMMIT` auf den vollständigen Quell-Commit mit 40 Zeichen und `TALE_NATIVE_USER_ID` auf die native Benutzer-ID. Wähle für `CONFIG_BUILD` ein neues absolutes Ausgabeverzeichnis außerhalb des Checkouts. Diese Befehle bauen das Release und rekonstruieren seine Bytes unabhängig.

```bash
tale --json config build \
  --repo "$CONFIG_REPO" \
  --descriptor tale/client.json \
  --automation document-review \
  --source-commit "$CONFIG_SOURCE_COMMIT" \
  --skill-owner "$TALE_NATIVE_USER_ID" \
  --output "$CONFIG_BUILD"

tale --json config verify \
  --repo "$CONFIG_REPO" \
  --descriptor tale/client.json \
  --automation document-review \
  --manifest "$CONFIG_BUILD/$CONFIG_SOURCE_COMMIT.json" \
  --rebuild
```

Das Standardmanifest nutzt Schema 4/Compiler 3. Es hält `releaseRef` gleich `sourceCommit` sowie Paketbaum, Deskriptor-Hash und vollständiges kompiliertes Inventar fest. Die Ausgabe umfasst das kanonische ZIP, ein ZIP je eigenem Skill und ein ZIP nur für die Workflow-Installation. Eigene Skill-Slugs tragen den vollständigen Quell-SHA; Compiler-Metadaten erhalten ihre logische Identität. Die vollständigen Skill-Bytes enthalten den festgelegten Inhaber. Ein anderer Inhaber erfordert einen neuen Quell-Commit und ein neues Release.

Verlange beim erneuten Build identische Bytes und führe die fachlichen Tests des Clients gegen das entpackte kanonische ZIP aus. Bewahre die geprüften Artefakte auf und übernimm `artifactSha256` als `CONFIG_ARTIFACT_SHA256`. Die native Formatprüfung beweist, dass sich das Paket interpretieren lässt; sie bestätigt keine fachlichen Ergebnisse. Neue quellbasierte Deployments brauchen keinen zusätzlichen Commit mit generierten Release-Dateien.

## Schritt 3 — Den exakten Quell-Commit zum Transfer vorbereiten

Verwende ein Checkout, dessen `HEAD` dem `CONFIG_SOURCE_COMMIT` entspricht. Wähle für `CONFIG_STAGE` ein neues absolutes Verzeichnis außerhalb dieses Checkouts. Das optionale `DEPLOYMENT_COMMIT` hält den vollständigen Commit deiner Deployment-Deklaration fest. Lass `--deployment-ref` weg, wenn du keinen solchen Commit führst.

```bash
tale --json config stage \
  --repo "$CONFIG_REPO" \
  --descriptor tale/client.json \
  --automation document-review \
  --config-ref "$CONFIG_SOURCE_COMMIT" \
  --skill-owner "$TALE_NATIVE_USER_ID" \
  --client example-team \
  --deployment-ref "$DEPLOYMENT_COMMIT" \
  --output "$CONFIG_STAGE"
```

Die Vorbereitung baut den committeten Deskriptor samt Paket, prüft die Archive unabhängig und stellt nur zugelassene Deployment-Dateien mit einem gehashten Inventar zusammen. Uncommittete Änderungen fließen nicht ein. Vergleiche den Artefakt-Hash mit dem geprüften Build. Übertrage das Verzeichnis als vollständige Einheit; das native Ziel braucht weder das Client-Checkout noch dessen Git-Zugangsdaten.

Lege Repository-URL und vollständigen Quell-SHA des Clients, CLI-Revision und optional die Deployment-Revision fest. Die Herkunft hängt auch von deinem vertrauenswürdigen Checkout ab: Eine URL im Deskriptor beweist nicht, welcher Remote ein lokales Git-Objekt geliefert hat.

## Schritt 4 — Bereitstellen und das Ergebnis zurücklesen

Setze `TALE_CONFIG_URL`, `TALE_CONFIG_ORIGIN`, `TALE_ORG_ID` und `TALE_PROJECT_ID` auf das freigegebene native Ziel. Halte `CONFIG_RECEIPT` auf dauerhaftem Speicher. Prüfe die vorbereiteten Dateien und gib für einen autorisierten unbeaufsichtigten Lauf `--yes` an. Führe danach eine getrennte Leseprüfung aus. Nutze dieselbe optionale Deployment-Referenz wie bei der Vorbereitung.

```bash
tale --json --yes config deploy \
  --stage "$CONFIG_STAGE" \
  --url "$TALE_CONFIG_URL" \
  --origin "$TALE_CONFIG_ORIGIN" \
  --org "$TALE_ORG_ID" \
  --project "$TALE_PROJECT_ID" \
  --receipt "$CONFIG_RECEIPT" \
  --config-ref "$CONFIG_SOURCE_COMMIT" \
  --source-repository https://github.com/example-team/client-app \
  --artifact-sha256 "$CONFIG_ARTIFACT_SHA256" \
  --deployment-ref "$DEPLOYMENT_COMMIT"

tale --json config verify-native \
  --stage "$CONFIG_STAGE" \
  --url "$TALE_CONFIG_URL" \
  --origin "$TALE_CONFIG_ORIGIN" \
  --org "$TALE_ORG_ID" \
  --project "$TALE_PROJECT_ID" \
  --config-ref "$CONFIG_SOURCE_COMMIT" \
  --source-repository https://github.com/example-team/client-app \
  --artifact-sha256 "$CONFIG_ARTIFACT_SHA256" \
  --deployment-ref "$DEPLOYMENT_COMMIT"
```

Die Ziel-URL bezeichnet den erreichbaren API-Endpunkt; Origin ist die kanonische Browser-Origin, auch bei einer lokalen API hinter einem Proxy. Die angemeldete native Benutzer-ID muss dem festgelegten Skill-Inhaber entsprechen.

Das Deployment erstellt fehlende eigene Skills über den nativen Upload, der nur neue Skills anlegt, und prüft jedes installierte Byte. Vorhandene identische Bytes lassen sich wiederverwenden; abweichende Bytes unter demselben Release-Slug führen zur Ablehnung. Der reine Workflow-Import kann keine Skills schreiben. Vor der Erfolgsmeldung prüft die CLI den bereitgestellten Workflow, Einstellungen, Darstellung, Aufgabenvertrag und Projektbindung.

Führe `verify-native` nach dem Deployment und den Betriebstests aus. Der Befehl importiert nichts und erzeugt weder Version noch Beleg. Auch ein wiederholtes Deployment liest den aktuellen nativen Inhalt, bevor es ein unverändertes Release meldet. Ein gespeicherter Beleg allein beweist keine aktuellen Bytes.

## Ein unterbrochenes Deployment wiederaufnehmen

Bewahre Transferverzeichnis und Beleg auf. Ein erneuter Aufruf kann identische Skills wiederverwenden und aus einem vertrauenswürdigen gespeicherten Beleg fortfahren oder eine bereits bereitgestellte passende Version vollständig prüfen. Ging die Upload-Antwort verloren und ist nur eine passende unveröffentlichte Version sichtbar, hält die CLI an: Die native API kann deren vollständigen Aufgabenvertrag vor dem Deployment nicht lesen. Erfinde keinen Beleg und importiere kein Duplikat, um diesen Halt zu umgehen.

Koordiniere Deployments auf dasselbe Ziel. Lokale Sperren bieten weder hostübergreifendes Compare-and-swap noch Schutz vor nativen Admin-Änderungen. Untersuche Abweichungen anhand des aufbewahrten Releases; ein Überschreib-Flag ist kein Wiederherstellungsweg.

Vorhandene semantische Releases bleiben als Kompatibilitätsweg erhalten: `build --config-version` wählt Schema 3/Compiler 2; `stage --config-version` verwendet den committeten Katalog und explizite Katalog-/Ops-Referenzen. Lass ursprüngliche Manifeste und Archive unverändert. Ein Deskriptor kann historische Quellsnapshots mit Prüfsummen für die Offline-Rekonstruktion registrieren; prüfbar sind nur die Felder dieses Formats. Alte geteilte Skills lassen sich nur bei ausdrücklicher Freigabe und bereits identischen Bytes wiederverwenden. Stelle abweichende historische Inhalte über ein neues Release her.

Historische Rekonstruktion braucht zusätzliche Werkzeuge. Schema 1 nutzt Git `archive --mtime`; prüfe, ob dein gewähltes Git die Option unterstützt. Schema 2/Compiler 1 verwendet die Standardbibliothek von Python 3. Schema 3/Compiler 2, Schema 4/Compiler 3 und native Deployments brauchen kein Python.

## Das Release prüfbar halten

Du hast jetzt einen festgelegten Quell-Commit, reproduzierbare Artefakte und einen nativen Beleg, den du mit dem tatsächlichen Inhalt vergleichen kannst. Bewahre Quellen, Tests, geprüfte Artefakte und Deployment-Referenzen zusammen auf. Die [CLI-Referenz](/de/self-hosted/install/cli-install) beschreibt auch vollständige verwaltete Instanz-Deployments; [Upgrades](/de/self-hosted/operate/upgrades) sowie [Backups und Wiederherstellung](/de/self-hosted/operate/backups-and-restore) behandeln den umgebenden Lebenszyklus.
