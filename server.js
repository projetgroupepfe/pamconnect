const express = require("express");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const multer = require("multer");
const fs = require("fs");

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
      (role, nom, email, motdepasse, arrondissement, quartier, metier, tarif, latitude, longitude)
    VALUES
      (@role, @nom, @email, @motdepasse, @arrondissement, @quartier, @metier, @tarif, @latitude, @longitude)
  `),

  tousLesPrestataires: db.prepare(`
    SELECT * FROM utilisateurs WHERE role = 'prestataire'
  `),

  prestatairesParMetier: db.prepare(`
    SELECT * FROM utilisateurs
    WHERE role = 'prestataire' AND LOWER(metier) LIKE ?
  `),

  toutesLesAnnonces: db.prepare(`
    SELECT * FROM annonces ORDER BY cree_le DESC, id DESC
  `),

  annonceParId: db.prepare(`
    SELECT * FROM annonces WHERE id = ?
  `),

  annoncesDeEmployeur: db.prepare(`
    SELECT * FROM annonces WHERE employeur_id = ? ORDER BY cree_le DESC, id DESC
  `),

  creerAnnonce: db.prepare(`
    INSERT INTO annonces (employeur_id, titre, metier, arrondissement, quartier, horaire)
    VALUES (@employeur_id, @titre, @metier, @arrondissement, @quartier, @horaire)
  `),

  // JOIN : on recupere la candidature ET le nom du prestataire
  // en une seule requete, au lieu de chercher ensuite dans une liste.
  candidaturesDeAnnonce: db.prepare(`
    SELECT c.id,
           c.statut,
           u.nom                 AS nomPrestataire,
           u.statut_verification AS verificationPrestataire
    FROM candidatures c
    JOIN utilisateurs u ON u.id = c.prestataire_id
    WHERE c.annonce_id = ?
    ORDER BY c.id
  `),

  candidaturesDePrestataire: db.prepare(`
    SELECT c.id, c.statut, a.titre AS titreAnnonce, a.horaire AS horaireAnnonce
    FROM candidatures c
    JOIN annonces a ON a.id = c.annonce_id
    WHERE c.prestataire_id = ?
    ORDER BY c.id DESC
  `),

  creerCandidature: db.prepare(`
    INSERT INTO candidatures (annonce_id, prestataire_id) VALUES (?, ?)
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

  changerStatutCandidature: db.prepare(`
    UPDATE candidatures SET statut = ? WHERE id = ?
  `),

  majProfil: db.prepare(`
    UPDATE utilisateurs
    SET nom = @nom,
        arrondissement = @arrondissement,
        quartier = @quartier,
        metier = @metier,
        tarif = @tarif
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
        verifie_le = NULL,
        motif_refus = NULL
    WHERE id = @id
  `),

  dossiersEnAttente: db.prepare(`
    SELECT id, nom, email, metier, arrondissement, quartier
    FROM utilisateurs
    WHERE statut_verification = 'en attente'
    ORDER BY id
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

  return null;
}

// Traduit le statut technique en texte lisible par un humain.
function libelleVerification(statut) {
  if (statut === "verifie") return "Identité vérifiée";
  if (statut === "en attente") return "Vérification en cours";
  if (statut === "refuse") return "Vérification refusée";
  return "Identité non vérifiée";
}

// Meme principe pour le statut d'une candidature : la base stocke une
// valeur technique sans accent (comparaisons simples, contrainte CHECK),
// et c'est l'affichage qui la traduit en francais correct.
function libelleCandidature(statut) {
  if (statut === "acceptee") return "Acceptée";
  if (statut === "refusee") return "Refusée";
  return "En attente";
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
      texte: "Retrouvez vos annonces et les réponses que vous avez reçues.",
      lien: { url: "/mon-profil", texte: "Voir mon profil" },
    };
  }

  return {
    texte: "Retrouvez les annonces qui correspondent à ce que vous faites.",
    lien: { url: "/annonces", texte: "Voir les annonces" },
  };
}

// app.locals : disponible dans TOUTES les vues .ejs sans le repasser.
app.locals.formaterTarif = formaterTarif;
app.locals.formaterMontant = formaterMontant;
app.locals.detaillerTarif = detaillerTarif;
app.locals.pourcentageCommission = Math.round(TAUX_COMMISSION * 100);
app.locals.libelleVerification = libelleVerification;
app.locals.libelleCandidature = libelleCandidature;

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
function utilisateurConnecte(req) {
  const enteteCookie = req.headers.cookie || "";
  const paire = enteteCookie.split("; ").find((c) => c.startsWith("session="));
  if (!paire) return null;

  const identifiant = sessions[paire.split("=")[1]];
  if (!identifiant) return null;

  return requetes.utilisateurParId.get(identifiant) || null;
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
    return res.redirect("/connexion.html");
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
    return res.redirect("/connexion.html");
  }

  if (!utilisateur.est_admin) {
    return res.status(403).render("message", {
      titre: "Acces refuse",
      texte: "Cette page est reservee a l'equipe de PamConnect.",
      liens: [{ url: "/index.html", texte: "Retour a l'accueil" }],
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
             "Il ne publie pas d'annonce et n'embauche personne.",
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
  res.locals.moi = utilisateurConnecte(req);
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
        { url: "/connexion.html", texte: "Se connecter" },
        { url: "/inscription.html", texte: "Reessayer" },
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

  requetes.creerUtilisateur.run({
    role: donnees.role,
    nom: donnees.nom,
    email,
    motdepasse: hacherMotDePasse(donnees.motdepasse),
    arrondissement: donnees.arrondissement || null,
    quartier: donnees.quartier || null,
    metier: donnees.metier || null,
    tarif: donnees.tarif ? Number(donnees.tarif) : null,
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
    liens: [{ url: "/connexion.html", texte: "Réessayer" }],
  });
});

// --- Mon profil ----------------------------------------------------
app.get("/mon-profil", exigerConnexion, (req, res) => {
  const utilisateur = req.utilisateur;

  // La route PREPARE les donnees, la vue se contente de les AFFICHER.
  let mesAnnonces = [];
  let mesCandidatures = [];

  if (utilisateur.role === "employeur") {
    mesAnnonces = requetes.annoncesDeEmployeur.all(utilisateur.id).map((annonce) => ({
      ...annonce,
      candidatures: requetes.candidaturesDeAnnonce.all(annonce.id),
    }));
  }

  if (utilisateur.role === "prestataire") {
    mesCandidatures = requetes.candidaturesDePrestataire.all(utilisateur.id);
  }

  res.render("profil", {
    titre: "Mon profil",
    utilisateur,
    mesAnnonces,
    mesCandidatures,
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

  requetes.majProfil.run({
    id: moi.id,
    nom: String(donnees.nom).trim(),
    // Un compte d'equipe ne rend visite a personne : son arrondissement
    // et son quartier ne servent a rien, on ne les lui demande pas et on
    // ne les conserve pas. Une donnee inutile est une donnee de trop.
    arrondissement: moi.est_admin ? null : (donnees.arrondissement || null),
    quartier: moi.est_admin ? null : (String(donnees.quartier || "").trim() || null),
    // Un employeur n'a ni metier ni tarif : on ne les invente pas.
    metier: moi.role === "prestataire" ? String(donnees.metier).trim() : null,
    tarif: moi.role === "prestataire" ? Math.round(Number(donnees.tarif)) : null,
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
app.get("/publier-annonce", exigerConnexion, interdireALEquipe, (req, res) => {
  if (req.utilisateur.role !== "employeur") {
    return res.status(403).render("message", {
      titre: "Acces refuse",
      texte: "Seuls les employeurs peuvent publier une annonce.",
      liens: [{ url: "/index.html", texte: "Retour a l'accueil" }],
    });
  }

  res.render("publier-annonce", { titre: "Publier une annonce" });
});

// --- Enregistrer une annonce ---------------------------------------
app.post("/annonces", exigerConnexion, interdireALEquipe, lireFormulaire, (req, res) => {
  const donnees = req.body;

  // L'horaire est le critere sur lequel une personne decide de
  // repondre ou non a l'annonce : il est donc obligatoire.
  if (!String(donnees.horaire || "").trim()) {
    return res.status(400).render("message", {
      titre: "Horaire obligatoire",
      texte: "Indiquez quand vous avez besoin de quelqu'un. " +
             "C'est la première chose que les candidates regardent.",
      liens: [{ url: "/publier-annonce", texte: "Retour au formulaire" }],
    });
  }

  // Le quartier aussi : beaucoup de gens connaissent "Bastos" sans
  // savoir que c'est Yaounde 2. Sans ce repere, une candidate ne peut
  // pas juger si le lieu est accessible pour elle.
  if (!String(donnees.quartier || "").trim()) {
    return res.status(400).render("message", {
      titre: "Quartier obligatoire",
      texte: "Indiquez votre quartier. C'est ce qui permet aux candidates " +
             "de savoir si elles peuvent s'y rendre.",
      liens: [{ url: "/publier-annonce", texte: "Retour au formulaire" }],
    });
  }

  requetes.creerAnnonce.run({
    employeur_id: req.utilisateur.id,
    titre: donnees.titre,
    metier: donnees.metier,
    arrondissement: donnees.arrondissement || null,
    quartier: String(donnees.quartier).trim(),
    horaire: String(donnees.horaire).trim(),
  });

  res.render("message", {
    titre: "Annonce publiee !",
    texte: `Votre annonce "${donnees.titre}" a bien été enregistrée.`,
    liens: [{ url: "/index.html", texte: "Retour a l'accueil" }],
  });
});

// --- Liste des annonces --------------------------------------------
app.get("/annonces", (req, res) => {
  const utilisateur = utilisateurConnecte(req);

  res.render("annonces", {
    titre: "Annonces",
    annonces: requetes.toutesLesAnnonces.all(),
    role: utilisateur ? utilisateur.role : null,
  });
});

// --- Postuler a une annonce ----------------------------------------
app.post("/candidatures", exigerConnexion, lireFormulaire, (req, res) => {
  if (req.utilisateur.role !== "prestataire") {
    return res.status(403).render("message", {
      titre: "Acces refuse",
      texte: "Seuls les prestataires peuvent postuler.",
      liens: [{ url: "/annonces", texte: "Retour aux annonces" }],
    });
  }

  const annonce = requetes.annonceParId.get(Number(req.body.annonceId));

  if (!annonce) {
    return res.status(404).render("message", {
      titre: "Annonce introuvable",
      texte: "Cette annonce n'existe plus.",
      liens: [{ url: "/annonces", texte: "Retour aux annonces" }],
    });
  }

  try {
    requetes.creerCandidature.run(annonce.id, req.utilisateur.id);
  } catch (erreur) {
    // La regle UNIQUE (annonce_id, prestataire_id) du schema empeche
    // de postuler deux fois a la meme annonce.
    if (String(erreur.message).includes("UNIQUE")) {
      return res.status(409).render("message", {
        titre: "Candidature deja envoyee",
        texte: "Tu as deja postule a cette annonce.",
        liens: [{ url: "/mon-profil", texte: "Voir mes candidatures" }],
      });
    }
    throw erreur;
  }

  res.render("message", {
    titre: "Candidature envoyee !",
    texte: "Votre candidature a bien été enregistrée.",
    liens: [{ url: "/annonces", texte: "Retour aux annonces" }],
  });
});

// --- Accepter ou refuser une candidature ---------------------------
app.post("/candidatures/statut", exigerConnexion, lireFormulaire, (req, res) => {
  const candidatureId = Number(req.body.candidatureId);
  const nouveauStatut = req.body.statut;

  if (nouveauStatut !== "acceptee" && nouveauStatut !== "refusee") {
    return res.status(400).render("message", {
      titre: "Decision inconnue",
      texte: "Une candidature ne peut qu'etre acceptee ou refusee.",
      liens: [{ url: "/mon-profil", texte: "Retour a mes annonces" }],
    });
  }

  // Une seule requete verifie que la candidature existe, que l'annonce
  // appartient bien a la personne connectee, et ramene au passage l'etat
  // de verification du prestataire concerne.
  const candidature = requetes.candidatureDeMonAnnonce.get(candidatureId, req.utilisateur.id);

  if (!candidature) {
    return res.status(404).render("message", {
      titre: "Candidature introuvable",
      texte: "Cette candidature n'existe pas, ou elle ne concerne aucune de tes annonces.",
      liens: [{ url: "/mon-profil", texte: "Retour a mes annonces" }],
    });
  }

  // REGLE METIER : on n'engage personne dont l'identite n'a pas ete verifiee.
  // C'est la promesse centrale de PamConnect ; elle est appliquee ICI,
  // cote serveur, et pas seulement en cachant un bouton dans la page.
  if (nouveauStatut === "acceptee" && candidature.verificationPrestataire !== "verifie") {
    return res.status(403).render("message", {
      titre: "Verification requise",
      texte: "L'identite de ce prestataire n'a pas encore ete verifiee par PamConnect. " +
             "Tu pourras accepter sa candidature des que son dossier sera valide.",
      liens: [{ url: "/mon-profil", texte: "Retour a mes annonces" }],
    });
  }

  requetes.changerStatutCandidature.run(nouveauStatut, candidatureId);

  res.redirect("/mon-profil");
});

// --- Recherche de prestataires -------------------------------------
app.get("/recherche", (req, res) => {
  // req.query contient deja les parametres de l'adresse :
  // /recherche?metier=menage&latitude=3.8  ->  { metier: "menage", latitude: "3.8" }
  const metierRecherche = (req.query.metier || "").trim().toLowerCase();
  const latEmployeur = parseFloat(req.query.latitude);
  const lonEmployeur = parseFloat(req.query.longitude);

  // C'est la base qui filtre par metier, pas JavaScript.
  let prestataires = metierRecherche
    ? requetes.prestatairesParMetier.all(`%${metierRecherche}%`)
    : requetes.tousLesPrestataires.all();

  if (!isNaN(latEmployeur) && !isNaN(lonEmployeur)) {
    prestataires = prestataires
      .filter((p) => p.latitude && p.longitude)
      .map((p) => ({
        ...p,
        distance: calculerDistanceKm(latEmployeur, lonEmployeur, p.latitude, p.longitude),
      }))
      .sort((a, b) => a.distance - b.distance);
  }

  // On prepare le texte de la distance ici : la vue ne fait aucun calcul.
  const resultats = prestataires.map((p) => ({
    ...p,
    distanceTexte: p.distance !== undefined ? `${p.distance.toFixed(1)} km` : "Distance inconnue",
  }));

  res.render("recherche", {
    titre: "Rechercher un prestataire",
    prestataires: resultats,
    metierRecherche: (req.query.metier || "").trim(),
  });
});

// --- Verification d'identite : le formulaire -----------------------
app.get("/verification", exigerConnexion, (req, res) => {
  if (req.utilisateur.role !== "prestataire") {
    return res.status(403).render("message", {
      titre: "Acces refuse",
      texte: "Seuls les prestataires ont besoin d'une verification d'identite.",
      liens: [{ url: "/mon-profil", texte: "Retour a mon profil" }],
    });
  }

  res.render("verification", {
    titre: "Vérification d'identité",
    utilisateur: req.utilisateur,
    tailleMaxMo: TAILLE_MAX_OCTETS / 1024 / 1024,
    extensions: EXTENSIONS_AUTORISEES.join(", "),
  });
});

// --- Verification d'identite : l'envoi des documents ---------------
app.post("/verification", exigerConnexion, (req, res) => {
  if (req.utilisateur.role !== "prestataire") {
    return res.status(403).render("message", {
      titre: "Acces refuse",
      texte: "Seuls les prestataires peuvent envoyer ces documents.",
      liens: [{ url: "/mon-profil", texte: "Retour a mon profil" }],
    });
  }

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
      titre: "Documents envoyes",
      texte: "Votre dossier est en cours de vérification par notre équipe. " +
             "Tu seras visible comme verifie des qu'il sera valide.",
      liens: [{ url: "/mon-profil", texte: "Retour a mon profil" }],
    });
  });
});

// --- Espace equipe : les dossiers a verifier -----------------------
app.get("/admin", exigerAdmin, (req, res) => {
  res.render("admin", {
    titre: "Espace équipe",
    dossiers: requetes.dossiersEnAttente.all(),
    statistiques: requetes.statistiquesVerification.all(),
  });
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
app.use((req, res) => {
  res.status(404).render("message", {
    titre: "404 - Page introuvable",
    texte: "Cette page n'existe pas.",
    liens: [{ url: "/index.html", texte: "Retour a l'accueil" }],
  });
});

app.listen(PORT, () => {
  console.log(`Serveur PamConnect démarré : http://localhost:${PORT}`);
});
