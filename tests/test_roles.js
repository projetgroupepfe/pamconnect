// Série : chaque rôle voit ce qui le concerne, et rien d'autre.
//
// Le principe verifie ici : un bouton propose a l'ecran doit TOUJOURS
// correspondre a une action que le serveur autorise. Proposer une action
// refusee ensuite est un defaut a part entiere - la personne clique, se
// fait renvoyer, et ne comprend pas ce qu'elle a fait de mal.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-roles";
let ok = 0, ko = 0;

const dire = (nom, cond, detail) => {
  if (cond) { ok++; console.log("  OK    | " + nom); }
  else { ko++; console.log("  ECHEC | " + nom + (detail ? "   -> " + detail : "")); }
};

const form = (o) => new URLSearchParams(o);
const lire = (chemin, cookie) =>
  fetch(RACINE + chemin, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });

async function creerCompte(suffixe, role, extra) {
  const mail = M + "-" + suffixe + "@example.com";
  await fetch(RACINE + "/inscription", { method: "POST", body: form(Object.assign(
    { role, nom: "Test " + suffixe, email: mail, motdepasse: "motdepasse123", telephone: "600000000", quartier: "Bastos" },
    extra || {})) });
  const r = await fetch(RACINE + "/connexion", { method: "POST", redirect: "manual",
    body: form({ email: mail, motdepasse: "motdepasse123", telephone: "600000000" }) });
  return { mail, cookie: r.headers.getSetCookie()[0].split(";")[0] };
}

