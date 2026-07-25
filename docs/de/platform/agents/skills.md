---
title: Agent-Skills
description: Einen Skill aus der Bibliothek der Organisation an einen Agenten binden — die Liste auf dem Tab Skills, ihre Obergrenze und der Weg eines Bundles in eine Sandbox-Sitzung.
---

Ein Agent kommt an einen Skill nur heran, wenn du ihn bindest. In der [Skill-Bibliothek](/de/platform/workspace/skills) der Organisation liegen die Bundles, und der Tab **Skills** eines Agenten ist die Liste, die festhält, welche davon diese Persona aufklappen darf. Bind ein Bundle an drei Agenten, und das Verhalten bleibt in einer einzigen Datei, die du einmal pflegst.

Diese Seite ist die Agent-Seite der Skills: was eine Bindung entscheidet, wo die Obergrenze liegt und was sich ändert, sobald der Zug in einer Sandbox läuft. Geschrieben und geteilt werden die Bundles selbst in der Bibliothek.

## Was eine Bindung entscheidet

Ein gebundener Skill wird dem Agenten über seine Beschreibung angeboten. Hält das Modell diese Beschreibung für einschlägig, klappt es das Bundle auf: Es liest den Body der `SKILL.md` und öffnet einzelne Bundle-Dateien dort, wo der Body auf sie verweist. Nichts wird ausgeführt und nichts vorab eingefügt — ein Skill kostet nur in den Zügen Kontext, in denen der Agent tatsächlich danach greift.

Ein Bundle, dessen Frontmatter `disable-model-invocation: true` trägt, verhält sich anders. Es bleibt gebunden und lesbar, aber das Modell darf nicht von sich aus danach greifen; es wartet auf einen Zug, in dem jemand es benennt.

## Einen Skill an einen Agenten binden

Öffne den Agenten, wechsle auf **Skills** und wähle aus der Bibliothek der Organisation. Ein Zähler neben der Liste zeigt, wie viel von der Obergrenze du verbraucht hast: Ein Agent darf **höchstens zehn Skills** binden. Die Zehn ist Absicht — so eine Liste pflegt jemand von Hand, und jenseits einer Handvoll tut das niemand mehr.

Behandle die Liste als harte Erlaubnis, nicht als Hinweis. Ein Agent mit leerer Liste klappt überhaupt keine Skills auf; es gibt keinen stillen Rückfall auf alles, was die Organisation gerade teilt. Gebunden wird pro Agent, und es geht in beide Richtungen — zwei Agenten dürfen dasselbe Bundle binden, und ein Lösen wirkt ab der nächsten Anfrage.

<Note>

Welche Bundles überhaupt zur Auswahl stehen, entscheidet die Bibliothek und nicht dieser Tab: Ein `org` Skill wird der ganzen Organisation angeboten, ein `private` nur dort, wo sein Besitzer arbeitet. Geteilt wird über das Feld `visibility` auf der Seite [Skill-Bibliothek](/de/platform/workspace/skills).

</Note>

## Wenn sich das Bundle darunter ändert

Eine Bindung nennt einen Slug, nie einen Stand. Ersetz ein Bundle in der Bibliothek, und jeder daran gebundene Agent liest ab der nächsten Anfrage den neuen Text — es gibt keine Version festzuschreiben und nichts neu zu binden. Genau das macht es lohnend, ein Verhalten überhaupt herauszulösen: Eine Änderung erreicht jeden Agenten, der es hält.

<Warning>

Ein gelöschter Skill verschwindet von der Platte, und jeder daran gebundene Agent verliert den Zugriff, ohne Rückfallebene. Willst du ändern, was drinsteht, ersetz das Bundle; löschen solltest du erst, wenn du geprüft hast, welche Agenten es noch nennen.

</Warning>

## Skills in einer Sandbox-Sitzung

Läuft ein Zug in einer Sandbox, kommen gebundene Bundles nicht über einen Tool-Aufruf. Sie werden als Dateien in die Sitzung gelegt, in der Anordnung, die die Laufzeitumgebung ohnehin kennt — der Drittanbieter-Agent findet sie also so, wie er einen Skill auf jeder anderen Maschine fände.

Für Kollisionen gilt eine Regel: Das Repository gewinnt. Bringt das ausgecheckte Repository einen Skill unter demselben Slug mit, den auch Tale legen würde, hält Tale seine Kopie zurück, und die Fassung aus dem Repository bleibt stehen. Ein Repository kann damit immer überschreiben, was die Plattform dem Agenten sonst beibrächte, und in der Sitzung liegen nie zwei Bundles unter einem Namen. Verglichen wird exakt: Ein Slug, der sich um ein einziges Zeichen unterscheidet, ist ein anderer Skill, und beide werden gelegt.

## Skill oder Anweisungen

| Nimm … wenn                                                  | Skill | Agent-Anweisungen |
| ------------------------------------------------------------ | ----- | ----------------- |
| Das Muster über mehrere Agenten hinweg wiederkehrt           | ✓     |                   |
| Zum Text noch Referenzdateien gehören                        | ✓     |                   |
| Es um die Stimme genau dieses einen Agenten geht             |       | ✓                 |
| Eine Änderung alle erreichen soll, die das Verhalten nutzen  | ✓     |                   |
| Die Anweisungen des Agenten noch auf einen Bildschirm passen |       | ✓                 |

Anweisungen sind die richtige Form für den Charakter eines einzelnen Agenten. Ein Skill ist die richtige Form, sobald dasselbe Verhalten bei einem zweiten und dritten Agenten auftaucht und es anfängt, Mühe zu kosten, deren Anweisungen im Gleichschritt zu halten.

## Wo das hingehört

Das Binden ist die schmale Hälfte der Skills: Die Bibliothek entscheidet, was existiert und wer es sehen darf, der Tab **Skills** entscheidet, welche Persona was aufklappen darf. Halte die Listen kurz, ersetze ein Bundle lieber, als es zu klonen, und lass ein Repository überschreiben, was die Plattform legt, wenn ein Agent darin arbeitet. Die andere Hälfte — eine `SKILL.md` schreiben, ein Zip hochladen und ein Bundle für die Organisation freigeben — steht in der [Skill-Bibliothek](/de/platform/workspace/skills).
