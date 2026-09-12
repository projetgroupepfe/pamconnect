const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-embauche";
let ok = 0, ko = 0;

const dire = (nom, cond, detail) => {
  if (cond) { ok++; console.log("  OK    | " + nom); }
  else { ko++; console.log("  ECHEC | " + nom + (detail ? "   -> " + detail : "")); }
};

async function poster(chemin, corps, cookie) {
  const entetes = cookie ? { Cookie: cookie } : {};
  const r = await fetch(RACINE + chemin, { method: "POST", body: corps, headers: entetes, redirect: "manual" });
  const sc = r.headers.getSetCookie();
  return { code: r.status, corps: await r.text(), cookie: sc.length ? sc[0].split(";")[0] : null };
}
const lire = (chemin, cookie) =>
  fetch(RACINE + chemin, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
const form = (o) => new URLSearchParams(o);
const fichier = (nom, n, type) => new File([new Uint8Array(n)], nom, { type });

async function creerCompte(mail, role, extra) {
  await poster("/inscription", form(Object.assign(
    { role, nom: mail.split("@")[0], email: mail, motdepasse: "motdepasse123",
      arrondissement: "Yaounde 1", tarif: role === "prestataire" ? "10000" : "" },
    extra || {})));
  return (await poster("/connexion", form({ email: mail, motdepasse: "motdepasse123" }))).cookie;
}

setTimeout(async () => {
  const mailEmp = M + "-emp@example.com";
  const mailPres = M + "-pres@example.com";
  const mailAdmin = M + "-admin@example.com";

  const cEmp = await creerCompte(mailEmp, "employeur");
  const cPres = await creerCompte(mailPres, "prestataire", { metier: "MetierEmbauche" });
  const cAdmin = await creerCompte(mailAdmin, "employeur");
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE email = ?").run(mailAdmin);

  const qui = (mail) => base.prepare("SELECT * FROM utilisateurs WHERE email = ?").get(mail);

  // Le sujet de cette serie est la verification de la CANDIDATE.
  // L'employeur, lui, doit etre verifie pour pouvoir publier.
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' "
    + "WHERE email LIKE ?").run("%" + M + "%");

  await poster("/annonces", form({ titre: M + " annonce", metier: "MetierEmbauche",
    arrondissement: "Yaounde 1", quartier: "Bastos", horaire: "Lundi 8h-12h", prix: "10000" }), cEmp);
  const annonce = base.prepare("SELECT * FROM annonces WHERE titre LIKE ?").get("%" + M + "%");
  // REPONDRE EXIGE UNE IDENTITE VERIFIEE, comme publier. Cette serie
  // parle de ce qui vient APRES : un employeur qui voudrait choisir
  // quelqu'un dont le dossier n'est pas valide. Ce cas ne s'atteint plus
  // par le parcours normal, mais la regle du serveur existe toujours -
  // on la met donc a l'epreuve en ramenant la candidate a son etat de
  // depart, une fois sa reponse envoyee.
  await poster("/candidatures", form({ annonceId: annonce.id }), cPres);
  base.prepare("UPDATE utilisateurs SET statut_verification = 'non soumis' WHERE email = ?")
    .run(mailPres.toLowerCase());

  const candidature = base.prepare("SELECT * FROM candidatures WHERE annonce_id = ?").get(annonce.id);
  const statutCandidature = () =>
    base.prepare("SELECT statut FROM candidatures WHERE id = ?").get(candidature.id).statut;

  console.log("\n--- 1. Prestataire NON verifie : l'embauche est bloquee ---");
  dire("le prestataire est bien 'non soumis'", qui(mailPres).statut_verification === "non soumis");

  let profil = await (await lire("/mes-demandes", cEmp)).text();
  dire("l'employeur voit l'etat de verification du candidat",
       profil.includes("Identit&#233; non v&#233;rifi&#233;e") || profil.includes("Identité non vérifiée"));
  dire("aucune action d'acceptation proposee", !profil.includes('value="acceptee"'));
  dire("le refus reste possible", profil.includes('value="refusee"'));
  dire("un message explique pourquoi", profil.includes("aura") && profil.includes("rifi"));

  const force = await poster("/candidatures/statut",
    form({ candidatureId: candidature.id, statut: "acceptee" }), cEmp);
  dire("acceptation forcee hors formulaire -> 403", force.code === 403, "code " + force.code);
  dire("le message explique la regle", force.corps.includes("erification requise") || force.corps.includes("Verification requise"));
  dire("le statut n'a PAS bouge", statutCandidature() === "en attente", statutCandidature());

  console.log("\n--- 2. Les autres controles tiennent toujours ---");
  const inventee = await poster("/candidatures/statut",
    form({ candidatureId: candidature.id, statut: "peut-etre" }), cEmp);
  dire("decision inventee -> 400", inventee.code === 400, "code " + inventee.code);

  const autre = await poster("/candidatures/statut",
    form({ candidatureId: candidature.id, statut: "refusee" }), cAdmin);
  dire("un autre employeur ne peut pas decider -> 404", autre.code === 404, "code " + autre.code);
  dire("le statut n'a pas bouge non plus", statutCandidature() === "en attente");

  console.log("\n--- 3. Apres verification, l'embauche devient possible ---");
  const envoi = new FormData();
  envoi.append("cni", fichier("cni.jpg", 1000, "image/jpeg"));
  envoi.append("casier", fichier("casier.pdf", 1000, "application/pdf"));
  await poster("/verification", envoi, cPres);

  profil = await (await lire("/mes-demandes", cEmp)).text();
  // On verifie l'absence du lien REEL vers l'ecran de confirmation, et
  // non celle d'un fragment de formulaire qui n'existe plus : une
  // assertion vraie parce que le texte cherche a disparu ne verifie rien.
  const lienChoisir = "/candidatures/" + candidature.id + "/confirmer";
  dire("en cours de verification : le choix reste impossible",
       !profil.includes(lienChoisir));
  dire("et l'ecran de confirmation lui-meme repond 403",
       (await lire(lienChoisir, cEmp)).status === 403);

  await poster("/admin/verification",
    form({ utilisateurId: qui(mailPres).id, decision: "valider" }), cAdmin);
  dire("le prestataire est maintenant verifie", qui(mailPres).statut_verification === "verifie");

  profil = await (await lire("/mes-demandes", cEmp)).text();
  dire("l'action de choix APPARAIT", profil.includes(lienChoisir));
  dire("et l'ecran de confirmation s'ouvre",
       (await lire(lienChoisir, cEmp)).status === 200);

  const acceptation = await poster("/candidatures/statut",
    form({ candidatureId: candidature.id, statut: "acceptee" }), cEmp);
  dire("l'acceptation passe (302)", acceptation.code === 302, "code " + acceptation.code);
  dire("statut = 'acceptee'", statutCandidature() === "acceptee", statutCandidature());

  console.log("\n--- NETTOYAGE ---");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 500);
