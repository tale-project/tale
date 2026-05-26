---
title: Mesures techniques et organisationnelles
description: Les mesures techniques et organisationnelles que Ruler GmbH met en œuvre pour protéger les données personnelles traitées pour le compte des clients de la plateforme Tale.
noindex: true
---

**Dernière mise à jour :** 01.05.2026

Ce document décrit les mesures techniques et organisationnelles (« MTO ») que Ruler GmbH (« Tale ») met en œuvre pour protéger les données personnelles traitées pour le compte de ses clients, telles que référencées à la Section 7 de l'[Accord de traitement des données](/fr/legal/data-processing-agreement). Il s'applique à Tale Cloud. Les déploiements auto-hébergés sont exploités par le Client ; dans ce cas, le Client détermine et applique ses propres mesures, tandis que Tale fournit des paramètres durcis par défaut et des contrôles documentés.

Tale réexamine ces mesures au moins une fois par an et peut les mettre à jour, à condition que le niveau global de protection des données personnelles ne diminue pas de façon substantielle.

## 1. Confidentialité

### 1.1 Contrôle d'accès — physique

Tale n'exploite pas ses propres centres de données. L'infrastructure physique est fournie par les sous-traitants ultérieurs listés à l'Annexe A de l'[Accord de traitement des données](/fr/legal/data-processing-agreement). Chaque fournisseur est certifié ISO/IEC 27001 (ou équivalent) et applique des contrôles d'accès incluant personnel 24/7, vidéosurveillance, accès par badge ou biométrie, sas, et journalisation des visiteurs. Les preuves sont disponibles sur demande via les pages de confiance des sous-traitants.

### 1.2 Contrôle d'accès — systèmes

a) L'authentification multifacteur est obligatoire pour chaque employé de Tale ayant un accès en production.

b) L'accès aux systèmes de production est accordé selon le principe du moindre privilège et du besoin d'en connaître, et révisé au moins trimestriellement.

c) L'accès du personnel est provisionné via un fournisseur d'identité central et révoqué dans un jour ouvré suivant un changement de rôle ou un départ.

d) Les opérations privilégiées requièrent un ticket de changement approuvé et sont journalisées avec l'acteur, l'action et l'horodatage.

e) L'accès client à la plateforme est authentifié par e-mail et mot de passe (avec second facteur WebAuthn ou TOTP optionnel) ou par SSO (OIDC) lorsque le Client l'a configuré.

### 1.3 Contrôle d'accès — données

a) Les données personnelles sont isolées par locataire au niveau applicatif ; chaque requête en base est limitée à l'organisation qui en fait la demande.

b) Les données de production ne sont jamais copiées dans des environnements hors production. Des données synthétiques ou anonymisées sont utilisées pour le développement et les tests.

c) Les clés API émises par le Client sont hachées au repos et révocables depuis la surface d'administration.

### 1.4 Contrôle de séparation

a) Chaque organisation cliente est un locataire logique distinct ; les identifiants de locataire sont présents sur chaque ligne de la base et appliqués au niveau de la requête.

b) Les sauvegardes sont chiffrées par clé spécifique au locataire ; la restauration vers un autre locataire est empêchée au niveau de la gestion des clés.

c) Les charges de travail tournent dans des conteneurs isolés ; les politiques réseau empêchent tout trafic entre locataires.

### 1.5 Pseudonymisation et chiffrement

a) Les données personnelles sont chiffrées en transit avec TLS 1.2 ou supérieur, avec HSTS imposé sur chaque endpoint public.

b) Les données personnelles sont chiffrées au repos avec AES-256 (ou équivalent) au niveau du stockage.

c) Les clés de chiffrement sont gérées par le service de gestion de clés du sous-traitant cloud ; la rotation des clés a lieu au moins une fois par an.

d) Lorsque la pseudonymisation est possible sans nuire à la fonctionnalité, Tale préfère les identifiants pseudonymes aux identifiants personnels en clair dans les journaux et l'analytique.

## 2. Intégrité

### 2.1 Contrôle de transfert

a) Tout le trafic entrant et sortant qui traverse des réseaux publics est chiffré en transit.

b) Le trafic interne entre services utilise mTLS authentifié ou des jetons signés.

c) Les appels aux sous-traitants ultérieurs IA sont routés vers une région correspondant au choix de résidence des données du Client (Suisse ou UE) ; le routage est appliqué côté serveur.

### 2.2 Contrôle d'entrée

