// Lance toutes les séries, l'une après l'autre, et affiche le total.
//
// À exécuter avec  npm test  depuis le dossier du projet.
//
// Chaque série démarre le serveur sur le port 3999 — jamais 3000 — pour
// ne pas gêner celui que vous avez peut-être ouvert. Elle crée ses
// propres comptes de test et les supprime à la fin.
//
// ATTENTION : les séries écrivent dans la vraie base, data/pamconnect.db.
// Elles nettoient derrière elles, mais ne les lancez pas pendant une
// démonstration.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PROJET = path.join(__dirname, "..");
const SERVEUR_TEST = path.join(PROJET, "_serveur_test_temporaire.js");

// L'ORDRE COMPTE PEU, mais il reste stable : on lit plus vite un
// résultat quand les séries défilent toujours dans le même sens.
const SERIES = [
  "test_pages", "test_etape9", "test_profil", "test_validation", "test_doublon",
  "test_verification", "test_admin", "test_embauche", "test_modification",
  "test_messagerie", "test_roles", "test_metiers", "test_profil_enrichi",
  "test_moderation", "test_fiche", "test_confirmation", "test_modifier_annonce",
  "test_annuler_age", "test_probleme", "test_notification", "test_archivage",
  "test_versements", "test_jetons", "test_bienvenue", "test_repondre_jeton", "test_mise_en_avant", "test_avis", "test_classement", "test_demonstration",
];

// Le serveur de test est une copie de server.js dont on change le port.
// On ne touche jamais à server.js lui-même : une série qui plante ne
// doit pas laisser le vrai fichier modifié.
function preparerServeurDeTest() {
  const source = fs.readFileSync(path.join(PROJET, "server.js"), "utf-8");
  const copie = source.replace("const PORT = 3000;", "const PORT = 3999;");

  if (copie === source) {
    console.error("Le port 3000 n'a pas été trouvé dans server.js.");
    process.exit(1);
  }

  fs.writeFileSync(SERVEUR_TEST, copie, "utf-8");
}

function nettoyer() {
  if (fs.existsSync(SERVEUR_TEST)) fs.unlinkSync(SERVEUR_TEST);
}

preparerServeurDeTest();

let reussis = 0;
let echecs = 0;
let plantees = 0;

for (const serie of SERIES) {
  let sortie = "";

  try {
    sortie = execFileSync(process.execPath, [path.join(__dirname, serie + ".js")],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (erreur) {
    // Une série qui échoue sort avec un code non nul : sa sortie est
    // dans l'erreur, pas dans le retour.
    sortie = String(erreur.stdout || "") + String(erreur.stderr || "");
  }

  const ok = (sortie.match(/ {2}OK {4}\|/g) || []).length;
  const ko = (sortie.match(/ECHEC/g) || []).length;
  reussis += ok;
  echecs += ko;

  // UNE SÉRIE QUI PLANTE N'AFFICHE AUCUN ÉCHEC : elle s'arrête avant.
  // Sans ce contrôle, on croirait tout vert alors que rien n'a tourné.
  const terminee = sortie.includes("RESULTAT :");

  if (!terminee) {
    plantees += 1;
    console.log("  " + serie.padEnd(24) + "A PLANTÉ");
    console.log(sortie.split("\n").slice(-8).map((l) => "      " + l).join("\n"));
  } else if (ko > 0) {
    console.log("  " + serie.padEnd(24) + ko + " échec(s)");
    sortie.split("\n").filter((l) => l.includes("ECHEC")).forEach((l) => console.log("    " + l.trim()));
  } else {
    console.log("  " + serie.padEnd(24) + ok + " tests");
  }
}

nettoyer();

console.log("");
console.log("  TOTAL : " + reussis + " tests, " + echecs + " échec(s), " + plantees + " série(s) plantée(s)");

process.exit(echecs === 0 && plantees === 0 ? 0 : 1);
