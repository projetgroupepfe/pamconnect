// Série : la messagerie entre un employeur et un candidat.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-messagerie";
let ok = 0, ko = 0;

const dire = (nom, cond, detail) => {
  if (cond) { ok++; console.log("  OK    | " + nom); }
  else { ko++; console.log("  ECHEC | " + nom + (detail ? "   -> " + detail : "")); }
};

const form = (o) => new URLSearchParams(o);
const lire = (chemin, cookie) =>
  fetch(RACINE + chemin, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });

async function poster(chemin, corps, cookie) {
  const entetes = {};
  if (cookie) entetes.Cookie = cookie;
  const r = await fetch(RACINE + chemin, { method: "POST", body: corps, headers: entetes, redirect: "manual" });
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
  console.log("\n--- MISE EN PLACE ---");
  const emp = await creerCompte("e1", "employeur");
  const pre = await creerCompte("p1", "prestataire", { metier: "MetierMsg", tarif: "15000" });
  const autreEmp = await creerCompte("e2", "employeur");
  const autrePre = await creerCompte("p2", "prestataire", { metier: "MetierMsg", tarif: "9000" });

  // Publier une demande ET y repondre exigent une identite verifiee.
  // Ce n'est pas le sujet de cette serie : on la donne a tous les
  // comptes qu'elle cree.
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' "
    + "WHERE email LIKE ?").run("%" + M + "%");

  await poster("/annonces", form({ titre: M + " ménage", metier: "MetierMsg",
    quartier: "Mvan", horaire: "Lundi 8h", prix: "10000",
    unite_tarif: "journalier", duree_estimee: "environ 4 heures",
    conditions: "Il y a un chien." }), emp.cookie);
  const annonce = base.prepare("SELECT id FROM annonces WHERE titre LIKE ? ORDER BY id DESC LIMIT 1").get("%" + M + "%");
  await poster("/candidatures", form({ annonceId: String(annonce.id) }), pre.cookie);
  const conv = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ?").get(annonce.id);
  dire("une candidature ouvre une conversation", Boolean(conv));

  console.log("\n--- QUI PEUT LIRE LA CONVERSATION ---");
  dire("l'employeur concerné", (await lire("/messages/" + conv.id, emp.cookie)).status === 200);
  dire("la personne concernée", (await lire("/messages/" + conv.id, pre.cookie)).status === 200);
  dire("un autre employeur est refusé", (await lire("/messages/" + conv.id, autreEmp.cookie)).status === 403);
  dire("une autre candidate est refusée", (await lire("/messages/" + conv.id, autrePre.cookie)).status === 403);
  dire("un visiteur non connecté est renvoyé", (await lire("/messages/" + conv.id)).status === 302);
  dire("une conversation inexistante répond 403", (await lire("/messages/999999", emp.cookie)).status === 403);

  // L'equipe verifie des identites ; elle n'a aucune raison de lire les
  // conversations privees. Elle examinera les messages SIGNALES.
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE email = ?").run(autreEmp.mail);
  dire("un membre de l'équipe n'y accède pas non plus",
       (await lire("/messages/" + conv.id, autreEmp.cookie)).status === 403);

  console.log("\n--- ÉCRIRE ---");
  await poster("/messages/" + conv.id, form({ texte: "Bonjour, êtes-vous libre lundi à 8h ?" }), emp.cookie);
  const compte = () => base.prepare("SELECT COUNT(*) n FROM messages WHERE candidature_id = ?").get(conv.id).n;
  dire("le message est enregistré", compte() === 1);

  const vide = await poster("/messages/" + conv.id, form({ texte: "   " }), emp.cookie);
  dire("un message vide est ignoré", compte() === 1, "code " + vide.code);

  const long = await poster("/messages/" + conv.id, form({ texte: "a".repeat(2001) }), emp.cookie);
  dire("un message de plus de 2000 caractères est refusé", long.code === 400 && compte() === 1);

  const intrus = await poster("/messages/" + conv.id, form({ texte: "je m'invite" }), autrePre.cookie);
  dire("un tiers ne peut pas écrire", intrus.code === 403 && compte() === 1);

  console.log("\n--- LE PAIEMENT HORS PLATEFORME ---");
  const normaux = [
    "Je peux faire 12 000 FCFA au lieu de 15 000.",
    "Votre horaire me convient, je suis disponible le lundi.",
  ];
  const risques = [
    "Envoie-moi l'argent par MoMo",
    "appelle moi au 677 45 12 89",
    "on peut payer en espèces avant la prestation",
    "payez par Orange Money directement",
    "sans passer par le site ce sera moins cher",
  ];
  for (const texte of normaux) {
    await poster("/messages/" + conv.id, form({ texte }), pre.cookie);
    const m = base.prepare("SELECT risque_paiement FROM messages WHERE candidature_id = ? ORDER BY id DESC LIMIT 1").get(conv.id);
    dire("négociation normale, pas d'alerte : " + texte.slice(0, 30), m.risque_paiement === 0);
  }
  for (const texte of risques) {
    await poster("/messages/" + conv.id, form({ texte }), pre.cookie);
    const m = base.prepare("SELECT risque_paiement FROM messages WHERE candidature_id = ? ORDER BY id DESC LIMIT 1").get(conv.id);
    dire("alerte levée : " + texte.slice(0, 30), m.risque_paiement === 1);
  }

  const page = await (await lire("/messages/" + conv.id, emp.cookie)).text();
  dire("l'avertissement est affiché", page.includes("ne payez pas directement"));
  dire("aucun message n'a été bloqué ni effacé", compte() === 1 + normaux.length + risques.length);

  console.log("\n--- SIGNALER ---");
  const sien = base.prepare("SELECT id FROM messages WHERE candidature_id = ? AND auteur_id = (SELECT id FROM utilisateurs WHERE email = ?) LIMIT 1").get(conv.id, emp.mail);
  await poster("/messages/" + sien.id + "/signaler", form({ candidatureId: String(conv.id) }), emp.cookie);
  dire("on ne peut pas signaler son propre message",
       base.prepare("SELECT signale FROM messages WHERE id = ?").get(sien.id).signale === 0);

  const recu = base.prepare("SELECT id FROM messages WHERE candidature_id = ? AND auteur_id = (SELECT id FROM utilisateurs WHERE email = ?) LIMIT 1").get(conv.id, pre.mail);
  await poster("/messages/" + recu.id + "/signaler", form({ candidatureId: String(conv.id) }), emp.cookie);
  dire("on peut signaler un message reçu",
       base.prepare("SELECT signale FROM messages WHERE id = ?").get(recu.id).signale === 1);

  console.log("\n--- NÉGOCIER LE TARIF ---");
  console.log("\n--- REPONDRE : L'ECRAN DE CONFIRMATION ---");

  // La liste sert a CHOISIR une annonce : le tarif, identique pour
  // toutes, n'y aide pas. Il est montre au moment de s'engager.
  const listeSansTarif = await (await lire("/annonces", pre.cookie)).text();
  dire("la liste ne montre plus de tableau de tarif",
       !listeSansTarif.includes("Vous demandez"));
  dire("le bouton mene a un ecran de confirmation",
       listeSansTarif.includes("/candidatures/nouvelle/"));

  const confirmation = await lire("/candidatures/nouvelle/" + annonce.id, pre.cookie);
  const pageConf = await confirmation.text();
  dire("l'ecran de confirmation s'ouvre", confirmation.status === 200);
  dire("il rappelle de quelle annonce il s'agit", pageConf.includes(M + " ménage"));
  dire("il montre le prix annonce", pageConf.includes("10 000 FCFA par jour"));
  dire("il montre la commission", pageConf.includes("Commission PamConnect"));
  dire("il montre ce que la personne touchera", pageConf.includes("9 000 FCFA"));

  dire("un employeur n'y a pas acces",
       (await lire("/candidatures/nouvelle/" + annonce.id, emp.cookie)).status === 403);
  dire("une annonce inexistante repond 404",
       (await lire("/candidatures/nouvelle/999999", pre.cookie)).status === 404);
  dire("sans etre connecte, on est renvoye",
       (await lire("/candidatures/nouvelle/" + annonce.id)).status === 302);

  console.log("\n--- LE BUDGET DE L'EMPLOYEUR ---");
  const laAnnonce = base.prepare("SELECT * FROM annonces WHERE id = ?").get(annonce.id);
  dire("le prix est enregistre", laAnnonce.prix === 10000, String(laAnnonce.prix));
  dire("l'unite aussi", laAnnonce.unite_tarif === "journalier", laAnnonce.unite_tarif);
  dire("la duree et les conditions aussi",
       laAnnonce.duree_estimee === "environ 4 heures" && laAnnonce.conditions === "Il y a un chien.");

  const listeAnnonces = await (await lire("/annonces", pre.cookie)).text();
  dire("la candidate voit le prix dans la liste", listeAnnonces.includes("10 000 FCFA par jour"));
  dire("elle voit aussi les conditions", listeAnnonces.includes("Il y a un chien"));

  const convBudget = await (await lire("/messages/" + conv.id, pre.cookie)).text();
  dire("et le prix dans la discussion", convBudget.includes("10 000 FCFA"));

  // Une unite inventee ne doit pas atteindre la base.
  await poster("/annonces", form({ titre: M + " triche", metier: "MetierMsg",
    quartier: "Mvan", horaire: "x", prix: "5000", unite_tarif: "gratuit" }), emp.cookie);
  dire("une unite inconnue est ramenée à la valeur par défaut",
       base.prepare("SELECT unite_tarif FROM annonces ORDER BY id DESC LIMIT 1").get().unite_tarif === "forfaitaire");

  const negatif = await poster("/annonces", form({ titre: M + " neg", metier: "MetierMsg",
    quartier: "Mvan", horaire: "x", prix: "-500" }), emp.cookie);
  dire("un prix négatif est refusé", negatif.code === 400, "code " + negatif.code);

  // Le prix est desormais OBLIGATOIRE : c'est lui qui sera paye, et une
  // demande sans prix obligerait a negocier.
  const sansPrix = await poster("/annonces", form({ titre: M + " libre", metier: "MetierMsg",
    quartier: "Mvan", horaire: "x" }), emp.cookie);
  dire("publier sans prix est refusé", sansPrix.code === 400, "code " + sansPrix.code);

  // La negociation a disparu avec le changement de modele : c'est
  // l'employeur qui annonce le prix, la personne postule ou repond
  // ailleurs. Le formulaire de proposition n'existe plus, et les tests
  // qui le verifiaient non plus.
  const vuePre = await (await lire("/messages/" + conv.id, pre.cookie)).text();
  const vueEmp = await (await lire("/messages/" + conv.id, emp.cookie)).text();

  dire("aucun formulaire de tarif, d'aucun cote",
       !vuePre.includes('name="tarif"') && !vueEmp.includes('name="tarif"'));
  dire("la route de negociation n'existe plus",
       (await poster("/messages/" + conv.id + "/tarif", form({ tarif: "1000" }), pre.cookie)).code === 404);

  // Le prix de l'annonce est rappele des deux cotes, avec la commission.
  dire("la personne lit le prix annonce", vuePre.includes("10 000 FCFA"));
  dire("et d'ou il vient", vuePre.includes("prix annoncé par"));
  dire("l'employeur reconnait son propre prix", vueEmp.includes("le prix que vous avez annoncé"));
  dire("le calcul est le meme des deux cotes",
       vuePre.includes("Commission PamConnect") && vueEmp.includes("Commission PamConnect"));

  console.log("\n--- LES DEUX CÔTÉS ONT LE BOUTON ---");
  dire("l'employeur voit 'Discuter' sur ses demandes",
       (await (await lire("/mes-demandes", emp.cookie)).text()).includes("/messages/" + conv.id));
  dire("la personne aussi, sur ses reponses",
       (await (await lire("/mes-reponses", pre.cookie)).text()).includes("/messages/" + conv.id));

  console.log("\n--- NETTOYAGE ---");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimés");
  const restants = base.prepare("SELECT COUNT(*) n FROM messages WHERE candidature_id = ?").get(conv.id).n;
  console.log("  messages restants après suppression : " + restants + " (la cascade a fait son travail)");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
