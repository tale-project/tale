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

Le mode site entier accepte une URL mais utilise son nom d’hôte. Coller un chemin ne limite pas le scan à ce chemin ; utilise une liste d’URL pour cela. Une adresse en `http://` est refusée, parce que le crawler ne récupère qu’en HTTPS, et un point final est retiré. Les formes avec et sans `www` désignent le même site : les ajouter toutes deux déclenche un avertissement de doublon.

Choisis l’**Intervalle d'analyse**, puis **Enregistrer**. La valeur par défaut est de six heures ; les choix vont d’une heure à trente jours. Le planificateur prend en charge la nouvelle source. L’enregistrement ne signifie pas que toutes les pages ont déjà été récupérées et indexées.

<Frame caption="Le mode site entier demande un domaine et un intervalle. Choisis une liste d’URL lorsque la sélection des pages compte.">

![Le dialogue d’ajout d’un site présente Domaine et Intervalle de scan, réglé sur six heures par défaut.](/images/platform/websites-add-dialog.webp)

</Frame>

## Garder une liste d’URL ciblée

Une liste récupère uniquement les adresses fournies et ne suit aucun autre lien. Elle peut couvrir plusieurs sites ; Tale les regroupe en une source par site. Ajouter une liste à une source de type liste d’URL existante complète les adresses sans retirer les précédentes et actualise son intervalle de scan.

Utilise des URL publiques complètes. Les PDF et documents Office modernes liés peuvent être indexés s’ils contiennent du texte lisible. Les images et scans sans texte extractible ne deviennent pas des contenus recherchables.

## Comprendre la découverte et l’actualisation

Pour un site entier, le crawler utilise l’accueil et les sitemaps publiés, y compris les index de sitemaps et ceux déclarés dans `robots.txt`. Sans sitemap exploitable, il suit les liens du domaine depuis l’accueil. Une page absente des sitemaps et inaccessible par ces liens peut manquer. Utilise une liste d’URL si des pages précises sont indispensables.

Les scans sont incrémentaux : les contenus inchangés sont ignorés, les contenus modifiés réindexés, les nouvelles pages ajoutées et les pages retirées supprimées de l’index — comme les pages que le `robots.txt` en est venu à interdire. Les compteurs de pages de la ligne suivent le scan à mesure que les pages arrivent, après la découverte et après chaque lot stocké, la table bouge donc pendant qu’un scan tourne. Une liste d’URL actualise sa sélection fixe au même rythme. Aucune publication séparée n’est nécessaire après l’indexation.

Le crawler visite en lecteur anonyme. Ajouter une URL ne rend pas accessible un contenu privé.

Le crawler applique les règles `Disallow` de `robots.txt` destinées à l’agent `*` sur chaque chemin par lequel une URL peut entrer — les sitemaps, le parcours de liens et les liens qu’une page JavaScript révèle après rendu — et de nouveau avant chaque récupération : une page qu’une règle couvre n’est jamais récupérée, et une page qu’une règle ajoutée plus tard couvre quitte l’index au scan suivant. Les règles ne filtrent pas une liste d’URL explicite : une adresse listée est ta consigne. À chaque récupération, un en-tête HTTP `X-Robots-Tag: noindex` ou `none`, ou une balise HTML `<meta name="robots" content="noindex">`, empêche l’indexation, y compris pour une URL de liste, et retire ce qu’un scan antérieur avait stocké de la page. Ces règles sont une courtoisie, pas un contrôle d’accès : si tu administres le site source, ne compte pas sur le crawler comme mécanisme de contrôle d’accès.

Utilise HTTPS sur le port standard. Une adresse qui indique un autre port, comme `:8001`, est refusée. Les adresses privées et les redirections vers un réseau privé sont bloquées, sauf si l’exploitant a autorisé ces sources internes pour son installation.

## Tenir compte des limites du crawler

