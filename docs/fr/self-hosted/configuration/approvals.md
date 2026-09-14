---
title: Définir les règles d’approbation des automations
description: Choisis les écritures de connectors qui demandent une validation humaine et vérifie la priorité des règles.
---
Les règles d’approbation déterminent si une écriture de connector s’exécute immédiatement ou attend une personne. Par défaut, une écriture vers un système externe exige une approbation ; les connectors internes authentifiés par la plateforme peuvent écrire. Adapte cette limite par organisation lorsque son processus de revue l’exige.

## Définir la politique de l’organisation

Enregistre les règles dans `TALE_CONFIG_DIR/<orgSlug>/governance/approval-policy.yml`. Chaque règle désigne exactement un `connector` ou une `action` complète, puis une `decision`.

Cet exemple exige une revue pour les écritures du connector interne `task` et autorise `imap-smtp.send` sans approbation distincte :

```yaml
rules:
  - connector: task
    decision: require_approval
  - action: imap-smtp.send
    decision: auto_approve
```

<Warning>

`auto_approve` autorise l’écriture correspondante sans revue humaine à ce point de contrôle. Vérifie l’action exacte, les identifiants et les destinataires prévus avant d’autoriser une action externe comme l’envoi d’un e-mail.

</Warning>

Utilise les identifiants du catalogue livré, pas les noms traduits affichés. Une action s’écrit `<connector>.<action>` ; les décisions autorisées sont `auto_approve` et `require_approval`.

## Comprendre les priorités

Une règle d’action prime sur une règle de connector, quel que soit leur ordre. Parmi les règles de même précision, la dernière correspondance gagne. Sans correspondance, Tale applique le comportement interne ou externe décrit plus haut. Évite de répéter une cible pour que la politique reste lisible.

La politique s’applique aux nouvelles évaluations. Une approbation en attente reste en attente si tu assouplis la règle ; elle n’est pas accordée silencieusement. Ce fichier ne supprime pas les autres contrôles, comme la publication d’une automation ou la clôture d’une tâche qui nécessite une revue.

## Vérifier l’effet

Teste avec une automation isolée et des données sans conséquence avant d’activer la règle en production. Vérifie une opération correspondante et une opération qui doit garder son comportement par défaut. Consulte l’approbation en attente et la trace d’exécution dans le [parcours des approbations](/fr/platform/approvals/configure).

Chaque nouvelle décision d’écriture lit la politique et le slug actuels de l’organisation, sans utiliser le bref cache d’affichage. Si la politique est invalide ou si son répertoire de configuration est indisponible, l’opération s’arrête avant l’écriture. Répare la configuration avant de réessayer. Seule l’absence du fichier dans une arborescence accessible permet d’utiliser les règles par défaut. Un fichier `.yml` invalide ne laisse jamais la place à un fichier `.json` voisin. Les approbations déjà enregistrées conservent leur décision, y compris celles en attente et les opérations déjà autorisées.
