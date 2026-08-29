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
    INSERT INTO annonces (employeur_id, titre, description, metier, arrondissement)
    VALUES (@employeur_id, @titre, @description, @metier, @arrondissement)
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
    SELECT c.id, c.statut, a.titre AS titreAnnonce
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

// Decide comment afficher un tarif. Un prestataire peut laisser le champ vide :
// on affiche alors "A negocier" plutot qu'un vide peu clair.
// C'est LE SEUL endroit a modifier si l'equipe change d'avis sur ce texte.
function formaterTarif(tarif) {
  const valeur = String(tarif === null || tarif === undefined ? "" : tarif).trim();
  if (valeur === "") return "À négocier";
  return valeur + " FCFA";
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

// app.locals : disponible dans TOUTES les vues .ejs sans le repasser.
app.locals.formaterTarif = formaterTarif;
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

  // Un prestataire sans metier n'apparaitrait jamais dans une recherche.
  // On refuse donc, meme si la requete ne vient pas de notre formulaire.
  // Le tarif, lui, reste facultatif : il devient "A negocier".
  if (donnees.role === "prestataire" && !String(donnees.metier || "").trim()) {
    return res.status(400).render("message", {
      titre: "Métier obligatoire",
      texte: "Un prestataire doit indiquer son métier pour être visible dans les recherches.",
      liens: [{ url: "/inscription.html", texte: "Retour au formulaire" }],
    });
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
    texte: `Ton inscription en tant que ${donnees.role} a bien été enregistrée.`,
    liens: [{ url: "/index.html", texte: "Retour à l'accueil" }],
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

    return res.render("message", {
      titre: `Bienvenue ${utilisateur.nom} !`,
      texte: `Connexion réussie en tant que ${utilisateur.role}.`,
      liens: [{ url: "/mon-profil", texte: "Voir mon profil" }],
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

// --- Publier une annonce (le formulaire) ---------------------------
app.get("/publier-annonce", exigerConnexion, (req, res) => {
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
app.post("/annonces", exigerConnexion, lireFormulaire, (req, res) => {
  const donnees = req.body;

  requetes.creerAnnonce.run({
    employeur_id: req.utilisateur.id,
    titre: donnees.titre,
    description: donnees.description || null,
    metier: donnees.metier,
    arrondissement: donnees.arrondissement || null,
  });

  res.render("message", {
    titre: "Annonce publiee !",
    texte: `Ton annonce "${donnees.titre}" a bien ete enregistree.`,
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
    texte: "Ta candidature a bien ete enregistree.",
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
      texte: "Ton identite a deja ete validee, il n'y a rien a renvoyer.",
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
      texte: "Ton dossier est en cours de verification par notre equipe. " +
             "Tu seras visible comme verifie des qu'il sera valide.",
      liens: [{ url: "/mon-profil", texte: "Retour a mon profil" }],
    });
  });
});

// --- Administration : les dossiers a verifier ----------------------
app.get("/admin", exigerAdmin, (req, res) => {
  res.render("admin", {
    titre: "Administration",
    dossiers: requetes.dossiersEnAttente.all(),
    statistiques: requetes.statistiquesVerification.all(),
  });
});

// --- Administration : consulter un document ------------------------
// C'est la SEULE facon d'atteindre un fichier de data/documents/.
// L'adresse ne contient jamais le nom du fichier, seulement
// l'identifiant du prestataire et le type de piece demande.
app.get("/admin/document/:id/:type", exigerAdmin, (req, res) => {
  const dossier = requetes.dossierEnAttenteParId.get(Number(req.params.id));

  if (!dossier) {
    return res.status(404).render("message", {
      titre: "Dossier introuvable",
      texte: "Ce dossier n'existe pas ou a deja ete traite.",
      liens: [{ url: "/admin", texte: "Retour a l'administration" }],
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
      liens: [{ url: "/admin", texte: "Retour a l'administration" }],
    });
  }

  res.sendFile(path.join(DOSSIER_DOCUMENTS, nomFichier));
});

// --- Administration : valider ou refuser ---------------------------
app.post("/admin/verification", exigerAdmin, lireFormulaire, (req, res) => {
  const dossier = requetes.dossierEnAttenteParId.get(Number(req.body.utilisateurId));

  if (!dossier) {
    return res.status(404).render("message", {
      titre: "Dossier introuvable",
      texte: "Ce dossier n'existe pas ou a deja ete traite.",
      liens: [{ url: "/admin", texte: "Retour a l'administration" }],
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
