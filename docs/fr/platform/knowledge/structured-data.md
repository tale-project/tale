---
title: Choisir entre documents et fiches structurées
description: Choisis où conserver les politiques, coordonnées, données produit et pages web pour que Tale retrouve les bonnes informations.
---

Utilise des documents quand l’information demande une explication en plusieurs paragraphes, comme un contrat ou un compte rendu. Choisis une fiche structurée quand elle tient dans des champs nommés, comme l’adresse e-mail d’un contact ou la référence d’un produit. Les deux se complètent : la fiche identifie le sujet, les documents apportent son contexte.

## Choisir où ranger l’information

| Information | Emplacement | Intérêt |
| --- | --- | --- |
| Politique, contrat, manuel ou compte rendu | **Documents** | Tale recherche dans le texte et en extrait les passages pertinents. |
| Information courte avec son propre historique | **Entrées de connaissances** | Un sujet possède une version courante, et les versions précédentes sont conservées. |
| Personne ou organisation avec laquelle tu travailles | **Contacts** | Les champs regroupent les coordonnées dans une fiche modifiable. |
| Produit et ses caractéristiques | **Produits** | Les données restent dans des champs au lieu d’être enfouies dans un fichier. |
| Pages d’un site public | **Sites web** | Tale les explore et actualise leur contenu consultable à intervalle régulier. |
| Fichiers de référence pour un projet | Onglet **Connaissances** du projet | L’accès dépend du projet, et ses chats peuvent retrouver les fichiers. |

Le mode de stockage détermine la façon dont Tale retrouve l’information. Trouver un passage ne signifie pas que tout le document a été examiné. Lire les champs d’une fiche fournit leurs valeurs à Tale, sans garantir qu’elles sont à jour ni que la réponse qui en découle est correcte.

## Associer les fiches aux documents utiles

Pour préparer un appel avec Acme, conserve ses coordonnées dans **Contacts** et son contrat ainsi que les comptes rendus dans **Documents**, ou dans l’onglet **Connaissances** du projet concerné.

Demande à l’assistant de retrouver la fiche d’Acme et de résumer les questions ouvertes dans les dernières notes. Vérifie l’adresse e-mail dans la fiche et les décisions dans les notes citées. Si les fichiers appartiennent à un projet, démarre le chat dans ce projet.

<Tip>

Garde le même nom de société ou de produit dans les fiches et les fichiers associés. Ajoute une date aux comptes rendus et un numéro de révision aux politiques pour distinguer les sources actuelles des anciennes.

</Tip>

## Créer une fiche contact

Le rôle Rédacteur ou un rôle supérieur est nécessaire pour modifier les fiches de l’organisation. Ouvre **Connaissances > Contacts**, choisis **Ajouter un contact**, puis **Saisie manuelle**.

1. Renseigne le **Courriel** du contact. Ajoute un **Nom** et un **Téléphone** si nécessaire.
2. Vérifie **Langue**, dont la valeur initiale est `en`, et adapte-la à la langue du contact.
3. Choisis **Enregistrer**. La fiche apparaît dans Contacts avec ses coordonnées et sa date d’ajout.

Si cette adresse existe déjà, retrouve la fiche et modifie-la depuis le menu de sa ligne. Enregistrer un contact crée uniquement une fiche ; cette opération ne lui envoie aucun e-mail.

## Créer une fiche produit

Ouvre **Connaissances > Produits**, choisis **Ajouter un produit**, puis **Saisie manuelle**. Le formulaire comporte trois étapes.

1. Dans **Bases**, saisis le **Nom du produit**. Ajoute une description et une image si elles aident à l’identifier, puis choisis **Suivant**.
2. Dans **Prix et stock**, vérifie ensemble le **Prix** et la **Devise**. Par exemple, saisis `12.50` et sélectionne `CHF`. Changer la devise ne convertit pas le montant. Renseigne le stock et la catégorie si nécessaire, puis vérifie le **Statut**. Un nouveau produit commence comme **Brouillon**.
3. Dans **Vérification**, relis les données et choisis **Créer**. Le tableau affiche le produit avec son prix, son statut et sa date de mise à jour.

Le menu de la ligne permet de modifier un produit enregistré. Choisis des noms faciles à distinguer et vérifie le prix ainsi que la devise avant de changer le statut.

Choisis **Téléverser une image** ou dépose un fichier PNG, JPEG, WebP, GIF ou SVG dans la zone d’image. La limite est de 5 Mio. Attends l’aperçu avant de poursuivre. Si l’import échoue, vérifie le format et la taille du fichier, puis réessaie. Tale vérifie le contenu du fichier et refuse les SVG contenant du contenu actif.

L’image reste disponible après l’enregistrement et le rechargement du produit. Une fois le produit enregistré, les autres membres de l’organisation ayant accès aux produits peuvent la voir. Son adresse exige une session connectée et ne constitue pas un lien de partage public. Pour la retirer, modifie le produit, choisis **Supprimer l'image**, puis enregistre.

Si tu choisis **Ou coller une URL**, utilise une adresse HTTPS publique. Tale refuse les hôtes non sûrs ou non autorisés. Demande à un administrateur si tu as besoin d’une source d’image interne. Les images chargées depuis une adresse externe restent soumises aux règles d’accès de cette source.

## Vérifier l’accès et l’actualité

Une fiche ou un document n’est utile qu’aux personnes qui y ont accès. Vérifie les équipes associées lorsqu’un collègue ne trouve pas une information. Les fichiers d’un projet suivent les droits du projet, et non les équipes de la bibliothèque documentaire ; consulte [Fichiers du projet](/fr/platform/projects/manage-files).

Mets à jour la fiche de référence lorsqu’une donnée change. Après la révision d’un document, attends la fin de l’indexation avant de tester une question sur le nouveau texte. Le contenu d’un site suit son intervalle d’exploration et peut donc différer de la page en ligne.

## Utiliser les types de fiches disponibles

L’espace de connaissances propose Contacts, Produits et Sites web. **Paramètres > Gouvernance > Modèles** règle l’accès aux modèles d’IA et les choix par défaut. Cette page ne crée ni types de fiches personnalisés ni champs de base de données.

Si les champs disponibles ne conviennent pas, conserve les détails dans un document et rattache ton processus à la fiche appropriée. Pour importer des données par programme et connaître les champs acceptés, consulte la [référence API](/fr/develop/api-reference).

La page [Documents](/fr/platform/knowledge/documents) explique comment importer et vérifier un fichier. [Entrées de connaissances](/fr/platform/knowledge/knowledge-entries) couvre la mise à jour d’une information, et [Exploration de sites](/fr/platform/knowledge/crawling) le suivi des pages publiques.