setTimeout(async () => {
  const emp = await creerCompte("emp", "employeur");
  const pre = await creerCompte("pre", "prestataire", { metier: "MetierRoles", tarif: "25000" });
  const eq = await creerCompte("eq", "employeur");
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE email = ?").run(eq.mail);

  // Publier une demande ET y repondre exigent une identite verifiee.
  // Ce n'est pas le sujet de cette serie : on la donne a tous les
  // comptes qu'elle cree.
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' "
    + "WHERE email LIKE ?").run("%" + M + "%");

  await fetch(RACINE + "/annonces", { method: "POST", headers: { Cookie: emp.cookie },
    redirect: "manual", body: form({ titre: M + " demande", metier: "MetierRoles",
      quartier: "Mvan", horaire: "Lundi 8h", prix: "10000" }) });
  const annonce = base.prepare("SELECT id FROM annonces WHERE titre LIKE ? ORDER BY id DESC LIMIT 1").get("%" + M + "%");
  await fetch(RACINE + "/candidatures", { method: "POST", headers: { Cookie: pre.cookie },
    redirect: "manual", body: form({ annonceId: String(annonce.id) }) });
  const conv = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ?").get(annonce.id);

  const roles = [
    ["visiteur", null],
    ["employeur", emp.cookie],
    ["prestataire", pre.cookie],
    ["equipe", eq.cookie],
  ];

  console.log("\n--- LES ANNONCES RESTENT VISIBLES PAR TOUS ---");
  for (const [nom, cookie] of roles) {
    const p = await (await lire("/annonces", cookie)).text();
    dire("les annonces s'affichent pour : " + nom, p.includes(M + " demande"));
  }

  console.log("\n--- CHAQUE PAGE POUR CHAQUE ROLE ---");
  // 200 = ouvert, 403 = refuse, 302 = renvoye vers la connexion.
  const attendu = [
    ["/publier-annonce",                    [302, 200, 403, 403], "publier une annonce"],
    ["/candidatures/nouvelle/" + annonce.id, [302, 403, 200, 403], "repondre a une annonce"],
    // La verification concerne les deux cotes ; seule l'equipe en est
    // dispensee, puisqu'elle ne rencontre personne.
    ["/verification",                        [302, 200, 200, 403], "verifier mon identite"],
    ["/admin",                               [302, 403, 403, 200], "espace equipe"],
    ["/messages/" + conv.id,                 [302, 200, 200, 403], "la discussion"],
  ];
  for (const [chemin, codes, nom] of attendu) {
    for (let i = 0; i < roles.length; i++) {
      const r = await lire(chemin, roles[i][1]);
      dire(nom + " / " + roles[i][0] + " = " + codes[i],
           r.status === codes[i], "recu " + r.status);
    }
  }

  console.log("\n--- UN BOUTON PROPOSE EST UN BOUTON QUI MARCHE ---");
  for (const [nom, cookie] of roles) {
    const page = await (await lire("/annonces", cookie)).text();
    const bouton = page.includes('href="/publier-annonce"');
    const autorise = (await lire("/publier-annonce", cookie)).status === 200;
    dire("publier : ce que voit " + nom + " correspond a ce que le serveur permet",
         bouton === autorise, "bouton=" + bouton + " serveur=" + autorise);

    const boutonRep = page.includes("/candidatures/nouvelle/");
    const autoriseRep = (await lire("/candidatures/nouvelle/" + annonce.id, cookie)).status === 200;
    dire("repondre : idem pour " + nom, boutonRep === autoriseRep,
         "bouton=" + boutonRep + " serveur=" + autoriseRep);
  }

  console.log("\n--- LE MENU NE MONTRE QUE CE QUI CONCERNE ---");
  const menuDe = async (cookie) => {
    const t = await (await lire("/annonces", cookie)).text();
    const nav = t.slice(t.indexOf('<nav class="menu"'), t.indexOf("</nav>"));
    return (nav.match(/href="[^"]+"/g) || []).map((x) => x.slice(6, -1));
  };
  const mVis = await menuDe(null);
  const mEmp = await menuDe(emp.cookie);
  const mPre = await menuDe(pre.cookie);
  const mEq  = await menuDe(eq.cookie);

  // "Rechercher" sert a trouver une aide-menagere : outil de l'employeur.
  dire("l'employeur a Rechercher", mEmp.includes("/recherche"));
  dire("la personne qui travaille ne l'a pas", !mPre.includes("/recherche"));
  dire("l'equipe non plus", !mEq.includes("/recherche"));

  // L'equipe ne repond a rien et ne discute avec personne.
  dire("l'equipe n'a ni Annonces ni Messages",
       !mEq.includes("/annonces") && !mEq.includes("/messages"));
  dire("l'equipe a son espace", mEq.includes("/admin"));
  dire("personne d'autre n'a l'espace equipe",
       !mEmp.includes("/admin") && !mPre.includes("/admin") && !mVis.includes("/admin"));

  dire("les deux cotes ont Messages",
       mEmp.includes("/messages") && mPre.includes("/messages"));
  dire("un visiteur n'a pas Messages", !mVis.includes("/messages"));

  // Une barre de telephone ne supporte pas plus de cinq entrees : au-dela
  // elles deviennent trop etroites pour etre touchees du pouce.
  for (const [nom, menu] of [["visiteur", mVis], ["employeur", mEmp],
                             ["prestataire", mPre], ["equipe", mEq]]) {
    dire("le menu de " + nom + " tient sur un telephone",
         menu.length <= 5, menu.length + " entrees");
  }

  console.log("\n--- ON SAIT TOUJOURS OU L'ON EST ---");
  for (const chemin of ["/", "/annonces", "/messages", "/mon-profil"]) {
    const t = await (await lire(chemin, pre.cookie)).text();
    const m = t.match(/<a href="([^"]+)"\s+class="actif"/);
    dire("sur " + chemin + ", le menu marque la bonne page",
         Boolean(m) && m[1] === chemin, m ? m[1] : "aucune marque");
  }
  const pageProfil = await (await lire("/mon-profil", pre.cookie)).text();
  dire("la marque est aussi annoncee aux lecteurs d'ecran",
       pageProfil.includes('aria-current="page"'));

  console.log("\n--- LA PAGE MES MESSAGES ---");
  dire("elle s'ouvre pour l'employeur", (await lire("/messages", emp.cookie)).status === 200);
  dire("et pour la personne qui travaille", (await lire("/messages", pre.cookie)).status === 200);
  dire("un visiteur est renvoye vers la connexion", (await lire("/messages")).status === 302);
  const listeMsg = await (await lire("/messages", pre.cookie)).text();
  dire("la discussion en cours y figure", listeMsg.includes("/messages/" + conv.id));
  dire("on y lit le nom de l'autre personne", listeMsg.includes("Test emp"));

  console.log("\n--- NETTOYAGE ---");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
