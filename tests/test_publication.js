// Série : publier une demande sans prix, et répondre gratuitement.
//
// L'employeur n'avance plus rien : il décrit son besoin, et l'équipe
// PamConnect l'appelle avec le prix, qui vient de la personne qui fera le
// travail. Le budget, lui, est facultatif et ne sort pas de l'espace de
// l'équipe.
const http = require("http");
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");
const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const M = "test-publication";
const MDP = "motdepasse123";

function q(chemin, options) {
  const o = options || {};
  const entetes = {};
  if (o.cookie) entetes.Cookie = o.cookie;
  if (o.body) {
    entetes["Content-Type"] = "application/x-www-form-urlencoded";
    entetes["Content-Length"] = Buffer.byteLength(o.body);
  }
  return new Promise((resoudre) => {
    const requete = http.request(
      { host: "127.0.0.1", port: 3999, path: chemin, method: o.method || "GET", headers: entetes },
      (reponse) => {
        let corps = "";
        reponse.on("data", (morceau) => (corps += morceau));
        reponse.on("end", () => {
          const cookie = reponse.headers["set-cookie"];
          resoudre({ code: reponse.statusCode, corps, cookie: cookie ? cookie[0].split(";")[0] : null });
        });
      });
    requete.on("error", (erreur) => resoudre({ code: 0, corps: String(erreur) }));
    if (o.body) requete.write(o.body);
    requete.end();
  });
}

const f = (objet) => Object.keys(objet)
  .map((cle) => cle + "=" + encodeURIComponent(objet[cle]))
  .join("&");

let ok = 0, ko = 0;
const dire = (nom, condition, detail) => {
  if (condition) ok++; else ko++;
  console.log("  " + (condition ? "OK    " : "ECHEC ") + "| " + nom + (detail ? "   " + detail : ""));
};

setTimeout(async () => {
  const emp = M + "-emp@example.com";
  const pre = M + "-pre@example.com";

  await q("/inscription", { method: "POST", body: f({
    role: "employeur", nom: "Emp Publication", email: emp, motdepasse: MDP,
    telephone: "600000000", arrondissement: "Yaounde 1", quartier: "Bastos" }) });
  await q("/inscription", { method: "POST", body: f({
    role: "prestataire", nom: "Pre Publication", email: pre, motdepasse: MDP,
    telephone: "600000001", arrondissement: "Yaounde 1", quartier: "Bastos",
    metier: "MetierPublication", tarif: "10000" }) });

  // Publier et repondre exigent une identite verifiee : ce n'est pas le
  // sujet de cette serie.
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email LIKE ?")
    .run("%" + M + "%");

  const cEmp = (await q("/connexion", { method: "POST", body: f({ email: emp, motdepasse: MDP }) })).cookie;
  const cPre = (await q("/connexion", { method: "POST", body: f({ email: pre, motdepasse: MDP }) })).cookie;

  console.log("\n--- 1. Publier sans prix ---");
  const sansRien = await q("/annonces", { method: "POST", cookie: cEmp, body: f({
    titre: "Service Publication", metier: "MetierPublication", horaire: "Samedi matin",
    quartier: "Bastos", arrondissement: "Yaounde 1" }) });
  dire("une demande sans prix est publiée", sansRien.code === 200, "code " + sansRien.code);

  const demande = base.prepare(
    "SELECT * FROM annonces WHERE titre = ? ORDER BY id DESC LIMIT 1").get("Service Publication");
  dire("elle est bien enregistrée", Boolean(demande));
  dire("aucun prix n'y est inscrit", demande && demande.prix === null, String(demande && demande.prix));

  console.log("\n--- 2. Aucune somme n'est bloquée ---");
  const versement = base.prepare("SELECT * FROM versements WHERE annonce_id = ?").get(demande.id);
  dire("la publication ne bloque plus aucune somme", !versement);
  dire("la page de publication ne parle plus de somme bloquée",
       !(await q("/publier-annonce", { cookie: cEmp })).corps.includes("bloquée par PamConnect"));

  console.log("\n--- 3. Le budget est facultatif, et pour l'équipe seulement ---");
  await q("/annonces", { method: "POST", cookie: cEmp, body: f({
    titre: "Service Budget", metier: "MetierPublication", horaire: "Lundi matin",
    quartier: "Bastos", arrondissement: "Yaounde 1", budget: "7000" }) });
  const avecBudget = base.prepare(
    "SELECT * FROM annonces WHERE titre = ? ORDER BY id DESC LIMIT 1").get("Service Budget");
  dire("le budget saisi est enregistré", avecBudget && avecBudget.budget === 7000,
       String(avecBudget && avecBudget.budget));

  const listePublique = await q("/annonces", { cookie: cPre });
  dire("il n'apparaît pas aux personnes qui répondent", !listePublique.corps.includes("7 000"));

  const budgetTexte = await q("/annonces", { method: "POST", cookie: cEmp, body: f({
    titre: "Service Budget Texte", metier: "MetierPublication", horaire: "Mardi",
    quartier: "Bastos", arrondissement: "Yaounde 1", budget: "beaucoup" }) });
  dire("un budget qui n'est pas un nombre est refusé", budgetTexte.code === 400,
       "code " + budgetTexte.code);

  console.log("\n--- 4. Répondre ne coûte plus de jeton ---");

  const ecran = await q("/candidatures/nouvelle/" + demande.id, { cookie: cPre });
  dire("l'écran annonce l'appel de l'équipe",
       ecran.corps.includes("vous appellera pour convenir du prix"), "code " + ecran.code);
  dire("il ne parle plus de jeton à dépenser", !ecran.corps.includes("Ce que cette réponse vous coûte"));

  const reponse = await q("/candidatures", { method: "POST", cookie: cPre, body: f({ annonceId: demande.id }) });
  dire("la réponse part", reponse.code === 200, "code " + reponse.code);

  // Les jetons offerts arrivent a la premiere visite : ce qu'on verifie
  // ici, c'est qu'AUCUNE sortie de jetons n'a ete faite pour une reponse.
  const sorties = base.prepare(
    "SELECT COUNT(*) AS n FROM jetons_mouvements WHERE motif = 'candidature' AND utilisateur_id = "
    + "(SELECT id FROM utilisateurs WHERE email = ?)").get(pre).n;
  dire("aucun jeton n'a été prélevé pour cette réponse", sorties === 0, String(sorties));
  const supprimes = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  ----- | nettoyage : " + supprimes + " comptes de test supprimés");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 500);
