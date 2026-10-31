---
title: Kompetenzen
description: Gib einem Mitglied oder einem Team ein einzelnes, eng begrenztes Recht oder einem Mitglied eine Qualifikation ohne Admin-Rolle und widerrufe es, wenn es nicht mehr gebraucht wird.
---

Als Admin oder Inhaber führst du unter **Einstellungen > Richtlinien > Kompetenzen** das Kompetenzregister deiner Organisation. Eine Kompetenz ist eines von zwei Dingen:

- Eine **Plattform-Berechtigung** erlaubt einem Mitglied eine einzelne, eng begrenzte Aktion, für die sonst eine höhere Rolle nötig wäre. Weise sie dem Konto hinter einer Integration zu, statt es zum Admin zu machen. Als Admin könnte es auch Mitglieder, Single Sign-on und Passwörter verwalten.
- Eine **Qualifikation** ist ein Name, den die Freigaberichtlinie deiner Organisation von der Person verlangen kann, die eine Prüfung freigibt.

Du weist eine Kompetenz einem Mitglied zu oder eine Plattform-Berechtigung einem [Team](#grant-a-capability-to-a-team). Eine Zuweisung gilt nur in dieser Organisation. Tale protokolliert jede Zuweisung und jeden Widerruf im Audit-Log, und wer aus der Organisation entfernt wird, verliert seine Zuweisungen.

## Plattform-Berechtigungen

| Berechtigung                                                     | Was sie erlaubt                                                                                                                                                                                      |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Benachrichtigungen exportieren** (`tale:notifications.export`) | Die Benachrichtigungen, die ein anderes Mitglied sieht, über die REST-API lesen, damit eine andere Anwendung sie spiegeln kann.                                                                      |
| **Für ein anderes Mitglied handeln** (`tale:rest.act-as`)        | Bei einem API-Aufruf das Mitglied nennen, für das eine Frage beantwortet oder eine Prüfung entschieden wird. Zeitleiste der Aufgabe und Audit-Log zeigen dann diese Person statt des API-Schlüssels. |
| **Skills für die Organisation veröffentlichen** (`tale:skills.publish`) | Einen Skill mit der ganzen Organisation teilen, auch wenn die [Richtlinie zur Skill-Freigabe](/de/platform/admin/governance/policies-and-limits#skill-sharing) das Redakteuren oder Admins vorbehält. |
| **Modelle über die API aufrufen** (`tale:models.api`) | Die Modelle der Organisation mit einem persönlichen API-Schlüssel aus eigenen Tools aufrufen, über die [Modell-Endpunkte](/de/develop/use-tale-from-your-editor#model-endpoints), sobald die Organisation sie eingeschaltet hat. Öffnet außerdem **Einstellungen > API** mit den Tabs **REST** und **Modelle**, um den Schlüssel zu erstellen und die Einrichtung nachzulesen. |

Inhaber und Admins haben alle vier über ihre Rolle; Entwickler haben über ihre Rolle zusätzlich **Modelle über die API aufrufen**. Jedes andere Mitglied braucht die Zuweisung hier, zum Beispiel ein Entwickler-Konto, dessen API-Schlüssel eine Integration für einen Export verwendet. Ohne sie beantwortet die REST-API einen Export oder einen `actor` mit `403 ROLE_FORBIDDEN`, und die Modell-Endpunkte antworten mit `403 MODEL_API_FORBIDDEN`. Die [API-Referenz](/de/develop/api-reference#das-mitglied-benennen-fuer-das-gehandelt-wird) beschreibt die Anfragen mit Export und `actor`.

**Benachrichtigungen exportieren**, **Für ein anderes Mitglied handeln** und **Modelle über die API aufrufen** werden mit einem persönlichen API-Schlüssel genutzt; wer eine davon hat, kann deshalb auch unter **Einstellungen > API > REST** einen erstellen. Der Schlüssel handelt mit der eigenen Rolle; die Kompetenz fügt nur ihr eigenes Recht hinzu.

**Skills für die Organisation veröffentlichen** zählt nur, solange die Richtlinie zur Skill-Freigabe organisationsweite Skills vorbehält. Bei **Redakteure und höher** haben Redakteure und Entwickler dieses Recht schon über ihre Rolle. Ohne es kann ein Mitglied Skills nur mit seinen eigenen Teams teilen; Skill-Editor, Uploads und REST-API lehnen einen organisationsweiten Skill mit `403 SKILL_PUBLISH_FORBIDDEN` ab.

**Modelle über die API aufrufen** wirkt erst, wenn die Organisation die Modell-Endpunkte unter [Modelle](/de/platform/admin/governance/content-models#model-endpoints) eingeschaltet hat. Solange sie ausgeschaltet sind, weist der Dialog darauf hin, wenn du diese Kompetenz auswählst, und führt mit **Modellzugriff öffnen** dorthin; zuweisen kannst du sie trotzdem. Ein Mitglied mit dieser Kompetenz öffnet **Einstellungen > API** mit den Tabs **REST** und **Modelle**, um einen persönlichen Schlüssel zu erstellen und die Einrichtung zu kopieren; die Tabs **MCP** und **WebDAV** bleiben Inhabern, Admins und Entwicklern vorbehalten. Wird die Zuweisung widerrufen, lehnt Tale den nächsten Modellaufruf des Mitglieds ab.

## Eine Kompetenz zuweisen

1. Wähle **Kompetenz zuweisen**.
2. Wähle unter **Zuweisen an** entweder **Ein Mitglied** und dann das **Mitglied** oder **Ein Team** und dann das **Team**.
3. Wähle die **Kompetenz**: eine Plattform-Berechtigung oder **Qualifikation**. Gib bei einer Qualifikation unter **Name der Qualifikation** den Namen ein, den deine Freigaberichtlinie verwendet. Namen, die mit `tale:` beginnen, sind für Plattform-Berechtigungen reserviert. Ein Team kann nur eine Plattform-Berechtigung haben.
4. Lege unter **Läuft ab** fest, wann sie endet: **Nie**, **In 30 Tagen**, **In 90 Tagen** oder **In 1 Jahr**.
5. Halte bei Bedarf unter **Nachweis** fest, warum das Mitglied sie hat, etwa ein Zertifikat, ein Ticket oder das System, dem sie dient. Der Nachweis bleibt im Register.
6. Wähle **Zuweisen**.

Die Zuweisung gilt ab der nächsten Anfrage des Mitglieds; eine Integration muss nicht neu starten. Ein Mitglied oder ein Team hat jede Kompetenz nur einmal gleichzeitig. Um Ablauf oder Nachweis zu ändern, widerrufe die Zuweisung und weise sie erneut zu. Ist die Kompetenz bereits zugewiesen, sagt der Dialog das und weist nichts zu.

## Eine Berechtigung einem Team zuweisen {#grant-a-capability-to-a-team}

Weist du eine Plattform-Berechtigung einem Team zu, haben die Mitglieder des Teams sie, solange sie im Team sind; du musst sie nicht jedem einzeln zuweisen:

- Wen ein Inhaber oder Admin unter [**Einstellungen > Teams**](/de/platform/admin/teams) zum Team hinzufügt, hat sie ab der nächsten Anfrage, ohne weitere Zuweisung.
- Wer das Team verlässt oder aus der Organisation entfernt wird, hat sie nicht mehr über das Team.
- Widerrufst du die Zuweisung an das Team, endet sie für alle seine Mitglieder. Wird das Team gelöscht, werden seine Zuweisungen widerrufen.

Wer die Berechtigung zusätzlich über eine eigene Zuweisung oder über seine Rolle hat, behält sie.

Nur eine Mitgliedschaft, die ein Inhaber oder Admin unter **Einstellungen > Teams** angelegt hat, bringt die Zuweisungen des Teams mit. Eine Mitgliedschaft, die dein Identitätsanbieter über [SSO-Gruppensynchronisierung oder SCIM](/de/platform/admin/enterprise-sso) anlegt, bringt keine mit; so verleiht der Anbieter nie ein Recht. Ein Team, das der Anbieter verwaltet, zeigt im Dialog **Von deinem Identitätsanbieter synchronisiert** und lässt sich nicht auswählen; weise die Berechtigung dann jedem Mitglied einzeln zu oder einem Team, das ein Admin verwaltet.

Ein Team kann nur Plattform-Berechtigungen haben. Weise eine Qualifikation jedem Mitglied einzeln zu, das sie braucht, denn eine Freigaberichtlinie verlangt sie von der Person, die freigibt.

Eine Plattform-Berechtigung kannst du auch unter **Einstellungen > Mitglieder** zuweisen: Öffne das Zeilenmenü des Mitglieds, wähle **Rechte** und aktiviere den Schalter der Berechtigung. Derselbe Dialog öffnet sich mit Mitglied und Berechtigung bereits gewählt, und die Zuweisung landet in diesem Register. [Die Rechte eines Mitglieds prüfen](/de/platform/admin/members-and-roles#member-rights) erklärt, was die Schalter und ihre Gründe zeigen.

## Eine Kompetenz widerrufen

Wähle in der Zeile **Widerrufen** und bestätige mit **Widerrufen**. Das Mitglied verliert die Kompetenz sofort; bei einer Zuweisung an ein Team verlieren sie seine Mitglieder, außer sie haben sie über eine eigene Zuweisung. Die Zuweisung bleibt als Verlauf im Register, mit dem Status **Widerrufen** und dem Datum des Widerrufs. Zeige auf das Datum, um zu sehen, wer sie widerrufen hat oder warum.

Unter **Einstellungen > Mitglieder** widerrufst du eine Plattform-Berechtigung auf dieselbe Weise: Wähle im Zeilenmenü des Mitglieds **Rechte**, deaktiviere den Schalter der Berechtigung und bestätige mit **Widerrufen**.

## Das Register lesen {#read-the-register}

Die Liste zeigt zuerst die Zuweisungen mit dem Status **Aktiv**. Mit **Filter > Status** nimmst du **Abgelaufen** und **Widerrufen** hinzu, mit **Alle löschen** siehst du alle Zuweisungen.

| Status         | Bedeutung                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Aktiv**      | Das Mitglied hat die Kompetenz. Die Zeile darunter zeigt das Ablaufdatum oder **Kein Ablauf**.                                                         |
| **Abgelaufen** | Das Ablaufdatum unter dem Status ist vorbei. Weise die Kompetenz erneut zu, wenn das Mitglied sie weiter braucht.                                      |
| **Widerrufen** | Ein Admin oder Inhaber hat sie widerrufen, nach ihrem Ablauf hat eine neue Zuweisung sie ersetzt, ihr Mitglied hat die Organisation verlassen, oder ihr Team wurde gelöscht. Unter dem Status steht das Datum des Widerrufs. |

Eine Zuweisung an ein Team nennt das Team, markiert mit **Team**; nach dem Löschen des Teams steht dort **Gelöschtes Team**. Jede Zuweisung an ein Team und jeder Widerruf wird im [Audit-Log](/de/platform/admin/governance/audit-logs) mit ID und Namen des Teams protokolliert.

Wer aus der Organisation entfernt wird, verliert jede aktive Zuweisung — Berechtigungen wie Qualifikationen –, sodass ein erneut hinzugefügtes Mitglied ohne sie startet. Eine widerrufene Zuweisung an jemanden, der die Organisation verlassen hat, zeigt **Ehemaliges Mitglied**. Das Register listet alle aktiven und abgelaufenen Zuweisungen sowie als Verlauf die 1000 zuletzt widerrufenen.

<Tip>

Eine Integration kann ihren eigenen Schlüssel mit `GET /api/v1/me` prüfen: `capabilities.actAs`, `capabilities.notificationExport`, `capabilities.skillPublish` und `capabilities.modelApi` sagen, ob der Schlüssel die jeweilige Berechtigung nutzen darf, über seine Rolle oder eine Zuweisung; `capabilities.modelApi` verlangt außerdem eingeschaltete Modell-Endpunkte.

</Tip>
