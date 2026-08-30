---
title: Connectors
description: Wie ein Connector deklariert wird, was eine seiner Aktionen einem Aufrufer zusichert und wann stattdessen ein MCP-Server die richtige Wahl ist.
---

Connectoren sind die anbieterspezifische Hälfte davon, wie Tale andere Systeme erreicht, und sie gehören zur Plattform statt zu etwas, das eine Organisation zusammenbaut. Jeder von ihnen ist eine YAML-Datei im Quellbaum und deklariert, mit wem er spricht, wie er sich anmeldet und jede Aktion, die er ausführen kann — daher sieht der Katalog in jedem Deployment gleich aus, und ein Upgrade genügt, um ihn weiterzubewegen. Lies das, wenn du wissen willst, was ein Connector einem Aufrufer tatsächlich zusichert, oder wenn du zwischen einem eigenen Beitrag und einem selbst betriebenen MCP-Server abwägst.

Die Seite für Organisationen — Zugangsdaten anlegen, Standard setzen, eine abgelaufene Freigabe erneuern — ist [Zugangsdaten für Connectors](/de/platform/admin/connectors); der Katalog selbst steht unter [Connectors](/de/platform/connectors/overview).

## Wie ein Connector deklariert wird

Jeder Connector ist ein Verzeichnis unter `configs/platform/system/connectors/`, benannt nach seinem Slug, mit einer `connector.yml` und dem Icon, das die Einstellungsseite rendert. Der Slug ist der Verzeichnisname, der deklarierte `name` des Connectors und die erste Hälfte des Node-Typs, mit dem eine Automation eine seiner Aktionen setzt — `<connector>.<action>`. Vierzehn Vendor-Connectoren erscheinen heute in den Einstellungen (plus einige Platform-Auth-Connectoren, die der Picker ausblendet).

Die Datei beginnt mit der Identität des Connectors und seinem Authentifizierungs-Vertrag, danach folgen die Aktionen:

```yaml
name: tavily
displayName: Tavily
description: Real-time web search and page extraction for AI research.
tags:
  - Search
allowedHosts:
  - api.tavily.com
auth:
  - method: api-key
actions:
  - name: search
    description: >-
      Search the open web via Tavily. Returns top results with title, URL,
      content snippet, and score.
    effects: read
    input:
      type: object
      required: [query]
      properties:
        query: { type: string, description: 'Natural-language search query.' }
        max_results: { type: number, description: 'Max results (1-10).' }
    output: '{ answer?: string, results: Array<{ title: string, url: string, content: string, score: number }> }'
```

`allowedHosts` ist die Egress-Grenze — ein Aktionsrumpf, der woanders hingreift, wird abgewiesen statt weitergeleitet. Ein Connector, dessen API bei der Kundschaft statt beim Anbieter liegt, ergänzt `endpointMode: per-credential`; jeder Eintrag trägt dann den Ursprung, aus dem seine Aufrufe gebaut werden. Confluence und Shopify sind die beiden ausgelieferten Fälle.

<Info>

Connectoren werden aus dem Baum der Plattform gelesen, nicht aus der Konfiguration einer Organisation, und es gibt keinen Upload-Weg, der zur Laufzeit einen hinzufügt. Einen Connector zu ergänzen ist ein Beitrag am Quellcode — siehe [Contributor-Setup](/de/develop/contributor-setup). Eine eigene Brücke ohne Eingriff in den Quellcode ist genau das, wofür MCP da ist.

</Info>

## Was eine Aktion zusichert

Eine Aktion ist ein Vertrag, und jedes Feld davon liegt offen, bevor der Aufruf passiert:

- **Name und Beschreibung.** Der Name vervollständigt den Node-Typ; die Beschreibung ist das, was ein Agent liest, wenn er entscheidet, ob diese Aktion die richtige ist.
- **Eingabe.** Ein JSON Schema — Objekttyp, Pflichtfelder und eine Beschreibung pro Property. Automationen prüfen die Konfiguration eines Nodes dagegen, und Agents füllen sie aus demselben Schema.
- **Ausgabe.** Eine Signatur der Form, die zurückkommt, damit beim Bauen eines Workflows klar ist, worauf der nächste Schritt zugreifen kann.
- **Effekte.** Entweder `read` oder `write`. Schreibende Aktionen laufen über die Genehmigungsrichtlinie der Organisation, und ein Aufruf, der keine Genehmigungsentscheidung erreicht, wird abgewiesen statt ungeprüft ausgeführt.

Aktionen lösen ihre Zugangsdaten zum Aufrufzeitpunkt auf: den Eintrag, den der Aufrufer benennt, oder den Standard des Connectors, wenn er keinen benennt. Genau diese Naht lässt dieselbe Automation gegen ein anderes Konto laufen, sobald sie auf einen anderen Namen zeigt. Mail-Sync und Posteingangs-Sichtung weichen davon absichtlich ab: `conversation.sync_mailbox` und `conversation.list_mailbox_messages` laufen über jeden aktiven Eintrag des Connectors, damit jedes verbundene Postfach dran ist, ohne dass eine Automation sie einzeln benennen muss.

## Die Authentifizierungsmethoden

Ein Connector deklariert die Methoden, die er akzeptiert, und ein Eintrag liegt an genau einer davon. Die vier stehen fest, weil jede einen anderen Weg beschreibt, auf dem ein Secret den Anbieter erreicht.

