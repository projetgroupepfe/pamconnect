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
ajouterColonneSiAbsente("utilisateurs", "date_naissance", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "experience_annees", "INTEGER");
ajouterColonneSiAbsente("utilisateurs", "disponibilites", "TEXT");
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
ajouterColonneSiAbsente("versements", "decide_par", "INTEGER");
ajouterColonneSiAbsente("versements", "motif_decision", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "message_equipe", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "message_equipe_le", "TEXT");
ajouterColonneSiAbsente("utilisateurs", "message_equipe_lu", "INTEGER NOT NULL DEFAULT 0");
ajouterColonneSiAbsente("quartiers", "synonymes", "TEXT NOT NULL DEFAULT ''");
ajouterColonneSiAbsente("annonces", "annulee", "INTEGER NOT NULL DEFAULT 0");
ajouterColonneSiAbsente("annonces", "annulee_le", "TEXT");
ajouterColonneSiAbsente("annonces", "mise_en_avant_jusqu_au", "TEXT");

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

// RATTRAPAGE : les demandes publiees avant l'existence du sequestre n'ont
// pas de versement. La regle veut que toute demande en porte un - sinon
// l'ecran de l'equipe serait vide et les comptes des personnes aussi.
//
// Chaque versement manquant est reconstruit A PARTIR DE LA DEMANDE
// elle-meme : son prix, son auteur, son etat. Aucun montant n'est
// invente, et rien n'est ecrase : seules les demandes SANS versement
// sont traitees.
//
// Place APRES db.exec : la table versements doit exister.
{
  const sans = db.prepare(`
    SELECT a.id, a.employeur_id, a.prix, a.annulee,
           (SELECT c.prestataire_id FROM candidatures c
             WHERE c.annonce_id = a.id AND c.statut = 'acceptee'
             ORDER BY c.id LIMIT 1) AS retenu,
           (SELECT c.terminee_le FROM candidatures c
             WHERE c.annonce_id = a.id AND c.statut = 'acceptee'
             ORDER BY c.id LIMIT 1) AS termineeLe
    FROM annonces a
    WHERE a.prix > 0
      AND NOT EXISTS (SELECT 1 FROM versements v WHERE v.annonce_id = a.id)
  `).all();

  if (sans.length > 0) {
    const poser = db.prepare(`
      INSERT INTO versements
        (annonce_id, employeur_id, montant, etat, denoue_le, beneficiaire_id, commission, net)
      VALUES (@annonce, @employeur, @montant, @etat, @denoue, @beneficiaire, @commission, @net)
    `);

    for (const a of sans) {
      const commission = Math.round(a.prix * 0.10);

      // Le service a eu lieu : la somme est deja partie.
      if (a.retenu && a.termineeLe) {
        poser.run({ annonce: a.id, employeur: a.employeur_id, montant: a.prix,
          etat: "verse", denoue: a.termineeLe, beneficiaire: a.retenu,
          commission, net: a.prix - commission });

      // Demande retiree sans que personne n'ait ete choisi : rendue.
      } else if (a.annulee === 1 && !a.retenu) {
        poser.run({ annonce: a.id, employeur: a.employeur_id, montant: a.prix,
          etat: "rembourse", denoue: null, beneficiaire: null,
          commission: null, net: null });

      // Tout le reste attend : demande ouverte, ou pourvue et pas encore
      // declaree effectuee.
      } else {
        poser.run({ annonce: a.id, employeur: a.employeur_id, montant: a.prix,
          etat: "bloque", denoue: null, beneficiaire: null,
          commission: null, net: null });
      }
    }

    console.log(`Versements reconstruits pour ${sans.length} demande(s) deja publiee(s)`);
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
      (role, nom, email, motdepasse, arrondissement, quartier, metier, tarif,
       latitude, longitude, date_naissance, experience_annees, disponibilites)
    VALUES
      (@role, @nom, @email, @motdepasse, @arrondissement, @quartier, @metier, @tarif,
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
        horaire = @horaire, prix = @prix, unite_tarif = @unite_tarif,
        duree_estimee = @duree_estimee, conditions = @conditions
    WHERE id = @id
  `),

  annoncesDeEmployeur: db.prepare(`
    SELECT *,
           (mise_en_avant_jusqu_au IS NOT NULL
            AND mise_en_avant_jusqu_au > datetime('now')) AS enAvant
    FROM annonces WHERE employeur_id = ? ORDER BY cree_le DESC, id DESC
  `),

  creerAnnonce: db.prepare(`
    INSERT INTO annonces
      (employeur_id, titre, metier, arrondissement, quartier, horaire,
       prix, unite_tarif, duree_estimee, conditions)
    VALUES
      (@employeur_id, @titre, @metier, @arrondissement, @quartier, @horaire,
       @prix, @unite_tarif, @duree_estimee, @conditions)
  `),

  // JOIN : on recupere la candidature ET le nom du prestataire
  // en une seule requete, au lieu de chercher ensuite dans une liste.
  candidaturesDeAnnonce: db.prepare(`
    SELECT c.id,
           c.statut,
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
  candidaturesRecentes: db.prepare(`
    SELECT COUNT(*) AS n FROM candidatures
    WHERE prestataire_id = ? AND envoyee_le >= datetime('now', '-1 day')
  `),

  // Quand la plus ancienne des reponses recentes sortira de la fenetre :
  // c'est le moment ou une place se libere.
  prochaineReponsePossible: db.prepare(`
    SELECT datetime(MIN(envoyee_le), '+1 day') AS quand
    FROM candidatures
    WHERE prestataire_id = ? AND envoyee_le >= datetime('now', '-1 day')
  `),

  // Verifie en UNE requete que la candidature existe ET que l'annonce
  // concernee appartient bien a l'employeur connecte.
  candidatureDeMonAnnonce: db.prepare(`
    SELECT c.id, u.statut_verification AS verificationPrestataire
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
    UPDATE messages SET signale = 1 WHERE id = ? AND auteur_id != ?
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

  // La publication bloque la somme annoncee.
  bloquerVersement: db.prepare(`
    INSERT INTO versements (annonce_id, employeur_id, montant)
    VALUES (@annonce, @employeur, @montant)
  `),

  // Le prix d'une demande peut changer tant que personne n'a repondu.
  // La somme bloquee doit suivre, sinon les deux chiffres divergent.
  ajusterVersement: db.prepare(`
    UPDATE versements SET montant = @montant
    WHERE annonce_id = @annonce AND etat = 'bloque'
  `),

  rembourserVersement: db.prepare(`
    UPDATE versements
    SET etat = 'rembourse', denoue_le = datetime('now')
    WHERE annonce_id = @annonce AND etat = 'bloque'
  `),

  verserVersement: db.prepare(`
    UPDATE versements
    SET etat            = 'verse',
        denoue_le       = datetime('now'),
        beneficiaire_id = @beneficiaire,
        commission      = @commission,
        net             = @net
    WHERE annonce_id = @annonce AND etat = 'bloque'
  `),

  // L'equipe verse a la personne. Meme calcul que la declaration de
  // l'employeur - seule la trace differe.
  verserParEquipe: db.prepare(`
    UPDATE versements
    SET etat            = 'verse',
        denoue_le       = datetime('now'),
        beneficiaire_id = @beneficiaire,
        commission      = @commission,
        net             = @net,
        decide_par      = @par,
        motif_decision  = @motif
    WHERE annonce_id = @annonce AND etat = 'bloque'
  `),

  rembourserParEquipe: db.prepare(`
    UPDATE versements
    SET etat           = 'rembourse',
        denoue_le      = datetime('now'),
        decide_par     = @par,
        motif_decision = @motif
    WHERE annonce_id = @annonce AND etat = 'bloque'
  `),

  // La candidature acceptee d'une demande, avec ce qu'il faut pour
  // savoir si un desaccord existe et qui en est l'autre partie.
  candidatureRetenue: db.prepare(`
    SELECT c.id, c.prestataire_id, c.terminee_le, c.declaree_par_elle_le
    FROM candidatures c
    WHERE c.annonce_id = ? AND c.statut = 'acceptee'
    ORDER BY c.id LIMIT 1
  `),

  versementDeLAnnonce: db.prepare(`
    SELECT * FROM versements WHERE annonce_id = ?
  `),

  // Le solde n'est jamais range quelque part : il est recalcule. Un
  // total garde a cote de ses lignes finit toujours par leur mentir.
  soldeDe: db.prepare(`
    SELECT COALESCE(SUM(net), 0) AS solde
    FROM versements WHERE beneficiaire_id = ? AND etat = 'verse'
  `),

  mesVersementsRecus: db.prepare(`
    SELECT v.montant, v.commission, v.net, v.denoue_le,
           a.titre AS titreAnnonce,
           e.nom   AS nomEmployeur
    FROM versements v
    JOIN annonces     a ON a.id = v.annonce_id
    JOIN utilisateurs e ON e.id = v.employeur_id
    WHERE v.beneficiaire_id = ? AND v.etat = 'verse'
    ORDER BY v.denoue_le DESC, v.id DESC
  `),

  mesVersementsEnvoyes: db.prepare(`
    SELECT v.montant, v.etat, v.cree_le, v.denoue_le, v.net,
           a.titre   AS titreAnnonce,
           a.annulee AS demandeFermee,
           b.nom     AS nomBeneficiaire
    FROM versements v
    JOIN annonces a ON a.id = v.annonce_id
    LEFT JOIN utilisateurs b ON b.id = v.beneficiaire_id
    WHERE v.employeur_id = ?
    ORDER BY v.cree_le DESC, v.id DESC
  `),

  // TOUT ce que l'equipe doit voir : l'argent qui entre, celui qui
  // sort, et pour quel metier. Une plateforme qui garde l'argent de
  // quelqu'un doit pouvoir dire ce qu'elle en a fait.
  //
  // Les sommes bloquees d'abord, la plus ancienne en tete : ce sont les
  // seules qui attendent quelque chose. Les autres sont une trace.
  tousLesVersements: db.prepare(`
    SELECT v.id, v.montant, v.cree_le, v.etat,
           v.denoue_le, v.commission, v.net,
           v.motif_decision,
           q.nom AS nomDecideur,
           a.id      AS annonceId,
           a.titre   AS titreAnnonce,
           a.metier  AS metierAnnonce,
           a.annulee AS demandeFermee,
           e.id      AS employeurId,
           e.nom     AS nomEmployeur,
           e.email   AS emailEmployeur,
           b.nom     AS nomBeneficiaire,
           (SELECT u.nom FROM candidatures c
              JOIN utilisateurs u ON u.id = c.prestataire_id
             WHERE c.annonce_id = a.id AND c.statut = 'acceptee'
             LIMIT 1) AS nomRetenu,
           (SELECT c.terminee_le FROM candidatures c
             WHERE c.annonce_id = a.id AND c.statut = 'acceptee'
             LIMIT 1) AS serviceTermineLe,
           (SELECT c.declaree_par_elle_le FROM candidatures c
             WHERE c.annonce_id = a.id AND c.statut = 'acceptee'
             LIMIT 1) AS declareeParElleLe
    FROM versements v
    JOIN annonces     a ON a.id = v.annonce_id
    JOIN utilisateurs e ON e.id = v.employeur_id
    LEFT JOIN utilisateurs b ON b.id = v.beneficiaire_id
    LEFT JOIN utilisateurs q ON q.id = v.decide_par
    ORDER BY v.etat = 'bloque' DESC, v.cree_le, v.id
  `),

  nombreVersementsBloques: db.prepare(`
    SELECT COUNT(*) AS n FROM versements WHERE etat = 'bloque'
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
        statut_verification = 'en attente',
        documents_envoyes_le = datetime('now'),
        verifie_le = NULL,
        motif_refus = NULL
    WHERE id = @id
  `),

  dossiersEnAttente: db.prepare(`
    SELECT id, nom, email, role, metier, arrondissement, quartier,
           documents_envoyes_le
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
  validerVerification: db.prepare(`
    UPDATE utilisateurs
    SET statut_verification = 'verifie',
        verifie_le = datetime('now'),
        motif_refus = NULL,
        cni_fichier = NULL,
        casier_fichier = NULL
    WHERE id = ?
  `),

  refuserVerification: db.prepare(`
    UPDATE utilisateurs
    SET statut_verification = 'refuse',
        motif_refus = ?,
        verifie_le = NULL,
        cni_fichier = NULL,
        casier_fichier = NULL
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

function verifierMotDePasse(motDePasseSaisi, motDePasseHache) {
  const [sel, hache] = motDePasseHache.split(":");
  const hacheTest = crypto.scryptSync(motDePasseSaisi, sel, 64).toString("hex");
  return hache === hacheTest;
}

// ============================================================
// LE MODELE ECONOMIQUE
// ------------------------------------------------------------
// La personne qui propose ses services annonce son tarif BRUT.
// L'employeur paie exactement ce tarif, sans frais ajoute.
// La plateforme retient une commission sur ce montant, puis
// reverse le solde a la personne qui a fait le travail.
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

// Detaille un tarif : ce qui est demande, ce que retient la
// plateforme, et ce qui revient reellement a la personne.
function detaillerTarif(tarifBrut) {
  const brut = Math.round(Number(tarifBrut) || 0);
  const commission = Math.round(brut * TAUX_COMMISSION);
  return { brut, commission, net: brut - commission };
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

  // Le prix est OBLIGATOIRE. C'est l'employeur qui annonce ce qu'il
  // paiera : sans ce montant, une personne devrait postuler sans savoir
  // ce qu'elle touchera, et il faudrait negocier - ce que cette
  // plateforme ne fait pas.
  const prix = Math.round(Number(String(donnees.prix || "").trim()));

  if (!(Number.isFinite(prix) && prix > 0)) {
    return {
      titre: "Prix obligatoire",
      texte: "Indiquez le montant que vous paierez pour ce service. " +
             "C'est sur lui que les candidates décideront de répondre.",
    };
  }

  if (!montantAccepte(prix)) {
    return {
      titre: "Prix non accepté",
      texte: `Le prix doit être ${regleMontantLisible()}.`,
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
    prix: Math.round(Number(String(donnees.prix || "").trim())) || null,
    // L'unite vient d'une liste fermee. On ne fait pas confiance au
    // navigateur : une valeur inconnue est ramenee a celle par defaut.
    unite_tarif: UNITES_TARIF[donnees.unite_tarif] ? donnees.unite_tarif : "forfaitaire",
    duree_estimee: String(donnees.duree_estimee || "").trim() || null,
    conditions: String(donnees.conditions || "").trim() || null,
  };
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
      texte: "Indiquez le tarif que vous demandez pour une prestation. " +
             "C'est ce montant que l'employeur paiera.",
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
  if (donnees.date_naissance && !ageValide(donnees.date_naissance)) {
    return {
      titre: "Date de naissance invalide",
      texte: "La plateforme est réservée aux personnes majeures. " +
             "Vérifiez la date que vous avez saisie.",
    };
  }

  return null;
}

// Traduit le statut technique en texte lisible par un humain.
// LE DELAI ANNONCE. Une seule valeur, ecrite une fois : les ecrans la
// lisent au lieu d'ecrire "24" chacun de leur cote.
const DELAI_VERIFICATION_HEURES = 24;

// Une somme bloquee sur une demande POURVUE attend que l'employeur
// declare le service effectue. Passe ce delai, l'equipe doit la voir :
// la personne a peut-etre travaille sans etre payee.
//
// CE NOMBRE EST UN CHOIX, pas une regle du metier. Il se change ici, en
// une ligne.
const DELAI_ALERTE_VERSEMENT_JOURS = 7;

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

// Depuis combien de jours une somme est-elle bloquee, et faut-il que
// l'equipe s'en inquiete ? Meme lecture du temps que pour les dossiers
// d'identite : la date est en temps universel, on le dit a Date.parse.
function attenteVersement(creeLe) {
  if (!creeLe) return null;

  const depart = Date.parse(String(creeLe).replace(" ", "T") + "Z");
  if (Number.isNaN(depart)) return null;

  const jours = Math.floor((Date.now() - depart) / 86400000);

  // "0 jour" est juste et illisible : une somme posee il y a deux heures
  // n'attend pas depuis zero jour, elle attend depuis aujourd'hui.
  const lisible = jours < 1 ? "aujourd'hui"
                : jours === 1 ? "1 jour"
                : jours + " jours";

  return { jours, lisible, depasse: jours >= DELAI_ALERTE_VERSEMENT_JOURS };
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

  if (jeSuisEmployeur) return "En attente de votre décision";

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

  if (age < 18 || age > 120) return null;

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

// Les phrases proposees dans les cadres de saisie.
//
// Ce sont des EXEMPLES, pas du contenu de la plateforme : ils montrent
// comment commencer a quelqu'un qui n'a jamais ecrit dans une
// application. Ils sont tires au hasard a chaque affichage, pour deux
// raisons : personne ne recopie mot pour mot la phrase qu'on lui souffle,
// et une phrase unique repetee des mois finit par ressembler a une
// consigne officielle.
//
// Ils sont rassembles ICI pour pouvoir etre corriges ou completes sans
// toucher aux ecrans - et ils ne sont pas les memes des deux cotes.
const EXEMPLES_MESSAGE = {
  employeur: [
    "Bonjour, j'ai besoin de quelqu'un lundi, mercredi et samedi de 8h à 12h. Êtes-vous disponible ?",
    "Bonjour, est-ce que vous travaillez aussi le samedi matin ?",
    "Bonjour, la maison a trois chambres et un salon. Cela vous convient-il ?",
  ],
  prestataire: [
    "Bonjour, je suis disponible ces trois matinées. Je travaille dans le quartier depuis quatre ans.",
    "Bonjour, votre horaire me convient. Puis-je commencer lundi prochain ?",
    "Bonjour, je peux venir le matin. Combien de pièces faut-il faire ?",
  ],
};

const EXEMPLES_RAISON = [
  "C'est trois matinées par semaine, et le quartier est loin de chez moi.",
  "Le logement est grand, cela me prendra plus de temps que d'habitude.",
  "Je peux baisser un peu si vous me prenez toutes les semaines.",
];

function auHasard(liste) {
  return liste[Math.floor(Math.random() * liste.length)];
}

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
function coutDeLAction(role) {
  return parametreNombre(role === "employeur"
    ? "cout_mise_en_avant"
    : "cout_candidature");
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
    : `répondre à ${n} ${n > 1 ? "demandes" : "demande"}`;
}

// La meme chose au singulier indefini, pour les phrases qui parlent
// d'une action sans la compter : "il vous manque 5 jetons pour ...".
function uneAction(estEmployeur) {
  return estEmployeur ? "mettre une demande en avant" : "répondre à une demande";
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
app.locals.pourcentageCommission = Math.round(TAUX_COMMISSION * 100);
app.locals.libelleVerification = libelleVerification;
app.locals.phraseCandidature = phraseCandidature;
app.locals.attenteVerification = attenteVerification;
app.locals.attenteVersement = attenteVersement;
app.locals.delaiAlerteVersementJours = DELAI_ALERTE_VERSEMENT_JOURS;
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

  limits: { fileSize: TAILLE_MAX_OCTETS, files: 2 },

  fileFilter: (req, fichier, suite) => {
    const extension = path.extname(fichier.originalname).toLowerCase();
    if (!EXTENSIONS_AUTORISEES.includes(extension)) {
      return suite(new Error("TYPE_NON_AUTORISE"));
    }
    suite(null, true);
  },
}).fields([
  { name: "cni", maxCount: 1 },
  { name: "casier", maxCount: 1 },
]);

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
      titre: "Acces refuse",
      texte: "Cette page est reservee a l'equipe de PamConnect.",
      liens: [{ url: "/", texte: "Retour a l'accueil" }],
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
  res.locals.aLireSurMonProfil = moi && !moi.est_admin
    ? (moi.message_equipe && !moi.message_equipe_lu ? 1 : 0)
      + (moi.avertissement_motif && !moi.avertissement_lu ? 1 : 0)
    : 0;

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
app.get("/employeur", (req, res) => res.render("employeur", { titre: "Espace employeur" }));
app.get("/prestataire", (req, res) => res.render("prestataire", { titre: "Espace prestataire" }));
app.get("/inscription", (req, res) => res.render("inscription", { titre: "Creer un compte" }));
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

// --- Inscription ---------------------------------------------------
app.post("/inscription", lireFormulaire, (req, res) => {
  const donnees = req.body;
  const email = (donnees.email || "").trim().toLowerCase();

  if (requetes.utilisateurParEmail.get(email)) {
    return res.status(409).render("message", {
      titre: "Email deja utilise",
      texte: `Un compte existe deja avec l'adresse ${donnees.email}.`,
      liens: [
        { url: "/connexion", texte: "Se connecter" },
        { url: "/inscription", texte: "Reessayer" },
      ],
    });
  }

  // Sans metier, la personne n'apparait dans aucune recherche.
  // Sans tarif, la plateforme ne peut ni faire payer, ni reverser.
  if (donnees.role === "prestataire") {
    const probleme = verifierProfilPrestataire(donnees);
    if (probleme) {
      return res.status(400).render("message", Object.assign({}, probleme, {
        liens: [{ url: "/inscription", texte: "Retour au formulaire" }],
      }));
    }
  }

  // Le quartier commande : l'arrondissement en est deduit (voir resoudreLieu).
  const lieu = resoudreLieu(donnees);

  requetes.creerUtilisateur.run({
    role: donnees.role,
    nom: donnees.nom,
    email,
    motdepasse: hacherMotDePasse(donnees.motdepasse),
    arrondissement: lieu.arrondissement,
    quartier: lieu.quartier,
    metier: resoudreMetier(donnees.metier),
    tarif: donnees.tarif ? Number(donnees.tarif) : null,
    date_naissance: donnees.date_naissance || null,
    experience_annees: donnees.experience_annees ? Math.round(Number(donnees.experience_annees)) : null,
    disponibilites: resoudreDisponibilites(donnees),
    latitude: donnees.latitude ? Number(donnees.latitude) : null,
    longitude: donnees.longitude ? Number(donnees.longitude) : null,
  });

  console.log("Nouvel utilisateur enregistré :", email);

  res.render("message", {
    titre: `Merci ${donnees.nom} !`,
    texte: "Votre compte est créé. Vous pouvez maintenant vous connecter.",
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
app.get("/mon-profil", exigerConnexion, (req, res) => {
  // CETTE PAGE DIT QUI JE SUIS, PAS CE QUE JE FAIS. Ses demandes ou
  // ses reponses ont leur propre page : melangees ici, elles
  // repoussaient hors de l'ecran les informations et les avis.
  res.render("profil", {
    titre: "Mon profil",
    utilisateur: req.utilisateur,

    // Ce que les autres disent de moi. Signalable ici, et nulle part
    // ailleurs : c est mon profil, ce sont mes avis.
    reputation: reputationDe(req.utilisateur.id),
    mesAvis: requetes.avisRecus.all(req.utilisateur.id),
    servicesANoter: requetes.servicesANoter.get({ moi: req.utilisateur.id }).n,
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
      enAvant,
      enAvantJusquAu: enAvant ? dateLisible(annonce.mise_en_avant_jusqu_au) : null,
      // L'ETAT AVANT L'ACTION : une demande deja en avant n'a pas besoin
      // du bouton, elle a besoin d'une date.
      peutModifier: !fermee,
      peutMettreEnAvant: !fermee && !enAvant,
      peutRetirer: !fermee,
      candidatures: candidatures.map((c) => {
        const enAttente = c.statut === "en attente";
        const verifiee = c.verificationPrestataire === "verifie";
        return {
          ...c,
          phrase: phraseCandidature(c.statut, true, { quelquUnChoisi: pourvue }),
          libelleVerification: libelleVerification(c.verificationPrestataire),
          note: notePersonne({ nbAvis: c.nbAvis, moyenne: c.moyenne, services: c.servicesTermines }),
          experience: libelleExperience(c.experiencePrestataire),
          disponibilites: disponibilitesLisibles(c.disponibilitesPrestataire).map((d) => d.jour).join(", "),
          // On n'engage personne dont l'identite n'est pas verifiee ;
          // refuser, en revanche, reste toujours possible.
          peutChoisir: enAttente && verifiee,
          peutRefuser: enAttente,
          attendVerification: enAttente && !verifiee,
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
      titre: "Acces refuse",
      texte: "Cette page est celle des employeurs. Les demandes " +
             "auxquelles vous avez repondu sont sur Mes reponses.",
      liens: [{ url: "/mes-reponses", texte: "Voir mes reponses" }],
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
app.get("/mes-reponses", exigerConnexion, interdireALEquipe, (req, res) => {
  if (req.utilisateur.role !== "prestataire") {
    return res.status(403).render("message", {
      titre: "Acces refuse",
      texte: "Cette page est celle des personnes qui repondent. Vos " +
             "demandes publiees sont sur Mes demandes.",
      liens: [{ url: "/mes-demandes", texte: "Voir mes demandes" }],
    });
  }

  res.render("mes-reponses", {
    titre: "Mes reponses",
    utilisateur: req.utilisateur,
    mesCandidatures: requetes.candidaturesDePrestataire.all(req.utilisateur.id),
  });
});

// --- Modifier son profil : le formulaire ---------------------------
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
  const donnees = req.body;
  const moi = req.utilisateur;

  if (!String(donnees.nom || "").trim()) {
    return res.status(400).render("message", {
      titre: "Nom obligatoire",
      texte: "Indiquez le nom sous lequel vous souhaitez apparaître.",
      liens: [{ url: "/mon-profil/modifier", texte: "Retour au formulaire" }],
    });
  }

  // Les memes regles qu'a l'inscription, appelees au meme endroit.
  if (moi.role === "prestataire") {
    const probleme = verifierProfilPrestataire(donnees);
    if (probleme) {
      return res.status(400).render("message", Object.assign({}, probleme, {
        liens: [{ url: "/mon-profil/modifier", texte: "Retour au formulaire" }],
      }));
    }
  }

  const lieu = resoudreLieu(donnees);

  requetes.majProfil.run({
    id: moi.id,
    nom: String(donnees.nom).trim(),
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
    experience_annees: moi.role === "prestataire" && donnees.experience_annees
      ? Math.round(Number(donnees.experience_annees)) : null,
    disponibilites: moi.role === "prestataire" ? resoudreDisponibilites(donnees) : null,
  });

  // La position n'est mise a jour que si le navigateur l'a fournie :
  // on ne remplace jamais une position connue par du vide.
  const latitude = Number(donnees.latitude);
  const longitude = Number(donnees.longitude);
  if (!isNaN(latitude) && !isNaN(longitude) && donnees.latitude && donnees.longitude) {
    requetes.majPosition.run(latitude, longitude, moi.id);
  }

  res.render("message", {
    titre: "Profil mis à jour",
    texte: "Vos informations ont bien été enregistrées.",
    liens: [{ url: "/mon-profil", texte: "Voir mon profil" }],
  });
});

// --- Changer son adresse email -------------------------------------
// L'adresse sert a se connecter : la changer, c'est changer sa cle.
// On exige donc le mot de passe actuel, exactement comme pour le
// changement de mot de passe. Un ordinateur laisse ouvert ne suffit pas.
//
// LIMITE CONNUE : la nouvelle adresse n'est jamais verifiee, car la
// plateforme n'envoie aucun email. Ce n'est pas genant ici : l'adresse
// sert uniquement a se connecter, elle ne recoit rien. Cela le
// deviendrait le jour ou la plateforme enverrait des notifications.
app.post("/mon-profil/email", exigerConnexion, lireFormulaire, (req, res) => {
  const moi = req.utilisateur;
  const nouvelEmail = String(req.body.nouveau || "").trim().toLowerCase();

  const retour = [{ url: "/mon-profil/modifier", texte: "Réessayer" }];

  if (!verifierMotDePasse(req.body.motdepasse || "", moi.motdepasse)) {
    return res.status(403).render("message", {
      titre: "Mot de passe incorrect",
      texte: "Pour changer votre adresse, il faut saisir votre mot de passe actuel.",
      liens: retour,
    });
  }

  // Un controle volontairement minimal : une adresse doit contenir un @
  // et un point apres. Trop strict, on refuserait des adresses valides.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nouvelEmail)) {
    return res.status(400).render("message", {
      titre: "Adresse invalide",
      texte: "Vérifiez l'adresse saisie : il manque un @ ou le nom du site.",
      liens: retour,
    });
  }

  if (nouvelEmail === moi.email) {
    return res.status(400).render("message", {
      titre: "Adresse inchangée",
      texte: "C'est déjà votre adresse actuelle.",
      liens: [{ url: "/mon-profil", texte: "Retour à mon profil" }],
    });
  }

  if (requetes.utilisateurParEmail.get(nouvelEmail)) {
    return res.status(409).render("message", {
      titre: "Adresse déjà utilisée",
      texte: "Un autre compte utilise déjà cette adresse.",
      liens: retour,
    });
  }

  try {
    requetes.majEmail.run(nouvelEmail, moi.id);
  } catch (erreur) {
    // La contrainte UNIQUE de la base est le dernier rempart, au cas ou
    // deux personnes viseraient la meme adresse au meme instant.
    if (String(erreur.message).includes("UNIQUE")) {
      return res.status(409).render("message", {
        titre: "Adresse déjà utilisée",
        texte: "Un autre compte utilise déjà cette adresse.",
        liens: retour,
      });
    }
    throw erreur;
  }

  // La session retient l'identifiant, pas l'adresse : la personne
  // reste connectee, elle n'a rien a refaire.
  res.render("message", {
    titre: "Adresse modifiée",
    texte: "Votre nouvelle adresse est " + nouvelEmail +
           ". C'est désormais celle-ci qu'il faudra saisir pour vous connecter.",
    liens: [{ url: "/mon-profil", texte: "Voir mon profil" }],
  });
});

// --- Changer son mot de passe --------------------------------------
//
// LIMITE CONNUE : on ne peut changer son mot de passe qu'en connaissant
// l'ancien. Il n'existe AUCUNE recuperation : un mot de passe oublie
// signifie un compte perdu, et pour une aide-menagere, la perte de son
// statut verifie.
//
// La solution correcte est l'envoi d'un lien de reinitialisation que la
// personne complete elle-meme : le support ne connait alors jamais le
// mot de passe. Elle suppose un service d'envoi d'emails.
//
// Nous avons volontairement ECARTE la solution consistant a permettre a
// l'equipe de reinitialiser un mot de passe : elle lui donnerait la
// capacite de se connecter a la place de n'importe qui. Principe du
// moindre privilege - l'equipe verifie des documents, elle n'a pas a
// pouvoir agir au nom des utilisateurs.
app.post("/mon-profil/mot-de-passe", exigerConnexion, lireFormulaire, (req, res) => {
  const donnees = req.body;
  const moi = req.utilisateur;

  // On redemande l'ancien mot de passe : sans cela, quelqu'un qui
  // trouverait un ordinateur ouvert pourrait s'approprier le compte.
  if (!verifierMotDePasse(donnees.ancien || "", moi.motdepasse)) {
    return res.status(403).render("message", {
      titre: "Mot de passe actuel incorrect",
      texte: "Pour changer votre mot de passe, il faut d'abord saisir l'ancien.",
      liens: [{ url: "/mon-profil/modifier", texte: "Réessayer" }],
    });
  }

  const nouveau = String(donnees.nouveau || "");

  if (nouveau.length < 6) {
    return res.status(400).render("message", {
      titre: "Mot de passe trop court",
      texte: "Choisissez un mot de passe d'au moins 6 caractères.",
      liens: [{ url: "/mon-profil/modifier", texte: "Réessayer" }],
    });
  }

  requetes.majMotDePasse.run(hacherMotDePasse(nouveau), moi.id);

  res.render("message", {
    titre: "Mot de passe modifié",
    texte: "Votre nouveau mot de passe est actif dès maintenant.",
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
      titre: "Acces refuse",
      texte: "Seuls les employeurs peuvent publier une demande.",
      liens: [{ url: "/", texte: "Retour a l'accueil" }],
    });
  }

  res.render("publier-annonce", { titre: "Publier une demande" });
});

// --- Enregistrer une annonce ---------------------------------------
//
// PUBLIER EST ECRIT UNE SEULE FOIS. Le site et l'application passent par
// cette fonction : la meme verification, le meme enregistrement, la meme
// somme bloquee, la meme phrase de confirmation.
function publierDemande(employeurId, donnees) {
  const probleme = verifierAnnonce(donnees);
  if (probleme) return { probleme };

  const champs = champsAnnonce(donnees);

  // L'employeur n'a pas publie par plaisir : la somme qu'il annonce est
  // bloquee des maintenant. La personne qui repondra sait ainsi que
  // l'argent existe avant de se deplacer.
  //
  // SIMULATION : rien n'est encaisse. La ligne enregistree dit ce qui
  // DEVRAIT se passer, et les ecrans le precisent.
  //
  // LES DEUX OU AUCUNE : une demande en ligne sans sa somme bloquee
  // annoncerait un argent qui n'existe pas.
  const id = db.transaction(() => {
    const creee = requetes.creerAnnonce.run(Object.assign({ employeur_id: employeurId }, champs));
    const nouvelle = Number(creee.lastInsertRowid);
    requetes.bloquerVersement.run({ annonce: nouvelle, employeur: employeurId, montant: champs.prix || 0 });
    return nouvelle;
  })();

  return {
    id,
    titre: "Demande publiée",
    texte: `Votre demande "${champs.titre}" est en ligne. La somme annoncée ` +
           `est bloquée par PamConnect jusqu'à la fin du service.`,
  };
}

app.post("/annonces", exigerConnexion, interdireALEquipe, exigerVerification, lireFormulaire, (req, res) => {
  // Le formulaire ne s'ouvrait qu'aux employeurs, mais l'envoi ne
  // verifiait pas le role : une personne verifiee qui repond aux demandes
  // pouvait en publier une en envoyant le formulaire a la main.
  if (req.utilisateur.role !== "employeur") {
    return res.status(403).render("message", {
      titre: "Acces refuse",
      texte: "Seuls les employeurs peuvent publier une demande.",
      liens: [{ url: "/", texte: "Retour a l'accueil" }],
    });
  }

  const resultat = publierDemande(req.utilisateur.id, req.body);

  if (resultat.probleme) {
    return res.status(400).render("message", Object.assign({}, resultat.probleme, {
      liens: [{ url: "/publier-annonce", texte: "Retour au formulaire" }],
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

app.get("/annonces/:id/modifier", exigerConnexion, interdireALEquipe, (req, res) => {
  const annonce = chargerMonAnnonce(req, res);

  if (!annonce) {
    return res.status(404).render("message", {
      titre: "Demande introuvable",
      texte: "Cette demande n'existe pas, ou elle n'est pas la vôtre.",
      liens: [{ url: "/mes-demandes", texte: "Retour à mes demandes" }],
    });
  }

  res.render("modifier-annonce", {
    titre: "Modifier ma demande",
    annonce,
    candidatures: requetes.nombreCandidatures.get(annonce.id).n,
  });
});

app.post("/annonces/:id/modifier", exigerConnexion, interdireALEquipe, lireFormulaire, (req, res) => {
  const annonce = chargerMonAnnonce(req, res);

  if (!annonce) {
    return res.status(404).render("message", {
      titre: "Demande introuvable",
      texte: "Cette demande n'existe pas, ou elle n'est pas la vôtre.",
      liens: [{ url: "/mes-demandes", texte: "Retour à mes demandes" }],
    });
  }

  // Les memes regles qu'a la publication, appelees au meme endroit :
  // ce que l'un refuse, l'autre le refuse aussi.
  const probleme = verifierAnnonce(req.body);
  if (probleme) {
    return res.status(400).render("message", Object.assign({}, probleme, {
      liens: [{ url: `/annonces/${annonce.id}/modifier`, texte: "Retour au formulaire" }],
    }));
  }

  requetes.majAnnonce.run(Object.assign({ id: annonce.id }, champsAnnonce(req.body)));

  // Le prix a peut-etre change : la somme bloquee doit suivre, sinon les
  // deux chiffres se contredisent d'un ecran a l'autre.
  requetes.ajusterVersement.run({
    annonce: annonce.id,
    montant: Math.round(Number(req.body.prix) || 0),
  });

  res.render("message", {
    titre: "Demande mise à jour",
    texte: "Les personnes qui consultent vos demandes voient la nouvelle version.",
    liens: [{ url: "/mes-demandes", texte: "Retour à mes demandes" }],
  });
});

// --- Mettre une demande en avant : l'ecran de confirmation ---------
//
// CE QUE LA MISE EN AVANT N'EST PAS. Elle ne fait pas passer devant les
// demandes d'un autre metier : une aide-menagere voit d'abord les
// demandes de menage, et c'est parmi celles-la que la mise en avant
// joue. On ne paie pas pour tromper quelqu'un sur ce qu'il cherche.
//
// C'est la meme regle que du cote des personnes qui proposent leurs
// services : aucune ne peut payer pour apparaitre en tete d'une
// recherche.
function ecranMiseEnAvant(req, res, erreur) {
  const annonce = chargerMonAnnonce(req, res);

  if (!annonce) {
    return res.status(404).render("message", {
      titre: "Demande introuvable",
      texte: "Cette demande n'existe pas, ou elle n'est pas la vôtre.",
      liens: [{ url: "/mes-demandes", texte: "Retour à mes demandes" }],
    });
  }

  if (annonce.annulee) {
    return res.status(409).render("message", {
      titre: "Cette demande est fermée",
      texte: "Une demande retirée ou déjà pourvue ne peut pas être mise en avant.",
      liens: [{ url: "/mes-demandes", texte: "Retour à mes demandes" }],
    });
  }

  mettreAJourLesJetons(req.utilisateur);

  const cout = parametreNombre("cout_mise_en_avant");
  const jours = parametreNombre("duree_mise_en_avant_jours");
  const solde = soldeJetonsDe(req.utilisateur.id);

  return res.render("mettre-en-avant", {
    titre: "Mettre cette demande en avant",
    annonce,
    cout,
    jours,
    solde: solde.total,
    finActuelle: annonce.enAvant ? dateLisible(annonce.mise_en_avant_jusqu_au) : null,
    erreur: erreur || null,
  });
}

app.get("/annonces/:id/mettre-en-avant", exigerConnexion, interdireALEquipe,
  (req, res) => ecranMiseEnAvant(req, res));

// --- Mettre une demande en avant : le prelevement ------------------
app.post("/annonces/:id/mettre-en-avant", exigerConnexion, interdireALEquipe,
  lireFormulaire, (req, res) => {
  const annonce = chargerMonAnnonce(req, res);

  if (!annonce) {
    return res.status(404).render("message", {
      titre: "Demande introuvable",
      texte: "Cette demande n'existe pas, ou elle n'est pas la vôtre.",
      liens: [{ url: "/mes-demandes", texte: "Retour à mes demandes" }],
    });
  }

  if (annonce.annulee) {
    return res.status(409).render("message", {
      titre: "Cette demande est fermée",
      texte: "Une demande retirée ou déjà pourvue ne peut pas être mise en avant.",
      liens: [{ url: "/mes-demandes", texte: "Retour à mes demandes" }],
    });
  }

  // DEJA EN AVANT : on refuse au lieu de prolonger. Prolonger
  // silencieusement ferait payer deux fois quelqu'un qui a clique deux
  // fois, et il n'aurait aucun moyen de s'en apercevoir.
  if (annonce.enAvant) {
    return res.status(409).render("message", {
      titre: "Cette demande est déjà en avant",
      texte: `Elle le reste jusqu'au ${dateLisible(annonce.mise_en_avant_jusqu_au)}. ` +
             `Vous pourrez la remettre en avant après cette date.`,
      liens: [{ url: "/mes-demandes", texte: "Retour à mes demandes" }],
    });
  }

  mettreAJourLesJetons(req.utilisateur);

  const cout = parametreNombre("cout_mise_en_avant");
  const jours = parametreNombre("duree_mise_en_avant_jours");

  if (!cout || !jours) {
    return res.status(503).render("message", {
      titre: "Option indisponible",
      texte: "Le prix de la mise en avant n'a pas encore été réglé par l'équipe.",
      liens: [{ url: "/mes-demandes", texte: "Retour à mes demandes" }],
    });
  }

  const solde = soldeJetonsDe(req.utilisateur.id);

  if (solde.total < cout) {
    return res.status(402).render("message", {
      titre: "Il vous manque des jetons",
      texte: `Mettre une demande en avant coûte ${jetonsEnClair(cout)}. ` +
             `Il vous reste ${jetonsEnClair(solde.total)}.`,
      liens: [{ url: "/mes-jetons", texte: "Voir mes jetons" }],
    });
  }

  // LES DEUX ECRITURES SONT INDIVISIBLES. Une demande mise en avant
  // sans jeton preleve serait gratuite ; un jeton preleve sans mise en
  // avant serait un vol.
  const poser = db.transaction(() => {
    if (!depenserJetons(req.utilisateur, cout, "mise_en_avant",
          `Mise en avant : ${annonce.titre}`, annonce.id)) {
      return false;
    }

    const fait = requetes.mettreEnAvant.run({
      id: annonce.id,
      employeur: req.utilisateur.id,
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
      return res.status(409).render("message", {
        titre: "Cette demande est fermée",
        texte: "Elle a été fermée entre-temps. Aucun jeton n'a été prélevé.",
        liens: [{ url: "/mes-demandes", texte: "Retour à mes demandes" }],
      });
    }
    throw erreur;
  }

  if (!pose) {
    return res.status(402).render("message", {
      titre: "Il vous manque des jetons",
      texte: `Mettre une demande en avant coûte ${jetonsEnClair(cout)}.`,
      liens: [{ url: "/mes-jetons", texte: "Voir mes jetons" }],
    });
  }

  const apres = requetes.monAnnonce.get(annonce.id, req.utilisateur.id);

  res.render("message", {
    titre: "Votre demande est mise en avant",
    texte: `Elle passe devant les autres demandes de ${annonce.metier} ` +
           `jusqu'au ${dateLisible(apres.mise_en_avant_jusqu_au)}, et porte le badge ` +
           `« Mise en avant ». ${jetonsEnClair(cout)} a été prélevé. ` +
           `Après cette date, elle reprend sa place sans que vous ayez rien à faire.`,
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
app.post("/annonces/:id/annuler", exigerConnexion, interdireALEquipe, lireFormulaire, (req, res) => {
  const annonce = chargerMonAnnonce(req, res);

  if (!annonce) {
    return res.status(404).render("message", {
      titre: "Demande introuvable",
      texte: "Cette demande n'existe pas, ou elle n'est pas la vôtre.",
      liens: [{ url: "/mes-demandes", texte: "Retour à mes demandes" }],
    });
  }

  // ON NE RETIRE PAS UNE DEMANDE OU QUELQU'UN A ETE CHOISI.
  //
  // Le bouton est cache dans ce cas, mais cacher un bouton n'est pas une
  // regle. Sans ce controle, un employeur pouvait fermer sa demande APRES
  // avoir embauche et recuperer sa somme : la personne avait travaille
  // pour rien. C'est exactement ce que le sequestre doit empecher.
  if (requetes.annonceEstPourvue.get(annonce.id)) {
    return res.status(409).render("message", {
      titre: "Vous avez déjà choisi quelqu'un",
      texte: "Cette demande ne peut plus être retirée : vous avez retenu une " +
             "personne pour ce service. Si le service n'a pas eu lieu, signalez " +
             "le problème à l'équipe plutôt que de retirer la demande.",
      liens: [{ url: "/mes-demandes", texte: "Retour à mes demandes" }],
    });
  }

  requetes.annulerAnnonce.run({ id: annonce.id });

  // Personne n'a ete choisi : la somme n'a plus de raison d'attendre.
  requetes.rembourserVersement.run({ annonce: annonce.id });

  res.render("message", {
    titre: "Demande retirée",
    texte: "Votre demande n'apparaît plus dans la liste et personne ne peut " +
           "plus y répondre. Les personnes qui vous avaient déjà répondu gardent " +
           "accès à votre discussion.",
    liens: [{ url: "/mes-demandes", texte: "Retour à mes demandes" }],
  });
});

app.get("/annonces", (req, res) => {
  const utilisateur = utilisateurConnecte(req);

  const toutes = requetes.toutesLesAnnonces.all();

  // Les demandes qui correspondent au metier de la personne passent
  // devant. Elles ne sont pas les seules montrees : masquer les autres
  // enfermerait quelqu'un dans un metier, alors qu'une aide-menagere
  // peut tres bien repondre a une demande de garde d'enfants.
  //
  // Ce tri n'est possible que depuis que le metier est une valeur de
  // notre liste : tant que c'etait un texte libre, "menage" et
  // "menagere" ne se rencontraient jamais.
  const monMetier = utilisateur && utilisateur.role === "prestataire"
    ? utilisateur.metier
    : null;

  res.render("annonces", {
    titre: "Demandes",
    pourMoi: monMetier ? toutes.filter((a) => a.metier === monMetier) : [],
    autres: monMetier ? toutes.filter((a) => a.metier !== monMetier) : toutes,
    monMetier,
  });
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

app.get("/candidatures/nouvelle/:annonceId", exigerConnexion, exigerVerification, (req, res) => {
  if (req.utilisateur.role !== "prestataire") {
    return res.status(403).render("message", {
      titre: "Acces refuse",
      texte: "Seules les personnes qui proposent leurs services peuvent répondre.",
      liens: [{ url: "/annonces", texte: "Retour aux demandes" }],
    });
  }

  const annonce = requetes.annonceParId.get(Number(req.params.annonceId));

  if (!annonce) {
    return res.status(404).render("message", {
      titre: "Demande introuvable",
      texte: "Cette demande n'existe plus.",
      liens: [{ url: "/annonces", texte: "Retour aux demandes" }],
    });
  }

  // La demande a ete retiree par son employeur. Elle n'apparait plus dans
  // la liste, mais quelqu'un peut avoir garde l'adresse ouverte.
  if (annonceFermee(annonce)) {
    return res.status(410).render("message", ecranDemandeFermee(annonce.id));
  }

  // CE QUE CETTE REPONSE VA COUTER, avant de s'engager. La meme regle
  // que pour la commission : on ne decouvre pas le prix apres.
  mettreAJourLesJetons(req.utilisateur);

  const cout = parametreNombre("cout_candidature");
  const solde = soldeJetonsDe(req.utilisateur.id);
  const envoyees = requetes.candidaturesRecentes.get(req.utilisateur.id).n;
  const limite = parametreNombre("candidatures_par_jour");

  res.render("repondre", {
    reputationEmployeur: reputationDe(annonce.employeur_id),
    titre: "Répondre à cette demande",
    annonce,
    cout,
    solde: solde.total,
    restantAujourdhui: limite === null ? null : Math.max(0, limite - envoyees),
    limite,
  });
});

app.post("/candidatures", exigerConnexion, exigerVerification, lireFormulaire, (req, res) => {
  if (req.utilisateur.role !== "prestataire") {
    return res.status(403).render("message", {
      titre: "Acces refuse",
      texte: "Seules les personnes qui proposent leurs services peuvent répondre à une demande.",
      liens: [{ url: "/annonces", texte: "Retour aux demandes" }],
    });
  }

  const annonce = requetes.annonceParId.get(Number(req.body.annonceId));

  if (!annonce) {
    return res.status(404).render("message", {
      titre: "Demande introuvable",
      texte: "Cette demande n'existe plus.",
      liens: [{ url: "/annonces", texte: "Retour aux demandes" }],
    });
  }

  // Une reponse precedente existe peut-etre. Trois cas, trois suites
  // differentes - et un seul d'entre eux etait traite jusqu'ici.
  //
  // Ce controle passe AVANT celui de la fermeture : accepter quelqu'un
  // ferme la demande, et la personne choisie serait sinon renvoyee vers
  // un ecran qui ne la concerne pas.
  const deja = requetes.maCandidaturePour.get(annonce.id, req.utilisateur.id);

  if (deja && deja.statut === "acceptee") {
    return res.status(409).render("message", {
      titre: "Vous avez déjà été choisie",
      texte: "L'employeur vous a retenue pour cette demande.",
      liens: [{ url: "/messages/" + deja.id, texte: "Ouvrir la discussion" }],
    });
  }

  // La demande a ete fermee. Elle n'apparait plus dans la liste, mais
  // quelqu'un peut avoir garde l'adresse ouverte.
  if (annonceFermee(annonce)) {
    return res.status(410).render("message", ecranDemandeFermee(annonce.id));
  }

  if (deja && deja.statut === "en attente") {
    return res.status(409).render("message", {
      titre: "Candidature déjà envoyée",
      texte: "Vous avez déjà répondu à cette demande. Elle attend la décision " +
             "de l'employeur.",
      liens: [{ url: "/mes-reponses", texte: "Voir mes candidatures" }],
    });
  }

  // ------------------------------------------------------------------
  // A PARTIR D'ICI, LA REPONSE VA PARTIR. Les controles precedents
  // renvoyaient quelqu'un qui n'avait rien a envoyer ; ceux-ci decident
  // si l'envoi est possible, et ils coutent un jeton.
  // ------------------------------------------------------------------

  // Les jetons offerts arrivent ou expirent ici aussi : quelqu'un peut
  // repondre sans jamais avoir ouvert sa page de jetons.
  mettreAJourLesJetons(req.utilisateur);

  // LA LIMITE DU JOUR PASSE AVANT LE SOLDE. Une personne qui a beaucoup
  // de jetons doit lire qu'elle a atteint la limite, pas qu'elle peut
  // payer - sinon la limite ressemble a un probleme d'argent.
  const limite = parametreNombre("candidatures_par_jour");
  const envoyees = requetes.candidaturesRecentes.get(req.utilisateur.id).n;

  if (limite !== null && envoyees >= limite) {
    const quand = requetes.prochaineReponsePossible.get(req.utilisateur.id);
    const heures = heuresAvant(quand && quand.quand);

    return res.status(429).render("message", {
      titre: "Vous avez atteint la limite du jour",
      texte: `Vous pouvez envoyer ${limite} réponses par tranche de 24 heures. ` +
             `Cette limite protège les employeurs : elle évite qu'une même ` +
             `personne réponde à tout sans avoir regardé.` +
             (heures ? ` Vous pourrez répondre à nouveau dans ${heures} heure${heures > 1 ? "s" : ""}.` : ""),
      liens: [{ url: "/annonces", texte: "Revenir aux demandes" }],
    });
  }

  const cout = parametreNombre("cout_candidature");
  const solde = soldeJetonsDe(req.utilisateur.id);

  if (cout !== null && solde.total < cout) {
    return res.status(402).render("message", {
      titre: "Il vous manque des jetons",
      texte: `Répondre à une demande coûte ${jetonsEnClair(cout)}. ` +
             `Il vous reste ${jetonsEnClair(solde.total)}.`,
      liens: [{ url: "/mes-jetons", texte: "Voir mes jetons" }],
    });
  }

  const detail = `Réponse à la demande : ${annonce.titre}`;

  // RENVOYER UNE REPONSE REFUSEE est un nouvel envoi : il coute autant
  // que le premier, et compte dans la limite du jour. Sans cela, un
  // refus pourrait etre suivi de renvois sans fin, gratuitement.
  if (deja && deja.statut === "refusee") {
    // La demande est encore ouverte - la condition annonceFermee est
    // passee plus haut. Refuser quelqu'un ne ferme pas la demande aux
    // autres : rien ne justifiait de la fermer a elle pour toujours.
    const renvoyer = db.transaction(() => {
      if (cout && !depenserJetons(req.utilisateur, cout, "candidature", detail, annonce.id)) {
        return false;
      }
      requetes.rouvrirCandidature.run({ id: deja.id });
      requetes.marquerEnvoyee.run(deja.id);
      return true;
    });

    if (!renvoyer()) {
      return res.status(402).render("message", {
        titre: "Il vous manque des jetons",
        texte: `Répondre à une demande coûte ${jetonsEnClair(cout)}.`,
        liens: [{ url: "/mes-jetons", texte: "Voir mes jetons" }],
      });
    }

    return res.render("message", {
      titre: "Candidature renvoyée",
      texte: "Votre réponse a été renvoyée à cet employeur. Votre discussion " +
             "précédente est conservée." +
             (cout ? ` ${jetonsEnClair(cout)} a été prélevé.` : ""),
      liens: [{ url: "/messages/" + deja.id, texte: "Ouvrir la discussion" }],
    });
  }

  // LE JETON N'EST PRELEVE QUE SI LA REPONSE PART. La creation et le
  // prelevement sont indivisibles : une reponse enregistree sans jeton
  // preleve serait gratuite, un jeton preleve sans reponse serait un vol.
  try {
    const envoyer = db.transaction(() => {
      const creee = requetes.creerCandidature.run(annonce.id, req.utilisateur.id);

      if (cout && !depenserJetons(req.utilisateur, cout, "candidature", detail, annonce.id)) {
        // La transaction sera annulee par l'exception : la candidature
        // qui vient d'etre creee disparait avec elle.
        throw new Error("SOLDE_INSUFFISANT");
      }

      return creee;
    });

    envoyer();
  } catch (erreur) {
    if (String(erreur.message) === "SOLDE_INSUFFISANT") {
      return res.status(402).render("message", {
        titre: "Il vous manque des jetons",
        texte: `Répondre à une demande coûte ${jetonsEnClair(cout)}.`,
        liens: [{ url: "/mes-jetons", texte: "Voir mes jetons" }],
      });
    }

    // La contrainte UNIQUE reste le dernier rempart : deux envois
    // simultanes passeraient tous deux le controle ci-dessus.
    if (String(erreur.message).includes("UNIQUE")) {
      return res.status(409).render("message", {
        titre: "Candidature déjà envoyée",
        texte: "Vous avez déjà répondu à cette demande.",
        liens: [{ url: "/mes-reponses", texte: "Voir mes candidatures" }],
      });
    }

    throw erreur;
  }

  const reste = soldeJetonsDe(req.utilisateur.id).total;

  res.render("message", {
    titre: "Réponse envoyée",
    texte: "Votre réponse a bien été enregistrée." +
           (cout ? ` ${jetonsEnClair(cout)} a été prélevé. Il vous reste ${jetonsEnClair(reste)}.` : ""),
    liens: [
      { url: "/annonces", texte: "Retour aux demandes" },
      { url: "/mes-jetons", texte: "Voir mes jetons" },
    ],
  });
});

// --- Accepter ou refuser une candidature ---------------------------
// --- Confirmer avant d'embaucher -----------------------------------
//
// Accepter une candidature engageait jusqu'ici d'un seul clic, sans que
// l'employeur relise ce sur quoi il s'engage. Le cahier des charges
// demande qu'il confirme le service, le lieu, l'horaire, la duree, le
// tarif final, la commission et le montant net.
//
// CET ECRAN EST CELUI DE L'EMPLOYEUR. La requete n'accepte que
// l'employeur PROPRIETAIRE de l'annonce : une candidate qui taperait
// l'adresse a la main recoit 404, meme sur sa propre candidature. Elle
// n'a rien a faire ici - la decision ne lui appartient pas.
//
// Refuser, en revanche, reste immediat : on ne s'engage a rien en
// refusant, et faire confirmer un refus ne protegerait personne.
app.get("/candidatures/:id/confirmer", exigerConnexion, (req, res) => {
  const c = requetes.candidatureAConfirmer.get(Number(req.params.id), req.utilisateur.id);

  if (!c) {
    return res.status(404).render("message", {
      titre: "Candidature introuvable",
      texte: "Cette candidature n'existe pas, ou elle ne concerne aucune de vos demandes.",
      liens: [{ url: "/mes-demandes", texte: "Retour à mes demandes" }],
    });
  }

  if (c.statut !== "en attente") {
    return res.status(409).render("message", {
      titre: "Décision déjà prise",
      texte: "Cette candidature a déjà reçu une réponse.",
      liens: [{ url: "/mes-demandes", texte: "Retour à mes demandes" }],
    });
  }

  // La meme regle qu'a l'acceptation, verifiee ici aussi : sans quoi
  // l'ecran promettrait une action que le serveur refusera ensuite.
  if (c.verificationPrestataire !== "verifie") {
    return res.status(403).render("message", {
      titre: "Vérification requise",
      texte: "L'identité de cette personne n'a pas encore été vérifiée par PamConnect. " +
             "Vous pourrez la choisir dès que son dossier sera validé.",
      liens: [{ url: "/mes-demandes", texte: "Retour à mes demandes" }],
    });
  }

  // On dit AVANT ce qui va se passer : la demande sera retiree, et les
  // autres personnes recevront un refus. Une consequence decouverte
  // apres coup est une mauvaise surprise.
  const autres = requetes.autresEnAttente.get({
    annonce: requetes.annonceDeCandidature.get(c.id).id,
    choisie: c.id,
  }).n;

  // LE MOMENT DE LA DECISION : sa note doit etre sur cet ecran, pas a
  // un clic de la.
  const saReputation = reputationDe(c.prestataireId);

  res.render("confirmer-embauche", {
    titre: "Confirmer votre choix",
    c,
    autres,
    reputation: {
      nombre: saReputation.nombre,
      moyenne: saReputation.moyenne,
      services: requetes.reputationEtExperience.get({ personne: c.prestataireId }).services,
    },
  });
});

app.post("/candidatures/statut", exigerConnexion, lireFormulaire, (req, res) => {
  const candidatureId = Number(req.body.candidatureId);
  const nouveauStatut = req.body.statut;

  if (nouveauStatut !== "acceptee" && nouveauStatut !== "refusee") {
    return res.status(400).render("message", {
      titre: "Decision inconnue",
      texte: "Une candidature ne peut qu'etre acceptee ou refusee.",
      liens: [{ url: "/mes-demandes", texte: "Retour a mes demandes" }],
    });
  }

  // Une seule requete verifie que la candidature existe, que l'annonce
  // appartient bien a la personne connectee, et ramene au passage l'etat
  // de verification du prestataire concerne.
  const candidature = requetes.candidatureDeMonAnnonce.get(candidatureId, req.utilisateur.id);

  if (!candidature) {
    return res.status(404).render("message", {
      titre: "Candidature introuvable",
      texte: "Cette candidature n'existe pas, ou elle ne concerne aucune de vos demandes.",
      liens: [{ url: "/mes-demandes", texte: "Retour a mes demandes" }],
    });
  }

  // REGLE METIER : on n'engage personne dont l'identite n'a pas ete verifiee.
  // C'est la promesse centrale de PamConnect ; elle est appliquee ICI,
  // cote serveur, et pas seulement en cachant un bouton dans la page.
  if (nouveauStatut === "acceptee" && candidature.verificationPrestataire !== "verifie") {
    return res.status(403).render("message", {
      titre: "Verification requise",
      texte: "L'identité de cette personne n'a pas encore été vérifiée par PamConnect. " +
             "Vous pourrez la choisir dès que son dossier sera validé.",
      liens: [{ url: "/mes-demandes", texte: "Retour a mes demandes" }],
    });
  }

  requetes.changerStatutCandidature.run(nouveauStatut, candidatureId);

  // Choisir quelqu'un POURVOIT la demande. Deux consequences, et elles
  // protegent les memes personnes :
  //
  //   - la demande quitte la liste publique : sans cela, d'autres
  //     continueraient de repondre a une place deja prise ;
  //   - les candidatures encore en attente sont refusees : les laisser
  //     patienter reviendrait a leur voler du temps, alors qu'elles
  //     pourraient repondre ailleurs.
  //
  // C'est ce que demande le cahier des charges : "les autres candidats
  // recoivent une notification respectueuse de refus". La plateforme
  // n'envoie pas encore de notification, mais le statut change - et
  // chacune le voit sur son profil.
  if (nouveauStatut === "acceptee") {
    const annonce = requetes.annonceDeCandidature.get(candidatureId);

    requetes.refuserLesAutres.run({ annonce: annonce.id, choisie: candidatureId });
    requetes.annulerAnnonce.run({ id: annonce.id });
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
app.get("/messages", exigerConnexion, (req, res) => {
  res.render("messages", {
    titre: "Mes messages",
    conversations: requetes.mesConversations.all({ moi: req.utilisateur.id }),
  });
});

app.get("/messages/:id", exigerConnexion, (req, res) => {
  const conversation = conversationDe(Number(req.params.id), req.utilisateur);

  if (!conversation) {
    return res.status(403).render("message", {
      titre: "Conversation introuvable",
      texte: "Cette conversation n'existe pas, ou elle ne vous concerne pas.",
      liens: [{ url: "/messages", texte: "Mes messages" }],
    });
  }

  const jeSuisEmployeur = req.utilisateur.id === conversation.employeurId;

  // Ouvrir la discussion, c'est l'avoir lue. On enregistre le moment,
  // puis on recalcule le compte du menu : sans cela, l'entete afficherait
  // encore "1" sur la page meme qui vient d'etre lue.
  if (jeSuisEmployeur) requetes.marquerVuEmployeur.run(conversation.id);
  else requetes.marquerVuPrestataire.run(conversation.id);

  res.locals.messagesNonLus = requetes.messagesNonLus.get({ moi: req.utilisateur.id }).n;
  res.locals.decisionsNonVues = requetes.decisionsNonVues.get({ moi: req.utilisateur.id }).n;
  res.locals.aVoir = res.locals.messagesNonLus + res.locals.decisionsNonVues;

  res.render("conversation", {
    monAvis: requetes.monAvisPour.get(conversation.id, req.utilisateur.id) || null,
    avisRecu: requetes.avisDeLaCandidature.all(conversation.id)
      .find(function (a) { return a.vise_id === req.utilisateur.id; }) || null,
    titre: "Discussion",
    conversation,
    messages: requetes.messagesDeConversation.all(conversation.id),
    jeSuisEmployeur,
    exempleMessage: auHasard(EXEMPLES_MESSAGE[jeSuisEmployeur ? "employeur" : "prestataire"]),
    exempleRaison: auHasard(EXEMPLES_RAISON),
  });
});

app.post("/messages/:id", exigerConnexion, lireFormulaire, (req, res) => {
  const conversation = conversationDe(Number(req.params.id), req.utilisateur);

  if (!conversation) {
    return res.status(403).render("message", {
      titre: "Conversation introuvable",
      texte: "Cette conversation n'existe pas, ou elle ne vous concerne pas.",
      liens: [{ url: "/messages", texte: "Mes messages" }],
    });
  }

  // Une discussion terminee est un document d'archive. La regle est
  // ici, pas seulement dans la vue : cacher un formulaire n'empeche
  // personne d'envoyer la requete a la main.
  if (conversation.terminee_le) {
    return res.status(409).render("message", {
      titre: "Ce service est terminé",
      texte: "Cette discussion est archivée. Vous pouvez la relire, mais " +
             "plus y écrire.",
      liens: [{ url: "/messages/" + conversation.id, texte: "Relire la discussion" }],
    });
  }

  const texte = String(req.body.texte || "").trim();

  if (!texte) {
    return res.redirect(`/messages/${conversation.id}`);
  }

  // On refuse un message demesure : la base accepterait un roman entier,
  // et la page deviendrait illisible.
  if (texte.length > 2000) {
    return res.status(400).render("message", {
      titre: "Message trop long",
      texte: "Un message ne peut pas dépasser 2000 caractères.",
      liens: [{ url: `/messages/${conversation.id}`, texte: "Retour à la discussion" }],
    });
  }

  requetes.creerMessage.run({
    candidature_id: conversation.id,
    auteur_id: req.utilisateur.id,
    texte,
    // Le calcul est fait UNE FOIS, a l'envoi, et son resultat conserve.
    risque_paiement: risquePaiementHorsPlateforme(texte) ? 1 : 0,
  });

  res.redirect(`/messages/${conversation.id}`);
});

// --- Signaler un message a l'equipe ---------------------------------
app.post("/messages/:id/signaler", exigerConnexion, lireFormulaire, (req, res) => {
  const conversation = conversationDe(Number(req.body.candidatureId), req.utilisateur);

  if (!conversation) {
    return res.status(403).render("message", {
      titre: "Action impossible",
      texte: "Cette conversation ne vous concerne pas.",
      liens: [{ url: "/messages", texte: "Mes messages" }],
    });
  }

  // La requete elle-meme refuse de signaler un message dont on est
  // l'auteur (voir "auteur_id != ?"). Une regle ecrite dans le SQL ne
  // peut pas etre oubliee par une route.
  requetes.signalerMessage.run(Number(req.params.id), req.utilisateur.id);

  res.redirect(`/messages/${conversation.id}`);
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
app.get("/personnes/:id", (req, res) => {
  const personne = requetes.fichePublique.get(Number(req.params.id));

  if (!personne) {
    return res.status(404).render("message", {
      titre: "Profil introuvable",
      texte: "Ce profil n'existe pas, ou il n'est plus disponible.",
      liens: [{ url: "/recherche", texte: "Retour à la recherche" }],
    });
  }

  // La tranche d'age n'est PAS une information publique. Elle n'apparait
  // que pour l'employeur qui a deja embauche cette personne : a ce
  // moment-la, ils se connaissent et travaillent ensemble. Avant, la
  // divulguer serait exposer une donnee personnelle sans necessite.
  const moi = res.locals.moi;
  const peutVoirAge = Boolean(moi && moi.role === "employeur" && !moi.est_admin &&
    requetes.embaucheEntre.get({ personne: personne.id, employeur: moi.id }));

  res.render("fiche", {
    titre: personne.nom,
    personne,
    peutVoirAge,

    // LA SEULE CHOSE DE CETTE PAGE QUI NE VIENNE PAS D ELLE. Tout le
    // reste - metier, tarif, disponibilites - est declare par la
    // personne. Les avis viennent de ceux qui l ont employee.
    reputation: Object.assign(reputationDe(Number(req.params.id)), {
      services: requetes.reputationEtExperience
        .get({ personne: Number(req.params.id) }).services,
    }),
    avis: requetes.avisRecus.all(Number(req.params.id)),
  });
});

// --- Recherche de prestataires -------------------------------------
app.get("/recherche", (req, res) => {
  // req.query contient deja les parametres de l'adresse :
  // /recherche?metier=menage&latitude=3.8  ->  { metier: "menage", latitude: "3.8" }
  const motCherche = String(req.query.metier || "").trim();

  // "menage", "menagere", "MENAGE" et "technicienne de surface" designent
  // des metiers de notre liste : on les ramene au nom officiel avant de
  // chercher. Sans cela, une recherche de "menage" ratait les profils
  // enregistres sous "Menage a domicile" - l'accent suffisait a les
  // rendre invisibles.
  const metierOfficiel = trouverMetier(motCherche);
  const latEmployeur = parseFloat(req.query.latitude);
  const lonEmployeur = parseFloat(req.query.longitude);

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

  if (!isNaN(latEmployeur) && !isNaN(lonEmployeur)) {
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
  // La moyenne generale est lue une fois : elle sert de point de depart
  // a ceux qui n'ont pas encore d'avis.
  // LA MOYENNE DE LA PLATEFORME NE SERT QUE QUAND ELLE VEUT DIRE
  // QUELQUE CHOSE. Avec un seul avis, elle vaut la note de cet avis-la
  // et tire tout le monde vers elle : ce n'est pas une information,
  // c'est un accident.
  const general = requetes.moyenneDeLaPlateforme.get();
  const moyenneGenerale = general.nombre >= AVIS_POUR_UNE_MOYENNE_FIABLE
    ? general.moyenne
    : NOTE_DE_DEPART;

  const lieuCherche = {
    quartier: trouverQuartier(String(req.query.quartier || "")),
    arrondissement: String(req.query.arrondissement || "").trim() || null,
  };

  const resultats = prestataires
    .map((p) => {
      const chiffres = requetes.reputationEtExperience.get({ personne: p.id });
      const score = scoreDe(p, chiffres, moyenneGenerale);
      const proximite = pointsDeProximite(p, lieuCherche, p.distance);

      return {
        ...p,
        distanceTexte: p.distance !== undefined
          ? `${p.distance.toFixed(1)} km`
          : "Distance inconnue",

        // Ce que la vue affiche : la moyenne reelle, le nombre d'avis,
        // et le badge des personnes qui commencent. Jamais le score -
        // un nombre affiche se compare, se discute, et finit par se
        // chercher.
        nbAvis: chiffres.nbAvis,
        moyenne: chiffres.nbAvis > 0
          ? Math.round((chiffres.sommeNotes / chiffres.nbAvis) * 10) / 10
          : null,
        services: chiffres.services,
        nouvelle: estNouvelle(chiffres),

        classement: score.total + proximite,
      };
    })
    .sort((a, b) => b.classement - a.classement);

  res.render("recherche", {
    titre: "Rechercher un prestataire",
    prestataires: resultats,
    metierRecherche: (req.query.metier || "").trim(),
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
app.get("/verification", exigerConnexion, interdireALEquipe, (req, res) => {

  res.render("verification", {
    titre: "Vérification d'identité",
    utilisateur: req.utilisateur,
    tailleMaxMo: TAILLE_MAX_OCTETS / 1024 / 1024,
    extensions: EXTENSIONS_AUTORISEES.join(", "),
  });
});

// --- Verification d'identite : l'envoi des documents ---------------
// Les deux cotes deposent les memes documents : la protection ne va pas
// dans un seul sens.
app.post("/verification", exigerConnexion, interdireALEquipe, (req, res) => {

  if (req.utilisateur.statut_verification === "verifie") {
    return res.status(409).render("message", {
      titre: "Deja verifie",
      texte: "Votre identité a déjà été validée, il n'y a rien à renvoyer.",
      liens: [{ url: "/mon-profil", texte: "Retour a mon profil" }],
    });
  }

  // On appelle multer nous-memes pour pouvoir afficher un message clair
  // au lieu de laisser une erreur brute remonter jusqu'a l'utilisateur.
  recevoirDocuments(req, res, (erreur) => {
    const recus = req.files || {};
    const cni = recus.cni ? recus.cni[0] : null;
    const casier = recus.casier ? recus.casier[0] : null;

    function refuser(titre, texte) {
      // Un envoi refuse ne doit laisser aucun fichier sur le disque.
      if (cni) supprimerDocument(cni.filename);
      if (casier) supprimerDocument(casier.filename);
      return res.status(400).render("message", {
        titre,
        texte,
        liens: [{ url: "/verification", texte: "Reessayer" }],
      });
    }

    if (erreur) {
      if (erreur.code === "LIMIT_FILE_SIZE") {
        return refuser("Fichier trop volumineux",
          `Chaque document doit peser moins de ${TAILLE_MAX_OCTETS / 1024 / 1024} Mo.`);
      }
      if (erreur.message === "TYPE_NON_AUTORISE") {
        return refuser("Format non accepte",
          `Formats acceptes : ${EXTENSIONS_AUTORISEES.join(", ")}.`);
      }
      return refuser("Envoi impossible", "Le fichier n'a pas pu etre recu. Reessaie.");
    }

    if (!cni || !casier) {
      return refuser("Deux documents sont necessaires",
        "Il faut envoyer la piece d'identite ET l'extrait de casier judiciaire.");
    }

    // Un envoi precedent est remplace : on efface les anciens fichiers.
    supprimerDocument(req.utilisateur.cni_fichier);
    supprimerDocument(req.utilisateur.casier_fichier);

    requetes.enregistrerDocuments.run({
      cni: cni.filename,
      casier: casier.filename,
      id: req.utilisateur.id,
    });

    res.render("message", {
      titre: "Documents envoyés",
      texte: "Votre dossier est arrivé. Notre équipe l'examine sous " +
             DELAI_VERIFICATION_HEURES + " heures. Vous n'avez rien d'autre à " +
             "faire : le résultat apparaîtra sur votre profil.",
      liens: [{ url: "/mon-profil", texte: "Retour à mon profil" }],
    });
  });
});

// LA PERSONNE QUI A TRAVAILLE DECLARE L'AVOIR FAIT.
//
// Sa declaration ne libere AUCUN argent : seule celle de l'employeur le
// fait, ou la decision de l'equipe. Sinon il suffirait de mentir pour
// toucher une somme sans avoir travaille.
//
// Ce qu'elle change : l'employeur voit qu'elle attend sa confirmation,
// et l'equipe lit un desaccord date au lieu d'une somme qui traine.
app.post("/candidatures/:id/jai-effectue", exigerConnexion, lireFormulaire, (req, res) => {
  const conversation = conversationDe(Number(req.params.id), req.utilisateur);

  if (!conversation) {
    return res.status(404).render("message", {
      titre: "Discussion introuvable",
      texte: "Cette discussion n'existe pas, ou elle ne vous concerne pas.",
      liens: [{ url: "/messages", texte: "Mes messages" }],
    });
  }

  // L'employeur a son propre bouton, qui lui verse la somme. Celui-ci
  // n'est pas le sien.
  if (req.utilisateur.id !== conversation.prestataireId) {
    return res.status(403).render("message", {
      titre: "Ce bouton n'est pas le vôtre",
      texte: "Déclarer que vous avez effectué le service appartient à la personne " +
             "qui a travaillé. De votre côté, déclarez le service effectué : " +
             "c'est ce qui la paie.",
      liens: [{ url: "/messages/" + conversation.id, texte: "Retour à la discussion" }],
    });
  }

  if (conversation.statut !== "acceptee") {
    return res.status(409).render("message", {
      titre: "Aucun service à déclarer",
      texte: "Vous ne pouvez déclarer un service que si l'employeur vous a choisie.",
      liens: [{ url: "/messages/" + conversation.id, texte: "Retour à la discussion" }],
    });
  }

  requetes.declarerParElle.run({ id: conversation.id });

  res.redirect("/messages/" + conversation.id);
});

// L'employeur declare le service effectue. C'est lui qui l'a recu :
// c'est donc lui qui le clot. La discussion n'est pas supprimee, elle
// passe dans l'historique - les deux personnes la relisent, personne n'y
// ecrit plus.
app.post("/candidatures/:id/terminer", exigerConnexion, lireFormulaire, (req, res) => {
  const conversation = conversationDe(Number(req.params.id), req.utilisateur);

  if (!conversation) {
    return res.status(404).render("message", {
      titre: "Discussion introuvable",
      texte: "Cette discussion n'existe pas, ou elle ne vous concerne pas.",
      liens: [{ url: "/messages", texte: "Mes messages" }],
    });
  }

  // La personne qui a travaille ne clot pas le service a la place de
  // celui qui l'a recu.
  if (req.utilisateur.id !== conversation.employeurId) {
    return res.status(403).render("message", {
      titre: "Vous ne pouvez pas clore ce service",
      texte: "Seule la personne qui a demandé le service peut déclarer " +
             "qu'il a été effectué.",
      liens: [{ url: "/messages/" + conversation.id, texte: "Retour à la discussion" }],
    });
  }

  if (conversation.statut !== "acceptee") {
    return res.status(409).render("message", {
      titre: "Aucun service à clore",
      texte: "Un service ne peut être déclaré effectué que si vous avez " +
             "accepté la candidature de cette personne.",
      liens: [{ url: "/messages/" + conversation.id, texte: "Retour à la discussion" }],
    });
  }

  requetes.terminerService.run({ id: conversation.id });

  // Le service est fait : la somme bloquee part chez la personne qui a
  // travaille, commission deduite. C'est le seul chemin par lequel elle
  // y arrive - aucun bouton ne verse de l'argent directement.
  const versement = requetes.versementDeLAnnonce.get(conversation.annonceId);

  if (versement && versement.etat === "bloque") {
    const detail = detaillerTarif(versement.montant);
    requetes.verserVersement.run({
      annonce: conversation.annonceId,
      beneficiaire: conversation.prestataireId,
      commission: detail.commission,
      net: detail.net,
    });
  }

  res.redirect("/messages/" + conversation.id);
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

app.get("/probleme/:id", exigerConnexion, (req, res) => {
  const conversation = conversationDe(Number(req.params.id), req.utilisateur);

  if (!conversation) {
    return res.status(404).render("message", {
      titre: "Discussion introuvable",
      texte: "Cette discussion n'existe pas, ou elle ne vous concerne pas.",
      liens: [{ url: "/messages", texte: "Mes messages" }],
    });
  }

  res.render("probleme", {
    titre: "Signaler un problème",
    conversation,
    autre: autreCoteDe(conversation, req.utilisateur),
    // Un employeur n'a pas de candidature, il a une demande. Sans cette
    // information, l'ecran parlait a tout le monde comme s'il ecrivait a
    // une personne qui cherche du travail.
    jeSuisEmployeur: req.utilisateur.id === conversation.employeurId,
    dejaSignale: Boolean(requetes.problemeOuvertPour.get({
      candidature: conversation.id, auteur: req.utilisateur.id,
    })),
  });
});

app.post("/probleme/:id", exigerConnexion, lireFormulaire, (req, res) => {
  const conversation = conversationDe(Number(req.params.id), req.utilisateur);

  if (!conversation) {
    return res.status(404).render("message", {
      titre: "Discussion introuvable",
      texte: "Cette discussion n'existe pas, ou elle ne vous concerne pas.",
      liens: [{ url: "/messages", texte: "Mes messages" }],
    });
  }

  const texte = String(req.body.texte || "").trim().slice(0, 2000);

  if (texte.length < 10) {
    return res.status(400).render("message", {
      titre: "Décrivez le problème",
      texte: "Quelques mots suffisent, mais l'équipe doit comprendre ce qui " +
             "s'est passé pour pouvoir agir.",
      liens: [{ url: "/probleme/" + conversation.id, texte: "Revenir au formulaire" }],
    });
  }

  // Un second signalement sur la meme discussion, avant que le premier
  // ait ete examine, n'apprend rien de plus a l'equipe.
  if (requetes.problemeOuvertPour.get({ candidature: conversation.id, auteur: req.utilisateur.id })) {
    return res.status(409).render("message", {
      titre: "Signalement déjà envoyé",
      texte: "Vous avez déjà signalé un problème sur cette discussion. " +
             "L'équipe ne l'a pas encore examiné.",
      liens: [{ url: "/messages/" + conversation.id, texte: "Retour à la discussion" }],
    });
  }

  requetes.signalerProbleme.run({
    candidature: conversation.id,
    auteur: req.utilisateur.id,
    vise: autreCoteDe(conversation, req.utilisateur).id,
    texte,
  });

  res.render("message", {
    titre: "Signalement envoyé",
    texte: "L'équipe PamConnect a reçu votre message et va l'examiner. " +
           "Votre discussion reste ouverte : rien n'a changé pour vous.",
    liens: [{ url: "/messages/" + conversation.id, texte: "Retour à la discussion" }],
  });
});

// --- Donner son avis : l'ecran ------------------------------------
//
// UN AVIS SUPPOSE UN SERVICE. Trois conditions, dans cet ordre :
// la discussion existe, elle me concerne, et le service est TERMINE.
// Sans la troisieme, on noterait une rencontre qui n'a pas eu lieu.
function chargerServiceANoter(req, res) {
  const conversation = conversationDe(Number(req.params.id), req.utilisateur);

  if (!conversation) {
    res.status(404).render("message", {
      titre: "Service introuvable",
      texte: "Ce service n'existe pas, ou il ne vous concerne pas.",
      liens: [{ url: "/messages", texte: "Retour aux discussions" }],
    });
    return null;
  }

  if (!conversation.terminee_le) {
    res.status(409).render("message", {
      titre: "Le service n'est pas terminé",
      texte: "On ne donne son avis qu'après un service effectué. " +
             "Vous pourrez le faire dès qu'il aura été déclaré.",
      liens: [{ url: "/messages/" + conversation.id, texte: "Ouvrir la discussion" }],
    });
    return null;
  }

  return conversation;
}

app.get("/avis/:id", exigerConnexion, interdireALEquipe, (req, res) => {
  const conversation = chargerServiceANoter(req, res);
  if (!conversation) return;

  const jeSuisEmployeur = req.utilisateur.id === conversation.employeurId;
  const deja = requetes.monAvisPour.get(conversation.id, req.utilisateur.id);

  // UN SEUL AVIS PAR SERVICE. On ne revient pas dessus : un avis qu'on
  // peut reecrire devient un moyen de pression apres coup.
  if (deja) {
    return res.status(409).render("message", {
      titre: "Vous avez déjà donné votre avis",
      texte: "Un seul avis par service. Il ne peut pas être modifié : " +
             "un avis que l'on pourrait réécrire deviendrait un moyen de pression.",
      liens: [{ url: "/messages/" + conversation.id, texte: "Ouvrir la discussion" }],
    });
  }

  res.render("avis", {
    titre: "Donner mon avis",
    conversation,
    jeSuisEmployeur,
    nomVise: jeSuisEmployeur ? conversation.nomPrestataire : conversation.nomEmployeur,
  });
});

// --- Donner son avis : l'enregistrement ---------------------------
app.post("/avis/:id", exigerConnexion, interdireALEquipe, lireFormulaire, (req, res) => {
  const conversation = chargerServiceANoter(req, res);
  if (!conversation) return;

  const jeSuisEmployeur = req.utilisateur.id === conversation.employeurId;
  const vise = jeSuisEmployeur ? conversation.prestataireId : conversation.employeurId;

  const note = Math.round(Number(req.body.note));

  if (!Number.isFinite(note) || note < 1 || note > 5) {
    return res.status(400).render("message", {
      titre: "Note manquante",
      texte: "Choisissez une note de 1 à 5 étoiles. C'est la seule chose obligatoire.",
      liens: [{ url: "/avis/" + conversation.id, texte: "Retour au formulaire" }],
    });
  }

  const commentaire = String(req.body.commentaire || "").trim().slice(0, 1000) || null;

  try {
    requetes.creerAvis.run({
      candidature: conversation.id,
      auteur: req.utilisateur.id,
      vise,
      note,
      commentaire,
      critere1: noteFacultative(req.body.critere1),
      critere2: noteFacultative(req.body.critere2),
      critere3: noteFacultative(req.body.critere3),
      critere4: noteFacultative(req.body.critere4),
    });
  } catch (erreur) {
    // La contrainte UNIQUE reste le dernier rempart : deux envois
    // simultanes passeraient tous deux le controle de l'ecran.
    if (String(erreur.message).includes("UNIQUE")) {
      return res.status(409).render("message", {
        titre: "Vous avez déjà donné votre avis",
        texte: "Un seul avis par service.",
        liens: [{ url: "/messages/" + conversation.id, texte: "Ouvrir la discussion" }],
      });
    }
    throw erreur;
  }

  res.render("message", {
    titre: "Merci pour votre avis",
    texte: "Il est visible par tout le monde, et il ne peut plus être modifié. " +
           "La personne concernée peut le signaler à l'équipe si elle le juge faux.",
    liens: [{ url: "/messages/" + conversation.id, texte: "Retour à la discussion" }],
  });
});

// --- Signaler un avis a l'equipe ----------------------------------
//
// SEULE LA PERSONNE VISEE. C'est elle que l'avis designe, et c'est elle
// qui sait s'il est faux. Personne ne signale l'avis d'un autre.
app.post("/avis/:id/signaler", exigerConnexion, interdireALEquipe, lireFormulaire, (req, res) => {
  const avis = requetes.avisParId.get(Number(req.params.id));

  if (!avis || avis.vise_id !== req.utilisateur.id) {
    return res.status(404).render("message", {
      titre: "Avis introuvable",
      texte: "Cet avis n'existe pas, ou il ne vous concerne pas.",
      liens: [{ url: "/mon-profil", texte: "Retour à mon profil" }],
    });
  }

  requetes.signalerAvis.run({ id: avis.id, vise: req.utilisateur.id });

  res.render("message", {
    titre: "Signalement envoyé",
    texte: "L'équipe PamConnect va lire cet avis. En attendant, il reste visible : " +
           "un avis n'est masqué qu'après examen.",
    liens: [{ url: "/messages/" + avis.candidature_id, texte: "Retour à la discussion" }],
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
// Le compte d'une personne qui travaille : ce qu'elle a recu, et pour
// quel service. Celui d'un employeur : ce qu'il a bloque, rembourse ou
// verse.
//
// Aucune coordonnee bancaire ni Mobile Money n'y est stockee. Un numero
// de telephone est une donnee personnelle et un moyen de contact direct,
// et la plateforme n'en demande pas. Le solde est un montant du, pas un
// portefeuille : le versement reel se ferait ailleurs.
app.get("/mon-compte", exigerConnexion, interdireALEquipe, (req, res) => {
  const jeSuisEmployeur = req.utilisateur.role === "employeur";

  res.render("compte", {
    titre: "Mon compte",
    jeSuisEmployeur,
    solde: jeSuisEmployeur ? 0 : requetes.soldeDe.get(req.utilisateur.id).solde,
    recus: jeSuisEmployeur ? [] : requetes.mesVersementsRecus.all(req.utilisateur.id),
    envoyes: jeSuisEmployeur ? requetes.mesVersementsEnvoyes.all(req.utilisateur.id) : [],
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
app.get("/mes-jetons", exigerConnexion, interdireALEquipe, (req, res) => {
  // Les jetons offerts arrivent ici, et les perimes partent ici. Ne rien
  // faire tant que personne ne regarde couterait une tache de fond, pour
  // un resultat qu'on ne verrait qu'en ouvrant cette page.
  const mouvement = mettreAJourLesJetons(req.utilisateur);

  const solde = soldeJetonsDe(req.utilisateur.id);
  const expiration = requetes.expirationJetonsOfferts.get(req.utilisateur.id);

  res.render("jetons", {
    titre: "Mes jetons",
    jeSuisEmployeur: req.utilisateur.role === "employeur",
    solde,

    // La date n'est annoncee que s'il reste vraiment des jetons offerts.
    expireLe: solde.offerts > 0 && expiration && expiration.quand
      ? dateLisible(expiration.quand)
      : null,

    packs: packsEnVente(),
    valeurJeton: valeurDuJeton(),

    // Ce que coute UNE action pour cette personne-la. La page s'en sert
    // pour dire ce que son solde permet - au lieu d'afficher un nombre
    // de jetons dont personne ne sait ce qu'il vaut.
    coutAction: coutDeLAction(req.utilisateur.role),

    mouvements: requetes.mesMouvementsJetons.all(req.utilisateur.id),
    achats: requetes.mesAchatsJetons.all(req.utilisateur.id),
    demandeEnCours: Boolean(requetes.achatJetonsEnAttentePour.get(req.utilisateur.id)),

    // Les jetons offerts sont annonces a partir du SOLDE, pas de ce qui
    // vient de se passer : ils sont credites par l'equipe, la personne
    // ne les voit donc pas arriver.
    //
    // La perte, elle, est bien un evenement : on la dit une fois.
    perdusMaintenant: mouvement.perdus,
  });
});

// --- Demander un pack de jetons ------------------------------------
app.post("/mes-jetons/acheter", exigerConnexion, interdireALEquipe, lireFormulaire, (req, res) => {
  // LE PRIX NE VIENT JAMAIS DU FORMULAIRE. On ne retient que la
  // quantite demandee, et on relit le prix dans les packs du serveur.
  // Sinon n'importe qui pourrait renvoyer la page en ecrivant 60 jetons
  // pour 1 FCFA.
  const quantite = Math.round(Number(req.body.quantite) || 0);
  const pack = packsEnVente().find((p) => p.quantite === quantite);

  if (!pack) {
    return res.status(400).render("message", {
      titre: "Ce pack n'existe pas",
      texte: "Ce pack n'est plus en vente. Choisissez-en un dans la liste.",
      liens: [{ url: "/mes-jetons", texte: "Retour à mes jetons" }],
    });
  }

  // UNE SEULE DEMANDE A LA FOIS. Deux demandes identiques en attente
  // sont presque toujours un double clic, et l'equipe ne saurait pas
  // laquelle confirmer.
  if (requetes.achatJetonsEnAttentePour.get(req.utilisateur.id)) {
    return res.status(409).render("message", {
      titre: "Une demande est déjà en cours",
      texte: "Votre demande précédente attend la confirmation de l'équipe. " +
             "Vous pourrez en envoyer une autre une fois celle-ci traitée.",
      liens: [{ url: "/mes-jetons", texte: "Retour à mes jetons" }],
    });
  }

  requetes.creerAchatJetons.run({
    personne: req.utilisateur.id,
    quantite: pack.quantite,
    montant: pack.prix,
  });

  res.render("message", {
    titre: "Demande enregistrée",
    texte: `Votre demande de ${pack.quantite} jetons pour ` +
           `${formaterMontant(pack.prix)} est enregistrée. Vos jetons seront ` +
           `ajoutés à votre solde dès que l'équipe aura confirmé le paiement.`,
    liens: [{ url: "/mes-jetons", texte: "Voir mes jetons" }],
  });
});

// L'EQUIPE TRANCHE UN DESACCORD SUR UNE SOMME BLOQUEE.
//
// C'est la SEULE action de toute la plateforme qui deplace de l'argent
// sans qu'un des deux interesses l'ait demande. Elle est donc encadree :
//
//   - elle n'existe qu'en cas de desaccord : quelqu'un a ete choisi, et
//     soit la personne a declare avoir travaille, soit le delai est
//     depasse. Avant cela, l'employeur n'a pas encore eu sa chance ;
//   - un motif ECRIT est obligatoire, dans les deux sens ;
//   - le nom de qui decide et son motif sont conserves : une decision
//     qui deplace l'argent de quelqu'un doit pouvoir etre expliquee des
//     mois plus tard.
app.post("/admin/versements/:annonceId", exigerAdmin, lireFormulaire, (req, res) => {
  const annonceId = Number(req.params.annonceId);
  const versement = requetes.versementDeLAnnonce.get(annonceId);

  if (!versement) {
    return res.status(404).render("message", {
      titre: "Versement introuvable",
      texte: "Aucune somme n'est enregistrée pour cette demande.",
      liens: [{ url: "/admin/versements", texte: "Retour aux versements" }],
    });
  }

  if (versement.etat !== "bloque") {
    return res.status(409).render("message", {
      titre: "Cette somme est déjà dénouée",
      texte: "Elle a déjà été versée ou rendue. On ne rejuge pas une somme " +
             "qui a bougé : la trace du premier examen disparaîtrait.",
      liens: [{ url: "/admin/versements", texte: "Retour aux versements" }],
    });
  }

  const retenue = requetes.candidatureRetenue.get(annonceId);

  if (!retenue) {
    return res.status(409).render("message", {
      titre: "Personne n'a été choisi",
      texte: "Il n'y a rien à arbitrer : tant que l'employeur n'a retenu " +
             "personne, sa demande peut vivre ou être retirée normalement.",
      liens: [{ url: "/admin/versements", texte: "Retour aux versements" }],
    });
  }

  // L'employeur doit avoir eu sa chance. Trancher avant, ce serait
  // decider a sa place alors qu'il n'a encore rien manque.
  const attente = attenteVersement(versement.cree_le);
  const desaccord = Boolean(retenue.declaree_par_elle_le) || Boolean(attente && attente.depasse);

  if (!desaccord) {
    return res.status(409).render("message", {
      titre: "Rien à arbitrer pour le moment",
      texte: "L'employeur n'a pas encore dépassé le délai, et la personne n'a " +
             "pas déclaré avoir travaillé. Laissez-leur le temps de s'accorder.",
      liens: [{ url: "/admin/versements", texte: "Retour aux versements" }],
    });
  }

  const motif = String(req.body.motif || "").trim().slice(0, 200);

  if (!motif) {
    return res.status(400).render("message", {
      titre: "Motif obligatoire",
      texte: "Vous déplacez l'argent de quelqu'un. Écrivez pourquoi : sans motif, " +
             "personne ne pourra expliquer cette décision plus tard.",
      liens: [{ url: "/admin/versements", texte: "Retour aux versements" }],
    });
  }

  if (req.body.decision === "verser") {
    const detail = detaillerTarif(versement.montant);

    requetes.verserParEquipe.run({
      annonce: annonceId,
      beneficiaire: retenue.prestataire_id,
      commission: detail.commission,
      net: detail.net,
      par: req.utilisateur.id,
      motif,
    });
  } else {
    requetes.rembourserParEquipe.run({
      annonce: annonceId,
      par: req.utilisateur.id,
      motif,
    });
  }

  // Dans les deux cas l'affaire est close : la discussion rejoint les
  // services termines. La laisser ouverte inviterait a discuter d'un
  // dossier deja tranche.
  requetes.terminerService.run({ id: retenue.id });

  res.redirect("/admin/versements");
});

// --- Espace equipe : les sommes bloquees ---------------------------
app.get("/admin/versements", exigerAdmin, (req, res) => {
  res.render("versements", {
    titre: "Versements",
    versements: requetes.tousLesVersements.all(),
  });
});

// --- Espace equipe : les jetons ------------------------------------
app.get("/admin/jetons", exigerAdmin, (req, res) => {
  res.render("admin-jetons", {
    titre: "Jetons",
    achats: requetes.achatsJetonsEnAttente.all(),
    traites: requetes.derniersAchatsJetonsTraites.all(),
    valeurJeton: valeurDuJeton(),
    packs: packsEnVente(),
    coutCandidature: parametreNombre("cout_candidature"),
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

  // CE QU'UNE ACTION COUTE. Zero serait une action gratuite, ce qui vide
  // les jetons de leur seul role : faire reflechir avant d'agir.
  const coutCandidature = Math.round(Number(req.body.cout_candidature));
  const coutMiseEnAvant = Math.round(Number(req.body.cout_mise_en_avant));

  if (!Number.isFinite(coutCandidature) || coutCandidature <= 0 ||
      !Number.isFinite(coutMiseEnAvant) || coutMiseEnAvant <= 0) {
    return res.status(400).render("message", {
      titre: "Coût invalide",
      texte: "Une action doit coûter au moins un jeton. " +
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
      cle: "cout_candidature",
      valeur: String(coutCandidature),
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
    statistiques: requetes.statistiquesVerification.all(),
    signalementsOuverts: requetes.nombreSignalementsOuverts.get().n,
    problemesOuverts: requetes.nombreProblemesOuverts.get().n,
    versementsBloques: requetes.nombreVersementsBloques.get().n,
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
      liens: [{ url: "/admin/versements", texte: "Retour aux versements" }],
    });
  }

  const texte = String(req.body.texte || "").trim().slice(0, 500);

  if (texte.length < 10) {
    return res.status(400).render("message", {
      titre: "Écrivez votre message",
      texte: "Quelques mots suffisent, mais la personne doit comprendre ce que " +
             "vous attendez d'elle.",
      liens: [{ url: "/admin/versements", texte: "Retour aux versements" }],
    });
  }

  requetes.ecrireMessageEquipe.run({ id: destinataire.id, texte });

  res.redirect("/admin/versements");
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
    req.params.type === "casier" ? dossier.casier_fichier : null;

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

  res.sendFile(path.join(DOSSIER_DOCUMENTS, nomFichier));
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
  // que le statut et sa date (minimisation des donnees personnelles).
  supprimerDocument(dossier.cni_fichier);
  supprimerDocument(dossier.casier_fichier);

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
  const moi = utilisateurConnecte(req);
  const toutes = requetes.toutesLesAnnonces.all();
  const monMetier = moi && moi.role === "prestataire" ? moi.metier : null;

  const pourLApplication = (a) => ({
    id: a.id,
    titre: a.titre,
    metier: a.metier,
    quartier: a.quartier,
    arrondissement: a.arrondissement,
    horaire: a.horaire,
    prix: a.prix,
    uniteTarif: a.unite_tarif,
    dureeEstimee: a.duree_estimee,
    // LA MEME MISE EN FORME QUE LES PAGES. prixEnClair est la
    // fonction dont les vues se servent deja : l'application n'a pas a
    // savoir comment on ecrit des francs CFA, et il n'existe qu'une
    // seule facon de le faire.
    prixLisible: prixEnClair(a),
    misEnAvant: Boolean(a.mise_en_avant_jusqu_au &&
                        a.mise_en_avant_jusqu_au > new Date().toISOString().slice(0, 10)),
  });

  res.json({
    pourMoi: monMetier ? toutes.filter((a) => a.metier === monMetier).map(pourLApplication) : [],
    autres: (monMetier ? toutes.filter((a) => a.metier !== monMetier) : toutes).map(pourLApplication),
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
app.get("/api/formulaire-demande", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusDePublierApi(res, moi)) return;

  res.json({
    metiers: metiers.map((m) => m.nom),
    quartiers: quartiers.map((q) => q.nom),
    arrondissements: app.locals.arrondissements,
    unitesTarif: Object.keys(UNITES_TARIF).map((valeur) => ({ valeur, libelle: UNITES_TARIF[valeur] })),
    uniteParDefaut: "forfaitaire",
  });
});

// L'arrondissement d'un quartier, tel que le serveur l'enregistrera.
// Le site fait ce calcul dans le navigateur pour l'afficher avant
// l'envoi ; l'application le demande ici plutot que de recopier la
// regle, synonymes compris.
app.get("/api/quartier", (req, res) => {
  if (!utilisateurConnecte(req)) return erreurApi(res, 401, "Personne n'est connecté.");

  const connu = trouverQuartier(String(req.query.nom || ""));
  res.json(connu
    ? { connu: true, quartier: connu.nom, arrondissement: connu.arrondissement }
    : { connu: false });
});

const CHAMPS_DEMANDE = ["titre", "metier", "horaire", "quartier", "arrondissement",
                        "prix", "unite_tarif", "duree_estimee", "conditions"];

app.post("/api/demandes", (req, res) => {
  const moi = utilisateurConnecte(req);
  if (refusDePublierApi(res, moi)) return;

  // Un formulaire du site n'envoie que du texte. En JSON, un objet peut
  // se glisser a la place d'un texte : on le refuse plutot que
  // d'enregistrer "[object Object]" comme titre.
  const corps = req.body;
  const formeValide = Boolean(corps) && typeof corps === "object" && !Array.isArray(corps) &&
    CHAMPS_DEMANDE.every((champ) => corps[champ] == null ||
      typeof corps[champ] === "string" ||
      (champ === "prix" && typeof corps[champ] === "number"));
  if (!formeValide) {
    return erreurApi(res, 400, "Le formulaire envoyé n'a pas la forme attendue.");
  }

  const resultat = publierDemande(moi.id, corps);
  if (resultat.probleme) return erreurApi(res, 400, resultat.probleme.texte);

  res.status(201).json({ id: resultat.id, titre: resultat.titre, texte: resultat.texte });
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
  const adresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((carte) => carte.family === "IPv4" && !carte.internal)
    // 169.254.x.x : Windows attribue cette plage a une carte reseau qui
    // n'a trouve aucun reseau. L'afficher n'induirait qu'en erreur.
    .filter((carte) => !carte.address.startsWith("169.254."))
    .map((carte) => carte.address);

  if (adresses.length) {
    console.log("Depuis un téléphone sur le même réseau :");
    adresses.forEach((ip) => console.log(`   http://${ip}:${PORT}`));
  }
});
