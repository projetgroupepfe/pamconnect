// Série : le tarif souhaité est réservé à l'équipe, et les pages disent le
// bon modèle.
//
// LE MODELE. Le prestataire indique un tarif SOUHAITE : seule l'équipe le
// voit, il lui sert de point de départ quand elle l'appelle. L'employeur
// choisit ou refuse une personne, mais ne voit jamais ce tarif : c'est
// l'équipe qui lui annonce le prix (commission comprise) par téléphone.
// Rien n'est bloqué à la publication.
//
// Cette série surveille aussi une panne qui a existé : une faute de frappe
// dans le script d'une page ("const TAUX = 10 100;") empêchait tout le
// script de la page d'inscription de tourner, sans que rien d'autre ne le
// signale. Chaque page est donc lue, et chacun de ses scripts est compilé.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-tarifeq";
let ok = 0, ko = 0;

const dire = (nom, cond, detail) => {
  if (cond) { ok++; console.log("  OK    | " + nom); }
  else { ko++; console.log("  ECHEC | " + nom + (detail ? "   -> " + detail : "")); }
};

const form = (o) => new URLSearchParams(o);
const lire = (chemin, cookie) =>
  fetch(RACINE + chemin, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
const texte = async (chemin, cookie) => (await lire(chemin, cookie)).text();
const plat = (t) => t.replace(/\s+/g, " ");

async function poster(chemin, corps, cookie) {
  const e = {};
  if (cookie) e.Cookie = cookie;
  const r = await fetch(RACINE + chemin, { method: "POST", body: corps, headers: e, redirect: "manual" });
  const sc = r.headers.getSetCookie();
  return { code: r.status, corps: await r.text(), cookie: sc.length ? sc[0].split(";")[0] : null };
}

async function creerCompte(suffixe, role, extra) {
  const mail = M + "-" + suffixe + "@example.com";
  await poster("/inscription", form(Object.assign(
    { role, nom: "Test " + suffixe, email: mail, motdepasse: "motdepasse123",
      telephone: "600000000", quartier: "Bastos" },
    extra || {})));
  const c = await poster("/connexion", form({ email: mail, motdepasse: "motdepasse123" }));
  const ligne = base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(mail.toLowerCase());
  return { mail, cookie: c.cookie, id: ligne.id };
}

// Les scripts d'une page, compiles un par un. Un script qui ne compile pas
// est un script qui ne tourne pas : tout ce qu'il devait faire est perdu.
function scriptsCassesDans(html) {
  const casses = [];
  const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (/type\s*=\s*["'](?!text\/javascript|module)/i.test(m[1])) continue;
    try { new Function(m[2]); }
    catch (e) { casses.push(e.message); }
  }
  return casses;
}

setTimeout(async () => {
  const emp = await creerCompte("emp", "employeur");
  const pre = await creerCompte("pre", "prestataire", { metier: "menagere", tarif: "20000" });
  const pre2 = await creerCompte("pre2", "prestataire", { metier: "menagere", tarif: "15000" });
  const eq = await creerCompte("eq", "employeur");
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE email = ?").run(eq.mail.toLowerCase());
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email LIKE ?")
    .run("%" + M + "%");
  for (const p of [pre, pre2]) {
    base.prepare(`INSERT INTO jetons_mouvements (utilisateur_id, quantite, nature, motif, detail)
                  VALUES (?, 5, 'achete', 'achat', 'Credit de test')`).run(p.id);
  }

  await poster("/annonces", form({ titre: M + " demande", metier: "menagere",
    quartier: "Bastos", arrondissement: "Yaounde 1", horaire: "Lundi 8h" }), emp.cookie);
  const annonce = base.prepare(
    "SELECT id FROM annonces WHERE titre = ? ORDER BY id DESC LIMIT 1").get(M + " demande");
  await poster("/candidatures", form({ annonceId: String(annonce.id) }), pre.cookie);
  await poster("/candidatures", form({ annonceId: String(annonce.id) }), pre2.cookie);
  const cand = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ? AND prestataire_id = ?")
    .get(annonce.id, pre.id);

  console.log("\n--- 1. AUCUN SCRIPT DE PAGE N'EST CASSE ---");
  const pages = [
    ["l'accueil", "/", null],
    ["l'inscription", "/inscription", null],
    ["l'inscription d'une personne qui propose ses services", "/inscription?role=prestataire", null],
    ["la connexion", "/connexion", null],
    ["la recherche", "/recherche?metier=menagere", emp.cookie],
    ["la fiche d'une personne", "/personnes/" + pre.id, emp.cookie],
    ["la publication d'une demande", "/publier-annonce", emp.cookie],
    ["mes demandes", "/mes-demandes", emp.cookie],
    ["la liste des demandes, vue de la personne", "/annonces", pre.cookie],
    ["le profil de la personne", "/mon-profil", pre.cookie],
    ["la modification du profil", "/mon-profil/modifier", pre.cookie],
    ["l'ecran des mises en relation de l'equipe", "/admin/mises-en-relation", eq.cookie],
    ["l'annuaire de l'equipe", "/admin/utilisateurs", eq.cookie],
  ];
  for (const [nom, chemin, cookie] of pages) {
    const r = await lire(chemin, cookie);
    const html = await r.text();
    const casses = scriptsCassesDans(html);
    dire("les scripts de " + nom + " compilent", r.status === 200 && casses.length === 0,
         "code " + r.status + " " + casses.join(" | "));
  }

  console.log("\n--- 2. L'EMPLOYEUR NE VOIT PAS LE TARIF SOUHAITE ---");
  const rech = await texte("/recherche?metier=menagere", emp.cookie);
  dire("la recherche montre la personne", rech.includes("Test pre"));
  dire("mais ni son tarif, ni le mot 'Tarif demandé'",
       !rech.includes("20 000 FCFA") && !rech.includes("15 000 FCFA") && !rech.includes("Tarif demandé"));
  const fiche = await texte("/personnes/" + pre.id, emp.cookie);
  dire("la fiche montre la personne", fiche.includes("Test pre"));
  dire("mais ni son tarif, ni une section tarif",
       !fiche.includes("20 000 FCFA") && !fiche.includes("Le tarif demandé"));
  dire("un visiteur non plus",
       !(await texte("/personnes/" + pre.id)).includes("20 000 FCFA") &&
       !(await texte("/recherche?metier=menagere")).includes("20 000 FCFA"));

  console.log("\n--- 3. LA PERSONNE, ELLE, VOIT SON TARIF ET LE MODELE ---");
  const profil = await texte("/mon-profil", pre.cookie);
  dire("son tarif souhaité, ce qu'elle reçoit, ce que l'employeur paie",
       profil.includes("20 000 FCFA") && profil.includes("2 000 FCFA") && profil.includes("22 000 FCFA"));
  dire("la commission s'ajoute, elle n'est pas retirée",
       profil.includes("+ 2 000 FCFA") && !profil.includes("− 2 000 FCFA") && !profil.includes("18 000 FCFA"));
  dire("elle sait que seule l'équipe le voit", plat(profil).includes("seule l'équipe PamConnect le voit"));
  const inscr = plat(await texte("/inscription?role=prestataire"));
  dire("l'inscription parle d'un tarif souhaité, vu de l'équipe seulement",
       inscr.includes("Votre tarif souhaité") && inscr.includes("Vu par l'équipe PamConnect seulement"));
  dire("le script de l'inscription calcule la commission avec une division",
       inscr.includes("const TAUX = 10 / 100;"));
  const modif = plat(await texte("/mon-profil/modifier", pre.cookie));
  dire("la modification aussi", modif.includes("Votre tarif souhaité") && modif.includes("Vu par l'équipe PamConnect seulement"));

  console.log("\n--- 4. L'EMPLOYEUR CHOISIT : L'EQUIPE LE VOIT EN PREMIER ---");
  // La carte de NOTRE demande seulement : une base reelle porte deja d'autres
  // demandes, dont certaines ont deja une personne choisie.
  const carteDeNotreDemande = async () => {
    const page = plat(await texte("/admin/mises-en-relation", eq.cookie));
    const debut = page.indexOf(M + " demande");
    const fin = page.indexOf("<h3>", debut + 1);
    return debut === -1 ? "" : page.slice(debut, fin === -1 ? undefined : fin);
  };
  let equipe = await carteDeNotreDemande();
  dire("la demande est sur l'ecran de l'equipe", equipe !== "");
  dire("avant le choix, rien n'est marqué comme choisi", !equipe.includes("Choisie par l'employeur"));
  await poster("/candidatures/statut",
    form({ candidatureId: String(cand.id), statut: "acceptee" }), emp.cookie);
  equipe = await carteDeNotreDemande();
  dire("l'équipe lit qui a été choisie", equipe.includes("Choisie par l'employeur : Test pre"));
  dire("on lui dit d'appeler cette personne en premier",
       equipe.includes("Appelez-la en premier pour convenir du prix"));
  dire("le tarif souhaité lui est montré, comme point de départ",
       equipe.includes("tarif souhaité 20 000 FCFA"));
  const iChoisie = equipe.indexOf("Choisie par l'employeur : à appeler en premier");
  const iAutre = equipe.indexOf("Test pre2");
  dire("elle est listée avant l'autre personne intéressée", iChoisie !== -1 && (iAutre === -1 || iChoisie < iAutre));
  const annuaire = plat(await texte("/admin/utilisateurs", eq.cookie));
  dire("l'annuaire de l'équipe montre le tarif souhaité", annuaire.includes("Tarif souhaité : 20 000 FCFA"));

  console.log("\n--- 5. LES TEXTES DE LA DISCUSSION DISENT LE BON MODELE ---");
  const cote = async (cookie) => plat(await texte("/messages/" + cand.id, cookie));
  const vueEmp = await cote(emp.cookie);
  const vuePre = await cote(pre.cookie);
  dire("l'employeur : sa déclaration prévient l'équipe",
       vueEmp.includes("Cette déclaration prévient l'équipe PamConnect"));
  dire("l'employeur : la déclaration ne verse rien",
       !vueEmp.includes("verse la somme"));
  dire("la personne : sa déclaration ne la paie pas, l'employeur paie d'abord PamConnect",
       vuePre.includes("paie d'abord PamConnect") && vuePre.includes("vous reverse"));
  dire("aucun côté ne parle d'une somme bloquée", !/somme bloqu/i.test(vueEmp) && !/somme bloqu/i.test(vuePre));

  const publier = plat(await texte("/publier-annonce", emp.cookie));
  dire("la publication dit que rien n'est payé maintenant", publier.includes("Vous ne payez rien maintenant"));
  const employeur = plat(await texte("/employeur"));
  dire("la page employeur dit qu'on paie après le service",
       employeur.includes("Vous ne payez rien à la publication") && !/bloqu/i.test(employeur));

  const supprimes = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?")
    .run("%" + M + "%").changes;
  console.log("  ----- | nettoyage : " + supprimes + " comptes de test supprimés");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 500);