a) Chaque action administrative dans la plateforme est enregistrée dans un journal d'audit immuable, avec l'acteur, la ressource concernée et l'horodatage.

b) Les journaux d'audit sont conservés pour la durée configurée par le Client (par défaut 365 jours, sans limite supérieure) et ne sont pas modifiés par les restaurations de snapshots.

c) Les journaux système des composants d'infrastructure sont conservés 90 jours et accessibles uniquement au personnel Tale autorisé.

## 3. Disponibilité et résilience

### 3.1 Contrôle de disponibilité

a) Les services applicatifs tournent dans des configurations redondantes derrière des équilibreurs de charge, avec bascule automatique entre zones de disponibilité dans la région choisie.

b) La supervision couvre disponibilité, taux d'erreur, latence et profondeur de file ; les ingénieurs d'astreinte sont alertés en cas de dépassement de seuil.

c) La page d'état de Tale publie les notifications d'incidents et l'historique de disponibilité.

### 3.2 Récupérabilité

a) Tale prend un snapshot quotidien des bases applicatives et un snapshot horaire du stockage d'objets. Les snapshots sont chiffrés au repos avec des clés détenues par le sous-traitant cloud de Tale.

b) Une réplique pour reprise d'activité après sinistre est maintenue dans la région choisie par le client (Genève pour la Suisse, Dublin pour l'Union européenne).

c) Les restaurations depuis snapshot sont initiées par le Client via le support et respectent l'objectif de temps de reprise indiqué dans le Service Agreement.

d) L'intégrité des sauvegardes est vérifiée au moins trimestriellement par restauration d'un snapshot représentatif dans un environnement isolé.

### 3.3 Capacité et performance

a) Les environnements de production sont dimensionnés pour la charge de pointe attendue et passent à l'échelle horizontalement à mesure que l'utilisation augmente.

b) Des limites de débit et des mécanismes de contre-pression empêchent un locataire de dégrader le service pour les autres.

## 4. Procédures de test, d'évaluation et d'appréciation régulière

### 4.1 Gestion des vulnérabilités

a) Tale exécute un scan automatisé des dépendances à chaque commit et suit les divulgations de vulnérabilités sur toutes les dépendances de production.

b) Les correctifs de sécurité sont appliqués dans les délais imposés par la politique de gestion des vulnérabilités de Tale : critique sous 7 jours, élevé sous 30 jours, moyen sous 90 jours.

c) Les images de conteneur sont reconstruites au moins mensuellement pour intégrer les mises à jour de sécurité amont.

### 4.2 Tests d'intrusion

a) Tale commande un test d'intrusion externe au moins une fois par an. Les constats sont corrigés selon la sévérité, et une lettre d'attestation est disponible pour les clients sous NDA via le support.

### 4.3 Audits et certifications

a) Tale maintient des certifications ISO/IEC 27001 et SOC 2 Type II (ou normes équivalentes) pour Tale Cloud.

b) Les clients peuvent demander des copies du rapport SOC 2 Type II en cours et du certificat ISO 27001 en contactant le support ; les deux sont fournis sous NDA.

### 4.4 Revue interne

a) L'équipe sécurité examine les journaux d'accès, les dérives de configuration et les motifs d'incidents sur une base hebdomadaire continue.

b) L'équipe protection des données examine le traitement des demandes des personnes concernées et le comportement de rétention au moins trimestriellement.

c) Les constats significatifs de toute revue alimentent un backlog de remédiation suivi, avec responsables et échéances.

## 5. Réponse aux incidents

### 5.1 Détection des incidents

a) Les systèmes de production émettent de la télémétrie vers une plateforme centralisée de journalisation et de supervision.

b) Des alertes automatisées préviennent l'ingénieur d'astreinte en cas d'anomalie, notamment hausse des taux d'erreur, tentatives d'accès non autorisé et schémas d'exfiltration inhabituels.

### 5.2 Procédure de réponse aux incidents

a) Tale maintient une procédure documentée de réponse aux incidents couvrant détection, confinement, éradication, récupération et retour d'expérience.

b) La procédure est testée au moins annuellement par un exercice sur table ou un exercice grandeur nature.

c) Les niveaux de sévérité et chemins d'escalade sont définis à l'avance ; l'ingénieur d'astreinte est habilité à escalader vers la direction sans délai.

### 5.3 Notification au client

a) Tale notifie sans délai indu les clients affectés, et en tout état de cause dans les 72 heures suivant la prise de connaissance d'une Violation de données concernant leurs données personnelles, comme prévu à la Section 8 de l'[Accord de traitement des données](/fr/legal/data-processing-agreement).

