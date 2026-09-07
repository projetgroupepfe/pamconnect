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


const MARQUE = "test-valid";
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
const compte = (mail) =>
  base.prepare("SELECT * FROM utilisateurs WHERE email = ?").get(mail);
function v(n, c, d) { if (c) { ok++; console.log("  OK    | " + n); }
                      else { ko++; console.log("  ECHEC | " + n + (d ? "  -> " + d : "")); } }

setTimeout(async () => {
  const mdp = "motdepasse123";

  console.log("\n--- 1. Le contournement est-il bloque ? ---");
  const pirate = MARQUE + "-pirate@example.com";
  const r1 = await requete("/inscription", { method: "POST", body: form({
    role: "prestataire", nom: "Pirate", email: pirate, motdepasse: mdp,
    arrondissement: "Yaounde 1" }) });          // <-- aucun metier
  v("prestataire sans metier refuse (400)", r1.code === 400, "code " + r1.code);
  v("le message explique pourquoi", r1.corps.includes("obligatoire"));
  v("AUCUN compte n'a ete cree", !compte(pirate));

  const espaces = MARQUE + "-espaces@example.com";
  const r2 = await requete("/inscription", { method: "POST", body: form({
    role: "prestataire", nom: "Espaces", email: espaces, motdepasse: mdp,
    arrondissement: "Yaounde 1", metier: "   " }) });   // <-- que des espaces
  v("un metier fait d'espaces est refuse aussi", r2.code === 400 && !compte(espaces), "code " + r2.code);

  console.log("\n--- 2. Pas de regression pour les employeurs ---");
  const empMail = MARQUE + "-emp@example.com";
  const r3 = await requete("/inscription", { method: "POST", body: form({
    role: "employeur", nom: "Employeur Test", email: empMail, motdepasse: mdp,
    arrondissement: "Yaounde 4" }) });
  v("employeur sans metier toujours accepte", r3.code === 200 && !!compte(empMail), "code " + r3.code);

  console.log("\n--- 3. Prestataire SANS tarif -> refuse ---");
  const sansTarif = MARQUE + "-sans-tarif@example.com";
  const r4 = await requete("/inscription", { method: "POST", body: form({
    role: "prestataire", nom: "Sans Tarif", email: sansTarif, motdepasse: mdp,
    arrondissement: "Yaounde 5", metier: "MetierTest" }) });   // metier oui, tarif non
  v("prestataire sans tarif refuse (400)", r4.code === 400, "code " + r4.code);
  v("le message explique pourquoi", r4.corps.includes("Tarif obligatoire"));
  v("AUCUN compte n'a ete cree", !compte(sansTarif));

  const tarifZero = MARQUE + "-zero@example.com";
  const r5 = await requete("/inscription", { method: "POST", body: form({
    role: "prestataire", nom: "Zero", email: tarifZero, motdepasse: mdp,
    arrondissement: "Yaounde 5", metier: "MetierTest", tarif: "0" }) });
  v("un tarif a zero est refuse aussi", r5.code === 400 && !compte(tarifZero), "code " + r5.code);

  console.log("\n--- 4. Prestataire AVEC tarif : la commission est transparente ---");
  const tarifMail = MARQUE + "-tarif@example.com";
  await requete("/inscription", { method: "POST", body: form({
    role: "prestataire", nom: "Tarif Test", email: tarifMail, motdepasse: mdp,
    arrondissement: "Yaounde 5", metier: "MetierTest", tarif: "10000" }) });
  const coTarif = await requete("/connexion", { method: "POST", body: form({ email: tarifMail, motdepasse: mdp }) });
  const pTarif = await requete("/mon-profil", { cookie: coTarif.cookie });
  v("le tarif demande est affiche", pTarif.corps.includes("10 000 FCFA"));
  v("la commission de 10 % est affichee", pTarif.corps.includes("1 000 FCFA"));
  v("le montant recu est affiche", pTarif.corps.includes("9 000 FCFA"));

  const rech = await requete("/recherche?metier=metiertest");
  v("la recherche trouve ce prestataire", rech.corps.includes("Tarif Test"));
  v("l'employeur voit le montant a payer", rech.corps.includes("10 000 FCFA") && rech.corps.includes("payer"));
  v("l'employeur ne voit PAS la commission", !rech.corps.includes("Commission"));

  console.log("\n--- NETTOYAGE ---");
  const supprimes = base
    .prepare("DELETE FROM utilisateurs WHERE email LIKE ?")
    .run("%" + MARQUE + "%").changes;
  console.log("  " + supprimes + " compte(s) de test supprime(s) (annonces et candidatures en cascade)");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 500);
