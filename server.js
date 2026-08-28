const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// "app" est notre application Express : c'est elle qui recoit
// toutes les requetes et decide quelle route doit y repondre.
const app = express();

// On dit a Express : les pages sont des fichiers .ejs, ranges dans views/.
// A partir de la, res.render("profil", { ... }) va chercher views/profil.ejs,
// y injecte les donnees, et envoie le HTML obtenu au navigateur.
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Outil fourni par Express : il lit le corps d'une requete de formulaire
// et range le resultat dans req.body.
const lireFormulaire = express.urlencoded({ extended: false });

const PORT = 3000;
const FICHIER_UTILISATEURS = path.join(__dirname, "data", "utilisateurs.json");
const FICHIER_ANNONCES = path.join(__dirname, "data", "annonces.json");
const FICHIER_CANDIDATURES = path.join(__dirname, "data", "candidatures.json");
const sessions = {};

function genererToken() {
  return crypto.randomBytes(32).toString("hex");
}

function lireUtilisateurs() {
  if (!fs.existsSync(FICHIER_UTILISATEURS)) {
    fs.writeFileSync(FICHIER_UTILISATEURS, "[]");
  }
  const contenu = fs.readFileSync(FICHIER_UTILISATEURS, "utf-8");
  return JSON.parse(contenu);
}

function sauvegarderUtilisateurs(utilisateurs) {
  fs.writeFileSync(FICHIER_UTILISATEURS, JSON.stringify(utilisateurs, null, 2));
}

function lireAnnonces() {
  if (!fs.existsSync(FICHIER_ANNONCES)) {
    fs.writeFileSync(FICHIER_ANNONCES, "[]");
  }
  const contenu = fs.readFileSync(FICHIER_ANNONCES, "utf-8");
  return JSON.parse(contenu);
}

function sauvegarderAnnonces(annonces) {
  fs.writeFileSync(FICHIER_ANNONCES, JSON.stringify(annonces, null, 2));
}

function lireCandidatures() {
  if (!fs.existsSync(FICHIER_CANDIDATURES)) {
    fs.writeFileSync(FICHIER_CANDIDATURES, "[]");
  }
  const contenu = fs.readFileSync(FICHIER_CANDIDATURES, "utf-8");
  return JSON.parse(contenu);
}

