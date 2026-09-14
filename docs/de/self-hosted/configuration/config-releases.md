---
title: Client-Konfigurationen veröffentlichen
description: Ein versioniertes Automatisierungspaket mit der Tale-CLI aus einem Client-Repository erstellen, prüfen und bereitstellen und danach die nativen Workflow- und Skill-Dateien verifizieren.
---

Ein Konfigurations-Release installiert einen geprüften Workflow samt eigenen Skills in einer bestehenden Organisation und einem Projekt. Seine Kennung ist der vollständige Quell-Commit. Nutze diesen Ablauf, wenn die Anwendungslaufzeit bestehen bleibt; für neue Instanzen oder Laufzeitänderungen gelten [verwaltete Bereitstellungen](/de/self-hosted/install/cli-install).

## Ergebnis jedes Befehls kennen

| Befehl | Vor dem nächsten Schritt prüfen |
| --- | --- |
| `config build` | Manifest und kompilierte Archive aus einer committeten Quellrevision. |
| `config verify --rebuild` | Eine unabhängige Rekonstruktion stimmt mit den geprüften Artefakten überein. |
| `config stage` | Übertragbares Verzeichnis nur mit Bereitstellungsdateien und deren Hash-Inventar. |
| `config deploy` | Workflow und eigene Skills sind installiert, zurückgelesen und in einem dauerhaften Beleg erfasst. |
| `config verify-native` | Lesender Vergleich mit dem derzeit installierten Inhalt. |

Eine **native** ID oder Sitzung gehört hier zur Tale-Zielinstanz. Ein **Beleg** hält ein Bereitstellungsergebnis fest und ersetzt keine Prüfung des aktuellen Servers. Format- und Byteprüfung bestätigen kein fachliches Ergebnis der Automatisierung. Bewahre deshalb fachliche Tests im Kunden-Repository auf.

## Bevor du beginnst

Installiere die [Tale-CLI](/de/self-hosted/install/cli-install) und lege eine Revision fest, die Paketformat und APIs des Zielservers unterstützt. Konfigurationsbefehle wählen Quelle und Ziel explizit. Sie brauchen weder eine lokale `tale.json` noch einen Docker-Kontext oder ein benachbarten Tale-Quellordner. Der enthaltene Parser und Validator prüfen unterstützte Felder; sie ergänzen keine neueren Serverfunktionen auf einer älteren Instanz.

Du brauchst einen committeten Client-Deskriptor und ein Paket, eine bestehende Organisation und ein Projekt sowie eine berechtigte native Sitzung. Trägt das Paket eigene Skills, verwende die native Benutzer-ID dieser Sitzung als Build-Inhaber. Projekt-, Organisations- und externe Identitäts-IDs sind davon getrennt.

Für eine neue Instanz ohne native IDs nutzt du ein verwaltetes Deployment mit expliziter neuer Identität, symbolischem Projekt und `skillOwner: "operator"`. Es überträgt geprüfte Quellen und kompiliert erst nach dem Nachweis des nativen Betreibers; die eigenständigen Release-Befehle brauchen weiter aufgelöste IDs. Halte die Geschäftskonfiguration im eigenen Client-Quellbaum. Externe Modelleinstellungen gehören in die Deployment-Deklaration.

Die Beispiele verwenden den synthetischen Client `example-team` mit der Automatisierung `document-review`. Übergib das vollständige Sitzungscookie über `TALE_CONFIG_COOKIE` aus deinem Secret Manager. Es gehört weder in Argumente und Quellen noch in Archive, Belege oder Logs.

## Deskriptor und Paket committen

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

## Quell-Commit bauen und prüfen

Setze `CONFIG_REPO` auf den Quellordner, `CONFIG_SOURCE_COMMIT` auf den vollständigen Quell-Commit mit 40 Zeichen und `TALE_NATIVE_USER_ID` auf die native Benutzer-ID. Wähle für `CONFIG_BUILD` ein neues absolutes Ausgabeverzeichnis außerhalb des Checkouts. Diese Befehle bauen das Release und rekonstruieren seine Bytes unabhängig.

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

