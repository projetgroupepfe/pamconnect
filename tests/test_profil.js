const http = require("http");
const fs = require("fs");
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "\\_serveur_test_temporaire.js");

// Connexion a la base, pour verifier et nettoyer les donnees de test.
const base = require("C:/Users/PC/Documents/PamConnect/node_modules/better-sqlite3")(
  PROJET + "\\data\\pamconnect.db"
);
base.pragma("foreign_keys = ON");


const MARQUE = "test-profil";
let ok = 0, ko = 0;

function requete(chemin, o) {
  o = o || {};
  const h = {};
  if (o.cookie) h["Cookie"] = o.cookie;
  if (o.body) {
    h["Content-Type"] = "application/x-www-form-urlencoded";
    h["Content-Length"] = Buffer.byteLength(o.body);
  }
  return new Promise((r) => {
    const q = http.request({ host: "127.0.0.1", port: 3999, path: chemin,
                             method: o.method || "GET", headers: h }, (res) => {
      let c = ""; res.on("data", (x) => (c += x));
      res.on("end", () => {
        const sc = res.headers["set-cookie"];
        r({ code: res.statusCode, corps: c, cookie: sc ? sc[0].split(";")[0] : null });
      });
    });
    q.on("error", (e) => r({ code: 0, corps: String(e) }));
    if (o.body) q.write(o.body);
    q.end();
  });
}
const form = (o) => Object.keys(o).map((k) => k + "=" + encodeURIComponent(o[k])).join("&");
function v(nom, cond, detail) {
  if (cond) { ok++; console.log("  OK    | " + nom); }
  else { ko++; console.log("  ECHEC | " + nom + (detail ? "  -> " + detail : "")); }
}

setTimeout(async () => {
  const mdp = "motdepasse123";
  const empMail = MARQUE + "-emp@example.com";
  const preMail = MARQUE + "-pre@example.com";

  await requete("/inscription", { method: "POST", body: form({
    role: "employeur", nom: "Mariam Test", email: empMail, motdepasse: mdp,
    arrondissement: "Yaounde 4", quartier: "Manguier" }) });
  await requete("/inscription", { method: "POST", body: form({
    role: "prestataire", nom: "Anna Test", email: preMail, motdepasse: mdp,
    arrondissement: "Yaounde 5", quartier: "Bastos", metier: "Menage", tarif: "5000" }) });

  const coEmp = await requete("/connexion", { method: "POST", body: form({ email: empMail, motdepasse: mdp }) });
  const coPre = await requete("/connexion", { method: "POST", body: form({ email: preMail, motdepasse: mdp }) });

  console.log("\n--- PROFIL EMPLOYEUR ---");
  const pe = await requete("/mon-profil", { cookie: coEmp.cookie });
  v("la page s'affiche", pe.code === 200 && pe.corps.includes("Mariam Test"), "code " + pe.code);
  v("PAS de metier chez un employeur", !pe.corps.includes("Menage"));
  v("PAS de tarif chez un employeur", !pe.corps.includes("FCFA"));
  // On verifie les DONNEES affichees, pas la formulation exacte :
  // le test reste valable si le libelle change.
  v("les informations du compte sont affichees",
    pe.corps.includes("Mariam Test") && pe.corps.includes(empMail) &&
    pe.corps.includes("Employeur") && // Le compte a ete cree avec le quartier "Manguier" : le serveur en
      // deduit Yaounde 1, meme si le formulaire annoncait Yaounde 4.
      pe.corps.includes("Yaoundé 1") && pe.corps.includes("Manguier"));
  v("section 'Mes demandes' presente", pe.corps.includes("Mes demandes"));
  v("lien 'Mon profil' dans le menu", pe.corps.includes('href="/mon-profil"'));

  console.log("\n--- PROFIL PRESTATAIRE ---");
  const pp = await requete("/mon-profil", { cookie: coPre.cookie });
  v("la page s'affiche", pp.code === 200 && pp.corps.includes("Anna Test"), "code " + pp.code);
  // Le compte a ete cree avec le metier "Menage" : le serveur le ramene
  // au nom officiel de la liste.
  v("le metier officiel est affiche", pp.corps.includes("Ménage à domicile"));
  v("le tarif est affiche avec sa monnaie", pp.corps.includes("5 000 FCFA"));
  v("section 'Mes candidatures' presente", pp.corps.includes("Mes candidatures"));

  console.log("\n--- NETTOYAGE ---");
  const supprimes = base
    .prepare("DELETE FROM utilisateurs WHERE email LIKE ?")
    .run("%" + MARQUE + "%").changes;
  console.log("  " + supprimes + " compte(s) de test supprime(s) (annonces et candidatures en cascade)");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 500);
