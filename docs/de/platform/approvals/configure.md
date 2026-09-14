---
title: Festlegen, welche Aktionen eine Freigabe brauchen
description: Verstehe die Standardregeln, veranlasse eine Richtlinienänderung und unterscheide Operationsfreigaben von anderen Prüfungen.
---

Eine Freigaberichtlinie bestimmt, welche Connector-Schreibzugriffe in einem Live-Lauf auf eine Person warten müssen. Prüfe externe Aktionen vor der Bereitstellung, besonders wenn ein Workflow Nachrichten sendet oder andere Systeme verändert. [Freigaben verstehen](/de/platform/approvals/concepts) erklärt die Entscheidungskarte.

## Das Standardverhalten verstehen

Lesezugriffe brauchen keine Operationsfreigabe. Schreibzugriffe auf externe Systeme warten standardmäßig auf eine Freigabe, etwa E-Mail-Versand, Slack-Nachrichten, neue GitHub-Issues oder WebDAV-Schreibzugriffe. Interne Aktionen wie das Ändern einer Aufgabe oder Speichern eines Dokuments in Tale fragen standardmäßig nicht.

Auch erlaubte Aktionen unterliegen den jeweiligen Zugriffsregeln. Eine fehlende Freigabekarte beweist nicht, dass eine Aktion nur liest. Es kann sich um einen internen oder ausdrücklich automatisch freigegebenen Schreibzugriff handeln.

## Eine Richtlinienänderung veranlassen

In den Connector-Einstellungen gibt es keinen Freigabeschalter pro Aktion. Die Organisationsrichtlinie kann Freigaben für einen Connector oder eine einzelne Aktion verlangen oder ausnehmen. Eine aktionsbezogene Regel hat Vorrang vor der Regel des gesamten Connectors.

Bitte die für dein Deployment zuständige Person, die [Freigaberichtlinie](/de/self-hosted/configuration/approvals) anzupassen. Nenne die genaue Operation, den Grund für eine Freigabepflicht oder automatische Ausführung und den betroffenen Workflow. Auch Cloud-Admins stimmen dies mit der zuständigen Betriebsstelle ab.

Eine bereits wartende Operation behält ihre offene Freigabe nach der Richtlinienänderung. Entscheide diese Karte ausdrücklich. Eine Lockerung gibt sie nicht automatisch frei.

## Einen Workflow vor dem Live-Betrieb prüfen

1. Prüfe bei jedem Connector-Knoten, ob er liest oder schreibt.
2. Kläre, welche Schreibzugriffe die wirksame Organisationsrichtlinie automatisch freigibt.
3. Nutze **Testlauf**, um Ein- und Ausgabe mit Mocks zu prüfen.
4. Prüfe in einem kontrollierten Live-Lauf die Operation und ihre genauen Eingaben auf jeder offenen Karte, bevor du entscheidest.

Ein Mock-Test beweist nicht, dass im Live-Lauf eine Freigabe erscheint. Mock-Connectors verändern keine externen Systeme und fragen nicht nach Freigaben.

## Andere menschliche Entscheidungen unterscheiden

| Entscheidung | Zugehörige Regeln |
| --- | --- |
| Ein Agentenergebnis annehmen | [Aufgaben automatisieren](/de/platform/projects/task-automation). Eine Person verschiebt das Ergebnis von In Prüfung nach Erledigt. |
| Eine gelenkte Dokumentversion freigeben | [Dokumente](/de/platform/knowledge/documents). Der benannte Reviewer entscheidet über die eingefrorene Version. |
| Eine Löschanfrage genehmigen | [Anfragen betroffener Personen](/de/platform/admin/governance/data-subject-requests). Ein zweiter Admin gibt die nötige Freigabe. |
| Die Frage eines Agentenknotens beantworten | [Freigaben in Workflows](/de/platform/automations/approvals-in-workflows). Dem Lauf fehlt eine Information zum Fortsetzen. |

Für diese Entscheidungen gelten eigene Regeln. Die Connector-Freigaberichtlinie schaltet sie nicht ab. Der Chat verwendet nur lesende Abrufwerkzeuge und erzeugt keine Operationsfreigaben.
