---
title: Kryptografie
description: Die Algorithmen, die Tale für Daten im Ruhezustand, Daten bei der Übertragung, Passwort-Hashing und Audit-Log-Integrität nutzt.
---

Diese Seite ist die Inventur jedes kryptografischen Primitivs, auf das sich Tale stützt: was Secrets auf der Festplatte schützt, was den Verkehr auf der Leitung schützt, wie Passwörter gehasht werden und wie das Audit-Log beweist, dass es nicht manipuliert wurde. Sie ist für Betreiber und Compliance-Prüfer geschrieben, die "welche Algorithmen, welche Schlüssellängen, wo liegen die Schlüssel" gegen einen Standard wie BSI TR-02102-1 beantworten müssen — Tale nutzt bereits konforme Primitive, und auf dieser Seite sind sie festgehalten.

Die Angaben hier sind gegen den Quellcode verifiziert; wo ein Primitiv konfigurierbar ist, wird die Umgebungsvariable benannt, die es steuert, damit du dein eigenes Deployment prüfen kannst. Das ist kein Ersatz dafür, die Host-Festplatte zu verschlüsseln — siehe [Härtung](/de/self-hosted/operate/security/hardening) für die Schicht unter der Anwendung.

## Ruhende Daten

Tale verschlüsselt zwei Klassen von Secrets im Ruhezustand, mit zwei verschiedenen Mechanismen.

**Provider-API-Schlüssel** liegen in `providers/*.secrets.json` und werden mit [SOPS](/de/self-hosted/configuration/secrets-with-sops) unter Nutzung eines **age**-Schlüssels verschlüsselt. SOPS verschlüsselt jeden Wert mit **AES-256-GCM** und wrappt den Datenschlüssel an den age-Empfänger, dessen Schlüsselaustausch **X25519** ist. Ein verschlüsselter Wert liest sich auf der Festplatte als `ENC[AES256_GCM,data:…,iv:…,tag:…]`; die Entschlüsselung passiert in-process und der private age-Schlüssel verlässt den Speicher des platform-Containers nie.

**Anwendungsverschlüsselte Felder** — OAuth-Connector-Tokens und ähnliche Credentials in der Datenbank — werden mit **AES-256-GCM** über ein kompaktes JWE (`alg: dir`, `enc: A256GCM`) verschlüsselt. Der 32-Byte-Schlüssel kommt aus `ENCRYPTION_SECRET` (base64) oder `ENCRYPTION_SECRET_HEX` (hex); die Plattform verweigert den Start des Verschlüsselungspfads mit einem Schlüssel, der nicht exakt 32 Byte hat.

Die Postgres-Volumes und der Blob-Store werden vom Host geschützt: betreibe sie auf einem verschlüsselten Dateisystem (LUKS oder die Volume-Verschlüsselung deines Cloud-Anbieters). Tale speichert Credentials nicht im Klartext — ein Provider-Schlüssel oder OAuth-Token ist entweder SOPS-verschlüsselt auf der Festplatte oder AES-256-GCM-verschlüsselt in der Datenbank, nie im Klartext geschrieben.

**Kunden-PII und Anwendungsdaten** — Namen, E-Mail- und Postadressen, Gesprächsinhalte — sind im Ruhezustand durch dieselben Schichten geschützt, die die Datenbank als Ganzes schützen: die Dateisystem-Verschlüsselung des Hosts (siehe oben), TLS 1.3 bei der Übertragung und organisations-begrenzte Zugriffskontrolle, die jeden Lesezugriff auf die Organisation des Aufrufers begrenzt.

Anwendungsseitige Feldverschlüsselung ist gezielt für Secrets gemacht — Provider-Schlüssel und OAuth-Tokens, die einmal geschrieben und von einem einzigen Code-Pfad gelesen werden. PII ist anders: Sie wird gefiltert, sortiert und über den exakten Wert nachgeschlagen, und die Kundentabelle ist nach Organisation und E-Mail indiziert. Diese Spalten auf Feldebene zu verschlüsseln würde Gleichheitsabfragen und indizierte Suche brechen — sofern nicht mit einem suchbaren Hash-Verfahren kombiniert, das genau die Gleichheit preisgibt, die es verbergen soll — bei zusätzlichen Kosten für die Schlüsselrotation und ohne Schutz, den die verschlüsselte Host-Festplatte unter der Anwendung gegen ein gestohlenes Volume nicht ohnehin bietet.

Wenn dein Compliance-Regime zusätzlich Feldverschlüsselung für PII verlangt, ist das eine bewusste Anwendungsänderung statt eines Standards, den Tale mitliefert.

## Daten bei der Übertragung