b) Les notifications incluent les informations requises par le droit applicable à la protection des données : nature de la violation, catégories et nombres approximatifs concernés, conséquences probables et étapes de remédiation.

## 6. Personnel

### 6.1 Confidentialité

a) Chaque employé, prestataire et consultant de Tale signe un accord de confidentialité écrit couvrant les données personnelles, le code source et les informations clients. L'obligation survit à la fin de l'engagement.

### 6.2 Contrôles d'antécédents

a) Des contrôles d'antécédents sont effectués sur les employés de Tale ayant un accès en production, dans la mesure permise par le droit local.

### 6.3 Formation

a) Les nouveaux embauchés suivent une formation à la sécurité et à la protection des données dans les 30 premiers jours.

b) L'ensemble du personnel suit une formation de remise à niveau au moins annuelle, incluant la sensibilisation au phishing, le développement sécurisé et le traitement des données.

### 6.4 Départ

a) Les accès sont révoqués dans un jour ouvré suivant le départ ou un changement de rôle.

b) Le matériel est effacé et récupéré ; les moyens d'accès physiques sont rendus et désactivés.

## 7. Gestion des sous-traitants ultérieurs

### 7.1 Sélection

a) Les sous-traitants ultérieurs sont sélectionnés après une revue sécurité et protection des données couvrant leurs certifications, leurs engagements en matière de protection des données et leurs lieux de traitement.

### 7.2 Obligations contractuelles

a) Chaque sous-traitant ultérieur est contractuellement lié — par accord écrit — à des obligations de protection des données au moins aussi protectrices que celles fixées dans l'[Accord de traitement des données](/fr/legal/data-processing-agreement), y compris l'engagement de non-entraînement de la Section 5.

### 7.3 Revue continue

a) Les certifications et rapports d'audit des sous-traitants ultérieurs sont revus au moins annuellement.

b) Les changements significatifs dans la posture d'un sous-traitant ultérieur déclenchent une notification aux clients via le mécanisme de préavis de 30 jours de la Section 6.2 du DPA.

## 8. Minimisation, conservation et suppression des données

### 8.1 Minimisation des données

a) La plateforme ne collecte que les données personnelles nécessaires à la fourniture de la fonctionnalité demandée.

b) Les clients contrôlent ce qu'ils soumettent ; Tale n'enrichit pas les données soumises par le Client avec des sources tierces sans opt-in explicite.

### 8.2 Conservation

a) Les durées de conservation pour chaque catégorie de données sont documentées dans la [Politique de confidentialité](https://tale.dev/fr/legal/privacy-policy) de Tale et dans la configuration de rétention du produit.

b) Les seuils de conservation des journaux d'audit sont configurés par le Client ; le défaut de la plateforme est de 365 jours sans limite supérieure.

### 8.3 Suppression

a) À l'expiration du Contrat, les données personnelles sont retournées ou supprimées conformément à la Section 13 de l'[Accord de traitement des données](/fr/legal/data-processing-agreement).

b) La suppression couvre tout magasin contenant la donnée, y compris stockage d'objets et sauvegardes (ces dernières par destruction de clé dans la fenêtre de rétention).

c) Les clients peuvent initier l'effacement pour des personnes concernées individuelles via le flux interne de demandes d'exercice de droits.

## 9. Gouvernance

### 9.1 Politiques

a) Tale maintient des politiques écrites de sécurité de l'information et de protection des données, revues au moins annuellement.

b) Les changements de politique sont communiqués à l'ensemble du personnel ; les changements significatifs s'accompagnent d'une formation obligatoire.

### 9.2 Rôles et responsabilités

a) Tale désigne une personne responsable de la sécurité de l'information et une personne responsable de la protection des données. Toutes deux rapportent à la direction.

b) Leurs adresses de contact sont `security@tale.dev` et `privacy@tale.dev`.

### 9.3 Gestion des risques

a) Tale maintient un registre des risques couvrant les risques techniques, organisationnels et juridiques.

b) Les risques sont revus au moins trimestriellement et après tout incident significatif, et les mitigations sont suivies jusqu'à clôture.

## 10. Contact

Pour toute question concernant ces MTO ou pour demander des preuves d'audit, contacte-nous via notre [formulaire de contact](https://tale.dev/fr/contact).

**Ruler GmbH**
Seestrasse 4
3700 Spiez
Suisse