| Methode   | Bezeichnung in der Oberfläche | Was der Eintrag hält                                                                                                       |
| --------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `api-key` | API-Schlüssel                 | Ein einzelnes Secret, das der Aktionsrumpf selbst platziert — ein Anbieter-Header, ein Query-Parameter oder ein Body-Feld. |
| `bearer`  | Token                         | Ein Token, gesendet als Authorization-Header unter dem Schema, das der Connector nennt.                                    |
| `basic`   | Benutzername & Passwort       | Benutzername und Passwort als HTTP Basic — dieselbe Form, die auch ein Postfach-Login annimmt.                             |
| `oauth2`  | OAuth                         | Ein Authorization-Code-Grant: Access Token, Refresh Token, Ablauf und die erteilten Scopes.                                |

Secrets liegen verschlüsselt in einem einzigen Umschlag und wandern nie an einen Aufrufer zurück. Eine Auflistung zeigt eine maskierte Vorschau, die beim Schreiben des Eintrags berechnet wurde — das Lesen der Liste berührt den Geheimtext also nie.

## Eine OAuth-App registrieren

Ein `oauth2`-Connector deklariert die Authorize- und Token-URLs des Anbieters sowie die Scopes, die er anfragt; irgendwo muss die App herkommen, gegen die sich diese URLs authentifizieren. Zwei Quellen gibt es, und die spezifischere gewinnt:

- **Pro Organisation** — ein Org-Admin öffnet **Einstellungen > Connectors** und trägt unter **OAuth-Apps** Client-ID und Secret aus der App-Registrierung des Anbieters ein (plus die Verzeichnis-ID bei einer Single-Tenant-Microsoft-App; Tale autorisiert dann gegen diesen Tenant statt gegen `/common`). Das Secret liegt verschlüsselt und wird nie wieder angezeigt. Auf einem Multi-Org-Deployment bringt so jede Organisation ihre eigene Anbieter-App mit.
- **Pro Deployment** — Umgebungsvariablen, pro Connector benannt als `CONNECTOR_OAUTH_<SLUG>_CLIENT_ID` und `CONNECTOR_OAUTH_<SLUG>_CLIENT_SECRET`, mit großgeschriebenem Slug und Bindestrichen als Unterstriche. Sie sind der deployment-weite Standard überall dort, wo eine Organisation keine eigene App hinterlegt hat.

Slack ist die Ausnahme: Seine App bleibt reine Umgebungskonfiguration (`CONNECTOR_OAUTH_SLACK_*` plus Signing-Secret), weil die Signaturprüfung eingehender Events läuft, bevor irgendeine Organisation bekannt ist.

Registriere beim Anbieter genau diesen Callback als erlaubte Redirect-URI, gebaut aus `SITE_URL` und einem etwaigen `BASE_PATH`-Präfix des Deployments:

```text
${SITE_URL}${BASE_PATH}/api/connectors/oauth2/callback
```

Ist `SITE_URL` nicht gesetzt, verweigert der Freigabe-Flow den Start, statt einen Ursprung aus der Anfrage zu raten.

Persönlicher OneDrive- / Google-Drive-Import für Wissen ist **kein** Org-Connector — er löst seine OAuth-App aber auf demselben Weg auf, und die **google-drive**-App teilen sich beide Bahnen: ein Google-OAuth-Client mit beiden registrierten Redirect-URIs bedient den Connector und den Wissens-Import. Siehe [Dokumente](/de/platform/knowledge/documents) und den Cloud-Import-Redirect unter [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference).

<Warning>

Die Redirect-URI muss Byte für Byte übereinstimmen — Schema, Host, Pfad und kein abschließender Schrägstrich. Eine Abweichung scheitert schon am Freigabe-Dialog des Anbieters mit einem `redirect_uri`-Fehler, bevor Tale den Callback überhaupt sieht; das ist der mit Abstand häufigste Grund, warum ein frischer OAuth-Connector nicht verbindet.

</Warning>

## Die passende Oberfläche wählen

Zwei Oberflächen erreichen Systeme außerhalb von Tale, und die Wahl dreht sich darum, wem die Brücke gehört und wer sie betreibt.

| Oberfläche               | Greif dazu, wenn                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mitgelieferter Connector | Für das Zielsystem gibt es bereits einen. Deine Arbeit sind die Zugangsdaten, der Anbieter-Vertrag wird für dich gepflegt.                                           |
| MCP-Server               | Nichts Mitgeliefertes deckt das System ab — eine interne API, ein selbstgebautes Tool, ein Host, den nur dein Netz erreicht. Du schreibst und betreibst den Prozess. |

Ein MCP-Server wird unter **Einstellungen > API > MCP** registriert, und jedes Tool, das er freilegt, reiht sich neben den Connector-Aktionen in den Werkzeugkasten des Agents ein, jeweils mit eigenem Genehmigungs-Kennzeichen. Die Referenz ist [MCP-Server](/de/platform/connectors/mcp-servers); den Bau von Anfang bis Ende zeigt [MCP-Server von Grund auf](/de/tutorials/developer/mcp-server-from-scratch).

## Wo das hingehört

Ein Connector ist ein deklarierter Vertrag — Hosts, Authentifizierung und eine typisierte Aktionsliste — der mit der Plattform kommt und aus Zugangsdaten gespeist wird, die der Organisation gehören. Lies [Connectors](/de/platform/connectors/overview) für das, was im Katalog steht, [Zugangsdaten für Connectors](/de/platform/admin/connectors) für den täglichen Umgang mit diesen Einträgen, und [MCP-Server](/de/platform/connectors/mcp-servers), wenn die Brücke, die du brauchst, dein eigener Code sein muss.
</content>
</invoke>
