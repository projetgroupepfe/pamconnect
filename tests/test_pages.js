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
    ["/employeur", "Vous cherchez quelqu'un"],
    ["/prestataire", "Vous proposez vos services"],
    ["/inscription", "Créer un compte"],
    ["/connexion", "Se connecter"],
    ["/recherche", "Rechercher un prestataire"],
    ["/recherche?metier=metierpages", "Pre Pages"],
    ["/annonces", "Demandes disponibles"],
  ]) {
    const p = await page(chemin);
    dire(chemin, p.code === 200 && p.corps.includes(attendu) && !p.corps.includes("ReferenceError"),
         "code " + p.code);
  }

  console.log("\n--- Le logo ---");
  const logo = await page("/logo.png");
  const iconeOnglet = await page("/favicon.png");
  dire("le logo et l'icone d'onglet sont servis par le serveur",
       logo.code === 200 && iconeOnglet.code === 200, "codes " + logo.code + " " + iconeOnglet.code);
  const entete = (await page("/")).corps;
  dire("l'en-tete montre le logo, et l'onglet a son icone",
       entete.includes('src="/logo.png"') && entete.includes('rel="icon"'));
  // Le meme bouclier sert d'icone "identite verifiee" ailleurs dans la page :
  // ce qui compte est qu'il ne soit plus le logo.
  dire("le logo n'est plus le bouclier dessine",
       /<a class="logo" href="\/">\s*<img class="logo-image"/.test(entete));

  console.log("\n--- Pages de presentation : ce qu'elles promettent ---");
  const accueil = (await page("/")).corps;
  const vousCherchez = (await page("/employeur")).corps;
  const vousProposez = (await page("/prestataire")).corps;
  const anciennesPhrases = [/reverse aussitôt/, /reversée aussitôt/, /tarif affiché sur le profil/,
    /paie le tarif affiché/, /de la plus proche à la plus éloignée/, /dès que\s+l'employeur a payé/,
    /Aucun montant ne change/];
  dire("les phrases de l'ancien modele ont disparu des trois pages",
       [accueil, vousCherchez, vousProposez].every((corps) => anciennesPhrases.every((phrase) => !phrase.test(corps))));
  dire("la somme est bloquee a la publication et versee a la declaration du service",
       accueil.includes("bloqué dès la publication") && vousCherchez.includes("bloquée dès la publication") &&
       /quand\s+l'employeur a déclaré le service effectué/.test(vousProposez));
  dire("la page dit que le prix ne baisse plus apres une reponse",
       vousProposez.includes("Après votre réponse, le prix ne peut plus baisser."));
  dire("l'exemple porte son nom et suit la commission",
       vousProposez.includes('<p class="exemple-titre">Exemple de calcul</p>') &&
       vousProposez.includes("<strong>1 000 FCFA</strong>") && vousProposez.includes("<strong>9 000 FCFA</strong>"));
  dire("le mot prestataire ne s'affiche plus dans le titre",
       !/<title>[^<]*prestataire/i.test(vousProposez) && !/<title>[^<]*prestataire/i.test(vousCherchez));
  dire("Proposer mes services ouvre l'inscription sur ce choix",
       accueil.includes('href="/inscription?role=prestataire"') &&
       vousProposez.includes('href="/inscription?role=prestataire"') &&
       (await page("/inscription?role=prestataire")).corps.includes('value="prestataire" selected') &&
       (await page("/inscription")).corps.includes('value="employeur" selected') &&
       (await page("/inscription?role=equipe")).corps.includes('value="employeur" selected'));

  console.log("\n--- Pages connectees ---");
  for (const [chemin, cookie, attendu, nom] of [
    ["/mon-profil", cEmp, "Les avis reçus", "/mon-profil (employeur)"],
    ["/mon-profil", cPre, "Les avis reçus", "/mon-profil (prestataire)"],
    ["/mes-demandes", cEmp, "Ce que vous avez publié", "/mes-demandes"],
    ["/mes-reponses", cPre, "vous avez répondu", "/mes-reponses"],
    ["/publier-annonce", cEmp, "Publier une demande", "/publier-annonce"],
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
  dire("employeur : acces a 'Publier une demande'",
       (await page("/mes-demandes", cEmp)).corps.includes("/publier-annonce") &&
       (await page("/annonces", cEmp)).corps.includes("/publier-annonce"));
  dire("prestataire : aucun acces a 'Publier une demande'",
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
