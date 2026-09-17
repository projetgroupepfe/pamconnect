// Série : être prévenu qu'on a reçu un message.
//
// La plateforme n'envoie ni email ni SMS. La seule notification qu'elle
// peut donner, c'est le nombre de messages qui attendent, affiché là où
// la personne regarde déjà : dans son menu, sur toutes les pages.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-notif";
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
    { role, nom: "Test " + suffixe, email: mail, motdepasse: "motdepasse123", telephone: "600000000", quartier: "Bastos" },
    extra || {})));
  const c = await poster("/connexion", form({ email: mail, motdepasse: "motdepasse123", telephone: "600000000" }));
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email = ?")
    .run(mail.toLowerCase());
  return { mail, cookie: c.cookie };
}

// Le nombre affiche dans le menu, quelle que soit la page ouverte.
function pastilleDe(html) {
  const m = html.match(/class="pastille"[^>]*>(\d+)</);
  return m ? Number(m[1]) : 0;
}
const pastilleSur = async (chemin, cookie) => pastilleDe(await (await lire(chemin, cookie)).text());

setTimeout(async () => {
  const emp = await creerCompte("emp", "employeur");
  const pre = await creerCompte("pre", "prestataire", { metier: "menagere", tarif: "15000" });
  const eq = await creerCompte("eq", "employeur");
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE email = ?").run(eq.mail);

  await poster("/annonces", form({ titre: M + " demande", metier: "menagere",
    quartier: "Mvan", horaire: "Lundi 8h", prix: "10000" }), emp.cookie);
  const annonce = base.prepare("SELECT id FROM annonces WHERE titre LIKE ? ORDER BY id DESC LIMIT 1").get("%" + M + "%");
  await poster("/candidatures", form({ annonceId: String(annonce.id) }), pre.cookie);
  const conv = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ?").get(annonce.id);

  console.log("\n--- AU DEPART, RIEN N'ATTEND ---");
  dire("aucune pastille pour la personne", await pastilleSur("/annonces", pre.cookie) === 0);
  dire("aucune pour l'employeur", await pastilleSur("/annonces", emp.cookie) === 0);

  console.log("\n--- ON EST PREVENU SANS OUVRIR LA DISCUSSION ---");
  await poster("/messages/" + conv.id, form({ texte: M + " etes-vous libre lundi matin ?" }), emp.cookie);
  dire("la personne sollicitee le voit", await pastilleSur("/annonces", pre.cookie) === 1);
  // Ecrire n'est pas recevoir : personne ne doit etre notifie de son
  // propre message.
  dire("celui qui a ecrit ne se notifie pas lui-meme",
       await pastilleSur("/annonces", emp.cookie) === 0);

  await poster("/messages/" + conv.id, form({ texte: M + " deuxieme message" }), emp.cookie);
  dire("le compte suit le nombre de messages", await pastilleSur("/annonces", pre.cookie) === 2);

  console.log("\n--- LA PASTILLE SUIT SUR TOUTES LES PAGES ---");
  dire("sur l'accueil", await pastilleSur("/", pre.cookie) === 2);
  dire("sur son profil", await pastilleSur("/mon-profil", pre.cookie) === 2);
  dire("sur la liste des annonces", await pastilleSur("/annonces", pre.cookie) === 2);

  console.log("\n--- LA LISTE DIT LAQUELLE ATTEND ---");
  const liste = await (await lire("/messages", pre.cookie)).text();
  dire("la discussion concernee est signalee", liste.includes("nouveaux"));
  dire("avec le bon nombre", liste.includes("2 nouveaux"));

  console.log("\n--- OUVRIR, C'EST LIRE ---");
  const discussion = await (await lire("/messages/" + conv.id, pre.cookie)).text();
  // La page qui vient d'etre lue ne doit plus porter la pastille : sinon
  // l'entete contredit ce que la personne est en train de faire.
  dire("la pastille disparait sur la page meme", pastilleDe(discussion) === 0);
  dire("et sur la page suivante", await pastilleSur("/annonces", pre.cookie) === 0);
  dire("la date de lecture est enregistree",
       typeof base.prepare("SELECT vu_prestataire_le FROM candidatures WHERE id = ?")
         .get(conv.id).vu_prestataire_le === "string");
  dire("celle de l'autre cote reste vide",
       base.prepare("SELECT vu_employeur_le FROM candidatures WHERE id = ?")
         .get(conv.id).vu_employeur_le === null);

  console.log("\n--- CA MARCHE DANS LES DEUX SENS ---");
  await poster("/messages/" + conv.id, form({ texte: M + " oui je suis libre" }), pre.cookie);
  dire("l'employeur est prevenu a son tour", await pastilleSur("/annonces", emp.cookie) === 1);
  dire("et la personne n'a plus rien", await pastilleSur("/annonces", pre.cookie) === 0);
  await lire("/messages/" + conv.id, emp.cookie);
  dire("il lit, son compte retombe", await pastilleSur("/annonces", emp.cookie) === 0);

  console.log("\n--- ETRE PREVENU D'UNE DECISION ---");
  // Accepter quelqu'un ne cree aucun message : sans ce compte, une
  // personne choisie ne l'apprenait qu'en revenant regarder son profil.
  const emp2 = await creerCompte("emp2", "employeur");
  const c1 = await creerCompte("c1", "prestataire", { metier: "menagere", tarif: "15000" });
  const c2 = await creerCompte("c2", "prestataire", { metier: "menagere", tarif: "12000" });

  await poster("/annonces", form({ titre: M + " choix", metier: "menagere",
    quartier: "Mvan", horaire: "Mardi 9h", prix: "20000" }), emp2.cookie);
  const a2 = base.prepare("SELECT id FROM annonces WHERE titre = ? ORDER BY id DESC LIMIT 1").get(M + " choix");
  await poster("/candidatures", form({ annonceId: String(a2.id) }), c1.cookie);
  await poster("/candidatures", form({ annonceId: String(a2.id) }), c2.cookie);
  const cand1 = base.prepare(
    "SELECT c.id FROM candidatures c JOIN utilisateurs u ON u.id = c.prestataire_id "
    + "WHERE c.annonce_id = ? AND u.email = ?").get(a2.id, c1.mail);

  dire("avant la decision, rien n'attend", await pastilleSur("/annonces", c1.cookie) === 0);

  await poster("/candidatures/statut",
    form({ candidatureId: String(cand1.id), statut: "acceptee" }), emp2.cookie);

  dire("la personne choisie est prevenue", await pastilleSur("/annonces", c1.cookie) === 1);
  // Le cahier des charges demande une reponse a TOUS les candidats, pas
  // seulement a celui qui est retenu.
  dire("celle qui ne l'est pas aussi", await pastilleSur("/annonces", c2.cookie) === 1);
  // Celui qui prend la decision n'a pas a etre prevenu de son propre choix.
  dire("l'employeur ne se notifie pas lui-meme",
       await pastilleSur("/annonces", emp2.cookie) === 0);

  const listeChoisie = await (await lire("/messages", c1.cookie)).text();
  // Le nom de l'employeur figure deja en tete de la carte : le repeter
  // dans la ligne d'etat n'apprenait rien de plus.
  dire("la liste dit qu'elle est acceptee",
       listeChoisie.includes("Votre candidature a été acceptée"));
  dire("et la carte porte deja le nom de l'employeur",
       listeChoisie.includes("Test emp2"));
  const listeRefusee = await (await lire("/messages", c2.cookie)).text();
  // EJS echappe l'apostrophe : on cherche un fragment qui n'en a pas.
  // UN REFUS AUTOMATIQUE N'EST PAS UN REFUS PERSONNEL : l'employeur a
  // choisi c1, il n'a ecarte c2 par aucun geste. La liste dit donc la
  // meme chose que la page des reponses, sinon deux ecrans racontent
  // deux histoires du meme fait.
  dire("et dit a l'autre que quelqu un d autre a ete choisi",
       listeRefusee.includes("employeur a choisi une autre personne"));
  dire("sans lui parler d un refus",
       !listeRefusee.includes("a refusé votre candidature"));

  // La phrase ne suppose aucun genre : "Votre candidature" est feminin
  // quel que soit le genre de la personne, que la plateforme ignore.
  dire("aucun genre n'est suppose",
       !listeChoisie.includes("choisie</strong>") && !listeChoisie.includes("choisi</strong>"));

  await lire("/messages/" + cand1.id, c1.cookie);
  dire("ouvrir la discussion eteint la pastille",
       await pastilleSur("/annonces", c1.cookie) === 0);
  dire("mais la decision reste lisible",
       (await (await lire("/messages", c1.cookie)).text()).includes("acceptée"));

  // Les deux sortes se cumulent : un message ET une decision.
  //
  // L'attente n'est pas un caprice : les dates sont a la seconde pres, et
  // ce test ouvre la discussion puis ecrit dans la foulee. Sans elle, le
  // message porterait la meme seconde que la lecture et ne compterait
  // pas. Un humain ne rencontre jamais ce cas.
  await new Promise(function (suite) { setTimeout(suite, 1100); });
  await poster("/messages/" + cand1.id, form({ texte: M + " a lundi" }), emp2.cookie);
  dire("un message apres la decision rallume", await pastilleSur("/annonces", c1.cookie) === 1);

  console.log("\n--- QUAND LA DEMANDE DISPARAIT ---");
  // Retirer une demande ne changeait rien du cote de la personne qui y
  // avait repondu : sa candidature restait "en attente", pour toujours.
  // Elle guettait une decision qui ne viendrait jamais.
  const empD = await creerCompte("empD", "employeur");
  const preD = await creerCompte("preD", "prestataire", { metier: "menagere", tarif: "15000" });

  await poster("/annonces", form({ titre: M + " disparue", metier: "menagere",
    quartier: "Mvan", horaire: "Lundi 8h", prix: "9000" }), empD.cookie);
  const aD = base.prepare("SELECT id FROM annonces WHERE titre = ? ORDER BY id DESC LIMIT 1").get(M + " disparue");
  await poster("/candidatures", form({ annonceId: String(aD.id) }), preD.cookie);
  const cD = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ?").get(aD.id);

  // Elle ouvre sa discussion : tout est a jour pour elle.
  await lire("/messages/" + cD.id, preD.cookie);
  dire("sa candidature attend une decision",
       (await (await lire("/mes-reponses", preD.cookie)).text()).includes("Votre candidature est en attente"));
  dire("et rien ne l'attend", await pastilleSur("/annonces", preD.cookie) === 0);

  // Les dates sont a la seconde pres : sans cette attente, le retrait
  // porterait la meme seconde que sa derniere visite.
  await new Promise(function (suite) { setTimeout(suite, 1100); });
  await poster("/annonces/" + aD.id + "/annuler", form({}), empD.cookie);

  const profilD = await (await lire("/mes-reponses", preD.cookie)).text();
  dire("elle apprend que la demande a ete retiree",
       profilD.includes("a retiré cette demande"));
  dire("et ne lit plus qu'elle attend",
       !profilD.includes("Votre candidature est en attente"));
  // Sans la pastille, il faudrait revenir verifier tous les jours.
  dire("la pastille l'avertit", await pastilleSur("/annonces", preD.cookie) === 1);
  const listeD = await (await lire("/messages", preD.cookie)).text();
  dire("la liste marque la nouveaute", listeD.includes("Nouveau"));
  dire("et dit ce qui s'est passe", listeD.includes("a retiré cette demande"));

  await lire("/messages/" + cD.id, preD.cookie);
  dire("une fois lue, la pastille retombe", await pastilleSur("/annonces", preD.cookie) === 0);
  dire("mais l'information reste lisible",
       (await (await lire("/mes-reponses", preD.cookie)).text()).includes("a retiré cette demande"));
  // Rien n'est efface : la discussion et l'annonce restent consultables.
  dire("sa discussion reste accessible",
       (await lire("/messages/" + cD.id, preD.cookie)).status === 200);
  dire("et sa candidature n'a pas ete refusee de force",
       base.prepare("SELECT statut FROM candidatures WHERE id = ?").get(cD.id).statut === "en attente");

  // L'employeur, lui, n'a rien a apprendre : c'est lui qui a retire.
  dire("l'employeur n'est pas notifie de son propre retrait",
       await pastilleSur("/annonces", empD.cookie) === 0);

  console.log("\n--- CE QUI NE CONCERNE PAS L'EQUIPE ---");
  // Un membre de l'equipe n'a aucune discussion : la base n'est meme pas
  // interrogee pour lui.
  dire("l'equipe n'a pas de pastille", await pastilleSur("/admin", eq.cookie) === 0);
  dire("un visiteur non connecte non plus", await pastilleSur("/", null) === 0);

  console.log("\n--- LE CHAMP NOMME LE DESTINATAIRE ---");
  const vuEmp = await (await lire("/messages/" + conv.id, emp.cookie)).text();
  const vuPre = await (await lire("/messages/" + conv.id, pre.cookie)).text();
  dire("l'employeur ecrit a la personne", vuEmp.includes("Écrire à Test pre"));
  dire("et la personne ecrit a l'employeur", vuPre.includes("Écrire à Test emp"));
  dire("plus de 'Votre message' sans destinataire", !vuEmp.includes(">Votre message<"));

  console.log("\n--- NETTOYAGE ---");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
