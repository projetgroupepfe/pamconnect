const express = require("express");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const multer = require("multer");
const fs = require("fs");
const os = require("os");

// "app" est notre application Express : c'est elle qui recoit
// toutes les requetes et decide quelle route doit y repondre.
const app = express();

// Les pages sont des fichiers .ejs ranges dans views/.
// res.render("profil", {...}) va chercher views/profil.ejs.
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Outil fourni par Express : il lit le corps d'une requete de formulaire
// et range le resultat dans req.body.
const lireFormulaire = express.urlencoded({ extended: false });

const PORT = 3000;

// Les sessions ouvertes, en memoire vive : { jeton -> identifiant }.
//
// LIMITE CONNUE : cet objet disparait a chaque redemarrage du serveur.
// Tout le monde est alors deconnecte et doit se reconnecter. C'est sans
// consequence en developpement ; une mise en production demanderait de
// stocker les sessions en base de donnees.
const sessions = {};

// ============================================================
// LA BASE DE DONNEES
// ============================================================
// Un seul fichier, ouvert une fois au demarrage du serveur.
const db = new Database(path.join(__dirname, "data", "pamconnect.db"));

// SQLite ne fait PAS respecter les cles etrangeres par defaut.
// Sans cette ligne, on pourrait creer une annonce sans employeur.
db.pragma("foreign_keys = ON");

// Le fichier data/schema.sql est rejoue a CHAQUE demarrage.
//
// Ce n'est pas dangereux : toutes ses instructions disent
// "CREATE ... IF NOT EXISTS" ou "INSERT OR IGNORE". Une table qui existe
// deja est laissee telle quelle, une ligne deja presente est ignoree.
//
// Pourquoi c'est important : le fichier .db n'est PAS dans le depot Git
// (il contient des donnees personnelles). Sans cette ligne, un coequipier
// qui clone le projet n'aurait aucune base et l'application planterait.
// Maintenant, il lui suffit de lancer npm start.
// Les colonnes ajoutees APRES la creation d'une base.
//
// "CREATE TABLE IF NOT EXISTS" ne sert que pour une table ABSENTE : si la
// table existe deja, une colonne ajoutee au schema ne l'atteindrait
// jamais. SQLite ne sait pas dire "ajoute cette colonne si elle manque" -
// on le lui demande en deux temps, en lisant d'abord la liste des
// colonnes existantes.
//
// CES APPELS PASSENT AVANT LE FICHIER DE SCHEMA, et c'est important :
// schema.sql peut utiliser une colonne recente dans un UPDATE. Sur une
// base qui ne l'a pas encore, il echouerait et le serveur ne demarrerait
// plus. Dans l'autre sens, les deux cas fonctionnent :
//   base existante -> la migration ajoute la colonne, puis le schema s'en sert
//   base neuve     -> la table n'existe pas, la migration passe son tour,
//                     et le schema la cree deja complete
// Renomme une colonne d'une base existante. Sur une base neuve, la table
// n'existe pas encore : schema.sql la creera deja au bon nom.
function renommerColonneSiPresente(table, avant, apres) {
  const colonnes = db.prepare(`PRAGMA table_info(${table})`).all();
  if (colonnes.length === 0) return;

  const aAncien = colonnes.some((c) => c.name === avant);
  const aNouveau = colonnes.some((c) => c.name === apres);

  if (aAncien && !aNouveau) {
    db.exec(`ALTER TABLE ${table} RENAME COLUMN ${avant} TO ${apres}`);
    console.log(`Colonne renommee : ${table}.${avant} -> ${apres}`);
  }
}

// Retire une colonne devenue inutile. On ne la garde pas "au cas ou" :
// une colonne morte finit toujours par etre relue par erreur.
function retirerColonneSiPresente(table, colonne) {
  const colonnes = db.prepare(`PRAGMA table_info(${table})`).all();
  if (colonnes.length === 0) return;

  if (colonnes.some((c) => c.name === colonne)) {
    db.exec(`ALTER TABLE ${table} DROP COLUMN ${colonne}`);
    console.log(`Colonne retiree : ${table}.${colonne}`);
  }
}

function ajouterColonneSiAbsente(table, colonne, definition) {
  const colonnes = db.prepare(`PRAGMA table_info(${table})`).all();

  // Table absente : base neuve. schema.sql va la creer complete, il n'y a
  // rien a rattraper.
  if (colonnes.length === 0) return;

  if (!colonnes.some((c) => c.name === colonne)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${definition}`);
    console.log(`Colonne ajoutee : ${table}.${colonne}`);
  }
}

ajouterColonneSiAbsente("annonces", "prix", "INTEGER");
// Une colonne ajoutee apres coup ne peut pas porter de contrainte CHECK
ajouterColonneSiAbsente("annonces", "unite_tarif", "TEXT NOT NULL DEFAULT 'forfaitaire'");
ajouterColonneSiAbsente("annonces", "duree_estimee", "TEXT");
ajouterColonneSiAbsente("annonces", "conditions", "TEXT");
ajouterColonneSiAbsente("annonces", "budget", "INTEGER");
ajouterColonneSiAbsente("utilisateurs", "date_naissance", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "experience_annees", "INTEGER");
ajouterColonneSiAbsente("utilisateurs", "disponibilites", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "telephone", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "mise_en_avant_jusqu_au", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "email_contact", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "code_connexion", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "code_expire_le", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "code_demande_le", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "code_donne_par",
  "INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL");
ajouterColonneSiAbsente("utilisateurs", "code_essais", "INTEGER NOT NULL DEFAULT 0");
ajouterColonneSiAbsente("utilisateurs", "motdepasse_change_le", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "ajoute_par",
  "INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL");
ajouterColonneSiAbsente("messages", "signalement_decision", "TEXT");
ajouterColonneSiAbsente("messages", "signalement_traite_par", "INTEGER");
ajouterColonneSiAbsente("messages", "signalement_traite_le", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "suspendu", "INTEGER NOT NULL DEFAULT 0");
ajouterColonneSiAbsente("utilisateurs", "suspendu_le", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "suspendu_motif", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "avertissements", "INTEGER NOT NULL DEFAULT 0");
ajouterColonneSiAbsente("utilisateurs", "avertissement_motif", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "avertissement_le", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "avertissement_lu", "INTEGER NOT NULL DEFAULT 0");
ajouterColonneSiAbsente("utilisateurs", "documents_envoyes_le", "TEXT");
ajouterColonneSiAbsente("candidatures", "vu_employeur_le", "TEXT");
ajouterColonneSiAbsente("candidatures", "vu_prestataire_le", "TEXT");
ajouterColonneSiAbsente("candidatures", "terminee_le", "TEXT");
ajouterColonneSiAbsente("candidatures", "statut_change_le", "TEXT");
ajouterColonneSiAbsente("candidatures", "declaree_par_elle_le", "TEXT");
ajouterColonneSiAbsente("candidatures", "envoyee_le", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "message_equipe", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "message_equipe_le", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "message_equipe_lu", "INTEGER NOT NULL DEFAULT 0");
ajouterColonneSiAbsente("quartiers", "synonymes", "TEXT NOT NULL DEFAULT ''");
ajouterColonneSiAbsente("annonces", "annulee", "INTEGER NOT NULL DEFAULT 0");
ajouterColonneSiAbsente("annonces", "annulee_le", "TEXT");
ajouterColonneSiAbsente("annonces", "mise_en_avant_jusqu_au", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "photo_envoyee_fichier", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "photo_fichier", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "photo_piece_fichier", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "photo_envoyee_le", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "photo_motif_refus", "TEXT");
ajouterColonneSiAbsente("annonces", "personne_invitee_id",
  "INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL");

// CHANGEMENT DE MODELE : le montant d'une annonce n'est plus une
// indication mais LE PRIX que l'employeur paiera. Le nom de la colonne
// suit, sinon le code continuerait de parler de "budget" en manipulant
// un prix ferme.
renommerColonneSiPresente("annonces", "budget", "prix");

// La negociation disparait avec ce modele : le prix est celui de
// l'annonce, la personne postule ou repond ailleurs.
retirerColonneSiPresente("candidatures", "tarif_propose");

// Les libelles des reglages etaient ranges en base pour construire un
// formulaire tout seul. Ce formulaire montrait des cases identiques
// pour des reglages qui ne se saisissent pas pareil - un nombre d'un
// cote, une liste de packs de l'autre. Les intitules sont revenus dans
// la vue, comme dans tous les autres formulaires du projet.
// Les quatre criteres d'un avis portaient les noms de ce que
// l'EMPLOYEUR juge. La personne qui a travaille recevait les memes, et
// il manquait le seul qui compte vraiment pour elle : l'employeur a-t-il
// declare le service pour qu'elle soit payee. Le nom devient neutre, le
// sens se lit dans le role de l'auteur.
renommerColonneSiPresente("avis", "ponctualite", "critere1");
renommerColonneSiPresente("avis", "qualite", "critere2");
renommerColonneSiPresente("avis", "respect", "critere3");
renommerColonneSiPresente("avis", "communication", "critere4");

retirerColonneSiPresente("parametres", "libelle");
retirerColonneSiPresente("parametres", "aide");

// Un prix qui change sans qu'on sache qui l'a change etait le seul
// reglage sensible de l'espace equipe sans trace.
ajouterColonneSiAbsente("parametres", "modifie_par",
  "INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL");
ajouterColonneSiAbsente("parametres", "modifie_le", "TEXT");

// Le schema arrive ensuite : il cree ce qui manque et met a jour les
// donnees de reference (quartiers, metiers).
db.exec(fs.readFileSync(path.join(__dirname, "data", "schema.sql"), "utf-8"));

// Les reponses envoyees avant l'existence de cette colonne n'ont pas de
// date d'envoi. Leur date de creation EST leur date d'envoi : elles
// n'avaient aucun moyen d'etre renvoyees.
{
  const reprises = db.prepare(`
    UPDATE candidatures SET envoyee_le = cree_le WHERE envoyee_le IS NULL
  `).run().changes;

  if (reprises > 0) console.log("Reponses datees apres coup : " + reprises);
}

// Les packs etaient ranges avec leur prix : "10:1000|30:3000". Le prix
// se calcule desormais a partir de la valeur du jeton, et la ligne ne
// garde que les quantites. Conversion faite une fois, sans rien perdre :
// c'est la quantite qui portait l'information.
{
  const ligne = db.prepare("SELECT valeur FROM parametres WHERE cle = 'packs_jetons'").get();

  if (ligne && ligne.valeur.includes(":")) {
    const propre = ligne.valeur
      .split("|")
      .map((morceau) => morceau.split(":")[0].trim())
      .filter((quantite) => Number(quantite) > 0)
      .join("|");

    db.prepare("UPDATE parametres SET valeur = ? WHERE cle = 'packs_jetons'").run(propre);
    console.log("Packs de jetons : format simplifie -> " + propre);
  }
}

// ============================================================
// LES REQUETES
// ============================================================
// Elles sont "preparees" une seule fois au demarrage : SQLite les
// analyse maintenant, puis les reutilise a chaque appel.
//
// Les ? sont des emplacements a remplir. Les valeurs passees ensuite
// ne sont JAMAIS melangees au texte de la requete : c'est ce qui rend
// l'injection SQL impossible.
const requetes = {
  utilisateurParId: db.prepare(`
    SELECT * FROM utilisateurs WHERE id = ?
  `),

  utilisateurParEmail: db.prepare(`
    SELECT * FROM utilisateurs WHERE email = ?
  `),

  creerUtilisateur: db.prepare(`
    INSERT INTO utilisateurs
      (role, nom, email, telephone, motdepasse, arrondissement, quartier, metier, tarif,
       latitude, longitude, date_naissance, experience_annees, disponibilites)
    VALUES
      (@role, @nom, @email, @telephone, @motdepasse, @arrondissement, @quartier, @metier, @tarif,
       @latitude, @longitude, @date_naissance, @experience_annees, @disponibilites)
  `),

  // La fiche publique d'une personne.
  //
  // On enumere les colonnes une par une au lieu d'ecrire SELECT * : ainsi
  // une colonne ajoutee plus tard - un numero de telephone, une adresse -
  // ne devient pas publique par accident. Ce qui sort d'ici a ete choisi.
  //
  // Absents volontairement : l'email, la date de naissance complete, les
  // noms des fichiers d'identite, la position GPS exacte.
  // Cet employeur a-t-il deja embauche cette personne ?
  //
  // C'est la condition qui ouvre l'acces a sa tranche d'age. Tant que la
  // candidature n'est pas acceptee, l'age reste une donnee personnelle
  // que rien n'oblige a divulguer - ni au public, ni meme a l'employeur
  // qui hesite encore.
  embaucheEntre: db.prepare(`
    SELECT 1 AS oui
    FROM candidatures c
    JOIN annonces a ON a.id = c.annonce_id
    WHERE c.prestataire_id = @personne
      AND a.employeur_id = @employeur
      AND c.statut = 'acceptee'
    LIMIT 1
  `),

  fichePublique: db.prepare(`
    SELECT id, nom, metier, tarif, quartier, arrondissement,
           statut_verification, date_naissance, experience_annees, disponibilites
    FROM utilisateurs
    WHERE id = ? AND role = 'prestataire' AND est_admin = 0 AND suspendu = 0
  `),

  // La photo acceptee d'une personne, pour decider qui peut la voir.
  photoDe: db.prepare(`
    SELECT id, photo_fichier, suspendu FROM utilisateurs
    WHERE id = ? AND photo_fichier IS NOT NULL
  `),

  // --- Ajouter ou changer sa photo, une fois verifie ---
  enregistrerDemandePhoto: db.prepare(`
    UPDATE utilisateurs
    SET photo_envoyee_fichier = @photo,
        photo_piece_fichier = @piece,
        photo_envoyee_le = datetime('now'),
        photo_motif_refus = NULL
    WHERE id = @id AND statut_verification = 'verifie'
  `),

  retirerPhoto: db.prepare(`
    UPDATE utilisateurs SET photo_fichier = NULL WHERE id = ?
  `),

  // La plus ancienne d'abord, comme les dossiers.
  photosAControler: db.prepare(`
    SELECT id, nom, email, role, metier, photo_envoyee_le
    FROM utilisateurs
    WHERE statut_verification = 'verifie'
      AND photo_envoyee_fichier IS NOT NULL AND photo_piece_fichier IS NOT NULL
    ORDER BY photo_envoyee_le, id
  `),

  demandePhotoParId: db.prepare(`
    SELECT * FROM utilisateurs
    WHERE id = ? AND statut_verification = 'verifie'
      AND photo_envoyee_fichier IS NOT NULL AND photo_piece_fichier IS NOT NULL
  `),

  accepterPhoto: db.prepare(`
    UPDATE utilisateurs
    SET photo_fichier = photo_envoyee_fichier,
        photo_envoyee_fichier = NULL,
        photo_piece_fichier = NULL,
        photo_envoyee_le = NULL,
        photo_motif_refus = NULL
    WHERE id = ?
  `),

  refuserPhoto: db.prepare(`
    UPDATE utilisateurs
    SET photo_envoyee_fichier = NULL,
        photo_piece_fichier = NULL,
        photo_envoyee_le = NULL,
        photo_motif_refus = ?
    WHERE id = ?
  `),

  // Un service convenu entre deux personnes, dans un sens ou dans l'autre :
  // l'une a choisi l'autre. C'est la seule relation qui ouvre la photo.
  serviceConvenuEntre: db.prepare(`
    SELECT 1 AS oui
    FROM candidatures c
    JOIN annonces a ON a.id = c.annonce_id
    WHERE c.statut = 'acceptee'
      AND ((a.employeur_id = @moi AND c.prestataire_id = @autre)
        OR (a.employeur_id = @autre AND c.prestataire_id = @moi))
    LIMIT 1
  `),

  // A qui un employeur peut proposer sa demande : une personne que la
  // recherche montre, ET dont l'identite est verifiee. Les autres ne
  // peuvent pas repondre : leur proposer une demande serait une impasse.
  personneInvitable: db.prepare(`
    SELECT id, nom, metier
    FROM utilisateurs
    WHERE id = ? AND role = 'prestataire' AND est_admin = 0 AND suspendu = 0
      AND statut_verification = 'verifie'
  `),

  // LA RECHERCHE EST PUBLIQUE : elle ne charge que ce qu'elle affiche.
  // Un SELECT * ferait remonter le mot de passe hache, l'email, la date
  // de naissance, les noms des fichiers d'identite - et toute colonne
  // ajoutee plus tard, sans que personne ne l'ait decide.
  //
  // Elle ecarte aussi les comptes suspendus et les comptes d'equipe :
  // une personne suspendue ne doit plus etre trouvee ni contactee.
  tousLesPrestataires: db.prepare(`
      SELECT id, nom, metier, tarif, quartier, arrondissement,
             statut_verification, experience_annees, disponibilites,
             latitude, longitude
    FROM utilisateurs
    WHERE role = 'prestataire' AND est_admin = 0 AND suspendu = 0
  `),

  prestatairesParMetier: db.prepare(`
      SELECT id, nom, metier, tarif, quartier, arrondissement,
             statut_verification, experience_annees, disponibilites,
             latitude, longitude
    FROM utilisateurs
    WHERE role = 'prestataire' AND est_admin = 0 AND suspendu = 0
      AND LOWER(metier) LIKE ?
  `),

  // Quand le mot cherche correspond a un metier de notre liste, on
  // compare les noms officiels : plus fiable qu'un LIKE, qui ne
  // rapproche ni les accents ni les variantes d'ecriture.
  prestatairesDuMetier: db.prepare(`
      SELECT id, nom, metier, tarif, quartier, arrondissement,
             statut_verification, experience_annees, disponibilites,
             latitude, longitude
    FROM utilisateurs
    WHERE role = 'prestataire' AND est_admin = 0 AND suspendu = 0
      AND metier = ?
  `),

  // La liste publique ignore les demandes retirees. L'employeur, lui,
  // continue de voir les siennes sur son profil : ce sont ses archives.
  toutesLesAnnonces: db.prepare(`
    SELECT a.*,
           e.nom                 AS nomEmployeur,
           e.statut_verification AS verificationEmployeur,

           -- Mise en avant EN COURS : la date de fin n'est pas passee.
           -- Calculee ici, jamais rangee : un drapeau range demanderait
           -- que quelqu'un pense a l'eteindre a la bonne minute.
           (a.mise_en_avant_jusqu_au IS NOT NULL
            AND a.mise_en_avant_jusqu_au > datetime('now')) AS enAvant
    FROM annonces a
    JOIN utilisateurs e ON e.id = a.employeur_id
    WHERE a.annulee = 0
    ORDER BY enAvant DESC, a.cree_le DESC, a.id DESC
  `),

  // Les autres personnes qui attendaient encore une reponse sur cette
  // demande. Une fois quelqu'un choisi, les faire patienter serait leur
  // voler du temps : elles pourraient repondre ailleurs.
  refuserLesAutres: db.prepare(`
    UPDATE candidatures
    SET statut = 'refusee', statut_change_le = datetime('now')
    WHERE annonce_id = @annonce AND id != @choisie AND statut = 'en attente'
  `),

  autresEnAttente: db.prepare(`
    SELECT COUNT(*) AS n FROM candidatures
    WHERE annonce_id = @annonce AND id != @choisie AND statut = 'en attente'
  `),

  annonceDeCandidature: db.prepare(`
    SELECT a.id FROM annonces a
    JOIN candidatures c ON c.annonce_id = a.id
    WHERE c.id = ?
  `),

  annulerAnnonce: db.prepare(`
    UPDATE annonces SET annulee = 1, annulee_le = datetime('now')
    WHERE id = @id AND annulee = 0
  `),

  // Une demande fermee l'est soit parce que quelqu'un a ete choisi,
  // soit parce que l'employeur l'a retiree. La colonne annulee ne
  // distingue pas les deux : on le DEDUIT des candidatures, comme le
  // fait deja le profil de l'employeur. Une information deduite ne peut
  // pas se contredire.
  annonceEstPourvue: db.prepare(`
    SELECT 1 AS oui FROM candidatures
    WHERE annonce_id = ? AND statut = 'acceptee' LIMIT 1
  `),

  annonceParId: db.prepare(`
    SELECT a.*,
           e.nom                 AS nomEmployeur,
           e.statut_verification AS verificationEmployeur
    FROM annonces a
    JOIN utilisateurs e ON e.id = a.employeur_id
    WHERE a.id = ?
  `),

  // Une demande ET son proprietaire, en une seule condition. C'est la
  // garde d'acces de la modification : une personne qui n'est pas
  // l'employeur de cette annonce n'obtient rien, meme en tapant
  // l'adresse a la main.
  monAnnonce: db.prepare(`
    SELECT *,
           (mise_en_avant_jusqu_au IS NOT NULL
            AND mise_en_avant_jusqu_au > datetime('now')) AS enAvant
    FROM annonces WHERE id = ? AND employeur_id = ?
  `),

  // La date de fin est calculee par SQLite, comme toutes les autres
  // dates de la base : en heure universelle, au meme format.
  mettreEnAvant: db.prepare(`
    UPDATE annonces
       SET mise_en_avant_jusqu_au = datetime('now', @duree)
     WHERE id = @id AND employeur_id = @employeur AND annulee = 0
  `),

  // Combien de personnes ont deja repondu. Elles se sont decidees sur ce
  // qui etait ecrit : l'employeur doit le savoir avant de corriger.
  nombreCandidatures: db.prepare(`
    SELECT COUNT(*) AS n FROM candidatures WHERE annonce_id = ?
  `),

  majAnnonce: db.prepare(`
    UPDATE annonces
    SET titre = @titre, metier = @metier,
        arrondissement = @arrondissement, quartier = @quartier,
        horaire = @horaire, budget = @budget,
        duree_estimee = @duree_estimee, conditions = @conditions
    WHERE id = @id
  `),

  // LEFT JOIN : la plupart des demandes ne sont proposees a personne.
  annoncesDeEmployeur: db.prepare(`
    SELECT a.*,
           p.nom AS nomInvitee,
           (a.mise_en_avant_jusqu_au IS NOT NULL
            AND a.mise_en_avant_jusqu_au > datetime('now')) AS enAvant
    FROM annonces a
    LEFT JOIN utilisateurs p ON p.id = a.personne_invitee_id
    WHERE a.employeur_id = ? ORDER BY a.cree_le DESC, a.id DESC
  `),

  creerAnnonce: db.prepare(`
    INSERT INTO annonces
      (employeur_id, titre, metier, arrondissement, quartier, horaire,
       budget, duree_estimee, conditions, personne_invitee_id)
    VALUES
      (@employeur_id, @titre, @metier, @arrondissement, @quartier, @horaire,
       @budget, @duree_estimee, @conditions, @personne_invitee_id)
  `),

  // JOIN : on recupere la candidature ET le nom du prestataire
  // en une seule requete, au lieu de chercher ensuite dans une liste.
  candidaturesDeAnnonce: db.prepare(`
    SELECT c.id,
           c.statut,
           c.terminee_le,
           u.id                  AS prestataireId,
           u.nom                 AS nomPrestataire,
           u.experience_annees   AS experiencePrestataire,
           u.disponibilites      AS disponibilitesPrestataire,
           u.statut_verification AS verificationPrestataire,

           -- SA REPUTATION, ICI. C'est sous sa demande que l'employeur
           -- choisit, pas dans la recherche : sans ces deux chiffres il
           -- devait ouvrir une fiche, revenir, et recommencer pour
           -- chaque personne.
           (SELECT COUNT(*) FROM avis v
             WHERE v.vise_id = u.id AND v.masque = 0) AS nbAvis,
           (SELECT ROUND(AVG(note), 1) FROM avis v
             WHERE v.vise_id = u.id AND v.masque = 0) AS moyenne,
           (SELECT COUNT(*) FROM candidatures x
             WHERE x.prestataire_id = u.id AND x.terminee_le IS NOT NULL) AS servicesTermines
    FROM candidatures c
    JOIN utilisateurs u ON u.id = c.prestataire_id
    WHERE c.annonce_id = ?
    ORDER BY c.id
  `),

  candidaturesDePrestataire: db.prepare(`
    SELECT c.id, c.statut,
           a.titre AS titreAnnonce, a.horaire AS horaireAnnonce,
           a.annulee AS demandeFermee,
           EXISTS (SELECT 1 FROM candidatures x
                    WHERE x.annonce_id = a.id AND x.statut = 'acceptee') AS quelquUnChoisi
    FROM candidatures c
    JOIN annonces a ON a.id = c.annonce_id
    WHERE c.prestataire_id = ?
    ORDER BY c.id DESC
  `),

  creerCandidature: db.prepare(`
    INSERT INTO candidatures (annonce_id, prestataire_id, envoyee_le)
    VALUES (?, ?, datetime('now'))
  `),

  // Renvoyer une reponse refusee est un NOUVEL envoi : il coute un jeton
  // et compte dans la limite du jour, comme le premier.
  marquerEnvoyee: db.prepare(`
    UPDATE candidatures SET envoyee_le = datetime('now') WHERE id = ?
  `),

  // COMBIEN DE REPONSES DANS LES 24 DERNIERES HEURES.
  //
  // Une fenetre glissante, pas une journee de calendrier. Sinon il
  // suffirait d'envoyer trois reponses a 23 h et trois autres a 1 h du
  // matin - la limite ne tiendrait qu'une nuit sur deux.
  // Une reponse a une demande PROPOSEE a cette personne ne compte pas :
  // la limite evite de repondre a tout sans regarder, et c'est l'employeur
  // qui est venu la chercher.
  candidaturesRecentes: db.prepare(`
    SELECT COUNT(*) AS n
    FROM candidatures c
    JOIN annonces a ON a.id = c.annonce_id
    WHERE c.prestataire_id = ? AND c.envoyee_le >= datetime('now', '-1 day')
      AND (a.personne_invitee_id IS NULL OR a.personne_invitee_id != c.prestataire_id)
  `),

  // Quand la plus ancienne des reponses recentes sortira de la fenetre :
  // c'est le moment ou une place se libere.
  prochaineReponsePossible: db.prepare(`
    SELECT datetime(MIN(c.envoyee_le), '+1 day') AS quand
    FROM candidatures c
    JOIN annonces a ON a.id = c.annonce_id
    WHERE c.prestataire_id = ? AND c.envoyee_le >= datetime('now', '-1 day')
      AND (a.personne_invitee_id IS NULL OR a.personne_invitee_id != c.prestataire_id)
  `),

  // Verifie en UNE requete que la candidature existe ET que l'annonce
  // concernee appartient bien a l'employeur connecte.
  candidatureDeMonAnnonce: db.prepare(`
    SELECT c.id, c.statut, a.id AS annonceId, a.annulee AS demandeFermee,
           u.statut_verification AS verificationPrestataire
    FROM candidatures c
    JOIN annonces     a ON a.id = c.annonce_id
    JOIN utilisateurs u ON u.id = c.prestataire_id
    WHERE c.id = ? AND a.employeur_id = ?
  `),

  // Tout ce que l'employeur doit relire avant de s'engager, ramene en une
  // seule requete. La condition finale est la garde d'acces : l'annonce
  // doit lui appartenir. Une candidate ne peut donc rien obtenir ici,
  // meme en tapant l'adresse a la main.
  candidatureAConfirmer: db.prepare(`
    SELECT c.id,
           c.statut,
           a.id                  AS annonceId,
           a.annulee             AS demandeFermee,
           p.id                  AS prestataireId,
           p.nom                 AS nomPrestataire,
           p.metier              AS metierPrestataire,
           p.experience_annees   AS experiencePrestataire,
           p.statut_verification AS verificationPrestataire,
           a.metier              AS metierAnnonce,
           a.horaire             AS horaireAnnonce,
           a.quartier            AS quartierAnnonce,
           a.arrondissement      AS arrondissementAnnonce,
           a.duree_estimee       AS dureeAnnonce,
           a.conditions          AS conditionsAnnonce,
           a.prix                AS prixAnnonce,
           a.unite_tarif         AS uniteAnnonce
    FROM candidatures c
    JOIN annonces     a ON a.id = c.annonce_id
    JOIN utilisateurs p ON p.id = c.prestataire_id
    WHERE c.id = ? AND a.employeur_id = ?
  `),

  maCandidaturePour: db.prepare(`
    SELECT id, statut FROM candidatures
    WHERE annonce_id = ? AND prestataire_id = ?
  `),

  // Rouvrir une candidature refusee plutot qu'en creer une seconde : la
  // discussion deja echangee reste attachee a la meme ligne.
  //
  // statut_change_le repasse a NULL : il n'y a plus de decision a
  // annoncer, la candidature attend de nouveau.
  rouvrirCandidature: db.prepare(`
    UPDATE candidatures
    SET statut = 'en attente', statut_change_le = NULL
    WHERE id = @id AND statut = 'refusee'
  `),

  changerStatutCandidature: db.prepare(`
    UPDATE candidatures
    SET statut = ?, statut_change_le = datetime('now')
    WHERE id = ?
  `),

  // --- La messagerie ---------------------------------------------
  //
  // Une conversation = une candidature. Cette requete ramene en UNE fois
  // tout ce qu'il faut pour afficher la page : les deux personnes,
  // l'annonce dont on parle, et le tarif en cours de discussion.
  conversation: db.prepare(`
    SELECT c.id,
           c.statut,
           a.titre           AS titreAnnonce,
           a.horaire         AS horaireAnnonce,
           a.prix            AS prixAnnonce,
           a.unite_tarif     AS uniteAnnonce,
           a.duree_estimee   AS dureeAnnonce,
           a.conditions      AS conditionsAnnonce,
           a.quartier        AS quartierAnnonce,
           a.arrondissement  AS arrondissementAnnonce,
           e.id              AS employeurId,
           e.nom             AS nomEmployeur,
           p.id              AS prestataireId,
           p.nom             AS nomPrestataire,
           p.metier          AS metierPrestataire,
           a.id              AS annonceId,
           a.annulee         AS demandeFermee,
           EXISTS (SELECT 1 FROM candidatures x
                    WHERE x.annonce_id = a.id AND x.statut = 'acceptee') AS quelquUnChoisi,
           c.terminee_le,
           c.declaree_par_elle_le
    FROM candidatures c
    JOIN annonces     a ON a.id = c.annonce_id
    JOIN utilisateurs e ON e.id = a.employeur_id
    JOIN utilisateurs p ON p.id = c.prestataire_id
    WHERE c.id = ?
  `),

  messagesDeConversation: db.prepare(`
    SELECT m.id, m.texte, m.auteur_id, m.risque_paiement, m.signale, m.cree_le,
           u.nom AS nomAuteur
    FROM messages m
    JOIN utilisateurs u ON u.id = m.auteur_id
    WHERE m.candidature_id = ?
    ORDER BY m.id
  `),

  creerMessage: db.prepare(`
    INSERT INTO messages (candidature_id, auteur_id, texte, risque_paiement)
    VALUES (@candidature_id, @auteur_id, @texte, @risque_paiement)
  `),

  // Le signalement ne touche qu'un message dont on N'EST PAS l'auteur :
  // on signale ce qu'on recoit, pas ce qu'on ecrit.
  signalerMessage: db.prepare(`
    UPDATE messages SET signale = 1
    WHERE id = @message AND candidature_id = @discussion AND auteur_id != @moi
  `),

  // Toutes les discussions d'une personne, quel que soit son cote.
  // Une seule requete pour les deux roles : la condition finale accepte
  // aussi bien l'employeur que la personne qui a postule.
  // --- La moderation ---------------------------------------------
  //
  // Les signalements que l'equipe n'a pas encore examines. Un message
  // traite disparait de la liste : ce qui reste affiche est ce qui
  // attend une decision.
  signalementsOuverts: db.prepare(`
    SELECT m.id,
           m.texte,
           m.cree_le,
           m.risque_paiement,
           auteur.id     AS auteurId,
           auteur.nom    AS nomAuteur,
           auteur.email  AS emailAuteur,
           auteur.suspendu AS auteurSuspendu,
           auteur.avertissements AS auteurAvertissements,
           a.titre       AS titreAnnonce,
           c.id          AS candidatureId
    FROM messages m
    JOIN utilisateurs auteur ON auteur.id = m.auteur_id
    JOIN candidatures c      ON c.id = m.candidature_id
    JOIN annonces a          ON a.id = c.annonce_id
    WHERE m.signale = 1 AND m.signalement_decision IS NULL
    ORDER BY m.cree_le DESC, m.id DESC
  `),

  messageSignale: db.prepare(`
    SELECT m.id, m.auteur_id, m.signale, m.signalement_decision
    FROM messages m WHERE m.id = ?
  `),

  classerSignalement: db.prepare(`
    UPDATE messages
    SET signalement_decision   = @decision,
        signalement_traite_par = @par,
        signalement_traite_le  = datetime('now')
    WHERE id = @id AND signale = 1 AND signalement_decision IS NULL
  `),

  // Avertir n'enleve aucun droit : le compte fonctionne comme avant.
  // Ce qui change, c'est que la personne devra lire le reproche.
  avertirCompte: db.prepare(`
    UPDATE utilisateurs
    SET avertissements      = avertissements + 1,
        avertissement_motif = @motif,
        avertissement_le    = datetime('now'),
        avertissement_lu    = 0
    WHERE id = @id AND est_admin = 0
  `),

  ecrireMessageEquipe: db.prepare(`
    UPDATE utilisateurs
    SET message_equipe    = @texte,
        message_equipe_le = datetime('now'),
        message_equipe_lu = 0
    WHERE id = @id AND est_admin = 0
  `),

  marquerMessageEquipeLu: db.prepare(`
    UPDATE utilisateurs SET message_equipe_lu = 1 WHERE id = ?
  `),

  marquerAvertissementLu: db.prepare(`
    UPDATE utilisateurs SET avertissement_lu = 1 WHERE id = ?
  `),

  // La candidature acceptee d'une demande, avec ce qu'il faut pour
  // savoir si un desaccord existe et qui en est l'autre partie.
  candidatureRetenue: db.prepare(`
    SELECT c.id, c.prestataire_id, c.terminee_le, c.declaree_par_elle_le
    FROM candidatures c
    WHERE c.annonce_id = ? AND c.statut = 'acceptee'
    ORDER BY c.id LIMIT 1
  `),

  // --- La mise en relation, tenue par l'equipe ---------------------
  //
  // Le prix vient de la personne qui fera le travail. L'equipe l'ecrit
  // tel quel ; la commission et le prix annonce a l'employeur sont
  // calcules par le serveur, jamais saisis a la main.
  creerMiseEnRelation: db.prepare(`
    INSERT INTO mises_en_relation
      (annonce_id, prestataire_id, prix_prestataire, commission, prix_employeur,
       note, faite_par)
    VALUES (@annonce, @prestataire, @prix, @commission, @prixEmployeur, @note, @par)
  `),

  miseEnRelationParId: db.prepare(`
    SELECT m.*,
           a.titre   AS titreAnnonce,
           a.annulee AS demandeFermee,
           u.nom     AS nomPrestataire
    FROM mises_en_relation m
    JOIN annonces     a ON a.id = m.annonce_id
    JOIN utilisateurs u ON u.id = m.prestataire_id
    WHERE m.id = ?
  `),

  // La fiche en attente de la reponse de l'employeur. La derniere :
  // une demande peut en avoir porte plusieurs, refusees avant celle-ci.
  ficheEnCours: db.prepare(`
    SELECT m.*,
           u.nom       AS nomPrestataire,
           u.telephone AS telephonePrestataire
    FROM mises_en_relation m
    JOIN utilisateurs u ON u.id = m.prestataire_id
    WHERE m.annonce_id = ? AND m.statut = 'en cours'
    ORDER BY m.id DESC LIMIT 1
  `),

  // Les prix deja refuses par l'employeur, pour cette demande-la.
  //
  // C'EST UNE INFORMATION, PAS UNE EXCLUSION. La personne refusee reste
  // dans la liste d'appels : le meme employeur peut la rappeler a un
  // autre prix, et un autre employeur peut vouloir exactement le meme
  // service. Ce qui a ete refuse, c'est un prix, pas quelqu'un.
  fichesRefusees: db.prepare(`
    SELECT m.prix_employeur, m.note, u.nom AS nomPrestataire
    FROM mises_en_relation m
    JOIN utilisateurs u ON u.id = m.prestataire_id
    WHERE m.annonce_id = ? AND m.statut = 'refusee'
    ORDER BY m.id
  `),

  reponseDeLEmployeur: db.prepare(`
    UPDATE mises_en_relation
    SET statut             = @statut,
        appel_employeur_le = datetime('now'),
        note               = @note
    WHERE id = @id AND statut = 'en cours'
  `),

  // Ce que l'equipe a devant elle : les demandes qui attendent encore
  // d'etre mises en relation. Celles ou quelqu'un s'est deja manifeste
  // d'abord : ce sont les plus faciles a conclure.
  demandesATraiter: db.prepare(`
    SELECT a.id, a.titre, a.metier, a.quartier, a.arrondissement,
           a.horaire, a.duree_estimee, a.budget, a.cree_le, a.annulee,
           e.id                  AS employeurId,
           e.nom                 AS nomEmployeur,
           e.telephone           AS telephoneEmployeur,
           e.statut_verification AS verificationEmployeur,
           (SELECT COUNT(*) FROM candidatures c
             WHERE c.annonce_id = a.id AND c.statut = 'en attente') AS nbInteresses
    FROM annonces a
    JOIN utilisateurs e ON e.id = a.employeur_id
    WHERE NOT EXISTS (SELECT 1 FROM mises_en_relation m
                       WHERE m.annonce_id = a.id AND m.statut = 'acceptee')
      AND (a.annulee = 0
           OR EXISTS (SELECT 1 FROM candidatures c
                       WHERE c.annonce_id = a.id AND c.statut = 'acceptee'))
    ORDER BY nbInteresses > 0 DESC, a.cree_le, a.id
  `),

  nombreDemandesATraiter: db.prepare(`
    SELECT COUNT(*) AS n
    FROM annonces a
    WHERE NOT EXISTS (SELECT 1 FROM mises_en_relation m
                       WHERE m.annonce_id = a.id AND m.statut = 'acceptee')
      AND (a.annulee = 0
           OR EXISTS (SELECT 1 FROM candidatures c
                       WHERE c.annonce_id = a.id AND c.statut = 'acceptee'))
  `),

  // Les personnes qui ont dit que le service les interessait. L'equipe
  // les appelle en premier : elles ont deja lu la demande.
  interessesDeLaDemande: db.prepare(`
    SELECT c.id AS candidatureId, c.statut,
           u.id AS prestataireId, u.nom, u.metier, u.quartier, u.tarif,
           u.telephone, u.statut_verification AS verification,
           (u.mise_en_avant_jusqu_au IS NOT NULL
            AND u.mise_en_avant_jusqu_au > datetime('now')) AS enAvant,
           (SELECT ROUND(AVG(note), 1) FROM avis v
             WHERE v.vise_id = u.id AND v.masque = 0) AS moyenne
    FROM candidatures c
    JOIN utilisateurs u ON u.id = c.prestataire_id
    WHERE c.annonce_id = ? AND c.statut IN ('en attente', 'acceptee')
    ORDER BY c.statut = 'acceptee' DESC, enAvant DESC, c.id
  `),

  // Et si personne ne s'est manifeste, les prestataires du metier, ceux
  // du quartier en tete. Seules les personnes verifiees : l'equipe ne
  // met en relation que des identites controlees.
  autresPrestatairesPour: db.prepare(`
    SELECT u.id AS prestataireId, u.nom, u.metier, u.quartier, u.tarif,
           u.telephone,
           (u.mise_en_avant_jusqu_au IS NOT NULL
            AND u.mise_en_avant_jusqu_au > datetime('now')) AS enAvant,
           (SELECT ROUND(AVG(note), 1) FROM avis v
             WHERE v.vise_id = u.id AND v.masque = 0) AS moyenne
    FROM utilisateurs u
    WHERE u.role = 'prestataire' AND u.est_admin = 0 AND u.suspendu = 0
      AND u.statut_verification = 'verifie'
      AND LOWER(u.metier) = LOWER(@metier)
      AND NOT EXISTS (SELECT 1 FROM candidatures c
                       WHERE c.annonce_id = @annonce AND c.prestataire_id = u.id)
    ORDER BY enAvant DESC, LOWER(u.quartier) = LOWER(@quartier) DESC, u.nom
    LIMIT 8
  `),

  // La mise en avant d'un profil : la meme forme que celle d'une demande.
  // La condition finale empeche de prolonger une mise en avant en cours -
  // quelqu'un qui clique deux fois paierait deux fois.
  mettreEnAvantProfil: db.prepare(`
    UPDATE utilisateurs
       SET mise_en_avant_jusqu_au = datetime('now', @duree)
     WHERE id = @id
       AND (mise_en_avant_jusqu_au IS NULL
            OR mise_en_avant_jusqu_au <= datetime('now'))
  `),

  monProfilEnAvant: db.prepare(`
    SELECT mise_en_avant_jusqu_au,
           (mise_en_avant_jusqu_au IS NOT NULL
            AND mise_en_avant_jusqu_au > datetime('now')) AS enAvant
    FROM utilisateurs WHERE id = ?
  `),

  // --- L'annuaire de l'equipe -------------------------------------
  //
  // TOUT LE MONDE DANS UNE SEULE LISTE, filtrable : separer les inscrits
  // des personnes ajoutees ferait deux ecrans a lire, alors que la
  // question de l'equipe est toujours la meme - qui puis-je appeler pour
  // ce metier, dans ce quartier ?
  annuaire: db.prepare(`
    SELECT u.id, u.nom, u.role, u.metier, u.quartier, u.arrondissement,
           u.telephone, u.tarif, u.statut_verification, u.suspendu,
           u.ajoute_par, u.email_contact, u.code_demande_le, u.cree_le,
           q.nom AS nomAjoutePar,
           (SELECT COUNT(*) FROM candidatures c
             WHERE c.prestataire_id = u.id AND c.terminee_le IS NOT NULL) AS servicesFaits,
           (SELECT COUNT(*) FROM annonces a WHERE a.employeur_id = u.id) AS demandesPubliees,
           (SELECT a.metier FROM annonces a WHERE a.employeur_id = u.id
             ORDER BY a.id DESC LIMIT 1) AS dernierBesoin
    FROM utilisateurs u
    LEFT JOIN utilisateurs q ON q.id = u.ajoute_par
    WHERE u.est_admin = 0
      AND (@role = '' OR u.role = @role)
      AND (@origine = ''
           OR (@origine = 'inscrit' AND u.ajoute_par IS NULL)
           OR (@origine = 'ajoute'  AND u.ajoute_par IS NOT NULL))
      AND (@motif = '%%'
           OR LOWER(u.nom) LIKE @motif
           OR LOWER(COALESCE(u.metier, '')) LIKE @motif
           OR LOWER(COALESCE(u.quartier, '')) LIKE @motif
           OR COALESCE(u.telephone, '') LIKE @motif)
    ORDER BY u.ajoute_par IS NOT NULL, u.nom
  `),

  // Deux fiches pour la meme personne seraient pires que pas de fiche du
  // tout : l'equipe appellerait deux fois, et ne saurait pas laquelle
  // tient a jour.
  personneParTelephone: db.prepare(`
    SELECT id, nom, role FROM utilisateurs WHERE telephone = ?
  `),

  ajouterPersonne: db.prepare(`
    INSERT INTO utilisateurs
      (role, nom, email, email_contact, telephone, motdepasse, arrondissement,
       quartier, metier, tarif, ajoute_par)
    VALUES
      (@role, @nom, @email, @contact, @telephone, @motdepasse, @arrondissement,
       @quartier, @metier, @tarif, @par)
  `),

  // --- Le rattrapage d'un mot de passe oublie ---------------------
  demanderUnCode: db.prepare(`
    UPDATE utilisateurs
       SET code_demande_le = datetime('now')
     WHERE id = @id AND est_admin = 0 AND suspendu = 0
  `),

  poserUnCode: db.prepare(`
    UPDATE utilisateurs
       SET code_connexion  = @code,
           code_expire_le  = datetime('now', @duree),
           code_donne_par  = @par,
           code_essais     = 0,
           code_demande_le = NULL
     WHERE id = @id AND est_admin = 0 AND suspendu = 0
  `),

  compterUnEssai: db.prepare(`
    UPDATE utilisateurs SET code_essais = code_essais + 1 WHERE id = ?
  `),

  effacerLeCode: db.prepare(`
    UPDATE utilisateurs
       SET code_connexion = NULL, code_expire_le = NULL,
           code_donne_par = NULL, code_essais = 0, code_demande_le = NULL
     WHERE id = ?
  `),

  // Le mot de passe et la trace du changement, ensemble : la personne
  // doit pouvoir lire sur son profil que son acces a ete rouvert.
  poserNouveauMotDePasse: db.prepare(`
    UPDATE utilisateurs
       SET motdepasse            = @motdepasse,
           motdepasse_change_le  = datetime('now'),
           code_connexion        = NULL,
           code_expire_le        = NULL,
           code_essais           = 0,
           code_demande_le       = NULL
     WHERE id = @id
  `),

  nombreCodesDemandes: db.prepare(`
    SELECT COUNT(*) AS n FROM utilisateurs
     WHERE code_demande_le IS NOT NULL AND est_admin = 0
  `),

  nombreDansLAnnuaire: db.prepare(`
    SELECT COUNT(*) AS n FROM utilisateurs WHERE est_admin = 0
  `),

  // --- Les paiements ----------------------------------------------
  //
  // Une ligne par mise en relation acceptee, ecrite au premier
  // enregistrement : tant que rien n'est recu, il n'y a rien a ranger.
  misesEnRelationAcceptees: db.prepare(`
    SELECT m.id, m.prix_prestataire, m.commission, m.prix_employeur,
           m.appel_employeur_le,
           a.id     AS annonceId,
           a.titre  AS titreAnnonce,
           a.metier AS metierAnnonce,
           e.nom    AS nomEmployeur,
           e.telephone AS telephoneEmployeur,
           u.nom    AS nomPrestataire,
           u.telephone AS telephonePrestataire,
           p.montant_recu, p.recu_le, p.moyen_reception,
           p.montant_reverse, p.reverse_le, p.moyen_reversement,
           (SELECT c.terminee_le FROM candidatures c
             WHERE c.annonce_id = a.id AND c.statut = 'acceptee'
             LIMIT 1) AS serviceTermineLe
    FROM mises_en_relation m
    JOIN annonces     a ON a.id = m.annonce_id
    JOIN utilisateurs e ON e.id = a.employeur_id
    JOIN utilisateurs u ON u.id = m.prestataire_id
    LEFT JOIN paiements p ON p.mise_en_relation_id = m.id
    WHERE m.statut = 'acceptee'
    ORDER BY p.reverse_le IS NOT NULL, m.appel_employeur_le, m.id
  `),

  paiementDeLaRelation: db.prepare(`
    SELECT * FROM paiements WHERE mise_en_relation_id = ?
  `),

  ouvrirPaiement: db.prepare(`
    INSERT INTO paiements (mise_en_relation_id, enregistre_par)
    VALUES (@relation, @par)
  `),

  enregistrerReception: db.prepare(`
    UPDATE paiements
    SET montant_recu    = @montant,
        recu_le         = datetime('now'),
        moyen_reception = @moyen,
        enregistre_par  = @par
    WHERE mise_en_relation_id = @relation
  `),

  enregistrerReversement: db.prepare(`
    UPDATE paiements
    SET montant_reverse   = @montant,
        reverse_le        = datetime('now'),
        moyen_reversement = @moyen,
        enregistre_par    = @par
    WHERE mise_en_relation_id = @relation
  `),

  // Ce qui attend encore quelque chose : un paiement a recevoir, ou un
  // reversement a faire.
  nombrePaiementsEnAttente: db.prepare(`
    SELECT COUNT(*) AS n
    FROM mises_en_relation m
    LEFT JOIN paiements p ON p.mise_en_relation_id = m.id
    WHERE m.statut = 'acceptee'
      AND (p.id IS NULL OR p.recu_le IS NULL OR p.reverse_le IS NULL)
  `),

  // Le total recu par une personne n'est range nulle part : c'est la
  // somme de ses reversements. Un total garde a cote de ses lignes finit
  // toujours par leur mentir.
  totalReverseA: db.prepare(`
    SELECT COALESCE(SUM(p.montant_reverse), 0) AS total
    FROM paiements p
    JOIN mises_en_relation m ON m.id = p.mise_en_relation_id
    WHERE m.prestataire_id = ? AND p.reverse_le IS NOT NULL
  `),

  mesServicesPayes: db.prepare(`
    SELECT m.prix_prestataire, m.commission, m.prix_employeur,
           p.montant_reverse, p.reverse_le, p.moyen_reversement,
           a.titre AS titreAnnonce,
           e.nom   AS nomEmployeur
    FROM mises_en_relation m
    JOIN annonces     a ON a.id = m.annonce_id
    JOIN utilisateurs e ON e.id = a.employeur_id
    LEFT JOIN paiements p ON p.mise_en_relation_id = m.id
    WHERE m.prestataire_id = ? AND m.statut = 'acceptee'
    ORDER BY p.reverse_le IS NULL DESC, p.reverse_le DESC, m.id DESC
  `),

  mesServicesAPayer: db.prepare(`
    SELECT m.prix_employeur, m.appel_employeur_le,
           p.montant_recu, p.recu_le, p.moyen_reception,
           a.titre AS titreAnnonce,
           u.nom   AS nomPrestataire,
           (SELECT c.terminee_le FROM candidatures c
             WHERE c.annonce_id = a.id AND c.statut = 'acceptee'
             LIMIT 1) AS serviceTermineLe
    FROM mises_en_relation m
    JOIN annonces     a ON a.id = m.annonce_id
    JOIN utilisateurs u ON u.id = m.prestataire_id
    LEFT JOIN paiements p ON p.mise_en_relation_id = m.id
    WHERE a.employeur_id = ? AND m.statut = 'acceptee'
    ORDER BY p.recu_le IS NULL DESC, m.id DESC
  `),

  signalerProbleme: db.prepare(`
    INSERT INTO problemes (candidature_id, auteur_id, vise_id, texte)
    VALUES (@candidature, @auteur, @vise, @texte)
  `),

  problemesOuverts: db.prepare(`
    SELECT p.id, p.texte, p.cree_le, p.candidature_id,
           auteur.nom   AS nomAuteur,
           auteur.email AS emailAuteur,
           vise.id      AS viseId,
           vise.nom     AS nomVise,
           vise.email   AS emailVise,
           vise.suspendu       AS viseSuspendu,
           vise.avertissements AS viseAvertissements,
           a.titre AS titreAnnonce
    FROM problemes p
    JOIN utilisateurs auteur ON auteur.id = p.auteur_id
    JOIN utilisateurs vise   ON vise.id   = p.vise_id
    JOIN candidatures c      ON c.id      = p.candidature_id
    JOIN annonces a          ON a.id      = c.annonce_id
    WHERE p.decision IS NULL
    ORDER BY p.cree_le, p.id
  `),

  nombreProblemesOuverts: db.prepare(`
    SELECT COUNT(*) AS n FROM problemes WHERE decision IS NULL
  `),

  problemeParId: db.prepare(`
    SELECT id, vise_id, decision FROM problemes WHERE id = ?
  `),

  classerProbleme: db.prepare(`
    UPDATE problemes
    SET decision   = @decision,
        traite_par = @par,
        traite_le  = datetime('now')
    WHERE id = @id AND decision IS NULL
  `),

  // Un probleme deja signale et pas encore examine : inutile d'en
  // accumuler dix sur la meme discussion, l'equipe traite le premier.
  problemeOuvertPour: db.prepare(`
    SELECT id FROM problemes
    WHERE candidature_id = @candidature AND auteur_id = @auteur AND decision IS NULL
  `),

  suspendreCompte: db.prepare(`
    UPDATE utilisateurs
    SET suspendu = 1, suspendu_le = datetime('now'), suspendu_motif = @motif
    WHERE id = @id AND est_admin = 0
  `),

  nombreSignalementsOuverts: db.prepare(`
    SELECT COUNT(*) AS n FROM messages
    WHERE signale = 1 AND signalement_decision IS NULL
  `),

  mesConversations: db.prepare(`
    SELECT c.id,
           c.statut,
           a.titre AS titreAnnonce,
           e.id    AS employeurId,
           e.nom   AS nomEmployeur,
           p.id    AS prestataireId,
           p.nom   AS nomPrestataire,
           (SELECT COUNT(*)     FROM messages m WHERE m.candidature_id = c.id) AS nbMessages,
           (SELECT MAX(cree_le) FROM messages m WHERE m.candidature_id = c.id) AS dernierMessage,
           (SELECT COUNT(*) FROM messages m
             WHERE m.candidature_id = c.id
               AND m.auteur_id != @moi
               AND m.cree_le > COALESCE(
                     CASE WHEN e.id = @moi THEN c.vu_employeur_le
                          ELSE c.vu_prestataire_le END, '')) AS nonLus,
           c.terminee_le,
           a.annulee AS demandeFermee,

           -- AI-JE DEJA DONNE MON AVIS SUR CE SERVICE ? Sans cette
           -- colonne, la liste ne pouvait pas dire qu'un avis attendait :
           -- elle rangeait le service dans les archives et n'en parlait
           -- plus.
           EXISTS (SELECT 1 FROM avis v
                    WHERE v.candidature_id = c.id AND v.auteur_id = @moi) AS jaiDonneMonAvis,

           EXISTS (SELECT 1 FROM candidatures x
                    WHERE x.annonce_id = a.id AND x.statut = 'acceptee') AS quelquUnChoisi,
           CASE WHEN p.id = @moi
                     AND ((c.statut != 'en attente'
                           AND c.statut_change_le IS NOT NULL
                           AND c.statut_change_le > COALESCE(c.vu_prestataire_le, ''))
                       OR (c.statut = 'en attente'
                           AND a.annulee = 1
                           AND a.annulee_le > COALESCE(c.vu_prestataire_le, '')))
                THEN 1 ELSE 0 END AS decisionNonVue
    FROM candidatures c
    JOIN annonces     a ON a.id = c.annonce_id
    JOIN utilisateurs e ON e.id = a.employeur_id
    JOIN utilisateurs p ON p.id = c.prestataire_id
    WHERE e.id = @moi OR p.id = @moi
    ORDER BY dernierMessage DESC, c.id DESC
  `),

  // Combien de messages m'attendent, toutes discussions confondues.
  //
  // LIMITE CONNUE : les dates sont enregistrees a la SECONDE pres. Un
  // message ecrit dans la meme seconde que ma derniere visite ne sera
  // pas compte comme non lu. Sans consequence en pratique - il faudrait
  // ecrire a quelqu'un a l'instant precis ou il ouvre la discussion, et
  // il l'a alors sous les yeux. La corriger demanderait des dates a la
  // milliseconde partout, y compris la ou elles sont affichees.
  //
  // COALESCE(..., '') : une discussion jamais ouverte n'a pas de date de
  // lecture, et toute date est superieure a la chaine vide. Ses messages
  // comptent donc tous comme non lus - ce qui est exactement le cas.
  messagesNonLus: db.prepare(`
    SELECT COUNT(*) AS n
    FROM messages m
    JOIN candidatures c ON c.id = m.candidature_id
    JOIN annonces     a ON a.id = c.annonce_id
    WHERE m.auteur_id != @moi
      AND (a.employeur_id = @moi OR c.prestataire_id = @moi)
      AND m.cree_le > COALESCE(
            CASE WHEN a.employeur_id = @moi THEN c.vu_employeur_le
                 ELSE c.vu_prestataire_le END, '')
  `),

  // Seule une candidature ACCEPTEE et pas encore close peut etre
  // declaree effectuee. La condition est dans la requete, pas seulement
  // dans la route : deux envois successifs ne changent rien la seconde
  // fois.
  terminerService: db.prepare(`
    UPDATE candidatures
    SET terminee_le = datetime('now')
    WHERE id = @id AND statut = 'acceptee' AND terminee_le IS NULL
  `),

  // Les decisions que la personne n'a pas encore vues. Meme lecture du
  // temps que pour les messages : ce qui a change APRES sa derniere
  // visite de la discussion.
  //
  // Seul le cote qui SUBIT la decision est concerne : celui qui l'a
  // prise n'a pas a etre prevenu de son propre choix.
  decisionsNonVues: db.prepare(`
    SELECT COUNT(*) AS n
    FROM candidatures c
    JOIN annonces a ON a.id = c.annonce_id
    WHERE c.prestataire_id = @moi
      AND (
        -- L'employeur a tranche, et elle ne l'a pas encore vu.
        (c.statut != 'en attente'
         AND c.statut_change_le IS NOT NULL
         AND c.statut_change_le > COALESCE(c.vu_prestataire_le, ''))

        -- Ou la demande a disparu sans que personne ne tranche : sa
        -- candidature reste "en attente" alors qu'il n'y a plus rien a
        -- attendre. Sans ce second cas, elle patientait pour rien.
        OR (c.statut = 'en attente'
            AND a.annulee = 1
            AND a.annulee_le > COALESCE(c.vu_prestataire_le, ''))
      )
  `),

  // Elle ne peut declarer que sur une candidature acceptee, et une
  // seule fois : la condition est dans la requete, pas seulement dans la
  // route. Deux envois ne changent donc pas la date.
  declarerParElle: db.prepare(`
    UPDATE candidatures
    SET declaree_par_elle_le = datetime('now')
    WHERE id = @id AND statut = 'acceptee'
      AND terminee_le IS NULL AND declaree_par_elle_le IS NULL
  `),

  marquerVuEmployeur: db.prepare(`
    UPDATE candidatures SET vu_employeur_le = datetime('now') WHERE id = ?
  `),

  marquerVuPrestataire: db.prepare(`
    UPDATE candidatures SET vu_prestataire_le = datetime('now') WHERE id = ?
  `),

  majProfil: db.prepare(`
    UPDATE utilisateurs
    SET nom = @nom,
        telephone = @telephone,
        arrondissement = @arrondissement,
        quartier = @quartier,
        metier = @metier,
        tarif = @tarif,
        date_naissance = @date_naissance,
        experience_annees = @experience_annees,
        disponibilites = @disponibilites
    WHERE id = @id
  `),

  majPosition: db.prepare(`
    UPDATE utilisateurs SET latitude = ?, longitude = ? WHERE id = ?
  `),

  majEmail: db.prepare(`
    UPDATE utilisateurs SET email = ? WHERE id = ?
  `),

  majMotDePasse: db.prepare(`
    UPDATE utilisateurs SET motdepasse = ? WHERE id = ?
  `),

  enregistrerDocuments: db.prepare(`
    UPDATE utilisateurs
    SET cni_fichier = @cni,
        casier_fichier = @casier,
        photo_envoyee_fichier = @photo,
        statut_verification = 'en attente',
        documents_envoyes_le = datetime('now'),
        verifie_le = NULL,
        motif_refus = NULL
    WHERE id = @id
  `),

  dossiersEnAttente: db.prepare(`
    SELECT id, nom, email, telephone, role, metier, arrondissement, quartier,
           documents_envoyes_le,
           -- Un dossier envoye avant la photo n'en a pas : l'ecran ne
           -- propose alors pas de l'ouvrir.
           photo_envoyee_fichier IS NOT NULL AS aUnePhoto
    FROM utilisateurs
    WHERE statut_verification = 'en attente'
    -- Le plus ancien d'abord : c'est celui dont le delai risque de
    -- passer en premier.
    ORDER BY documents_envoyes_le IS NULL DESC, documents_envoyes_le, id
  `),

  dossierEnAttenteParId: db.prepare(`
    SELECT * FROM utilisateurs WHERE id = ? AND statut_verification = 'en attente'
  `),

  // Valider ou refuser efface les deux noms de fichier : les documents
  // eux-memes sont supprimes du disque au meme moment.
  //
  // LA PHOTO, ELLE, EST GARDEE si le dossier est valide : elle sert a
  // chaque service. Un dossier refuse la perd avec ses documents.
  validerVerification: db.prepare(`
    UPDATE utilisateurs
    SET statut_verification = 'verifie',
        verifie_le = datetime('now'),
        motif_refus = NULL,
        cni_fichier = NULL,
        casier_fichier = NULL,
        photo_fichier = COALESCE(photo_envoyee_fichier, photo_fichier),
        photo_envoyee_fichier = NULL
    WHERE id = ?
  `),

  refuserVerification: db.prepare(`
    UPDATE utilisateurs
    SET statut_verification = 'refuse',
        motif_refus = ?,
        verifie_le = NULL,
        cni_fichier = NULL,
        casier_fichier = NULL,
        photo_envoyee_fichier = NULL
    WHERE id = ?
  `),

  statistiquesVerification: db.prepare(`
    SELECT statut_verification AS statut, COUNT(*) AS nb
    FROM utilisateurs
    WHERE role = 'prestataire'
    GROUP BY statut_verification
    ORDER BY statut_verification
  `),

  // --- Les avis ------------------------------------------------------

  creerAvis: db.prepare(`
    INSERT INTO avis
      (candidature_id, auteur_id, vise_id, note, commentaire,
       critere1, critere2, critere3, critere4)
    VALUES
      (@candidature, @auteur, @vise, @note, @commentaire,
       @critere1, @critere2, @critere3, @critere4)
  `),

  // L'avis que CETTE personne a deja laisse sur CE service. Un seul est
  // possible : la contrainte UNIQUE le garantit, cette requete permet de
  // le dire avant plutot que de laisser le formulaire echouer.
  monAvisPour: db.prepare(`
    SELECT * FROM avis WHERE candidature_id = ? AND auteur_id = ?
  `),

  // Les deux avis d'un service, quel qu'en soit l'auteur. Sert a la
  // discussion, ou chacun voit ce qu'il a ecrit et ce qu'on a ecrit
  // sur lui.
  avisDeLaCandidature: db.prepare(`
    SELECT a.*, u.nom AS nomAuteur
    FROM avis a JOIN utilisateurs u ON u.id = a.auteur_id
    WHERE a.candidature_id = ?
    ORDER BY a.id
  `),

  // LES AVIS PUBLICS D'UNE PERSONNE. Les avis masques par l'equipe en
  // sont exclus : c'est le sens du masquage.
  avisRecus: db.prepare(`
    SELECT a.id, a.signale, a.note, a.commentaire, a.cree_le,
           a.critere1, a.critere2, a.critere3, a.critere4,
           u.nom AS nomAuteur, u.role AS roleAuteur,
           n.titre AS titreAnnonce
    FROM avis a
    JOIN utilisateurs u ON u.id = a.auteur_id
    JOIN candidatures c ON c.id = a.candidature_id
    JOIN annonces     n ON n.id = c.annonce_id
    WHERE a.vise_id = ? AND a.masque = 0
    ORDER BY a.id DESC
  `),

  // COMBIEN DE SERVICES ATTENDENT MON AVIS. Sert a dire, depuis le
  // profil, que l'autre chemin existe : ici on lit ce qu'on a dit de
  // moi, on n'y ecrit pas ce que je pense des autres.
  servicesANoter: db.prepare(`
    SELECT COUNT(*) AS n
    FROM candidatures c
    JOIN annonces a ON a.id = c.annonce_id
    WHERE c.terminee_le IS NOT NULL
      AND (a.employeur_id = @moi OR c.prestataire_id = @moi)
      AND NOT EXISTS (SELECT 1 FROM avis v
                       WHERE v.candidature_id = c.id AND v.auteur_id = @moi)
  `),

  // La moyenne et le nombre d'avis, masques exclus.
  //
  // Calculee, jamais rangee a cote du compte : une moyenne stockee finit
  // par mentir des qu'un avis est masque ou qu'un compte disparait.
  reputationDe: db.prepare(`
    SELECT COUNT(*) AS nombre, AVG(note) AS moyenne
    FROM avis WHERE vise_id = ? AND masque = 0
  `),

  // TOUT CE QUI SERT A CLASSER, en une requete par personne.
  //
  // Rien n'est range : chaque chiffre est recalcule. Un classement
  // stocke vieillirait en silence - la personne garderait sa place
  // longtemps apres avoir cesse de la meriter.
  reputationEtExperience: db.prepare(`
    SELECT
      -- La moyenne et le nombre d'avis, masques exclus.
      (SELECT COUNT(*) FROM avis v WHERE v.vise_id = @personne AND v.masque = 0) AS nbAvis,
      (SELECT COALESCE(SUM(note), 0) FROM avis v
        WHERE v.vise_id = @personne AND v.masque = 0) AS sommeNotes,

      -- Les services qu'elle a reellement termines.
      (SELECT COUNT(*) FROM candidatures c
        WHERE c.prestataire_id = @personne AND c.terminee_le IS NOT NULL) AS services,

      -- Ceux qui ont donne lieu a un probleme signale la visant, quelle
      -- qu'en ait ete l'issue. Un desaccord porte a l'equipe reste un
      -- desaccord, meme classe sans suite.
      (SELECT COUNT(DISTINCT p.candidature_id) FROM problemes p
         JOIN candidatures c ON c.id = p.candidature_id
        WHERE p.vise_id = @personne AND c.terminee_le IS NOT NULL) AS litiges
  `),

  // La note moyenne de TOUTE la plateforme. Elle sert de point de
  // depart a ceux qui n'ont pas encore d'avis : sans elle, une premiere
  // note de 5 ferait passer un inconnu devant tout le monde.
  moyenneDeLaPlateforme: db.prepare(`
    SELECT COUNT(*) AS nombre, COALESCE(AVG(note), 0) AS moyenne
    FROM avis WHERE masque = 0
  `),

  // --- Moderation des avis ---

  avisParId: db.prepare(`
    SELECT * FROM avis WHERE id = ?
  `),

  // SEULE LA PERSONNE VISEE PEUT SIGNALER. C'est elle que l'avis
  // designe, et c'est elle qui sait s'il est faux.
  signalerAvis: db.prepare(`
    UPDATE avis SET signale = 1 WHERE id = @id AND vise_id = @vise AND signale = 0
  `),

  avisSignales: db.prepare(`
    SELECT a.*,
           auteur.nom AS nomAuteur, auteur.email AS emailAuteur,
           vise.nom   AS nomVise,
           n.titre    AS titreAnnonce
    FROM avis a
    JOIN utilisateurs auteur ON auteur.id = a.auteur_id
    JOIN utilisateurs vise   ON vise.id   = a.vise_id
    JOIN candidatures c ON c.id = a.candidature_id
    JOIN annonces     n ON n.id = c.annonce_id
    WHERE a.signale = 1 AND a.masque = 0
    ORDER BY a.id
  `),

  nombreAvisSignales: db.prepare(`
    SELECT COUNT(*) AS n FROM avis WHERE signale = 1 AND masque = 0
  `),

  // LES DERNIERS AVIS ECRITS, signales ou non. Un avis faux ne devient
  // pas acceptable parce que personne ne l'a signale : la personne visee
  // ne se connecte peut-etre jamais.
  //
  // Les masques y figurent aussi, avec leur motif : l'equipe doit
  // pouvoir relire ce qu'elle a decide.
  derniersAvis: db.prepare(`
    SELECT a.*,
           auteur.nom AS nomAuteur, auteur.email AS emailAuteur,
           vise.nom   AS nomVise,
           q.nom      AS nomDecideur,
           n.titre    AS titreAnnonce
    FROM avis a
    JOIN utilisateurs auteur ON auteur.id = a.auteur_id
    JOIN utilisateurs vise   ON vise.id   = a.vise_id
    LEFT JOIN utilisateurs q ON q.id = a.masque_par
    JOIN candidatures c ON c.id = a.candidature_id
    JOIN annonces     n ON n.id = c.annonce_id
    WHERE a.signale = 0
    ORDER BY a.id DESC
    LIMIT 20
  `),

  // MASQUER, PAS SUPPRIMER, et jamais sans motif ecrit : une decision
  // qui efface la parole de quelqu'un doit pouvoir s'expliquer.
  masquerAvis: db.prepare(`
    UPDATE avis
       SET masque = 1, masque_par = @par, masque_le = datetime('now'),
           motif_masquage = @motif
     WHERE id = @id AND masque = 0
  `),

  // Examine, rien a reprocher : le signalement disparait de la liste de
  // l'equipe, l'avis reste en ligne.
  classerAvisSansSuite: db.prepare(`
    UPDATE avis SET signale = 0 WHERE id = @id AND masque = 0
  `),

  // --- Les jetons ---------------------------------------------------

  parametre: db.prepare(`
    SELECT valeur FROM parametres WHERE cle = ?
  `),

  majParametre: db.prepare(`
    UPDATE parametres
       SET valeur = @valeur, modifie_par = @par, modifie_le = datetime('now')
     WHERE cle = @cle
  `),

  // Le dernier changement de prix, quel que soit le reglage touche.
  // Les prix s'enregistrent ensemble : une seule ligne suffit a dire
  // qui a decide du tarif en cours.
  dernierChangementPrix: db.prepare(`
    SELECT p.modifie_le, u.nom
    FROM parametres p
    LEFT JOIN utilisateurs u ON u.id = p.modifie_par
    WHERE p.modifie_le IS NOT NULL
    ORDER BY p.modifie_le DESC
    LIMIT 1
  `),

  // Le solde en DEUX PARTS : les jetons offerts, qui expirent, et les
  // jetons achetes, qui n'expirent jamais. Les additionner ici
  // obligerait a deviner lesquels sont partis en premier.
  soldeJetons: db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN nature = 'offert' THEN quantite ELSE 0 END), 0) AS offerts,
      COALESCE(SUM(CASE WHEN nature = 'achete' THEN quantite ELSE 0 END), 0) AS achetes
    FROM jetons_mouvements
    WHERE utilisateur_id = ?
  `),

  mesMouvementsJetons: db.prepare(`
    SELECT quantite, nature, motif, detail, expire_le, cree_le
    FROM jetons_mouvements
    WHERE utilisateur_id = ?
    ORDER BY id DESC
  `),

  ecrireMouvementJetons: db.prepare(`
    INSERT INTO jetons_mouvements
      (utilisateur_id, quantite, nature, motif, detail, achat_id, annonce_id, expire_le)
    VALUES
      (@personne, @quantite, @nature, @motif, @detail, @achat, @annonce, @expire)
  `),

  // Quand les jetons offerts encore presents cesseront d'etre
  // utilisables. La personne a le droit de le savoir avant, pas apres.
  expirationJetonsOfferts: db.prepare(`
    SELECT MAX(expire_le) AS quand
    FROM jetons_mouvements
    WHERE utilisateur_id = ? AND nature = 'offert' AND quantite > 0
  `),

  // A-T-ELLE DEJA RECU SA BIENVENUE ? C'est le seul garde-fou contre
  // un second cadeau : on ne range pas un drapeau sur le compte, on
  // regarde s'il existe deja une ligne. Une information deduite ne peut
  // pas se contredire.
  aRecuLaBienvenue: db.prepare(`
    SELECT 1 AS oui FROM jetons_mouvements
    WHERE utilisateur_id = ? AND motif = 'bienvenue'
    LIMIT 1
  `),

  // La date d'expiration est calculee par SQLite, comme toutes les
  // autres dates de la base : en heure universelle, au meme format.
  crediterBienvenue: db.prepare(`
    INSERT INTO jetons_mouvements
      (utilisateur_id, quantite, nature, motif, detail, expire_le)
    VALUES
      (@personne, @quantite, 'offert', 'bienvenue', @detail,
       datetime('now', @delai))
  `),

  creerAchatJetons: db.prepare(`
    INSERT INTO jetons_achats (utilisateur_id, quantite, montant_fcfa)
    VALUES (@personne, @quantite, @montant)
  `),

  achatJetonsParId: db.prepare(`
    SELECT * FROM jetons_achats WHERE id = ?
  `),

  achatJetonsEnAttentePour: db.prepare(`
    SELECT id FROM jetons_achats
    WHERE utilisateur_id = ? AND etat = 'en attente'
    LIMIT 1
  `),

  mesAchatsJetons: db.prepare(`
    SELECT id, quantite, montant_fcfa AS montant, etat, cree_le, motif_refus
    FROM jetons_achats
    WHERE utilisateur_id = ?
    ORDER BY id DESC
  `),

  // Ce que l'equipe doit traiter, le plus ancien en tete : quelqu'un
  // attend ses jetons depuis ce moment-la.
  achatsJetonsEnAttente: db.prepare(`
    SELECT a.id, a.quantite, a.montant_fcfa AS montant, a.cree_le,
           u.id AS personneId, u.nom, u.email, u.role
    FROM jetons_achats a
    JOIN utilisateurs u ON u.id = a.utilisateur_id
    WHERE a.etat = 'en attente'
    ORDER BY a.id
  `),

  derniersAchatsJetonsTraites: db.prepare(`
    SELECT a.id, a.quantite, a.montant_fcfa AS montant, a.etat,
           a.traite_le, a.motif_refus,
           u.nom, q.nom AS nomDecideur
    FROM jetons_achats a
    JOIN utilisateurs u ON u.id = a.utilisateur_id
    LEFT JOIN utilisateurs q ON q.id = a.traite_par
    WHERE a.etat <> 'en attente'
    ORDER BY a.traite_le DESC, a.id DESC
    LIMIT 20
  `),

  nombreAchatsJetonsEnAttente: db.prepare(`
    SELECT COUNT(*) AS n FROM jetons_achats WHERE etat = 'en attente'
  `),

  // LE "AND etat = 'en attente'" EST LE REMPART. Deux clics sur
  // Confirmer ne crediteront pas deux fois : le second ne modifie
  // aucune ligne, et le code s'en apercoit.
  classerAchatJetons: db.prepare(`
    UPDATE jetons_achats
       SET etat = @etat, traite_par = @par,
           traite_le = datetime('now'), motif_refus = @motif
     WHERE id = @id AND etat = 'en attente'
  `),
};

// ============================================================
// OUTILS
// ============================================================

function genererToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hacherMotDePasse(motDePasse) {
  const sel = crypto.randomBytes(16).toString("hex");
  const hache = crypto.scryptSync(motDePasse, sel, 64).toString("hex");
  return `${sel}:${hache}`;
}

// UN COMPTE SANS CONNEXION. La personne ajoutee par l'equipe n'a pas
// choisi de mot de passe, et on n'en invente pas un a sa place : on range
// une valeur tiree au hasard dont personne ne connait l'original. Aucune
// saisie ne peut donc ouvrir ce compte.
function motDePasseImpossible() {
  return "sans-connexion:" + crypto.randomBytes(64).toString("hex");
}

function verifierMotDePasse(motDePasseSaisi, motDePasseHache) {
  const [sel, hache] = motDePasseHache.split(":");
  const hacheTest = crypto.scryptSync(motDePasseSaisi, sel, 64).toString("hex");
  return hache === hacheTest;
}

// ============================================================
// LE MODELE ECONOMIQUE
// ------------------------------------------------------------
// Le prix se fixe AU TELEPHONE, par l'equipe : elle appelle la
// personne, qui annonce son prix ; la plateforme AJOUTE sa commission,
// et c'est ce total que l'employeur entend. L'employeur paie PamConnect
// apres le service ; PamConnect reverse a la personne SON prix, entier.
// Le tarif du profil n'est qu'un tarif souhaite, vu de l'equipe seule.
//
// Le taux est ecrit ICI, une seule fois. Le changer met a jour
// tous les calculs et tous les affichages du site.
// ============================================================
const TAUX_COMMISSION = 0.10;   // 10 %

// Ecrit un montant a la francaise : 10000 -> "10 000 FCFA"
function formaterMontant(valeur) {
  const nombre = Math.round(Number(valeur) || 0);
  return nombre.toLocaleString("fr-FR").replace(/[\u202f\u00a0]/g, " ") + " FCFA";
}

// LES MONTANTS ACCEPTES : au moins 500 FCFA, par tranches de 500. Ecrits
// UNE fois : les formulaires du site en tirent leurs limites, et le
// serveur les fait respecter pour le site comme pour l'application.
// Avant, seul le navigateur de l'ordinateur les verifiait : depuis le
// telephone, ou par un envoi fait a la main, une demande a 750 FCFA
// passait.
const MONTANT_MINIMUM_FCFA = 500;
const PAS_MONTANT_FCFA = 500;

// Ce que l'employeur signale avant une venue : court, pour etre lu en
// entier par la personne qui se deplace.
const CONDITIONS_MAX_CARACTERES = 300;

function montantAccepte(montant) {
  return montant >= MONTANT_MINIMUM_FCFA && montant % PAS_MONTANT_FCFA === 0;
}

// La meme phrase pour le prix d'une demande et pour le tarif d'une
// personne : "au moins 500 FCFA, par tranches de 500 FCFA".
function regleMontantLisible() {
  return `au moins ${formaterMontant(MONTANT_MINIMUM_FCFA)}, ` +
         `par tranches de ${formaterMontant(PAS_MONTANT_FCFA)}`;
}

// Detaille un tarif, dans le sens ou il se paie vraiment : ce que la
// personne recoit (son prix, entier), la commission que l'employeur
// ajoute par-dessus, et ce que l'employeur paie en tout.
//
// La commission n'est JAMAIS retiree du prix de la personne : c'est
// prixAvecCommission qui decide, et cette fonction ne fait que la lire.
function detaillerTarif(tarifBrut) {
  const detail = prixAvecCommission(tarifBrut);
  return { brut: detail.prix, commission: detail.commission, employeur: detail.prixEmployeur };
}

// LE PRIX D'UN SERVICE, tel qu'il se fixe au telephone : la personne
// annonce le sien, la plateforme ajoute sa commission, et c'est ce
// total que l'employeur entend. La personne, elle, recoit exactement ce
// qu'elle a annonce.
//
// Ecrit ICI et nulle part ailleurs : l'equipe ne saisit qu'un chiffre,
// les deux autres en decoulent.
function prixAvecCommission(prixPrestataire) {
  const prix = Math.round(Number(prixPrestataire) || 0);
  const commission = Math.round(prix * TAUX_COMMISSION);
  return { prix, commission, prixEmployeur: prix + commission };
}

// Affiche le tarif tel que l'employeur le paiera.
function formaterTarif(tarif) {
  const brut = Math.round(Number(tarif) || 0);
  if (brut <= 0) return "Tarif non indiqué";
  return formaterMontant(brut);
}

// Les memes regles s'appliquent quand on cree un compte et quand on le
// modifie. Elles sont ecrites ICI, une seule fois : impossible qu'elles
// finissent par dire deux choses differentes selon l'ecran.
// Renvoie null si tout va bien, sinon le message a afficher.
// Les regles d'une demande, rassemblees. Elles servent a la publication
// ET a la modification : ecrites deux fois, elles finiraient par
// diverger, et l'un des deux formulaires accepterait ce que l'autre
// refuse.
//
// Renvoie null si tout va bien, sinon de quoi afficher le probleme.
function verifierAnnonce(donnees) {
  // Le formulaire du site exigeait deja ces deux champs, mais seul le
  // navigateur le verifiait : un envoi fait a la main, ou depuis
  // l'application, publiait une demande sans titre ni metier.
  if (!String(donnees.titre || "").trim()) {
    return {
      titre: "Description obligatoire",
      texte: "Décrivez en quelques mots le service dont vous avez besoin.",
    };
  }

  // Le metier range la demande en tete de liste chez les personnes qui
  // font ce travail : sans lui, elle ne serait la premiere pour personne.
  if (!String(donnees.metier || "").trim()) {
    return {
      titre: "Métier obligatoire",
      texte: "Indiquez qui vous cherchez. C'est ce qui place votre demande " +
             "en tête de liste chez les personnes qui font ce travail.",
    };
  }

  // L'horaire est le critere sur lequel une personne decide de repondre
  // ou non : il est donc obligatoire.
  if (!String(donnees.horaire || "").trim()) {
    return {
      titre: "Horaire obligatoire",
      texte: "Indiquez quand vous avez besoin de quelqu'un. " +
             "C'est la première chose que les candidates regardent.",
    };
  }

  // Le quartier aussi : beaucoup de gens connaissent "Bastos" sans
  // savoir que c'est Yaounde 1. Sans ce repere, une candidate ne peut
  // pas juger si le lieu lui est accessible.
  if (!String(donnees.quartier || "").trim()) {
    return {
      titre: "Quartier obligatoire",
      texte: "Indiquez votre quartier. C'est ce qui permet aux candidates " +
             "de savoir si elles peuvent s'y rendre.",
    };
  }

  // LE PRIX NE VIENT PLUS DE L'EMPLOYEUR. Il est annonce par la personne
  // qui fera le travail, lors de l'appel de l'equipe, qui le rapporte a
  // l'employeur majore de la commission.
  //
  // Le budget, lui, est facultatif : il aide l'equipe a savoir qui
  // appeler, et ne sort jamais de son espace.
  const budgetSaisi = String(donnees.budget || "").trim();

  if (budgetSaisi && !(Number(budgetSaisi) > 0)) {
    return {
      titre: "Budget non compris",
      texte: "Écrivez votre budget en chiffres, ou laissez la case vide.",
    };
  }

  if (String(donnees.conditions || "").trim().length > CONDITIONS_MAX_CARACTERES) {
    return {
      titre: "Texte trop long",
      texte: `Ce qu'il faut savoir avant de venir tient en ${CONDITIONS_MAX_CARACTERES} ` +
             "caractères au plus. Gardez l'essentiel : c'est ce que la personne lira " +
             "avant de se déplacer.",
    };
  }

  return null;
}

// Les valeurs d'une demande, mises en forme pour la base. Le meme
// traitement a la publication et a la modification.
function champsAnnonce(donnees) {
  const lieu = resoudreLieu(donnees);

  return {
    titre: String(donnees.titre || "").trim(),
    metier: resoudreMetier(donnees.metier),
    arrondissement: lieu.arrondissement,
    quartier: lieu.quartier,
    horaire: String(donnees.horaire).trim(),
    // Le budget, s'il est donne. Le prix n'est plus saisi ici.
    budget: Math.round(Number(String(donnees.budget || "").trim())) || null,
    duree_estimee: String(donnees.duree_estimee || "").trim() || null,
    conditions: String(donnees.conditions || "").trim() || null,
  };
}

const EXPERIENCE_MAX_ANNEES = 60;

// "2000-02-31" n'existe pas, mais JavaScript le reporte en silence au
// 2 mars : sans ce controle, la date etait acceptee.
function dateExiste(texte) {
  const trouve = String(texte).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!trouve) return false;
  const [annee, mois, jour] = trouve.slice(1).map(Number);
  const date = new Date(Date.UTC(annee, mois - 1, jour));
  return date.getUTCFullYear() === annee && date.getUTCMonth() === mois - 1 &&
         date.getUTCDate() === jour;
}

function verifierProfilPrestataire(donnees) {
  if (!String(donnees.metier || "").trim()) {
    return {
      titre: "Métier obligatoire",
      texte: "Indiquez votre métier pour apparaître dans les recherches.",
    };
  }

  if (!(Math.round(Number(donnees.tarif) || 0) > 0)) {
    return {
      titre: "Tarif obligatoire",
      texte: "Indiquez votre tarif souhaité pour une prestation. " +
             "Seule l'équipe PamConnect le voit : c'est le point de départ de l'appel où le prix est fixé.",
    };
  }

  if (!montantAccepte(Math.round(Number(donnees.tarif)))) {
    return {
      titre: "Tarif non accepté",
      texte: `Le tarif doit être ${regleMontantLisible()}.`,
    };
  }

  // La date de naissance est facultative, mais si elle est donnee elle
  // doit correspondre a une personne majeure : la plateforme donne acces
  // au domicile de familles.
  if (donnees.date_naissance &&
      (!dateExiste(donnees.date_naissance) || !ageValide(donnees.date_naissance))) {
    return {
      titre: "Date de naissance invalide",
      texte: "La plateforme est réservée aux personnes majeures. " +
             "Vérifiez la date que vous avez saisie.",
    };
  }

  // L'experience n'etait bornee que par le navigateur : "beaucoup" ou
  // 75 ans passaient par une autre porte.
  const experience = String(donnees.experience_annees ?? "").trim();
  if (experience && !(/^\d+$/.test(experience) && Number(experience) <= EXPERIENCE_MAX_ANNEES)) {
    return {
      titre: "Expérience non acceptée",
      texte: `Indiquez un nombre entier d'années, entre 0 et ${EXPERIENCE_MAX_ANNEES}.`,
    };
  }

  return null;
}

// Traduit le statut technique en texte lisible par un humain.
// LE DELAI ANNONCE. Une seule valeur, ecrite une fois : les ecrans la
// lisent au lieu d'ecrire "24" chacun de leur cote.
const DELAI_VERIFICATION_HEURES = 24;

// Une demande POURVUE attend que l'employeur declare le service effectue.
// Passe ce delai, l'equipe doit la voir : la personne a peut-etre
// travaille sans que l'equipe le sache.
//
// CE NOMBRE EST UN CHOIX, pas une regle du metier. Il se change ici, en
// une ligne.

// Depuis combien de temps ce dossier attend-il, et le delai est-il tenu ?
//
// SQLite enregistre datetime('now') en temps universel. Il faut le dire
// a Date.parse : sans le "Z", il lit la date comme une heure locale et
// se trompe d'une heure - assez pour qu'un dossier paraisse dans les
// temps alors qu'il ne l'est plus.
//
// Renvoie null quand la date est inconnue. C'est le cas des dossiers
// deposes avant l'existence de cette colonne : les ecrans doivent le
// dire, pas inventer une date.
function attenteVerification(envoyeLe) {
  if (!envoyeLe) return null;

  const depart = Date.parse(String(envoyeLe).replace(" ", "T") + "Z");
  if (Number.isNaN(depart)) return null;

  const heures = Math.floor((Date.now() - depart) / 3600000);

  return {
    heures,
    restantes: Math.max(0, DELAI_VERIFICATION_HEURES - heures),
    depasse: heures >= DELAI_VERIFICATION_HEURES,
  };
}

// La meme chose en francais, pour les ecrans.
function attenteLisible(envoyeLe) {
  const a = attenteVerification(envoyeLe);
  if (!a) return null;
  if (a.heures < 1) return "il y a moins d'une heure";
  if (a.heures === 1) return "il y a 1 heure";
  return "il y a " + a.heures + " heures";
}

function libelleVerification(statut) {
  if (statut === "verifie") return "Identité vérifiée";
  if (statut === "en attente") return "Vérification en cours";
  if (statut === "refuse") return "Vérification refusée";
  return "Identité non vérifiée";
}

// Meme principe pour le statut d'une candidature : la base stocke une
// valeur technique sans accent (comparaisons simples, contrainte CHECK),
// et c'est l'affichage qui la traduit en francais correct.
// Les trois facons de compter un montant, et la phrase qui va avec.
// Ecrite ici pour que "de l'heure" ne devienne pas "par heure" d'un
// ecran a l'autre.
const UNITES_TARIF = {
  horaire:     "de l'heure",
  journalier:  "par jour",
  forfaitaire: "pour la prestation",
};

function libelleUnite(unite) {
  return UNITES_TARIF[unite] || UNITES_TARIF.forfaitaire;
}

// Le prix d'une annonce, ecrit en toutes lettres : "12 000 FCFA par
// jour". Renvoie null pour les demandes publiees avant que le prix ne
// devienne obligatoire : on ne reecrit pas le passe.
function prixEnClair(annonce) {
  if (!annonce.prix) return null;
  return `${formaterMontant(annonce.prix)} ${libelleUnite(annonce.unite_tarif)}`;
}

// Un statut brut ne dit pas QUI a decide. Affiche sous le nom de
// l'autre personne, "Refusee" se lisait comme si c'etait ELLE qui avait
// ete refusee, alors qu'il s'agit de la candidature de celui qui lit.
//
// La phrase nomme donc l'auteur de la decision, et elle change selon le
// cote depuis lequel on regarde la meme candidature.
// Le troisieme parametre porte l'etat de la DEMANDE - fermee ou non,
// et si quelqu'un a ete choisi. Il n'est utile que dans un cas : la
// candidature attend toujours alors que la demande, elle, est close.
function phraseCandidature(statut, jeSuisEmployeur, demande) {
  if (statut === "acceptee") {
    return jeSuisEmployeur
      ? "Vous avez accepté cette candidature"
      : "Votre candidature a été acceptée";
  }

  if (statut === "refusee") {
    // UN REFUS AUTOMATIQUE N'EST PAS UN REFUS PERSONNEL. Choisir
    // quelqu'un refuse les autres reponses : personne n'a ete ecarte
    // un par un, et le dire autrement accuse d'un rejet qui n'a pas
    // eu lieu.
    //
    // La distinction est DEDUITE de l'existence d'une candidature
    // acceptee sur la meme demande, jamais stockee : une information
    // deduite ne peut pas se contredire.
    if (demande && demande.quelquUnChoisi) {
      return jeSuisEmployeur
        ? "Vous avez choisi quelqu'un d'autre"
        : "L'employeur a choisi une autre personne";
    }

    return jeSuisEmployeur
      ? "Vous avez refusé cette candidature"
      : "L'employeur a refusé votre candidature";
  }

  // UNE DEMANDE RETIREE N'ATTEND PLUS DE DECISION. Ses reponses restent
  // en attente, mais plus rien ne peut les trancher : lire "En attente de
  // votre decision" ferait chercher un bouton qui n'existe plus.
  if (jeSuisEmployeur) {
    return demande && demande.demandeFermee
      ? "Vous avez retiré cette demande"
      : "En attente de votre décision";
  }

  // ELLE ATTEND, MAIS QUOI ? Personne n'a tranche sa candidature, et
  // pourtant la demande a pu disparaitre entre-temps. Lui laisser lire
  // "en attente" revenait a lui faire guetter une decision qui ne
  // viendrait jamais.
  // Une seule cause possible ici : le retrait. Choisir quelqu'un refuse
  // automatiquement les autres candidatures, donc aucune ne peut rester
  // "en attente" sur une demande pourvue.
  if (demande && demande.demandeFermee) {
    return "L'employeur a retiré cette demande";
  }

  return "Votre candidature est en attente";
}

// Apres une connexion, on dit a la personne ce qu'elle peut FAIRE,
// jamais ce qu'elle EST. "employeur" et "prestataire" sont les mots de
// la colonne role dans la base de donnees : ils n'ont rien a faire sous
// les yeux d'un utilisateur, et pour un compte d'equipe le mot etait
// carrement faux.
//
// Une seule fonction decide, pour les trois sortes de comptes, la phrase
// ET la destination du bouton. Si demain une quatrieme apparait, c'est
// ici et nulle part ailleurs qu'on l'ajoute.
function apresConnexion(utilisateur) {
  if (utilisateur.est_admin) {
    return {
      texte: "Vous pouvez vérifier les dossiers d'identité en attente.",
      lien: { url: "/admin", texte: "Ouvrir l'espace équipe" },
    };
  }

  if (utilisateur.role === "employeur") {
    return {
      texte: "Retrouvez vos demandes et les réponses que vous avez reçues.",
      lien: { url: "/mes-demandes", texte: "Voir mes demandes" },
    };
  }

  return {
    texte: "Retrouvez les demandes qui correspondent à ce que vous faites.",
    lien: { url: "/annonces", texte: "Voir les demandes" },
  };
}

// ---------------------------------------------------------------
// Les quartiers de Yaounde
// ---------------------------------------------------------------
// Avant, la personne choisissait son arrondissement dans une liste ET
// tapait son quartier a la main. Deux informations a saisir, dont une
// qu'elle ne connait pas forcement : beaucoup de gens vivent a Bastos
// sans savoir que c'est Yaounde 1.
//
// Maintenant elle ne saisit QUE son quartier, et le serveur en deduit
// l'arrondissement. Une seule saisie, et plus d'incoherence possible.

// Met un nom sous une forme comparable : sans accent, sans majuscule,
// sans tiret ni espace. "Cité Verte", "cite verte" et "CITEVERTE"
// donnent tous "citeverte". C'est ainsi qu'on rattrape les fautes de
// frappe les plus courantes.
function sansAccent(texte) {
  return String(texte || "")
    .normalize("NFD")                  // sépare les lettres de leurs accents
    .replace(/[\u0300-\u036f]/g, "")  // supprime les accents
    .toLowerCase();
}

function normaliserNom(texte) {
  // Le meme travail, plus la suppression des espaces, tirets et
  // apostrophes : "Cité Verte", "cite verte" et "CITE-VERTE" donnent
  // tous "citeverte".
  return sansAccent(texte).replace(/[^a-z0-9]/g, "");
}

// La table est petite (60 lignes) et ne change presque jamais : on la lit
// UNE FOIS au demarrage plutot qu'a chaque formulaire affiche.
const quartiers = db.prepare("SELECT nom, arrondissement, synonymes FROM quartiers ORDER BY nom").all();

// Un dictionnaire : "citeverte" -> { nom: "Cité Verte", arrondissement: "Yaoundé 2" }
//
// Il accepte aussi les orthographes declarees dans la colonne synonymes.
// La mise en forme rattrape les accents, les majuscules et les tirets,
// mais pas une lettre en trop : "ngoussso" avec trois s ne se rapproche
// de rien tout seul. Ces cas se declarent, une fois rencontres.
const quartiersParCle = new Map();
quartiers.forEach((q) => {
  quartiersParCle.set(normaliserNom(q.nom), q);
  String(q.synonymes || "")
    .split("|")
    .filter(Boolean)
    .forEach((autre) => quartiersParCle.set(normaliserNom(autre), q));
});

// Retrouve un quartier ecrit n'importe comment. Renvoie null si inconnu.
function trouverQuartier(texte) {
  return quartiersParCle.get(normaliserNom(texte)) || null;
}

// ---------------------------------------------------------------
// Les metiers
// ---------------------------------------------------------------
// Meme probleme que les quartiers, meme solution. Le metier etait un
// texte libre : "menage", "Menage", "menagere", "nounou", "nounous".
// Une nounou ne trouvait pas les demandes ecrites "nounous".
const metiers = db.prepare("SELECT nom, synonymes FROM metiers ORDER BY nom").all();

// Un dictionnaire qui accepte le nom officiel ET tous ses synonymes :
//   "menagere" -> "Ménage à domicile"
//   "MENAGE"   -> "Ménage à domicile"
//   "nounous"  -> "Garde d'enfants"
const metiersParCle = new Map();
metiers.forEach((m) => {
  metiersParCle.set(normaliserNom(m.nom), m.nom);
  String(m.synonymes)
    .split("|")
    .filter(Boolean)
    .forEach((synonyme) => metiersParCle.set(normaliserNom(synonyme), m.nom));
});

// Ramene ce qui a ete saisi au nom officiel. Renvoie null si le metier
// est inconnu de notre liste.
function trouverMetier(texte) {
  return metiersParCle.get(normaliserNom(texte)) || null;
}

// La meme regle que pour le lieu : si le metier est reconnu, c'est le
// nom officiel qui est enregistre. Sinon on garde ce que la personne a
// ecrit - notre liste peut etre incomplete, cela ne doit bloquer
// personne.
function resoudreMetier(texte) {
  return trouverMetier(texte) || String(texte || "").trim() || null;
}

// ---------------------------------------------------------------
// L'age, l'experience, les disponibilites
// ---------------------------------------------------------------

// La date de naissance est conservee, jamais affichee. Une date complete
// avec un nom et un quartier suffit a identifier quelqu'un ; une tranche
// d'age dit ce qu'un employeur a besoin de savoir sans rien reveler de
// plus.
// La plateforme donne acces au domicile de familles : elle est reservee
// aux personnes majeures. Au-dela de 120 ans, la date est une erreur.
const AGE_MINIMUM = 18;
const AGE_MAXIMUM = 120;

const TRANCHES = [
  { jusqua: 24, libelle: "18 - 24 ans" },
  { jusqua: 34, libelle: "25 - 34 ans" },
  { jusqua: 44, libelle: "35 - 44 ans" },
  { jusqua: 54, libelle: "45 - 54 ans" },
  { jusqua: 200, libelle: "55 ans et plus" },
];

function trancheAge(dateNaissance) {
  if (!dateNaissance) return null;

  const naissance = new Date(dateNaissance);
  if (isNaN(naissance.getTime())) return null;

  const aujourdhui = new Date();
  let age = aujourdhui.getFullYear() - naissance.getFullYear();

  // L'anniversaire n'est pas encore passe cette annee : un an de moins.
  const moisEcoule = aujourdhui.getMonth() - naissance.getMonth();
  if (moisEcoule < 0 || (moisEcoule === 0 && aujourdhui.getDate() < naissance.getDate())) {
    age--;
  }

  if (age < AGE_MINIMUM || age > AGE_MAXIMUM) return null;

  return TRANCHES.find((t) => age <= t.jusqua).libelle;
}

// La plateforme est reservee aux personnes majeures : le serveur refuse
// une date qui donnerait moins de 18 ans.
function ageValide(dateNaissance) {
  return trancheAge(dateNaissance) !== null;
}

// Les creneaux possibles. Liste fermee : le serveur refuse tout ce qui
// n'en fait pas partie, meme si le formulaire est contourne.
const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const MOMENTS = [
  { cle: "matin",      libelle: "Matin" },
  { cle: "apresmidi",  libelle: "Après-midi" },
  { cle: "soir",       libelle: "Soir" },
];

const CRENEAUX_VALIDES = new Set(
  JOURS.flatMap((jour) => MOMENTS.map((m) => `${jour}-${m.cle}`))
);

// Ce qui arrive du formulaire est une liste de cases cochees. On ne garde
// que les creneaux connus, dans l'ordre de la semaine - sans quoi
// l'affichage dependrait de l'ordre de cochage.
function resoudreDisponibilites(donnees) {
  const brut = donnees.disponibilites;
  const liste = Array.isArray(brut) ? brut : (brut ? [brut] : []);

  const retenus = [...CRENEAUX_VALIDES].filter((creneau) => liste.includes(creneau));

  return retenus.length ? retenus.join("|") : null;
}

// Pour l'affichage : "lundi-matin|samedi-matin" devient
// { lundi: ["Matin"], samedi: ["Matin"] }
function disponibilitesLisibles(texte) {
  if (!texte) return [];

  const creneaux = new Set(String(texte).split("|"));

  return JOURS
    .map((jour) => ({
      jour,
      moments: MOMENTS.filter((m) => creneaux.has(`${jour}-${m.cle}`)).map((m) => m.libelle),
    }))
    .filter((j) => j.moments.length > 0);
}

// Les badges affiches sur un profil.
//
// REGLE : on n'affiche que ce que la plateforme a REELLEMENT verifie.
// Le cahier des charges prevoit aussi "Telephone verifie" et "E-mail
// verifie" ; nous ne les affichons PAS, parce que nous n'envoyons ni SMS
// ni email. Un badge qui affirme une verification qui n'a pas eu lieu est
// pire que pas de badge du tout : il transforme une limite technique en
// mensonge envers les familles.
// "6 ans d'expérience" s'ecrivait dans les badges, dans la recherche et
// sur la carte de candidature - trois endroits, trois facons de gerer le
// pluriel. Une seule phrase, un seul endroit.
function libelleExperience(annees) {
  if (!annees || annees < 1) return null;
  return annees === 1 ? "1 an d'expérience" : `${annees} ans d'expérience`;
}

function badgesDe(utilisateur) {
  const badges = [];

  if (utilisateur.statut_verification === "verifie") {
    badges.push({ cle: "verifie", texte: "Identité et casier vérifiés", icone: "verifie" });
  }

  if (libelleExperience(utilisateur.experience_annees)) {
    badges.push({
      cle: "experience",
      texte: libelleExperience(utilisateur.experience_annees),
      icone: "experience",
    });
  }

  if (utilisateur.disponibilites) {
    const jours = disponibilitesLisibles(utilisateur.disponibilites).length;
    badges.push({
      cle: "disponibilite",
      texte: jours === 1 ? "Disponible 1 jour par semaine" : `Disponible ${jours} jours par semaine`,
      icone: "disponibilite",
    });
  }

  return badges;
}

// Le lieu d'une personne ou d'une annonce, decide a UN SEUL endroit.
//
// Regle : si le quartier est reconnu, c'est LUI qui commande - le serveur
// ecrit le nom officiel et l'arrondissement correspondant, et ignore
// l'arrondissement envoye par le navigateur. On ne fait pas confiance a
// ce qui arrive du formulaire.
//
// Si le quartier est inconnu (un quartier oublie dans notre liste), on
// garde ce que la personne a ecrit et l'arrondissement qu'elle a choisi :
// elle n'est jamais bloquee par une lacune de notre table.
function resoudreLieu(donnees) {
  const connu = trouverQuartier(donnees.quartier);

  if (connu) {
    return { quartier: connu.nom, arrondissement: connu.arrondissement };
  }

  return {
    quartier: String(donnees.quartier || "").trim() || null,
    arrondissement: donnees.arrondissement || null,
  };
}

// ---------------------------------------------------------------
// Les paiements en dehors de la plateforme
// ---------------------------------------------------------------
// Discuter du prix est NORMAL et autorise : c'est meme le but de la
// messagerie. Ce qu'on surveille, c'est autre chose - la tentative de
// payer directement, sans passer par la plateforme.
//
// Pourquoi c'est grave, et pas seulement pour notre commission :
// un paiement de la main a la main sort du systeme. La personne n'a plus
// aucune garantie d'etre payee apres son travail, l'employeur n'a plus
// aucun recours si le travail n'est pas fait, et l'equipe n'a aucune
// trace sur laquelle s'appuyer en cas de desaccord.
//
// On n'INTERDIT rien : un message n'est jamais bloque ni efface. On
// affiche un avertissement aux deux personnes, et on garde une marque
// sur le message pour que l'equipe puisse le retrouver.
const EXPRESSIONS_RISQUE = [
  /\bmomo\b/,
  /mobile\s*money/,
  /orange\s*money/,
  /mtn\s*money/,
  /\bom\b/,
  /especes?/,
  /\bcash\b/,
  /main\s*a\s*main/,
  /main\s*propre/,
  /hors\s*(de\s*la\s*)?plateforme/,
  /sans\s*passer\s*par/,
  /western\s*union/,
  /\bvirement\b/,
  /envoi?[e-z]*\s*(moi\s*)?l\s*argent/,
];

// Un numero camerounais : un 6 suivi de huit chiffres, que la personne
// l'ecrive colle, espace ou precede de +237.
const TELEPHONE_CAMEROUNAIS = /(\+?\s*237)?\s*6(\s*\d){8}/;

function risquePaiementHorsPlateforme(texte) {
  const propre = sansAccent(texte);

  if (TELEPHONE_CAMEROUNAIS.test(propre)) return true;

  return EXPRESSIONS_RISQUE.some((expression) => expression.test(propre));
}

// PAS D'EXEMPLE DANS LE CADRE "ECRIRE A ...". Les exemples tires au
// hasard avaient ete ecrits pour le menage ("Combien de pieces faut-il
// faire ?") et s'affichaient sur une demande de cuisine ; d'autres
// inventaient un horaire qui pouvait contredire la demande. Ce qui guide
// reste visible : le nom de la personne a qui l'on ecrit, et le conseil
// sous le cadre. Une liste d'exemples jamais affichee parlait aussi de
// baisser le prix, contraire au prix fixe : retiree avec les autres.

// ============================================================
// LES AVIS
// ============================================================
// La reputation d'une personne : sa moyenne et le nombre d'avis.
//
// Les deux comptent, et le second plus qu'on ne croit : une seule note
// de 5 ne vaut pas cinquante notes a 4,8. La moyenne seule ferait passer
// un inconnu chanceux devant quelqu'un qui a fait ses preuves.
function reputationDe(personneId) {
  const r = requetes.reputationDe.get(personneId);

  return {
    nombre: r.nombre,
    // Arrondie au dixieme, et null tant que personne n'a note : afficher
    // "0 sur 5" a quelqu'un qui vient d'arriver serait un mensonge.
    moyenne: r.nombre > 0 ? Math.round(r.moyenne * 10) / 10 : null,
  };
}

// La moyenne ecrite comme on la lit : "4,8" et non "4.8".
function moyenneLisible(moyenne) {
  return moyenne === null ? "" : String(moyenne).replace(".", ",");
}

// LA NOTE D'UNE PERSONNE, EN TROIS ETATS, ET AUCUN N'EST UN VIDE.
//
//   elle a des avis              sa moyenne et leur nombre
//   aucun avis, des services     "Pas encore notee" : elle a deja travaille
//   ni l'un ni l'autre           "Nouveau prestataire"
//
// On n'ecrit JAMAIS "0 sur 5" : ce serait la condamner avant d'avoir
// commence. Ecrite ICI et non dans la page : le site et l'application
// doivent dire exactement la meme chose.
function notePersonne({ nbAvis, moyenne, services }) {
  const faits = Number(services) || 0;
  const pluriel = faits > 1 ? "s" : "";
  const servicesTermines = `${faits} service${pluriel} terminé${pluriel}`;
  if (nbAvis > 0) {
    return {
      etat: "notee",
      badge: `${moyenneLisible(moyenne)} sur 5`,
      detail: `sur ${nbAvis} avis` + (faits > 0 ? `, ${servicesTermines}` : ""),
    };
  }
  if (faits > 0) {
    return { etat: "pas-encore-notee", badge: "Pas encore notée", detail: servicesTermines };
  }
  return { etat: "nouveau", badge: "Nouveau prestataire", detail: "personne ne l'a encore notée" };
}

// Une note entre 1 et 5, ou null si la case a ete laissee vide.
// FACULTATIF VEUT DIRE FACULTATIF : une valeur absente n'est pas une
// erreur, elle n'est simplement pas enregistree.
function noteFacultative(valeur) {
  const brut = String(valeur === undefined || valeur === null ? "" : valeur).trim();
  if (brut === "") return null;

  const n = Math.round(Number(brut));
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
}

// LES QUATRE CRITERES, ET ILS NE SONT PAS LES MEMES DES DEUX COTES.
//
// Un employeur juge un travail rendu chez lui. Une personne juge un
// employeur chez qui elle s'est deplacee - et la premiere chose qui la
// concerne n'est pas la ponctualite de cet homme, c'est de savoir s'il
// a declare le service pour qu'elle soit payee.
//
// Ecrit ICI et nulle part ailleurs : le formulaire et l'affichage s'en
// servent tous les deux. Ecrits deux fois, ils finiraient par dire deux
// choses, et un avis se lirait avec les libelles de l'autre role.
function criteresAvis(jeSuisEmployeur) {
  return jeSuisEmployeur
    ? [
        { cle: "critere1", libelle: "Ponctualité" },
        { cle: "critere2", libelle: "Qualité du travail" },
        { cle: "critere3", libelle: "Respect de votre domicile" },
        { cle: "critere4", libelle: "Communication" },
      ]
    : [
        { cle: "critere1", libelle: "Conditions conformes à ce qui était annoncé" },
        { cle: "critere2", libelle: "Paiement déclaré sans retard" },
        { cle: "critere3", libelle: "Respect" },
        { cle: "critere4", libelle: "Communication" },
      ];
}

// ============================================================
// LE CLASSEMENT
// ============================================================
// CE QU'IL NE FAUT SURTOUT PAS FAIRE : classer sur les etoiles seules.
// Une personne avec UNE note de 5 passerait devant une autre qui a
// cinquante avis a 4,8. La premiere n'a rien prouve, la seconde si.
//
// La correction s'appelle une moyenne ponderee : on ajoute a chaque
// personne quelques avis IMAGINAIRES, places a la moyenne de la
// plateforme. Ils pesent lourd quand on n'a qu'un avis, et ne pesent
// plus rien quand on en a cinquante.
//
//   note ajustee = (poids x moyenne generale + somme des notes)
//                  / (poids + nombre d'avis)
//
// Avec un poids de 5 et une moyenne generale de 4 :
//   une note de 5     -> (5x4 + 5)  / (5+1)  = 4,2
//   cinquante a 4,8   -> (5x4 + 240)/ (5+50) = 4,7
//
// La seconde passe devant, et c'est exactement ce qu'on voulait.
// CINQ AVIS IMAGINAIRES. Assez pour qu'une note unique ne fasse pas
// gagner, assez peu pour qu'une vingtaine d'avis reels reprennent
// entierement la main.
const POIDS_AVIS_IMAGINAIRES = 5;

// LA NOTE DE DEPART, celle des avis imaginaires.
//
// On voudrait y mettre la moyenne de la plateforme - c'est la reference
// la plus juste. Mais tant qu'elle repose sur quelques avis, ce n'est
// pas une information, c'est un accident : un seul avis a 3 ferait
// partir tout le monde de 3.
//
// En dessous du seuil, on part donc de 4 sur 5 - le niveau d'un service
// correct. Au-dessus, la vraie moyenne prend le relais, sans rien
// changer d'autre.
const NOTE_DE_DEPART = 4;
const AVIS_POUR_UNE_MOYENNE_FIABLE = 20;

// Au-dela de dix services termines, en faire plus ne change plus le
// classement : l'experience est acquise. Sans ce plafond, quelqu'un qui
// en a cent ecraserait tout le monde pour toujours.
const SERVICES_POUR_EXPERIENCE_COMPLETE = 10;

// LES CINQ PARTS DU SCORE, SUR CENT POINTS. Chacune est un choix, et
// chacune s'explique en une phrase - c'est ce qu'on nous demandera.
//
//   VERIFIEE      la plus lourde : c'est la promesse de la plateforme,
//                 et une personne non verifiee ne peut pas etre
//                 embauchee. La mettre en tete ferait perdre du temps
//                 a tout le monde.
//   REPUTATION    a egalite : la verification est une porte, la
//                 reputation se merite. Plus basse, l'experience ne
//                 rattraperait jamais ; plus haute, les etoiles
//                 passeraient devant la porte.
//   EXPERIENCE    assez pour distinguer qui a fait ses preuves, pas
//                 assez pour rendre les anciens intouchables.
//   SANS_DESACCORD  meme poids : faire beaucoup de services mal ne doit
//                 pas battre en faire peu et bien.
//   DISPONIBLE    la plus legere : elle se declare, elle ne se merite
//                 pas. Mais un profil sans creneaux oblige l'employeur
//                 a deviner.
const PART_VERIFIEE = 30;
const PART_REPUTATION = 30;
const PART_EXPERIENCE = 15;
const PART_SANS_DESACCORD = 15;
const PART_DISPONIBLE = 10;

// La proximite s'AJOUTE, elle n'entre pas dans les cent points : dix
// points au plus, soit un tiers de la verification. Quelqu'un de proche
// mais non verifie ne peut donc jamais passer devant quelqu'un de
// verifie un peu plus loin.
const PART_PROXIMITE = 10;
const DISTANCE_SANS_INTERET_KM = 10;

function noteAjustee(nbAvis, sommeNotes, moyenneGenerale) {
  return (POIDS_AVIS_IMAGINAIRES * moyenneGenerale + sommeNotes)
       / (POIDS_AVIS_IMAGINAIRES + nbAvis);
}

// LE SCORE, SUR CENT POINTS, et chaque part s'explique en une phrase.
//
// La verification pese le plus : c'est la promesse de la plateforme, et
// une personne non verifiee ne peut de toute facon pas etre embauchee.
function scoreDe(personne, chiffres, moyenneGenerale) {
  const verifiee = personne.statut_verification === "verifie" ? PART_VERIFIEE : 0;

  const reputation = PART_REPUTATION
    * (noteAjustee(chiffres.nbAvis, chiffres.sommeNotes, moyenneGenerale) / 5);

  const experience = PART_EXPERIENCE
    * Math.min(1, chiffres.services / SERVICES_POUR_EXPERIENCE_COMPLETE);

  // AUCUN SERVICE N'EST AUCUN PROBLEME. On ne punit pas quelqu'un qui
  // commence : sans service termine, cette part vaut le maximum, et
  // c'est la part "experience" qui reste a zero.
  const sansProbleme = chiffres.services === 0
    ? PART_SANS_DESACCORD
    : PART_SANS_DESACCORD * (1 - chiffres.litiges / chiffres.services);

  const disponible = personne.disponibilites ? PART_DISPONIBLE : 0;

  return {
    total: verifiee + reputation + experience + sansProbleme + disponible,
    verifiee, reputation, experience, sansProbleme, disponible,
  };
}

// LE LIEU, EN PLUS DU RESTE. Il ne se melange pas au score : quelqu'un
// de proche mais non verifie ne doit pas passer devant quelqu'un de
// verifie un peu plus loin.
//
// Au plus 10 points : le meme quartier, ou une distance courte quand la
// position est connue.
function pointsDeProximite(personne, lieuCherche, distanceKm) {
  if (distanceKm !== undefined && distanceKm !== null) {
    // Tout au plus a moins d'un kilometre, plus rien au-dela de dix.
    return PART_PROXIMITE * Math.max(0, Math.min(1,
      (DISTANCE_SANS_INTERET_KM - distanceKm) / (DISTANCE_SANS_INTERET_KM - 1)));
  }

  if (!lieuCherche) return 0;
  if (lieuCherche.quartier && personne.quartier === lieuCherche.quartier) return PART_PROXIMITE;
  if (lieuCherche.arrondissement && personne.arrondissement === lieuCherche.arrondissement) {
    return PART_PROXIMITE / 2;
  }

  return 0;
}

// UNE PERSONNE SANS AUCUN AVIS N'EST PAS UNE MAUVAISE PERSONNE : elle
// commence. Le badge le dit, au lieu de laisser un vide que chacun
// interprete comme il veut.
function estNouvelle(chiffres) {
  return chiffres.nbAvis === 0 && chiffres.services === 0;
}

// ============================================================
// LES JETONS
// ============================================================
// Un jeton est un DROIT D'USAGE vendu par la plateforme, pas de
// l'argent. Il ne se transfere pas d'une personne a une autre, il ne se
// retire ni en especes ni par Mobile Money, et il ne paie jamais une
// prestation : le paiement d'un service reste en FCFA, dans le
// sequestre, avec sa commission de 10 %.
//
// AUCUN PRIX N'EST ECRIT DANS CE FICHIER. Tout vient de la table
// parametres, que l'equipe modifie depuis son espace. Un tarif ecrit en
// dur ici ne pourrait etre change que par quelqu'un qui programme.

function parametre(cle) {
  const ligne = requetes.parametre.get(cle);
  return ligne ? ligne.valeur : null;
}

// Renvoie null quand le reglage manque ou n'a pas de sens, JAMAIS une
// valeur de secours : un prix invente serait pire qu'un prix absent.
// Les ecrans disent alors que le reglage manque.
function parametreNombre(cle) {
  const brut = parametre(cle);
  if (brut === null || String(brut).trim() === "") return null;
  const valeur = Number(brut);
  return Number.isFinite(valeur) && valeur >= 0 ? valeur : null;
}

function valeurDuJeton() {
  return parametreNombre("jeton_valeur_fcfa");
}

// LE PRIX D'UN PACK NE SE SAISIT PAS, IL SE CALCULE : 10 jetons a
// 100 FCFA se vendent 1 000 FCFA. Ranger les deux laisserait l'equipe
// ecrire un jeton a 200 et un pack de 10 a 1 000, et plus rien ne
// dirait lequel des deux a raison.
//
// Un morceau mal ecrit est IGNORE, jamais devine : mieux vaut un pack
// de moins qu'un prix faux.
function packsEnVente() {
  const valeur = valeurDuJeton();
  if (valeur === null) return [];

  const quantites = String(parametre("packs_jetons") || "")
    .split("|")
    .map((morceau) => Math.round(Number(String(morceau).trim())))
    .filter((quantite) => quantite > 0);

  return [...new Set(quantites)]
    .sort((a, b) => a - b)
    .map((quantite) => ({ quantite, prix: quantite * valeur }));
}

// LE PRIX EST TOUJOURS ANNONCE DANS LES DEUX UNITES : "20 jetons
// (2 000 FCFA)". Un utilisateur qui ne lit que "20 jetons" ne sait pas
// ce qu'il depense.
function jetonsEnClair(nombre) {
  const n = Math.abs(Math.round(Number(nombre) || 0));
  const mot = n > 1 ? "jetons" : "jeton";
  const valeur = valeurDuJeton();

  return valeur === null ? `${n} ${mot}` : `${n} ${mot} (${formaterMontant(n * valeur)})`;
}

// COMBIEN DE JETONS SONT OFFERTS A CETTE PERSONNE.
// Deux nombres differents, parce que les deux roles n'en font pas le
// meme usage : un employeur met une demande en avant, une personne qui
// propose ses services repond a des demandes.
function jetonsDeBienvenue(role) {
  return parametreNombre(role === "employeur"
    ? "bienvenue_employeur"
    : "bienvenue_prestataire");
}

// LES JETONS OFFERTS ARRIVENT QUAND L'EQUIPE VALIDE LE DOSSIER.
// La cause et l'effet tiennent alors dans le meme geste : le dossier
// est accepte, les jetons sont credites.
//
// Cette fonction est appelee a DEUX endroits, et ce n'est pas un
// doublon :
//   - a la validation, c'est le cas normal ;
//   - a l'ouverture de la page des jetons, en RATTRAPAGE, pour les
//     comptes verifies avant l'existence des jetons - ceux-la n'ont
//     aucune validation a laquelle se raccrocher.
//
// Le controle ci-dessous est ce qui rend les deux appels sans danger :
// il regarde s'il existe deja une ligne, et non un drapeau qu'il
// faudrait penser a poser.
//
// Ne fait rien si la personne n'est pas verifiee, ou si elle les a deja
// recus une fois.
function offrirLaBienvenue(personne) {
  if (!personne || personne.est_admin) return null;
  if (personne.statut_verification !== "verifie") return null;
  if (requetes.aRecuLaBienvenue.get(personne.id)) return null;

  const quantite = jetonsDeBienvenue(personne.role);
  const jours = parametreNombre("bienvenue_jours");

  // Reglage absent ou a zero : on n'offre rien plutot que de deviner.
  if (!quantite || quantite <= 0 || !jours || jours <= 0) return null;

  requetes.crediterBienvenue.run({
    personne: personne.id,
    quantite,
    detail: `${quantite} jetons offerts a la verification de votre compte`,
    delai: `+${Math.round(jours)} days`,
  });

  return { quantite, jours: Math.round(jours) };
}

// LES JETONS OFFERTS QUI ONT PASSE LEUR DATE.
//
// On n'efface aucune ligne : on en ecrit une NEGATIVE. L'historique doit
// pouvoir montrer que des jetons ont ete offerts, puis perdus faute
// d'avoir servi. Effacer l'entree ferait disparaitre le cadeau lui-meme.
//
// Les jetons achetes ne sont jamais touches : eux n'expirent pas.
function expirerLesJetonsOfferts(personneId) {
  const s = requetes.soldeJetons.get(personneId);
  if (s.offerts <= 0) return null;

  const echeance = requetes.expirationJetonsOfferts.get(personneId);
  if (!echeance || !echeance.quand) return null;

  // SQLite ecrit ses dates en heure universelle. Sans le Z final,
  // JavaScript les lirait comme des heures locales et l'expiration
  // tomberait une heure trop tot ou trop tard.
  if (new Date(String(echeance.quand).replace(" ", "T") + "Z") > new Date()) return null;

  requetes.ecrireMouvementJetons.run({
    personne: personneId,
    quantite: -s.offerts,
    nature: "offert",
    motif: "expiration",
    detail: `${s.offerts} jetons offerts non utilises a temps`,
    achat: null,
    annonce: null,
    expire: null,
  });

  return s.offerts;
}

// DEPENSER DES JETONS.
//
// LES JETONS OFFERTS PARTENT EN PREMIER. Ils expirent, les achetes non :
// prendre les achetes d'abord ferait perdre a la personne ce qu'on lui
// avait donne, alors qu'elle avait de quoi payer autrement.
//
// Une depense a cheval sur les deux ecrit deux lignes : chacune garde sa
// nature, sinon un solde ne pourrait plus se lire en deux parts.
//
// Renvoie false si le solde ne suffit pas, SANS RIEN ECRIRE. L'appelant
// doit alors abandonner l'action : on ne fait jamais a moitie.
function depenserJetons(personne, quantite, motif, detail, annonceId) {
  const combien = Math.round(Number(quantite) || 0);
  if (combien <= 0) return false;

  const s = requetes.soldeJetons.get(personne.id);
  if (s.offerts + s.achetes < combien) return false;

  const surOfferts = Math.min(s.offerts, combien);
  const surAchetes = combien - surOfferts;

  if (surOfferts > 0) {
    requetes.ecrireMouvementJetons.run({
      personne: personne.id, quantite: -surOfferts, nature: "offert",
      motif, detail, achat: null, annonce: annonceId || null, expire: null,
    });
  }

  if (surAchetes > 0) {
    requetes.ecrireMouvementJetons.run({
      personne: personne.id, quantite: -surAchetes, nature: "achete",
      motif, detail, achat: null, annonce: annonceId || null, expire: null,
    });
  }

  return true;
}

// Dans combien de temps une place se liberera, en heures pleines.
// Renvoie au moins 1 : "dans 0 heure" ne veut rien dire.
function heuresAvant(quandUTC) {
  if (!quandUTC) return null;

  const cible = new Date(String(quandUTC).replace(" ", "T") + "Z");
  const restant = cible.getTime() - Date.now();

  return restant <= 0 ? 0 : Math.max(1, Math.ceil(restant / 3600000));
}

// A APPELER AVANT DE LIRE OU DE DEPENSER UN SOLDE. Les deux regles se
// suivent dans cet ordre : on n'expire pas des jetons qui viennent
// d'etre offerts, et on n'offre pas par-dessus des jetons perimes.
function mettreAJourLesJetons(personne) {
  const offerts = offrirLaBienvenue(personne);
  const perdus = offerts ? null : expirerLesJetonsOfferts(personne.id);
  return { offerts, perdus };
}

// CE QU'UNE ACTION COUTE, selon le role.
// Un employeur met une demande en avant, une personne qui propose ses
// services repond a une demande. Deux actions, deux prix, et jamais
// l'un sur l'ecran de l'autre.
// CE QUE LES JETONS ACHETENT, des deux cotes : une mise en avant.
// Repondre a une demande est redevenu gratuit, et le role ne change plus
// le prix - seulement ce qui est mis en avant.
function coutDeLAction() {
  return parametreNombre("cout_mise_en_avant");
}

// CE QU'UN NOMBRE DE JETONS PERMET DE FAIRE, en toutes lettres.
//
// "8 reponses" ne dit pas reponses a quoi. Le mot seul ne veut rien
// dire : on repond a une DEMANDE, on met une DEMANDE en avant. Ecrite
// ici une fois, la phrase ne peut pas dire deux choses selon l'ecran.
function actionsPossibles(estEmployeur, nombre) {
  const n = Math.max(0, Math.round(Number(nombre) || 0));

  return estEmployeur
    ? `mettre ${n} ${n > 1 ? "demandes" : "demande"} en avant`
    : `mettre votre profil en avant ${n} ${n > 1 ? "fois" : "fois"}`;
}

// La meme chose au singulier indefini, pour les phrases qui parlent
// d'une action sans la compter : "il vous manque 5 jetons pour ...".
function uneAction(estEmployeur) {
  return estEmployeur ? "mettre une demande en avant" : "mettre votre profil en avant";
}

function soldeJetonsDe(personneId) {
  const s = requetes.soldeJetons.get(personneId);
  return { offerts: s.offerts, achetes: s.achetes, total: s.offerts + s.achetes };
}

// "2026-09-07 14:23:01" devient "07/09/2026". SQLite range ses dates
// dans un ordre qui se trie bien mais ne se lit pas.
function dateLisible(texte) {
  const trouve = String(texte || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return trouve ? `${trouve[3]}/${trouve[2]}/${trouve[1]}` : "";
}

// Ce que la personne lit dans son historique, quand la ligne n'a pas de
// detail ecrit. Le motif est un mot technique, pas une phrase.
function motifJetonsLisible(motif) {
  const phrases = {
    achat: "Achat de jetons",
    bienvenue: "Jetons offerts",
    expiration: "Jetons offerts expirés",
    candidature: "Réponse à une demande",
    mise_en_avant: "Mise en avant d'une demande",
    remboursement: "Jetons rendus",
  };

  return phrases[motif] || motif;
}

// app.locals : disponible dans TOUTES les vues .ejs sans le repasser.
app.locals.formaterTarif = formaterTarif;
app.locals.formaterMontant = formaterMontant;
// Les limites des champs de montant, lues par les formulaires : les memes
// valeurs que celles que le serveur fait respecter.
app.locals.montantMinimum = MONTANT_MINIMUM_FCFA;
app.locals.pasMontant = PAS_MONTANT_FCFA;
app.locals.conditionsMax = CONDITIONS_MAX_CARACTERES;
app.locals.detaillerTarif = detaillerTarif;
app.locals.regleMontantLisible = regleMontantLisible;
app.locals.pourcentageCommission = Math.round(TAUX_COMMISSION * 100);
app.locals.libelleVerification = libelleVerification;
app.locals.phraseCandidature = phraseCandidature;
app.locals.attenteVerification = attenteVerification;
app.locals.attenteLisible = attenteLisible;
app.locals.delaiVerificationHeures = DELAI_VERIFICATION_HEURES;
app.locals.libelleUnite = libelleUnite;
app.locals.prixEnClair = prixEnClair;
app.locals.unitesTarif = UNITES_TARIF;
app.locals.quartiers = quartiers;
// La liste des arrondissements se DEDUIT des quartiers : elle n'est plus
// recopiee dans chaque formulaire, ou elle finissait par diverger.
app.locals.arrondissements = [...new Set(quartiers.map((q) => q.arrondissement))].sort();
// La meme correspondance, mise a la disposition du navigateur, pour que
// l'arrondissement s'affiche AVANT l'envoi du formulaire. C'est un
// confort d'affichage : la decision reste celle du serveur.
app.locals.carteQuartiers = Object.fromEntries(
  quartiers.map((q) => [normaliserNom(q.nom), q.arrondissement])
);
app.locals.metiers = metiers;
app.locals.trancheAge = trancheAge;
app.locals.disponibilitesLisibles = disponibilitesLisibles;
app.locals.badgesDe = badgesDe;
app.locals.libelleExperience = libelleExperience;
app.locals.jours = JOURS;
app.locals.jetonsEnClair = jetonsEnClair;
app.locals.dateLisible = dateLisible;
app.locals.motifJetonsLisible = motifJetonsLisible;
app.locals.actionsPossibles = actionsPossibles;
app.locals.uneAction = uneAction;
app.locals.valeurDuJeton = valeurDuJeton;
app.locals.moyenneLisible = moyenneLisible;
app.locals.notePersonne = notePersonne;
app.locals.criteresAvis = criteresAvis;
app.locals.moments = MOMENTS;
app.locals.experienceMaxAnnees = EXPERIENCE_MAX_ANNEES;

// ============================================================
// RECEPTION DES DOCUMENTS DE VERIFICATION
// ============================================================
// Les fichiers sont ranges dans data/documents/, c'est-a-dire
// EN DEHORS du dossier public/. Aucune adresse web ne permet donc
// de les telecharger : seule une route qui verifie qui demande
// pourra les servir (etape suivante).
const DOSSIER_DOCUMENTS = path.join(__dirname, "data", "documents");
fs.mkdirSync(DOSSIER_DOCUMENTS, { recursive: true });

const EXTENSIONS_AUTORISEES = [".jpg", ".jpeg", ".png", ".pdf"];
// La photo du visage sera un jour montree a une autre personne : un PDF
// n'est pas une photo.
const EXTENSIONS_PHOTO = [".jpg", ".jpeg", ".png"];
const TAILLE_MAX_OCTETS = 5 * 1024 * 1024; // 5 Mo

const recevoirDocuments = multer({
  storage: multer.diskStorage({
    destination: (req, fichier, suite) => suite(null, DOSSIER_DOCUMENTS),

    // Le nom d'origine n'est JAMAIS reutilise : il pourrait contenir
    // un chemin ("../../server.js") ou ecraser le fichier d'un autre
    // utilisateur. On tire un nom au hasard, on ne garde que l'extension.
    filename: (req, fichier, suite) => {
      const extension = path.extname(fichier.originalname).toLowerCase();
      suite(null, crypto.randomBytes(16).toString("hex") + extension);
    },
  }),

  limits: { fileSize: TAILLE_MAX_OCTETS, files: 3 },

  fileFilter: (req, fichier, suite) => {
    const extension = path.extname(fichier.originalname).toLowerCase();
    if (fichier.fieldname === "photo" && !EXTENSIONS_PHOTO.includes(extension)) {
      return suite(new Error("PHOTO_NON_IMAGE"));
    }
    if (!EXTENSIONS_AUTORISEES.includes(extension)) {
      return suite(new Error("TYPE_NON_AUTORISE"));
    }
    suite(null, true);
  },
}).fields([
  { name: "cni", maxCount: 1 },
  { name: "casier", maxCount: 1 },
  { name: "photo", maxCount: 1 },
]);

// UNE PHOTO EST-ELLE VRAIMENT UNE IMAGE ? L'extension se choisit en
// renommant un fichier. Les premiers octets, eux, disent ce qu'il
// contient : FF D8 FF pour un JPEG, 89 50 4E 47 0D 0A 1A 0A pour un PNG.
// La photo sera montree a une autre personne : un fichier deguise ne doit
// pas pouvoir passer.
function estUneImage(nomFichier) {
  try {
    const descripteur = fs.openSync(path.join(DOSSIER_DOCUMENTS, nomFichier), "r");
    const debut = Buffer.alloc(8);
    const lus = fs.readSync(descripteur, debut, 0, 8, 0);
    fs.closeSync(descripteur);
    const jpeg = lus >= 3 && debut[0] === 0xff && debut[1] === 0xd8 && debut[2] === 0xff;
    const png = lus === 8 && debut.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    return jpeg || png;
  } catch (erreur) {
    return false;
  }
}

// Efface un fichier sans faire planter le serveur s'il n'existe plus.
function supprimerDocument(nomFichier) {
  if (!nomFichier) return;
  try {
    fs.unlinkSync(path.join(DOSSIER_DOCUMENTS, nomFichier));
  } catch (erreur) {
    console.log("Suppression impossible :", nomFichier, erreur.code);
  }
}

function calculerDistanceKm(lat1, lon1, lat2, lon2) {
  const rayonTerre = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return rayonTerre * c;
}

// Retrouve la personne connectee a partir du cookie, ou null.
// La session ne retient que l'identifiant : les informations
// affichees viennent toujours de la base, donc toujours a jour.
// --- Le jeton de session, d'ou qu'il vienne ------------------------
//
// Le MEME jeton voyage de deux facons :
//   - un navigateur l'envoie tout seul dans le cookie "session" ;
//   - l'application mobile l'envoie dans l'en-tete Authorization: Bearer,
//     parce que son outil d'appel ne garde pas les cookies.
// Une seule liste de sessions : une seule porte, et deux facons de
// presenter la meme cle.
//
// LE COOKIE EST LU EN PREMIER. Un navigateur n'envoie jamais d'en-tete
// Authorization de lui-meme : pour une page du site, rien ne change.
function jetonDeSession(req) {
  const enteteCookie = req.headers.cookie || "";
  const paire = enteteCookie.split("; ").find((c) => c.startsWith("session="));
  if (paire) return paire.split("=")[1];

  // genererToken produit 64 caracteres hexadecimaux : l'en-tete n'est
  // accepte que sous cette forme, le reste est ecarte avant toute lecture.
  const trouve = String(req.headers.authorization || "").match(/^Bearer\s+([0-9a-f]{64})$/i);
  return trouve ? trouve[1].toLowerCase() : null;
}

// La session, et la personne a qui elle appartient, lues en UNE requete.
//
// LA LISTE DES SESSIONS EST UN OBJET ORDINAIRE : un jeton fabrique comme
// "constructor" y trouvait une valeur heritee, et la requete plantait.
// On ne lit que les cles posees par nous.
function lireSession(req) {
  const jeton = jetonDeSession(req);
  if (!jeton || !Object.prototype.hasOwnProperty.call(sessions, jeton)) {
    return { jeton: null, utilisateur: null };
  }
  return { jeton, utilisateur: requetes.utilisateurParId.get(sessions[jeton]) || null };
}

// Ce que lit une personne suspendue, a la connexion comme au clic qui
// suit sa suspension : la meme phrase partout, avec le motif de l'equipe.
function texteSuspension(utilisateur) {
  return "Votre compte a été suspendu par l'équipe PamConnect" +
    (utilisateur.suspendu_motif ? " : " + utilisateur.suspendu_motif : "") + ".";
}

function utilisateurConnecte(req) {
  // Une personne suspendue n'est plus connectee, ou que la question soit
  // posee. Le portier global lui explique pourquoi ; cette fonction
  // garantit qu'aucune route ne la traite comme connectee entre-temps.
  const { utilisateur } = lireSession(req);
  return utilisateur && !utilisateur.suspendu ? utilisateur : null;
}

// ============================================================
// Le "portier" : verifie qu'une personne est bien connectee.
// Express l'execute AVANT la route sur laquelle on le pose.
//   - personne connectee  -> on redirige et on s'arrete
//   - quelqu'un connecte  -> next() laisse passer vers la route
// ============================================================
function exigerConnexion(req, res, next) {
  const utilisateur = utilisateurConnecte(req);

  if (!utilisateur) {
    return res.redirect("/connexion");
  }

  // On accroche la personne a la requete : les routes qui suivent
  // n'ont plus rien a rechercher, elles lisent req.utilisateur.
  req.utilisateur = utilisateur;
  next();
}

// Second portier, plus strict : reserve aux membres de l'equipe projet.
function exigerAdmin(req, res, next) {
  const utilisateur = utilisateurConnecte(req);

  if (!utilisateur) {
    return res.redirect("/connexion");
  }

  if (!utilisateur.est_admin) {
    return res.status(403).render("message", {
      titre: "Accès refusé",
      texte: "Cette page est réservée à l'équipe PamConnect.",
      liens: [{ url: "/", texte: "Retour à l'accueil" }],
    });
  }

  req.utilisateur = utilisateur;
  next();
}

// Troisieme portier, qui ferme la porte dans l'autre sens.
//
// REGLE METIER : un membre de l'equipe n'embauche personne.
// Son travail est de controler des pieces d'identite. S'il pouvait aussi
// publier des annonces, il examinerait les papiers de ses propres
// candidates : c'est un conflit d'interet.
//
// La regle est ecrite ICI, cote serveur. Retirer le bouton de la page ne
// serait qu'une politesse : n'importe qui peut appeler l'adresse a la
// main. Une regle n'existe que la ou le serveur la fait respecter.
//
// A placer APRES exigerConnexion, qui remplit req.utilisateur.
function interdireALEquipe(req, res, next) {
  if (req.utilisateur.est_admin) {
    return res.status(403).render("message", {
      titre: "Reserve aux employeurs",
      texte: "Un compte de l'equipe PamConnect verifie les identites. " +
             "Il ne publie pas de demande et n'embauche personne.",
      liens: [{ url: "/admin", texte: "Aller a l'espace equipe" }],
    });
  }

  next();
}

// ============================================================
// PARTIE 1 - Les fichiers du dossier public/ (HTML, CSS, images)
// ============================================================
app.use(express.static(path.join(__dirname, "public")));

// Rend la personne connectee disponible dans TOUTES les vues, pour que
// le menu puisse s'adapter. Place apres express.static : inutile de
// consulter la base pour servir une feuille de style.
app.use((req, res, next) => {
  const { jeton, utilisateur } = lireSession(req);

  // UNE SANCTION PREND EFFET AU CLIC SUIVANT. La suspension n'etait
  // verifiee qu'a la connexion : une personne deja connectee gardait tout
  // son acces jusqu'a ce qu'elle se deconnecte d'elle-meme, parfois des
  // jours plus tard.
  //
  // Sa session est EFFACEE, pas seulement refusee : lever la sanction ne
  // rouvre pas les sessions d'avant. Et elle lit POURQUOI, avec le motif
  // de l'equipe : la renvoyer en silence vers la connexion lui ferait
  // croire a une panne.
  //
  // La ligne lue contient deja la colonne suspendu : cette verification ne
  // coute aucune requete de plus aux autres.
  if (utilisateur && utilisateur.suspendu) {
    delete sessions[jeton];
    res.clearCookie("session", { path: "/" });
    res.locals.moi = null;
    if (req.path.startsWith("/api/")) {
      return erreurApi(res, 403, texteSuspension(utilisateur));
    }
    return res.status(403).render("message", {
      titre: "Compte suspendu",
      texte: texteSuspension(utilisateur),
      liens: [{ url: "/", texte: "Retour à l'accueil" }],
    });
  }

  const moi = utilisateur;
  res.locals.moi = moi;

  // Ce que la personne connectee a le droit de FAIRE.
  //
  // Les ecrans demandaient jusqu'ici "quel est ton role ?" et en
  // deduisaient eux-memes les droits. Resultat : la meme regle etait
  // reecrite dans chaque vue, et un oubli suffisait a proposer un bouton
  // que le serveur refuse. Une seule regle, un seul endroit.
  //
  // Ces valeurs doivent rester le REFLET des regles du serveur
  // (interdireALEquipe, les controles de role dans les routes). Elles ne
  // les remplacent pas : un ecran ne protege rien.
  // Le chemin demande, pour que le menu puisse marquer la page ouverte.
  // Sans ce reperage, on ne sait jamais ou l'on se trouve.
  res.locals.chemin = req.path;

  // Ce qui attend cette personne : les messages qu'elle n'a pas lus, et
  // les decisions prises sur ses candidatures qu'elle n'a pas encore
  // vues. Une seule pastille pour les deux : ce qui compte, c'est
  // "quelque chose vous attend", pas de quelle sorte.
  //
  // Calcule une fois ici, lu par le menu sur chaque page. Un membre de
  // l'equipe n'a ni discussion ni candidature : on n'interroge pas la
  // base pour rien.
  res.locals.messagesNonLus = moi && !moi.est_admin
    ? requetes.messagesNonLus.get({ moi: moi.id }).n
    : 0;

  res.locals.decisionsNonVues = moi && !moi.est_admin
    ? requetes.decisionsNonVues.get({ moi: moi.id }).n
    : 0;

  res.locals.aVoir = res.locals.messagesNonLus + res.locals.decisionsNonVues;

  // Ce qui attend la personne SUR SON PROFIL : un message de l'equipe,
  // un avertissement. Sans ce compte, un message pouvait rester des
  // semaines sans etre vu - et une question que personne ne lit ne sert
  // a rien. Aucune requete de plus : les colonnes sont deja chargees.
  res.locals.aLireSurMonProfil = nombreALireSurMonProfil(moi);

  res.locals.jePeux = {
    // Un membre de l'equipe est enregistre comme employeur pour une
    // raison technique, mais il n'embauche pas : il verifie des
    // identites. Lui proposer de publier serait un conflit d'interet.
    publier:          Boolean(moi && moi.role === "employeur" && !moi.est_admin),
    repondre:         Boolean(moi && moi.role === "prestataire"),
    verifierDossiers: Boolean(moi && moi.est_admin),
  };

  next();
});

// ============================================================
// PARTIE 2 - Les routes de l'application
// ============================================================

// --- Les pages de presentation -------------------------------------
// Elles ne font qu'afficher une vue : aucune donnee a preparer.
app.get("/", (req, res) => res.render("accueil", { titre: "Accueil" }));
// Les titres reprennent ceux des pages : le mot "prestataire" n'a de
// sens que dans notre code, il ne s'affiche pas, onglet compris.
app.get("/employeur", (req, res) => res.render("employeur", { titre: "Vous cherchez quelqu'un" }));
app.get("/prestataire", (req, res) => res.render("prestataire", { titre: "Vous proposez vos services" }));
// "Proposer mes services" ouvre l'inscription sur ce choix. Avant, la
// personne arrivait sur "Trouver quelqu'un pour ma maison".
app.get("/inscription", (req, res) => res.render("inscription", {
  titre: "Créer un compte",
  roleChoisi: ROLES_INSCRIPTION.some((r) => r.valeur === req.query.role)
    ? req.query.role
    : ROLES_INSCRIPTION[0].valeur,
}));
app.get("/connexion", (req, res) => res.render("connexion", { titre: "Se connecter" }));

// Ces pages etaient auparavant des fichiers .html. On redirige les
// anciennes adresses pour ne casser aucun lien deja partage.
["index", "employeur", "prestataire", "inscription", "connexion", "recherche"].forEach((page) => {
  app.get(`/${page}.html`, (req, res) => res.redirect(301, page === "index" ? "/" : `/${page}`));
});

// --- Deconnexion ---------------------------------------------------
// En POST et non en GET : une simple adresse pourrait etre declenchee
// a l'insu de la personne, par exemple par une image piegee.
app.post("/deconnexion", (req, res) => {
  const enteteCookie = req.headers.cookie || "";
  const paire = enteteCookie.split("; ").find((c) => c.startsWith("session="));

  if (paire) {
    delete sessions[paire.split("=")[1]];   // la session n'existe plus cote serveur
  }

  res.clearCookie("session", { path: "/" }); // et le navigateur oublie le cookie
  res.redirect("/");
});

// --- Creer un compte, UNE SEULE FOIS pour le site et l'application ---

// Les deux raisons de venir, dans l'ordre du formulaire du site. Seule la
// seconde declare un metier, un tarif et des disponibilites.
const ROLES_INSCRIPTION = [
  { valeur: "employeur", libelle: "Trouver quelqu'un pour ma maison", pourPersonne: false },
  { valeur: "prestataire", libelle: "Proposer mes services", pourPersonne: true },
];

// L'exemple sous le tarif. Ecrits a la main dans la page, ses montants
// auraient menti le jour ou la commission changerait.
//   prix       : ce que la personne annonce a l'equipe
//   commission : ce que PamConnect ajoute, payee par l'employeur
//   employeur  : ce que l'employeur paie en tout
//   recu       : ce que la personne recoit - son prix, entier
function exempleDeTarif() {
  const detail = detaillerTarif(10000);
  return {
    prix: formaterMontant(detail.brut),
    commission: formaterMontant(detail.commission),
    employeur: formaterMontant(detail.employeur),
    recu: formaterMontant(detail.brut),
  };
}
app.locals.exempleTarif = exempleDeTarif();

// Un controle volontairement minimal : une adresse doit contenir un @
// et un point apres. Trop strict, on refuserait des adresses valides.
// Le meme a l'inscription et au changement d'adresse.
function adresseEmailValide(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

// LE NUMERO DE TELEPHONE, ecrit comme chacun l'ecrit : avec des espaces,
// des points, ou precede de +237. On ne garde que les chiffres, et on
// retire l'indicatif du pays : "+237 6XX XX XX XX" et "6XXXXXXXX" sont le
// meme numero, et deux ecritures ne doivent pas faire deux numeros.
//
// Au Cameroun, un numero tient en NEUF chiffres : les mobiles commencent
// par 6, les fixes par 2. Renvoie null si ce n'en est pas un.
function normaliserTelephone(valeur) {
  let chiffres = String(valeur || "").replace(/[^0-9]/g, "");

  // L'indicatif n'est retire que s'il en reste bien neuf chiffres : un
  // fixe peut lui-meme commencer par 237.
  if (chiffres.length === 12 && chiffres.startsWith("237")) chiffres = chiffres.slice(3);

  return /^[26][0-9]{8}$/.test(chiffres) ? chiffres : null;
}

// Le meme numero, lisible : 6XX XX XX XX.
function formaterTelephone(numero) {
  const chiffres = String(numero || "");
  if (chiffres.length !== 9) return chiffres;
  return `${chiffres.slice(0, 3)} ${chiffres.slice(3, 5)} ${chiffres.slice(5, 7)} ${chiffres.slice(7)}`;
}

// Les memes deux phrases a l'inscription et dans Modifier mon profil.
const TELEPHONE_VIDE = {
  titre: "Numéro de téléphone obligatoire",
  texte: "Le numéro de téléphone est obligatoire : c'est par là que l'équipe vous joint.",
};
const TELEPHONE_INVALIDE = {
  titre: "Numéro invalide",
  texte: "Ce numéro ne ressemble pas à un numéro camerounais. Écrivez-le en neuf chiffres, " +
         "par exemple sous la forme 6XX XX XX XX.",
};

// Le numero saisi, ou le probleme a afficher. Ecrit UNE SEULE FOIS pour
// l'inscription, Modifier mon profil, le site et l'application.
function lireTelephone(donnees) {
  const saisi = String(donnees.telephone || "").trim();
  if (!saisi) return { probleme: TELEPHONE_VIDE };

  const numero = normaliserTelephone(saisi);
  if (!numero) return { probleme: TELEPHONE_INVALIDE };

  return { numero };
}

// Le formulaire vide : les listes de Modifier mon profil, le choix du
// role et l'exemple. Les champs de la personne qui repond sont prepares :
// ils s'affichent des que ce role est choisi, comme sur le site.
function formulaireInscription() {
  return {
    ...formulaireMonProfil({ role: "prestataire", nom: "", email: "" }),
    roles: ROLES_INSCRIPTION,
    exempleTarif: exempleDeTarif(),
  };
}

function inscrire(donnees) {
  const retour = { url: "/inscription", texte: "Retour au formulaire" };
  const refus = (code, titre, texte) => ({ probleme: { code, titre, texte, lien: retour } });

  // Le role vient d'une liste fermee. Une valeur inconnue faisait
  // echouer la base : la personne voyait une erreur du serveur.
  const role = ROLES_INSCRIPTION.find((r) => r.valeur === donnees.role);
  if (!role) {
    return refus(400, "Choix obligatoire",
      "Indiquez si vous cherchez quelqu'un pour votre maison ou si vous proposez vos services.");
  }

  const nom = String(donnees.nom || "").trim();
  if (!nom) return refus(400, "Nom obligatoire", "Indiquez votre nom complet.");

  const email = String(donnees.email || "").trim().toLowerCase();
  if (!adresseEmailValide(email)) {
    return refus(400, "Adresse invalide", "Vérifiez l'adresse saisie : il manque un @ ou le nom du site.");
  }

  const dejaUtilisee = {
    probleme: {
      code: 409,
      titre: "Adresse déjà utilisée",
      texte: `Un compte existe déjà avec l'adresse ${email}.`,
      liens: [
        { url: "/connexion", texte: "Se connecter" },
        { url: "/inscription", texte: "Réessayer" },
      ],
    },
  };
  if (requetes.utilisateurParEmail.get(email)) return dejaUtilisee;

  // L'EQUIPE APPELLE : sans numero, une inscription ne sert a rien. Il est
  // demande aux deux roles, et ne sortira jamais de l'espace de l'equipe.
  const telephone = lireTelephone(donnees);
  if (telephone.probleme) return refus(400, telephone.probleme.titre, telephone.probleme.texte);

  // La meme longueur que pour changer de mot de passe. Avant, seul le
  // changement l'exigeait : un compte pouvait naitre avec "1".
  const motdepasse = String(donnees.motdepasse || "");
  if (motdepasse.length < MOT_DE_PASSE_MIN) {
    return refus(400, "Mot de passe trop court",
      `Choisissez un mot de passe d'au moins ${MOT_DE_PASSE_MIN} caractères.`);
  }

  // Sans metier, la personne n'apparait dans aucune recherche.
  // Sans tarif souhaite, l'equipe n'a pas de point de depart pour l'appel.
  const personne = role.pourPersonne;
  if (personne) {
    const probleme = verifierProfilPrestataire(donnees);
    if (probleme) return refus(400, probleme.titre, probleme.texte);
  }

  // Le quartier commande : l'arrondissement en est deduit (voir resoudreLieu).
  const lieu = resoudreLieu(donnees);
  const experience = String(donnees.experience_annees ?? "").trim();
  const coordonnee = (valeur) => {
    const nombre = Number(valeur);
    return valeur && Number.isFinite(nombre) ? nombre : null;
  };

  try {
    requetes.creerUtilisateur.run({
      role: role.valeur,
      nom,
      email,
      telephone: telephone.numero,
      motdepasse: hacherMotDePasse(motdepasse),
      arrondissement: lieu.arrondissement,
      quartier: lieu.quartier,
      // Un employeur n'a ni metier, ni tarif, ni age, ni disponibilites a
      // declarer. Le site cache ces champs sans tous les vider : une case
      // cochee avant de changer de choix partait quand meme.
      metier: personne ? resoudreMetier(donnees.metier) : null,
      tarif: personne ? Math.round(Number(donnees.tarif)) : null,
      date_naissance: personne ? (donnees.date_naissance || null) : null,
      experience_annees: personne && experience ? Number(experience) : null,
      disponibilites: personne ? resoudreDisponibilites(donnees) : null,
      latitude: coordonnee(donnees.latitude),
      longitude: coordonnee(donnees.longitude),
    });
  } catch (erreur) {
    // La contrainte UNIQUE de la base est le dernier rempart, au cas ou
    // deux inscriptions viseraient la meme adresse au meme instant.
    if (String(erreur.message).includes("UNIQUE")) return dejaUtilisee;
    throw erreur;
  }

  console.log("Nouvel utilisateur enregistré :", email);

  return {
    ok: true,
    email,
    titre: `Merci ${nom} !`,
    texte: "Votre compte est créé. Vous pouvez maintenant vous connecter.",
  };
}

app.post("/inscription", lireFormulaire, (req, res) => {
  const resultat = inscrire(req.body);
  if (resultat.probleme) return afficherProbleme(res, resultat.probleme);

  res.render("message", {
    titre: resultat.titre,
    texte: resultat.texte,
    liens: [{ url: "/connexion", texte: "Se connecter" }],
  });
});

// --- Connexion -----------------------------------------------------
app.post("/connexion", lireFormulaire, (req, res) => {
  const donnees = req.body;
  const email = (donnees.email || "").trim().toLowerCase();
  const utilisateur = requetes.utilisateurParEmail.get(email);

  // Un compte suspendu garde son mot de passe valide, mais la porte
  // reste fermee. On le dit clairement plutot que d'afficher "email ou
  // mot de passe incorrect" : la personne doit savoir qu'elle est
  // sanctionnee, sinon elle croit a une panne et recommence.
  if (utilisateur && utilisateur.suspendu &&
      verifierMotDePasse(donnees.motdepasse, utilisateur.motdepasse)) {
    return res.status(403).render("message", {
      titre: "Compte suspendu",
      texte: "Votre compte a été suspendu par l'équipe PamConnect" +
             (utilisateur.suspendu_motif ? " : " + utilisateur.suspendu_motif : "") + ".",
      liens: [{ url: "/", texte: "Retour à l'accueil" }],
    });
  }

  if (utilisateur && verifierMotDePasse(donnees.motdepasse, utilisateur.motdepasse)) {
    const token = genererToken();
    sessions[token] = utilisateur.id;

    // res.cookie ecrit l'en-tete Set-Cookie a notre place.
    // httpOnly : le JavaScript de la page ne peut pas lire ce cookie.
    res.cookie("session", token, { httpOnly: true, path: "/" });

    const suite = apresConnexion(utilisateur);

    return res.render("message", {
      titre: `Bienvenue ${utilisateur.nom} !`,
      texte: suite.texte,
      liens: [suite.lien],
    });
  }

  res.status(401).render("message", {
    titre: "Connexion échouée",
    texte: "Email ou mot de passe incorrect.",
    liens: [{ url: "/connexion", texte: "Réessayer" }],
  });
});

// --- Mon profil ----------------------------------------------------
// --- Mon profil, reuni UNE SEULE FOIS pour le site et l'application --

// Ce qui attend la personne SUR SON PROFIL : un message de l'equipe, un
// avertissement. La pastille du menu du site et celle de l'application
// comptent la meme chose.
function nombreALireSurMonProfil(moi) {
  if (!moi || moi.est_admin) return 0;
  return (moi.message_equipe && !moi.message_equipe_lu ? 1 : 0)
    + (moi.avertissement_motif && !moi.avertissement_lu ? 1 : 0);
}

// Un avis tel qu'il s'affiche, deja formule : sur la fiche d'une
// personne et sur Mon profil.
function avisLisibles(avis) {
  return avis.map((a) => ({
    note: `${moyenneLisible(a.note)} sur 5`,
    auteur: a.nomAuteur,
    titreDemande: a.titreAnnonce || null,
    commentaire: a.commentaire || null,
    // Le sens d'un critere depend du role de celui qui a ECRIT l'avis.
    criteres: criteresAvis(a.roleAuteur === "employeur")
      .filter((critere) => a[critere.cle])
      .map((critere) => `${critere.libelle} : ${a[critere.cle]} sur 5`),
    date: dateLisible(a.cree_le),
  }));
}

function phraseAttenteVerification(envoyeLe) {
  const attente = attenteVerification(envoyeLe);
  if (attente === null) {
    return `Notre équipe examine votre dossier sous ${DELAI_VERIFICATION_HEURES} heures.`;
  }
  if (attente.depasse) {
    return `Envoyé ${attenteLisible(envoyeLe)}. Le délai de ${DELAI_VERIFICATION_HEURES} heures ` +
           "est dépassé, votre dossier reste en tête de la liste.";
  }
  return `Envoyé ${attenteLisible(envoyeLe)}. Réponse attendue d'ici ${attente.restantes} ` +
         `heure${attente.restantes > 1 ? "s" : ""}.`;
}

// Le tarif sur SON profil, avec les montants du bloc detail-tarif du site.
//
// C'est un tarif SOUHAITE : seule l'equipe le voit, jamais les employeurs.
// Il lui sert de point de depart quand elle appelle la personne, qui
// annonce alors son prix. Ce que la personne recoit est ce prix, entier ;
// la commission est payee EN PLUS par l'employeur.
function tarifSurMonProfil(tarifBrut) {
  const detail = detaillerTarif(tarifBrut);
  const pourcentage = Math.round(TAUX_COMMISSION * 100);

  if (detail.brut <= 0) {
    return {
      lignes: [],
      phrase: "Vous n'avez pas encore indiqué votre tarif souhaité.",
      aide: "Sans tarif souhaité, l'équipe n'a pas de point de départ quand elle vous appelle.",
    };
  }

  return {
    lignes: [
      { libelle: "Vous recevez", montant: formaterMontant(detail.brut), retenue: false, total: false },
      { libelle: `Commission PamConnect (${pourcentage} %), ajoutée pour l'employeur`,
        montant: "+ " + formaterMontant(detail.commission), retenue: true, total: false },
      { libelle: "L'employeur paie", montant: formaterMontant(detail.employeur), retenue: false, total: true },
    ],
    phrase: null,
    aide: "Ce tarif est un point de départ : seule l'équipe PamConnect le voit, jamais " +
          "les employeurs. C'est au téléphone que le prix est fixé, avec vous.",
  };
}

function monProfil(u) {
  const equipe = Boolean(u.est_admin);
  const personne = u.role === "prestataire";
  const statut = u.statut_verification;
  const reputation = reputationDe(u.id);
  const recus = equipe ? [] : requetes.avisRecus.all(u.id);
  const aNoter = equipe ? 0 : requetes.servicesANoter.get({ moi: u.id }).n;
  const pluriel = aNoter > 1;

  return {
    nom: u.nom,
    // LE NUMERO NE SORT PAS D'ICI : il apparait sur son propre profil et
    // dans l'espace de l'equipe, jamais sur une fiche publique.
    telephone: u.telephone ? formaterTelephone(u.telephone) : null,
    // Un compte cree avant ce champ n'a pas encore de numero : on le lui
    // demande sans lui fermer la plateforme.
    telephoneAAjouter: u.telephone
      ? null
      : "Ajoutez votre numéro de téléphone pour que l'équipe puisse vous joindre.",
    // Un message de l'equipe n'est PAS une sanction ; un avertissement,
    // si. Chacun reste affiche tant que la personne ne l'a pas lu.
    messageEquipe: u.message_equipe && !u.message_equipe_lu
      ? { texte: u.message_equipe, le: u.message_equipe_le }
      : null,
    avertissement: u.avertissement_motif && !u.avertissement_lu
      ? { motif: u.avertissement_motif, le: u.avertissement_le }
      : null,
    // Pour un membre de l'equipe, on annonce sa FONCTION.
    fonction: equipe
      ? "Vérifie les dossiers d'identité"
      : (u.role === "employeur" ? "Employeur" : u.metier || "Prestataire"),
    // LES DEUX COTES passent par la verification ; seule l'equipe en est
    // dispensee, puisqu'elle ne rencontre personne.
    verification: equipe ? null : {
      statut,
      libelle: libelleVerification(statut),
      attente: statut === "en attente" ? phraseAttenteVerification(u.documents_envoyes_le) : null,
    },
    lieu: equipe ? null : [u.arrondissement, u.quartier].filter(Boolean).join(", ") || null,
    // LA TRACE D'UN MOT DE PASSE CHANGE APRES UN APPEL. Elle reste
    // affichee : si la personne ne reconnait pas ce changement, c'est
    // que quelqu'un d'autre l'a demande a sa place.
    motDePasseChangeLe: u.motdepasse_change_le ? dateLisible(u.motdepasse_change_le) : null,
    // JUSQU'A QUAND L'EQUIPE M'APPELLE EN PREMIER. Absent quand la mise
    // en avant est finie, ou quand il n'y en a jamais eu.
    miseEnAvantJusquAu: personne && !equipe
      && u.mise_en_avant_jusqu_au && u.mise_en_avant_jusqu_au > new Date().toISOString().slice(0, 19).replace("T", " ")
      ? dateLisible(u.mise_en_avant_jusqu_au)
      : null,
    email: u.email,
    badges: personne
      ? badgesDe(u).map((b) => ({ texte: b.texte, verifie: b.cle === "verifie" }))
      : [],
    trancheAge: personne ? trancheAge(u.date_naissance) : null,
    disponibilites: personne
      ? disponibilitesLisibles(u.disponibilites).map((c) => ({
          jour: c.jour.charAt(0).toUpperCase() + c.jour.slice(1),
          moments: c.moments.join(", "),
        }))
      : [],
    tarif: personne ? tarifSurMonProfil(u.tarif) : null,
    // CE QUE LES AUTRES DISENT DE MOI, avec le seul recours possible : le
    // signaler.
    avis: equipe ? null : {
      moyenne: reputation.nombre > 0 ? `${moyenneLisible(reputation.moyenne)} sur 5` : null,
      nombre: reputation.nombre,
      liste: avisLisibles(recus).map((a, i) => ({
        ...a,
        id: recus[i].id,
        signale: Boolean(recus[i].signale),
      })),
      // LE MEME ECRAN, DEUX METIERS : un employeur est note par la
      // personne qu'il a embauchee.
      vide: u.role === "employeur"
        ? "Personne ne vous a encore noté. Les personnes que vous embauchez pourront le faire une fois le service terminé."
        : "Personne ne vous a encore noté. Cela viendra après votre premier service terminé.",
    },
    // Cette page ne sert qu'a lire : elle dit que l'autre chemin existe.
    servicesANoter: aNoter > 0
      ? {
          phrase: `${aNoter} service${pluriel ? "s" : ""} attend${pluriel ? "ent" : ""} votre avis.`,
          suite: "Cette page montre ce que les autres ont dit de vous ; c'est dans vos " +
                 "messages que vous dites ce que vous pensez d'eux.",
        }
      : null,
    // LES DEUX COTES passent par la verification : l'employeur aussi doit
    // trouver le bouton sur son profil, et y lire pourquoi on l'a refusee.
    // Il n'arrivait a la page qu'en essayant de publier.
    motifRefus: !equipe && statut === "refuse" && u.motif_refus ? u.motif_refus : null,
    // MA PHOTO, une fois l'identite verifiee : l'equipe la compare a une
    // piece d'identite, il faut donc qu'elle en ait deja controle une.
    photo: equipe || statut !== "verifie" ? null : etatDeMaPhoto(u),
    boutonVerification: !equipe && statut !== "verifie"
      ? (statut === "non soumis" ? "Faire vérifier mon identité" : "Voir mon dossier")
      : null,
  };
}

app.get("/mon-profil", exigerConnexion, (req, res) => {
  // CETTE PAGE DIT QUI JE SUIS, PAS CE QUE JE FAIS. Ses demandes ou
  // ses reponses ont leur propre page : melangees ici, elles
  // repoussaient hors de l'ecran les informations et les avis.
  const profil = monProfil(req.utilisateur);

  res.render("profil", {
    titre: "Mon profil",
    utilisateur: req.utilisateur,

    // Ce que les autres disent de moi. Signalable ici, et nulle part
    // ailleurs : c est mon profil, ce sont mes avis.
    reputation: reputationDe(req.utilisateur.id),
    mesAvis: requetes.avisRecus.all(req.utilisateur.id),
    // Les phrases et les decisions de la page, lues aussi par l'application.
    profil,
    profilEnAvant: profil.miseEnAvantJusquAu,
  });
});

// --- Mes demandes : la surface de travail de l'employeur -----------
//
// Une dizaine de boutons de ce fichier ecrivaient deja "Retour a mes
// demandes" en menant au profil. Le texte promettait une page qui
// n'existait pas.
//
// La verification n'est PAS exigee ici : un employeur dont le dossier
// est en attente garde des demandes publiees et de l'argent bloque.
// Lui cacher les siennes serait lui cacher son propre argent.
// --- Les demandes d'un employeur, avec tout ce que l'ecran decide -----
//
// La page web et l'application montrent la MEME chose parce qu'elles
// lisent cette fonction. Tout ce qui depend des donnees est decide ici :
// demande pourvue ou retiree, mise en avant, phrases de statut, note,
// boutons proposes. Rien de tout cela n'est recopie dans les ecrans.
function demandesDeLEmployeur(employeurId) {
  const annonces = requetes.annoncesDeEmployeur.all(employeurId).map((annonce) => {
    const candidatures = requetes.candidaturesDeAnnonce.all(annonce.id);
    // DEDUITE, JAMAIS STOCKEE : une information deduite ne peut pas se
    // contredire.
    const pourvue = candidatures.some((c) => c.statut === "acceptee");
    const fermee = Boolean(annonce.annulee);
    const enAvant = Boolean(annonce.enAvant);

    return {
      ...annonce,
      fermee,
      pourvue,
      phraseFermeture: fermee
        ? (pourvue ? "Vous avez choisi quelqu'un." : "Vous avez retiré cette demande.")
        : null,
      horaireLisible: annonce.horaire || "Horaire non précisé",
      prixLisible: prixEnClair(annonce),
      lieu: [annonce.quartier, annonce.arrondissement].filter(Boolean).join(", "),
      proposeeA: annonce.nomInvitee || null,
      enAvant,
      enAvantJusquAu: enAvant ? dateLisible(annonce.mise_en_avant_jusqu_au) : null,
      // L'ETAT AVANT L'ACTION : une demande deja en avant n'a pas besoin
      // du bouton, elle a besoin d'une date.
      peutModifier: !fermee,
      peutMettreEnAvant: !fermee && !enAvant,
      peutRetirer: !fermee,
      candidatures: candidatures.map((c) => {
        // UNE DECISION NE SE PREND QU'UNE FOIS, ET SUR UNE DEMANDE OUVERTE.
        // Retirer une demande laisse ses reponses en attente : sans la
        // seconde condition, "Choisir" restait propose sur une demande
        // qui n'existe plus.
        const decidable = c.statut === "en attente" && !fermee;
        const verifiee = c.verificationPrestataire === "verifie";
        return {
          ...c,
          phrase: phraseCandidature(c.statut, true, { quelquUnChoisi: pourvue, demandeFermee: fermee }),
          libelleVerification: libelleVerification(c.verificationPrestataire),
          note: notePersonne({ nbAvis: c.nbAvis, moyenne: c.moyenne, services: c.servicesTermines }),
          experience: libelleExperience(c.experiencePrestataire),
          disponibilites: disponibilitesLisibles(c.disponibilitesPrestataire).map((d) => d.jour).join(", "),
          // On n'engage personne dont l'identite n'est pas verifiee ;
          // refuser, en revanche, reste toujours possible.
          peutChoisir: decidable && verifiee,
          peutRefuser: decidable,
          attendVerification: decidable && !verifiee,
          // UNE DISCUSSION ARCHIVEE SE RELIT. Le mot du bouton dit ce
          // qu'elle permet encore, comme sur la page Mes messages.
          libelleDiscussion: c.terminee_le ? "Relire la discussion" : "Discuter",
        };
      }),
    };
  });

  // CE QUI EST EN COURS D'ABORD. Une demande fermee garde ses discussions
  // et la trace de son argent : on ne la supprime pas, on la range.
  return annonces.filter((a) => !a.fermee).concat(annonces.filter((a) => a.fermee));
}

app.get("/mes-demandes", exigerConnexion, interdireALEquipe, (req, res) => {
  if (req.utilisateur.role !== "employeur") {
    return res.status(403).render("message", {
      titre: "Accès refusé",
      texte: "Cette page est celle des employeurs. Les demandes " +
             "auxquelles vous avez répondu sont sur Mes réponses.",
      liens: [{ url: "/mes-reponses", texte: "Voir mes réponses" }],
    });
  }

  // La route PREPARE les donnees, la vue se contente de les AFFICHER. Les
  // decisions viennent de demandesDeLEmployeur, que l'API partage.
  res.render("mes-demandes", {
    titre: "Mes demandes",
    mesAnnonces: demandesDeLEmployeur(req.utilisateur.id),
  });
});

// --- Mes reponses : le pendant, cote personne qui travaille --------
//
// Le meme besoin des deux cotes : savoir ce qui est parti et ce que
// c'est devenu. Ne le donner qu'a l'employeur aurait laisse la
// moitie de la plateforme chercher ses reponses au fond du profil.
// Les reponses de la personne, et ou elles en sont : ECRIT UNE SEULE FOIS
// pour le site et l'application.
function mesReponses(u) {
  return requetes.candidaturesDePrestataire.all(u.id).map((c) => ({
    id: c.id,
    titreDemande: c.titreAnnonce,
    phrase: phraseCandidature(c.statut, false, c),
  }));
}

app.get("/mes-reponses", exigerConnexion, interdireALEquipe, (req, res) => {
  if (req.utilisateur.role !== "prestataire") {
    return res.status(403).render("message", {
      titre: "Accès refusé",
      texte: "Cette page est celle des personnes qui répondent. Vos " +
             "demandes publiées sont sur Mes demandes.",
      liens: [{ url: "/mes-demandes", texte: "Voir mes demandes" }],
    });
  }

  res.render("mes-reponses", {
    titre: "Mes reponses",
    utilisateur: req.utilisateur,
    reponses: mesReponses(req.utilisateur),
  });
});

// --- Modifier son profil : le formulaire ---------------------------
// --- Modifier mon profil, UNE SEULE FOIS pour le site et l'application --

const CHAMPS_PROFIL = ["nom", "quartier", "arrondissement", "metier", "tarif",
                       "date_naissance", "experience_annees"];

// En JSON, un objet peut se glisser a la place d'un texte : on le refuse
// plutot que d'enregistrer "[object Object]" comme nom.
function formeDeProfilValide(corps) {
  return Boolean(corps) && typeof corps === "object" && !Array.isArray(corps) &&
    CHAMPS_PROFIL.every((champ) => corps[champ] == null ||
      typeof corps[champ] === "string" || typeof corps[champ] === "number") &&
    (corps.disponibilites == null ||
      (Array.isArray(corps.disponibilites) &&
       corps.disponibilites.every((creneau) => typeof creneau === "string")));
}

// Ce que le formulaire montre, rempli avec ce qui est enregistre.
function formulaireMonProfil(u) {
  const personne = u.role === "prestataire";
  const coches = new Set(String(u.disponibilites || "").split("|"));
  const annee = new Date().getFullYear();

  return {
    nom: u.nom,
    telephone: u.telephone ? formaterTelephone(u.telephone) : "",
    quartier: u.quartier || "",
    arrondissement: u.arrondissement || null,
    quartiers: quartiers.map((q) => q.nom),
    arrondissements: app.locals.arrondissements,
    // Un employeur n'a ni metier, ni tarif, ni disponibilites a declarer.
    pourPersonne: personne,
    metier: personne ? u.metier || "" : null,
    metiers: personne ? metiers.map((m) => m.nom) : [],
    dateNaissance: personne ? u.date_naissance || null : null,
    // Les annees que le serveur peut accepter.
    anneesNaissance: personne ? { de: annee - AGE_MAXIMUM, a: annee - AGE_MINIMUM } : null,
    experienceAnnees: personne && u.experience_annees != null ? String(u.experience_annees) : "",
    experienceMax: EXPERIENCE_MAX_ANNEES,
    moments: MOMENTS.map((m) => m.libelle),
    jours: personne
      ? JOURS.map((jour) => ({
          libelle: jour.charAt(0).toUpperCase() + jour.slice(1),
          creneaux: MOMENTS.map((m) => ({
            valeur: `${jour}-${m.cle}`,
            libelle: m.libelle,
            coche: coches.has(`${jour}-${m.cle}`),
          })),
        }))
      : [],
    tarif: personne && u.tarif ? String(u.tarif) : "",
    // Les deux cles du compte, en bas du meme ecran.
    email: u.email,
    motDePasseMin: MOT_DE_PASSE_MIN,
  };
}

function enregistrerMonProfil(moi, donnees) {
  const retour = { url: "/mon-profil/modifier", texte: "Retour au formulaire" };

  if (!String(donnees.nom || "").trim()) {
    return {
      probleme: {
        code: 400,
        titre: "Nom obligatoire",
        texte: "Indiquez le nom sous lequel vous souhaitez apparaître.",
        lien: retour,
      },
    };
  }

  // Les memes regles qu'a l'inscription, appelees au meme endroit.
  if (moi.role === "prestataire") {
    const probleme = verifierProfilPrestataire(donnees);
    if (probleme) return { probleme: { code: 400, ...probleme, lien: retour } };
  }

  // Le numero est demande ici aussi : c'est par cet ecran qu'un compte
  // cree avant son existence le renseigne.
  const telephone = lireTelephone(donnees);
  if (telephone.probleme) {
    return { probleme: { code: 400, ...telephone.probleme, lien: retour } };
  }

  const lieu = resoudreLieu(donnees);
  const experience = String(donnees.experience_annees ?? "").trim();

  requetes.majProfil.run({
    id: moi.id,
    nom: String(donnees.nom).trim(),
    telephone: telephone.numero,
    // Un compte d'equipe ne rend visite a personne : son arrondissement
    // et son quartier ne servent a rien, on ne les lui demande pas et on
    // ne les conserve pas. Une donnee inutile est une donnee de trop.
    arrondissement: moi.est_admin ? null : lieu.arrondissement,
    quartier: moi.est_admin ? null : lieu.quartier,
    // Un employeur n'a ni metier ni tarif : on ne les invente pas.
    // Ces trois informations ne concernent que les personnes qui
    // proposent leurs services : un employeur n'a ni experience ni
    // disponibilites a declarer, et son age ne regarde personne.
    metier: moi.role === "prestataire" ? resoudreMetier(donnees.metier) : null,
    tarif: moi.role === "prestataire" ? Math.round(Number(donnees.tarif)) : null,
    date_naissance: moi.role === "prestataire" ? (donnees.date_naissance || null) : null,
    experience_annees: moi.role === "prestataire" && experience ? Number(experience) : null,
    disponibilites: moi.role === "prestataire" ? resoudreDisponibilites(donnees) : null,
  });

  // La position n'est mise a jour que si le navigateur l'a fournie :
  // on ne remplace jamais une position connue par du vide.
  const latitude = Number(donnees.latitude);
  const longitude = Number(donnees.longitude);
  if (!isNaN(latitude) && !isNaN(longitude) && donnees.latitude && donnees.longitude) {
    requetes.majPosition.run(latitude, longitude, moi.id);
  }

  return { ok: true, titre: "Profil mis à jour", texte: "Vos informations ont bien été enregistrées." };
}

app.get("/mon-profil/modifier", exigerConnexion, (req, res) => {
  res.render("modifier-profil", {
    titre: "Modifier mon profil",
    utilisateur: req.utilisateur,
  });
});

// --- Modifier son profil : l'enregistrement ------------------------
//
// LIMITE CONNUE : le role d'un compte ne peut pas etre change.
// Un employeur a des demandes publiees, une aide-menagere a des
// candidatures envoyees : basculer de l'un a l'autre laisserait ces
// lignes sans proprietaire. Il faut creer un second compte.
app.post("/mon-profil/modifier", exigerConnexion, lireFormulaire, (req, res) => {
  const resultat = enregistrerMonProfil(req.utilisateur, req.body);
  if (resultat.probleme) return afficherProbleme(res, resultat.probleme);

  res.render("message", {
    titre: resultat.titre,
    texte: resultat.texte,
    liens: [{ url: "/mon-profil", texte: "Voir mon profil" }],
  });
});

// --- Changer son adresse email -------------------------------------
// Ecrit UNE SEULE FOIS pour le site et l'application.
//
// L'adresse sert a se connecter : la changer, c'est changer sa cle.
// On exige donc le mot de passe actuel, exactement comme pour le
// changement de mot de passe. Un ordinateur laisse ouvert ne suffit pas.
//
// LIMITE CONNUE : la nouvelle adresse n'est jamais verifiee, car la
// plateforme n'envoie aucun email. Ce n'est pas genant ici : l'adresse
// sert uniquement a se connecter, elle ne recoit rien. Cela le
// deviendrait le jour ou la plateforme enverrait des notifications.
function changerMonEmail(moi, saisie) {
  const nouvelEmail = String(saisie.nouveau || "").trim().toLowerCase();
  const retour = { url: "/mon-profil/modifier", texte: "Réessayer" };
  const adresseDejaUtilisee = {
    probleme: {
      code: 409,
      titre: "Adresse déjà utilisée",
      texte: "Un autre compte utilise déjà cette adresse.",
      lien: retour,
    },
  };

  if (!verifierMotDePasse(String(saisie.motdepasse || ""), moi.motdepasse)) {
    return {
      probleme: {
        code: 403,
        titre: "Mot de passe incorrect",
        texte: "Pour changer votre adresse, il faut saisir votre mot de passe actuel.",
        lien: retour,
      },
    };
  }

  if (!adresseEmailValide(nouvelEmail)) {
    return {
      probleme: {
        code: 400,
        titre: "Adresse invalide",
        texte: "Vérifiez l'adresse saisie : il manque un @ ou le nom du site.",
        lien: retour,
      },
    };
  }

  if (nouvelEmail === moi.email) {
    return {
      probleme: {
        code: 400,
        titre: "Adresse inchangée",
        texte: "C'est déjà votre adresse actuelle.",
        lien: { url: "/mon-profil", texte: "Retour à mon profil" },
      },
    };
  }

  if (requetes.utilisateurParEmail.get(nouvelEmail)) return adresseDejaUtilisee;

  try {
    requetes.majEmail.run(nouvelEmail, moi.id);
  } catch (erreur) {
    // La contrainte UNIQUE de la base est le dernier rempart, au cas ou
    // deux personnes viseraient la meme adresse au meme instant.
    if (String(erreur.message).includes("UNIQUE")) return adresseDejaUtilisee;
    throw erreur;
  }

  // La session retient l'identifiant, pas l'adresse : la personne
  // reste connectee, elle n'a rien a refaire.
  return {
    ok: true,
    email: nouvelEmail,
    titre: "Adresse modifiée",
    texte: "Votre nouvelle adresse est " + nouvelEmail +
           ". C'est désormais celle-ci qu'il faudra saisir pour vous connecter.",
  };
}

app.post("/mon-profil/email", exigerConnexion, lireFormulaire, (req, res) => {
  const resultat = changerMonEmail(req.utilisateur, req.body);
  if (resultat.probleme) return afficherProbleme(res, resultat.probleme);

  res.render("message", {
    titre: resultat.titre,
    texte: resultat.texte,
    liens: [{ url: "/mon-profil", texte: "Voir mon profil" }],
  });
});

// --- Changer son mot de passe --------------------------------------
//
// EN CONNAISSANT L'ANCIEN. C'est le chemin normal, et il ne fait
// intervenir personne d'autre.
//
// Celui qui l'a oublie passe par l'equipe : elle appelle le numero deja
// au dossier et lui lit un code a usage unique. Voir plus bas, "UN MOT
// DE PASSE OUBLIE".
const MOT_DE_PASSE_MIN = 6;
app.locals.motDePasseMin = MOT_DE_PASSE_MIN;

function changerMonMotDePasse(moi, saisie) {
  const retour = { url: "/mon-profil/modifier", texte: "Réessayer" };

  // On redemande l'ancien mot de passe : sans cela, quelqu'un qui
  // trouverait un ordinateur ouvert pourrait s'approprier le compte.
  if (!verifierMotDePasse(String(saisie.ancien || ""), moi.motdepasse)) {
    return {
      probleme: {
        code: 403,
        titre: "Mot de passe actuel incorrect",
        texte: "Pour changer votre mot de passe, il faut d'abord saisir l'ancien.",
        lien: retour,
      },
    };
  }

  const nouveau = String(saisie.nouveau || "");

  if (nouveau.length < MOT_DE_PASSE_MIN) {
    return {
      probleme: {
        code: 400,
        titre: "Mot de passe trop court",
        texte: `Choisissez un mot de passe d'au moins ${MOT_DE_PASSE_MIN} caractères.`,
        lien: retour,
      },
    };
  }

  requetes.majMotDePasse.run(hacherMotDePasse(nouveau), moi.id);

  return { ok: true, titre: "Mot de passe modifié", texte: "Votre nouveau mot de passe est actif dès maintenant." };
}

app.post("/mon-profil/mot-de-passe", exigerConnexion, lireFormulaire, (req, res) => {
  const resultat = changerMonMotDePasse(req.utilisateur, req.body);
  if (resultat.probleme) return afficherProbleme(res, resultat.probleme);

  res.render("message", {
    titre: resultat.titre,
    texte: resultat.texte,
    liens: [{ url: "/mon-profil", texte: "Voir mon profil" }],
  });
});

// --- Publier une annonce (le formulaire) ---------------------------
// REGLE METIER : un employeur ne publie pas avant que son identite ait
// ete verifiee.
//
// C'est la symetrie exacte de la regle qui empeche d'embaucher quelqu'un
// de non verifie. Une personne qui repond a une annonce se deplace chez
// un inconnu, seule, souvent tot le matin : elle a le droit de savoir
// que la plateforme a controle qui il est.
//
// A placer APRES exigerConnexion, qui remplit req.utilisateur.
// LA MEME REGLE, DEUX RAISONS. L'employeur fait venir quelqu'un chez
// lui ; la personne qui repond se deplace chez un inconnu. Chacun doit
// lire la raison qui le concerne, pas celle de l'autre. Ecrite ici pour
// que le site et l'application disent la meme.
function texteVerificationRequise(role) {
  return role === "employeur"
    ? "Avant de publier une demande, votre identité doit être vérifiée par " +
      "PamConnect. Les personnes qui vous répondront se déplaceront chez vous : " +
      "elles ont le droit de savoir qui vous êtes."
    : "Avant de répondre à une demande, votre identité doit être vérifiée par " +
      "PamConnect. Vous entrerez chez quelqu'un qui ne vous connaît pas : " +
      "il a le droit de savoir qui vient.";
}

function exigerVerification(req, res, next) {
  if (req.utilisateur.statut_verification !== "verifie") {
    const texte = texteVerificationRequise(req.utilisateur.role);

    return res.status(403).render("message", {
      titre: "Vérification requise",
      texte,
      liens: [{ url: "/verification", texte: "Faire vérifier mon identité" }],
    });
  }

  next();
}

app.get("/publier-annonce", exigerConnexion, interdireALEquipe, exigerVerification, (req, res) => {
  if (req.utilisateur.role !== "employeur") {
    return res.status(403).render("message", {
      titre: "Accès refusé",
      texte: "Seuls les employeurs peuvent publier une demande.",
      liens: [{ url: "/", texte: "Retour à l'accueil" }],
    });
  }

  // PROPOSEE A UNE PERSONNE, depuis sa fiche. Son metier remplit le
  // champ : l'employeur peut le changer.
  const invitee = lirePersonneInvitee(req.query.pour);
  if (invitee && invitee.probleme) return afficherProbleme(res, invitee.probleme);

  res.render("publier-annonce", {
    titre: "Publier une demande",
    invitee,
    annonce: invitee ? { metier: invitee.metier } : null,
  });
});

// --- Proposer une demande a une personne ---------------------------
//
// L'identifiant vient du formulaire, donc de celui qui l'envoie : on
// revérifie a chaque fois que cette personne peut recevoir la demande.
//
// Rien de demande : null. Une personne qui ne peut pas la recevoir : un
// probleme, qui ne dit pas pourquoi - la raison (suspendue, non verifiee)
// ne regarde pas l'employeur.
const PERSONNE_NON_INVITABLE = {
  code: 400,
  titre: "Proposition impossible",
  texte: "Cette personne ne peut pas recevoir de demande pour l'instant.",
  lien: { url: "/recherche", texte: "Retour à la recherche" },
};

function lirePersonneInvitee(valeur) {
  if (valeur == null || String(valeur).trim() === "") return null;
  const id = Number(valeur);
  const personne = Number.isInteger(id) && id > 0 ? requetes.personneInvitable.get(id) : null;
  return personne || { probleme: PERSONNE_NON_INVITABLE };
}

// --- Enregistrer une annonce ---------------------------------------
//
// PUBLIER EST ECRIT UNE SEULE FOIS. Le site et l'application passent par
// cette fonction : la meme verification, le meme enregistrement, la meme
// phrase de confirmation. Rien n'est paye a la publication.
function publierDemande(employeurId, donnees) {
  const probleme = verifierAnnonce(donnees);
  if (probleme) return { probleme };

  const invitee = lirePersonneInvitee(donnees.pour);
  if (invitee && invitee.probleme) return { probleme: invitee.probleme };

  const champs = Object.assign(champsAnnonce(donnees), {
    personne_invitee_id: invitee ? invitee.id : null,
  });

  // PLUS AUCUNE SOMME N'EST BLOQUEE ICI. L'employeur ne paie rien a la
  // publication : l'equipe l'appelle avec le prix, et il paie apres le
  // service.
  const id = Number(requetes.creerAnnonce.run(
    Object.assign({ employeur_id: employeurId }, champs)).lastInsertRowid);

  return {
    id,
    titre: "Demande publiée",
    texte: `Votre demande "${champs.titre}" est en ligne.` +
           (invitee ? ` ${invitee.nom} la verra en premier.` : "") +
           " L'équipe PamConnect vous rappelle avec le prix.",
  };
}

app.post("/annonces", exigerConnexion, interdireALEquipe, exigerVerification, lireFormulaire, (req, res) => {
  // Le formulaire ne s'ouvrait qu'aux employeurs, mais l'envoi ne
  // verifiait pas le role : une personne verifiee qui repond aux demandes
  // pouvait en publier une en envoyant le formulaire a la main.
  if (req.utilisateur.role !== "employeur") {
    return res.status(403).render("message", {
      titre: "Accès refusé",
      texte: "Seuls les employeurs peuvent publier une demande.",
      liens: [{ url: "/", texte: "Retour à l'accueil" }],
    });
  }

  const resultat = publierDemande(req.utilisateur.id, req.body);

  if (resultat.probleme) {
    // Le retour garde la personne a qui la demande etait proposee.
    const pour = Number(req.body.pour);
    const retour = "/publier-annonce" + (Number.isInteger(pour) && pour > 0 ? "?pour=" + pour : "");
    return res.status(400).render("message", Object.assign({}, resultat.probleme, {
      liens: [{ url: retour, texte: "Retour au formulaire" }],
    }));
  }

  res.render("message", {
    titre: resultat.titre,
    texte: resultat.texte,
    liens: [{ url: "/mes-demandes", texte: "Voir mes demandes" }],
  });
});

// --- Liste des annonces --------------------------------------------
// --- Modifier une demande ------------------------------------------
//
// Une demande publiee etait definitive : un employeur qui se trompait
// d'horaire ou de prix ne pouvait rien corriger, et sa demande erronee
// restait visible pour toujours.
//
// CES DEUX PAGES SONT CELLES DE L'EMPLOYEUR PROPRIETAIRE. La requete
// monAnnonce porte la garde : elle exige l'identifiant de l'annonce ET
// celui de son employeur. Une candidate, un autre employeur ou un membre
// de l'equipe recoivent 404 - on ne leur dit meme pas que la page existe.
function chargerMonAnnonce(req, res) {
  if (req.utilisateur.role !== "employeur") return null;

  return requetes.monAnnonce.get(Number(req.params.id), req.utilisateur.id) || null;
}

// MODIFIER, METTRE EN AVANT ET RETIRER SONT ECRITS UNE SEULE FOIS. Le
// site et l'application passent par les memes fonctions : les memes
// portes, les memes phrases.

// Une demande de l'employeur connecte, ou rien : la requete monAnnonce
// exige l'identifiant ET le proprietaire.
function maDemande(annonceId, utilisateur) {
  if (utilisateur.est_admin || utilisateur.role !== "employeur") return null;
  return requetes.monAnnonce.get(annonceId, utilisateur.id) || null;
}

const DEMANDE_INTROUVABLE = {
  code: 404,
  titre: "Demande introuvable",
  texte: "Cette demande n'existe pas, ou elle n'est pas la vôtre.",
  lien: { url: "/mes-demandes", texte: "Retour à mes demandes" },
};

// Des gens ont deja repondu : ils se sont decides sur ce qui etait ecrit.
// On ne l'interdit pas - un horaire faux doit pouvoir etre corrige - mais
// on le dit, et on rappelle qu'il faut les prevenir.
function avertissementModification(nombre) {
  if (!nombre) return null;
  const plusieurs = nombre > 1;
  return {
    phrase: `${nombre} personne${plusieurs ? "s ont" : " a"} déjà répondu à cette demande. ` +
            `Elle${plusieurs ? "s se sont décidées" : " s'est décidée"} sur ce qui est écrit aujourd'hui.`,
    conseil: `Si vous changez l'horaire ou le lieu, prévenez-${plusieurs ? "les" : "la"} ` +
             "dans la discussion : la plateforme ne le fait pas à votre place.",
  };
}

function demandeAModifier(annonceId, utilisateur) {
  const annonce = maDemande(annonceId, utilisateur);
  if (!annonce) return { probleme: DEMANDE_INTROUVABLE };

  // UNE DEMANDE FERMEE NE SE MODIFIE PLUS. Le bouton etait cache, mais
  // l'adresse restait ouverte : apres avoir choisi quelqu'un, changer la
  // demande changeait ce que cette personne avait accepte de faire.
  if (annonce.annulee) {
    return {
      annonce,
      probleme: {
        code: 409,
        titre: "Cette demande est fermée",
        texte: "Une demande retirée ou pourvue ne se modifie plus.",
        lien: DEMANDE_INTROUVABLE.lien,
      },
    };
  }

  return { annonce, avertissement: avertissementModification(requetes.nombreCandidatures.get(annonce.id).n) };
}

function modifierDemande(annonceId, utilisateur, donnees) {
  const demande = demandeAModifier(annonceId, utilisateur);
  if (demande.probleme) return demande;

  const { annonce } = demande;

  // Les memes regles qu'a la publication, appelees au meme endroit :
  // ce que l'un refuse, l'autre le refuse aussi.
  const probleme = verifierAnnonce(donnees);
  if (probleme) {
    return {
      annonce,
      probleme: Object.assign({
        code: 400,
        lien: { url: `/annonces/${annonce.id}/modifier`, texte: "Retour au formulaire" },
      }, probleme),
    };
  }

  const champs = champsAnnonce(donnees);

  requetes.majAnnonce.run(Object.assign({ id: annonce.id }, champs));

  return {
    annonce,
    ok: true,
    titre: "Demande mise à jour",
    texte: "Les personnes qui consultent vos demandes voient la nouvelle version.",
  };
}

app.get("/annonces/:id/modifier", exigerConnexion, interdireALEquipe, (req, res) => {
  const demande = demandeAModifier(Number(req.params.id), req.utilisateur);
  if (demande.probleme) return afficherProbleme(res, demande.probleme);

  res.render("modifier-annonce", {
    titre: "Modifier ma demande",
    annonce: demande.annonce,
    avertissement: demande.avertissement,
  });
});

app.post("/annonces/:id/modifier", exigerConnexion, interdireALEquipe, lireFormulaire, (req, res) => {
  const resultat = modifierDemande(Number(req.params.id), req.utilisateur, req.body);
  if (resultat.probleme) return afficherProbleme(res, resultat.probleme);

  res.render("message", {
    titre: resultat.titre,
    texte: resultat.texte,
    liens: [{ url: "/mes-demandes", texte: "Retour à mes demandes" }],
  });
});

// --- Mettre une demande en avant -----------------------------------
//
// CE QUE LA MISE EN AVANT N'EST PAS. Elle ne fait pas passer devant les
// demandes d'un autre metier : une aide-menagere voit d'abord les
// demandes de menage, et c'est parmi celles-la que la mise en avant
// joue. On ne paie pas pour tromper quelqu'un sur ce qu'il cherche.
//
// C'est la meme regle que du cote des personnes qui proposent leurs
// services : aucune ne peut payer pour apparaitre en tete d'une
// recherche.
const DEMANDE_FERMEE_POUR_LA_METTRE_EN_AVANT = {
  code: 409,
  titre: "Cette demande est fermée",
  texte: "Une demande retirée ou déjà pourvue ne peut pas être mise en avant.",
  lien: DEMANDE_INTROUVABLE.lien,
};

function ecranDeMiseEnAvant(annonceId, utilisateur) {
  const annonce = maDemande(annonceId, utilisateur);
  if (!annonce) return { probleme: DEMANDE_INTROUVABLE };
  if (annonce.annulee) return { annonce, probleme: DEMANDE_FERMEE_POUR_LA_METTRE_EN_AVANT };

  mettreAJourLesJetons(utilisateur);

  return {
    annonce,
    cout: parametreNombre("cout_mise_en_avant"),
    jours: parametreNombre("duree_mise_en_avant_jours"),
    solde: soldeJetonsDe(utilisateur.id).total,
    finActuelle: annonce.enAvant ? dateLisible(annonce.mise_en_avant_jusqu_au) : null,
  };
}

function mettreEnAvantDemande(annonceId, utilisateur) {
  const annonce = maDemande(annonceId, utilisateur);
  if (!annonce) return { probleme: DEMANDE_INTROUVABLE };
  if (annonce.annulee) return { annonce, probleme: DEMANDE_FERMEE_POUR_LA_METTRE_EN_AVANT };

  const retour = DEMANDE_INTROUVABLE.lien;
  const versJetons = { url: "/mes-jetons", texte: "Voir mes jetons" };

  // DEJA EN AVANT : on refuse au lieu de prolonger. Prolonger
  // silencieusement ferait payer deux fois quelqu'un qui a clique deux
  // fois, et il n'aurait aucun moyen de s'en apercevoir.
  if (annonce.enAvant) {
    return {
      annonce,
      probleme: {
        code: 409,
        titre: "Cette demande est déjà en avant",
        texte: `Elle le reste jusqu'au ${dateLisible(annonce.mise_en_avant_jusqu_au)}. ` +
               `Vous pourrez la remettre en avant après cette date.`,
        lien: retour,
      },
    };
  }

  mettreAJourLesJetons(utilisateur);

  const cout = parametreNombre("cout_mise_en_avant");
  const jours = parametreNombre("duree_mise_en_avant_jours");

  if (!cout || !jours) {
    return {
      annonce,
      probleme: {
        code: 503,
        titre: "Option indisponible",
        texte: "Le prix de la mise en avant n'a pas encore été réglé par l'équipe.",
        lien: retour,
      },
    };
  }

  const solde = soldeJetonsDe(utilisateur.id);

  if (solde.total < cout) {
    return {
      annonce,
      probleme: {
        code: 402,
        titre: "Il vous manque des jetons",
        texte: `Mettre une demande en avant coûte ${jetonsEnClair(cout)}. ` +
               `Il vous reste ${jetonsEnClair(solde.total)}.`,
        lien: versJetons,
      },
    };
  }

  // LES DEUX ECRITURES SONT INDIVISIBLES. Une demande mise en avant
  // sans jeton preleve serait gratuite ; un jeton preleve sans mise en
  // avant serait un vol.
  const poser = db.transaction(() => {
    if (!depenserJetons(utilisateur, cout, "mise_en_avant",
          `Mise en avant : ${annonce.titre}`, annonce.id)) {
      return false;
    }

    const fait = requetes.mettreEnAvant.run({
      id: annonce.id,
      employeur: utilisateur.id,
      duree: `+${Math.round(jours)} days`,
    });

    // La demande a ete fermee entre-temps : on annule tout.
    if (fait.changes === 0) throw new Error("DEMANDE_FERMEE");

    return true;
  });

  let pose;
  try {
    pose = poser();
  } catch (erreur) {
    if (String(erreur.message) === "DEMANDE_FERMEE") {
      return {
        annonce,
        probleme: {
          code: 409,
          titre: "Cette demande est fermée",
          texte: "Elle a été fermée entre-temps. Aucun jeton n'a été prélevé.",
          lien: retour,
        },
      };
    }
    throw erreur;
  }

  if (!pose) {
    return {
      annonce,
      probleme: {
        code: 402,
        titre: "Il vous manque des jetons",
        texte: `Mettre une demande en avant coûte ${jetonsEnClair(cout)}.`,
        lien: versJetons,
      },
    };
  }

  const apres = requetes.monAnnonce.get(annonce.id, utilisateur.id);

  return {
    annonce,
    ok: true,
    titre: "Votre demande est mise en avant",
    texte: `Elle passe devant les autres demandes de ${annonce.metier} ` +
           `jusqu'au ${dateLisible(apres.mise_en_avant_jusqu_au)}, et porte le badge ` +
           `« Mise en avant ». ${jetonsEnClair(cout)} a été prélevé. ` +
           `Après cette date, elle reprend sa place sans que vous ayez rien à faire.`,
  };
}

// LA MISE EN AVANT D'UN PROFIL.
//
// ELLE NE TOUCHE PAS LA RECHERCHE DES EMPLOYEURS. Personne ne paie pour
// passer devant quelqu'un de mieux note : le classement d'une recherche
// reste celui du merite, et c'etait deja la regle.
//
// Ce que les jetons achetent, c'est d'etre APPELE PLUS TOT par l'equipe :
// quand une demande de ce metier arrive, le profil en avant est en tete
// de sa liste d'appels.
const PROFIL_A_VERIFIER_POUR_LA_MISE_EN_AVANT = {
  code: 409,
  titre: "Votre identité n'est pas encore vérifiée",
  texte: "L'équipe n'appelle que des personnes vérifiées : mettre votre profil " +
         "en avant avant cela ne changerait rien.",
  lien: { url: "/mon-profil", texte: "Retour à mon profil" },
};

function ecranMiseEnAvantProfil(utilisateur) {
  if (utilisateur.role !== "prestataire") {
    return { probleme: { code: 403, titre: "Réservé aux personnes qui proposent leurs services",
      texte: "Un employeur met ses demandes en avant, pas son profil.",
      lien: { url: "/mes-demandes", texte: "Retour à mes demandes" } } };
  }

  if (utilisateur.statut_verification !== "verifie") {
    return { probleme: PROFIL_A_VERIFIER_POUR_LA_MISE_EN_AVANT };
  }

  mettreAJourLesJetons(utilisateur);

  const etat = requetes.monProfilEnAvant.get(utilisateur.id);

  return {
    cout: parametreNombre("cout_mise_en_avant"),
    jours: parametreNombre("duree_mise_en_avant_jours"),
    solde: soldeJetonsDe(utilisateur.id).total,
    finActuelle: etat && etat.enAvant ? dateLisible(etat.mise_en_avant_jusqu_au) : null,
  };
}

function mettreEnAvantMonProfil(utilisateur) {
  const ecran = ecranMiseEnAvantProfil(utilisateur);
  if (ecran.probleme) return { probleme: ecran.probleme };

  const retour = { url: "/mon-profil", texte: "Retour à mon profil" };
  const versJetons = { url: "/mes-jetons", texte: "Voir mes jetons" };

  // DEJA EN AVANT : on refuse au lieu de prolonger. Prolonger
  // silencieusement ferait payer deux fois quelqu'un qui a clique deux
  // fois, sans qu'il puisse s'en apercevoir.
  if (ecran.finActuelle) {
    return { probleme: { code: 409, titre: "Votre profil est déjà en avant",
      texte: `Il le reste jusqu'au ${ecran.finActuelle}. Vous pourrez le remettre ` +
             "en avant après cette date.",
      lien: retour } };
  }

  if (!ecran.cout || !ecran.jours) {
    return { probleme: { code: 503, titre: "Option indisponible",
      texte: "Le prix de la mise en avant n'a pas encore été réglé par l'équipe.",
      lien: retour } };
  }

  if (ecran.solde < ecran.cout) {
    return { probleme: { code: 402, titre: "Il vous manque des jetons",
      texte: `Mettre votre profil en avant coûte ${jetonsEnClair(ecran.cout)}. ` +
             `Il vous reste ${jetonsEnClair(ecran.solde)}.`,
      lien: versJetons } };
  }

  // LES DEUX ECRITURES SONT INDIVISIBLES : un profil mis en avant sans
  // jeton preleve serait gratuit, un jeton preleve sans mise en avant
  // serait un vol.
  const poser = db.transaction(() => {
    if (!depenserJetons(utilisateur, ecran.cout, "mise_en_avant",
          "Mise en avant de mon profil")) {
      return false;
    }

    return requetes.mettreEnAvantProfil.run({
      id: utilisateur.id,
      duree: `+${Math.round(ecran.jours)} days`,
    }).changes > 0;
  });

  if (!poser()) {
    return { probleme: { code: 402, titre: "Il vous manque des jetons",
      texte: `Mettre votre profil en avant coûte ${jetonsEnClair(ecran.cout)}.`,
      lien: versJetons } };
  }

  const apres = requetes.monProfilEnAvant.get(utilisateur.id);

  return {
    ok: true,
    titre: "Votre profil est mis en avant",
    texte: `L'équipe vous appelle en premier pour les demandes de votre métier ` +
           `jusqu'au ${dateLisible(apres.mise_en_avant_jusqu_au)}. ` +
           `${jetonsEnClair(ecran.cout)} a été prélevé. Votre place dans la ` +
           `recherche des employeurs, elle, ne change pas : elle dépend de vos avis.`,
  };
}

app.get("/mon-profil/mise-en-avant", exigerConnexion, interdireALEquipe, (req, res) => {
  const ecran = ecranMiseEnAvantProfil(req.utilisateur);
  if (ecran.probleme) return afficherProbleme(res, ecran.probleme);

  res.render("mettre-profil-en-avant", Object.assign(
    { titre: "Mettre mon profil en avant" }, ecran));
});

app.post("/mon-profil/mise-en-avant", exigerConnexion, interdireALEquipe, lireFormulaire, (req, res) => {
  const resultat = mettreEnAvantMonProfil(req.utilisateur);
  if (resultat.probleme) return afficherProbleme(res, resultat.probleme);

  res.render("message", {
    titre: resultat.titre,
    texte: resultat.texte,
    liens: [{ url: "/mon-profil", texte: "Retour à mon profil" }],
  });
});

app.get("/annonces/:id/mettre-en-avant", exigerConnexion, interdireALEquipe, (req, res) => {
  const ecran = ecranDeMiseEnAvant(Number(req.params.id), req.utilisateur);
  if (ecran.probleme) return afficherProbleme(res, ecran.probleme);

  res.render("mettre-en-avant", {
    titre: "Mettre cette demande en avant",
    annonce: ecran.annonce,
    cout: ecran.cout,
    jours: ecran.jours,
    solde: ecran.solde,
    finActuelle: ecran.finActuelle,
    erreur: null,
  });
});

app.post("/annonces/:id/mettre-en-avant", exigerConnexion, interdireALEquipe, lireFormulaire, (req, res) => {
  const resultat = mettreEnAvantDemande(Number(req.params.id), req.utilisateur);
  if (resultat.probleme) return afficherProbleme(res, resultat.probleme);

  res.render("message", {
    titre: resultat.titre,
    texte: resultat.texte,
    liens: [
      { url: "/annonces", texte: "Voir la liste des demandes" },
      { url: "/mes-demandes", texte: "Retour à mes demandes" },
    ],
  });
});

// --- Retirer une demande -------------------------------------------
//
// On ne SUPPRIME pas. Une demande retiree disparait de la liste publique
// et n'accepte plus de reponse, mais elle reste sur le profil de son
// employeur, et les candidatures et discussions qu'elle porte subsistent.
//
// Supprimer effacerait des conversations que des gens ont reellement
// eues, et la trace de ce qui avait ete convenu. Une personne qui a
// discute pendant une semaine ne doit pas voir l'echange disparaitre
// parce que l'autre a change d'avis.
function retirerDemande(annonceId, utilisateur) {
  const annonce = maDemande(annonceId, utilisateur);
  if (!annonce) return { probleme: DEMANDE_INTROUVABLE };

  // ON NE RETIRE PAS UNE DEMANDE APRES AVOIR CHOISI : la personne choisie
  // travaillerait pour rien, et l'equipe l'a peut-etre deja appelee.
  if (requetes.annonceEstPourvue.get(annonce.id)) {
    return {
      annonce,
      probleme: {
        code: 409,
        titre: "Vous avez déjà choisi quelqu'un",
        texte: "Cette demande ne peut plus être retirée : vous avez retenu une " +
               "personne pour ce service. Si le service n'a pas eu lieu, signalez " +
               "le problème à l'équipe plutôt que de retirer la demande.",
        lien: DEMANDE_INTROUVABLE.lien,
      },
    };
  }

  if (annonce.annulee) {
    return {
      annonce,
      probleme: {
        code: 409,
        titre: "Demande déjà retirée",
        texte: "Cette demande est déjà retirée : elle n'apparaît plus dans la liste.",
        lien: DEMANDE_INTROUVABLE.lien,
      },
    };
  }

  requetes.annulerAnnonce.run({ id: annonce.id });

  return {
    annonce,
    ok: true,
    titre: "Demande retirée",
    texte: "Votre demande n'apparaît plus dans la liste et personne ne peut " +
           "plus y répondre. Les personnes qui vous avaient déjà répondu gardent " +
           "accès à votre discussion.",
  };
}

app.post("/annonces/:id/annuler", exigerConnexion, interdireALEquipe, lireFormulaire, (req, res) => {
  const resultat = retirerDemande(Number(req.params.id), req.utilisateur);
  if (resultat.probleme) return afficherProbleme(res, resultat.probleme);

  res.render("message", {
    titre: resultat.titre,
    texte: resultat.texte,
    liens: [{ url: "/mes-demandes", texte: "Retour à mes demandes" }],
  });
});

// LES DEMANDES RANGEES, UNE SEULE FOIS pour le site et l'application.
function demandesRangees(utilisateur) {
  const toutes = requetes.toutesLesAnnonces.all();
  const quiRepond = utilisateur && utilisateur.role === "prestataire" ? utilisateur : null;

  // D'abord celles qu'un employeur a publiees POUR cette personne : il est
  // venu la chercher, elle doit les voir avant tout le reste.
  const proposees = quiRepond ? toutes.filter((a) => a.personne_invitee_id === quiRepond.id) : [];
  const reste = toutes.filter((a) => !proposees.includes(a));

  // Les demandes qui correspondent au metier de la personne passent
  // devant. Elles ne sont pas les seules montrees : masquer les autres
  // enfermerait quelqu'un dans un metier, alors qu'une aide-menagere
  // peut tres bien repondre a une demande de garde d'enfants.
  //
  // Ce tri n'est possible que depuis que le metier est une valeur de
  // notre liste : tant que c'etait un texte libre, "menage" et
  // "menagere" ne se rencontraient jamais.
  const monMetier = quiRepond ? quiRepond.metier : null;

  return {
    proposees,
    pourMoi: monMetier ? reste.filter((a) => a.metier === monMetier) : [],
    autres: monMetier ? reste.filter((a) => a.metier !== monMetier) : reste,
    monMetier,
  };
}

app.get("/annonces", (req, res) => {
  res.render("annonces", Object.assign({ titre: "Demandes" }, demandesRangees(utilisateurConnecte(req))));
});

// --- Postuler a une annonce ----------------------------------------
// --- Repondre a une annonce : l'ecran de confirmation ---------------
//
// La transparence sur ce qu'on touchera est due AVANT de s'engager. Elle
// etait affichee en haut de la liste des annonces : le meme calcul,
// identique pour toutes les demandes, donc inutile pour choisir - et il
// occupait le tiers de l'ecran.
//
// Elle est desormais ici : au moment de repondre, et pour CETTE demande.
// On y voit le prix annonce et ce qu'il restera apres la commission.
// Une demande retiree n'accepte plus de reponse. La verification est
// faite ici ET a l'enregistrement : l'ecran ne protege rien tout seul.
function annonceFermee(annonce) {
  return Boolean(annonce && annonce.annulee);
}

// Ce qu'on dit a quelqu'un qui arrive sur une demande fermee. "Retiree"
// et "pourvue" ne s'annoncent pas de la meme facon : dire a une personne
// qui vient d'etre choisie que l'employeur a retire sa demande est le
// contraire de la verite.
function ecranDemandeFermee(annonceId) {
  const pourvue = requetes.annonceEstPourvue.get(annonceId);

  // Deux corrections dans ces phrases.
  //
  // "Elle n'accepte plus de reponse" : ce "Elle" pouvait designer la
  // demande OU la personne citee juste avant. On lisait spontanement que
  // c'etait ELLE qui fermait sa porte, ce qui n'est pas ce qui se passe.
  //
  // Et la phrase n'apprenait rien : si la demande est retiree, qu'elle
  // n'accepte plus de reponse va de soi. Elle parle desormais de CELUI
  // QUI LIT - ce qu'il peut ou ne peut plus faire, la seule chose qui
  // l'interesse a cet instant.
  return pourvue
    ? {
        titre: "Quelqu'un a déjà été choisi",
        texte: "L'employeur a retenu une autre personne. " +
               "Vous ne pouvez plus répondre à cette demande.",
        liens: [{ url: "/annonces", texte: "Voir les autres demandes" }],
      }
    : {
        titre: "Demande retirée",
        texte: "L'employeur a retiré cette demande. " +
               "Vous ne pouvez plus y répondre.",
        liens: [{ url: "/annonces", texte: "Voir les autres demandes" }],
      };
}

// --- Repondre a une demande, UNE SEULE FOIS pour le site et l'application --

// Qui peut repondre : une personne qui propose ses services, et dont
// l'identite est verifiee. Le site passe aussi par exigerVerification ; ce
// controle-ci garde l'application, qui n'a pas ce portier.
function refusDeRepondre(u) {
  if (u.role !== "prestataire" || u.est_admin) {
    return {
      code: 403,
      titre: "Accès refusé",
      texte: "Seules les personnes qui proposent leurs services peuvent répondre à une demande.",
      lien: { url: "/annonces", texte: "Retour aux demandes" },
    };
  }
  if (u.statut_verification !== "verifie") {
    return {
      code: 403,
      titre: "Vérification requise",
      texte: texteVerificationRequise(u.role),
      lien: { url: "/verification", texte: "Faire vérifier mon identité" },
    };
  }
  return null;
}

const DEMANDE_DISPARUE = {
  code: 404,
  titre: "Demande introuvable",
  texte: "Cette demande n'existe plus.",
  lien: { url: "/annonces", texte: "Retour aux demandes" },
};

function problemeDemandeFermee(annonceId) {
  const ecran = ecranDemandeFermee(annonceId);
  return { code: 410, titre: ecran.titre, texte: ecran.texte, lien: ecran.liens[0] };
}

// CE QUE CETTE REPONSE VA COUTER, avant de s'engager. La meme regle que
// pour la commission : on ne decouvre pas le prix apres.
function ecranPourRepondre(u, annonceId) {
  const refus = refusDeRepondre(u);
  if (refus) return { probleme: refus };

  const annonce = requetes.annonceParId.get(annonceId);
  if (!annonce) return { probleme: DEMANDE_DISPARUE };

  // La demande a ete retiree par son employeur. Elle n'apparait plus dans
  // la liste, mais quelqu'un peut avoir garde l'adresse ouverte.
  if (annonceFermee(annonce)) return { probleme: problemeDemandeFermee(annonce.id) };

  mettreAJourLesJetons(u);

  const proposee = reponseSurProposition(annonce, u);
  const limite = proposee ? null : parametreNombre("candidatures_par_jour");
  const envoyees = requetes.candidaturesRecentes.get(u.id).n;

  return {
    annonce,
    reputationEmployeur: reputationDe(annonce.employeur_id),
    proposee,
    // PLUS AUCUN JETON POUR REPONDRE : dire qu'un service vous interesse
    // est gratuit. Les jetons ne servent plus qu'a la mise en avant.
    cout: null,
    solde: soldeJetonsDe(u.id).total,
    limite,
    restantAujourdhui: limite === null ? null : Math.max(0, limite - envoyees),
  };
}

// UNE DEMANDE PROPOSEE A CETTE PERSONNE : sa premiere reponse ne coute
// pas de jeton et ne compte pas dans la limite du jour. L'employeur est
// venu la chercher, elle n'a pas a payer pour lui dire oui.
//
// UNE REPONSE REFUSEE PUIS RENVOYEE redevient un envoi ordinaire : sans
// cela, un refus pourrait etre suivi de renvois gratuits sans fin.
function reponseSurProposition(annonce, u) {
  return annonce.personne_invitee_id === u.id &&
    !requetes.maCandidaturePour.get(annonce.id, u.id);
}

function envoyerReponse(u, annonceId) {
  const refus = refusDeRepondre(u);
  if (refus) return { probleme: refus };

  const annonce = requetes.annonceParId.get(annonceId);
  if (!annonce) return { probleme: DEMANDE_DISPARUE };

  // Une reponse precedente existe peut-etre. Trois cas, trois suites
  // differentes.
  //
  // Ce controle passe AVANT celui de la fermeture : accepter quelqu'un
  // ferme la demande, et la personne choisie serait sinon renvoyee vers
  // un ecran qui ne la concerne pas.
  const deja = requetes.maCandidaturePour.get(annonce.id, u.id);
  const proposee = reponseSurProposition(annonce, u);

  if (deja && deja.statut === "acceptee") {
    return {
      probleme: {
        code: 409,
        titre: "Vous avez déjà été choisie",
        texte: "L'employeur vous a retenue pour cette demande.",
        lien: { url: "/messages/" + deja.id, texte: "Ouvrir la discussion" },
      },
    };
  }

  if (annonceFermee(annonce)) return { probleme: problemeDemandeFermee(annonce.id) };

  if (deja && deja.statut === "en attente") {
    return {
      probleme: {
        code: 409,
        titre: "Candidature déjà envoyée",
        texte: "Vous avez déjà répondu à cette demande. Elle attend la décision " +
               "de l'employeur.",
        lien: { url: "/mes-reponses", texte: "Voir mes candidatures" },
      },
    };
  }

  // ------------------------------------------------------------------
  // A PARTIR D'ICI, LA REPONSE VA PARTIR. Les controles precedents
  // renvoyaient quelqu'un qui n'avait rien a envoyer ; ceux-ci decident
  // si l'envoi est possible, et ils coutent un jeton.
  // ------------------------------------------------------------------

  // Les jetons offerts arrivent ou expirent ici aussi : quelqu'un peut
  // repondre sans jamais avoir ouvert sa page de jetons.
  mettreAJourLesJetons(u);

  // LA LIMITE DU JOUR PASSE AVANT LE SOLDE. Une personne qui a beaucoup
  // de jetons doit lire qu'elle a atteint la limite, pas qu'elle peut
  // payer - sinon la limite ressemble a un probleme d'argent.
  const limite = proposee ? null : parametreNombre("candidatures_par_jour");
  const envoyees = requetes.candidaturesRecentes.get(u.id).n;

  if (limite !== null && envoyees >= limite) {
    const quand = requetes.prochaineReponsePossible.get(u.id);
    const heures = heuresAvant(quand && quand.quand);

    return {
      probleme: {
        code: 429,
        titre: "Vous avez atteint la limite du jour",
        texte: `Vous pouvez envoyer ${limite} réponses par tranche de 24 heures. ` +
               `Cette limite protège les employeurs : elle évite qu'une même ` +
               `personne réponde à tout sans avoir regardé.` +
               (heures ? ` Vous pourrez répondre à nouveau dans ${heures} heure${heures > 1 ? "s" : ""}.` : ""),
        lien: { url: "/annonces", texte: "Revenir aux demandes" },
      },
    };
  }

  const cout = null;
  const solde = soldeJetonsDe(u.id);
  const manqueDeJetons = (avecReste) => ({
    probleme: {
      code: 402,
      titre: "Il vous manque des jetons",
      texte: `Répondre à une demande coûte ${jetonsEnClair(cout)}.` +
             (avecReste ? ` Il vous reste ${jetonsEnClair(solde.total)}.` : ""),
      lien: { url: "/mes-jetons", texte: "Voir mes jetons" },
    },
  });

  if (cout !== null && solde.total < cout) return manqueDeJetons(true);

  const detail = `Réponse à la demande : ${annonce.titre}`;

  // RENVOYER UNE REPONSE REFUSEE est un nouvel envoi : il coute autant
  // que le premier, et compte dans la limite du jour. Sans cela, un
  // refus pourrait etre suivi de renvois sans fin, gratuitement.
  if (deja && deja.statut === "refusee") {
    // La demande est encore ouverte - la condition annonceFermee est
    // passee plus haut. Refuser quelqu'un ne ferme pas la demande aux
    // autres : rien ne justifiait de la fermer a elle pour toujours.
    const renvoyer = db.transaction(() => {
      if (cout && !depenserJetons(u, cout, "candidature", detail, annonce.id)) {
        return false;
      }
      requetes.rouvrirCandidature.run({ id: deja.id });
      requetes.marquerEnvoyee.run(deja.id);
      return true;
    });

    if (!renvoyer()) return manqueDeJetons(false);

    return {
      ok: true,
      candidatureId: deja.id,
      titre: "Candidature renvoyée",
      texte: "Votre réponse a été renvoyée à cet employeur. Votre discussion " +
             "précédente est conservée." +
             (cout ? ` ${jetonsEnClair(cout)} a été prélevé.` : ""),
      liens: [{ url: "/messages/" + deja.id, texte: "Ouvrir la discussion" }],
    };
  }

  // LE JETON N'EST PRELEVE QUE SI LA REPONSE PART. La creation et le
  // prelevement sont indivisibles : une reponse enregistree sans jeton
  // preleve serait gratuite, un jeton preleve sans reponse serait un vol.
  let candidatureId;
  try {
    const envoyer = db.transaction(() => {
      const creee = requetes.creerCandidature.run(annonce.id, u.id);

      if (cout && !depenserJetons(u, cout, "candidature", detail, annonce.id)) {
        // La transaction sera annulee par l'exception : la candidature
        // qui vient d'etre creee disparait avec elle.
        throw new Error("SOLDE_INSUFFISANT");
      }

      return creee;
    });

    candidatureId = Number(envoyer().lastInsertRowid);
  } catch (erreur) {
    if (String(erreur.message) === "SOLDE_INSUFFISANT") return manqueDeJetons(false);

    // La contrainte UNIQUE reste le dernier rempart : deux envois
    // simultanes passeraient tous deux le controle ci-dessus.
    if (String(erreur.message).includes("UNIQUE")) {
      return {
        probleme: {
          code: 409,
          titre: "Candidature déjà envoyée",
          texte: "Vous avez déjà répondu à cette demande.",
          lien: { url: "/mes-reponses", texte: "Voir mes candidatures" },
        },
      };
    }

    throw erreur;
  }

  const reste = soldeJetonsDe(u.id).total;

  return {
    ok: true,
    candidatureId,
    titre: "Réponse envoyée",
    texte: "Votre réponse a bien été enregistrée." +
           (cout ? ` ${jetonsEnClair(cout)} a été prélevé. Il vous reste ${jetonsEnClair(reste)}.` : ""),
    liens: [
      { url: "/annonces", texte: "Retour aux demandes" },
      { url: "/mes-jetons", texte: "Voir mes jetons" },
    ],
  };
}

app.get("/candidatures/nouvelle/:annonceId", exigerConnexion, exigerVerification, (req, res) => {
  const ecran = ecranPourRepondre(req.utilisateur, Number(req.params.annonceId));
  if (ecran.probleme) return afficherProbleme(res, ecran.probleme);

  res.render("repondre", {
    reputationEmployeur: ecran.reputationEmployeur,
    titre: "Répondre à cette demande",
    annonce: ecran.annonce,
    proposee: ecran.proposee,
    cout: ecran.cout,
    solde: ecran.solde,
    restantAujourdhui: ecran.restantAujourdhui,
    limite: ecran.limite,
  });
});

app.post("/candidatures", exigerConnexion, exigerVerification, lireFormulaire, (req, res) => {
  const resultat = envoyerReponse(req.utilisateur, Number(req.body.annonceId));
  if (resultat.probleme) return afficherProbleme(res, resultat.probleme);

  res.render("message", { titre: resultat.titre, texte: resultat.texte, liens: resultat.liens });
});

// --- Accepter ou refuser une candidature ---------------------------
// --- Confirmer avant d'embaucher -----------------------------------
//
// Accepter une candidature engageait jusqu'ici d'un seul clic, sans que
// l'employeur relise ce sur quoi il s'engage : le service, le lieu,
// l'horaire et la duree. Le prix, lui, lui est annonce par l'equipe.
//
// CET ECRAN EST CELUI DE L'EMPLOYEUR. La requete n'accepte que
// l'employeur PROPRIETAIRE de l'annonce : une candidate qui taperait
// l'adresse a la main recoit 404, meme sur sa propre candidature. Elle
// n'a rien a faire ici - la decision ne lui appartient pas.
//
// Refuser, en revanche, reste immediat : on ne s'engage a rien en
// refusant, et faire confirmer un refus ne protegerait personne.
//
// CONFIRMER ET DECIDER SONT ECRITS UNE SEULE FOIS. Le site et
// l'application passent par les memes fonctions : les memes portes, les
// memes consequences, les memes phrases.

const TEXTE_IDENTITE_NON_VERIFIEE =
  "L'identité de cette personne n'a pas encore été vérifiée par PamConnect. " +
  "Vous pourrez la choisir dès que son dossier sera validé.";

// Les portes d'une decision, dans l'ordre ou elles comptent. Renvoie null
// si la decision peut etre prise.
function problemeDeDecision(candidature, statut) {
  if (!candidature) {
    return {
      code: 404,
      titre: "Candidature introuvable",
      texte: "Cette candidature n'existe pas, ou elle ne concerne aucune de vos demandes.",
    };
  }

  // UNE DECISION NE SE REPREND PAS. L'ecran de confirmation le verifiait
  // deja, mais pas l'envoi : un employeur pouvait choisir une deuxieme
  // personne, ou refuser apres coup celle qu'il avait choisie.
  if (candidature.statut !== "en attente") {
    return {
      code: 409,
      titre: "Décision déjà prise",
      texte: "Cette candidature a déjà reçu une réponse.",
    };
  }

  // Retirer une demande laisse ses reponses en attente : choisir quelqu'un
  // ensuite l'engagerait sur une demande qui n'existe plus.
  if (candidature.demandeFermee) {
    return {
      code: 409,
      titre: "Demande retirée",
      texte: "Vous avez retiré cette demande : elle n'attend plus de décision. " +
             "Les personnes qui vous avaient répondu gardent accès à la discussion.",
    };
  }

  // REGLE METIER : on n'engage personne dont l'identite n'a pas ete verifiee.
  // C'est la promesse centrale de PamConnect ; elle est appliquee ICI,
  // cote serveur, et pas seulement en cachant un bouton dans la page.
  if (statut === "acceptee" && candidature.verificationPrestataire !== "verifie") {
    return { code: 403, titre: "Vérification requise", texte: TEXTE_IDENTITE_NON_VERIFIEE };
  }

  return null;
}

// Ce que l'employeur relit avant de s'engager.
function confirmationDuChoix(employeurId, candidatureId) {
  const c = requetes.candidatureAConfirmer.get(candidatureId, employeurId);
  const probleme = problemeDeDecision(c, "acceptee");
  if (probleme) return { probleme };

  // On dit AVANT ce qui va se passer : la demande sera retiree, et les
  // autres personnes recevront un refus. Une consequence decouverte
  // apres coup est une mauvaise surprise.
  const autres = requetes.autresEnAttente.get({ annonce: c.annonceId, choisie: c.id }).n;

  // LE MOMENT DE LA DECISION : sa note doit etre sur cet ecran, pas a
  // un clic de la.
  const saReputation = reputationDe(c.prestataireId);

  return {
    c,
    autres,
    // Le nombre a part, pour qu'on puisse l'ecrire en gras.
    refusAnnonces: autres > 0
      ? {
          nombre: autres,
          suite: autres > 1
            ? "autres personnes qui attendaient recevront un refus."
            : "autre personne qui attendait recevra un refus.",
        }
      : null,
    reputation: {
      nombre: saReputation.nombre,
      moyenne: saReputation.moyenne,
      services: requetes.reputationEtExperience.get({ personne: c.prestataireId }).services,
    },
  };
}

function deciderCandidature(employeurId, candidatureId, statut) {
  if (statut !== "acceptee" && statut !== "refusee") {
    return {
      probleme: {
        code: 400,
        titre: "Décision inconnue",
        texte: "Une candidature ne peut qu'être acceptée ou refusée.",
      },
    };
  }

  // Une seule requete verifie que la candidature existe, que l'annonce
  // appartient bien a la personne connectee, et ramene ce qu'il faut pour
  // decider.
  const candidature = requetes.candidatureDeMonAnnonce.get(candidatureId, employeurId);
  const probleme = problemeDeDecision(candidature, statut);
  if (probleme) return { probleme };

  // Choisir quelqu'un POURVOIT la demande. Deux consequences, et elles
  // protegent les memes personnes :
  //
  //   - la demande quitte la liste publique : sans cela, d'autres
  //     continueraient de repondre a une place deja prise ;
  //   - les candidatures encore en attente sont refusees : les laisser
  //     patienter reviendrait a leur voler du temps, alors qu'elles
  //     pourraient repondre ailleurs.
  //
  // TOUT OU RIEN : une personne choisie sur une demande restee ouverte
  // serait exactement le desordre que ces deux consequences evitent.
  db.transaction(() => {
    requetes.changerStatutCandidature.run(statut, candidature.id);
    if (statut === "acceptee") {
      requetes.refuserLesAutres.run({ annonce: candidature.annonceId, choisie: candidature.id });
      requetes.annulerAnnonce.run({ id: candidature.annonceId });
    }
  })();

  return { ok: true };
}

app.get("/candidatures/:id/confirmer", exigerConnexion, (req, res) => {
  const ecran = confirmationDuChoix(req.utilisateur.id, Number(req.params.id));

  if (ecran.probleme) {
    return res.status(ecran.probleme.code).render("message", {
      titre: ecran.probleme.titre,
      texte: ecran.probleme.texte,
      liens: [{ url: "/mes-demandes", texte: "Retour à mes demandes" }],
    });
  }

  res.render("confirmer-embauche", Object.assign({ titre: "Confirmer votre choix" }, ecran));
});

app.post("/candidatures/statut", exigerConnexion, lireFormulaire, (req, res) => {
  const resultat = deciderCandidature(
    req.utilisateur.id, Number(req.body.candidatureId), req.body.statut);

  if (resultat.probleme) {
    return res.status(resultat.probleme.code).render("message", {
      titre: resultat.probleme.titre,
      texte: resultat.probleme.texte,
      liens: [{ url: "/mes-demandes", texte: "Retour à mes demandes" }],
    });
  }

  // SUR SES DEMANDES, PAS SUR SON PROFIL : il vient d'agir sur une
  // demande, il doit voir le resultat de son geste.
  res.redirect("/mes-demandes");
});

// --- La messagerie -------------------------------------------------
//
// Qui peut lire une conversation ? UNIQUEMENT les deux personnes
// concernees. Pas les autres candidats a la meme annonce, et pas
// l'equipe.
//
// Ce dernier point est une decision, pas un oubli. L'equipe examine les
// messages SIGNALES, dans un ecran a part. Lui donner l'acces libre a
// toutes les conversations lui permettrait de lire les echanges prives
// de n'importe qui sans raison - c'est le principe du moindre privilege,
// le meme qui nous a fait refuser la reinitialisation des mots de passe.
//
// Renvoie la conversation si l'acces est permis, sinon null.
function conversationDe(candidatureId, utilisateur) {
  const conversation = requetes.conversation.get(candidatureId);

  if (!conversation) return null;

  const estConcerne = utilisateur.id === conversation.employeurId
                   || utilisateur.id === conversation.prestataireId;

  return estConcerne ? conversation : null;
}

// La liste des discussions. Sans elle, retrouver une conversation
// obligeait a passer par son profil et a chercher la bonne candidature.
// La liste des discussions, formulee pour la personne connectee. ECRITE
// UNE SEULE FOIS : la page Mes messages et l'application disent la meme
// chose, au pluriel pres.
function mesDiscussions(utilisateur) {
  const lignes = requetes.mesConversations.all({ moi: utilisateur.id });

  const toutes = lignes.map((c) => {
    const jeSuisEmployeur = utilisateur.id === c.employeurId;
    const n = c.nbMessages;
    const s = n > 1 ? "s" : "";
    return {
      ...c,
      // Avec qui je parle : l'autre personne, jamais moi.
      avec: jeSuisEmployeur ? c.nomPrestataire : c.nomEmployeur,
      phraseStatut: phraseCandidature(c.statut, jeSuisEmployeur, c),
      // La marque "Nouveau" distingue ce qui vient d'arriver de ce qui
      // etait deja su.
      nouveau: Boolean(c.decisionNonVue),
      phraseNonLus: c.nonLus > 0
        ? `${c.nonLus} nouveau${c.nonLus > 1 ? "x" : ""} message${c.nonLus > 1 ? "s" : ""}`
        : null,
      phraseMessages: n === 0
        ? "Aucun message échangé"
        : (c.terminee_le ? `${n} message${s} conservé${s}` : `${n} message${s}`),
      // UN AVIS ATTENDU N'EST PAS UNE ARCHIVE : tant qu'il n'est pas donne,
      // quelque chose attend.
      avisAttendu: Boolean(c.terminee_le) && !c.jaiDonneMonAvis,
    };
  });

  const enCours = toutes.filter((c) => !c.terminee_le);
  const terminees = toutes.filter((c) => c.terminee_le);
  const aNoter = terminees.filter((c) => c.avisAttendu).length;

  // Pourquoi la liste est vide, dit a chacun selon ce qu'il fait.
  let vide = null;
  if (toutes.length === 0) {
    vide = { phrase: "Aucune discussion pour le moment.", aide: null };
    if (utilisateur.role === "prestataire") {
      vide.aide = "Une discussion s'ouvre lorsque vous répondez à une demande. Elle sert à " +
                  "vous accorder sur les horaires avec l'employeur avant qu'il fasse son choix.";
    } else if (utilisateur.role === "employeur" && !utilisateur.est_admin) {
      vide.aide = "Une discussion s'ouvre lorsque quelqu'un répond à l'une de vos demandes. " +
                  "Elle sert à vous accorder sur les horaires avant de choisir la personne.";
    }
  }

  return {
    enCours,
    terminees,
    chapeauTerminees: aNoter > 0
      ? {
          fort: `${aNoter} service${aNoter > 1 ? "s" : ""} attend${aNoter > 1 ? "ent" : ""} votre avis.`,
          suite: "Ces discussions ne reçoivent plus de message, mais vous pouvez encore dire ce qui s'est passé.",
        }
      : {
          fort: null,
          suite: "Ces discussions sont archivées : vous pouvez les relire, mais plus y écrire.",
        },
    vide,
  };
}

// Ce que la pastille du menu compte : les messages non lus et les
// decisions pas encore vues. Le meme calcul pour le site et l'application.
function nombreAVoir(utilisateur) {
  if (!utilisateur || utilisateur.est_admin) return 0;
  return requetes.messagesNonLus.get({ moi: utilisateur.id }).n +
         requetes.decisionsNonVues.get({ moi: utilisateur.id }).n;
}

app.get("/messages", exigerConnexion, (req, res) => {
  res.render("messages", {
    titre: "Mes messages",
    liste: mesDiscussions(req.utilisateur),
  });
});

// OUVRIR, ECRIRE ET SIGNALER SONT ECRITS UNE SEULE FOIS. Le site et
// l'application passent par les memes fonctions : les memes portes, les
// memes phrases.
//
// Chaque refus porte le lien que le site affiche : l'application, elle,
// n'en lit que le texte.

// Ouvrir une discussion, c'est l'avoir lue. Renvoie null si la personne
// n'y participe pas.
// CE QUE L'ON CONSEILLE D'ECRIRE. Le prix ne se discute pas ici : c'est
// l'equipe PamConnect qui le fixe au telephone, et l'employeur la paie.
// L'adresse exacte n'est ni demandee ni conservee par la plateforme :
// c'est a l'employeur de la donner, et seulement a la personne choisie.
// La phrase precedente promettait qu'elle serait "transmise
// automatiquement apres le paiement", ce qui n'existe pas.
function conseilPourEcrire(conversation, jeSuisEmployeur) {
  const base = "Accordez-vous sur l'horaire et le déroulement du service : l'équipe PamConnect s'occupe du prix.";
  if (!jeSuisEmployeur) return base;
  return conversation.statut === "acceptee"
    ? `${base} Vous pouvez maintenant donner votre adresse exacte à ${conversation.nomPrestataire}.`
    : `${base} N'indiquez votre adresse exacte qu'à la personne que vous choisirez.`;
}

// --- La photo d'une personne ----------------------------------------
//
// JAMAIS PUBLIQUE. Elle s'ouvre pour la personne elle-meme, pour l'equipe,
// et pour l'autre personne d'un service convenu : c'est a la porte qu'elle
// sert. Ni la recherche, ni la fiche, ni les listes ne la montrent : un
// visage dans une liste fait choisir sur l'apparence, et expose des
// personnes a n'importe quel visiteur.
function peutVoirLaPhoto(moi, personne) {
  if (moi.id === personne.id) return true;
  if (personne.suspendu) return false;
  if (moi.est_admin) return true;
  return Boolean(requetes.serviceConvenuEntre.get({ moi: moi.id, autre: personne.id }));
}

// L'adresse de la photo porte le debut du nom du fichier : une nouvelle
// photo change d'adresse, et le telephone ne garde pas l'ancienne en
// memoire. Le fichier, lui, ne s'atteint que par cette route.
function adressePhoto(personne) {
  return personne && personne.photo_fichier && !personne.suspendu
    ? `/photos/${personne.id}?v=${personne.photo_fichier.slice(0, 8)}`
    : null;
}

function ouvrirDiscussion(candidatureId, utilisateur) {
  const conversation = conversationDe(candidatureId, utilisateur);
  if (!conversation) return null;

  const jeSuisEmployeur = utilisateur.id === conversation.employeurId;
  if (jeSuisEmployeur) requetes.marquerVuEmployeur.run(conversation.id);
  else requetes.marquerVuPrestataire.run(conversation.id);

  return {
    conversation,
    jeSuisEmployeur,
    messages: requetes.messagesDeConversation.all(conversation.id),
    // LE VISAGE DE L'AUTRE, une fois le choix fait. Avant, personne ne
    // voit le visage de personne.
    photoAutre: conversation.statut === "acceptee"
      ? adressePhoto(requetes.photoDe.get(jeSuisEmployeur ? conversation.prestataireId : conversation.employeurId))
      : null,
    conseil: conseilPourEcrire(conversation, jeSuisEmployeur),
    monAvis: requetes.monAvisPour.get(conversation.id, utilisateur.id) || null,
    avisRecu: requetes.avisDeLaCandidature.all(conversation.id)
      .find((a) => a.vise_id === utilisateur.id) || null,
  };
}

const CONVERSATION_INTROUVABLE = {
  code: 403,
  titre: "Conversation introuvable",
  texte: "Cette conversation n'existe pas, ou elle ne vous concerne pas.",
  lien: { url: "/messages", texte: "Mes messages" },
};

// Renvoie { probleme }, { vide } ou { ok }.
function ecrireMessage(candidatureId, utilisateur, saisie) {
  const conversation = conversationDe(candidatureId, utilisateur);
  if (!conversation) return { probleme: CONVERSATION_INTROUVABLE };

  // Une discussion terminee est un document d'archive. La regle est
  // ici, pas seulement dans la vue : cacher un formulaire n'empeche
  // personne d'envoyer la requete a la main.
  if (conversation.terminee_le) {
    return {
      conversation,
      probleme: {
        code: 409,
        titre: "Ce service est terminé",
        texte: "Cette discussion est archivée. Vous pouvez la relire, mais " +
               "plus y écrire.",
        lien: { url: "/messages/" + conversation.id, texte: "Relire la discussion" },
      },
    };
  }

  const texte = String(saisie || "").trim();
  if (!texte) return { conversation, vide: true };

  // On refuse un message demesure : la base accepterait un roman entier,
  // et la page deviendrait illisible.
  if (texte.length > 2000) {
    return {
      conversation,
      probleme: {
        code: 400,
        titre: "Message trop long",
        texte: "Un message ne peut pas dépasser 2000 caractères.",
        lien: { url: `/messages/${conversation.id}`, texte: "Retour à la discussion" },
      },
    };
  }

  requetes.creerMessage.run({
    candidature_id: conversation.id,
    auteur_id: utilisateur.id,
    texte,
    // Le calcul est fait UNE FOIS, a l'envoi, et son resultat conserve.
    risque_paiement: risquePaiementHorsPlateforme(texte) ? 1 : 0,
  });

  return { conversation, ok: true };
}

function signalerUnMessage(messageId, candidatureId, utilisateur) {
  const conversation = conversationDe(candidatureId, utilisateur);
  if (!conversation) {
    return {
      probleme: {
        code: 403,
        titre: "Action impossible",
        texte: "Cette conversation ne vous concerne pas.",
        lien: { url: "/messages", texte: "Mes messages" },
      },
    };
  }

  // La requete elle-meme refuse de signaler un message dont on est
  // l'auteur, ou qui n'appartient pas a CETTE discussion. Sans la seconde
  // condition, il suffisait de participer a une discussion pour porter
  // sous les yeux de l'equipe n'importe quel message prive de la
  // plateforme. Une regle ecrite dans le SQL ne peut pas etre oubliee par
  // une route.
  requetes.signalerMessage.run({ message: messageId, discussion: conversation.id, moi: utilisateur.id });

  return { conversation, ok: true };
}

app.get("/messages/:id", exigerConnexion, (req, res) => {
  const discussion = ouvrirDiscussion(Number(req.params.id), req.utilisateur);

  if (!discussion) {
    return res.status(403).render("message", {
      titre: CONVERSATION_INTROUVABLE.titre,
      texte: CONVERSATION_INTROUVABLE.texte,
      liens: [CONVERSATION_INTROUVABLE.lien],
    });
  }

  const { conversation, jeSuisEmployeur } = discussion;

  // La discussion vient d'etre marquee lue : on recalcule le compte du
  // menu, sans quoi l'entete afficherait encore "1" sur la page meme qui
  // vient d'etre lue.
  res.locals.messagesNonLus = requetes.messagesNonLus.get({ moi: req.utilisateur.id }).n;
  res.locals.decisionsNonVues = requetes.decisionsNonVues.get({ moi: req.utilisateur.id }).n;
  res.locals.aVoir = res.locals.messagesNonLus + res.locals.decisionsNonVues;

  res.render("conversation", {
    monAvis: discussion.monAvis,
    avisRecu: discussion.avisRecu,
    titre: "Discussion",
    conversation,
    messages: discussion.messages,
    jeSuisEmployeur,
    conseil: discussion.conseil,
    photoAutre: discussion.photoAutre,
  });
});

app.post("/messages/:id", exigerConnexion, lireFormulaire, (req, res) => {
  const resultat = ecrireMessage(Number(req.params.id), req.utilisateur, req.body.texte);

  if (resultat.probleme) {
    return res.status(resultat.probleme.code).render("message", {
      titre: resultat.probleme.titre,
      texte: resultat.probleme.texte,
      liens: [resultat.probleme.lien],
    });
  }

  // Un message vide ne s'enregistre pas : on revient simplement a la
  // discussion.
  res.redirect(`/messages/${resultat.conversation.id}`);
});

// --- Signaler un message a l'equipe ---------------------------------
app.post("/messages/:id/signaler", exigerConnexion, lireFormulaire, (req, res) => {
  const resultat = signalerUnMessage(
    Number(req.params.id), Number(req.body.candidatureId), req.utilisateur);

  if (resultat.probleme) {
    return res.status(resultat.probleme.code).render("message", {
      titre: resultat.probleme.titre,
      texte: resultat.probleme.texte,
      liens: [resultat.probleme.lien],
    });
  }

  res.redirect(`/messages/${resultat.conversation.id}`);
});

// --- La fiche publique d'une personne ------------------------------
//
// Le cahier des charges demande qu'un employeur puisse consulter une
// fiche complete avant de choisir. Jusqu'ici, la recherche affichait des
// cartes qui ne menaient nulle part.
//
// La page est ouverte a tous, y compris aux visiteurs non connectes :
// c'est ce qui permet de decouvrir la plateforme avant de s'inscrire.
// Elle ne montre que des informations choisies une par une (voir la
// requete fichePublique).
// La fiche publique d'une personne porte desormais sa reputation. Elle
// n'est pas un ornement : c'est la seule chose sur cette page qui vienne
// d'ailleurs que de la personne elle-meme.
// La fiche d'une personne, reunie UNE SEULE FOIS pour le site et
// l'application.
function lireFichePublique(personneId, moi) {
  const personne = requetes.fichePublique.get(personneId);

  if (!personne) {
    return {
      probleme: {
        code: 404,
        titre: "Profil introuvable",
        texte: "Ce profil n'existe pas, ou il n'est plus disponible.",
        lien: { url: "/recherche", texte: "Retour à la recherche" },
      },
    };
  }

  // La tranche d'age n'est PAS une information publique. Elle n'apparait
  // que pour l'employeur qui a deja embauche cette personne : a ce
  // moment-la, ils se connaissent et travaillent ensemble. Avant, la
  // divulguer serait exposer une donnee personnelle sans necessite.
  const peutVoirAge = Boolean(moi && moi.role === "employeur" && !moi.est_admin &&
    requetes.embaucheEntre.get({ personne: personne.id, employeur: moi.id }));

  return {
    personne,
    peutVoirAge,
    // LA SEULE CHOSE DE CETTE PAGE QUI NE VIENNE PAS D ELLE. Tout le
    // reste - metier, disponibilites - est declare par la
    // personne. Les avis viennent de ceux qui l ont employee.
    reputation: Object.assign(reputationDe(personne.id), {
      services: requetes.reputationEtExperience.get({ personne: personne.id }).services,
    }),
    avis: requetes.avisRecus.all(personne.id),
  };
}

// Une photo refusee, absente ou interdite a ce demandeur : 404, sans dire
// laquelle des trois. Le nom du fichier est revérifie avant de construire
// un chemin avec.
app.get("/photos/:id", (req, res) => {
  const moi = utilisateurConnecte(req);
  const personne = requetes.photoDe.get(Number(req.params.id));
  const nomValide = Boolean(personne) && /^[0-9a-f]{32}\.(jpg|jpeg|png)$/.test(String(personne.photo_fichier));

  if (!moi || !nomValide || !peutVoirLaPhoto(moi, personne)) {
    return res.status(404).type("text/plain").send("Photo introuvable.");
  }

  res.set({ "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600" });
  res.sendFile(path.join(DOSSIER_DOCUMENTS, personne.photo_fichier));
});

app.get("/personnes/:id", (req, res) => {
  const fiche = lireFichePublique(Number(req.params.id), res.locals.moi);
  if (fiche.probleme) return afficherProbleme(res, fiche.probleme);

  res.render("fiche", {
    titre: fiche.personne.nom,
    personne: fiche.personne,
    peutVoirAge: fiche.peutVoirAge,
    reputation: fiche.reputation,
    avis: fiche.avis,
  });
});

// --- Recherche de prestataires -------------------------------------
// --- Rechercher, UNE SEULE FOIS pour le site et l'application ---------
function rechercherPersonnes(criteres, moi) {
  // "menage", "menagere", "MENAGE" et "technicienne de surface" designent
  // des metiers de notre liste : on les ramene au nom officiel avant de
  // chercher. Sans cela, une recherche de "menage" ratait les profils
  // enregistres sous "Menage a domicile" - l'accent suffisait a les
  // rendre invisibles.
  const motCherche = String(criteres.metier || "").trim();
  const metierOfficiel = trouverMetier(motCherche);
  const latEmployeur = parseFloat(criteres.latitude);
  const lonEmployeur = parseFloat(criteres.longitude);
  const positionConnue = !isNaN(latEmployeur) && !isNaN(lonEmployeur);

  // C'est la base qui filtre par metier, pas JavaScript.
  let prestataires;

  if (metierOfficiel) {
    prestataires = requetes.prestatairesDuMetier.all(metierOfficiel);
  } else if (motCherche) {
    // Un mot inconnu de notre liste : on retombe sur la recherche
    // approximative, plutot que de ne rien renvoyer.
    prestataires = requetes.prestatairesParMetier.all(`%${motCherche.toLowerCase()}%`);
  } else {
    prestataires = requetes.tousLesPrestataires.all();
  }

  if (positionConnue) {
    prestataires = prestataires
      .filter((p) => p.latitude && p.longitude)
      .map((p) => ({
        ...p,
        distance: calculerDistanceKm(latEmployeur, lonEmployeur, p.latitude, p.longitude),
      }));
  }

  // LE CLASSEMENT. Ce qui vient avant a FILTRE - le metier, la position
  // connue. Ce qui suit ORDONNE, et sur autre chose que les etoiles.
  //
  // LA MOYENNE DE LA PLATEFORME NE SERT QUE QUAND ELLE VEUT DIRE
  // QUELQUE CHOSE. Avec un seul avis, elle vaut la note de cet avis-la
  // et tire tout le monde vers elle : ce n'est pas une information,
  // c'est un accident.
  const general = requetes.moyenneDeLaPlateforme.get();
  const moyenneGenerale = general.nombre >= AVIS_POUR_UNE_MOYENNE_FIABLE
    ? general.moyenne
    : NOTE_DE_DEPART;

  // SANS POSITION, LE QUARTIER. Le formulaire ne demande pas de quartier :
  // pour un employeur connecte, c'est celui de son profil qui compte.
  // Avant, la proximite par quartier ne servait jamais : rien n'envoyait
  // de quartier, et le quartier cherche etait compare, objet entier, au
  // nom du quartier de chaque personne.
  const employeur = moi && moi.role === "employeur" && !moi.est_admin ? moi : null;
  const quartierDemande = trouverQuartier(String(criteres.quartier || ""));
  const arrondissementDemande = String(criteres.arrondissement || "").trim() || null;
  let lieuCherche = { quartier: null, arrondissement: null };
  let lieuDuProfil = false;

  if (quartierDemande) {
    lieuCherche = { quartier: quartierDemande.nom, arrondissement: quartierDemande.arrondissement };
  } else if (arrondissementDemande) {
    lieuCherche = { quartier: null, arrondissement: arrondissementDemande };
  } else if (employeur && (employeur.quartier || employeur.arrondissement)) {
    const connu = trouverQuartier(String(employeur.quartier || ""));
    lieuCherche = connu
      ? { quartier: connu.nom, arrondissement: connu.arrondissement }
      : { quartier: employeur.quartier || null, arrondissement: employeur.arrondissement || null };
    lieuDuProfil = true;
  }

  const resultats = prestataires
    .map((p) => {
      const chiffres = requetes.reputationEtExperience.get({ personne: p.id });
      const score = scoreDe(p, chiffres, moyenneGenerale);
      const proximite = pointsDeProximite(p, lieuCherche, p.distance);
      const moyenne = chiffres.nbAvis > 0
        ? Math.round((chiffres.sommeNotes / chiffres.nbAvis) * 10) / 10
        : null;

      return {
        id: p.id,
        nom: p.nom,
        metier: p.metier,
        verifiee: p.statut_verification === "verifie",

        // Ce que les ecrans affichent : la moyenne reelle, le nombre d'avis,
        // et le badge des personnes qui commencent. Jamais le score - un
        // nombre affiche se compare, se discute, et finit par se chercher.
        nbAvis: chiffres.nbAvis,
        moyenne,
        services: chiffres.services,
        nouvelle: estNouvelle(chiffres),
        note: notePersonne({ nbAvis: chiffres.nbAvis, moyenne, services: chiffres.services }),

        joursDisponibles: disponibilitesLisibles(p.disponibilites).map((c) => c.jour).join(", ") || null,
        experience: libelleExperience(p.experience_annees),
        lieu: [p.arrondissement, p.quartier].filter(Boolean).join(", ") || null,
        tarif: formaterTarif(p.tarif),
        distance: p.distance !== undefined ? `${p.distance.toFixed(1)} km` : null,

        classement: score.total + proximite,
      };
    })
    .sort((a, b) => b.classement - a.classement);

  const nombre = resultats.length;
  const lieuLisible = lieuCherche.quartier
    ? `votre quartier, ${lieuCherche.quartier}`
    : `votre arrondissement, ${lieuCherche.arrondissement}`;

  return {
    metierRecherche: motCherche,
    // LE NOMBRE REPOND A UNE QUESTION, ou il ne sert a rien.
    titre: motCherche
      ? `${nombre} personne${nombre > 1 ? "s" : ""} pour « ${motCherche} »`
      : "Les personnes disponibles",
    phraseLieu: lieuDuProfil && !positionConnue
      ? `Sans votre position, la proximité se mesure à partir de ${lieuLisible}.`
      : null,
    personnes: resultats,
  };
}

app.get("/recherche", (req, res) => {
  const recherche = rechercherPersonnes(req.query, res.locals.moi);

  res.render("recherche", {
    titre: "Rechercher un prestataire",
    prestataires: recherche.personnes,
    metierRecherche: recherche.metierRecherche,
    titreResultats: recherche.titre,
    phraseLieu: recherche.phraseLieu,
  });
});

// --- Verification d'identite : le formulaire -----------------------
//
// ELLE CONCERNE LES DEUX COTES. Un employeur fait entrer quelqu'un chez
// lui : il veut savoir qui vient. Mais la personne qui vient entre chez
// un inconnu, seule, souvent tot le matin. La protection ne peut pas
// aller dans un seul sens.
//
// Seul un compte d'equipe en est dispense : il ne rencontre personne.
// CE QUE L'ECRAN MONTRE, ecrit UNE SEULE FOIS pour la page du site et
// l'application.
//
// L'attente d'un dossier, avec ses mots en gras : depuis quand, et combien
// de temps il reste. Sans date d'envoi enregistree, on ne l'invente pas.
function attenteDuDossier(u) {
  if (u.statut_verification !== "en attente") return null;
  const delai = `${DELAI_VERIFICATION_HEURES} heures`;
  const attente = attenteVerification(u.documents_envoyes_le);

  if (attente === null) {
    return {
      morceaux: [{ texte: "Notre équipe l'examine sous " }, { texte: delai, gras: true }, { texte: "." }],
      aide: "La date d'envoi de ce dossier n'a pas été enregistrée.",
    };
  }

  const envoye = { texte: attenteLisible(u.documents_envoyes_le), gras: true };
  if (attente.depasse) {
    return {
      morceaux: [{ texte: "Envoyé " }, envoye, { texte: `. Le délai de ${delai} est dépassé.` }],
      aide: "Votre dossier n'a pas été perdu : il reste en tête de la liste de l'équipe.",
    };
  }

  return {
    morceaux: [
      { texte: "Envoyé " }, envoye, { texte: ". Réponse attendue d'ici " },
      { texte: `${attente.restantes} heure${attente.restantes > 1 ? "s" : ""}`, gras: true },
      { texte: "." },
    ],
    aide: "Vous n'avez rien d'autre à faire.",
  };
}

function ecranDeVerification(u) {
  const statut = u.statut_verification;
  const employeur = u.role === "employeur";

  return {
    statut,
    libelle: libelleVerification(statut),
    attente: attenteDuDossier(u),
    motifRefus: statut === "refuse" && u.motif_refus ? u.motif_refus : null,
    verifiee: statut === "verifie",
    // Apres la validation, chacun retourne a son travail. Un employeur ne
    // repond pas aux demandes : on l'envoyait pourtant sur leur tableau.
    suite: employeur
      ? { url: "/mes-demandes", texte: "Voir mes demandes" }
      : { url: "/annonces", texte: "Voir les demandes" },
    // Pourquoi ces documents : la raison n'est pas la meme des deux cotes.
    chapeau: employeur
      ? "Les personnes qui vous répondront se déplaceront chez vous, seules, souvent tôt " +
        "le matin. Elles ont le droit de savoir qui vous êtes : deux documents et une photo sont demandés."
      : "Les employeurs confient l'accès à leur domicile. Pour que votre profil inspire " +
        "confiance, deux documents et une photo sont demandés.",
    delaiHeures: DELAI_VERIFICATION_HEURES,
    extensions: EXTENSIONS_AUTORISEES,
    extensionsPhoto: EXTENSIONS_PHOTO,
    tailleMaxMo: TAILLE_MAX_OCTETS / 1024 / 1024,
    // Un nouvel envoi remplace le dossier en cours d'examen : on le dit.
    remplaceUnDossier: statut === "en attente",
  };
}

const DOSSIER_DEJA_VALIDE = {
  code: 409,
  titre: "Déjà vérifié",
  texte: "Votre identité a déjà été validée, il n'y a rien à renvoyer.",
  lien: { url: "/mon-profil", texte: "Retour à mon profil" },
};

// CE QUE L'ENVOI A RECU, relu UNE SEULE FOIS pour le site et
// l'application. Un envoi refuse ne laisse aucun fichier sur le disque.
function recevoirUnDossier(u, recus, erreur) {
  const cni = recus && recus.cni ? recus.cni[0] : null;
  const casier = recus && recus.casier ? recus.casier[0] : null;
  const photo = recus && recus.photo ? recus.photo[0] : null;

  function refus(titre, texte) {
    if (cni) supprimerDocument(cni.filename);
    if (casier) supprimerDocument(casier.filename);
    if (photo) supprimerDocument(photo.filename);
    return { probleme: { code: 400, titre, texte, lien: { url: "/verification", texte: "Réessayer" } } };
  }

  const PHOTO_PAS_UNE_IMAGE = ["Format non accepté", "La photo de votre visage doit être au format JPEG ou PNG."];

  if (erreur) {
    if (erreur.code === "LIMIT_FILE_SIZE") {
      return refus("Fichier trop volumineux",
        `Chaque document doit peser moins de ${TAILLE_MAX_OCTETS / 1024 / 1024} Mo.`);
    }
    if (erreur.message === "PHOTO_NON_IMAGE") return refus(...PHOTO_PAS_UNE_IMAGE);
    if (erreur.message === "TYPE_NON_AUTORISE") {
      return refus("Format non accepté", `Formats acceptés : ${EXTENSIONS_AUTORISEES.join(", ")}.`);
    }
    return refus("Envoi impossible", "Le fichier n'a pas pu être reçu. Réessayez.");
  }

  if (!cni || !casier || !photo) {
    return refus("Trois envois sont nécessaires",
      "Il faut envoyer la pièce d'identité, l'extrait de casier judiciaire ET une photo de votre visage.");
  }

  if (!estUneImage(photo.filename)) return refus(...PHOTO_PAS_UNE_IMAGE);

  // Un envoi precedent est remplace : on efface les anciens fichiers. La
  // photo deja acceptee, elle, n'est pas touchee.
  supprimerDocument(u.cni_fichier);
  supprimerDocument(u.casier_fichier);
  supprimerDocument(u.photo_envoyee_fichier);

  requetes.enregistrerDocuments.run({
    cni: cni.filename, casier: casier.filename, photo: photo.filename, id: u.id,
  });

  return {
    ok: true,
    titre: "Documents envoyés",
    texte: "Votre dossier est arrivé. Notre équipe l'examine sous " +
           DELAI_VERIFICATION_HEURES + " heures. Vous n'avez rien d'autre à " +
           "faire : le résultat apparaîtra sur votre profil.",
  };
}

app.get("/verification", exigerConnexion, interdireALEquipe, (req, res) => {
  res.render("verification", {
    titre: "Vérification d'identité",
    utilisateur: req.utilisateur,
    verification: ecranDeVerification(req.utilisateur),
  });
});

// --- Verification d'identite : l'envoi des documents ---------------
// Les deux cotes deposent les memes documents : la protection ne va pas
// dans un seul sens.
app.post("/verification", exigerConnexion, interdireALEquipe, (req, res) => {
  if (req.utilisateur.statut_verification === "verifie") {
    return afficherProbleme(res, DOSSIER_DEJA_VALIDE);
  }

  // On appelle multer nous-memes pour pouvoir afficher un message clair
  // au lieu de laisser une erreur brute remonter jusqu'a l'utilisateur.
  recevoirDocuments(req, res, (erreur) => {
    const resultat = recevoirUnDossier(req.utilisateur, req.files, erreur);
    if (resultat.probleme) return afficherProbleme(res, resultat.probleme);

    res.render("message", {
      titre: resultat.titre,
      texte: resultat.texte,
      liens: [{ url: "/mon-profil", texte: "Retour à mon profil" }],
    });
  });
});

// --- Ma photo : l'ajouter, la changer, la retirer --------------------
//
// ECRIT UNE SEULE FOIS pour la page du site et l'application.
function etatDeMaPhoto(u) {
  const enAttente = Boolean(u.photo_envoyee_fichier && u.photo_piece_fichier);
  const motif = !enAttente && u.photo_motif_refus ? u.photo_motif_refus : null;
  const acceptee = Boolean(u.photo_fichier);

  if (enAttente) {
    return { etat: "attente", adresse: adressePhoto(u), texte: "Votre photo est en cours de contrôle par l'équipe.",
             bouton: null, peutRetirer: false };
  }
  if (motif) {
    const fin = /[.!?]$/.test(motif) ? "" : ".";
    return { etat: "refusee", adresse: adressePhoto(u), texte: `Votre photo n'a pas été acceptée : ${motif}${fin}`,
             bouton: "Envoyer une autre photo", peutRetirer: acceptee };
  }
  if (acceptee) {
    return { etat: "acceptee", adresse: adressePhoto(u),
             texte: "Visible seulement par la personne avec qui vous travaillez, une fois le choix fait.",
             bouton: "Changer ma photo", peutRetirer: true };
  }
  return { etat: "aucune", adresse: null,
           texte: "Ajoutez une photo de votre visage : la personne avec qui vous travaillerez pourra vous reconnaître le jour du service.",
           bouton: "Ajouter ma photo", peutRetirer: false };
}

const PHOTO_SANS_VERIFICATION = {
  code: 403,
  titre: "Vérification requise",
  texte: "Faites d'abord vérifier votre identité : l'équipe compare la photo à votre pièce d'identité.",
  lien: { url: "/verification", texte: "Faire vérifier mon identité" },
};

function ecranDeMaPhoto(u) {
  if (u.statut_verification !== "verifie") return { probleme: PHOTO_SANS_VERIFICATION };
  return {
    titre: u.photo_fichier ? "Changer ma photo" : "Ajouter ma photo",
    texte: "Envoyez une photo de votre visage et votre pièce d'identité. L'équipe vérifie que " +
           "c'est bien vous, puis supprime la pièce d'identité : seule la photo est gardée.",
    extensions: EXTENSIONS_AUTORISEES,
    extensionsPhoto: EXTENSIONS_PHOTO,
    tailleMaxMo: TAILLE_MAX_OCTETS / 1024 / 1024,
  };
}

// CE QUE L'ENVOI A RECU. Comme pour le dossier, un envoi refuse ne laisse
// aucun fichier sur le disque.
function recevoirUnePhoto(u, recus, erreur) {
  const photo = recus && recus.photo ? recus.photo[0] : null;
  const piece = recus && recus.cni ? recus.cni[0] : null;
  const inutile = recus && recus.casier ? recus.casier[0] : null;
  if (inutile) supprimerDocument(inutile.filename);

  function refus(titre, texte, code) {
    if (photo) supprimerDocument(photo.filename);
    if (piece) supprimerDocument(piece.filename);
    return { probleme: { code: code || 400, titre, texte, lien: { url: "/mon-profil/photo", texte: "Réessayer" } } };
  }

  if (u.statut_verification !== "verifie") {
    const refuse = refus(PHOTO_SANS_VERIFICATION.titre, PHOTO_SANS_VERIFICATION.texte, 403);
    refuse.probleme.lien = PHOTO_SANS_VERIFICATION.lien;
    return refuse;
  }

  if (erreur) {
    if (erreur.code === "LIMIT_FILE_SIZE") {
      return refus("Fichier trop volumineux",
        `Chaque document doit peser moins de ${TAILLE_MAX_OCTETS / 1024 / 1024} Mo.`);
    }
    if (erreur.message === "PHOTO_NON_IMAGE") {
      return refus("Format non accepté", "La photo de votre visage doit être au format JPEG ou PNG.");
    }
    if (erreur.message === "TYPE_NON_AUTORISE") {
      return refus("Format non accepté", `Formats acceptés : ${EXTENSIONS_AUTORISEES.join(", ")}.`);
    }
    return refus("Envoi impossible", "Le fichier n'a pas pu être reçu. Réessayez.");
  }

  if (!photo || !piece) {
    return refus("Deux envois sont nécessaires",
      "Il faut envoyer une photo de votre visage ET votre pièce d'identité.");
  }
  if (!estUneImage(photo.filename)) {
    return refus("Format non accepté", "La photo de votre visage doit être au format JPEG ou PNG.");
  }

  // Une demande precedente est remplacee. La photo deja acceptee reste
  // visible jusqu'a la decision sur la nouvelle.
  supprimerDocument(u.photo_envoyee_fichier);
  supprimerDocument(u.photo_piece_fichier);
  requetes.enregistrerDemandePhoto.run({ photo: photo.filename, piece: piece.filename, id: u.id });

  return { ok: true, titre: "Photo envoyée", texte: "Votre photo est en cours de contrôle par l'équipe." };
}

// Retirer sa photo : elle disparait du disque, et de la discussion.
function retirerMaPhoto(u) {
  if (!u.photo_fichier) return;
  supprimerDocument(u.photo_fichier);
  requetes.retirerPhoto.run(u.id);
}

app.get("/mon-profil/photo", exigerConnexion, interdireALEquipe, (req, res) => {
  const ecran = ecranDeMaPhoto(req.utilisateur);
  if (ecran.probleme) return afficherProbleme(res, ecran.probleme);
  res.render("photo", { titre: ecran.titre, photo: ecran });
});

app.post("/mon-profil/photo", exigerConnexion, interdireALEquipe, (req, res) => {
  recevoirDocuments(req, res, (erreur) => {
    const resultat = recevoirUnePhoto(req.utilisateur, req.files, erreur);
    if (resultat.probleme) return afficherProbleme(res, resultat.probleme);

    res.render("message", {
      titre: resultat.titre,
      texte: resultat.texte,
      liens: [{ url: "/mon-profil", texte: "Retour à mon profil" }],
    });
  });
});

app.post("/mon-profil/photo/retirer", exigerConnexion, interdireALEquipe, (req, res) => {
  retirerMaPhoto(req.utilisateur);
  res.redirect("/mon-profil");
});

// LA PERSONNE QUI A TRAVAILLE DECLARE L'AVOIR FAIT.
//
// Sa declaration ne paie RIEN : c'est une trace datee, que l'employeur et
// l'equipe voient. L'employeur paie PamConnect, qui reverse ensuite.
//
// Ce qu'elle change : l'employeur voit qu'elle attend sa confirmation,
// et l'equipe lit un desaccord date au lieu d'un service dont personne
// ne sait s'il a eu lieu.
function declarerAvoirTravaille(candidatureId, u) {
  const conversation = conversationDe(candidatureId, u);

  if (!conversation) {
    return {
      probleme: {
        code: 404,
        titre: "Discussion introuvable",
        texte: "Cette discussion n'existe pas, ou elle ne vous concerne pas.",
        lien: { url: "/messages", texte: "Mes messages" },
      },
    };
  }

  const retour = { url: "/messages/" + conversation.id, texte: "Retour à la discussion" };

  // L'employeur a son propre bouton, qui previent l'equipe. Celui-ci
  // n'est pas le sien.
  if (u.id !== conversation.prestataireId) {
    return {
      conversation,
      probleme: {
        code: 403,
        titre: "Ce bouton n'est pas le vôtre",
        texte: "Déclarer que vous avez effectué le service appartient à la personne " +
               "qui a travaillé. De votre côté, déclarez le service effectué : " +
               "c'est ce qui la paie.",
        lien: retour,
      },
    };
  }

  if (conversation.statut !== "acceptee") {
    return {
      conversation,
      probleme: {
        code: 409,
        titre: "Aucun service à déclarer",
        texte: "Vous ne pouvez déclarer un service que si l'employeur vous a choisie.",
        lien: retour,
      },
    };
  }

  // UNE SEULE FOIS, et jamais apres l'employeur. La requete ne changeait
  // deja rien dans ces deux cas ; la personne l'apprend desormais au lieu
  // d'etre renvoyee sans un mot.
  if (conversation.terminee_le) {
    return {
      conversation,
      probleme: {
        code: 409,
        titre: "Service déjà terminé",
        texte: `${conversation.nomEmployeur} a déjà déclaré ce service effectué.`,
        lien: retour,
      },
    };
  }

  if (conversation.declaree_par_elle_le) {
    return {
      conversation,
      probleme: {
        code: 409,
        titre: "Service déjà déclaré",
        texte: `Vous avez déjà déclaré ce service le ${conversation.declaree_par_elle_le}.`,
        lien: retour,
      },
    };
  }

  requetes.declarerParElle.run({ id: conversation.id });

  return {
    conversation,
    ok: true,
    texte: `Votre déclaration est enregistrée avec sa date : l'équipe PamConnect la voit. ` +
           `${conversation.nomEmployeur} paie PamConnect après le service, puis l'équipe vous reverse.`,
  };
}

app.post("/candidatures/:id/jai-effectue", exigerConnexion, lireFormulaire, (req, res) => {
  const resultat = declarerAvoirTravaille(Number(req.params.id), req.utilisateur);
  if (resultat.probleme) return afficherProbleme(res, resultat.probleme);

  res.redirect("/messages/" + resultat.conversation.id);
});

// L'employeur declare le service effectue. C'est lui qui l'a recu :
// c'est donc lui qui le clot. La discussion n'est pas supprimee, elle
// passe dans l'historique - les deux personnes la relisent, personne n'y
// ecrit plus.
//
// ECRIT UNE SEULE FOIS pour le site et l'application.
function declarerServiceEffectue(candidatureId, utilisateur) {
  const conversation = conversationDe(candidatureId, utilisateur);

  if (!conversation) {
    return {
      probleme: {
        code: 404,
        titre: "Discussion introuvable",
        texte: "Cette discussion n'existe pas, ou elle ne vous concerne pas.",
        lien: { url: "/messages", texte: "Mes messages" },
      },
    };
  }

  const retour = { url: "/messages/" + conversation.id, texte: "Retour à la discussion" };

  // La personne qui a travaille ne clot pas le service a la place de
  // celui qui l'a recu.
  if (utilisateur.id !== conversation.employeurId) {
    return {
      conversation,
      probleme: {
        code: 403,
        titre: "Vous ne pouvez pas clore ce service",
        texte: "Seule la personne qui a demandé le service peut déclarer " +
               "qu'il a été effectué.",
        lien: retour,
      },
    };
  }

  if (conversation.statut !== "acceptee") {
    return {
      conversation,
      probleme: {
        code: 409,
        titre: "Aucun service à clore",
        texte: "Un service ne peut être déclaré effectué que si vous avez " +
               "accepté la candidature de cette personne.",
        lien: retour,
      },
    };
  }

  // Deja declare : la requete ne changerait rien. On le dit, plutot que de
  // laisser croire a une seconde declaration.
  if (conversation.terminee_le) {
    return {
      conversation,
      probleme: {
        code: 409,
        titre: "Service déjà déclaré",
        texte: "Vous avez déjà déclaré ce service effectué.",
        lien: retour,
      },
    };
  }

  // LA DECLARATION NE DEPLACE AUCUN ARGENT. Elle dit que le service a
  // eu lieu : c'est ce qui permet a l'employeur de payer PamConnect, et
  // a l'equipe d'enregistrer le reversement. Payer depuis un bouton
  // serait un mouvement d'argent que la plateforme ne fait pas.
  requetes.terminerService.run({ id: conversation.id });

  return { conversation, ok: true };
}

app.post("/candidatures/:id/terminer", exigerConnexion, lireFormulaire, (req, res) => {
  const resultat = declarerServiceEffectue(Number(req.params.id), req.utilisateur);

  if (resultat.probleme) {
    return res.status(resultat.probleme.code).render("message", {
      titre: resultat.probleme.titre,
      texte: resultat.probleme.texte,
      liens: [resultat.probleme.lien],
    });
  }

  res.redirect("/messages/" + resultat.conversation.id);
});

// SIGNALER UN PROBLEME AU SUPPORT.
//
// Different du signalement d'un message : ici, la personne ECRIT ce qui
// ne va pas. Les vrais problemes n'ont souvent aucun message a montrer -
// la personne n'est pas venue, les conditions ont change sur place, on
// lui a propose de payer hors plateforme au telephone. Exiger de
// designer un message pour alerter l'equipe n'avait pas de sens.
//
// L'acces passe par la meme regle que la discussion : seules les deux
// personnes concernees y entrent.
function autreCoteDe(conversation, utilisateur) {
  return utilisateur.id === conversation.employeurId
    ? { id: conversation.prestataireId, nom: conversation.nomPrestataire }
    : { id: conversation.employeurId, nom: conversation.nomEmployeur };
}

// Au-dela, le texte est refuse plutot que coupe en silence : la personne
// doit savoir que la fin de son message ne partirait pas.
const PROBLEME_TEXTE_MAX = 2000;

const DISCUSSION_INTROUVABLE_PROBLEME = {
  code: 404,
  titre: "Discussion introuvable",
  texte: "Cette discussion n'existe pas, ou elle ne vous concerne pas.",
  lien: { url: "/messages", texte: "Mes messages" },
};

function formulaireProbleme(candidatureId, utilisateur) {
  const conversation = conversationDe(candidatureId, utilisateur);
  if (!conversation) return { probleme: DISCUSSION_INTROUVABLE_PROBLEME };

  const autre = autreCoteDe(conversation, utilisateur);
  // Un employeur n'a pas de candidature, il a une demande. Sans cette
  // information, l'ecran parlait a tout le monde comme s'il ecrivait a une
  // personne qui cherche du travail.
  const jeSuisEmployeur = utilisateur.id === conversation.employeurId;

  return {
    conversation,
    autre,
    jeSuisEmployeur,
    dejaSignale: Boolean(requetes.problemeOuvertPour.get({
      candidature: conversation.id, auteur: utilisateur.id,
    })),
    // Ce que la plateforme fait de ce signalement, ecrit AVANT le bouton.
    consequences: "L'équipe lit votre message et décide : elle peut classer sans suite, " +
                  `adresser un avertissement à ${autre.nom}, ou suspendre son compte.`,
    apresSignalement: "Votre discussion reste ouverte. Signaler ne retire pas " +
                      (jeSuisEmployeur ? "votre demande" : "votre candidature") +
                      ` et ne prévient pas ${autre.nom}.`,
  };
}

function signalerUnProbleme(candidatureId, utilisateur, saisie) {
  const formulaire = formulaireProbleme(candidatureId, utilisateur);
  if (formulaire.probleme) return formulaire;

  const { conversation, autre } = formulaire;
  const retourFormulaire = { url: "/probleme/" + conversation.id, texte: "Revenir au formulaire" };
  const texte = String(saisie || "").trim();

  if (texte.length < 10) {
    return {
      conversation,
      probleme: {
        code: 400,
        titre: "Décrivez le problème",
        texte: "Quelques mots suffisent, mais l'équipe doit comprendre ce qui " +
               "s'est passé pour pouvoir agir.",
        lien: retourFormulaire,
      },
    };
  }

  if (texte.length > PROBLEME_TEXTE_MAX) {
    return {
      conversation,
      probleme: {
        code: 400,
        titre: "Message trop long",
        texte: `Un signalement ne peut pas dépasser ${PROBLEME_TEXTE_MAX} caractères.`,
        lien: retourFormulaire,
      },
    };
  }

  // Un second signalement sur la meme discussion, avant que le premier
  // ait ete examine, n'apprend rien de plus a l'equipe.
  if (formulaire.dejaSignale) {
    return {
      conversation,
      probleme: {
        code: 409,
        titre: "Signalement déjà envoyé",
        texte: "Vous avez déjà signalé un problème sur cette discussion. " +
               "L'équipe ne l'a pas encore examiné.",
        lien: { url: "/messages/" + conversation.id, texte: "Retour à la discussion" },
      },
    };
  }

  requetes.signalerProbleme.run({
    candidature: conversation.id,
    auteur: utilisateur.id,
    vise: autre.id,
    texte,
  });

  return {
    conversation,
    ok: true,
    titre: "Signalement envoyé",
    texte: "L'équipe PamConnect a reçu votre message et va l'examiner. " +
           "Votre discussion reste ouverte : rien n'a changé pour vous.",
  };
}

app.get("/probleme/:id", exigerConnexion, (req, res) => {
  const formulaire = formulaireProbleme(Number(req.params.id), req.utilisateur);
  if (formulaire.probleme) return afficherProbleme(res, formulaire.probleme);

  res.render("probleme", {
    titre: "Signaler un problème",
    conversation: formulaire.conversation,
    autre: formulaire.autre,
    jeSuisEmployeur: formulaire.jeSuisEmployeur,
    dejaSignale: formulaire.dejaSignale,
    consequences: formulaire.consequences,
    apresSignalement: formulaire.apresSignalement,
    texteMax: PROBLEME_TEXTE_MAX,
  });
});

app.post("/probleme/:id", exigerConnexion, lireFormulaire, (req, res) => {
  const resultat = signalerUnProbleme(Number(req.params.id), req.utilisateur, req.body.texte);
  if (resultat.probleme) return afficherProbleme(res, resultat.probleme);

  res.render("message", {
    titre: resultat.titre,
    texte: resultat.texte,
    liens: [{ url: "/messages/" + resultat.conversation.id, texte: "Retour à la discussion" }],
  });
});

// --- Donner son avis ------------------------------------------------
//
// UN AVIS SUPPOSE UN SERVICE. Trois conditions, dans cet ordre :
// la discussion existe, elle me concerne, et le service est TERMINE.
// Sans la troisieme, on noterait une rencontre qui n'a pas eu lieu.
//
// ECRIT UNE SEULE FOIS pour le site et l'application.

// Les notes proposees, de la meilleure a la moins bonne. Des mots avec
// les chiffres : un chiffre seul ne dit pas ce qu'il vaut.
const ECHELLE_NOTES = [
  { note: 5, libelle: "Excellent" },
  { note: 4, libelle: "Bien" },
  { note: 3, libelle: "Correct" },
  { note: 2, libelle: "Décevant" },
  { note: 1, libelle: "Mauvais" },
];

// Au-dela, le commentaire est refuse plutot que coupe en silence : la
// personne doit savoir que la fin de son texte ne serait pas publiee.
const AVIS_COMMENTAIRE_MAX = 1000;

// L'exemple du champ de commentaire. Ecrit ici, il garde son apostrophe :
// dans la page, il etait devenu "Ce qui s est bien passe".
function exempleCommentaireAvis(jeSuisEmployeur) {
  return jeSuisEmployeur
    ? "Ce qui s'est bien passé, ce qui pourrait être mieux."
    : "Les conditions étaient-elles celles annoncées ?";
}

function avisDejaDonne(conversation) {
  return {
    code: 409,
    titre: "Vous avez déjà donné votre avis",
    texte: "Un seul avis par service. Il ne peut pas être modifié : " +
           "un avis que l'on pourrait réécrire deviendrait un moyen de pression.",
    lien: { url: "/messages/" + conversation.id, texte: "Ouvrir la discussion" },
  };
}

function serviceANoter(candidatureId, utilisateur) {
  const conversation = conversationDe(candidatureId, utilisateur);

  if (!conversation) {
    return {
      probleme: {
        code: 404,
        titre: "Service introuvable",
        texte: "Ce service n'existe pas, ou il ne vous concerne pas.",
        lien: { url: "/messages", texte: "Retour aux discussions" },
      },
    };
  }

  if (!conversation.terminee_le) {
    return {
      conversation,
      probleme: {
        code: 409,
        titre: "Le service n'est pas terminé",
        texte: "On ne donne son avis qu'après un service effectué. " +
               "Vous pourrez le faire dès qu'il aura été déclaré.",
        lien: { url: "/messages/" + conversation.id, texte: "Ouvrir la discussion" },
      },
    };
  }

  // UN SEUL AVIS PAR SERVICE. On ne revient pas dessus : un avis qu'on
  // peut reecrire devient un moyen de pression apres coup.
  if (requetes.monAvisPour.get(conversation.id, utilisateur.id)) {
    return { conversation, probleme: avisDejaDonne(conversation) };
  }

  const jeSuisEmployeur = utilisateur.id === conversation.employeurId;
  return {
    conversation,
    jeSuisEmployeur,
    nomVise: jeSuisEmployeur ? conversation.nomPrestataire : conversation.nomEmployeur,
    viseId: jeSuisEmployeur ? conversation.prestataireId : conversation.employeurId,
  };
}

function donnerAvis(candidatureId, utilisateur, donnees) {
  const service = serviceANoter(candidatureId, utilisateur);
  if (service.probleme) return service;

  const { conversation, viseId } = service;
  const retourFormulaire = { url: "/avis/" + conversation.id, texte: "Retour au formulaire" };

  const note = Math.round(Number(donnees.note));
  if (!Number.isFinite(note) || note < 1 || note > 5) {
    return {
      conversation,
      probleme: {
        code: 400,
        titre: "Note manquante",
        texte: "Choisissez une note de 1 à 5. C'est la seule chose obligatoire.",
        lien: retourFormulaire,
      },
    };
  }

  const commentaire = String(donnees.commentaire || "").trim();
  if (commentaire.length > AVIS_COMMENTAIRE_MAX) {
    return {
      conversation,
      probleme: {
        code: 400,
        titre: "Commentaire trop long",
        texte: `Un commentaire ne peut pas dépasser ${AVIS_COMMENTAIRE_MAX} caractères.`,
        lien: retourFormulaire,
      },
    };
  }

  try {
    requetes.creerAvis.run({
      candidature: conversation.id,
      auteur: utilisateur.id,
      vise: viseId,
      note,
      commentaire: commentaire || null,
      critere1: noteFacultative(donnees.critere1),
      critere2: noteFacultative(donnees.critere2),
      critere3: noteFacultative(donnees.critere3),
      critere4: noteFacultative(donnees.critere4),
    });
  } catch (erreur) {
    // La contrainte UNIQUE reste le dernier rempart : deux envois
    // simultanes passeraient tous deux le controle.
    if (String(erreur.message).includes("UNIQUE")) {
      return { conversation, probleme: avisDejaDonne(conversation) };
    }
    throw erreur;
  }

  return {
    conversation,
    ok: true,
    titre: "Merci pour votre avis",
    texte: "Il est visible par tout le monde, et il ne peut plus être modifié. " +
           "La personne concernée peut le signaler à l'équipe si elle le juge faux.",
  };
}

// --- Signaler un avis a l'equipe ----------------------------------
//
// SEULE LA PERSONNE VISEE. C'est elle que l'avis designe, et c'est elle
// qui sait s'il est faux. Personne ne signale l'avis d'un autre.
function signalerUnAvis(avisId, utilisateur) {
  const avis = requetes.avisParId.get(avisId);

  if (!avis || avis.vise_id !== utilisateur.id) {
    return {
      probleme: {
        code: 404,
        titre: "Avis introuvable",
        texte: "Cet avis n'existe pas, ou il ne vous concerne pas.",
        lien: { url: "/mon-profil", texte: "Retour à mon profil" },
      },
    };
  }

  requetes.signalerAvis.run({ id: avis.id, vise: utilisateur.id });

  return {
    avis,
    ok: true,
    titre: "Signalement envoyé",
    texte: "L'équipe PamConnect va lire cet avis. En attendant, il reste visible : " +
           "un avis n'est masqué qu'après examen.",
  };
}

function afficherProbleme(res, probleme) {
  return res.status(probleme.code).render("message", {
    titre: probleme.titre,
    texte: probleme.texte,
    // Un refus peut proposer deux chemins : Se connecter ou Reessayer.
    liens: probleme.liens || [probleme.lien],
  });
}

app.get("/avis/:id", exigerConnexion, interdireALEquipe, (req, res) => {
  const service = serviceANoter(Number(req.params.id), req.utilisateur);
  if (service.probleme) return afficherProbleme(res, service.probleme);

  res.render("avis", {
    titre: "Donner mon avis",
    conversation: service.conversation,
    jeSuisEmployeur: service.jeSuisEmployeur,
    nomVise: service.nomVise,
    echelle: ECHELLE_NOTES,
    exempleCommentaire: exempleCommentaireAvis(service.jeSuisEmployeur),
    commentaireMax: AVIS_COMMENTAIRE_MAX,
  });
});

app.post("/avis/:id", exigerConnexion, interdireALEquipe, lireFormulaire, (req, res) => {
  const resultat = donnerAvis(Number(req.params.id), req.utilisateur, req.body);
  if (resultat.probleme) return afficherProbleme(res, resultat.probleme);

  res.render("message", {
    titre: resultat.titre,
    texte: resultat.texte,
    liens: [{ url: "/messages/" + resultat.conversation.id, texte: "Retour à la discussion" }],
  });
});

app.post("/avis/:id/signaler", exigerConnexion, interdireALEquipe, lireFormulaire, (req, res) => {
  const resultat = signalerUnAvis(Number(req.params.id), req.utilisateur);
  if (resultat.probleme) return afficherProbleme(res, resultat.probleme);

  res.render("message", {
    titre: resultat.titre,
    texte: resultat.texte,
    liens: [{ url: "/messages/" + resultat.avis.candidature_id, texte: "Retour à la discussion" }],
  });
});

// --- Espace equipe : les avis signales -----------------------------
app.get("/admin/avis", exigerAdmin, (req, res) => {
  res.render("admin-avis", {
    titre: "Les avis",
    avis: requetes.avisSignales.all(),
    derniers: requetes.derniersAvis.all(),
  });
});

app.post("/admin/avis/:id", exigerAdmin, lireFormulaire, (req, res) => {
  const avis = requetes.avisParId.get(Number(req.params.id));

  if (!avis) {
    return res.status(404).render("message", {
      titre: "Avis introuvable",
      texte: "Cet avis n'existe pas.",
      liens: [{ url: "/admin/avis", texte: "Retour aux avis signalés" }],
    });
  }

  const masquer = req.body.decision === "masquer";
  const motif = String(req.body.motif || "").trim();

  // MASQUER EFFACE LA PAROLE DE QUELQU'UN. Cela ne se fait pas sans
  // ecrire pourquoi : la decision doit pouvoir s'expliquer des mois
  // plus tard.
  if (masquer && motif.length < 5) {
    return res.status(400).render("message", {
      titre: "Motif obligatoire",
      texte: "Pour masquer un avis, écrivez le motif. Masquer efface la parole " +
             "de quelqu'un : la décision doit pouvoir être expliquée.",
      liens: [{ url: "/admin/avis", texte: "Retour aux avis signalés" }],
    });
  }

  if (masquer) {
    requetes.masquerAvis.run({ id: avis.id, par: req.utilisateur.id, motif });
  } else {
    requetes.classerAvisSansSuite.run({ id: avis.id });
  }

  res.redirect("/admin/avis");
});

// --- Espace equipe : les problemes signales ------------------------
app.get("/admin/problemes", exigerAdmin, (req, res) => {
  res.render("problemes", {
    titre: "Problèmes signalés",
    problemes: requetes.problemesOuverts.all(),
  });
});

app.post("/admin/problemes/:id", exigerAdmin, lireFormulaire, (req, res) => {
  const probleme = requetes.problemeParId.get(Number(req.params.id));

  if (!probleme) {
    return res.status(404).render("message", {
      titre: "Signalement introuvable",
      texte: "Ce signalement n'existe pas.",
      liens: [{ url: "/admin/problemes", texte: "Retour aux problèmes" }],
    });
  }

  if (probleme.decision) {
    return res.status(409).render("message", {
      titre: "Signalement déjà examiné",
      texte: "Une décision a déjà été prise sur ce signalement.",
      liens: [{ url: "/admin/problemes", texte: "Retour aux problèmes" }],
    });
  }

  // Les memes trois issues que pour un message signale. Un second
  // vocabulaire de sanctions a cote du premier ferait hesiter l'equipe
  // sur ce qu'elle est en train de decider.
  const decisions = ["rien", "avertissement", "sanction"];
  const decision = decisions.includes(req.body.decision) ? req.body.decision : "rien";

  if (decision !== "rien") {
    const motif = String(req.body.motif || "").trim().slice(0, 200);

    if (!motif) {
      return res.status(400).render("message", {
        titre: "Motif obligatoire",
        texte: decision === "sanction"
          ? "Une suspension doit être motivée. Sans motif écrit, personne " +
            "ne pourra expliquer cette décision plus tard."
          : "Un avertissement sans motif n'apprend rien à la personne qui " +
            "le reçoit. Écrivez ce que vous lui reprochez.",
        liens: [{ url: "/admin/problemes", texte: "Retour aux problèmes" }],
      });
    }

    if (decision === "sanction") {
      requetes.suspendreCompte.run({ id: probleme.vise_id, motif });
    } else {
      requetes.avertirCompte.run({ id: probleme.vise_id, motif });
    }
  }

  requetes.classerProbleme.run({
    id: probleme.id,
    decision,
    par: req.utilisateur.id,
  });

  res.redirect("/admin/problemes");
});

// MON COMPTE.
//
// Ce qu'une personne a recu pour ses services, ou ce qu'un employeur
// doit payer apres eux.
//
// Aucune coordonnee bancaire ni Mobile Money n'y est rangee. L'argent ne
// passe pas par la plateforme : l'employeur paie PamConnect apres le
// service, et PamConnect reverse a la personne. Cette page en est la
// TRACE, pas un portefeuille.
//
// Ecrit UNE SEULE FOIS pour le site et l'application : les memes mots et
// les memes nombres des deux cotes.
function monCompte(u) {
  const jeSuisEmployeur = u.role === "employeur";

  return {
    jeSuisEmployeur,
    totalRecu: jeSuisEmployeur
      ? null
      : formaterMontant(requetes.totalReverseA.get(u.id).total),

    // LA PERSONNE RECOIT SON PRIX ENTIER. La commission est ajoutee au
    // prix annonce, elle n'en est pas retiree : ce que l'employeur paie
    // en plus ne sort pas de sa poche a elle.
    recus: jeSuisEmployeur ? [] : requetes.mesServicesPayes.all(u.id).map((p) => ({
      titreDemande: p.titreAnnonce,
      chez: p.nomEmployeur,
      reverse: Boolean(p.reverse_le),
      libelleEtat: p.reverse_le ? "Reversé" : "En attente du reversement",
      lignes: [
        { libelle: "Prix que vous avez annoncé", retenue: false,
          montant: formaterMontant(p.prix_prestataire), total: false },
        { libelle: p.reverse_le ? "PamConnect vous a reversé" : "PamConnect vous reversera",
          montant: formaterMontant(p.reverse_le ? p.montant_reverse : p.prix_prestataire),
          retenue: false, total: true },
      ],
      verseLe: p.reverse_le ? dateLisible(p.reverse_le) : null,
      moyen: p.moyen_reversement || null,
    })),

    envoyes: jeSuisEmployeur ? requetes.mesServicesAPayer.all(u.id).map((p) => ({
      titreDemande: p.titreAnnonce,
      avec: p.nomPrestataire,
      etat: p.recu_le ? "paye" : "a_payer",
      libelleEtat: p.recu_le ? "Payé à PamConnect" : "À payer après le service",
      montant: formaterMontant(p.recu_le ? p.montant_recu : p.prix_employeur),
      convenuLe: dateLisible(p.appel_employeur_le),
      paye: p.recu_le
        ? `Reçu le ${dateLisible(p.recu_le)}` + (p.moyen_reception ? ` (${p.moyen_reception})` : "")
        : null,
      // L'OBLIGATION, ecrite la ou le paiement est encore du.
      rappelPaiement: !p.recu_le,
      serviceTermine: Boolean(p.serviceTermineLe),
    })) : [],
  };
}

app.get("/mon-compte", exigerConnexion, interdireALEquipe, (req, res) => {
  const compte = monCompte(req.utilisateur);

  res.render("compte", {
    titre: "Mon compte",
    jeSuisEmployeur: compte.jeSuisEmployeur,
    totalRecu: compte.totalRecu,
    recus: compte.recus,
    envoyes: compte.envoyes,
  });
});

// --- Mes jetons ----------------------------------------------------
//
// PAGE COMMUNE AUX DEUX ROLES, et c'est voulu : les deux achetent des
// jetons au meme prix, sur le meme ecran. Ce qui differe, c'est
// seulement CE QU'ON EN FAIT - mettre une demande en avant d'un cote,
// repondre a une demande de l'autre - et cette phrase-la depend du role.
//
// Un membre de l'equipe n'en a pas : il ne publie ni ne repond.
//
// Tout ce que la page decide est ecrit ICI, UNE SEULE FOIS : le site et
// l'application lisent les memes phrases et les memes nombres.
function mesJetons(u) {
  // Les jetons offerts arrivent ici, et les perimes partent ici. Ne rien
  // faire tant que personne ne regarde couterait une tache de fond, pour
  // un resultat qu'on ne verrait qu'en ouvrant cette page.
  const mouvement = mettreAJourLesJetons(u);

  const jeSuisEmployeur = u.role === "employeur";
  const solde = soldeJetonsDe(u.id);
  const expiration = requetes.expirationJetonsOfferts.get(u.id);
  const valeurJeton = valeurDuJeton();

  // Ce que coute UNE action pour cette personne-la. La page s'en sert
  // pour dire ce que son solde permet - au lieu d'afficher un nombre
  // de jetons dont personne ne sait ce qu'il vaut.
  const coutAction = coutDeLAction();
  const possible = coutAction ? Math.floor(solde.total / coutAction) : 0;

  return {
    jeSuisEmployeur,

    // La perte est un evenement : on la dit une fois.
    perdusMaintenant: mouvement.perdus || null,

    cout: coutAction ? jetonsEnClair(coutAction) : null,
    permet: coutAction && solde.total > 0 && possible > 0
      ? actionsPossibles(jeSuisEmployeur, possible) : null,
    manque: coutAction && solde.total > 0 && possible === 0
      ? jetonsEnClair(coutAction - solde.total) : null,

    // LE SOLDE, EN DEUX PARTS. Les melanger cacherait ce qui va expirer.
    soldeTotal: jetonsEnClair(solde.total),
    offerts: solde.offerts,
    achetes: solde.achetes,
    // La date n'est annoncee que s'il reste vraiment des jetons offerts.
    expireLe: solde.offerts > 0 && expiration && expiration.quand
      ? dateLisible(expiration.quand) : null,
    soldeVide: solde.total === 0,
    // Une personne non verifiee n'a rien a acheter tout de suite : des
    // jetons l'attendent.
    verificationAFaire: u.statut_verification !== "verifie",

    valeurJeton: valeurJeton === null ? null : formaterMontant(valeurJeton),
    demandeEnCours: Boolean(requetes.achatJetonsEnAttentePour.get(u.id)),
    uneAction: uneAction(jeSuisEmployeur),

    // CE QUE CHAQUE PACK DONNERA A CETTE PERSONNE, son solde actuel
    // compris : le total apres achat, et ce qu'il permet.
    packs: packsEnVente().map((pack) => {
      const apres = solde.total + pack.quantite;
      const combien = coutAction ? Math.floor(apres / coutAction) : 0;
      return {
        quantite: pack.quantite,
        prix: formaterMontant(pack.prix),
        apres: coutAction ? apres : null,
        dequoi: coutAction && combien > 0 ? actionsPossibles(jeSuisEmployeur, combien) : null,
        manqueEncore: coutAction && combien === 0 ? coutAction - apres : null,
      };
    }),

    achats: requetes.mesAchatsJetons.all(u.id).map((achat) => ({
      quantite: achat.quantite,
      etat: achat.etat,
      libelleEtat: achat.etat === "en attente" ? "En attente de confirmation"
        : achat.etat === "confirme" ? "Jetons ajoutés"
        : "Refusée",
      montant: formaterMontant(achat.montant),
      demandeLe: dateLisible(achat.cree_le),
      motifRefus: achat.etat === "refuse" && achat.motif_refus ? achat.motif_refus : null,
    })),

    // L'HISTORIQUE COMPLET. Une plateforme qui prend un jeton doit
    // pouvoir dire quand, et pour quoi.
    mouvements: requetes.mesMouvementsJetons.all(u.id).map((m) => ({
      libelle: m.detail || motifJetonsLisible(m.motif),
      date: dateLisible(m.cree_le) + (m.nature === "offert" ? ", jetons offerts" : ""),
      quantite: m.quantite < 0 ? `− ${Math.abs(m.quantite)}` : `+ ${m.quantite}`,
      retrait: m.quantite < 0,
    })),
  };
}

app.get("/mes-jetons", exigerConnexion, interdireALEquipe, (req, res) => {
  res.render("jetons", { titre: "Mes jetons", jetons: mesJetons(req.utilisateur) });
});

// --- Demander un pack de jetons ------------------------------------
//
// UNE DEMANDE, PAS UN PAIEMENT. Rien n'est encaisse ici : la demande est
// enregistree au prix du serveur, et l'equipe credite les jetons a la
// main une fois le paiement constate.
function demanderUnPack(u, quantiteSaisie) {
  const retour = { url: "/mes-jetons", texte: "Retour à mes jetons" };

  // LE PRIX NE VIENT JAMAIS DU FORMULAIRE. On ne retient que la
  // quantite demandee, et on relit le prix dans les packs du serveur.
  // Sinon n'importe qui pourrait renvoyer la page en ecrivant 60 jetons
  // pour 1 FCFA.
  const quantite = Math.round(Number(quantiteSaisie) || 0);
  const pack = packsEnVente().find((p) => p.quantite === quantite);

  if (!pack) {
    return {
      probleme: {
        code: 400,
        titre: "Ce pack n'existe pas",
        texte: "Ce pack n'est plus en vente. Choisissez-en un dans la liste.",
        lien: retour,
      },
    };
  }

  // UNE SEULE DEMANDE A LA FOIS. Deux demandes identiques en attente
  // sont presque toujours un double clic, et l'equipe ne saurait pas
  // laquelle confirmer.
  if (requetes.achatJetonsEnAttentePour.get(u.id)) {
    return {
      probleme: {
        code: 409,
        titre: "Une demande est déjà en cours",
        texte: "Votre demande précédente attend la confirmation de l'équipe. " +
               "Vous pourrez en envoyer une autre une fois celle-ci traitée.",
        lien: retour,
      },
    };
  }

  requetes.creerAchatJetons.run({
    personne: u.id,
    quantite: pack.quantite,
    montant: pack.prix,
  });

  return {
    ok: true,
    titre: "Demande enregistrée",
    texte: `Votre demande de ${pack.quantite} jetons pour ` +
           `${formaterMontant(pack.prix)} est enregistrée. Vos jetons seront ` +
           `ajoutés à votre solde dès que l'équipe aura confirmé le paiement.`,
  };
}

app.post("/mes-jetons/acheter", exigerConnexion, interdireALEquipe, lireFormulaire, (req, res) => {
  const resultat = demanderUnPack(req.utilisateur, req.body.quantite);
  if (resultat.probleme) return afficherProbleme(res, resultat.probleme);

  res.render("message", {
    titre: resultat.titre,
    texte: resultat.texte,
    liens: [{ url: "/mes-jetons", texte: "Voir mes jetons" }],
  });
});

// --- Espace equipe : mettre deux personnes en relation -------------
//
// C'EST ICI QUE LE PRIX SE FIXE, et nulle part ailleurs sur la
// plateforme. L'equipe appelle la personne qui fera le travail, ecrit le
// prix qu'elle annonce, puis appelle l'employeur et lui annonce ce prix
// augmente de la commission.
//
// DEUX APPELS, DEUX MOMENTS. Le premier ouvre la fiche, le second la
// conclut. Les confondre supposerait que l'employeur repond toujours du
// premier coup, et qu'un refus n'existe pas.
function ecranMisesEnRelation() {
  const demandes = requetes.demandesATraiter.all().map((a) => {
    const enCours = requetes.ficheEnCours.get(a.id);

    return {
      id: a.id,
      titre: a.titre,
      metier: a.metier,
      quartier: a.quartier,
      arrondissement: a.arrondissement,
      horaire: a.horaire,
      dureeEstimee: a.duree_estimee,
      // LE BUDGET NE SORT PAS D'ICI : il aide l'equipe a savoir quel
      // prix l'employeur acceptera, il n'est montre a personne d'autre.
      budget: a.budget != null ? formaterMontant(a.budget) : null,
      publieeLe: dateLisible(a.cree_le),
      pourvue: a.annulee === 1,

      employeur: {
        id: a.employeurId,
        nom: a.nomEmployeur,
        telephone: a.telephoneEmployeur ? formaterTelephone(a.telephoneEmployeur) : null,
        appel: a.telephoneEmployeur ? "+237" + a.telephoneEmployeur : null,
        verifie: a.verificationEmployeur === "verifie",
      },

      interesses: requetes.interessesDeLaDemande.all(a.id).map(personneAAppeler),
      autres: a.metier
        ? requetes.autresPrestatairesPour.all({
            metier: a.metier, quartier: a.quartier || "", annonce: a.id,
          }).map(personneAAppeler)
        : [],

      fiche: enCours ? ficheLisible(enCours) : null,
      refusees: requetes.fichesRefusees.all(a.id).map((m) => ({
        nom: m.nomPrestataire,
        prix: formaterMontant(m.prix_employeur),
        note: m.note,
      })),
    };
  });

  return { demandes };
}

// Une personne que l'equipe peut appeler : son nom, son numero, et de
// quoi decider s'il vaut la peine de l'appeler.
function personneAAppeler(p) {
  return {
    id: p.prestataireId,
    nom: p.nom,
    metier: p.metier,
    quartier: p.quartier,
    tarif: p.tarif ? formaterMontant(p.tarif) : null,
    telephone: p.telephone ? formaterTelephone(p.telephone) : null,
    appel: p.telephone ? "+237" + p.telephone : null,
    moyenne: p.moyenne,
    verifie: p.verification ? p.verification === "verifie" : true,
    enAvant: p.enAvant === 1,
    dejaChoisie: p.statut === "acceptee",
  };
}

function ficheLisible(m) {
  return {
    id: m.id,
    nom: m.nomPrestataire,
    telephone: m.telephonePrestataire ? formaterTelephone(m.telephonePrestataire) : null,
    appel: m.telephonePrestataire ? "+237" + m.telephonePrestataire : null,
    prixPrestataire: formaterMontant(m.prix_prestataire),
    commission: formaterMontant(m.commission),
    prixEmployeur: formaterMontant(m.prix_employeur),
    appeleeLe: dateLisible(m.appel_prestataire_le),
    note: m.note,
  };
}

app.get("/admin/mises-en-relation", exigerAdmin, (req, res) => {
  res.render("mises-en-relation", Object.assign(
    { titre: "Mises en relation" }, ecranMisesEnRelation()));
});

// L'EQUIPE A APPELE LA PERSONNE : elle ecrit le prix annonce.
function ouvrirMiseEnRelation(admin, donnees) {
  const annonce = requetes.annonceParId.get(Number(donnees.annonceId));

  if (!annonce) {
    return { probleme: { code: 404, titre: "Demande introuvable",
      texte: "Cette demande n'existe plus." } };
  }

  if (requetes.ficheEnCours.get(annonce.id)) {
    return { probleme: { code: 409, titre: "Une fiche attend déjà",
      texte: "Vous avez déjà enregistré un prix pour cette demande. Notez " +
             "d'abord la réponse de l'employeur." } };
  }

  const personne = requetes.utilisateurParId.get(Number(donnees.prestataireId));

  if (!personne || personne.role !== "prestataire" || personne.est_admin) {
    return { probleme: { code: 400, titre: "Personne introuvable",
      texte: "Choisissez la personne que vous venez d'appeler." } };
  }

  // L'EQUIPE NE MET EN RELATION QUE DES IDENTITES CONTROLEES. Envoyer
  // quelqu'un chez un particulier sans avoir vu ses pièces serait le
  // contraire de ce que la plateforme promet.
  if (personne.statut_verification !== "verifie") {
    return { probleme: { code: 409, titre: "Identité non vérifiée",
      texte: "Cette personne n'a pas encore été vérifiée. Traitez son dossier " +
             "avant de la mettre en relation." } };
  }

  const saisi = Math.round(Number(String(donnees.prix || "").trim()));

  if (!(saisi > 0) || !montantAccepte(saisi)) {
    return { probleme: { code: 400, titre: "Prix à revoir",
      texte: `Écrivez le prix annoncé par la personne : ${regleMontantLisible()}.` } };
  }

  const detail = prixAvecCommission(saisi);

  requetes.creerMiseEnRelation.run({
    annonce: annonce.id,
    prestataire: personne.id,
    prix: detail.prix,
    commission: detail.commission,
    prixEmployeur: detail.prixEmployeur,
    note: String(donnees.note || "").trim().slice(0, 200) || null,
    par: admin.id,
  });

  return { ok: true };
}

app.post("/admin/mises-en-relation", exigerAdmin, lireFormulaire, (req, res) => {
  const resultat = ouvrirMiseEnRelation(req.utilisateur, req.body);

  if (resultat.probleme) {
    return afficherProbleme(res, Object.assign({}, resultat.probleme,
      { lien: { url: "/admin/mises-en-relation", texte: "Retour aux mises en relation" } }));
  }

  res.redirect("/admin/mises-en-relation");
});

// L'EQUIPE A APPELE L'EMPLOYEUR : il accepte le prix, ou il le refuse.
//
// TOUT OU RIEN quand il accepte : la personne est retenue, les autres
// sont prevenues, et la demande quitte la liste. Une fiche acceptee sur
// une demande restee ouverte laisserait d'autres personnes repondre a
// une place deja prise.
function noterReponseEmployeur(admin, ficheId, donnees) {
  const fiche = requetes.miseEnRelationParId.get(ficheId);

  if (!fiche) {
    return { probleme: { code: 404, titre: "Fiche introuvable",
      texte: "Cette mise en relation n'existe pas." } };
  }

  if (fiche.statut !== "en cours") {
    return { probleme: { code: 409, titre: "Cette fiche est déjà conclue",
      texte: "L'employeur a déjà répondu. On ne rejuge pas une mise en relation " +
             "déjà notée : la trace du premier appel disparaîtrait." } };
  }

  const accepte = donnees.decision === "accepte";
  const note = String(donnees.note || "").trim().slice(0, 200) || null;

  db.transaction(() => {
    requetes.reponseDeLEmployeur.run({
      id: fiche.id,
      statut: accepte ? "acceptee" : "refusee",
      note,
    });

    if (!accepte) return;

    // La personne a peut-etre signale son interet, ou l'equipe l'a
    // trouvee elle-meme : dans ce cas sa reponse est creee ici, car
    // c'est elle qui ouvre la discussion entre les deux.
    let candidature = requetes.maCandidaturePour.get(fiche.annonce_id, fiche.prestataire_id);

    if (!candidature) {
      const pose = requetes.creerCandidature.run(fiche.annonce_id, fiche.prestataire_id);
      candidature = { id: pose.lastInsertRowid };
    }

    requetes.changerStatutCandidature.run("acceptee", candidature.id);
    requetes.refuserLesAutres.run({ annonce: fiche.annonce_id, choisie: candidature.id });
    requetes.annulerAnnonce.run({ id: fiche.annonce_id });
  })();

  return { ok: true };
}

app.post("/admin/mises-en-relation/:id/reponse", exigerAdmin, lireFormulaire, (req, res) => {
  const resultat = noterReponseEmployeur(req.utilisateur, Number(req.params.id), req.body);

  if (resultat.probleme) {
    return afficherProbleme(res, Object.assign({}, resultat.probleme,
      { lien: { url: "/admin/mises-en-relation", texte: "Retour aux mises en relation" } }));
  }

  res.redirect("/admin/mises-en-relation");
});

// --- UN MOT DE PASSE OUBLIE ----------------------------------------
//
// AUCUN EMAIL N'EST ENVOYE. La plateforme n'a pas de service d'envoi, et
// le numero de telephone, lui, est deja au dossier : c'est par la que
// l'equipe joint les gens tous les jours.
//
// Trois moments, et trois personnes differentes :
//
//   1. la personne demande de l'aide depuis l'ecran de connexion ;
//   2. l'equipe appelle LE NUMERO DEJA ENREGISTRE, s'assure que c'est
//      bien elle, et lui lit un code a six chiffres ;
//   3. la personne entre ce code et choisit ELLE-MEME son mot de passe.
//
// L'EQUIPE NE CONNAIT JAMAIS LE MOT DE PASSE. Elle ouvre la porte, elle
// n'entre pas. Reste qu'une porte existe : quelqu'un de l'equipe
// pourrait delivrer un code et s'en servir. C'est pourquoi le nom de qui
// l'a delivre est garde, et la date du changement s'affiche sur le
// profil de la personne - un abus se voit.
const CODE_VALIDE_MINUTES = 30;
const CODE_ESSAIS_MAX = 5;

// Six chiffres, tires au hasard : assez court pour etre lu au telephone,
// assez large pour qu'on ne le devine pas en cinq essais.
function tirerUnCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

// La meme reponse, que le compte existe ou non. Dire "cette adresse est
// inconnue" apprendrait a n'importe qui quelles adresses ont un compte.
const DEMANDE_DE_CODE_ENVOYEE = {
  titre: "L'équipe va vous appeler",
  texte: "Si un compte porte cette adresse, l'équipe PamConnect appellera le " +
         "numéro de téléphone qui y est enregistré et vous donnera un code. " +
         "Gardez votre téléphone près de vous.",
};

app.get("/mot-de-passe-oublie", (req, res) => {
  res.render("mot-de-passe-oublie", { titre: "Mot de passe oublié" });
});

app.post("/mot-de-passe-oublie", lireFormulaire, (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const utilisateur = requetes.utilisateurParEmail.get(email);

  // Une personne ajoutee par l'equipe n'a pas de compte a rouvrir : elle
  // n'en a jamais ouvert un.
  if (utilisateur && !utilisateur.est_admin && !utilisateur.ajoute_par) {
    requetes.demanderUnCode.run({ id: utilisateur.id });
  }

  res.render("message", {
    titre: DEMANDE_DE_CODE_ENVOYEE.titre,
    texte: DEMANDE_DE_CODE_ENVOYEE.texte,
    liens: [{ url: "/nouveau-mot-de-passe", texte: "J'ai reçu mon code" }],
  });
});

// L'EQUIPE A APPELE : elle lit le code a la personne. Il n'est affiche
// qu'ICI, une seule fois, et range hache : personne ne peut le relire.
app.post("/admin/utilisateurs/:id/code", exigerAdmin, lireFormulaire, (req, res) => {
  const personne = requetes.utilisateurParId.get(Number(req.params.id));

  if (!personne || personne.est_admin) {
    return afficherProbleme(res, { code: 404, titre: "Personne introuvable",
      texte: "Ce compte n'existe pas, ou c'est un compte de l'équipe.",
      lien: { url: "/admin/utilisateurs", texte: "Retour à l'annuaire" } });
  }

  if (personne.ajoute_par) {
    return afficherProbleme(res, { code: 409, titre: "Cette personne n'a pas de compte en ligne",
      texte: "Sa fiche a été ajoutée par l'équipe : il n'y a pas d'accès à rouvrir. " +
             "Elle peut s'inscrire elle-même avec sa propre adresse.",
      lien: { url: "/admin/utilisateurs", texte: "Retour à l'annuaire" } });
  }

  if (personne.suspendu) {
    return afficherProbleme(res, { code: 409, titre: "Ce compte est suspendu",
      texte: "Rouvrir l'accès d'un compte suspendu n'aurait aucun effet : la porte " +
             "reste fermée tant que la suspension dure.",
      lien: { url: "/admin/utilisateurs", texte: "Retour à l'annuaire" } });
  }

  const code = tirerUnCode();

  requetes.poserUnCode.run({
    id: personne.id,
    code: hacherMotDePasse(code),
    duree: `+${CODE_VALIDE_MINUTES} minutes`,
    par: req.utilisateur.id,
  });

  res.render("code-donne", {
    titre: "Code à lire au téléphone",
    personne: {
      nom: personne.nom,
      telephone: personne.telephone ? formaterTelephone(personne.telephone) : null,
      appel: personne.telephone ? "+237" + personne.telephone : null,
    },
    code,
    minutes: CODE_VALIDE_MINUTES,
  });
});

app.get("/nouveau-mot-de-passe", (req, res) => {
  res.render("nouveau-mot-de-passe", { titre: "Choisir un nouveau mot de passe" });
});

function reouvrirAvecUnCode(donnees) {
  const email = String(donnees.email || "").trim().toLowerCase();
  const code = String(donnees.code || "").trim();
  const utilisateur = requetes.utilisateurParEmail.get(email);

  // LA MEME REPONSE POUR TOUT CE QUI RATE. Distinguer "adresse inconnue"
  // de "code faux" dirait quelles adresses ont un compte, et lesquelles
  // attendent un code.
  const refus = { code: 401, titre: "Code refusé",
    texte: "Ce code ne correspond pas, ou il n'est plus valable. L'équipe peut " +
           "vous en donner un autre.",
    lien: { url: "/mot-de-passe-oublie", texte: "Demander un nouveau code" } };

  if (!utilisateur || !utilisateur.code_connexion || utilisateur.suspendu) {
    return { probleme: refus };
  }

  // CINQ ESSAIS. Au-dela, le code est efface : six chiffres se devinent
  // en un million de tentatives, pas en cinq, mais un code qu'on peut
  // essayer sans fin finit par tomber.
  if (utilisateur.code_essais >= CODE_ESSAIS_MAX) {
    requetes.effacerLeCode.run(utilisateur.id);
    return { probleme: refus };
  }

  const expire = String(utilisateur.code_expire_le || "").replace(" ", "T") + "Z";
  if (!utilisateur.code_expire_le || Date.parse(expire) < Date.now()) {
    return { probleme: refus };
  }

  if (!verifierMotDePasse(code, utilisateur.code_connexion)) {
    requetes.compterUnEssai.run(utilisateur.id);
    return { probleme: refus };
  }

  const nouveau = String(donnees.motdepasse || "");

  if (nouveau.length < MOT_DE_PASSE_MIN) {
    return { probleme: { code: 400, titre: "Mot de passe trop court",
      texte: `Choisissez un mot de passe d'au moins ${MOT_DE_PASSE_MIN} caractères.`,
      lien: { url: "/nouveau-mot-de-passe", texte: "Réessayer" } } };
  }

  requetes.poserNouveauMotDePasse.run({
    id: utilisateur.id,
    motdepasse: hacherMotDePasse(nouveau),
  });

  return { ok: true, nom: utilisateur.nom };
}

app.post("/nouveau-mot-de-passe", lireFormulaire, (req, res) => {
  const resultat = reouvrirAvecUnCode(req.body);
  if (resultat.probleme) return afficherProbleme(res, resultat.probleme);

  res.render("message", {
    titre: "Votre mot de passe est changé",
    texte: "Vous pouvez vous connecter avec votre nouveau mot de passe. La date de " +
           "ce changement est inscrite sur votre profil.",
    liens: [{ url: "/connexion", texte: "Se connecter" }],
  });
});

// --- Espace equipe : l'annuaire ------------------------------------
//
// LA LISTE DE CEUX QU'ON PEUT APPELER. Elle reunit deux populations que
// l'equipe traite de la meme facon : les personnes inscrites elles-memes,
// et celles qu'elle a rencontrees et ajoutees - un menuisier sans
// telephone intelligent reste quelqu'un a qui confier un service.
//
// D'OU VIENT CHAQUE FICHE EST ECRIT SUR CHACUNE. Une personne ajoutee par
// l'equipe n'a pas de compte en ligne : elle n'a choisi aucun mot de
// passe, et on n'en invente pas a sa place.
function ecranAnnuaire(criteres) {
  const cherche = String(criteres.q || "").trim().slice(0, 60);
  const role = criteres.role === "employeur" || criteres.role === "prestataire"
    ? criteres.role : "";
  const origine = criteres.origine === "inscrit" || criteres.origine === "ajoute"
    ? criteres.origine : "";

  const lignes = requetes.annuaire.all({
    role,
    origine,
    motif: "%" + cherche.toLowerCase() + "%",
  });

  return {
    cherche,
    role,
    origine,
    total: requetes.nombreDansLAnnuaire.get().n,
    personnes: lignes.map((p) => ({
      id: p.id,
      nom: p.nom,
      estEmployeur: p.role === "employeur",
      // Le metier pour celle qui travaille, le dernier besoin pour celui
      // qui cherche : dans les deux cas, ce que l'equipe veut savoir
      // avant d'appeler.
      quoi: p.role === "prestataire" ? p.metier : p.dernierBesoin,
      quartier: p.quartier,
      arrondissement: p.arrondissement,
      telephone: p.telephone ? formaterTelephone(p.telephone) : null,
      appel: p.telephone ? "+237" + p.telephone : null,
      // L'adresse de connexion d'un compte inscrit, ou celle que
      // l'equipe a notee pour une personne ajoutee.
      email: p.ajoute_par ? p.email_contact : null,
      tarif: p.tarif ? formaterMontant(p.tarif) : null,
      verification: p.statut_verification,
      suspendu: p.suspendu === 1,
      ajoutee: Boolean(p.ajoute_par),
      attendUnCode: Boolean(p.code_demande_le),
      parQui: p.nomAjoutePar,
      inscriteLe: dateLisible(p.cree_le),
      services: p.role === "prestataire" ? p.servicesFaits : p.demandesPubliees,
    })),
  };
}

app.get("/admin/utilisateurs", exigerAdmin, (req, res) => {
  res.render("annuaire", Object.assign({ titre: "Annuaire" }, ecranAnnuaire(req.query)));
});

function ajouterAuRepertoire(admin, donnees) {
  const nom = String(donnees.nom || "").trim().slice(0, 80);

  if (nom.length < 2) {
    return { probleme: { code: 400, titre: "Nom manquant",
      texte: "Écrivez le nom de la personne, tel qu'elle le donne." } };
  }

  const role = donnees.role === "employeur" ? "employeur" : "prestataire";

  const telephone = lireTelephone(donnees);
  if (telephone.probleme) {
    return { probleme: Object.assign({ code: 400 }, telephone.probleme) };
  }

  // DEUX FICHES POUR LA MEME PERSONNE seraient pires que pas de fiche :
  // l'equipe appellerait deux fois, sans savoir laquelle est a jour.
  const deja = requetes.personneParTelephone.get(telephone.numero);
  if (deja) {
    return { probleme: { code: 409, titre: "Ce numéro est déjà connu",
      texte: `${deja.nom} porte déjà ce numéro dans l'annuaire.` } };
  }

  const metier = String(donnees.metier || "").trim().slice(0, 60);

  if (role === "prestataire" && !metier) {
    return { probleme: { code: 400, titre: "Métier manquant",
      texte: "Dites ce que cette personne sait faire : c'est ce qui la fera " +
             "trouver quand une demande arrivera." } };
  }

  // L'ADRESSE EMAIL, SI LA PERSONNE EN A UNE. Facultative : beaucoup de
  // gens n'en ont pas, et on n'en invente pas a leur place. Elle sert a
  // les joindre, jamais a les connecter - son compte ne s'ouvre pas.
  const contact = String(donnees.email || "").trim().toLowerCase().slice(0, 120);

  if (contact && !adresseEmailValide(contact)) {
    return { probleme: { code: 400, titre: "Adresse email à revoir",
      texte: "Écrivez une adresse complète, ou laissez la case vide." } };
  }

  const tarifSaisi = String(donnees.tarif || "").trim();
  const tarif = tarifSaisi ? Math.round(Number(tarifSaisi)) : null;

  if (tarifSaisi && (!(tarif > 0) || !montantAccepte(tarif))) {
    return { probleme: { code: 400, titre: "Tarif à revoir",
      texte: `Le tarif souhaité doit être ${regleMontantLisible()}, ou laissé vide.` } };
  }

  // Le quartier se reconnait comme partout ailleurs : les accents et les
  // orthographes declarees sont rattrapes, et l'arrondissement suit.
  const lieu = quartiersParCle.get(normaliserNom(String(donnees.quartier || "")));

  // L'EQUIPE PEUT AVOIR VU LA PIECE EN MAIN. C'est le seul cas ou une
  // identite est validee sans dossier envoye : quelqu'un de l'equipe a
  // rencontre la personne. La case est decochee par defaut, et une fiche
  // non validee ne sera pas proposee pour une mise en relation.
  const vue = donnees.piece_vue === "oui";

  const pose = requetes.ajouterPersonne.run({
    role,
    nom,
    // L'IDENTIFIANT DE CONNEXION est technique, et il l'est meme quand
    // l'equipe a note une adresse : celle-ci reste libre pour le jour ou
    // la personne voudra s'inscrire elle-meme.
    email: "annuaire-" + telephone.numero,
    contact: contact || null,
    telephone: telephone.numero,
    motdepasse: motDePasseImpossible(),
    arrondissement: lieu ? lieu.arrondissement : null,
    quartier: lieu ? lieu.nom : (String(donnees.quartier || "").trim().slice(0, 60) || null),
    metier: role === "prestataire" ? metier : null,
    tarif: role === "prestataire" ? tarif : null,
    par: admin.id,
  });

  if (vue) requetes.validerVerification.run(pose.lastInsertRowid);

  return { ok: true };
}

app.post("/admin/utilisateurs", exigerAdmin, lireFormulaire, (req, res) => {
  const resultat = ajouterAuRepertoire(req.utilisateur, req.body);

  if (resultat.probleme) {
    return afficherProbleme(res, Object.assign({}, resultat.probleme,
      { lien: { url: "/admin/utilisateurs", texte: "Retour à l'annuaire" } }));
  }

  res.redirect("/admin/utilisateurs");
});

// --- Espace equipe : les paiements ---------------------------------
//
// LA PLATEFORME NE DEPLACE PAS D'ARGENT, elle en garde la trace.
// L'employeur paie PamConnect apres le service, PamConnect reverse a la
// personne, et l'equipe ecrit ici ce qui est entre et ce qui est sorti.
//
// Deux enregistrements separes : recevoir et reverser ne se font pas le
// meme jour, et un ecran qui les confondrait empecherait de dire ou en
// est l'argent de quelqu'un.
function ecranPaiements() {
  const services = requetes.misesEnRelationAcceptees.all().map((m) => ({
    id: m.id,
    titreDemande: m.titreAnnonce,
    metier: m.metierAnnonce,
    employeur: m.nomEmployeur,
    appelEmployeur: m.telephoneEmployeur ? "+237" + m.telephoneEmployeur : null,
    telephoneEmployeur: m.telephoneEmployeur ? formaterTelephone(m.telephoneEmployeur) : null,
    prestataire: m.nomPrestataire,
    appelPrestataire: m.telephonePrestataire ? "+237" + m.telephonePrestataire : null,
    telephonePrestataire: m.telephonePrestataire ? formaterTelephone(m.telephonePrestataire) : null,

    prixPrestataire: formaterMontant(m.prix_prestataire),
    commission: formaterMontant(m.commission),
    prixEmployeur: formaterMontant(m.prix_employeur),

    serviceTermine: Boolean(m.serviceTermineLe),
    convenuLe: dateLisible(m.appel_employeur_le),

    recu: m.recu_le ? {
      montant: formaterMontant(m.montant_recu),
      date: dateLisible(m.recu_le),
      moyen: m.moyen_reception,
    } : null,

    reverse: m.reverse_le ? {
      montant: formaterMontant(m.montant_reverse),
      date: dateLisible(m.reverse_le),
      moyen: m.moyen_reversement,
    } : null,

    // Ce qu'il reste a faire, en un mot : l'ecran s'en sert pour ranger
    // et pour colorer.
    etat: !m.recu_le ? "a_recevoir" : !m.reverse_le ? "a_reverser" : "termine",
  }));

  return { services };
}

app.get("/admin/paiements", exigerAdmin, (req, res) => {
  res.render("paiements", Object.assign({ titre: "Paiements" }, ecranPaiements()));
});

const MOYENS_DE_PAIEMENT = ["Agence PamConnect", "Mobile Money", "Espèces"];

function enregistrerUnMouvement(admin, relationId, donnees, sens) {
  const fiche = requetes.miseEnRelationParId.get(relationId);

  if (!fiche || fiche.statut !== "acceptee") {
    return { probleme: { code: 404, titre: "Service introuvable",
      texte: "Aucune mise en relation acceptée ne correspond." } };
  }

  const paiement = requetes.paiementDeLaRelation.get(fiche.id);

  if (sens === "reverse" && !(paiement && paiement.recu_le)) {
    return { probleme: { code: 409, titre: "Rien à reverser",
      texte: "Enregistrez d'abord le montant reçu de l'employeur : on ne reverse " +
             "pas une somme qui n'est pas arrivée." } };
  }

  if (sens === "recu" && paiement && paiement.recu_le) {
    return { probleme: { code: 409, titre: "Paiement déjà enregistré",
      texte: "Le montant reçu pour ce service est déjà noté." } };
  }

  if (sens === "reverse" && paiement && paiement.reverse_le) {
    return { probleme: { code: 409, titre: "Reversement déjà enregistré",
      texte: "Le reversement de ce service est déjà noté." } };
  }

  const montant = Math.round(Number(String(donnees.montant || "").trim()));

  if (!(montant > 0)) {
    return { probleme: { code: 400, titre: "Montant à revoir",
      texte: "Écrivez en chiffres le montant que vous avez réellement manipulé." } };
  }

  const moyen = MOYENS_DE_PAIEMENT.includes(donnees.moyen) ? donnees.moyen : null;

  if (!moyen) {
    return { probleme: { code: 400, titre: "Moyen manquant",
      texte: "Dites comment l'argent est passé : à l'agence, par Mobile Money " +
             "ou en espèces." } };
  }

  db.transaction(() => {
    if (!paiement) requetes.ouvrirPaiement.run({ relation: fiche.id, par: admin.id });

    const ecrire = sens === "recu"
      ? requetes.enregistrerReception
      : requetes.enregistrerReversement;

    ecrire.run({ relation: fiche.id, montant, moyen, par: admin.id });
  })();

  return { ok: true };
}

app.post("/admin/paiements/:id/recu", exigerAdmin, lireFormulaire, (req, res) => {
  const resultat = enregistrerUnMouvement(req.utilisateur, Number(req.params.id), req.body, "recu");

  if (resultat.probleme) {
    return afficherProbleme(res, Object.assign({}, resultat.probleme,
      { lien: { url: "/admin/paiements", texte: "Retour aux paiements" } }));
  }

  res.redirect("/admin/paiements");
});

app.post("/admin/paiements/:id/reverse", exigerAdmin, lireFormulaire, (req, res) => {
  const resultat = enregistrerUnMouvement(req.utilisateur, Number(req.params.id), req.body, "reverse");

  if (resultat.probleme) {
    return afficherProbleme(res, Object.assign({}, resultat.probleme,
      { lien: { url: "/admin/paiements", texte: "Retour aux paiements" } }));
  }

  res.redirect("/admin/paiements");
});

// --- Espace equipe : les jetons ------------------------------------
app.get("/admin/jetons", exigerAdmin, (req, res) => {
  res.render("admin-jetons", {
    titre: "Jetons",
    achats: requetes.achatsJetonsEnAttente.all(),
    traites: requetes.derniersAchatsJetonsTraites.all(),
    valeurJeton: valeurDuJeton(),
    packs: packsEnVente(),
    coutMiseEnAvant: parametreNombre("cout_mise_en_avant"),
    candidaturesParJour: parametreNombre("candidatures_par_jour"),
    dureeMiseEnAvant: parametreNombre("duree_mise_en_avant_jours"),
    bienvenueEmployeur: parametreNombre("bienvenue_employeur"),
    bienvenuePrestataire: parametreNombre("bienvenue_prestataire"),
    bienvenueJours: parametreNombre("bienvenue_jours"),
    dernierChangement: requetes.dernierChangementPrix.get() || null,
  });
});

// CONFIRMER OU REFUSER UNE DEMANDE D'ACHAT.
//
// Confirmer CREDITE des jetons : c'est la seule facon d'en faire
// apparaitre par un achat. L'operation doit donc etre indivisible - si
// la ligne d'achat passe a "confirme" sans que le mouvement soit ecrit,
// la personne a paye pour rien et plus rien ne le rattrape.
app.post("/admin/jetons/:id", exigerAdmin, lireFormulaire, (req, res) => {
  const achat = requetes.achatJetonsParId.get(Number(req.params.id));

  if (!achat) {
    return res.status(404).render("message", {
      titre: "Demande introuvable",
      texte: "Cette demande d'achat n'existe pas.",
      liens: [{ url: "/admin/jetons", texte: "Retour aux jetons" }],
    });
  }

  const confirmer = req.body.decision === "confirmer";
  const motif = String(req.body.motif || "").trim();

  // UN REFUS S'EXPLIQUE. Quelqu'un a annonce un paiement : lui rendre
  // un non sans raison ne lui dit pas quoi faire ensuite.
  if (!confirmer && motif.length < 5) {
    return res.status(400).render("message", {
      titre: "Motif obligatoire",
      texte: "Pour refuser une demande d'achat, écrivez le motif. " +
             "La personne le lira sur sa page.",
      liens: [{ url: "/admin/jetons", texte: "Retour aux jetons" }],
    });
  }

  const traiter = db.transaction(() => {
    const resultat = requetes.classerAchatJetons.run({
      id: achat.id,
      etat: confirmer ? "confirme" : "refuse",
      par: req.utilisateur.id,
      motif: confirmer ? null : motif,
    });

    // Aucune ligne modifiee : quelqu'un l'a traitee entre-temps.
    if (resultat.changes === 0) return false;

    if (confirmer) {
      requetes.ecrireMouvementJetons.run({
        personne: achat.utilisateur_id,
        quantite: achat.quantite,
        nature: "achete",
        motif: "achat",
        detail: `Pack de ${achat.quantite} jetons, ${formaterMontant(achat.montant_fcfa)}`,
        achat: achat.id,
        annonce: null,
        expire: null,
      });
    }

    return true;
  });

  if (!traiter()) {
    return res.status(409).render("message", {
      titre: "Demande déjà traitée",
      texte: "Un membre de l'équipe a déjà traité cette demande.",
      liens: [{ url: "/admin/jetons", texte: "Retour aux jetons" }],
    });
  }

  res.redirect("/admin/jetons");
});

// MODIFIER LES PRIX.
//
// C'est ce qui evite que le tarif d'un jeton soit fige pour toujours
// dans le code. Le nouveau prix vaut pour TOUT LE MONDE des l'instant
// ou il est enregistre - il n'y a pas un tarif par utilisateur - et il
// ne reecrit pas les achats deja payes : chaque ligne garde son montant.
app.post("/admin/parametres", exigerAdmin, lireFormulaire, (req, res) => {
  // On verifie AVANT d'ecrire, et on n'ecrit rien si une seule valeur
  // est mauvaise : une table de prix a moitie mise a jour serait pire
  // que l'ancienne.
  const valeurJeton = Math.round(Number(req.body.jeton_valeur_fcfa));

  if (!Number.isFinite(valeurJeton) || valeurJeton <= 0) {
    return res.status(400).render("message", {
      titre: "Valeur du jeton invalide",
      texte: "La valeur d'un jeton doit être un nombre de FCFA supérieur à zéro.",
      liens: [{ url: "/admin/jetons", texte: "Retour aux jetons" }],
    });
  }

  // Le formulaire envoie une case par pack, toutes nommees "pack".
  // Une seule case remplie donne un texte, plusieurs donnent un tableau :
  // concat ramene les deux au meme cas.
  const cases = [].concat(req.body.pack === undefined ? [] : req.body.pack)
    .map((valeur) => String(valeur).trim())
    .filter((valeur) => valeur !== "");

  const quantites = cases.map((valeur) => Math.round(Number(valeur)));

  if (quantites.some((quantite) => !(quantite > 0))) {
    return res.status(400).render("message", {
      titre: "Nombre de jetons invalide",
      texte: "Un pack se règle par son nombre de jetons, qui doit être " +
             "supérieur à zéro. Videz une case pour retirer un pack.",
      liens: [{ url: "/admin/jetons", texte: "Retour aux jetons" }],
    });
  }

  // VIDER TOUTES LES CASES FERMERAIT LA VENTE. C'est peut-etre voulu,
  // mais jamais par accident : on le refuse, et on le dit.
  if (quantites.length === 0) {
    return res.status(400).render("message", {
      titre: "Aucun pack",
      texte: "Il faut au moins un pack en vente. Sans pack, plus personne " +
             "ne peut obtenir de jetons.",
      liens: [{ url: "/admin/jetons", texte: "Retour aux jetons" }],
    });
  }

  // LES JETONS OFFERTS. Zero est une valeur permise - c'est la facon de
  // ne plus rien offrir - mais jamais un nombre negatif ni un texte.
  const offertEmployeur = Math.round(Number(req.body.bienvenue_employeur));
  const offertPrestataire = Math.round(Number(req.body.bienvenue_prestataire));
  const joursValidite = Math.round(Number(req.body.bienvenue_jours));

  if (!Number.isFinite(offertEmployeur) || offertEmployeur < 0 ||
      !Number.isFinite(offertPrestataire) || offertPrestataire < 0) {
    return res.status(400).render("message", {
      titre: "Jetons offerts invalides",
      texte: "Le nombre de jetons offerts doit être zéro ou plus. " +
             "Mettez zéro pour ne plus rien offrir.",
      liens: [{ url: "/admin/jetons", texte: "Retour aux jetons" }],
    });
  }

  // UNE DUREE DE ZERO JOUR VOUDRAIT DIRE "deja perimes en arrivant".
  // C'est un piege, pas un reglage : on le refuse.
  if (!Number.isFinite(joursValidite) || joursValidite <= 0) {
    return res.status(400).render("message", {
      titre: "Durée invalide",
      texte: "Les jetons offerts doivent rester utilisables au moins un jour. " +
             "Pour ne plus rien offrir, mettez le nombre de jetons à zéro.",
      liens: [{ url: "/admin/jetons", texte: "Retour aux jetons" }],
    });
  }

  // CE QUE COUTE UNE MISE EN AVANT. C'est le seul prix en jetons qui
  // reste : repondre a une demande est gratuit. Zero serait une mise en
  // avant offerte, ce qui viderait le jeton de son role.
  const coutMiseEnAvant = Math.round(Number(req.body.cout_mise_en_avant));

  if (!Number.isFinite(coutMiseEnAvant) || coutMiseEnAvant <= 0) {
    return res.status(400).render("message", {
      titre: "Coût invalide",
      texte: "Une mise en avant doit coûter au moins un jeton. " +
             "À zéro, elle serait gratuite et le jeton ne servirait plus à rien.",
      liens: [{ url: "/admin/jetons", texte: "Retour aux jetons" }],
    });
  }

  // UNE MISE EN AVANT DE ZERO JOUR serait payee pour rien.
  const dureeAvant = Math.round(Number(req.body.duree_mise_en_avant_jours));

  if (!Number.isFinite(dureeAvant) || dureeAvant <= 0) {
    return res.status(400).render("message", {
      titre: "Durée invalide",
      texte: "Une mise en avant doit durer au moins un jour. " +
             "À zéro, elle serait payée pour rien.",
      liens: [{ url: "/admin/jetons", texte: "Retour aux jetons" }],
    });
  }

  // ZERO REPONSE PAR JOUR FERMERAIT LA PLATEFORME a ceux qui y
  // travaillent. C'est trop grave pour etre un accident de saisie.
  const parJour = Math.round(Number(req.body.candidatures_par_jour));

  if (!Number.isFinite(parJour) || parJour <= 0) {
    return res.status(400).render("message", {
      titre: "Limite invalide",
      texte: "Il faut autoriser au moins une réponse par jour. À zéro, " +
             "plus personne ne pourrait répondre à une demande.",
      liens: [{ url: "/admin/jetons", texte: "Retour aux jetons" }],
    });
  }

  const enregistrer = db.transaction(() => {
    requetes.majParametre.run({
      cle: "jeton_valeur_fcfa",
      valeur: String(valeurJeton),
      par: req.utilisateur.id,
    });
    requetes.majParametre.run({
      cle: "packs_jetons",
      valeur: [...new Set(quantites)].sort((a, b) => a - b).join("|"),
      par: req.utilisateur.id,
    });
    requetes.majParametre.run({
      cle: "bienvenue_employeur",
      valeur: String(offertEmployeur),
      par: req.utilisateur.id,
    });
    requetes.majParametre.run({
      cle: "bienvenue_prestataire",
      valeur: String(offertPrestataire),
      par: req.utilisateur.id,
    });
    requetes.majParametre.run({
      cle: "bienvenue_jours",
      valeur: String(joursValidite),
      par: req.utilisateur.id,
    });
    requetes.majParametre.run({
      cle: "cout_mise_en_avant",
      valeur: String(coutMiseEnAvant),
      par: req.utilisateur.id,
    });
    requetes.majParametre.run({
      cle: "candidatures_par_jour",
      valeur: String(parJour),
      par: req.utilisateur.id,
    });
    requetes.majParametre.run({
      cle: "duree_mise_en_avant_jours",
      valeur: String(dureeAvant),
      par: req.utilisateur.id,
    });
  });

  enregistrer();

  res.redirect("/admin/jetons");
});

// --- Espace equipe : les dossiers a verifier -----------------------
app.get("/admin", exigerAdmin, (req, res) => {
  res.render("admin", {
    titre: "Espace équipe",
    dossiers: requetes.dossiersEnAttente.all(),
    photosAControler: requetes.photosAControler.all(),
    statistiques: requetes.statistiquesVerification.all(),
    signalementsOuverts: requetes.nombreSignalementsOuverts.get().n,
    problemesOuverts: requetes.nombreProblemesOuverts.get().n,
    demandesATraiter: requetes.nombreDemandesATraiter.get().n,
    paiementsEnAttente: requetes.nombrePaiementsEnAttente.get().n,
    personnesConnues: requetes.nombreDansLAnnuaire.get().n,
    codesDemandes: requetes.nombreCodesDemandes.get().n,
    achatsJetons: requetes.nombreAchatsJetonsEnAttente.get().n,
    avisSignales: requetes.nombreAvisSignales.get().n,
  });
});

// --- Espace equipe : les messages signales -------------------------
//
// Une page a part, et non une section de plus dans les dossiers a
// verifier. Ce sont deux metiers differents : controler l'identite d'une
// personne, et juger un message. Les melanger sur un meme ecran ferait
// hesiter sur ce qu'on est en train de faire.
app.get("/admin/signalements", exigerAdmin, (req, res) => {
  res.render("signalements", {
    titre: "Messages signalés",
    signalements: requetes.signalementsOuverts.all(),
  });
});

app.post("/admin/signalements/:id", exigerAdmin, lireFormulaire, (req, res) => {
  const message = requetes.messageSignale.get(Number(req.params.id));

  if (!message || !message.signale) {
    return res.status(404).render("message", {
      titre: "Signalement introuvable",
      texte: "Ce message n'existe pas, ou il n'a pas été signalé.",
      liens: [{ url: "/admin/signalements", texte: "Retour aux signalements" }],
    });
  }

  // Deja tranche : on ne rejuge pas une decision prise, sinon la trace
  // du premier examen disparaitrait.
  if (message.signalement_decision) {
    return res.status(409).render("message", {
      titre: "Signalement déjà examiné",
      texte: "Une décision a déjà été prise sur ce message.",
      liens: [{ url: "/admin/signalements", texte: "Retour aux signalements" }],
    });
  }

  // TROIS decisions possibles, et non plus deux. Entre le classement
  // sans suite et la suspension il manquait la reponse proportionnee :
  // dire a la personne ce qui ne va pas, sans lui fermer la porte.
  const decisions = ["rien", "avertissement", "sanction"];
  const decision = decisions.includes(req.body.decision) ? req.body.decision : "rien";

  if (decision !== "rien") {
    const motif = String(req.body.motif || "").trim().slice(0, 200);

    if (!motif) {
      return res.status(400).render("message", {
        titre: "Motif obligatoire",
        texte: decision === "sanction"
          ? "Une suspension doit être motivée. Sans motif écrit, personne " +
            "ne pourra expliquer cette décision plus tard."
          : "Un avertissement sans motif n'apprend rien à la personne qui " +
            "le reçoit. Écrivez ce que vous lui reprochez.",
        liens: [{ url: "/admin/signalements", texte: "Retour aux signalements" }],
      });
    }

    if (decision === "sanction") {
      // Le compte n'est pas SUPPRIME : ses annonces, ses candidatures et
      // ses messages doivent rester consultables en cas de desaccord.
      // La requete refuse par ailleurs de suspendre un compte d'equipe.
      requetes.suspendreCompte.run({ id: message.auteur_id, motif });
    } else {
      requetes.avertirCompte.run({ id: message.auteur_id, motif });
    }
  }

  requetes.classerSignalement.run({
    id: message.id,
    decision,
    par: req.utilisateur.id,
  });

  res.redirect("/admin/signalements");
});

// L'EQUIPE ECRIT A QUELQU'UN.
//
// Le seul canal dont elle disposait etait l'avertissement, qui est une
// sanction : poser une question par ce moyen serait injuste. Celui-ci ne
// compte rien et ne change rien au compte de la personne.
app.post("/admin/message/:id", exigerAdmin, lireFormulaire, (req, res) => {
  const destinataire = requetes.utilisateurParId.get(Number(req.params.id));

  if (!destinataire || destinataire.est_admin) {
    return res.status(404).render("message", {
      titre: "Personne introuvable",
      texte: "Ce compte n'existe pas, ou c'est un compte de l'équipe.",
      liens: [{ url: "/admin/mises-en-relation", texte: "Retour aux mises en relation" }],
    });
  }

  const texte = String(req.body.texte || "").trim().slice(0, 500);

  if (texte.length < 10) {
    return res.status(400).render("message", {
      titre: "Écrivez votre message",
      texte: "Quelques mots suffisent, mais la personne doit comprendre ce que " +
             "vous attendez d'elle.",
      liens: [{ url: "/admin/mises-en-relation", texte: "Retour aux mises en relation" }],
    });
  }

  requetes.ecrireMessageEquipe.run({ id: destinataire.id, texte });

  res.redirect("/admin/mises-en-relation");
});

app.post("/message-equipe/lu", exigerConnexion, (req, res) => {
  requetes.marquerMessageEquipeLu.run(req.utilisateur.id);
  res.redirect("/mon-profil");
});

// Un avertissement reste affiche tant que la personne ne l'a pas
// reconnu. Ce n'est pas une formalite : c'est ce qui permet a l'equipe
// d'affirmer, au signalement suivant, que la regle avait ete rappelee.
app.post("/avertissement/lu", exigerConnexion, (req, res) => {
  requetes.marquerAvertissementLu.run(req.utilisateur.id);
  res.redirect("/mon-profil");
});

// --- Espace equipe : consulter un document -------------------------
// C'est la SEULE facon d'atteindre un fichier de data/documents/.
// L'adresse ne contient jamais le nom du fichier, seulement
// l'identifiant du prestataire et le type de piece demande.
app.get("/admin/document/:id/:type", exigerAdmin, (req, res) => {
  const dossier = requetes.dossierEnAttenteParId.get(Number(req.params.id));

  if (!dossier) {
    return res.status(404).render("message", {
      titre: "Dossier introuvable",
      texte: "Ce dossier n'existe pas ou a deja ete traite.",
      liens: [{ url: "/admin", texte: "Retour à l'espace équipe" }],
    });
  }

  const nomFichier =
    req.params.type === "cni" ? dossier.cni_fichier :
    req.params.type === "casier" ? dossier.casier_fichier :
    req.params.type === "photo" ? dossier.photo_envoyee_fichier : null;

  // Ceinture et bretelles : ce nom vient de notre base, donc il a la
  // forme que nous lui avons donnee. On le verifie quand meme avant de
  // construire un chemin de fichier avec.
  if (!nomFichier || !/^[0-9a-f]{32}\.[a-z0-9]+$/.test(nomFichier)) {
    return res.status(404).render("message", {
      titre: "Document introuvable",
      texte: "Ce document n'est plus disponible.",
      liens: [{ url: "/admin", texte: "Retour à l'espace équipe" }],
    });
  }

  // nosniff : le navigateur s'en tient au type annonce et n'essaie pas de
  // deviner, par exemple, qu'un fichier serait une page a executer.
  res.set("X-Content-Type-Options", "nosniff");
  res.sendFile(path.join(DOSSIER_DOCUMENTS, nomFichier));
});

// --- Espace equipe : les photos a controler --------------------------
// La photo et la piece d'identite renvoyee avec elle. Comme les documents
// d'un dossier, elles ne s'atteignent que par ici.
app.get("/admin/photo/:id/:type", exigerAdmin, (req, res) => {
  const demande = requetes.demandePhotoParId.get(Number(req.params.id));
  const nomFichier = !demande ? null
    : req.params.type === "photo" ? demande.photo_envoyee_fichier
    : req.params.type === "piece" ? demande.photo_piece_fichier : null;

  if (!nomFichier || !/^[0-9a-f]{32}\.[a-z0-9]+$/.test(nomFichier)) {
    return res.status(404).render("message", {
      titre: "Document introuvable",
      texte: "Ce document n'est plus disponible.",
      liens: [{ url: "/admin", texte: "Retour à l'espace équipe" }],
    });
  }

  res.set("X-Content-Type-Options", "nosniff");
  res.sendFile(path.join(DOSSIER_DOCUMENTS, nomFichier));
});

// Accepter remplace l'ancienne photo ; refuser garde l'ancienne. Dans les
// deux cas, la piece d'identite est supprimee.
app.post("/admin/photos", exigerAdmin, lireFormulaire, (req, res) => {
  const demande = requetes.demandePhotoParId.get(Number(req.body.utilisateurId));

  if (!demande) {
    return res.status(404).render("message", {
      titre: "Photo introuvable",
      texte: "Cette photo n'existe pas ou a déjà été contrôlée.",
      liens: [{ url: "/admin", texte: "Retour à l'espace équipe" }],
    });
  }

  if (req.body.decision === "accepter") {
    requetes.accepterPhoto.run(demande.id);
    if (demande.photo_fichier) supprimerDocument(demande.photo_fichier);
  } else {
    const motif = String(req.body.motif || "").trim() || "Photo non conforme.";
    requetes.refuserPhoto.run(motif, demande.id);
    supprimerDocument(demande.photo_envoyee_fichier);
  }
  supprimerDocument(demande.photo_piece_fichier);

  res.redirect("/admin");
});

// --- Espace equipe : valider ou refuser ----------------------------
//
// LIMITE CONNUE : ce que la plateforme organise ici est un controle
// HUMAIN DE COHERENCE - le nom du casier judiciaire doit etre identique
// a celui de la piece d'identite, les documents doivent etre lisibles,
// valides et recents. Elle ne detecte PAS un faux document.
//
// Le controle d'un extrait de casier aupres du service emetteur reste a
// definir avec l'encadrement : il conditionne le delai d'inscription.
//
// La grille suivie par l'equipe est un document a part, annexe au
// rapport de projet.
app.post("/admin/verification", exigerAdmin, lireFormulaire, (req, res) => {
  const dossier = requetes.dossierEnAttenteParId.get(Number(req.body.utilisateurId));

  if (!dossier) {
    return res.status(404).render("message", {
      titre: "Dossier introuvable",
      texte: "Ce dossier n'existe pas ou a deja ete traite.",
      liens: [{ url: "/admin", texte: "Retour à l'espace équipe" }],
    });
  }

  if (req.body.decision === "valider") {
    requetes.validerVerification.run(dossier.id);

    // LES JETONS OFFERTS, ICI ET PAS AILLEURS. La personne les trouvera
    // en se connectant, sans avoir a passer par un ecran particulier.
    //
    // On relit la personne apres la validation : l'objet charge plus
    // haut porte encore l'ancien statut, et la fonction refuserait
    // d'offrir quoi que ce soit a un dossier "en attente".
    offrirLaBienvenue(requetes.utilisateurParId.get(dossier.id));
  } else {
    const motif = String(req.body.motif || "").trim() || "Documents non conformes.";
    requetes.refuserVerification.run(motif, dossier.id);
  }

  // Dans les deux cas les documents sont effaces : nous ne conservons
  // que le statut, sa date et, si le dossier est valide, la photo
  // (minimisation des donnees personnelles : chaque donnee le temps de
  // son utilite).
  supprimerDocument(dossier.cni_fichier);
  supprimerDocument(dossier.casier_fichier);
  if (req.body.decision === "valider") {
    // Une photo plus ancienne est remplacee par celle qui vient d'etre
    // comparee a la piece d'identite.
    if (dossier.photo_envoyee_fichier && dossier.photo_fichier) supprimerDocument(dossier.photo_fichier);
  } else {
    supprimerDocument(dossier.photo_envoyee_fichier);
  }

  res.redirect("/admin");
});

// ============================================================
// PARTIE 3 - Aucune route n'a repondu : la page n'existe pas.
// Ce bloc doit imperativement rester EN DERNIER.
// ============================================================
// ============================================================
// PARTIE 15 - L'API de l'application mobile
// ============================================================
//
// L'application Flutter est ecrite en Dart : elle ne peut pas lire les
// pages EJS, il lui faut des donnees.
//
// ELLE NE REFAIT AUCUNE REGLE. Elle demande, le serveur decide, elle
// affiche. C'est le meme principe que pour les pages : cacher un bouton
// n'est pas une regle. Une regle recopiee dans deux langages finit par
// dire deux choses, et personne ne sait plus laquelle est la bonne.
//
// Le JSON n'est lu que sous /api : les formulaires des pages continuent
// d'arriver exactement comme avant.
app.use("/api", express.json());

// TOUTE reponse d'API est du JSON, les erreurs comprises. Une
// application qui attend des donnees et recoit une page HTML ne sait
// pas quoi en faire : elle affiche une erreur incomprehensible.
function erreurApi(res, code, message) {
  return res.status(code).json({ erreur: message });
}

// Un refus qui se regle en faisant verifier son identite le dit a
// l'application : elle propose alors le bouton que le site met sous la
// phrase, "Faire vérifier mon identité". Sans lui, la personne lisait
// pourquoi la porte est fermee, sans le chemin pour l'ouvrir.
function erreurApiDuProbleme(res, probleme) {
  const corps = { erreur: probleme.texte };
  if (probleme.lien && probleme.lien.url === "/verification") corps.verification = true;
  return res.status(probleme.code).json(corps);
}

// Ce que l'application a le droit de savoir sur la personne connectee.
// On choisit les champs UN PAR UN : renvoyer la ligne entiere ferait
// sortir l'empreinte du mot de passe.
function moiPourApi(u) {
  return {
    id: u.id,
    nom: u.nom,
    role: u.est_admin ? "equipe" : u.role,
    quartier: u.quartier,
    metier: u.metier,
    verification: u.statut_verification,
    // LE SOLDE ENTIER, PAS SEULEMENT LE TOTAL : les jetons offerts
    // periment, les achetes jamais. Une application qui n'afficherait
    // que la somme cacherait a la personne ce qui va disparaitre.
    jetons: soldeJetonsDe(u.id),
    // La pastille de Messages, comptee comme celle du menu du site.
    aVoir: nombreAVoir(u),
    // La pastille de Mon profil.
    aLire: nombreALireSurMonProfil(u),
  };
}

// --- Se connecter --------------------------------------------------
//
// La meme session que le site : l'application garde le cookie et le
// renvoie. Inventer un second mecanisme aurait fait deux portes a
// surveiller au lieu d'une.
app.post("/api/connexion", (req, res) => {
  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  const motdepasse = String((req.body && req.body.motdepasse) || "");
  const utilisateur = requetes.utilisateurParEmail.get(email);

  // Un compte suspendu garde un mot de passe valide, mais la porte reste
  // fermee. On le DIT, sinon la personne croit a une panne et recommence.
  if (utilisateur && utilisateur.suspendu &&
      verifierMotDePasse(motdepasse, utilisateur.motdepasse)) {
    return erreurApi(res, 403, texteSuspension(utilisateur));
  }

  if (!utilisateur || !verifierMotDePasse(motdepasse, utilisateur.motdepasse)) {
    return erreurApi(res, 401, "Email ou mot de passe incorrect.");
  }

  const token = genererToken();
  sessions[token] = utilisateur.id;
  res.cookie("session", token, { httpOnly: true, path: "/" });

  // LE JETON EST RENDU A L'APPLICATION, qui le renverra dans l'en-tete
  // Authorization. Il n'apparait QUE dans cette reponse d'API : les pages
  // du site ne l'affichent jamais, et leur cookie reste illisible par le
  // JavaScript des pages (httpOnly).
  res.json({ jeton: token, moi: moiPourApi(utilisateur) });
});

// --- Un mot de passe oublie, depuis l'application --------------------
//
// Les memes regles que sur le site, ecrites une seule fois plus haut :
// la meme reponse que le compte existe ou non, le meme code a usage
// unique, les memes cinq essais.
app.post("/api/mot-de-passe-oublie", (req, res) => {
  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  const utilisateur = requetes.utilisateurParEmail.get(email);

  if (utilisateur && !utilisateur.est_admin && !utilisateur.ajoute_par) {
    requetes.demanderUnCode.run({ id: utilisateur.id });
  }

  res.json({ titre: DEMANDE_DE_CODE_ENVOYEE.titre, texte: DEMANDE_DE_CODE_ENVOYEE.texte });
});

app.post("/api/nouveau-mot-de-passe", (req, res) => {
  const resultat = reouvrirAvecUnCode(req.body || {});

  if (resultat.probleme) {
    return erreurApi(res, resultat.probleme.code, resultat.probleme.texte);
  }

  res.json({
    titre: "Votre mot de passe est changé",
    texte: "Vous pouvez vous connecter avec votre nouveau mot de passe. La date de " +
           "ce changement est inscrite sur votre profil.",
  });
});

// --- Creer un compte depuis l'application ----------------------------
//
// Sans session, forcement : le compte n'existe pas encore. La fonction
// est celle du site, les refus disent la meme chose.
app.get("/api/inscription", (req, res) => {
  res.json(formulaireInscription());
});

app.post("/api/inscription", (req, res) => {
  if (!formeDeProfilValide(req.body) || !formeDeCleValide(req.body, ["role", "email", "motdepasse"])) {
    return erreurApi(res, 400, "L'inscription envoyée n'a pas la forme attendue.");
  }

  // La position vient du navigateur, sur le site. L'application ne la
  // demande pas.
  const { latitude, longitude, ...donnees } = req.body;
  const resultat = inscrire(donnees);
  if (resultat.probleme) return erreurApi(res, resultat.probleme.code, resultat.probleme.texte);

  res.status(201).json({ titre: resultat.titre, texte: resultat.texte, email: resultat.email });
});

// --- Les pages de presentation dans l'application ---------------------
//
// Leurs textes sont ceux des pages du site. Seuls les chiffres viennent
// d'ici, calcules comme pour le site : la commission et l'exemple.
app.get("/api/presentation", (req, res) => {
  res.json({
    pourcentageCommission: app.locals.pourcentageCommission,
    exempleTarif: exempleDeTarif(),
  });
});

// --- Se deconnecter ------------------------------------------------
app.post("/api/deconnexion", (req, res) => {
  // Cookie OU en-tete : la session est effacee quel que soit son
  // transport. Sans cela, l'application croirait s'etre deconnectee
  // alors que son jeton ouvrirait encore la porte.
  const jeton = jetonDeSession(req);
  if (jeton && Object.prototype.hasOwnProperty.call(sessions, jeton)) delete sessions[jeton];
  res.clearCookie("session", { path: "/" });
  res.json({ deconnecte: true });
});

// --- Qui suis-je ? -------------------------------------------------
//
// L'application appelle ceci au demarrage : si la session tient encore,
// elle evite de redemander le mot de passe.
app.get("/api/moi", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (!moi) return erreurApi(res, 401, "Personne n'est connecte.");
  res.json({ moi: moiPourApi(moi) });
});

// --- Les demandes ouvertes -----------------------------------------
//
// LA MEME REQUETE QUE LA PAGE PUBLIQUE, et le meme tri : les demandes
// du metier de la personne passent devant, sans masquer les autres. Si
// l'application triait de son cote, les deux ecrans finiraient par ne
// plus montrer la meme chose.
app.get("/api/demandes", (req, res) => {
  const { proposees, pourMoi, autres, monMetier } = demandesRangees(utilisateurConnecte(req));

  const pourLApplication = (a) => ({
    id: a.id,
    titre: a.titre,
    metier: a.metier,
    quartier: a.quartier,
    arrondissement: a.arrondissement,
    horaire: a.horaire,
    dureeEstimee: a.duree_estimee,
    // Ce qu'il faut savoir avant de venir : la carte du site le montre.
    conditions: a.conditions || null,
    misEnAvant: Boolean(a.mise_en_avant_jusqu_au &&
                        a.mise_en_avant_jusqu_au > new Date().toISOString().slice(0, 10)),
  });

  res.json({
    proposees: proposees.map(pourLApplication),
    pourMoi: pourMoi.map(pourLApplication),
    autres: autres.map(pourLApplication),
    monMetier,
  });
});

// --- Les demandes de l'employeur connecte -----------------------------
//
// EXACTEMENT ce que montre la page Mes demandes : la meme fonction decide
// pour les deux. Les champs sont choisis un par un : aucune coordonnee des
// personnes qui ont repondu ne sort d'ici.
app.get("/api/mes-demandes", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (!moi) return erreurApi(res, 401, "Personne n'est connecté.");
  if (moi.est_admin || moi.role !== "employeur") {
    return erreurApi(res, 403, "Cette page est celle des employeurs.");
  }

  res.json({
    demandes: demandesDeLEmployeur(moi.id).map((a) => ({
      id: a.id,
      titre: a.titre,
      metier: a.metier,
      horaire: a.horaireLisible,
      prixLisible: a.prixLisible,
      dureeEstimee: a.duree_estimee || null,
      lieu: a.lieu || null,
      proposeeA: a.proposeeA,
      fermee: a.fermee,
      phraseFermeture: a.phraseFermeture,
      enAvant: a.enAvant,
      enAvantJusquAu: a.enAvantJusquAu,
      peutModifier: a.peutModifier,
      peutMettreEnAvant: a.peutMettreEnAvant,
      peutRetirer: a.peutRetirer,
      candidatures: a.candidatures.map((c) => ({
        id: c.id,
        prestataireId: c.prestataireId,
        nom: c.nomPrestataire,
        phrase: c.phrase,
        verification: c.verificationPrestataire,
        libelleVerification: c.libelleVerification,
        note: { etat: c.note.etat, badge: c.note.badge, detail: c.note.detail },
        experience: c.experience,
        disponibilites: c.disponibilites || null,
        peutChoisir: c.peutChoisir,
        peutRefuser: c.peutRefuser,
        attendVerification: c.attendVerification,
        libelleDiscussion: c.libelleDiscussion,
      })),
    })),
  });
});

// --- Publier une demande depuis l'application ----------------------
//
// Les memes portes que sur le site : un employeur, dont l'identite est
// verifiee. Renvoie true si la reponse est deja partie.
function refusDePublierApi(res, moi) {
  if (!moi) {
    erreurApi(res, 401, "Personne n'est connecté.");
    return true;
  }
  if (moi.est_admin || moi.role !== "employeur") {
    erreurApi(res, 403, "Seuls les employeurs peuvent publier une demande.");
    return true;
  }
  if (moi.statut_verification !== "verifie") {
    erreurApi(res, 403, texteVerificationRequise(moi.role));
    return true;
  }
  return false;
}

// Les listes du formulaire viennent du serveur, comme sur le site :
// ajouter un metier ou un quartier ne demandera pas de refabriquer
// l'application.
function listesDuFormulaireDemande() {
  return {
    metiers: metiers.map((m) => m.nom),
    quartiers: quartiers.map((q) => q.nom),
    arrondissements: app.locals.arrondissements,
  };
}

app.get("/api/formulaire-demande", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusDePublierApi(res, moi)) return;

  // ?pour= : la demande est proposee a une personne, depuis sa fiche.
  const invitee = lirePersonneInvitee(req.query.pour);
  if (invitee && invitee.probleme) return erreurApi(res, 400, invitee.probleme.texte);

  res.json(Object.assign(listesDuFormulaireDemande(), {
    invitee: invitee ? { id: invitee.id, nom: invitee.nom, metier: invitee.metier || null } : null,
  }));
});

// L'arrondissement d'un quartier, tel que le serveur l'enregistrera.
// Le site fait ce calcul dans le navigateur pour l'afficher avant
// l'envoi ; l'application le demande ici plutot que de recopier la
// regle, synonymes compris.
//
// Sans session : Creer un compte s'en sert aussi. Rien de prive n'en
// sort, la liste des quartiers est deja dans chaque formulaire du site.
app.get("/api/quartier", (req, res) => {
  const connu = trouverQuartier(String(req.query.nom || ""));
  res.json(connu
    ? { connu: true, quartier: connu.nom, arrondissement: connu.arrondissement }
    : { connu: false });
});

const CHAMPS_DEMANDE = ["titre", "metier", "horaire", "quartier", "arrondissement",
                        "prix", "unite_tarif", "duree_estimee", "conditions"];

// Un formulaire du site n'envoie que du texte. En JSON, un objet peut se
// glisser a la place d'un texte : on le refuse plutot que d'enregistrer
// "[object Object]" comme titre.
function formeDeDemandeValide(corps) {
  return Boolean(corps) && typeof corps === "object" && !Array.isArray(corps) &&
    CHAMPS_DEMANDE.every((champ) => corps[champ] == null ||
      typeof corps[champ] === "string" ||
      (champ === "prix" && typeof corps[champ] === "number")) &&
    (corps.pour == null || typeof corps.pour === "string" || typeof corps.pour === "number");
}

app.post("/api/demandes", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusDePublierApi(res, moi)) return;

  // Un formulaire du site n'envoie que du texte. En JSON, un objet peut
  // se glisser a la place d'un texte : on le refuse plutot que
  // d'enregistrer "[object Object]" comme titre.
  const corps = req.body;
  if (!formeDeDemandeValide(corps)) {
    return erreurApi(res, 400, "Le formulaire envoyé n'a pas la forme attendue.");
  }

  const resultat = publierDemande(moi.id, corps);
  if (resultat.probleme) return erreurApi(res, 400, resultat.probleme.texte);

  res.status(201).json({ id: resultat.id, titre: resultat.titre, texte: resultat.texte });
});

// --- Choisir ou refuser depuis l'application -----------------------
//
// Les memes fonctions que le site : confirmationDuChoix pour l'ecran de
// relecture, deciderCandidature pour la decision.
function refusEmployeurApi(res, moi) {
  if (!moi) {
    erreurApi(res, 401, "Personne n'est connecté.");
    return true;
  }
  if (moi.est_admin || moi.role !== "employeur") {
    erreurApi(res, 403, "Cette page est celle des employeurs.");
    return true;
  }
  return false;
}

app.get("/api/candidatures/:id/confirmation", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusEmployeurApi(res, moi)) return;

  const ecran = confirmationDuChoix(moi.id, Number(req.params.id));
  if (ecran.probleme) return erreurApi(res, ecran.probleme.code, ecran.probleme.texte);

  const { c, reputation, refusAnnonces } = ecran;

  // Les champs sont choisis un par un : ni email, ni telephone, ni
  // adresse. Le lieu reste general, comme sur le site.
  res.json({
    candidatureId: c.id,
    prestataireId: c.prestataireId,
    nom: c.nomPrestataire,
    metier: c.metierPrestataire || null,
    note: notePersonne({ nbAvis: reputation.nombre, moyenne: reputation.moyenne, services: reputation.services }),
    experience: libelleExperience(c.experiencePrestataire),
    service: c.metierAnnonce || null,
    horaire: c.horaireAnnonce || "non précisé",
    duree: c.dureeAnnonce || null,
    lieu: [c.quartierAnnonce, c.arrondissementAnnonce].filter(Boolean).join(", ") || null,
    conditions: c.conditionsAnnonce || null,
    // Aucun prix n'est annonce ici : l'equipe rappelle l'employeur avec le
    // prix, avant le service. La cle reste, a null, pour l'application.
    paiement: null,
    refusAnnonces,
  });
});

function routeDeDecisionApi(statut) {
  return (req, res) => {
    const moi = utilisateurConnecte(req);
    if (refusEmployeurApi(res, moi)) return;

    const resultat = deciderCandidature(moi.id, Number(req.params.id), statut);
    if (resultat.probleme) return erreurApi(res, resultat.probleme.code, resultat.probleme.texte);

    res.json({ ok: true });
  };
}

app.post("/api/candidatures/:id/choisir", routeDeDecisionApi("acceptee"));
app.post("/api/candidatures/:id/refuser", routeDeDecisionApi("refusee"));

// --- Discuter depuis l'application ---------------------------------
//
// Les memes fonctions que le site. Les deux personnes de la discussion y
// ont acces, quel que soit leur role ; personne d'autre, pas meme
// l'equipe (voir conversationDe).

// Le detail du prix vu par chacun : le meme calcul et les memes mots que
// le partiel detail-tarif du site.
// LE PRIX NE S'AFFICHE PLUS DANS LA DISCUSSION : il est convenu par
// telephone, avec l'equipe, qui le rapporte a l'employeur majore de la
// commission.
function prixDeLaDiscussion() {
  return {
    lignes: [],
    phrase: "Le prix est convenu par téléphone avec l'équipe PamConnect.",
  };
}

app.get("/api/discussions", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (!moi) return erreurApi(res, 401, "Personne n'est connecté.");

  const liste = mesDiscussions(moi);
  // Les champs sont choisis un par un : ni email, ni telephone.
  const resume = (c) => ({
    id: c.id,
    avec: c.avec,
    titreDemande: c.titreAnnonce,
    phraseStatut: c.phraseStatut,
    nouveau: c.nouveau,
    phraseNonLus: c.phraseNonLus,
    phraseMessages: c.phraseMessages,
    dernierMessage: c.dernierMessage || null,
    termineeLe: c.terminee_le || null,
    avisAttendu: c.avisAttendu,
  });

  res.json({
    enCours: liste.enCours.map(resume),
    terminees: liste.terminees.map(resume),
    chapeauTerminees: liste.chapeauTerminees,
    vide: liste.vide,
    aVoir: nombreAVoir(moi),
  });
});

app.get("/api/discussions/:id", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (!moi) return erreurApi(res, 401, "Personne n'est connecté.");

  const discussion = ouvrirDiscussion(Number(req.params.id), moi);
  if (!discussion) return erreurApi(res, CONVERSATION_INTROUVABLE.code, CONVERSATION_INTROUVABLE.texte);

  const { conversation: c, jeSuisEmployeur } = discussion;

  // Les champs sont choisis un par un : ni email, ni telephone du compte,
  // ni adresse. Le lieu reste general.
  res.json({
    id: c.id,
    titreDemande: c.titreAnnonce,
    avec: jeSuisEmployeur ? c.nomPrestataire : c.nomEmployeur,
    metierAutre: jeSuisEmployeur ? (c.metierPrestataire || null) : null,
    horaire: c.horaireAnnonce || "Horaire non précisé",
    lieu: [c.quartierAnnonce, c.arrondissementAnnonce].filter(Boolean).join(", ") || null,
    conditions: c.conditionsAnnonce || null,
    phraseStatut: phraseCandidature(c.statut, jeSuisEmployeur, c),
    prix: prixDeLaDiscussion(),
    messages: discussion.messages.map((m) => {
      const deMoi = m.auteur_id === moi.id;
      return {
        id: m.id,
        deMoi,
        auteur: deMoi ? "Vous" : m.nomAuteur,
        quand: m.cree_le,
        texte: m.texte,
        risquePaiement: Boolean(m.risque_paiement),
        signale: Boolean(m.signale),
        peutSignaler: !deMoi && !m.signale,
      };
    }),
    serviceTermine: c.terminee_le ? { par: c.nomEmployeur, le: c.terminee_le } : null,
    peutEcrire: !c.terminee_le,
    conseilEcriture: discussion.conseil,
    photoAutre: discussion.photoAutre,
    // Clore le service appartient a celui qui l'a recu, une fois quelqu'un
    // choisi, et une seule fois.
    peutDeclarerService: jeSuisEmployeur && c.statut === "acceptee" && !c.terminee_le,
    // UN AVIS SUPPOSE UN SERVICE : rien avant qu'il soit termine.
    avis: c.terminee_le
      ? {
          monAvis: discussion.monAvis
            ? {
                note: discussion.monAvis.note,
                commentaire: discussion.monAvis.commentaire || null,
                publieLe: dateLisible(discussion.monAvis.cree_le),
                masque: Boolean(discussion.monAvis.masque),
                motifMasquage: discussion.monAvis.motif_masquage || null,
              }
            : null,
          avisRecu: discussion.avisRecu
            ? {
                id: discussion.avisRecu.id,
                note: discussion.avisRecu.note,
                commentaire: discussion.avisRecu.commentaire || null,
                auteur: discussion.avisRecu.nomAuteur,
                masque: Boolean(discussion.avisRecu.masque),
                signale: Boolean(discussion.avisRecu.signale),
                peutSignaler: !discussion.avisRecu.masque && !discussion.avisRecu.signale,
              }
            : null,
        }
      : null,
    // Elle a declare avoir travaille : l'employeur doit le savoir, c'est
    // lui qui detient la cle du paiement.
    declarationDeLaPersonne: jeSuisEmployeur && c.declaree_par_elle_le && !c.terminee_le
      ? { nom: c.nomPrestataire, le: c.declaree_par_elle_le }
      : null,
    // ELLE AUSSI PEUT LE DIRE, une fois choisie. Sa declaration ne libere
    // aucun argent : elle pose une trace datee.
    maDeclaration: !jeSuisEmployeur && c.statut === "acceptee" && !c.terminee_le
      ? { dejaFaite: Boolean(c.declaree_par_elle_le), le: c.declaree_par_elle_le || null, employeur: c.nomEmployeur }
      : null,
  });
});

app.post("/api/discussions/:id/messages", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (!moi) return erreurApi(res, 401, "Personne n'est connecté.");

  const saisie = req.body && req.body.texte;
  if (saisie != null && typeof saisie !== "string") {
    return erreurApi(res, 400, "Le message envoyé n'a pas la forme attendue.");
  }

  const resultat = ecrireMessage(Number(req.params.id), moi, saisie);
  if (resultat.probleme) return erreurApi(res, resultat.probleme.code, resultat.probleme.texte);
  if (resultat.vide) return erreurApi(res, 400, "Écrivez un message avant de l'envoyer.");

  res.status(201).json({ ok: true });
});

app.post("/api/discussions/:id/messages/:messageId/signaler", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (!moi) return erreurApi(res, 401, "Personne n'est connecté.");

  const resultat = signalerUnMessage(Number(req.params.messageId), Number(req.params.id), moi);
  if (resultat.probleme) return erreurApi(res, resultat.probleme.code, resultat.probleme.texte);

  res.json({ ok: true });
});

// --- Declarer le service effectue depuis l'application --------------
app.post("/api/candidatures/:id/terminer", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (!moi) return erreurApi(res, 401, "Personne n'est connecté.");

  const resultat = declarerServiceEffectue(Number(req.params.id), moi);
  if (resultat.probleme) return erreurApi(res, resultat.probleme.code, resultat.probleme.texte);

  res.json({ ok: true });
});

// --- Donner son avis depuis l'application ---------------------------
app.get("/api/avis/:id", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (!moi) return erreurApi(res, 401, "Personne n'est connecté.");

  const service = serviceANoter(Number(req.params.id), moi);
  if (service.probleme) return erreurApi(res, service.probleme.code, service.probleme.texte);

  res.json({
    nomVise: service.nomVise,
    titreDemande: service.conversation.titreAnnonce,
    echelle: ECHELLE_NOTES,
    criteres: criteresAvis(service.jeSuisEmployeur),
    exempleCommentaire: exempleCommentaireAvis(service.jeSuisEmployeur),
    commentaireMax: AVIS_COMMENTAIRE_MAX,
  });
});

const CHAMPS_AVIS = ["note", "commentaire", "critere1", "critere2", "critere3", "critere4"];

app.post("/api/avis/:id", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (!moi) return erreurApi(res, 401, "Personne n'est connecté.");

  const corps = req.body;
  const formeValide = Boolean(corps) && typeof corps === "object" && !Array.isArray(corps) &&
    CHAMPS_AVIS.every((champ) => corps[champ] == null ||
      typeof corps[champ] === "string" || typeof corps[champ] === "number");
  if (!formeValide) return erreurApi(res, 400, "L'avis envoyé n'a pas la forme attendue.");

  const resultat = donnerAvis(Number(req.params.id), moi, corps);
  if (resultat.probleme) return erreurApi(res, resultat.probleme.code, resultat.probleme.texte);

  res.status(201).json({ texte: resultat.texte });
});

app.post("/api/avis/:id/signaler", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (!moi) return erreurApi(res, 401, "Personne n'est connecté.");

  const resultat = signalerUnAvis(Number(req.params.id), moi);
  if (resultat.probleme) return erreurApi(res, resultat.probleme.code, resultat.probleme.texte);

  res.json({ texte: resultat.texte });
});

// --- Modifier, mettre en avant, retirer depuis l'application --------
app.get("/api/demandes/:id/modification", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusEmployeurApi(res, moi)) return;

  const demande = demandeAModifier(Number(req.params.id), moi);
  if (demande.probleme) return erreurApi(res, demande.probleme.code, demande.probleme.texte);

  const a = demande.annonce;
  res.json(Object.assign(listesDuFormulaireDemande(), {
    valeurs: {
      titre: a.titre || "",
      metier: a.metier || "",
      horaire: a.horaire || "",
      quartier: a.quartier || "",
      arrondissement: a.arrondissement || null,
      budget: a.budget != null ? String(a.budget) : "",
      duree_estimee: a.duree_estimee || "",
      conditions: a.conditions || "",
    },
    avertissement: demande.avertissement,
  }));
});

app.post("/api/demandes/:id", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusEmployeurApi(res, moi)) return;

  if (!formeDeDemandeValide(req.body)) {
    return erreurApi(res, 400, "Le formulaire envoyé n'a pas la forme attendue.");
  }

  const resultat = modifierDemande(Number(req.params.id), moi, req.body);
  if (resultat.probleme) return erreurApi(res, resultat.probleme.code, resultat.probleme.texte);

  res.json({ texte: resultat.texte });
});

app.get("/api/demandes/:id/mise-en-avant", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusEmployeurApi(res, moi)) return;

  const ecran = ecranDeMiseEnAvant(Number(req.params.id), moi);
  if (ecran.probleme) return erreurApi(res, ecran.probleme.code, ecran.probleme.texte);

  const { annonce: a, cout, jours, solde, finActuelle } = ecran;
  const disponible = Boolean(cout && jours);

  res.json({
    titre: a.titre,
    metier: a.metier || null,
    lieu: [a.quartier, a.arrondissement].filter(Boolean).join(", ") || null,
    finActuelle,
    disponible,
    jours: disponible ? Math.round(jours) : null,
    cout: disponible ? jetonsEnClair(cout) : null,
    resteApres: disponible ? jetonsEnClair(Math.max(0, solde - cout)) : null,
    solde: jetonsEnClair(solde),
    soldeSuffit: disponible && solde >= cout,
  });
});

app.post("/api/demandes/:id/mise-en-avant", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusEmployeurApi(res, moi)) return;

  const resultat = mettreEnAvantDemande(Number(req.params.id), moi);
  if (resultat.probleme) return erreurApi(res, resultat.probleme.code, resultat.probleme.texte);

  res.json({ texte: resultat.texte });
});

app.post("/api/demandes/:id/retirer", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusEmployeurApi(res, moi)) return;

  const resultat = retirerDemande(Number(req.params.id), moi);
  if (resultat.probleme) return erreurApi(res, resultat.probleme.code, resultat.probleme.texte);

  res.json({ texte: resultat.texte });
});

// --- Mon profil depuis l'application ---------------------------------
//
// L'espace equipe reste sur le site : un compte d'equipe n'a pas de
// profil dans l'application.
function refusEquipeApi(res, moi) {
  if (!moi) {
    erreurApi(res, 401, "Personne n'est connecté.");
    return true;
  }
  if (moi.est_admin) {
    erreurApi(res, 403, "L'espace équipe s'utilise sur le site.");
    return true;
  }
  return false;
}

app.get("/api/mon-profil", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusEquipeApi(res, moi)) return;

  res.json({ ...monProfil(moi), aLire: nombreALireSurMonProfil(moi) });
});

// "J'ai lu" : la personne reconnait le message ou l'avertissement, comme
// avec les boutons du site.
app.post("/api/mon-profil/message-equipe/lu", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusEquipeApi(res, moi)) return;

  requetes.marquerMessageEquipeLu.run(moi.id);
  res.json({ ok: true });
});

app.post("/api/mon-profil/avertissement/lu", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusEquipeApi(res, moi)) return;

  requetes.marquerAvertissementLu.run(moi.id);
  res.json({ ok: true });
});

// --- La verification d'identite depuis l'application ------------------
//
// Les documents arrivent en multipart, comme depuis le formulaire du site :
// multer les recoit, et la meme fonction les relit.
//
// LIMITE CONNUE : comme le reste de l'API, ils voyagent sans chiffrement
// tant que le serveur s'ouvre en http://. Un vrai deploiement passerait en
// https.
app.get("/api/verification", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusEquipeApi(res, moi)) return;

  res.json(ecranDeVerification(moi));
});

app.post("/api/verification", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusEquipeApi(res, moi)) return;
  if (moi.statut_verification === "verifie") return erreurApi(res, 409, DOSSIER_DEJA_VALIDE.texte);

  recevoirDocuments(req, res, (erreur) => {
    const resultat = recevoirUnDossier(moi, req.files, erreur);
    if (resultat.probleme) return erreurApi(res, resultat.probleme.code, resultat.probleme.texte);

    res.json({ texte: resultat.texte });
  });
});

// --- Ma photo depuis l'application ------------------------------------
app.get("/api/mon-profil/photo", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusEquipeApi(res, moi)) return;

  const ecran = ecranDeMaPhoto(moi);
  if (ecran.probleme) return erreurApiDuProbleme(res, ecran.probleme);
  res.json(ecran);
});

app.post("/api/mon-profil/photo", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusEquipeApi(res, moi)) return;

  recevoirDocuments(req, res, (erreur) => {
    const resultat = recevoirUnePhoto(moi, req.files, erreur);
    if (resultat.probleme) return erreurApiDuProbleme(res, resultat.probleme);
    res.json({ texte: resultat.texte });
  });
});

app.post("/api/mon-profil/photo/retirer", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusEquipeApi(res, moi)) return;

  retirerMaPhoto(moi);
  res.json({ ok: true });
});

// --- Modifier mon profil depuis l'application -----------------------
app.get("/api/mon-profil/modification", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusEquipeApi(res, moi)) return;

  res.json(formulaireMonProfil(moi));
});

app.post("/api/mon-profil", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusEquipeApi(res, moi)) return;

  if (!formeDeProfilValide(req.body)) {
    return erreurApi(res, 400, "Le profil envoyé n'a pas la forme attendue.");
  }

  // La position vient du navigateur, sur le site. L'application ne la
  // demande pas : le serveur garde celle qu'il connait.
  const { latitude, longitude, ...donnees } = req.body;
  const resultat = enregistrerMonProfil(moi, donnees);
  if (resultat.probleme) return erreurApi(res, resultat.probleme.code, resultat.probleme.texte);

  res.json({ texte: resultat.texte });
});

// Le detail d'un tarif pendant la saisie. Le site le calcule dans le
// navigateur ; l'application le demande ici plutot que de recopier la
// commission.
//
// Sans session, lui aussi : ce n'est qu'un calcul, et Creer un compte
// l'affiche avant que le compte existe.
app.get("/api/detail-tarif", (req, res) => {
  res.json(tarifSurMonProfil(req.query.montant));
});

// --- L'adresse et le mot de passe depuis l'application ---------------
//
// Comme a la connexion, le mot de passe voyage sans chiffrement sur le
// reseau local, puisque le serveur s'ouvre en http://. Un vrai
// deploiement passerait en https.
function formeDeCleValide(corps, champs) {
  return Boolean(corps) && typeof corps === "object" && !Array.isArray(corps) &&
    champs.every((champ) => corps[champ] == null || typeof corps[champ] === "string");
}

app.post("/api/mon-profil/email", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusEquipeApi(res, moi)) return;

  if (!formeDeCleValide(req.body, ["nouveau", "motdepasse"])) {
    return erreurApi(res, 400, "La demande envoyée n'a pas la forme attendue.");
  }

  const resultat = changerMonEmail(moi, req.body);
  if (resultat.probleme) return erreurApi(res, resultat.probleme.code, resultat.probleme.texte);

  res.json({ texte: resultat.texte, email: resultat.email });
});

app.post("/api/mon-profil/mot-de-passe", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusEquipeApi(res, moi)) return;

  if (!formeDeCleValide(req.body, ["ancien", "nouveau"])) {
    return erreurApi(res, 400, "La demande envoyée n'a pas la forme attendue.");
  }

  const resultat = changerMonMotDePasse(moi, req.body);
  if (resultat.probleme) return erreurApi(res, resultat.probleme.code, resultat.probleme.texte);

  res.json({ texte: resultat.texte });
});

// --- Mon compte depuis l'application ---------------------------------
app.get("/api/mon-compte", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusEquipeApi(res, moi)) return;

  res.json(monCompte(moi));
});

// --- Mes jetons depuis l'application ---------------------------------
//
// La demande d'achat part de l'application comme du site : au prix du
// serveur, sans aucun numero ni code de paiement. Un prix envoye avec la
// demande est ignore.
app.get("/api/mes-jetons", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusEquipeApi(res, moi)) return;

  res.json(mesJetons(moi));
});

app.post("/api/mes-jetons/acheter", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusEquipeApi(res, moi)) return;

  const quantite = req.body && req.body.quantite;
  if (quantite != null && typeof quantite !== "number" && typeof quantite !== "string") {
    return erreurApi(res, 400, "La demande envoyée n'a pas la forme attendue.");
  }

  const resultat = demanderUnPack(moi, quantite);
  if (resultat.probleme) return erreurApi(res, resultat.probleme.code, resultat.probleme.texte);

  res.status(201).json({ texte: resultat.texte });
});

// --- Rechercher depuis l'application ----------------------------------
//
// L'application ne demande pas la position : la proximite se mesure a
// partir du quartier de l'employeur. Le score ne sort jamais.
function positionValide(latitude, longitude) {
  const nombre = (valeur) => (typeof valeur === "string" && valeur.trim() !== "" ? Number(valeur) : NaN);
  const lat = nombre(latitude);
  const lon = nombre(longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

app.get("/api/recherche", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (!moi) return erreurApi(res, 401, "Personne n'est connecté.");

  const metier = typeof req.query.metier === "string" ? req.query.metier : "";

  // LA POSITION DU TELEPHONE, si la personne l'a donnee avec "Chercher
  // pres de moi". Les deux nombres ou aucun : une position a moitie
  // envoyee ou hors de la Terre est refusee, plutot que de chercher sans
  // position en silence. Elle sert au classement, rien ne l'enregistre.
  const { latitude, longitude } = req.query;
  if ((latitude !== undefined || longitude !== undefined) && !positionValide(latitude, longitude)) {
    return erreurApi(res, 400, "La position envoyée n'est pas valide.");
  }
  const recherche = rechercherPersonnes({ metier, latitude, longitude }, moi);

  res.json({
    titre: recherche.titre,
    phraseLieu: recherche.phraseLieu,
    classementExplique: recherche.personnes.length > 1,
    personnes: recherche.personnes.map((p) => ({
      id: p.id,
      nom: p.nom,
      metier: p.metier || null,
      verifiee: p.verifiee,
      libelleVerification: p.verifiee ? "Identité vérifiée" : "Identité non vérifiée",
      note: p.note,
      joursDisponibles: p.joursDisponibles,
      experience: p.experience,
      lieu: p.lieu,
      tarif: p.tarif,
      distance: p.distance,
    })),
    peutPublier: Boolean(moi.role === "employeur" && !moi.est_admin),
  });
});

// --- Repondre a une demande depuis l'application ----------------------
//
// Les montants et les jetons arrivent deja ecrits : l'application ne
// recalcule ni la commission, ni le solde apres l'envoi.
app.get("/api/demandes/:id/reponse", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (!moi) return erreurApi(res, 401, "Personne n'est connecté.");

  const ecran = ecranPourRepondre(moi, Number(req.params.id));
  if (ecran.probleme) return erreurApiDuProbleme(res, ecran.probleme);

  const { annonce, reputationEmployeur, proposee, limite, restantAujourdhui } = ecran;

  res.json({
    demande: {
      id: annonce.id,
      titre: annonce.titre,
      metier: annonce.metier || null,
      horaire: annonce.horaire || "Horaire non précisé",
      quartier: annonce.quartier || null,
      arrondissement: annonce.arrondissement || null,
      conditions: annonce.conditions || null,
      dureeEstimee: annonce.duree_estimee || null,
    },
    employeur: {
      nom: annonce.nomEmployeur,
      verifie: annonce.verificationEmployeur === "verifie",
      note: reputationEmployeur.nombre > 0 ? `${moyenneLisible(reputationEmployeur.moyenne)} sur 5` : null,
      nombreAvis: reputationEmployeur.nombre,
    },
    // LE PRIX N'EST PLUS ANNONCE ICI : c'est l'equipe qui appelle, et la
    // personne lui dit son prix. Dire qu'un service interesse est gratuit.
    phrase: "C'est l'équipe PamConnect qui vous appellera pour convenir du prix.",
    proposee,
    limite: limite ? { parJour: limite, restant: restantAujourdhui } : null,
  });
});

app.post("/api/demandes/:id/reponse", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (!moi) return erreurApi(res, 401, "Personne n'est connecté.");

  const resultat = envoyerReponse(moi, Number(req.params.id));
  if (resultat.probleme) return erreurApiDuProbleme(res, resultat.probleme);

  res.status(201).json({ texte: resultat.texte, candidatureId: resultat.candidatureId });
});

// --- Mes reponses depuis l'application ---------------------------------
app.get("/api/mes-reponses", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (!moi) return erreurApi(res, 401, "Personne n'est connecté.");
  if (moi.est_admin || moi.role !== "prestataire") {
    return erreurApi(res, 403, "Cette page est celle des personnes qui répondent aux demandes.");
  }

  res.json({ reponses: mesReponses(moi) });
});

// --- J'ai effectue ce service, depuis l'application --------------------
app.post("/api/candidatures/:id/jai-effectue", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (!moi) return erreurApi(res, 401, "Personne n'est connecté.");

  const resultat = declarerAvoirTravaille(Number(req.params.id), moi);
  if (resultat.probleme) return erreurApi(res, resultat.probleme.code, resultat.probleme.texte);

  res.json({ texte: resultat.texte });
});

// --- La fiche d'une personne depuis l'application -------------------
//
// Publique, comme sur le site : l'application la montre a l'employeur
// qui hesite, et elle ne contient que des informations choisies une par
// une.
app.get("/api/personnes/:id", (req, res) => {
  const moi = utilisateurConnecte(req);
  const fiche = lireFichePublique(Number(req.params.id), moi);
  if (fiche.probleme) return erreurApi(res, fiche.probleme.code, fiche.probleme.texte);

  const { personne: p, peutVoirAge, reputation, avis } = fiche;
  const verifiee = p.statut_verification === "verifie";

  res.json({
    id: p.id,
    nom: p.nom,
    metier: p.metier || null,
    verifiee,
    libelleVerification: verifiee ? "Identité et casier vérifiés" : "Identité non vérifiée",
    note: notePersonne({ nbAvis: reputation.nombre, moyenne: reputation.moyenne, services: reputation.services }),
    badges: badgesDe(p).filter((b) => b.cle !== "verifie").map((b) => b.texte),
    trancheAge: peutVoirAge ? trancheAge(p.date_naissance) : null,
    lieu: [p.quartier, p.arrondissement].filter(Boolean).join(", ") || null,
    disponibilites: disponibilitesLisibles(p.disponibilites).map((c) => ({
      jour: c.jour.charAt(0).toUpperCase() + c.jour.slice(1),
      moments: c.moments.join(", "),
    })),
    tarif: formaterTarif(p.tarif),
    avis: {
      moyenne: reputation.nombre > 0 ? `${moyenneLisible(reputation.moyenne)} sur 5` : null,
      nombre: reputation.nombre,
      liste: avisLisibles(avis),
    },
    peutPublier: Boolean(moi && moi.role === "employeur" && !moi.est_admin),
    // On ne propose une demande qu'a une personne verifiee : les autres
    // ne peuvent pas y repondre.
    peutProposer: Boolean(moi && moi.role === "employeur" && !moi.est_admin && verifiee),
  });
});

// --- Signaler un probleme depuis l'application ----------------------
app.get("/api/discussions/:id/probleme", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (!moi) return erreurApi(res, 401, "Personne n'est connecté.");

  const formulaire = formulaireProbleme(Number(req.params.id), moi);
  if (formulaire.probleme) return erreurApi(res, formulaire.probleme.code, formulaire.probleme.texte);

  res.json({
    titreDemande: formulaire.conversation.titreAnnonce,
    autre: formulaire.autre.nom,
    dejaSignale: formulaire.dejaSignale,
    consequences: formulaire.consequences,
    apresSignalement: formulaire.apresSignalement,
    texteMax: PROBLEME_TEXTE_MAX,
  });
});

app.post("/api/discussions/:id/probleme", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (!moi) return erreurApi(res, 401, "Personne n'est connecté.");

  const saisie = req.body && req.body.texte;
  if (saisie != null && typeof saisie !== "string") {
    return erreurApi(res, 400, "Le signalement envoyé n'a pas la forme attendue.");
  }

  const resultat = signalerUnProbleme(Number(req.params.id), moi, saisie);
  if (resultat.probleme) return erreurApi(res, resultat.probleme.code, resultat.probleme.texte);

  res.status(201).json({ texte: resultat.texte });
});

// UNE ADRESSE /api INCONNUE REPOND EN JSON, comme toute l'API. Une page
// HTML faisait croire a l'application qu'elle parlait a un autre serveur,
// alors que, le plus souvent, le serveur avait ete lance avant la derniere
// mise a jour et ne connaissait pas encore l'ecran demande.
app.use("/api", (req, res) => {
  erreurApi(res, 404, "Le serveur ne connaît pas cet écran. S'il a été lancé avant la " +
    "dernière mise à jour, arrêtez-le puis relancez-le.");
});

app.use((req, res) => {
  res.status(404).render("message", {
    titre: "404 - Page introuvable",
    texte: "Cette page n'existe pas.",
    liens: [{ url: "/", texte: "Retour a l'accueil" }],
  });
});

app.listen(PORT, () => {
  console.log(`Serveur PamConnect démarré : http://localhost:${PORT}`);

  // Les adresses par lesquelles un TELEPHONE peut atteindre ce serveur.
  //
  // localhost ne veut dire que "cet ordinateur-ci" : tape depuis un
  // telephone, il chercherait le telephone lui-meme. Il faut l'adresse de
  // l'ordinateur SUR LE RESEAU, et les deux appareils doivent etre sur le
  // meme reseau - meme box, ou le partage de connexion du telephone.
  //
  // Aucune connexion internet n'est necessaire : seule compte la liaison
  // locale entre les deux appareils. C'est ce qui rendra la demonstration
  // possible le jour de la soutenance, meme sans internet dans la salle.
  //
  // Le NOM de chaque carte est ecrit a cote de son adresse. VirtualBox et
  // VMware ajoutent des reseaux qui n'existent que dans l'ordinateur : le
  // telephone ne joint que celle du Wi-Fi, ou du cable. Sans le nom, il
  // fallait deviner laquelle taper.
  const adresses = Object.entries(os.networkInterfaces())
    .flatMap(([nom, cartes]) => cartes.map((carte) => ({ nom, ...carte })))
    .filter((carte) => carte.family === "IPv4" && !carte.internal)
    // 169.254.x.x : Windows attribue cette plage a une carte reseau qui
    // n'a trouve aucun reseau. L'afficher n'induirait qu'en erreur.
    .filter((carte) => !carte.address.startsWith("169.254."));

  if (adresses.length) {
    console.log("Depuis un téléphone sur le même réseau :");
    adresses.forEach((carte) => console.log(`   http://${carte.address}:${PORT}   (${carte.nom})`));
  }
});