| Limite | Conséquence sur la couverture |
| --- | --- |
| 10 000 URL suivies par site | Certaines pages d’un grand site peuvent rester inconnues. Fournis une liste ciblée pour le contenu nécessaire. |
| Trois minutes de découverte, au plus 50 récupérations de sitemaps | Les ensembles de sitemaps volumineux ou lents peuvent rester incomplets. |
| 25 Mio et 30 secondes par récupération de contenu | Les téléchargements trop volumineux et les réponses lentes échouent (`timeout` pour le budget de téléchargement et celui de 20 secondes du rendu) ; une page derrière plus de cinq redirections aussi (`redirect_limit_exceeded`). |
| Cinq minutes de traitement par lot, jusqu’à 200 reprises | Un long scan se poursuit par lots. Une récupération ou un rendu déjà engagé peut dépasser le budget du lot ; il ne s’agit pas d’une durée totale garantie. |
| Cinq échecs consécutifs pour une URL découverte automatiquement | Le crawler cesse de programmer cette URL. Les URL fournies explicitement restent candidates à chaque scan, et une page listée que le site répond en 404 reste dans la liste avec cette réponse. |

Tu ne peux pas fixer ton propre plafond de pages, filtrer les chemins à inclure ou exclure, ni arrêter un scan avec un bouton. Une liste d’URL réduit la sélection demandée ; ces limites continuent de s’appliquer.

## Vérifier le contenu indexé

Le tableau affiche **Statut**, **Indexé**, **Analysé** et **Intervalle**. La colonne **Indexé** indique un nombre de pages. Ouvre la ligne du site pour examiner la liste des pages, le nombre de mots et de fragments et la date du dernier passage. Déplie une page pour lire ses fragments de texte enregistrés. Un échec de récupération affiche sa cause et le nombre d’échecs consécutifs.

| Statut | Signification |
| --- | --- |
| **En cours d'analyse** | Un scan est en cours ; une source que tu viens d’ajouter commence ici. |
| **Actif** | Un scan s’est terminé avec succès. Vérifie les résultats page par page pour connaître la couverture. |
| **Erreur** | Le scan a échoué ou les tentatives de récupération n’ont laissé aucun contenu stocké. Ouvre la source pour connaître la cause. |
| **Suppression en cours** | La source est en cours de retrait. |

La vue des pages permet aussi de rechercher dans le contenu indexé. Essaie une expression distinctive de la page avant de t’appuyer dessus dans Chat, puis pose une question précise et vérifie la citation.

## Examiner une page absente

Vérifie d’abord l’adresse, le type de source et la date du dernier scan. Ouvre ensuite le site et lis l’erreur de la page concernée.

| Problème signalé | Vérification ou correction |
| --- | --- |
| Certificat non approuvé | L’administrateur du site doit corriger un certificat TLS expiré, autosigné, associé au mauvais hôte ou non approuvé pour une autre raison. Répéter les scans ne le répare pas. |
| Adresse privée, redirection refusée ou URL invalide | Utilise l’adresse HTTPS publique prévue. Demande à ton exploitant quelles sources internes sont autorisées si nécessaire. |
| Erreur HTTP, échec réseau ou délai dépassé | Ouvre la page d’origine et vérifie sa disponibilité. Un scan ultérieur peut réussir après réparation du service source. |
| Réponse trop volumineuse | Publie un document plus petit ou divise la source. La limite de récupération est de 25 Mio. |
| La source refuse l’indexation | La réponse contient `X-Robots-Tag: noindex` ou `none`, ou la page porte `<meta name="robots" content="noindex">`. Le responsable du site doit modifier cette consigne pour que Tale puisse indexer le contenu. |
| Contenu non pris en charge ou sans texte lisible | Les points d’accès JSON/XML, téléchargements binaires, images ou scans peuvent ne fournir aucun texte exploitable. Fournis une page HTML ou un document pris en charge dont le texte peut être extrait. |
| Échec du rendu ou de l’extraction | Vérifie que la page publique se charge et que le document d’origine s’ouvre. Répare ou exporte à nouveau une source endommagée. |

Une récupération réussie efface l’erreur précédente. Si une actualisation échoue, la copie déjà indexée peut rester disponible : **Actif** et le nombre de pages indexées ne prouvent pas que chaque page est à jour. Compare les fragments enregistrés et la date du passage avec l’original avant de t’appuyer sur une modification récente.

Si la source affiche **Suspendu**, des échecs répétés d’accès à la base de connaissances ont arrêté les analyses. Demande à un administrateur de réparer la connexion dans **Paramètres > Résidence des données**, puis utilise **Reprendre l'analyse**.