## Transferverzeichnis vorbereiten

Verwende einen Quellordner, dessen `HEAD` dem `CONFIG_SOURCE_COMMIT` entspricht. Wähle für `CONFIG_STAGE` ein neues absolutes Verzeichnis außerhalb dieses Quellordners. Das optionale `DEPLOYMENT_COMMIT` hält den vollständigen Commit deiner Deployment-Deklaration fest. Lass `--deployment-ref` weg, wenn du keinen solchen Commit führst.

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

## Bereitstellen und Ergebnis zurücklesen

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

## Eine unterbrochene Bereitstellung wiederaufnehmen

Bewahre das genaue Transferverzeichnis und den Beleg während der Untersuchung auf. Wähle den nächsten Schritt nach dem von der CLI gemeldeten Zustand:

| Zustand | Sicherer nächster Schritt |
| --- | --- |
| Ein vertrauenswürdiger Beleg hält Teilfortschritt fest | Wiederhole mit demselben Verzeichnis, Ziel und Beleg. Identische Skills lassen sich wiederverwenden. |
| Eine passende Version ist bereits bereitgestellt | Lies sie mit `verify-native` zurück. Auch eine erneute Bereitstellung prüft sie vor der Meldung, dass sich nichts geändert hat. |
| Upload-Antwort verloren, nur unveröffentlichte Version sichtbar | Halte an und untersuche. Die native API kann deren vollständigen Aufgabenvertrag vor dem Deployment nicht lesen; die CLI kann ihre Wiederverwendung daher nicht belegen. |
| Release-Skill-Slug mit abweichenden Bytes vorhanden | Sichere die Hinweise und ermittle das widersprechende Release oder die Änderung. Überschreibe nichts, um die Prüfung zu bestehen. |
| Beleg unlesbar oder für ein anderes Ziel | Stelle den richtigen Beleg wieder her oder kläre die Abweichung vor einem neuen Versuch. Erfinde keinen Erfolgsbeleg. |

Koordiniere Bereitstellungen auf dasselbe Ziel. Lokale Sperren hindern weder andere Hosts noch Administratoren daran, native Inhalte zu ändern. Wiederhole nach der Wiederherstellung die Betriebstests des Clients und die unabhängige native Prüfung.

## Ein historisches Release rekonstruieren

Vorhandene semantische Releases bleiben als Kompatibilitätsweg erhalten: `build --config-version` wählt Schema 3/Compiler 2; `stage --config-version` verwendet den committeten Katalog und explizite Katalog-/Ops-Referenzen. Lass ursprüngliche Manifeste und Archive unverändert. Ein Deskriptor kann historische Quellsnapshots mit Prüfsummen für die Offline-Rekonstruktion registrieren; prüfbar sind nur die Felder dieses Formats. Alte geteilte Skills lassen sich nur bei ausdrücklicher Freigabe und bereits identischen Bytes wiederverwenden. Stelle abweichende historische Inhalte über ein neues Release her.

Historische Rekonstruktion braucht zusätzliche Werkzeuge. Schema 1 nutzt Git `archive --mtime`; prüfe, ob dein gewähltes Git die Option unterstützt. Schema 2/Compiler 1 verwendet die Standardbibliothek von Python 3. Schema 3/Compiler 2, Schema 4/Compiler 3 und native Deployments brauchen kein Python.

Bewahre Quellen, fachliche Tests, geprüfte Archive, CLI-Revision, Bereitstellungsreferenzen und Beleg zusammen auf. Sitzungscookies und Zugangsdaten bleiben außerhalb dieser Artefakte im Secret-Manager. [Upgrades](/de/self-hosted/operate/upgrades) und [Backups und Wiederherstellung](/de/self-hosted/operate/backups-and-restore) behandeln die umgebende Laufzeit und deren Daten.
