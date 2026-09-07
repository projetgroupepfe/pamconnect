const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
const RACINE = "http://127.0.0.1:3999";
const M = "test-pages";
let ok = 0, ko = 0;

const dire = (n, c, d) => {
  if (c) { ok++; console.log("  OK    | " + n); }
  else { ko++; console.log("  ECHEC | " + n + (d ? "   -> " + d : "")); }
};

async function poster(chemin, corps, cookie) {
  const r = await fetch(RACINE + chemin, {
    method: "POST", body: corps,
    headers: cookie ? { Cookie: cookie } : {}, redirect: "manual",
  });
  const sc = r.headers.getSetCookie();
  return { code: r.status, corps: await r.text(), cookie: sc.length ? sc[0].split(";")[0] : null };
}
const form = (o) => new URLSearchParams(o);

async function page(chemin, cookie) {
  const r = await fetch(RACINE + chemin, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
  return { code: r.status, corps: await r.text() };
}

setTimeout(async () => {
  const mdp = "motdepasse123";
  const emp = M + "-emp@example.com";
  const pre = M + "-pre@example.com";
  const adm = M + "-adm@example.com";

  await poster("/inscription", form({ role: "employeur", nom: "Emp Pages", email: emp,
    motdepasse: mdp, arrondissement: "Yaounde 1" }));
  await poster("/inscription", form({ role: "prestataire", nom: "Pre Pages", email: pre,
    motdepasse: mdp, arrondissement: "Yaounde 1", metier: "MetierPages", tarif: "10000" }));
  // Un compte par metier : l'employeur publie, l'equipe verifie. Les
  // melanger cacherait les regles qui separent justement les deux.
  await poster("/inscription", form({ role: "employeur", nom: "Adm Pages", email: adm,
    motdepasse: mdp, arrondissement: "Yaounde 1" }));
  const cEmp = (await poster("/connexion", form({ email: emp, motdepasse: mdp }))).cookie;
  const cPre = (await poster("/connexion", form({ email: pre, motdepasse: mdp }))).cookie;
  const cAdm = (await poster("/connexion", form({ email: adm, motdepasse: mdp }))).cookie;
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE email = ?").run(adm);
  // Publier exige une identite verifiee : ce n'est pas le sujet ici.
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email = ?").run(emp);

  console.log("\n--- Pages publiques ---");
  for (const [chemin, attendu] of [
    ["/", "PamConnect"],
    ["/employeur", "Espace employeur"],
    ["/prestataire", "Espace prestataire"],
    ["/inscription", "Créer un compte"],
    ["/connexion", "Se connecter"],
    ["/recherche", "Rechercher un prestataire"],
    ["/recherche?metier=metierpages", "Pre Pages"],
    ["/annonces", "Annonces disponibles"],
  ]) {
    const p = await page(chemin);
    dire(chemin, p.code === 200 && p.corps.includes(attendu) && !p.corps.includes("ReferenceError"),
         "code " + p.code);
  }

  console.log("\n--- Pages connectees ---");
  for (const [chemin, cookie, attendu, nom] of [
    ["/mon-profil", cEmp, "Mes annonces", "/mon-profil (employeur)"],
    ["/mon-profil", cPre, "Mes candidatures", "/mon-profil (prestataire)"],
    ["/publier-annonce", cEmp, "Publier une annonce", "/publier-annonce"],
    ["/verification", cPre, "Vérification d'identité", "/verification"],
    ["/admin", cAdm, "Espace équipe", "/admin"],
  ]) {
    const p = await page(chemin, cookie);
    dire(nom, p.code === 200 && p.corps.includes(attendu) && !p.corps.includes("ReferenceError"),
         "code " + p.code);
  }

  console.log("\n--- Le menu s'adapte ---");
  const anon = await page("/");
  dire("visiteur : 'Créer un compte' et pas 'Déconnexion'",
       anon.corps.includes("Créer un compte") && !anon.corps.includes("Déconnexion"));
  const connecte = await page("/", cPre);
  dire("connecte : 'Déconnexion' et pas 'Créer un compte'",
       connecte.corps.includes("Déconnexion") && !connecte.corps.includes("Créer un compte"));
  dire("employeur : acces a 'Publier une annonce'",
       (await page("/mon-profil", cEmp)).corps.includes("/publier-annonce") &&
       (await page("/annonces", cEmp)).corps.includes("/publier-annonce"));
  dire("prestataire : aucun acces a 'Publier une annonce'",
       !(await page("/annonces", cPre)).corps.includes("/publier-annonce"));
  dire("admin : lien vers l'espace equipe", (await page("/", cAdm)).corps.includes('href="/admin"'));
  dire("l'equipe ne publie pas d'annonce",
       !(await page("/mon-profil", cAdm)).corps.includes("/publier-annonce") &&
       (await page("/publier-annonce", cAdm)).code === 403);
  dire("non-admin : pas de lien vers l'espace equipe", !connecte.corps.includes('href="/admin"'));

  console.log("\n--- Déconnexion ---");
  const sortie = await poster("/deconnexion", form({}), cPre);
  dire("redirige vers l'accueil", sortie.code === 302, "code " + sortie.code);
  const apres = await page("/mon-profil", cPre);
  dire("la session est bien detruite", apres.code === 302, "code " + apres.code);

  console.log("\n--- Anciennes adresses .html ---");
  for (const ancienne of ["/index.html", "/inscription.html", "/connexion.html", "/recherche.html"]) {
    dire(ancienne + " redirige", (await page(ancienne)).code === 301);
  }

  console.log("\n--- NETTOYAGE ---");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 500);
