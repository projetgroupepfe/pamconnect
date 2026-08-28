// ============================================================
// Transfert des donnees des fichiers JSON vers la base SQLite.
//
// A lancer UNE SEULE FOIS, avec :   node scripts/migrer-json-vers-sqlite.js
//
// Le script ne touche pas aux fichiers JSON : ils restent intacts,
// comme filet de securite. Il peut etre relance sans risque : il
// recree la base a partir de zero a chaque execution.
// ============================================================

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DOSSIER_DATA = path.join(__dirname, "..", "data");
const FICHIER_BASE = path.join(DOSSIER_DATA, "pamconnect.db");
const FICHIER_SCHEMA = path.join(DOSSIER_DATA, "schema.sql");

function lireJson(nom) {
  const chemin = path.join(DOSSIER_DATA, nom);
  if (!fs.existsSync(chemin)) return [];
  return JSON.parse(fs.readFileSync(chemin, "utf-8"));
}

console.log("=== Migration des donnees JSON vers SQLite ===\n");

// --- 1. On repart d'une base vierge -------------------------------
if (fs.existsSync(FICHIER_BASE)) {
  fs.unlinkSync(FICHIER_BASE);
  console.log("Ancienne base supprimee (le script peut etre relance sans risque).");
}

const db = new Database(FICHIER_BASE);
db.pragma("foreign_keys = ON");
db.exec(fs.readFileSync(FICHIER_SCHEMA, "utf-8"));
console.log("Base creee a partir de data/schema.sql\n");

// --- 2. Les utilisateurs ------------------------------------------
const utilisateurs = lireJson("utilisateurs.json");

const insererUtilisateur = db.prepare(`
  INSERT INTO utilisateurs
    (role, nom, email, motdepasse, arrondissement, quartier, metier, tarif, latitude, longitude)
  VALUES
    (@role, @nom, @email, @motdepasse, @arrondissement, @quartier, @metier, @tarif, @latitude, @longitude)
`);

// Correspondance ancien email -> nouvel identifiant numerique.
const idParEmail = new Map();
let ignoresUtilisateurs = 0;

for (const u of utilisateurs) {
  const email = String(u.email || "").trim().toLowerCase();

  if (!email || idParEmail.has(email)) {
    ignoresUtilisateurs++;
    continue;
  }

  const resultat = insererUtilisateur.run({
    role: u.role,
    nom: u.nom || "(sans nom)",
    email,
    motdepasse: u.motdepasse,
    arrondissement: u.arrondissement || null,
    quartier: u.quartier || null,
    metier: u.metier || null,
    tarif: u.tarif ? Number(u.tarif) : null,
    latitude: u.latitude ? Number(u.latitude) : null,
    longitude: u.longitude ? Number(u.longitude) : null,
  });

  idParEmail.set(email, resultat.lastInsertRowid);
}

console.log(`utilisateurs : ${idParEmail.size} transferes` +
            (ignoresUtilisateurs ? `, ${ignoresUtilisateurs} ignores (doublon ou email vide)` : ""));

// --- 3. Les annonces ----------------------------------------------
const annonces = lireJson("annonces.json");

const insererAnnonce = db.prepare(`
  INSERT INTO annonces (employeur_id, titre, description, metier, arrondissement)
  VALUES (@employeur_id, @titre, @description, @metier, @arrondissement)
`);

// Correspondance ancien id (Date.now) -> nouvel identifiant numerique.
const idParAncienneAnnonce = new Map();
let ignoresAnnonces = 0;

for (const a of annonces) {
  const employeurId = idParEmail.get(String(a.employeurEmail || "").trim().toLowerCase());

  if (!employeurId) {
    ignoresAnnonces++;
    console.log(`  ! annonce "${a.titre}" ignoree : employeur ${a.employeurEmail} introuvable`);
    continue;
  }

  const resultat = insererAnnonce.run({
    employeur_id: employeurId,
    titre: a.titre || "(sans titre)",
    description: a.description || null,
    metier: a.metier || "(non precise)",
    arrondissement: a.arrondissement || null,
  });

  idParAncienneAnnonce.set(String(a.id), resultat.lastInsertRowid);
}

console.log(`annonces     : ${idParAncienneAnnonce.size} transferees` +
            (ignoresAnnonces ? `, ${ignoresAnnonces} ignorees` : ""));

// --- 4. Les candidatures ------------------------------------------
const candidatures = lireJson("candidatures.json");

const insererCandidature = db.prepare(`
  INSERT INTO candidatures (annonce_id, prestataire_id, statut)
  VALUES (@annonce_id, @prestataire_id, @statut)
`);

let transfereesCandidatures = 0;
let doublonsCandidatures = 0;
let ignoreesCandidatures = 0;

for (const c of candidatures) {
  const annonceId = idParAncienneAnnonce.get(String(c.annonceId));
  const prestataireId = idParEmail.get(String(c.prestataireEmail || "").trim().toLowerCase());

  if (!annonceId || !prestataireId) {
    ignoreesCandidatures++;
    continue;
  }

  try {
    insererCandidature.run({
      annonce_id: annonceId,
      prestataire_id: prestataireId,
      statut: c.statut || "en attente",
    });
    transfereesCandidatures++;
  } catch (erreur) {
    // La regle UNIQUE (annonce_id, prestataire_id) refuse les doublons.
    if (String(erreur.message).includes("UNIQUE")) {
      doublonsCandidatures++;
      console.log(`  ! doublon refuse par la base : ${c.prestataireEmail} avait postule 2 fois a la meme annonce`);
    } else {
      throw erreur;
    }
  }
}

console.log(`candidatures : ${transfereesCandidatures} transferees` +
            (doublonsCandidatures ? `, ${doublonsCandidatures} doublons refuses` : "") +
            (ignoreesCandidatures ? `, ${ignoreesCandidatures} ignorees` : ""));

// --- 5. Verification finale ---------------------------------------
console.log("\n=== Contenu de la base ===");
for (const table of ["utilisateurs", "annonces", "candidatures"]) {
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
  console.log(`  ${table.padEnd(14)} ${n} ligne(s)`);
}

console.log("\n=== Exemple de requete avec jointure ===");
const exemple = db.prepare(`
  SELECT  u.nom          AS prestataire,
          a.titre        AS annonce,
          c.statut       AS statut
  FROM candidatures c
  JOIN utilisateurs u ON u.id = c.prestataire_id
  JOIN annonces     a ON a.id = c.annonce_id
  ORDER BY u.nom
`).all();

if (exemple.length === 0) {
  console.log("  (aucune candidature)");
} else {
  exemple.forEach((l) => console.log(`  ${l.prestataire} -> "${l.annonce}" (${l.statut})`));
}

db.close();
console.log(`\nBase ecrite dans : ${FICHIER_BASE}`);
