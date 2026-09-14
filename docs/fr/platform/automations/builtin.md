---
title: Automatisations livrées
description: Choisis un workflow de courrier ou GitHub et vérifie ses données, connexions et écritures avant sa mise en service.
---

Tale fournit huit paquets d’automatisation : trois synchronisations de courrier, trois résumés de boîte de réception et deux workflows GitHub. Chacun commence en version 1, avec une planification et le statut **Pas en service**. Utilise-les comme points de départ. Examine les données attendues, le modèle, les connexions et les écritures avant qu’un Propriétaire, Admin ou Développeur mette une version en service.

<Frame caption="Le catalogue affiche les noms des paquets, le nombre de versions et leur état de mise en service.">

![Le catalogue liste des paquets GitHub et de courrier, chacun avec une version et le statut Pas en service.](/images/platform/automations-catalog.webp)

</Frame>

## Commencer avec un paquet

Ouvre **Automatisations**, choisis un paquet et examine ses nœuds dans l’[éditeur de workflow](/fr/platform/automations/editor). Le connector requis doit être connecté, et le modèle de chaque nœud `llm` disponible. Un essai utilise des réponses simulées : il vérifie le déroulement sans prouver l’accès à ta boîte de réception ou à ton dépôt réel.

Les paquets sont ajoutés à la création de l’organisation. Lorsque le paquet fourni évolue, tes versions existantes sont conservées ; seuls son nom et sa description fournis sont actualisés. Un paquet supprimé reste supprimé. Tes modifications créent de nouvelles versions, que tu mets en service séparément.

## Synchroniser le courrier dans la Boîte de réception

Ces workflows importent les nouveaux messages dans des conversations toutes les cinq minutes. Chacun fournit la vue **Boîte de réception** : sa mise en service l’ajoute à la navigation et propose la boîte connectée dans le formulaire de rédaction. Avant cela, la page de réception renvoie vers **Automatisations**.

| Automatisation | Connector requis | Planification |
| --- | --- | --- |
| Synchroniser les e-mails Gmail | Gmail | Toutes les 5 minutes |
| Synchroniser les e-mails Outlook | Outlook | Toutes les 5 minutes |
| Synchroniser les e-mails via SMTP/IMAP | IMAP/SMTP | Toutes les 5 minutes |

Connecte d’abord la boîte correspondante. Après la première exécution réelle, examine son [journal](/fr/platform/automations/execution-logs) et vérifie que les messages attendus apparaissent dans la Boîte de réception.

## Lire un résumé des messages récents

Ces workflows lisent toutes les six heures les messages récents de chaque boîte connectée de leur type. Ils produisent un résumé et repèrent les messages qui semblent demander une réponse aujourd’hui. Le résumé constitue la sortie de l’exécution : ouvre celle-ci pour le lire. Ils n’écrivent rien dans la boîte et ne changent pas le statut des conversations.

| Automatisation | Connector requis | Planification |
| --- | --- | --- |
| Trier la boîte de réception Gmail | Gmail | Toutes les 6 heures |
| Trier la boîte de réception Outlook | Outlook | Toutes les 6 heures |
| Trier la boîte de réception IMAP | IMAP/SMTP | Toutes les 6 heures |

## Examiner le travail sur GitHub

**Trier les issues GitHub** lit les issues ouvertes, évalue leur caractère exploitable et leur priorité, puis renvoie une sélection classée avec les raisons. Le workflow n’écrit rien sur GitHub et ne crée pas de tâche de projet. Sa limite par défaut est de 50 issues par exécution.

**Examiner les pull requests GitHub** lit les diffs des pull requests ouvertes et publie ses conclusions sous forme de commentaires de revue. Sa limite par défaut est de 10 pull requests par exécution. Il n’approuve ni ne fusionne de pull request. Vérifie le dépôt cible avant une exécution réelle : une nouvelle exécution peut ajouter d’autres commentaires.

| Automatisation | Connector requis | Planification fournie | Écritures |
| --- | --- | --- | --- |
| Trier les issues GitHub | GitHub | Chaque jour à 07:00 UTC | Aucune ; lis la sortie de l’exécution |
| Examiner les pull requests GitHub | GitHub | Toutes les 30 minutes | Un commentaire de revue par pull request traitée |

Les deux workflows exigent `owner` et `repo`. Dans **Essai**, renseigne **Données de l’exécution (JSON)** avec les valeurs de ton dépôt :

```json
{
  "owner": "ton-organisation",
  "repo": "ton-depot",
  "limit": 5
}
```

<Note>

Les planifications GitHub fournies ne transmettent ni `owner` ni `repo` : la mise en service seule ne suffit donc pas à rendre ces exécutions planifiées valides. Une planification envoie `trigger` et `firedAt`, que le schéma d’entrée inchangé refuse. Lance le workflow manuellement avec les données requises, ou adapte le schéma et la configuration du dépôt avant d’activer les exécutions planifiées. Un démarrage planifié refusé apparaît comme `start_refused` sur le [déclencheur](/fr/platform/automations/triggers).

</Note>

Avant la mise en service, lis les données résolues et la sortie de l’essai. Pour une exécution réelle, vérifie aussi les permissions du connector et les approbations nécessaires. Les [journaux d’exécution](/fr/platform/automations/execution-logs) expliquent les attentes, les échecs et les écritures enregistrées.
