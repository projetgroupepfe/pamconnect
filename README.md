# PamConnect

**PamConnect** est une plateforme de mise en relation entre des **employeurs** (familles, particuliers, entreprises) et des **prestataires de services à la personne** (ménage, garde d'enfants, gardiennage, jardinage, cuisine…) à **Yaoundé**.

Elle se compose d'un **site web** (Node.js) et d'une **application Android** (Flutter) qui parlent au même serveur. Projet de fin d'études.

## Le principe

PamConnect n'est pas une simple petite annonce : **l'équipe PamConnect fait le lien** entre les deux personnes, et c'est elle qui fixe le prix.

1. L'employeur **publie une demande** (ou la propose à une personne précise depuis sa fiche). Il ne paie rien à ce moment-là.
2. Les prestataires **vérifiés** répondent. L'employeur **choisit** une personne ou refuse.
3. L'équipe **appelle la personne choisie**, qui annonce son prix.
4. L'équipe **rappelle l'employeur** avec le prix annoncé auquel s'ajoute la **commission de 10 %** de PamConnect. S'il refuse, l'équipe libère la demande et il peut choisir quelqu'un d'autre.
5. L'employeur paie PamConnect **après le service** ; la personne reçoit **son prix entier**, reversé par PamConnect.

Exemple : la personne annonce 10 000 FCFA, la commission est de 1 000 FCFA, l'employeur paie 11 000 FCFA, la personne reçoit 10 000 FCFA.

Le tarif indiqué sur le profil d'un prestataire est un « tarif souhaité » : **seule l'équipe le voit**, jamais les employeurs.

## Ce que fait la plateforme

- **Comptes** employeur et prestataire, avec profil, photo, disponibilités, quartier et géolocalisation.
- **Vérification d'identité** : pièce d'identité, casier judiciaire et photo, examinés à la main par l'équipe. Les documents sont **supprimés dès que le dossier est traité** ; seule la mention « identité vérifiée » est gardée.
- **Recherche** classée (personnes vérifiées, bien notées, proches du quartier) et **demandes** publiées avec leur horaire.
- **Espace équipe** : vérifications, mises en relation (avec prix et commission calculés par le serveur), annuaire, signalements, problèmes, avis, jetons, paiements, réglages.
- **Messagerie** entre l'employeur et la personne choisie, avec signalement des messages.
- **Avis** après le service, avec possibilité de signaler un avis.
- **Mise en avant** (payante, en jetons) d'une demande ou d'un profil. Répondre à une demande est gratuit.
- **Mot de passe oublié** : aucun e-mail n'est envoyé, l'équipe appelle le numéro enregistré et donne un code.

## Technologies

| Partie | Outils |
| --- | --- |
| Serveur | Node.js 22 ou plus, Express 5, EJS (pages), better-sqlite3 (SQLite), multer (envoi de fichiers) |
| Application | Flutter / Dart, Android |
| Sécurité | mots de passe hachés avec scrypt, sessions à jeton, contrôle des rôles sur chaque route |

## Lancer le site

Il faut [Node.js](https://nodejs.org) version 22 ou plus.

```
git clone https://github.com/projetgroupepfe/pamconnect.git
cd pamconnect
npm install
npm start
```

Ouvrez ensuite http://localhost:3000.

La base de données (`data/pamconnect.db`) est **créée automatiquement au premier démarrage** à partir de `data/schema.sql`. Elle n'est pas dans le dépôt : elle contient des données personnelles.

Au démarrage, le serveur affiche aussi l'adresse à taper depuis un téléphone branché sur le même réseau.

### Créer un compte équipe

Inscrivez-vous d'abord normalement sur le site, puis donnez le droit « équipe » à ce compte :

```
node -e "require('better-sqlite3')('data/pamconnect.db').prepare('UPDATE utilisateurs SET est_admin = 1 WHERE email = ?').run('votre@email.com')"
```

Le compte donne accès à l'espace équipe (menu « Équipe »). Il ne sert pas à publier ni à répondre.

## Lancer l'application Android

Il faut le [SDK Flutter](https://docs.flutter.dev/get-started/install) et un téléphone Android (ou un émulateur).

```
cd mobile
flutter pub get
flutter run
```

Pour fabriquer l'APK à installer sur un téléphone :

```
flutter build apk --release
```

Le fichier obtenu est `mobile/build/app/outputs/flutter-apk/app-release.apk`.

À la première ouverture, l'application demande **l'adresse du serveur** : celle affichée par `npm start`, par exemple `192.168.1.20:3000`. Le téléphone et l'ordinateur doivent être sur le **même réseau Wi-Fi**.

## Les tests

```
npm test
```

Plus de 1 900 vérifications automatiques, réparties en 41 séries (`tests/`), qui couvrent les pages, l'API de l'application, les droits de chaque rôle, la confidentialité du tarif, le calcul de la commission et le scénario de démonstration.

Deux points à connaître, expliqués dans [`tests/README.md`](tests/README.md) :

- les séries écrivent dans la vraie base `data/pamconnect.db` avec des comptes en `@example.com`, qu'elles suppriment à la fin : **ne pas les lancer pendant une démonstration** ;
- elles ont été écrites et exécutées sous **Windows**.

## Organisation du dépôt

| Dossier ou fichier | Rôle |
| --- | --- |
| `server.js` | tout le serveur : routes du site, API de l'application, règles métier |
| `views/` | les pages du site (EJS) |
| `public/` | feuille de style et images |
| `data/schema.sql` | structure de la base, rejouée à chaque démarrage |
| `mobile/` | l'application Flutter (`lib/` = code, `test/` = tests) |
| `tests/` | les séries de tests |
| `scripts/` | outil de migration des anciennes données JSON vers SQLite |

## Limites connues

Ce projet est un prototype abouti, pas un service prêt pour la mise en production. Les limites suivantes sont assumées et documentées dans le code :

- **Le paiement est simulé.** Aucun argent ne circule en ligne : l'équipe enregistre à la main les paiements reçus et reversés.
- **Les sessions sont gardées en mémoire** : un redémarrage du serveur déconnecte tout le monde.
- **Le serveur parle en HTTP**, sans HTTPS, et n'a pas de protection CSRF ni de limitation de débit. Une mise en ligne demanderait ces protections.
- **La vérification d'identité est manuelle** : elle repose sur l'examen des pièces par l'équipe.
- **Aucun e-mail ni SMS n'est envoyé** : l'équipe joint les personnes par téléphone.

## Licence

MIT.
