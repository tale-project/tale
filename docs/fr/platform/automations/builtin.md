---
title: Automatisations livrées
description: Choisis un workflow fourni pour les e-mails, GitHub ou GlitchTip, vérifie ses entrées et connexions et découvre ce qu’il lit ou écrit avant le déploiement.
---

Tale fournit dix paquets d’automatisation : trois synchronisations de courrier, trois résumés de boîte de réception, deux workflows de revue GitHub et des imports d’issues GitHub et GlitchTip. Chacun commence en version 1 avec le statut **Pas en service**. Les imports d’issues s’exécutent manuellement ; les autres paquets incluent une planification. Examine les données attendues, le modèle, les connexions et les écritures avant qu’un Propriétaire, Admin ou Développeur mette une version en service.

<Frame caption="Le catalogue affiche les noms des paquets, le nombre de versions et leur état de mise en service.">

![Le catalogue liste des paquets GitHub et de courrier, chacun avec une version et le statut Pas en service.](/images/platform/automations-catalog.webp)

</Frame>

## Commencer avec un paquet

Ouvre **Automatisations**, choisis un paquet et examine ses nœuds dans l’[éditeur de workflow](/fr/platform/automations/editor). Le connector requis doit être connecté, et le modèle de chaque nœud `llm` doit être un modèle que ton organisation sert — les paquets nomment un modèle que tes fournisseurs ne proposent peut-être pas ; la validation t’en avertit à l’enregistrement. Choisis un modèle servi dans le champ **Modèle** du nœud avant une exécution en direct. Un essai utilise des réponses simulées : il vérifie le déroulement sans prouver l’accès à ta boîte de réception ou à ton dépôt réel.

Les paquets sont ajoutés à la création de l’organisation. Lorsque le paquet fourni évolue, tes versions existantes sont conservées ; seuls son nom et sa description fournis sont actualisés. Un paquet supprimé reste supprimé. Tes modifications créent de nouvelles versions, que tu mets en service séparément.

## Synchroniser le courrier dans la Boîte de réception

Ces workflows importent les nouveaux messages dans des conversations toutes les cinq minutes. Chacun fournit la vue **Réception** : sa mise en service ajoute cette vue à [Accueil](/fr/platform#home) et propose la boîte connectée dans le formulaire de rédaction. Avant cela, **Accueil** n’a pas de vue **Réception**, et un lien vers la boîte de réception renvoie vers **Automatisations**.

| Automatisation | Connector requis | Planification |
| --- | --- | --- |
| Synchroniser les e-mails Gmail | Gmail | Toutes les 5 minutes |
| Synchroniser les e-mails Outlook | Outlook | Toutes les 5 minutes |
| Synchroniser les e-mails via SMTP/IMAP | IMAP/SMTP | Toutes les 5 minutes |

Connecte d’abord la boîte correspondante. Après la première exécution réelle, examine son [journal](/fr/platform/automations/execution-logs) et vérifie que les messages attendus apparaissent dans la vue **Réception** d’**Accueil**.

## Lire un résumé des messages récents

Ces workflows lisent toutes les six heures les messages récents de chaque boîte connectée de leur type. Ils produisent un résumé et repèrent les messages qui semblent demander une réponse aujourd’hui. Le résumé constitue la sortie de l’exécution : ouvre celle-ci pour le lire. Ils n’écrivent rien dans la boîte et ne changent pas le statut des conversations.

| Automatisation | Connector requis | Planification |
| --- | --- | --- |
| Trier la boîte de réception Gmail | Gmail | Toutes les 6 heures |
| Trier la boîte de réception Outlook | Outlook | Toutes les 6 heures |
| Trier la boîte de réception IMAP | IMAP/SMTP | Toutes les 6 heures |

## Importer et synchroniser des issues

**Importer les issues GitHub** et **Importer les issues GlitchTip** utilisent le même formulaire pour créer des tâches à partir des issues. Ces imports commencent sans planification. Ils lisent la source et écrivent des tâches Tale, sans commenter, fermer ni modifier les issues externes et sans démarrer d’agent.

1. Connecte la source dans **Paramètres > Connectors** et choisis ses identifiants par défaut. GitHub nécessite un accès au dépôt avec le droit de lire les issues. GlitchTip nécessite l’URL de l’instance et un token disposant de `project:read` et `event:read`. Un token réservé à la configuration des projets ne peut pas lire les issues. Une instance auto-hébergée doit être autorisée par la politique des hôtes du connecteur.
2. Ouvre l’import et choisis **Essai**. Sélectionne le **Projet Tale**, puis saisis le propriétaire et le dépôt GitHub ou les identifiants de l’organisation et du projet GlitchTip. Des labels facultatifs ou une recherche GlitchTip permettent de filtrer les nouvelles issues. **Nombre maximal d'issues** accepte 1–500, avec 100 par défaut.
3. Vérifie le résultat du test, mets la version en service, puis choisis **Exécuter en réel** avec la même destination et les mêmes filtres. Un test utilise des données d’exemple et ne crée aucune tâche. Seule une exécution réelle vérifie la connexion.
4. Ouvre **Exécutions** et sélectionne l’exécution. **Tâches importées** contient les liens vers les tâches Tale correspondantes. S’il reste un lot, **Poursuivre l'import** reprend la source, la destination et la position de continuation pour l’exécution suivante.

Chaque synchronisation recherche de nouvelles issues et actualise jusqu’à 500 issues déjà liées, en commençant par celles dont la vérification est la plus ancienne, même lorsqu’elles ne correspondent plus au filtre. Relance la synchronisation pour maintenir les grandes collections à jour. Les pull requests GitHub sont exclues. Un nouvel import réutilise la même identité source dans un projet Tale. Renommer un dépôt ou un projet actualise le lien vers la source sans créer une deuxième tâche. Une issue déplacée vers un autre dépôt ou projet source reste liée et continue d’être actualisée par les imports précédents, si la connexion peut accéder à son nouvel emplacement.

La fiche source d’une tâche affiche séparément le titre, la description et le statut actuels de l’issue. À l’import, Tale coupe sur la tâche les titres de plus de 200 unités de code UTF-16 et les descriptions de plus de 20 000 (la plupart des emojis en comptent 2) à cette longueur et les termine par « … » ; la fiche source et l’issue liée conservent le texte complet. Fermer ou résoudre une issue conserve le statut, le titre, la description, l’attribution et la priorité de la tâche Tale. Si une issue devient inaccessible, ses dernières informations connues restent visibles. Les erreurs d’authentification et les limites de requêtes font échouer l’exécution, sans déclarer l’issue supprimée. Vérifie et termine le travail dans Tale comme d’habitude.

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

Les planifications GitHub fournies ne transmettent ni `owner` ni `repo` : la mise en service seule ne suffit donc pas à rendre ces exécutions planifiées valides. Une planification n’envoie que `trigger` et `firedAt` : l’entrée de dépôt requise est donc absente et le démarrage est refusé. Lance le workflow manuellement avec les données requises, ou adapte le schéma et la configuration du dépôt avant d’activer les exécutions planifiées. Un démarrage planifié refusé apparaît comme `start_refused` sur le [déclencheur](/fr/platform/automations/triggers).

</Note>

Avant la mise en service, lis les données résolues et la sortie de l’essai. Pour une exécution réelle, vérifie aussi les permissions du connector et les approbations nécessaires. Les [journaux d’exécution](/fr/platform/automations/execution-logs) expliquent les attentes, les échecs et les écritures enregistrées.