Aller Browser- und API-Verkehr terminiert TLS am Reverse-Proxy (Caddy), der TLS 1.3 (mit TLS 1.2 als Untergrenze) aushandelt und Zertifikate automatisch bezieht. Die Cipher-Suites sind die modernen Defaults des Proxys — AES-256-GCM und ChaCha20-Poly1305 mit ECDHE-Schlüsselaustausch. Konfiguriere Domain und Zertifikatsquelle in [TLS und Domains](/de/self-hosted/configuration/tls-and-domains); der Verkehr zwischen Containern bleibt im internen Docker-Netz des Hosts.

## Passwort-Hashing

Lokale-Passwort-Konten werden mit **bcrypt** gehasht (über Better Auth), sodass eine gestohlene Datenbankzeile das Passwort nicht preisgibt und eine Verifikation bewusst ~100 ms kostet — was auch der Grund ist, warum das Timing des Login-Pfads verschleiert wird (siehe [Authentifizierung](/de/self-hosted/configuration/authentication)). Sessions werden mit `BETTER_AUTH_SECRET` (HMAC) signiert; das Rotieren dieses Secrets entwertet jede bestehende Session.

## Integrität des Audit-Logs

Das Audit-Log ist über eine **SHA-256-Hash-Kette** manipulationssicher: jeder Eintrag speichert `SHA-256(previousHash + kanonisierter Datensatz)`, sodass das Ändern oder Löschen eines historischen Eintrags die Kette an dieser Stelle und bei jedem folgenden Eintrag bricht. Einträge tragen zusätzlich eine **HMAC-SHA-256**-Signatur. Die Admin-Integritätsprüfung verifiziert beides; siehe [Audit-Logs](/de/platform/admin/governance/audit-logs).

## Zuordnung zu BSI TR-02102-1

Jedes Primitiv unten liegt im empfohlenen Satz von BSI TR-02102-1. Tale liefert keinen veralteten Algorithmus aus (kein MD5, SHA-1, DES oder RSA &lt; 3072 auf einem selbst erzeugten Schlüssel).

| Verwendung              | Algorithmus                       | Schlüssel-/Ausgabegröße | Gesteuert durch                               |
| ----------------------- | --------------------------------- | ----------------------- | --------------------------------------------- |
| Provider-Secrets (Disk) | AES-256-GCM + age (X25519)        | 256-Bit                 | `SOPS_AGE_KEY` / `SOPS_AGE_KEY_FILE`          |
| App-Felder (Datenbank)  | AES-256-GCM (JWE `dir`/`A256GCM`) | 256-Bit                 | `ENCRYPTION_SECRET` / `ENCRYPTION_SECRET_HEX` |
| Übertragung             | TLS 1.3 (AES-256-GCM, ECDHE)      | 256-Bit                 | Reverse-Proxy / `tls-and-domains`             |
| Passwort-Hashing        | bcrypt                            | Salt pro Hash           | Better Auth (eingebaut)                       |
| Session-Signierung      | HMAC-SHA-256                      | 256-Bit                 | `BETTER_AUTH_SECRET`                          |
| Audit-Integrität        | SHA-256-Kette + HMAC-SHA-256      | 256-Bit                 | eingebaut                                     |

## Schlüsselspeicherung und -rotation

Drei Secrets sind tragend, und jedes hat einen Rotationspfad. Der **private age-Schlüssel** (`SOPS_AGE_KEY`) entschlüsselt Provider-Secrets; rotier ihn, indem du einen neuen Empfänger hinzufügst und neu verschlüsselst, entlang des Wegs in [Secrets mit SOPS](/de/self-hosted/configuration/secrets-with-sops). Der **Feld-Verschlüsselungsschlüssel** (`ENCRYPTION_SECRET`) entschlüsselt Datenbank-Credentials; ihn zu rotieren erfordert das Neu-Verschlüsseln der betroffenen Zeilen, plan es also als Wartungsschritt statt als Hot-Swap. Das **Auth-Secret** (`BETTER_AUTH_SECRET`) signiert Sessions; es zu rotieren loggt alle bei ihrer nächsten Anfrage aus. Alle drei leben nur in der Umgebung des platform-Containers — committe sie nie und leg sie in deinem Secret-Manager der Wahl ab.

## Wo das hingehört

Kryptografie in Tale ist geschichtet: SOPS+age und AES-256-GCM schützen Secrets im Ruhezustand, TLS 1.3 schützt sie bei der Übertragung, bcrypt schützt Passwörter, und eine SHA-256-Kette beweist, dass das Audit-Log intakt ist — alles Primitive, die im empfohlenen Satz von BSI TR-02102-1 liegen, mit den steuernden Umgebungsvariablen oben, damit du deine eigene Instanz verifizieren kannst.

Die Schicht unter der Anwendung ist der Host selbst: [Härtung](/de/self-hosted/operate/security/hardening) deckt die Egress-Allowlist, die Container-Isolation und die Erwartungen an die Festplattenverschlüsselung ab, die diese Seite voraussetzt, und [Secrets mit SOPS](/de/self-hosted/configuration/secrets-with-sops) ist die operative Anleitung für den age-Schlüssel, von dem diese Algorithmen abhängen.
