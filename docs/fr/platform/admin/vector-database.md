---
title: Base de données vectorielle
description: Paramètres > Base de données vectorielle est l'endroit où les Administrateurs choisissent quel magasin de vecteurs détient les embeddings de documents de cette organisation — le PostgreSQL intégré, un Qdrant externe ou un PostgreSQL externe. Le choix est par organisation, donc les documents d'une org peuvent vivre dans sa propre infrastructure pendant qu'une autre reste sur le magasin intégré.
---

Paramètres > Base de données vectorielle est l'endroit où un Administrateur décide où les embeddings de documents de cette organisation vivent physiquement. Le retrieval — la recherche derrière chaque réponse fondée — s'exécute contre ce magasin, donc le backend choisi ici détermine à la fois comment les documents de l'org sont indexés et quelle infrastructure détient les vecteurs. Le choix est limité à l'organisation actuelle : le changer ne touche jamais les données d'une autre org, et une org qui n'ouvre jamais cette page continue d'utiliser le magasin intégré.

Cette page couvre l'interface : comment lire le backend actif, comment pointer une org vers son propre Qdrant ou PostgreSQL, comment tester une connexion avant de la valider, et ce qu'un changement de backend fait aux documents déjà indexés. Elle est limitée à la permission de paramètres d'organisation, donc seul un Owner ou un Administrateur y accède.

## Ce que la page montre

Ouvre **Paramètres > Base de données vectorielle** et la page nomme en haut le backend actif de l'org, puis un formulaire pour le changer. Les deux bannières au-dessus du formulaire sont le contexte porteur : la première indique que la configuration s'applique uniquement à l'organisation actuelle, la seconde explique qu'un changement de backend recopie automatiquement les vecteurs existants de l'org dans le nouveau magasin, en arrière-plan. Lis les deux avant de changer quoi que ce soit — la seconde est la raison pour laquelle un changement est une opération sûre, et non une qui laisse la recherche paraître vide.

Le formulaire commence par **Backend**, un choix entre **Intégré** et **Externe**. Intégré est le défaut de chaque org et ne demande aucune configuration : les embeddings vivent dans le propre PostgreSQL de Tale, à côté des métadonnées de document. Choisis Externe et un second sélecteur apparaît, **Backend externe**, où tu choisis entre **Qdrant (externe)** et **PostgreSQL (pgvector, externe)**.

## Pointer une org vers son propre backend

Pour **Qdrant (externe)**, renseigne l'**URL Qdrant** que les services Tale peuvent atteindre (par exemple `http://qdrant:6333`), le nom de la **Collection** où stocker les vecteurs, et une **Clé API** si ton instance Qdrant exige une authentification. Laisse **Préférer gRPC** désactivé sauf si ton déploiement est configuré pour cela.

Pour **PostgreSQL (pgvector, externe)**, renseigne l'**Hôte**, le **Port**, la **Base de données**, l'**Utilisateur**, le **Mode SSL** et la **Table** qui détient les vecteurs — Tale crée la table et l'extension `vector` si elles manquent. Fournis le **Mot de passe** que la base de données attend.

Les champs **Clé API** et **Mot de passe** sont en écriture seule. Une fois enregistrés, la page n'affiche qu'un aperçu masqué ; laisser le champ vide lors d'un enregistrement ultérieur garde le secret stocké intact. Les secrets sont chiffrés au repos et ne sont jamais renvoyés au navigateur en entier.

## Teste avant d'enregistrer

Clique **Tester la connexion** avant de valider un backend externe. Pour Qdrant, Tale sonde l'URL avec la clé fournie (ou stockée) ; pour PostgreSQL externe, il ouvre une vraie connexion via le service de retrieval et confirme que l'extension `vector` est disponible. Une base de données joignable sans pgvector fait échouer le test avec un message exploitable — installe l'extension et réessaie. Le test utilise les valeurs du formulaire, donc tu peux vérifier un backend candidat sans l'enregistrer d'abord.

Quand le formulaire est prêt, clique **Enregistrer les modifications** et confirme la boîte de dialogue. Le changement prend effet peu après l'enregistrement — le service de retrieval le reprend dans une courte fenêtre, sans redémarrage. Les autres organisations ne sont pas affectées.

## Un changement de backend recopie les vecteurs existants

Un changement de backend ne nécessite pas de réindexation. Chaque backend conserve les embeddings de document dans le propre PostgreSQL de Tale comme source de vérité, donc un changement recopie simplement les vecteurs existants de l'org dans le nouveau magasin — automatiquement, en arrière-plan, dans le périmètre de cette organisation. Le service de retrieval remarque le changement dans une courte fenêtre et copie les vecteurs. Pour un grand ensemble de documents, cela peut prendre quelques minutes, pendant lesquelles la recherche vectorielle peut être brièvement incomplète et basculer sur la recherche plein texte. Pas de re-téléversement, pas de réindexation manuelle, pas de bascule à chaud à planifier. La boîte de dialogue de confirmation nomme toujours le backend précédent et le nouveau, pour que le changement soit explicite au moment où tu valides.

Une réindexation n'est nécessaire que lorsque tu changes le _modèle_ d'embedding de l'org, pas son backend — un nouveau modèle produit des vecteurs dans un espace différent, donc les anciens doivent être régénérés. Cela est indépendant de l'endroit où les vecteurs sont stockés, et s'applique au backend intégré tout autant qu'à un backend externe.

Une contrainte se reporte depuis le modèle d'embedding : les orgs qui restent sur le magasin intégré partagent une seule dimension d'embedding, elles doivent donc s'accorder sur un modèle d'embedding qui produit des vecteurs de la même largeur. Une org sur son propre backend externe échappe à cette contrainte — sa collection ou sa table est fixée aux propres dimensions d'embedding de l'org et est indépendante de toute autre org.

## Où cela s'inscrit

La base de données vectorielle est le sol sous le retrieval : chaque réponse fondée, chaque recherche de document, chaque étape de workflow qui plonge dans la base de connaissances se résout à travers le magasin choisi ici. La raison de laisser une org sur Intégré est que cela fonctionne sans infrastructure supplémentaire ; la raison de déplacer une org vers son propre Qdrant ou PostgreSQL est la résidence des données — garder les vecteurs de ce locataire dans une infrastructure qu'il contrôle. La lecture suivante naturelle est [Fournisseurs IA](/fr/platform/admin/providers), puisque le modèle d'embedding qui décide des dimensions d'un vecteur y est configuré, et [Audit logs](/fr/platform/admin/governance/audit-logs), où chaque changement de backend d'une org est enregistré avec l'acteur et le backend avant/après.
