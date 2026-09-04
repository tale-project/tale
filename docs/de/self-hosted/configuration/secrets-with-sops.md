---
title: Secrets mit SOPS
description: Wie Tale Anbieter-Schlüssel auf Platte mit SOPS und age verschlüsselt, die drei Speicher-Modi und der vollständige Schlüssel-Rotations-Walk.
---

Tale speichert Anbieter-API-Schlüssel in `providers/*.secrets.json`-Dateien auf Platte. Der Default-Modus nach `tale init` verschlüsselt diese Dateien mit SOPS unter Verwendung eines age-Schlüssels; ein alternativer Modus liest mehrere Schlüssel aus einer Datei (der Rotations-Pfad); ein dritter Modus hält die Dateien als Klartext mit Dateimodus 0600 für Umgebungen, in denen die Platte at-rest verschlüsselt ist und die Rotation extern gehandhabt wird. Diese Seite ist der Operator-Durchgang durch die drei Modi und den sicheren Rotations-Pfad.

Die Env-Vars, die die Modi steuern, sind `SOPS_AGE_KEY` und `SOPS_AGE_KEY_FILE` — ihre Referenz-Zeilen leben in [Umgebungsvariablen-Referenz](/de/self-hosted/configuration/environment-reference#provider-secrets-encryption). Diese Seite ist die längere Geschichte.

## Die drei Modi

| Modus                | Env-Vars                           | Wann nutzen                                                              |
| -------------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| Inline age-Schlüssel | `SOPS_AGE_KEY=AGE-SECRET-KEY-1...` | Default nach `tale init`. Einzelner Host, einzelner Schlüssel.           |
| Schlüssel-Datei      | `SOPS_AGE_KEY_FILE=/path/to/keys`  | Pflicht für Rotation. Ein age-Schlüssel pro Zeile, `#`-Kommentare.       |
| Klartext bei 0600    | Beide unset                        | Platte at-rest verschlüsselt, oder externe Tooling schreibt die Dateien. |

Der Plattform-Container wählt den Modus beim Boot. Die Inline-Form ist die einfachste; die Datei-Form ist die einzige, die mehrere Leser unterstützt (was Rotation ohne Downtime möglich macht); die Klartext-Form überspringt SOPS ganz und vertraut dem Dateisystem.

## Verschlüsselter Modus beim ersten Boot

`tale init` generiert ein age-Schlüsselpaar und schreibt die private Hälfte in `SOPS_AGE_KEY` in deiner `.env`. Anbieter-Secret-Dateien, die durch **Einstellungen > Anbieter** geschrieben werden, werden beim Speichern verschlüsselt:

```bash
# Inspizieren — die Datei ist SOPS-verschlüsseltes JSON, nicht der Klartext-API-Schlüssel
cat providers/openai.secrets.json
# {
#   "apiKey": "ENC[AES256_GCM,data:...,iv:...,tag:...]",
#   "sops": { ... }
# }
```

Entschlüsselung passiert in-process, wenn der Plattform-Container die Datei liest. Der age-Schlüssel verlässt den Speicher des Plattform-Containers nie.

## Den age-Schlüssel rotieren

Rotation ist der eine Pfad, den die Inline-Form nicht abdeckt — nur `SOPS_AGE_KEY_FILE` erlaubt dir, Ciphertext anzunehmen, der sowohl mit dem alten als auch dem neuen Schlüssel während des Umschaltens lesbar ist. Der Walk:

```bash
# 1. Generiere einen neuen age-Schlüssel
age-keygen -o /etc/tale/age-keys.txt

# 2. Häng den neuen Schlüssel als zweite Zeile in der Datei an
echo "AGE-SECRET-KEY-1NEW..." >> /etc/tale/age-keys.txt

# 3. Richte .env auf die Datei und starte den Plattform-Container neu
sed -i 's|^SOPS_AGE_KEY=.*|# SOPS_AGE_KEY=|' .env
sed -i 's|^# SOPS_AGE_KEY_FILE=.*|SOPS_AGE_KEY_FILE=/etc/tale/age-keys.txt|' .env
docker compose restart platform backend-api backend-worker
```

Jetzt können sowohl der alte als auch der neue Schlüssel bestehende Dateien entschlüsseln. Speichere den API-Schlüssel jedes Anbieters unter **Einstellungen > Anbieter** neu — jedes Speichern erzeugt Ciphertext, der von beiden Schlüsseln lesbar ist. Sobald jeder Anbieter neu gespeichert wurde (die Spalte **Zuletzt rotiert** in der Anbieter-Tabelle sagt dir, welche noch alten Ciphertext halten), entferne den alten Schlüssel aus der Datei:

```bash
# 4. Lass die alte Schlüssel-Zeile fallen und starte erneut neu
sed -i '/^AGE-SECRET-KEY-1OLD/d' /etc/tale/age-keys.txt
docker compose restart platform backend-api backend-worker
```

Die Reihenfolge ist tragend: Entfern den alten Schlüssel nie, bevor jede Datei neu verschlüsselt ist, oder der Plattform-Container scheitert beim Lesen der noch-alten Dateien bei der nächsten Entschlüsselung.

## Auf Klartext umsteigen

Wenn die Host-Platte at-rest verschlüsselt ist (LUKS, AWS-EBS-Verschlüsselung, GCP CSEK) und du keine zweite Schicht Schlüssel-Verwaltung willst, ist der Klartext-Modus die unterstützte Option. Kommentier sowohl `SOPS_AGE_KEY` als auch `SOPS_AGE_KEY_FILE` aus, starte neu und speichere jeden Anbieter neu — die Dateien sind jetzt JSON mit Modus 0600.

Das Risikomodell verschiebt sich: Ein durchgesickerter Dateisystem-Dump ist jetzt ein durchgesickertes Credential-Dump. Wähl diesen Modus nur, wenn die Platten-Verschlüsselung echt ist (kein Häkchen), und auditiere die Backup-Story des Hosts, um zu bestätigen, dass kein Klartext-Snapshot entweicht.

## Externe Secret-Stores

Wenn deine Schlüssel schon in Vault, einem Cloud-Secret-Manager oder Kubernetes Secrets liegen, ist die Umgebungsvariablen-Schlüsselquelle das erstklassige Pattern: zeig jeden Anbieter mit `secretsEnv` auf eine **Umgebungsvariable** und lass deinen Secret-Store diese Variable befüllen. Keine Klartext-Datei landet auf der Platte, und die Präfix-Schranke hindert einen Config-Schreib-Akteur daran, ein fremdes Deployment-Secret zu lesen. Der vollständige Mechanismus — die `TALE_PROVIDER_KEY_`-Präfix-Schranke, die Auflösungs-Reihenfolge und das Neustart-bei-Änderung-Verhalten — lebt in [Anbieter](/de/self-hosted/configuration/providers#environment-variable-key-source).

Der Datei-Mount-Ansatz ist die Legacy-Alternative: Schreib die Klartext-`*.secrets.json`-Dateien aus dem externen Store und betreib Tale im Klartext-Modus. Das funktioniert weiterhin, legt aber den Klartext-Schlüssel auf die Platte und bricht, wenn du einen Anbieter über die UI speicherst — die UI überschreibt den Mount. Bevorzuge die Umgebungsvariablen-Quelle, sofern dich kein Zwang zur Datei-Form drängt.

## Wo das hingehört

Diese Seite ist die vollständige Operator-Anleitung zur SOPS-Schicht; die Env-Var-Referenz-Zeilen sind in [Umgebungsvariablen-Referenz](/de/self-hosted/configuration/environment-reference#provider-secrets-encryption), und das Anbieter-Dateiformat selbst in [Anbieter](/de/self-hosted/configuration/providers). Ist ein Schlüssel durchgesickert, ist die Rotation derselbe Walk oben, dringend ausgeführt.
