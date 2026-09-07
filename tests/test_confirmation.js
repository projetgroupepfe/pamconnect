// Série : confirmer avant d'embaucher.
//
// Le point le plus surveille ici : cet ecran est celui de L'EMPLOYEUR.
// Une candidate ne doit pas pouvoir l'ouvrir, meme sur sa propre
// candidature - la decision ne lui appartient pas.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-confirmation";
let ok = 0, ko = 0;

const dire = (nom, cond, detail) => {
  if (cond) { ok++; console.log("  OK    | " + nom); }
  else { ko++; console.log("  ECHEC | " + nom + (detail ? "   -> " + detail : "")); }
};

const form = (o) => new URLSearchParams(o);
const lire = (chemin, cookie) =>
  fetch(RACINE + chemin, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });

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
    { role, nom: "Test " + suffixe, email: mail, motdepasse: "motdepasse123", quartier: "Bastos" },
    extra || {})));
  const c = await poster("/connexion", form({ email: mail, motdepasse: "motdepasse123" }));
  return { mail, cookie: c.cookie };
}

setTimeout(async () => {
  const emp = await creerCompte("emp", "employeur");
  const autreEmp = await creerCompte("emp2", "employeur");
  const pre = await creerCompte("pre", "prestataire",
    { metier: "menagere", tarif: "20000", experience_annees: "6" });
  const eq = await creerCompte("eq", "employeur");
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE email = ?").run(eq.mail);

  // Publier exige une identite verifiee. Ce n'est pas le sujet de
  // cette serie : on la donne aux employeurs qu'elle cree.
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' "
    + "WHERE email LIKE ? AND role = 'employeur'").run("%" + M + "%");

  await poster("/annonces", form({ titre: M + " demande", metier: "menagere",
    quartier: "Mvan", horaire: "Lundi et jeudi 8h", duree_estimee: "environ 4 heures",
    conditions: "Il y a un chien.", prix: "18000" }), emp.cookie);
  const annonce = base.prepare("SELECT id FROM annonces WHERE titre LIKE ? ORDER BY id DESC LIMIT 1").get("%" + M + "%");
  await poster("/candidatures", form({ annonceId: String(annonce.id) }), pre.cookie);
  const cand = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ?").get(annonce.id);
  const url = "/candidatures/" + cand.id + "/confirmer";

  console.log("\n--- L'ECRAN N'APPARAIT PAS TANT QUE L'IDENTITE N'EST PAS VERIFIEE ---");
  dire("l'employeur recoit 403", (await lire(url, emp.cookie)).status === 403);
  const profilAvant = await (await lire("/mon-profil", emp.cookie)).text();
  dire("et le bouton n'est pas propose", !profilAvant.includes(url));

  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email = ?").run(pre.mail);

  console.log("\n--- C'EST L'ECRAN DE L'EMPLOYEUR, ET DE LUI SEUL ---");
  dire("l'employeur proprietaire y accede", (await lire(url, emp.cookie)).status === 200);
  dire("la candidate elle-meme est refusee", (await lire(url, pre.cookie)).status === 404,
       "code " + (await lire(url, pre.cookie)).status);
  dire("un autre employeur aussi", (await lire(url, autreEmp.cookie)).status === 404);
  dire("un membre de l'equipe aussi", (await lire(url, eq.cookie)).status === 404);
  dire("un visiteur est renvoye vers la connexion", (await lire(url)).status === 302);

  console.log("\n--- CE QUE L'EMPLOYEUR DOIT RELIRE (cahier des charges §7) ---");
  const page = await (await lire(url, emp.cookie)).text();
  dire("le service", page.includes("Ménage à domicile"));
  dire("l'horaire", page.includes("Lundi et jeudi 8h"));
  dire("la duree estimee", page.includes("environ 4 heures"));
  dire("le lieu general", page.includes("Mvan"));
  dire("les conditions particulieres", page.includes("Il y a un chien"));
  dire("le prix annonce", page.includes("18 000 FCFA"));
  dire("la commission de la plateforme", page.includes("Commission PamConnect"));
  dire("le montant net revenant a la personne", page.includes("16 200 FCFA"));
  dire("qu'aucun autre frais ne s'ajoute", page.includes("Aucun autre frais"));

  // Un seul montant existe desormais : le prix de l'annonce. Il n'y a
  // plus d'ecart a calculer, puisqu'il n'y a plus deux chiffres.
  dire("l'employeur reconnait son propre prix",
       page.includes("le prix que vous avez annoncé"));
  dire("le nom de la personne choisie", page.includes("Test pre"));
  dire("un lien vers son profil complet", page.includes("/personnes/"));

  console.log("\n--- LE VOCABULAIRE EST CELUI DE L'EMPLOYEUR ---");
  dire("il lit 'Vous payez', pas 'Vous demandez'",
       page.includes("Vous payez") && !page.includes("Vous demandez"));

  console.log("\n--- L'ADRESSE EXACTE N'EST PAS LA ---");
  // La plateforme ne demande aucune adresse exacte : seul le lieu general
  // circule tant que le paiement n'est pas confirme.
  dire("aucun champ d'adresse exacte n'existe dans une annonce",
       !base.prepare("PRAGMA table_info(annonces)").all().some((c) => c.name === "adresse"));

  console.log("\n--- RIEN N'EST DECIDE TANT QU'ON N'A PAS CONFIRME ---");
  dire("la candidature est toujours en attente",
       base.prepare("SELECT statut FROM candidatures WHERE id = ?").get(cand.id).statut === "en attente");

  await poster("/candidatures/statut",
    form({ candidatureId: String(cand.id), statut: "acceptee" }), emp.cookie);
  dire("apres confirmation, elle est acceptee",
       base.prepare("SELECT statut FROM candidatures WHERE id = ?").get(cand.id).statut === "acceptee");

  console.log("\n--- ON NE CONFIRME PAS DEUX FOIS ---");
  dire("l'ecran repond 409 une fois la decision prise",
       (await lire(url, emp.cookie)).status === 409);

  console.log("\n--- REFUSER RESTE IMMEDIAT ---");
  // On ne s'engage a rien en refusant : faire confirmer un refus ne
  // protegerait personne et ajouterait un clic.
  const pre2 = await creerCompte("pre2", "prestataire", { metier: "menagere", tarif: "10000" });
  await poster("/candidatures", form({ annonceId: String(annonce.id) }), pre2.cookie);
  const cand2 = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ? ORDER BY id DESC LIMIT 1").get(annonce.id);
  await poster("/candidatures/statut",
    form({ candidatureId: String(cand2.id), statut: "refusee" }), emp.cookie);
  dire("un refus passe sans ecran intermediaire",
       base.prepare("SELECT statut FROM candidatures WHERE id = ?").get(cand2.id).statut === "refusee");

  console.log("\n--- NETTOYAGE ---");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
