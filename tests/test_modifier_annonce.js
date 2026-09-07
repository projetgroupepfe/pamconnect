// Série : un employeur corrige sa demande.
//
// Point le plus surveille : ces deux pages sont celles de L'EMPLOYEUR
// PROPRIETAIRE. Personne d'autre, pas meme une candidate a cette demande.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-modif-annonce";
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
  const pre = await creerCompte("pre", "prestataire", { metier: "menagere", tarif: "15000" });
  const eq = await creerCompte("eq", "employeur");
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE email = ?").run(eq.mail);

  // Publier exige une identite verifiee. Ce n'est pas le sujet de
  // cette serie : on la donne aux employeurs qu'elle cree.
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' "
    + "WHERE email LIKE ? AND role = 'employeur'").run("%" + M + "%");

  await poster("/annonces", form({ titre: M + " avant", metier: "menagere",
    quartier: "Mvan", horaire: "Lundi 8h", prix: "10000",
    unite_tarif: "forfaitaire", duree_estimee: "2 heures" }), emp.cookie);
  const a = base.prepare("SELECT id FROM annonces WHERE titre LIKE ? ORDER BY id DESC LIMIT 1").get("%" + M + " avant%");
  const url = "/annonces/" + a.id + "/modifier";

  console.log("\n--- CETTE PAGE EST CELLE DE L'EMPLOYEUR PROPRIETAIRE ---");
  dire("le proprietaire y accede", (await lire(url, emp.cookie)).status === 200);
  dire("un autre employeur est refuse", (await lire(url, autreEmp.cookie)).status === 404);
  dire("une personne qui propose ses services aussi", (await lire(url, pre.cookie)).status === 404);
  dire("un membre de l'equipe aussi", (await lire(url, eq.cookie)).status === 403);
  dire("un visiteur est renvoye vers la connexion", (await lire(url)).status === 302);

  // Masquer le bouton ne suffit pas : on envoie la requete a la main.
  const volEcriture = await poster(url, form({ titre: "vole", metier: "menagere",
    quartier: "Mvan", horaire: "x", prix: "10000" }), autreEmp.cookie);
  dire("un autre employeur ne peut pas ecrire non plus", volEcriture.code === 404);
  dire("le titre n'a pas bouge",
       base.prepare("SELECT titre FROM annonces WHERE id = ?").get(a.id).titre === M + " avant");

  console.log("\n--- LE FORMULAIRE EST PREREMPLI ---");
  const page = await (await lire(url, emp.cookie)).text();
  dire("le titre", page.includes('value="' + M + ' avant"'));
  dire("l'horaire", page.includes('value="Lundi 8h"'));
  dire("le metier officiel", page.includes('value="Ménage à domicile"'));
  dire("le quartier", page.includes('value="Mvan"'));
  dire("le budget", page.includes('value="10000"'));
  dire("la duree", page.includes('value="2 heures"'));

  console.log("\n--- LA MODIFICATION ---");
  await poster(url, form({ titre: M + " apres", metier: "nounous",
    quartier: "biyemassi", horaire: "Mardi et vendredi, de 9h à 13h",
    prix: "22000", unite_tarif: "journalier",
    duree_estimee: "environ 4 heures", conditions: "Deuxième étage." }), emp.cookie);
  const apres = base.prepare("SELECT * FROM annonces WHERE id = ?").get(a.id);
  dire("le titre est change", apres.titre === M + " apres", apres.titre);
  dire("l'horaire aussi", apres.horaire === "Mardi et vendredi, de 9h à 13h");
  dire("le metier est ramene au nom officiel", apres.metier === "Garde d'enfants", apres.metier);
  dire("le quartier aussi", apres.quartier === "Biyem-Assi", apres.quartier);
  dire("et l'arrondissement en est deduit", apres.arrondissement === "Yaoundé 6", apres.arrondissement);
  dire("le prix et son unite", apres.prix === 22000 && apres.unite_tarif === "journalier");
  dire("les conditions", apres.conditions === "Deuxième étage.");

  console.log("\n--- LES MEMES REGLES QU'A LA PUBLICATION ---");
  const sansHoraire = await poster(url, form({ titre: "x", metier: "menagere",
    quartier: "Mvan", horaire: "  ", prix: "10000" }), emp.cookie);
  dire("sans horaire : refuse", sansHoraire.code === 400, "code " + sansHoraire.code);
  const sansQuartier = await poster(url, form({ titre: "x", metier: "menagere",
    quartier: "", horaire: "Lundi", prix: "10000" }), emp.cookie);
  dire("sans quartier : refuse", sansQuartier.code === 400, "code " + sansQuartier.code);
  const budgetNegatif = await poster(url, form({ titre: "x", metier: "menagere",
    quartier: "Mvan", horaire: "Lundi", prix: "-500" }), emp.cookie);
  dire("budget negatif : refuse", budgetNegatif.code === 400, "code " + budgetNegatif.code);
  dire("aucun de ces essais n'a modifie l'annonce",
       base.prepare("SELECT titre FROM annonces WHERE id = ?").get(a.id).titre === M + " apres");

  const uniteInventee = await poster(url, form({ titre: M + " apres", metier: "menagere",
    quartier: "Mvan", horaire: "Lundi", prix: "5000", unite_tarif: "gratuit" }), emp.cookie);
  dire("une unite inventee est ramenee a la valeur par defaut",
       base.prepare("SELECT unite_tarif FROM annonces WHERE id = ?").get(a.id).unite_tarif === "forfaitaire",
       "code " + uniteInventee.code);

  console.log("\n--- ON PREVIENT QUAND DES GENS ONT DEJA REPONDU ---");
  let p = await (await lire(url, emp.cookie)).text();
  dire("aucune candidature : pas d'avertissement", !p.includes("déjà répondu"));

  await poster("/candidatures", form({ annonceId: String(a.id) }), pre.cookie);
  p = await (await lire(url, emp.cookie)).text();
  dire("une candidature : l'employeur est prevenu", p.includes("déjà répondu"));
  dire("on lui rappelle que la plateforme ne previent personne",
       p.includes("ne le fait pas à votre place"));
  dire("mais la correction reste possible",
       (await poster(url, form({ titre: M + " corrige", metier: "menagere",
         quartier: "Mvan", horaire: "Lundi 8h", prix: "10000" }), emp.cookie)).code === 200);

  console.log("\n--- LE BOUTON EST SUR SES ANNONCES, PAS AILLEURS ---");
  const profilEmp = await (await lire("/mon-profil", emp.cookie)).text();
  dire("l'employeur voit 'Modifier cette demande'", profilEmp.includes(url));
  const profilPre = await (await lire("/mon-profil", pre.cookie)).text();
  // On cherche l'adresse d'une MODIFICATION D'ANNONCE, pas la chaine
  // "/modifier" : elle apparait aussi dans /mon-profil/modifier, qui est
  // le bouton legitime "Modifier mon profil".
  dire("la personne qui propose ses services ne voit aucun bouton d'annonce",
       !/\/annonces\/\d+\/modifier/.test(profilPre));

  console.log("\n--- NETTOYAGE ---");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
