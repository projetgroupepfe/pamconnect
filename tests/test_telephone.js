// Série : le numéro de téléphone, obligatoire et réservé à l'équipe.
//
// L'équipe met un employeur et un prestataire en relation PAR TÉLÉPHONE :
// sans numéro, une inscription ne sert à rien. Et comme c'est une donnée
// personnelle, il ne doit apparaître nulle part ailleurs que sur son
// propre profil et dans l'espace de l'équipe.
const http = require("http");
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");
const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const M = "test-telephone";
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

const ligne = (email) => base.prepare("SELECT * FROM utilisateurs WHERE email = ?").get(email);

setTimeout(async () => {
  const emp = M + "-emp@example.com";
  const pre = M + "-pre@example.com";
  const sansNumero = M + "-sans@example.com";
  const malEcrit = M + "-mal@example.com";
  const commun = { role: "employeur", nom: "Emp Telephone", motdepasse: MDP, arrondissement: "Yaounde 1" };

  console.log("\n--- 1. Sans numéro, pas de compte ---");
  const vide = await q("/inscription", { method: "POST", body: f({ ...commun, email: sansNumero }) });
  dire("une inscription sans numéro est refusée", vide.code === 400, "code " + vide.code);
  // La page echappe les apostrophes : on les remet avant de comparer.
  const sansEchappement = (texte) => String(texte).split("&#39;").join("'");
  dire("la page dit pourquoi",
       sansEchappement(vide.corps).includes("c'est par là que l'équipe vous joint"));
  dire("aucun compte n'est créé", !ligne(sansNumero));

  const faux = await q("/inscription", {
    method: "POST", body: f({ ...commun, email: malEcrit, telephone: "12345" }),
  });
  dire("un numéro qui n'est pas camerounais est refusé", faux.code === 400, "code " + faux.code);
  dire("la page montre la forme attendue", faux.corps.includes("6XX XX XX XX"));
  dire("aucun compte n'est créé", !ligne(malEcrit));

  console.log("\n--- 2. Le numéro est rangé sous une seule forme ---");
  // Le même numéro, écrit comme chacun l'écrit : avec l'indicatif et des espaces.
  await q("/inscription", {
    method: "POST", body: f({ ...commun, email: emp, telephone: "+237 600 00 00 00" }),
  });
  const compteEmp = ligne(emp);
  dire("l'indicatif et les espaces sont retirés",
       Boolean(compteEmp) && compteEmp.telephone === "600000000",
       compteEmp ? String(compteEmp.telephone) : "compte absent");

  await q("/inscription", {
    method: "POST",
    body: f({ role: "prestataire", nom: "Pre Telephone", email: pre, motdepasse: MDP,
              telephone: "600000001", arrondissement: "Yaounde 1", quartier: "Bastos",
              metier: "MetierTelephone", tarif: "10000" }),
  });
  const comptePre = ligne(pre);
  dire("une personne qui propose ses services en donne un aussi",
       Boolean(comptePre) && comptePre.telephone === "600000001");

  console.log("\n--- 3. Qui le voit, et qui ne le voit pas ---");
  const cEmp = (await q("/connexion", { method: "POST", body: f({ email: emp, motdepasse: MDP }) })).cookie;
  const monProfil = await q("/mon-profil", { cookie: cEmp });
  dire("chacun voit son propre numéro, en clair", monProfil.corps.includes("600 00 00 00"));
  dire("et lit qu'il ne sort pas de l'équipe",
       monProfil.corps.includes("visible par l'équipe PamConnect seulement"));

  // La fiche publique est lue par n'importe qui : le numero n'y est pas.
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email LIKE ?")
    .run("%" + M + "%");
  const fiche = await q("/personnes/" + comptePre.id);
  dire("la fiche publique d'une personne ne montre aucun numéro",
       fiche.code === 200 && !fiche.corps.includes("600000001") && !fiche.corps.includes("600 00 00 01"),
       "code " + fiche.code);

  console.log("\n--- 4. Modifier son profil le demande aussi ---");
  const sans = await q("/mon-profil/modifier", {
    method: "POST", cookie: cEmp,
    body: f({ nom: "Emp Telephone", arrondissement: "Yaounde 1", quartier: "Bastos" }),
  });
  dire("enregistrer un profil sans numéro est refusé", sans.code === 400, "code " + sans.code);
  dire("l'ancien numéro reste en place", ligne(emp).telephone === "600000000");

  const change = await q("/mon-profil/modifier", {
    method: "POST", cookie: cEmp,
    body: f({ nom: "Emp Telephone", telephone: "6 00 00 00 02", arrondissement: "Yaounde 1", quartier: "Bastos" }),
  });
  dire("un nouveau numéro est accepté", change.code === 200, "code " + change.code);
  dire("il est rangé sans les espaces", ligne(emp).telephone === "600000002");

  const supprimes = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  ----- | nettoyage : " + supprimes + " comptes de test supprimés");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 500);