function sauvegarderCandidatures(candidatures) {
  fs.writeFileSync(FICHIER_CANDIDATURES, JSON.stringify(candidatures, null, 2));
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

// app.locals : tout ce qu'on met ici est utilisable dans TOUTES les vues .ejs
// sans avoir a le repasser a chaque res.render().
app.locals.formaterTarif = formaterTarif;

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

function trouverEmailConnecte(request) {
  const enteteCookie = request.headers.cookie || "";
  const paire = enteteCookie.split("; ").find((c) => c.startsWith("session="));
  if (!paire) return null;

  const token = paire.split("=")[1];
  return sessions[token] || null;
}

// ============================================================
// Le "portier" : verifie qu'une personne est bien connectee.
// Express execute cette fonction AVANT la route sur laquelle
// on la pose. Deux issues possibles, jamais les deux :
//   - personne connectee  -> on redirige et on s'arrete
//   - quelqu'un connecte  -> next() laisse passer vers la route
// ============================================================
function exigerConnexion(req, res, next) {
  const emailConnecte = trouverEmailConnecte(req);

  if (!emailConnecte) {
    return res.redirect("/connexion.html");
  }

  // On accroche l'email a la requete : les routes qui suivent
  // n'ont plus besoin de le rechercher, elles lisent req.emailConnecte.
  req.emailConnecte = emailConnecte;
  next();
}

// ============================================================
// PARTIE 1 - Les fichiers du dossier public/ (HTML, CSS, images)
// ============================================================
app.use(express.static(path.join(__dirname, "public")));

// ============================================================
// PARTIE 2 - Les routes de l'application
// ============================================================

// --- Inscription ---------------------------------------------------
app.post("/inscription", lireFormulaire, (req, res) => {
  const donnees = req.body;
  const emailNormalise = (donnees.email || "").trim().toLowerCase();

  const utilisateurs = lireUtilisateurs();
  const dejaInscrit = utilisateurs.find(
    (u) => (u.email || "").toLowerCase() === emailNormalise
  );

  if (dejaInscrit) {
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

  const nouvelUtilisateur = {
    id: Date.now(),
    role: donnees.role,
    nom: donnees.nom,
    email: emailNormalise,
    motdepasse: hacherMotDePasse(donnees.motdepasse),
    arrondissement: donnees.arrondissement,
    quartier: donnees.quartier || null,
    metier: donnees.metier || null,
    tarif: donnees.tarif || null,
    latitude: donnees.latitude || null,
    longitude: donnees.longitude || null,
  };

  utilisateurs.push(nouvelUtilisateur);
  sauvegarderUtilisateurs(utilisateurs);

  console.log("Nouvel utilisateur enregistré :", nouvelUtilisateur);

  res.render("message", {
    titre: `Merci ${donnees.nom} !`,
    texte: `Ton inscription en tant que ${donnees.role} a bien été enregistrée.`,
    liens: [{ url: "/index.html", texte: "Retour à l'accueil" }],
  });
});

// --- Connexion -----------------------------------------------------
app.post("/connexion", lireFormulaire, (req, res) => {
  const donnees = req.body;
  const utilisateurs = lireUtilisateurs();

  const emailSaisi = (donnees.email || "").trim().toLowerCase();
  const utilisateurTrouve = utilisateurs.find(
    (u) => (u.email || "").toLowerCase() === emailSaisi
  );

  if (utilisateurTrouve && verifierMotDePasse(donnees.motdepasse, utilisateurTrouve.motdepasse)) {
    const token = genererToken();
    sessions[token] = utilisateurTrouve.email;

    // res.cookie ecrit l'en-tete Set-Cookie a notre place.
    // httpOnly : le JavaScript de la page ne peut pas lire ce cookie.
    res.cookie("session", token, { httpOnly: true, path: "/" });

    return res.render("message", {
      titre: `Bienvenue ${utilisateurTrouve.nom} !`,
      texte: `Connexion réussie en tant que ${utilisateurTrouve.role}.`,
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
  const emailConnecte = req.emailConnecte;
  const utilisateurs = lireUtilisateurs();
  const utilisateur = utilisateurs.find((u) => u.email === emailConnecte);

  // La route PREPARE les donnees, la vue se contente de les AFFICHER.
  let mesAnnonces = [];
  let mesCandidatures = [];

  if (utilisateur.role === "employeur") {
    const toutesCandidatures = lireCandidatures();

    mesAnnonces = lireAnnonces()
      .filter((annonce) => annonce.employeurEmail === emailConnecte)
      .map((annonce) => ({
        ...annonce,
        candidatures: toutesCandidatures
          .filter((c) => String(c.annonceId) === String(annonce.id))
          .map((c) => {
            const prestataire = utilisateurs.find((u) => u.email === c.prestataireEmail);
            return { ...c, nomPrestataire: prestataire ? prestataire.nom : "Prestataire inconnu" };
          }),
      }));
  }

  if (utilisateur.role === "prestataire") {
    const toutesAnnonces = lireAnnonces();

    mesCandidatures = lireCandidatures()
      .filter((c) => c.prestataireEmail === emailConnecte)
      .map((c) => {
        const annonce = toutesAnnonces.find((a) => String(a.id) === String(c.annonceId));
        return { ...c, titreAnnonce: annonce ? annonce.titre : "Annonce supprimee" };
      });
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
  const utilisateurs = lireUtilisateurs();
  const utilisateur = utilisateurs.find((u) => u.email === req.emailConnecte);

  if (utilisateur.role !== "employeur") {
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

  const nouvelleAnnonce = {
    id: Date.now(),
    employeurEmail: req.emailConnecte,
    titre: donnees.titre,
    description: donnees.description,
    metier: donnees.metier,
    arrondissement: donnees.arrondissement,
  };

  const annonces = lireAnnonces();
  annonces.push(nouvelleAnnonce);
  sauvegarderAnnonces(annonces);

  res.render("message", {
    titre: "Annonce publiee !",
    texte: `Ton annonce "${donnees.titre}" a bien ete enregistree.`,
    liens: [{ url: "/index.html", texte: "Retour a l'accueil" }],
  });
});

// --- Liste des annonces --------------------------------------------
app.get("/annonces", (req, res) => {
  const emailConnecte = trouverEmailConnecte(req);
  let role = null;

  if (emailConnecte) {
    const utilisateurs = lireUtilisateurs();
    const utilisateur = utilisateurs.find((u) => u.email === emailConnecte);
    role = utilisateur ? utilisateur.role : null;
  }

  res.render("annonces", {
    titre: "Annonces",
    annonces: lireAnnonces(),
    role,
  });
});

// --- Postuler a une annonce ----------------------------------------
app.post("/candidatures", exigerConnexion, lireFormulaire, (req, res) => {
  const utilisateurs = lireUtilisateurs();
  const utilisateur = utilisateurs.find((u) => u.email === req.emailConnecte);

  if (!utilisateur || utilisateur.role !== "prestataire") {
    return res.status(403).render("message", {
      titre: "Acces refuse",
      texte: "Seuls les prestataires peuvent postuler.",
      liens: [{ url: "/annonces", texte: "Retour aux annonces" }],
    });
  }

  const donnees = req.body;

  const nouvelleCandidature = {
    id: Date.now(),
    annonceId: donnees.annonceId,
    prestataireEmail: req.emailConnecte,
    statut: "en attente",
  };

  const candidatures = lireCandidatures();
  candidatures.push(nouvelleCandidature);
  sauvegarderCandidatures(candidatures);

  res.render("message", {
    titre: "Candidature envoyee !",
    texte: "Ta candidature a bien ete enregistree.",
    liens: [{ url: "/annonces", texte: "Retour aux annonces" }],
  });
});

// --- Accepter ou refuser une candidature ---------------------------
app.post("/candidatures/statut", exigerConnexion, lireFormulaire, (req, res) => {
  const donnees = req.body;
  const candidatures = lireCandidatures();
  const candidature = candidatures.find((c) => String(c.id) === String(donnees.candidatureId));

  if (candidature) {
    const annonces = lireAnnonces();
    const annonce = annonces.find((a) => String(a.id) === String(candidature.annonceId));

    // On ne change le statut que si l'annonce appartient bien
    // a la personne connectee.
    if (annonce && annonce.employeurEmail === req.emailConnecte) {
      candidature.statut = donnees.statut;
      sauvegarderCandidatures(candidatures);
    }
  }

  res.redirect("/mon-profil");
});

// --- Recherche de prestataires -------------------------------------
app.get("/recherche", (req, res) => {
  // req.query contient deja les parametres de l'adresse :
  // /recherche?metier=menage&latitude=3.8  ->  { metier: "menage", latitude: "3.8" }
  const metierRecherche = (req.query.metier || "").toLowerCase();
  const latEmployeur = parseFloat(req.query.latitude);
  const lonEmployeur = parseFloat(req.query.longitude);

  const utilisateurs = lireUtilisateurs();
  let prestataires = utilisateurs.filter((u) => u.role === "prestataire");

  if (metierRecherche) {
    prestataires = prestataires.filter((p) =>
      (p.metier || "").toLowerCase().includes(metierRecherche)
    );
  }

  if (!isNaN(latEmployeur) && !isNaN(lonEmployeur)) {
    prestataires = prestataires
      .filter((p) => p.latitude && p.longitude)
      .map((p) => ({
        ...p,
        distance: calculerDistanceKm(latEmployeur, lonEmployeur, parseFloat(p.latitude), parseFloat(p.longitude)),
      }))
      .sort((a, b) => a.distance - b.distance);
  }

  // On prepare le texte de la distance ici : la vue ne fait plus de calcul.
  const resultats = prestataires.map((p) => ({
    ...p,
    distanceTexte: p.distance !== undefined ? `${p.distance.toFixed(1)} km` : "Distance inconnue",
  }));

  res.render("recherche", {
    titre: "Resultats",
    prestataires: resultats,
  });
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
