// Série : retirer une demande, et la confidentialité de l'âge.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-annuler";
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

  // Publier exige une identite verifiee. Ce n'est pas le sujet de cette
  // serie : on la donne ici, a la creation, plutot qu'en une ligne posee
  // plus haut - un employeur cree APRES cette ligne ne l'aurait pas eue,
  // sa publication aurait echoue en silence, et la serie aurait plante
  // en cherchant une annonce inexistante.
  //
  // L'inscription enregistre l'email EN MINUSCULES : chercher la casse
  // d'origine ne trouve rien.
  // LES DEUX ROLES. Publier exige une identite verifiee, et y repondre
  // aussi depuis que la reponse coute un jeton.
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email = ?")
    .run(mail.toLowerCase());

  return { mail, cookie: c.cookie };
}

setTimeout(async () => {
  const emp = await creerCompte("emp", "employeur");
  const autreEmp = await creerCompte("emp2", "employeur");
  const pre = await creerCompte("pre", "prestataire",
    { metier: "menagere", tarif: "15000", date_naissance: "1990-03-08" });
  const eq = await creerCompte("eq", "employeur");
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE email = ?").run(eq.mail);
  const idPre = base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(pre.mail).id;
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE id = ?").run(idPre);

  await poster("/annonces", form({ titre: M + " demande", metier: "menagere",
    quartier: "Mvan", horaire: "Lundi 8h", prix: "10000" }), emp.cookie);
  const a = base.prepare("SELECT id FROM annonces WHERE titre LIKE ? ORDER BY id DESC LIMIT 1").get("%" + M + "%");
  await poster("/candidatures", form({ annonceId: String(a.id) }), pre.cookie);
  const cand = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ?").get(a.id);
  await poster("/messages/" + cand.id, form({ texte: M + " un message echange" }), emp.cookie);

  console.log("\n--- LA TRANCHE D'AGE N'EST PAS PUBLIQUE ---");
  const AGE = "35 - 44 ans";
  dire("un visiteur ne la voit pas", !(await (await lire("/personnes/" + idPre)).text()).includes(AGE));
  dire("une autre personne qui travaille non plus",
       !(await (await lire("/personnes/" + idPre, pre.cookie)).text()).includes(AGE));
  dire("un employeur qui n'a pas embauche non plus",
       !(await (await lire("/personnes/" + idPre, autreEmp.cookie)).text()).includes(AGE));
  dire("l'employeur qui hesite encore non plus",
       !(await (await lire("/personnes/" + idPre, emp.cookie)).text()).includes(AGE));
  dire("l'equipe non plus",
       !(await (await lire("/personnes/" + idPre, eq.cookie)).text()).includes(AGE));
  dire("elle n'apparait pas dans la recherche",
       !(await (await lire("/recherche?metier=menage", emp.cookie)).text()).includes(AGE));
  dire("ni sur l'ecran de confirmation avant d'embaucher",
       !(await (await lire("/candidatures/" + cand.id + "/confirmer", emp.cookie)).text()).includes(AGE));

  console.log("\n--- ELLE APPARAIT APRES L'EMBAUCHE, POUR CET EMPLOYEUR SEUL ---");
  await poster("/candidatures/statut",
    form({ candidatureId: String(cand.id), statut: "acceptee" }), emp.cookie);
  dire("l'employeur qui a embauche la voit",
       (await (await lire("/personnes/" + idPre, emp.cookie)).text()).includes(AGE));
  dire("un autre employeur ne la voit toujours pas",
       !(await (await lire("/personnes/" + idPre, autreEmp.cookie)).text()).includes(AGE));
  dire("un visiteur non plus", !(await (await lire("/personnes/" + idPre)).text()).includes(AGE));
  dire("la date complete n'apparait jamais, pour personne",
       !(await (await lire("/personnes/" + idPre, emp.cookie)).text()).includes("1990-03-08"));
  dire("la personne voit son age sur son propre profil",
       (await (await lire("/mon-profil", pre.cookie)).text()).includes(AGE));

  console.log("\n--- RETIRER UNE DEMANDE : QUI PEUT ---");
  // Une demande a elle : la precedente vient d'etre pourvue par la
  // section ci-dessus, et une demande pourvue est deja fermee. Un test ne
  // doit pas dependre de l'etat laisse par celui d'avant.
  await poster("/annonces", form({ titre: M + " a retirer", metier: "menagere",
    quartier: "Mvan", horaire: "Vendredi 14h", prix: "10000" }), emp.cookie);
  const aRetirer = base.prepare("SELECT id FROM annonces WHERE titre LIKE ? ORDER BY id DESC LIMIT 1").get("%" + M + " a retirer%");
  await poster("/candidatures", form({ annonceId: String(aRetirer.id) }), pre.cookie);
  const candR = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ?").get(aRetirer.id);
  await poster("/messages/" + candR.id, form({ texte: M + " un message echange" }), emp.cookie);

  const url = "/annonces/" + aRetirer.id + "/annuler";
  dire("un autre employeur ne peut pas", (await poster(url, form({}), autreEmp.cookie)).code === 404);
  dire("une personne qui travaille non plus", (await poster(url, form({}), pre.cookie)).code === 404);
  dire("l'equipe non plus", (await poster(url, form({}), eq.cookie)).code === 403);
  dire("la demande est toujours active",
       base.prepare("SELECT annulee FROM annonces WHERE id = ?").get(aRetirer.id).annulee === 0);

  console.log("\n--- RETIRER : CE QUE CA FAIT ---");
  const retrait = await poster(url, form({}), emp.cookie);
  dire("le proprietaire y arrive", retrait.code === 200, "code " + retrait.code);
  const apres = base.prepare("SELECT * FROM annonces WHERE id = ?").get(aRetirer.id);
  dire("elle est marquee retiree", apres.annulee === 1);
  dire("avec la date", Boolean(apres.annulee_le));

  dire("elle disparait de la liste publique",
       !(await (await lire("/annonces")).text()).includes(M + " a retirer"));
  dire("l'employeur la voit toujours sur son profil",
       (await (await lire("/mes-demandes", emp.cookie)).text()).includes(M + " a retirer"));

  console.log("\n--- RETIRER N'EFFACE RIEN ---");
  // Supprimer ferait disparaitre des conversations que des gens ont eues.
  dire("l'annonce existe toujours en base", Boolean(apres.id));
  dire("la candidature aussi",
       Boolean(base.prepare("SELECT id FROM candidatures WHERE id = ?").get(candR.id)));
  dire("les messages aussi",
       base.prepare("SELECT COUNT(*) n FROM messages WHERE candidature_id = ?").get(candR.id).n > 0);
  dire("la discussion reste ouverte des deux cotes",
       (await lire("/messages/" + candR.id, emp.cookie)).status === 200 &&
       (await lire("/messages/" + candR.id, pre.cookie)).status === 200);
  dire("la personne retrouve la discussion dans ses messages",
       (await (await lire("/messages", pre.cookie)).text()).includes("/messages/" + candR.id));

  console.log("\n--- ON NE REPOND PLUS A UNE DEMANDE RETIREE ---");
  const pre2 = await creerCompte("pre2", "prestataire", { metier: "menagere", tarif: "9000" });
  dire("l'ecran de reponse repond 410",
       (await lire("/candidatures/nouvelle/" + aRetirer.id, pre2.cookie)).status === 410);
  const envoiForce = await poster("/candidatures", form({ annonceId: String(aRetirer.id) }), pre2.cookie);
  dire("et l'envoi direct du formulaire aussi", envoiForce.code === 410, "code " + envoiForce.code);
  dire("aucune candidature n'a ete ajoutee",
       base.prepare("SELECT COUNT(*) n FROM candidatures WHERE annonce_id = ?").get(aRetirer.id).n === 1);

  console.log("\n--- CHOISIR QUELQU'UN POURVOIT LA DEMANDE ---");
  // Une demande pourvue qui reste ouverte fait patienter des gens pour
  // rien : ils repondent a une place deja prise.
  const emp2 = await creerCompte("emp3", "employeur");
  await poster("/annonces", form({ titre: M + " pourvue", metier: "menagere",
    quartier: "Mvan", horaire: "Mardi 9h", prix: "10000" }), emp2.cookie);
  const a2 = base.prepare("SELECT id FROM annonces WHERE titre LIKE ? ORDER BY id DESC LIMIT 1").get("%" + M + " pourvue%");

  const candidats = [];
  for (const sfx of ["c1", "c2", "c3"]) {
    const c = await creerCompte(sfx, "prestataire", { metier: "menagere", tarif: "12000" });
    base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email = ?").run(c.mail);
    await poster("/candidatures", form({ annonceId: String(a2.id) }), c.cookie);
    candidats.push(c);
  }
  const toutes = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ? ORDER BY id").all(a2.id);
  dire("trois personnes ont repondu", toutes.length === 3, String(toutes.length));

  // Ce qui va se passer est annonce AVANT le clic.
  const ecran = await (await lire("/candidatures/" + toutes[0].id + "/confirmer", emp2.cookie)).text();
  dire("l'ecran annonce que la demande sera retiree", ecran.includes("retirée de la liste"));
  dire("et combien de personnes recevront un refus", ecran.includes("<strong>2</strong>"));

  await poster("/candidatures/statut",
    form({ candidatureId: String(toutes[0].id), statut: "acceptee" }), emp2.cookie);

  const statuts = base.prepare("SELECT id, statut FROM candidatures WHERE annonce_id = ? ORDER BY id").all(a2.id);
  dire("la personne choisie est acceptee", statuts[0].statut === "acceptee");
  dire("les deux autres sont refusees",
       statuts[1].statut === "refusee" && statuts[2].statut === "refusee");
  dire("la demande est fermee",
       base.prepare("SELECT annulee FROM annonces WHERE id = ?").get(a2.id).annulee === 1);
  dire("elle quitte la liste publique",
       !(await (await lire("/annonces")).text()).includes(M + " pourvue"));
  dire("l'employeur lit qu'il a choisi quelqu'un, pas que la demande est retiree",
       (await (await lire("/mes-demandes", emp2.cookie)).text()).includes("Vous avez choisi"));
  // UN REFUS AUTOMATIQUE N'EST PAS UN REFUS PERSONNEL. Choisir
  // quelqu'un refuse les autres reponses : ecrire a chacune que
  // l'employeur l'a refusee lui attribue une decision qu'il n'a pas
  // prise, et l'accuse d'un rejet qui n'a pas eu lieu.
  const vueEcartee = await (await lire("/mes-reponses", candidats[1].cookie)).text();
  dire("une candidate non retenue lit que quelqu un d autre a ete choisi",
       // EJS echappe l'apostrophe en &#39; : on cherche donc un
       // fragment qui n'en contient pas.
       vueEcartee.includes("employeur a choisi une autre personne"));
  dire("et on ne lui parle pas d un refus",
       !vueEcartee.includes("a refusé votre candidature"));
  const vueChoix = await (await lire("/mes-demandes", emp2.cookie)).text();
  dire("l'employeur lit son choix, pas un refus qu'il n'a pas fait",
       vueChoix.includes("choisi quelqu&#39;un d&#39;autre"));
  dire("et le mot refus n apparait pas sur sa demande pourvue",
       !vueChoix.includes("Vous avez refusé cette candidature"));
  dire("elle garde acces a la discussion",
       (await lire("/messages/" + statuts[1].id, candidats[1].cookie)).status === 200);
  dire("personne ne peut plus repondre",
       (await lire("/candidatures/nouvelle/" + a2.id, candidats[2].cookie)).status === 410);

  console.log("\n--- REFUSER NE FERME PAS LA DEMANDE ---");
  // Le cas reel : ils discutent des horaires, ne s'entendent pas, et
  // l'employeur refuse. Sa demande doit rester ouverte pour que d'autres
  // personnes puissent encore y repondre. Seul un CHOIX la pourvoit.
  const empR = await creerCompte("empR", "employeur");
  await poster("/annonces", form({ titre: M + " horaires", metier: "menagere",
    quartier: "Mvan", horaire: "Lundi 8h", prix: "14000" }), empR.cookie);
  const aR = base.prepare("SELECT id FROM annonces WHERE titre LIKE ? ORDER BY id DESC LIMIT 1").get("%" + M + " horaires%");

  const c1 = await creerCompte("cand1", "prestataire", { metier: "menagere", tarif: "15000" });
  const c2 = await creerCompte("cand2", "prestataire", { metier: "menagere", tarif: "12000" });
  await poster("/candidatures", form({ annonceId: String(aR.id) }), c1.cookie);
  const candid1 = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ?").get(aR.id);

  // Ils discutent des horaires : c'est le role de la messagerie.
  await poster("/messages/" + candid1.id,
    form({ texte: "Bonjour, je ne suis pas libre le lundi matin. Le mardi vous irait ?" }), c1.cookie);
  dire("la messagerie sert a s'accorder sur les horaires",
       (await (await lire("/messages/" + candid1.id, empR.cookie)).text()).includes("Le mardi vous irait"));

  await poster("/candidatures/statut",
    form({ candidatureId: String(candid1.id), statut: "refusee" }), empR.cookie);

  dire("la candidature est refusee",
       base.prepare("SELECT statut FROM candidatures WHERE id = ?").get(candid1.id).statut === "refusee");
  dire("mais la demande reste OUVERTE",
       base.prepare("SELECT annulee FROM annonces WHERE id = ?").get(aR.id).annulee === 0);
  dire("elle reste dans la liste publique",
       (await (await lire("/annonces")).text()).includes(M + " horaires"));
  dire("la personne refusee garde sa discussion",
       (await lire("/messages/" + candid1.id, c1.cookie)).status === 200);

  // MAIS UN VRAI REFUS GARDE SON NOM. Ici l'employeur a ecarte
  // quelqu'un SANS choisir personne : la decision est bien la sienne,
  // prise une par une. Sans cette moitie, rien n'empecherait la phrase
  // du choix de s'etendre un jour a un refus reel.
  dire("un refus individuel se dit comme tel, cote personne",
       (await (await lire("/mes-reponses", c1.cookie)).text())
         .includes("employeur a refusé votre candidature"));
  dire("et cote employeur aussi",
       (await (await lire("/mes-demandes", empR.cookie)).text())
         .includes("Vous avez refusé cette candidature"));

  const secondeCandidature = await poster("/candidatures", form({ annonceId: String(aR.id) }), c2.cookie);
  dire("une autre personne peut encore postuler", secondeCandidature.code === 200,
       "code " + secondeCandidature.code);
  dire("la demande porte bien deux candidatures",
       base.prepare("SELECT COUNT(*) n FROM candidatures WHERE annonce_id = ?").get(aR.id).n === 2);

  // Ce que l'ecran doit dire, sinon la question se repose a chaque fois.
  const profilR = await (await lire("/mes-demandes", empR.cookie)).text();
  dire("le bouton nomme ce qu'il refuse", profilR.includes("Refuser cette candidature"));
  dire("et l'ecran precise que la demande reste visible",
       profilR.includes("Refuser ne retire pas votre demande"));

  console.log("\n--- UN REFUS NE FERME PAS LA PORTE POUR TOUJOURS ---");
  // Refuser quelqu'un laisse la demande ouverte aux autres : rien ne
  // justifiait de la fermer definitivement a la personne refusee. Un
  // employeur peut refuser par erreur, ou les deux peuvent s'accorder
  // plus tard sur un horaire.
  const empX = await creerCompte("empX", "employeur");
  const preX = await creerCompte("preX", "prestataire", { metier: "menagere", tarif: "15000" });
  const tiersX = await creerCompte("tiersX", "prestataire", { metier: "menagere", tarif: "11000" });

  // On n'embauche personne dont l'identite n'a pas ete verifiee : sans
  // cela, l'acceptation plus bas serait refusee et la suite du scenario
  // ne voudrait plus rien dire.
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email = ?")
    .run(preX.mail.toLowerCase());

  await poster("/annonces", form({ titre: M + " retour", metier: "menagere",
    quartier: "Mvan", horaire: "Lundi 8h", prix: "12000" }), empX.cookie);
  const aX = base.prepare("SELECT id FROM annonces WHERE titre = ? ORDER BY id DESC LIMIT 1").get(M + " retour");

  await poster("/candidatures", form({ annonceId: String(aX.id) }), preX.cookie);
  const cX = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ?").get(aX.id);
  await poster("/messages/" + cX.id, form({ texte: M + " bonjour" }), preX.cookie);

  const pendant = await poster("/candidatures", form({ annonceId: String(aX.id) }), preX.cookie);
  dire("repostuler pendant l'attente est refuse", pendant.code === 409, "code " + pendant.code);

  await poster("/candidatures/statut",
    form({ candidatureId: String(cX.id), statut: "refusee" }), empX.cookie);

  const retour = await poster("/candidatures", form({ annonceId: String(aX.id) }), preX.cookie);
  dire("apres un refus, elle peut repostuler", retour.code === 200, "code " + retour.code);

  const relance = base.prepare(
    "SELECT id, statut, statut_change_le FROM candidatures WHERE annonce_id = ?").all(aX.id);
  dire("aucune seconde candidature n'est creee", relance.length === 1, String(relance.length));
  dire("c'est la MEME ligne qui est rouverte", relance[0].id === cX.id);
  dire("elle repasse en attente", relance[0].statut === "en attente");
  dire("plus aucune decision a annoncer", relance[0].statut_change_le === null);
  // Rouvrir plutot que recreer garde la discussion attachee.
  dire("la discussion precedente est conservee",
       base.prepare("SELECT COUNT(*) n FROM messages WHERE candidature_id = ?").get(cX.id).n === 1);

  console.log("\n--- POURVUE ET RETIREE NE SE DISENT PAS PAREIL ---");
  // La colonne annulee vaut 1 dans les deux cas. Dire "l'employeur a
  // retire sa demande" a la personne qu'il vient de choisir etait le
  // contraire de la verite.
  await poster("/candidatures/statut",
    form({ candidatureId: String(cX.id), statut: "acceptee" }), empX.cookie);

  const choisie = await poster("/candidatures", form({ annonceId: String(aX.id) }), preX.cookie);
  dire("la personne choisie n'est pas renvoyee ailleurs", choisie.code === 409, "code " + choisie.code);
  dire("on lui dit qu'elle a ete retenue", choisie.corps.includes("déjà été choisie"));
  dire("et jamais que la demande a ete retiree", !choisie.corps.includes("Demande retirée"));

  const autre = await poster("/candidatures", form({ annonceId: String(aX.id) }), tiersX.cookie);
  dire("un tiers lit que quelqu'un a deja ete choisi",
       autre.code === 410 && autre.corps.includes("a déjà été choisi"), "code " + autre.code);
  dire("l'ecran de reponse le dit aussi",
       (await (await lire("/candidatures/nouvelle/" + aX.id, tiersX.cookie)).text())
         .includes("a déjà été choisi"));

  // Une demande VRAIMENT retiree garde son ancien message.
  await poster("/annonces", form({ titre: M + " ecartee", metier: "menagere",
    quartier: "Mvan", horaire: "Mardi 9h", prix: "9000" }), empX.cookie);
  const bX = base.prepare("SELECT id FROM annonces WHERE titre = ? ORDER BY id DESC LIMIT 1").get(M + " ecartee");
  await poster("/annonces/" + bX.id + "/annuler", form({}), empX.cookie);
  const ecartee = await poster("/candidatures", form({ annonceId: String(bX.id) }), tiersX.cookie);
  dire("une demande retiree le dit toujours", ecartee.corps.includes("Demande retirée"));
  dire("et ne parle pas de quelqu'un de choisi", !ecartee.corps.includes("a déjà été choisi"));

  // Les deux ecrans parlent de CE QUE PEUT FAIRE celui qui lit, et non
  // de ce que "elle" accepte - un pronom qui pouvait designer la demande
  // comme la personne citee juste avant.
  dire("on dit a la personne ce qu'elle ne peut plus faire",
       ecartee.corps.includes("Vous ne pouvez plus y répondre"));
  dire("et jamais que quelqu'un refuse ses reponses",
       !ecartee.corps.includes("accepte plus de réponse"));
  dire("le meme soin quand quelqu'un a ete choisi",
       autre.corps.includes("Vous ne pouvez plus répondre"));
  dire("sans pronom ambigu la non plus",
       !autre.corps.includes("accepte plus de réponse"));

  console.log("\n--- LES DEMANDES FERMEES SONT RANGEES, PAS SUPPRIMEES ---");
  // Ce qui est en cours et ce qui est fini ne se lisent pas au meme
  // moment. Mais une demande fermee garde ses discussions, ses reponses
  // et la trace de son argent : on ne la supprime pas, on la range.
  // Il ne lui reste que des demandes fermees. On en rouvre une, sinon
  // il n y a rien a distinguer et la paire de titres ne se verifie pas.
  await poster("/annonces", form({ titre: M + " vivante", metier: "menagere",
                                  quartier: "Mvan", horaire: "L 8h", prix: "10000" }), emp.cookie);
  const profilAli = await (await lire("/mes-demandes", emp.cookie)).text();
  dire("la section des demandes terminees existe",
       profilAli.includes("Demandes termin"));
  dire("elle dit pourquoi elles restent", profilAli.includes("y restent"));
  dire("la demande retiree est toujours listee",
       profilAli.includes("retir\u00e9 cette demande"));
  // ET APRES LES VIVANTES : une demande ouverte ne doit pas se perdre au
  // milieu de celles qui sont closes.
  dire("elle vient apres le titre de la section",
       profilAli.indexOf("Demandes termin") < profilAli.lastIndexOf("retir\u00e9 cette demande"));

  // LA PAIRE SE LIT ENSEMBLE. Un titre plus bas laissait entendre que
  // ce qui precede est autre chose, sans jamais dire quoi.
  dire("les demandes en cours ont leur titre aussi",
       profilAli.includes("Demandes en cours"));
  dire("et il vient avant celui des terminees",
       profilAli.indexOf("Demandes en cours") < profilAli.indexOf("Demandes termin"));

  // MAIS UN TITRE QUI NE DISTINGUE RIEN EST DU BRUIT : sans demande
  // fermee, il surplomberait la seule liste de la page.
  const neuf = await creerCompte("sanstitre", "employeur");
  await poster("/annonces", form({ titre: M + " seule", metier: "menagere",
                                  quartier: "Mvan", horaire: "L 8h", prix: "10000" }), neuf.cookie);
  const sansFermee = await (await lire("/mes-demandes", neuf.cookie)).text();
  dire("sans demande fermee, aucun titre ne surplombe la liste",
       !sansFermee.includes("Demandes en cours") && !sansFermee.includes("Demandes termin"));
  dire("mais la demande est bien la", sansFermee.includes(M + " seule"));

  console.log(String.fromCharCode(10) + "--- NETTOYAGE ---");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
