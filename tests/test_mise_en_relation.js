// Série : l'équipe met en relation, puis note le paiement.
//
// C'est le circuit demandé par l'encadrement professionnel. Le prix vient
// de la personne qui fera le travail ; la plateforme y ajoute sa
// commission, et c'est ce montant que l'employeur entend. Après le
// service, l'employeur paie PamConnect, qui reverse.
//
// Ce que cette série surveille le plus : la personne reçoit EXACTEMENT
// le prix qu'elle a annoncé. La commission s'ajoute par-dessus, elle ne
// lui est jamais retirée.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-relation";
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

setTimeout(async () => {
  const emp = await creerCompte("emp", "employeur");
  const pre = await creerCompte("pre", "prestataire", { metier: "menagere", tarif: "20000" });
  const pre2 = await creerCompte("pre2", "prestataire", { metier: "menagere", tarif: "15000" });
  const eq = await creerCompte("eq", "employeur");
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE email = ?").run(eq.mail.toLowerCase());
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email LIKE ?")
    .run("%" + M + "%");

  await poster("/annonces", form({ titre: M + " demande", metier: "menagere",
    quartier: "Bastos", arrondissement: "Yaounde 1", horaire: "Lundi 8h",
    budget: "12000" }), emp.cookie);
  const annonce = base.prepare(
    "SELECT id FROM annonces WHERE titre = ? ORDER BY id DESC LIMIT 1").get(M + " demande");

  console.log("\n--- 1. L'ECRAN DE L'EQUIPE ---");
  const refuse = await lire("/admin/mises-en-relation", emp.cookie);
  dire("un employeur n'y entre pas", refuse.status === 403, "code " + refuse.status);

  let ecran = await (await lire("/admin/mises-en-relation", eq.cookie)).text();
  dire("la demande y apparaît", ecran.includes(M + " demande"));
  dire("le budget est montré à l'équipe", ecran.includes("12 000"));
  dire("le numéro de l'employeur est appelable", ecran.includes('href="tel:+237600000000"'));
  dire("les prestataires du métier sont proposés", ecran.includes("Test pre"));

  // Le budget ne sort pas de cet ecran : la personne qui repond ne le
  // voit nulle part.
  const listePublique = await (await lire("/annonces", pre.cookie)).text();
  dire("le budget ne sort pas de l'espace équipe", !listePublique.includes("12 000"));

  console.log("\n--- 2. PREMIER APPEL : LE PRIX DE LA PERSONNE ---");
  const trop = await poster("/admin/mises-en-relation",
    form({ annonceId: String(annonce.id), prestataireId: String(pre.id), prix: "7750" }), eq.cookie);
  dire("un prix hors tranches est refusé", trop.code === 400, "code " + trop.code);

  const pose = await poster("/admin/mises-en-relation",
    form({ annonceId: String(annonce.id), prestataireId: String(pre.id), prix: "10000" }), eq.cookie);
  dire("le prix annoncé est enregistré", pose.code === 302, "code " + pose.code);

  const fiche = base.prepare(
    "SELECT * FROM mises_en_relation WHERE annonce_id = ? ORDER BY id DESC LIMIT 1").get(annonce.id);
  dire("la fiche garde le prix de la personne", fiche && fiche.prix_prestataire === 10000,
       String(fiche && fiche.prix_prestataire));
  dire("la commission est de 10 %", fiche && fiche.commission === 1000,
       String(fiche && fiche.commission));
  dire("l'employeur entendra le prix commission comprise", fiche && fiche.prix_employeur === 11000,
       String(fiche && fiche.prix_employeur));
  dire("la fiche attend la réponse de l'employeur", fiche && fiche.statut === "en cours");

  const double = await poster("/admin/mises-en-relation",
    form({ annonceId: String(annonce.id), prestataireId: String(pre2.id), prix: "9000" }), eq.cookie);
  dire("un second prix est refusé tant que l'employeur n'a pas répondu",
       double.code === 409, "code " + double.code);

  ecran = await (await lire("/admin/mises-en-relation", eq.cookie)).text();
  dire("l'écran annonce le montant à dire à l'employeur", ecran.includes("11 000"));

  console.log("\n--- 3. DEUXIEME APPEL : L'EMPLOYEUR REFUSE ---");
  const refus = await poster("/admin/mises-en-relation/" + fiche.id + "/reponse",
    form({ decision: "refuse", note: "Trop cher pour lui" }), eq.cookie);
  dire("le refus est noté", refus.code === 302, "code " + refus.code);

  const apresRefus = base.prepare("SELECT * FROM mises_en_relation WHERE id = ?").get(fiche.id);
  dire("la fiche garde la trace du refus", apresRefus.statut === "refusee");
  dire("la date de l'appel est gardée", Boolean(apresRefus.appel_employeur_le));

  const encore = await poster("/admin/mises-en-relation/" + fiche.id + "/reponse",
    form({ decision: "accepte" }), eq.cookie);
  dire("une fiche conclue ne se rejuge pas", encore.code === 409, "code " + encore.code);

  const toujoursOuverte = base.prepare("SELECT annulee FROM annonces WHERE id = ?").get(annonce.id);
  dire("la demande reste ouverte après un refus", toujoursOuverte.annulee === 0);

  ecran = await (await lire("/admin/mises-en-relation", eq.cookie)).text();
  dire("l'écran rappelle ce qui a déjà été refusé", ecran.includes("Déjà refusé"));

  console.log("\n--- 4. DEUXIEME ESSAI : L'EMPLOYEUR ACCEPTE ---");
  await poster("/admin/mises-en-relation",
    form({ annonceId: String(annonce.id), prestataireId: String(pre2.id), prix: "8000" }), eq.cookie);
  const fiche2 = base.prepare(
    "SELECT * FROM mises_en_relation WHERE annonce_id = ? AND statut = 'en cours'").get(annonce.id);

  const accord = await poster("/admin/mises-en-relation/" + fiche2.id + "/reponse",
    form({ decision: "accepte" }), eq.cookie);
  dire("l'accord est noté", accord.code === 302, "code " + accord.code);

  const retenue = base.prepare(
    "SELECT * FROM candidatures WHERE annonce_id = ? AND statut = 'acceptee'").get(annonce.id);
  dire("la personne est retenue, même sans avoir répondu", Boolean(retenue));
  dire("c'est bien la personne du deuxième appel", retenue && retenue.prestataire_id === pre2.id);

  const pourvue = base.prepare("SELECT annulee FROM annonces WHERE id = ?").get(annonce.id);
  dire("la demande quitte la liste publique", pourvue.annulee === 1);

  const messagerie = await (await lire("/messages", pre2.cookie)).text();
  dire("la discussion est ouverte entre les deux", messagerie.includes(M + " demande"));

  console.log("\n--- 5. LE PAIEMENT ---");
  let paiements = await (await lire("/admin/paiements", eq.cookie)).text();
  dire("le service attend son paiement", paiements.includes("À recevoir"));
  dire("le montant dû par l'employeur y est", paiements.includes("8 800"));

  const avantReception = await poster("/admin/paiements/" + fiche2.id + "/reverse",
    form({ montant: "8000", moyen: "Mobile Money" }), eq.cookie);
  dire("on ne reverse pas une somme qui n'est pas arrivée",
       avantReception.code === 409, "code " + avantReception.code);

  const sansMoyen = await poster("/admin/paiements/" + fiche2.id + "/recu",
    form({ montant: "8800", moyen: "Chèque" }), eq.cookie);
  dire("un moyen inconnu est refusé", sansMoyen.code === 400, "code " + sansMoyen.code);

  const recu = await poster("/admin/paiements/" + fiche2.id + "/recu",
    form({ montant: "8800", moyen: "Agence PamConnect" }), eq.cookie);
  dire("le paiement reçu est enregistré", recu.code === 302, "code " + recu.code);

  const deuxFois = await poster("/admin/paiements/" + fiche2.id + "/recu",
    form({ montant: "8800", moyen: "Agence PamConnect" }), eq.cookie);
  dire("il ne s'enregistre pas deux fois", deuxFois.code === 409, "code " + deuxFois.code);

  const reverse = await poster("/admin/paiements/" + fiche2.id + "/reverse",
    form({ montant: "8000", moyen: "Mobile Money" }), eq.cookie);
  dire("le reversement est enregistré", reverse.code === 302, "code " + reverse.code);

  const ligne = base.prepare("SELECT * FROM paiements WHERE mise_en_relation_id = ?").get(fiche2.id);
  dire("la trace garde les deux montants",
       ligne && ligne.montant_recu === 8800 && ligne.montant_reverse === 8000,
       ligne ? ligne.montant_recu + " / " + ligne.montant_reverse : "aucune ligne");
  dire("la différence est la commission", ligne && (ligne.montant_recu - ligne.montant_reverse) === 800);

  console.log("\n--- 6. CE QUE CHACUN VOIT DANS SON COMPTE ---");
  const comptePre = await (await lire("/mon-compte", pre2.cookie)).text();
  dire("la personne voit ce qu'elle a reçu", comptePre.includes("8 000"));
  dire("et rien ne lui est retiré", !comptePre.includes("Commission"));

  const compteEmp = await (await lire("/mon-compte", emp.cookie)).text();
  dire("l'employeur voit ce qu'il a payé", compteEmp.includes("8 800"));
  dire("et avec qui", compteEmp.includes("Test pre2"));

  const supprimes = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?")
    .run("%" + M + "%").changes;
  console.log("  ----- | nettoyage : " + supprimes + " comptes de test supprimés");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 500);
