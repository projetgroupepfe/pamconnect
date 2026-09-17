// Série : signaler un problème au support, sans viser un message.
//
// Le seul signalement possible visait un message précis. Les vrais
// problèmes n'ont souvent aucun message à montrer : la personne n'est
// pas venue, les conditions ont changé sur place, on lui a proposé de
// payer hors plateforme au téléphone.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-probleme";
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

  // Publier exige une identite verifiee. Ce n'est pas le sujet ici.
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email = ?")
    .run(mail.toLowerCase());

  return { mail, cookie: c.cookie, id: base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(mail).id };
}

setTimeout(async () => {
  const emp = await creerCompte("emp", "employeur");
  const pre = await creerCompte("pre", "prestataire", { metier: "menagere", tarif: "15000" });
  const eq = await creerCompte("eq", "employeur");
  const tiers = await creerCompte("tiers", "prestataire", { metier: "menagere", tarif: "12000" });
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE email = ?").run(eq.mail);

  await poster("/annonces", form({ titre: M + " demande", metier: "menagere",
    quartier: "Mvan", horaire: "Lundi 8h", prix: "10000" }), emp.cookie);
  const annonce = base.prepare("SELECT id FROM annonces WHERE titre LIKE ? ORDER BY id DESC LIMIT 1").get("%" + M + "%");
  await poster("/candidatures", form({ annonceId: String(annonce.id) }), pre.cookie);
  const conv = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ?").get(annonce.id);

  const compter = () => base.prepare(
    "SELECT COUNT(*) n FROM problemes WHERE candidature_id = ?").get(conv.id).n;

  console.log("\n--- QUI PEUT SIGNALER ---");
  dire("la personne qui a repondu", (await lire("/probleme/" + conv.id, pre.cookie)).status === 200);
  dire("l'employeur aussi", (await lire("/probleme/" + conv.id, emp.cookie)).status === 200);
  dire("un tiers ne voit rien", (await lire("/probleme/" + conv.id, tiers.cookie)).status === 404);
  dire("un visiteur est renvoye", (await lire("/probleme/" + conv.id)).status === 302);
  dire("et un tiers ne peut rien envoyer non plus",
       (await poster("/probleme/" + conv.id, form({ texte: "Je veux nuire a quelqu'un." }), tiers.cookie)).code === 404);
  dire("rien n'a ete enregistre", compter() === 0);

  console.log("\n--- L'ECRAN DIT QUI EST VISE, ET PARLE AU BON ROLE ---");
  // "Avec X" decrivait la discussion, pas la cible du signalement.
  // Et la phrase parlait de "votre candidature" a tout le monde, alors
  // qu'un employeur n'en a pas : il a une demande.
  const vuPre = await (await lire("/probleme/" + conv.id, pre.cookie)).text();
  const vuEmp = await (await lire("/probleme/" + conv.id, emp.cookie)).text();

  dire("la personne qui travaille voit qui elle signale",
       vuPre.includes("Personne concernée") && vuPre.includes("Test emp"));
  dire("et l'employeur aussi",
       vuEmp.includes("Personne concernée") && vuEmp.includes("Test pre"));

  dire("on parle de candidature a celle qui a postule",
       vuPre.includes("votre candidature") && !vuPre.includes("votre demande"));
  dire("et de demande a l'employeur",
       vuEmp.includes("votre demande") && !vuEmp.includes("votre candidature"));

  dire("l'ecran nomme la personne que l'equipe pourra sanctionner",
       vuPre.includes("avertissement à Test emp"));

  console.log("\n--- ON N'ALERTE PAS L'EQUIPE AVEC TROIS MOTS ---");
  const court = await poster("/probleme/" + conv.id, form({ texte: "court" }), pre.cookie);
  dire("un texte trop court est refuse", court.code === 400, "code " + court.code);
  dire("et rien n'est enregistre", compter() === 0);

  console.log("\n--- LE SIGNALEMENT ARRIVE A L'EQUIPE ---");
  const TEXTE = M + " elle n'est pas venue lundi et ne repond plus";
  // EJS echappe l'apostrophe en &#39; : chercher le texte brut dans la
  // page echouerait sur un texte pourtant present. On garde donc un
  // fragment qui n'en contient pas.
  const FRAGMENT = "pas venue lundi et ne repond plus";
  const envoi = await poster("/probleme/" + conv.id, form({ texte: TEXTE }), pre.cookie);
  dire("le signalement est accepte", envoi.code === 200, "code " + envoi.code);
  dire("on confirme a la personne que sa discussion reste ouverte",
       envoi.corps.includes("reste ouverte"));

  const p = base.prepare("SELECT * FROM problemes WHERE candidature_id = ?").get(conv.id);
  dire("l'auteur est celui qui a ecrit", p.auteur_id === pre.id);
  // La personne visee est DEDUITE de la discussion, jamais choisie dans
  // le formulaire : on ne signale pas quelqu'un avec qui on n'a rien.
  dire("la personne visee est l'autre cote de la discussion", p.vise_id === emp.id);
  dire("le texte est conserve tel quel", p.texte === TEXTE);
  dire("aucune decision n'est prise d'avance", p.decision === null);

  console.log("\n--- UN SEUL SIGNALEMENT OUVERT A LA FOIS ---");
  const second = await poster("/probleme/" + conv.id, form({ texte: TEXTE + " encore" }), pre.cookie);
  dire("un second envoi est refuse", second.code === 409, "code " + second.code);
  dire("il n'y en a toujours qu'un", compter() === 1);
  dire("le formulaire le dit aussi",
       (await (await lire("/probleme/" + conv.id, pre.cookie)).text()).includes("déjà signalé"));
  // L'AUTRE cote garde son droit de signaler : le blocage vise les
  // doublons d'une meme personne, pas la discussion entiere.
  dire("l'autre personne peut signaler de son cote",
       (await poster("/probleme/" + conv.id, form({ texte: M + " il a change les conditions sur place" }), emp.cookie)).code === 200);

  console.log("\n--- CE QUE L'EQUIPE VOIT ---");
  dire("un employeur ne peut pas ouvrir la page", (await lire("/admin/problemes", emp.cookie)).status === 403);
  dire("une personne qui travaille non plus", (await lire("/admin/problemes", pre.cookie)).status === 403);
  const liste = await (await lire("/admin/problemes", eq.cookie)).text();
  dire("l'equipe lit le texte entier", liste.includes(FRAGMENT));
  dire("elle voit qui a ecrit", liste.includes("Test pre"));
  dire("elle voit qui est signale", liste.includes("Test emp"));
  dire("et la demande concernee", liste.includes(M + " demande"));
  const accueil = await (await lire("/admin", eq.cookie)).text();
  dire("l'espace equipe annonce le nombre en attente", accueil.includes("Problèmes signalés (2)"));

  console.log("\n--- LES TROIS DECISIONS ---");
  const sansMotif = await poster("/admin/problemes/" + p.id,
    form({ decision: "avertissement", motif: "   " }), eq.cookie);
  dire("avertir sans motif est refuse", sansMotif.code === 400, "code " + sansMotif.code);
  dire("le signalement reste ouvert",
       base.prepare("SELECT decision FROM problemes WHERE id = ?").get(p.id).decision === null);

  await poster("/admin/problemes/" + p.id,
    form({ decision: "avertissement", motif: "ne pas annuler sans prevenir" }), eq.cookie);
  const vise = base.prepare("SELECT * FROM utilisateurs WHERE id = ?").get(emp.id);
  dire("l'avertissement atteint la personne visee", vise.avertissements === 1);
  dire("avec son motif", vise.avertissement_motif === "ne pas annuler sans prevenir");
  dire("son compte n'est pas suspendu", vise.suspendu === 0);
  dire("le signalement est classe",
       base.prepare("SELECT decision FROM problemes WHERE id = ?").get(p.id).decision === "avertissement");
  dire("il quitte la liste de l'equipe",
       !(await (await lire("/admin/problemes", eq.cookie)).text()).includes(FRAGMENT));
  dire("une decision prise ne se rejuge pas",
       (await poster("/admin/problemes/" + p.id, form({ decision: "rien" }), eq.cookie)).code === 409);

  // Le signalement traite libere la voie : la personne peut en ecrire un
  // nouveau si le probleme recommence.
  dire("un nouveau signalement redevient possible",
       (await poster("/probleme/" + conv.id, form({ texte: M + " le probleme a recommence" }), pre.cookie)).code === 200);

  console.log("\n--- CLASSER SANS SUITE NE TOUCHE PERSONNE ---");
  const p2 = base.prepare(
    "SELECT * FROM problemes WHERE candidature_id = ? AND decision IS NULL ORDER BY id DESC LIMIT 1").get(conv.id);
  const avant = base.prepare("SELECT avertissements FROM utilisateurs WHERE id = ?").get(emp.id).avertissements;
  await poster("/admin/problemes/" + p2.id, form({ decision: "rien" }), eq.cookie);
  dire("le signalement est classe",
       base.prepare("SELECT decision FROM problemes WHERE id = ?").get(p2.id).decision === "rien");
  dire("aucun avertissement n'a ete ajoute",
       base.prepare("SELECT avertissements FROM utilisateurs WHERE id = ?").get(emp.id).avertissements === avant);

  console.log("\n--- LE LIEN EXISTE DANS LA DISCUSSION ---");
  const discussion = await (await lire("/messages/" + conv.id, pre.cookie)).text();
  dire("la discussion mene au support", discussion.includes("/probleme/" + conv.id));
  dire("et le dit avec des mots simples", discussion.includes("Signaler à l"));

  console.log("\n--- NETTOYAGE ---");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
