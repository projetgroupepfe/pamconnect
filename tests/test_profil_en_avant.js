// Série : mettre son profil en avant.
//
// Les jetons ne paient plus une réponse : ils paient une mise en avant,
// des deux côtés. Côté employeur, une demande passe devant les autres ;
// côté prestataire, l'équipe appelle la personne en premier.
//
// Ce que cette série surveille le plus : la mise en avant d'un profil ne
// touche PAS la recherche d'un employeur. On ne paie pas pour passer
// devant quelqu'un de mieux noté.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-profil-avant";
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
    { role, nom: "Test " + suffixe, email: mail, motdepasse: "motdepasse123",
      telephone: "600000000", quartier: "Bastos" },
    extra || {})));
  const c = await poster("/connexion", form({ email: mail, motdepasse: "motdepasse123" }));
  const ligne = base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(mail.toLowerCase());
  return { mail, cookie: c.cookie, id: ligne.id };
}

const soldeDe = (id) => base.prepare(
  "SELECT COALESCE(SUM(quantite), 0) AS n FROM jetons_mouvements WHERE utilisateur_id = ?").get(id).n;

setTimeout(async () => {
  const emp = await creerCompte("emp", "employeur");
  const pre = await creerCompte("pre", "prestataire", { metier: "menagere", tarif: "20000" });
  const pre2 = await creerCompte("pre2", "prestataire", { metier: "menagere", tarif: "15000" });
  const eq = await creerCompte("eq", "employeur");
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE email = ?").run(eq.mail.toLowerCase());

  console.log("\n--- 1. IL FAUT ETRE VERIFIEE ---");
  const avant = await lire("/mon-profil/mise-en-avant", pre.cookie);
  dire("une identité non vérifiée est refusée", avant.status === 409, "code " + avant.status);

  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email LIKE ?")
    .run("%" + M + "%");

  const cotéEmployeur = await lire("/mon-profil/mise-en-avant", emp.cookie);
  dire("un employeur n'y a pas sa place", cotéEmployeur.status === 403, "code " + cotéEmployeur.status);

  console.log("\n--- 2. L'ECRAN DIT CE QUE CELA CHANGE ET CE QUE CELA COUTE ---");
  // Les jetons offerts arrivent a la premiere visite de la page.
  await lire("/mes-jetons", pre.cookie);
  let ecran = await (await lire("/mon-profil/mise-en-avant", pre.cookie)).text();
  dire("il annonce l'appel de l'équipe", ecran.includes("en premier"));
  dire("il dit ce que cela ne fait pas", ecran.includes("rien à la recherche des employeurs"));
  dire("le solde offert ne suffit pas", ecran.includes("Votre solde ne suffit pas"));

  const sansJetons = await poster("/mon-profil/mise-en-avant", form({}), pre.cookie);
  dire("sans assez de jetons, c'est refusé", sansJetons.code === 402, "code " + sansJetons.code);

  console.log("\n--- 3. LA MISE EN AVANT ---");
  // Le prix d'une mise en avant est un reglage de l'equipe : on le lit au
  // lieu de supposer un nombre, et on credite exactement de quoi la payer.
  const coutAvant = Number(
    base.prepare("SELECT valeur FROM parametres WHERE cle = 'cout_mise_en_avant'").get().valeur);
  base.prepare(
    "INSERT INTO jetons_mouvements (utilisateur_id, quantite, nature, motif, detail) "
    + "VALUES (?, ?, 'achete', 'achat', 'Série de test')").run(pre.id, coutAvant);
  const soldeAvant = soldeDe(pre.id);

  const pose = await poster("/mon-profil/mise-en-avant", form({}), pre.cookie);
  dire("le profil est mis en avant", pose.code === 200, "code " + pose.code);

  const apres = base.prepare("SELECT mise_en_avant_jusqu_au FROM utilisateurs WHERE id = ?").get(pre.id);
  dire("la date de fin est posée", Boolean(apres.mise_en_avant_jusqu_au));
  dire("le prix d'une mise en avant a ete preleve", soldeDe(pre.id) === soldeAvant - coutAvant,
       soldeAvant + " -> " + soldeDe(pre.id));

  const deuxFois = await poster("/mon-profil/mise-en-avant", form({}), pre.cookie);
  dire("on ne prolonge pas en payant deux fois", deuxFois.code === 409, "code " + deuxFois.code);
  dire("et rien n'a été prélevé de plus", soldeDe(pre.id) === soldeAvant - coutAvant);

  const profil = await (await lire("/mon-profil", pre.cookie)).text();
  // L'apostrophe est echappee par le gabarit : on cherche la phrase sans elle.
  dire("le profil dit jusqu'à quand", profil.includes("Profil en avant jusqu"));

  console.log("\n--- 4. L'EQUIPE L'APPELLE EN PREMIER ---");
  await poster("/annonces", form({ titre: M + " demande", metier: "menagere",
    quartier: "Bastos", arrondissement: "Yaounde 1", horaire: "Lundi 8h" }), emp.cookie);

  const listeEquipe = await (await lire("/admin/mises-en-relation", eq.cookie)).text();
  dire("son nom porte le badge", listeEquipe.includes("Mise en avant"));
  dire("et elle passe devant l'autre",
       listeEquipe.indexOf("Test pre<") < listeEquipe.indexOf("Test pre2<")
       || listeEquipe.indexOf("Test pre ") < listeEquipe.indexOf("Test pre2 "));

  console.log("\n--- 5. LA RECHERCHE D'UN EMPLOYEUR NE CHANGE PAS ---");
  // pre2 a une meilleure note : elle doit rester devant, mise en avant
  // ou pas. C'est la regle de la plateforme.
  const cand = base.prepare(
    "INSERT INTO annonces (employeur_id, titre, metier, quartier, arrondissement, horaire) "
    + "VALUES (?, ?, 'menagere', 'Bastos', 'Yaounde 1', 'Samedi')").run(emp.id, M + " notee");
  const rep = base.prepare(
    "INSERT INTO candidatures (annonce_id, prestataire_id, statut, terminee_le) "
    + "VALUES (?, ?, 'acceptee', datetime('now'))").run(cand.lastInsertRowid, pre2.id);
  base.prepare(
    "INSERT INTO avis (candidature_id, auteur_id, vise_id, note, commentaire) "
    + "VALUES (?, ?, ?, 5, 'Travail impeccable du debut a la fin.')")
    .run(rep.lastInsertRowid, emp.id, pre2.id);

  const recherche = await (await lire("/recherche?metier=menagere", emp.cookie)).text();
  dire("la personne notée reste devant",
       recherche.indexOf("Test pre2") < recherche.indexOf("Test pre<")
       || !recherche.includes("Test pre<"));
  dire("aucun badge de mise en avant n'apparaît dans la recherche",
       !recherche.includes("Mise en avant"));

  const supprimes = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?")
    .run("%" + M + "%").changes;
  console.log("  ----- | nettoyage : " + supprimes + " comptes de test supprimés");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 500);
