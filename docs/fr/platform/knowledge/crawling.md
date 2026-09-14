---
title: Ajouter des sites aux connaissances
description: Choisis les pages publiques à indexer, règle la fréquence des scans et examine les contenus absents ou périmés.
---

Ajoute un site lorsque ton équipe doit interroger un contenu public qui évolue. Tale récupère les pages sélectionnées et indexe leur texte lisible pour la recherche dans les connaissances. La gestion des sources nécessite le rôle Éditeur ou supérieur. Les pages protégées par une connexion demandent un autre parcours d’import, comme [Documents](/fr/platform/knowledge/documents).

## Ajouter un site ou des pages précises

Ouvre **Connaissances > Sites web** et clique sur **Ajouter un site web**. Choisis le type de source avant de saisir l’adresse :

| Type de source | Quand l’utiliser | Valeur à saisir |
| --- | --- | --- |
| **Site web entier** | Tu veux découvrir le contenu d’un domaine | Un **Domaine**, par exemple `example.com` |
| **Liste d'URL** | Tu veux un ensemble précis de pages ou documents publics | Une adresse par ligne sous **URL** |

Le mode site entier accepte une URL mais utilise son nom d’hôte. Coller un chemin ne limite pas le scan à ce chemin ; utilise une liste d’URL pour cela. Les formes avec et sans `www` désignent le même site : les ajouter toutes deux déclenche un avertissement de doublon.

Choisis l’**Intervalle d'analyse**, puis **Enregistrer**. La valeur par défaut est de six heures ; les choix vont d’une heure à trente jours. Le planificateur prend en charge la nouvelle source. L’enregistrement ne signifie pas que toutes les pages ont déjà été récupérées et indexées.

<Frame caption="Le mode site entier demande un domaine et un intervalle. Choisis une liste d’URL lorsque la sélection des pages compte.">

![Le dialogue d’ajout d’un site présente Domaine et Intervalle de scan, réglé sur six heures par défaut.](/images/platform/websites-add-dialog.webp)

</Frame>

## Garder une liste d’URL ciblée

Une liste récupère uniquement les adresses fournies et ne suit aucun autre lien. Elle peut couvrir plusieurs sites ; Tale les regroupe en une source par site. Ajouter une liste à une source de type liste d’URL existante complète les adresses sans retirer les précédentes et actualise son intervalle de scan.

Utilise des URL publiques complètes. Les PDF et documents Office modernes liés peuvent être indexés s’ils contiennent du texte lisible. Les images et scans sans texte extractible ne deviennent pas des contenus recherchables.

## Comprendre la découverte et l’actualisation

Pour un site entier, le crawler utilise l’accueil et les sitemaps publiés, y compris les index de sitemaps et ceux déclarés dans `robots.txt`. Sans sitemap exploitable, il suit les liens du domaine depuis l’accueil. Une page absente des sitemaps et inaccessible par ces liens peut manquer. Utilise une liste d’URL si des pages précises sont indispensables.

Les scans sont incrémentaux : les contenus inchangés sont ignorés, les contenus modifiés réindexés, les nouvelles pages ajoutées et les pages retirées supprimées de l’index. Une liste d’URL actualise sa sélection fixe au même rythme. Aucune publication séparée n’est nécessaire après l’indexation.

Le crawler visite en lecteur anonyme. Il n’y a ni champ de connexion ni liste de chemins à inclure ou exclure pour le site entier. Ajouter une URL ne rend pas accessible un contenu privé.

## Vérifier le contenu indexé

Le tableau affiche **Statut**, **Indexé**, **Analysé** et **Intervalle**. Survole le pourcentage pour voir le nombre de pages récupérées et le total. Ouvre la source puis **Voir les pages** pour examiner les URL, le nombre de mots et de fragments et la date du dernier passage.

| Statut | Signification |
| --- | --- |
| **Inactif** | Attend entre deux scans. |
| **En cours d'analyse** | Un scan est en cours. |
| **Actif** | Un scan s’est terminé avec succès. Vérifie les résultats page par page pour connaître la couverture. |
| **Erreur** | Le dernier scan a échoué ; examine la cause. |
| **Suppression en cours** | La source est en cours de retrait. |

La vue des pages permet aussi de rechercher dans le contenu indexé. Essaie une expression distinctive de la page avant de t’appuyer dessus dans Chat, puis pose une question précise et vérifie la citation.

## Examiner une page absente

Vérifie d’abord l’adresse, le type de source et la date du dernier scan. En cas d’échec, la ligne indique la cause et le nombre d’essais consécutifs échoués : erreur HTTP, adresse privée bloquée, problème de rendu ou extraction non prise en charge. Corrige la source ou attends que le site redevienne disponible.

Une page de liste d’URL est retentée aux scans suivants tant qu’elle reste dans la liste. Une page découverte automatiquement est abandonnée après cinq scans échoués. Une récupération réussie efface l’erreur précédente. Si le scan semble correct mais qu’une information manque, compare le texte indexé à l’original : un scan réussi ne garantit pas que chaque élément visible est devenu du texte recherchable.

Si la source affiche **Suspendu**, des échecs répétés d’accès à la base de connaissances ont arrêté les analyses. Demande à un administrateur de réparer la connexion dans **Paramètres > Résidence des données**, puis utilise **Reprendre l'analyse**.
