// Série : le séquestre. La somme annoncée est bloquée à la publication
// et ne repart qu'à la fin.
//
// TOUT EST SIMULÉ : aucun argent réel ne circule. Ce que ces tests
// vérifient, c'est que les écritures suivent exactement la règle —
// l'argent suit LA DEMANDE, jamais une candidature.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-versement";
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
  // L'inscription enregistre l'email EN MINUSCULES. Un suffixe qui
  // contient une majuscule - "empA" - donnerait sinon un email
  // introuvable au moment de relire son identifiant.
  const mail = (M + "-" + suffixe + "@example.com").toLowerCase();
  await poster("/inscription", form(Object.assign(
    { role, nom: "Test " + suffixe, email: mail, motdepasse: "motdepasse123", telephone: "600000000", quartier: "Bastos" },
    extra || {})));
  const c = await poster("/connexion", form({ email: mail, motdepasse: "motdepasse123", telephone: "600000000" }));
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email = ?")
    .run(mail.toLowerCase());
  return {
    mail, cookie: c.cookie,
    id: base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(mail).id,
  };
}

async function publier(titre, prix, cookie) {
  await poster("/annonces", form({ titre: M + " " + titre, metier: "menagere",
    quartier: "Mvan", horaire: "Lundi 8h", prix: String(prix) }), cookie);
  return base.prepare("SELECT id FROM annonces WHERE titre = ? ORDER BY id DESC LIMIT 1")
    .get(M + " " + titre);
}

const versementDe = (annonceId) =>
  base.prepare("SELECT * FROM versements WHERE annonce_id = ?").get(annonceId);

setTimeout(async () => {
  const emp = await creerCompte("emp", "employeur");
  const p1 = await creerCompte("p1", "prestataire", { metier: "menagere", tarif: "15000" });
  const p2 = await creerCompte("p2", "prestataire", { metier: "menagere", tarif: "12000" });
  const eq = await creerCompte("eq", "employeur");
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE id = ?").run(eq.id);

  console.log("\n--- PUBLIER BLOQUE LA SOMME ---");
  const a = await publier("A", 25000, emp.cookie);
  dire("un versement est cree", Boolean(versementDe(a.id)));
  dire("il est bloque", versementDe(a.id).etat === "bloque");
  dire("pour le montant annonce", versementDe(a.id).montant === 25000);
  dire("au nom de l'employeur", versementDe(a.id).employeur_id === emp.id);
  dire("rien n'est encore verse", versementDe(a.id).beneficiaire_id === null);

  console.log("\n--- CHANGER LE PRIX AJUSTE LA SOMME ---");
  // Sinon les deux chiffres se contredisent d'un ecran a l'autre.
  await poster("/annonces/" + a.id + "/modifier", form({ titre: M + " A", metier: "menagere",
    quartier: "Mvan", horaire: "Lundi 8h", prix: "30000" }), emp.cookie);
  dire("la somme bloquee suit le nouveau prix", versementDe(a.id).montant === 30000,
       String(versementDe(a.id).montant));

  console.log("\n--- REFUSER QUELQU'UN NE LIBERE RIEN ---");
  // C'est le point le plus important : la demande reste ouverte, d'autres
  // personnes peuvent encore y repondre, donc la somme reste bloquee.
  await poster("/candidatures", form({ annonceId: String(a.id) }), p1.cookie);
  await poster("/candidatures", form({ annonceId: String(a.id) }), p2.cookie);
  const c1 = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ? AND prestataire_id = ?").get(a.id, p1.id);
  const c2 = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ? AND prestataire_id = ?").get(a.id, p2.id);

  await poster("/candidatures/statut", form({ candidatureId: String(c1.id), statut: "refusee" }), emp.cookie);
  dire("la somme reste bloquee", versementDe(a.id).etat === "bloque");
  dire("la demande reste ouverte",
       base.prepare("SELECT annulee FROM annonces WHERE id = ?").get(a.id).annulee === 0);

  console.log("\n--- ACCEPTER NE VERSE PAS ENCORE ---");
  await poster("/candidatures/statut", form({ candidatureId: String(c2.id), statut: "acceptee" }), emp.cookie);
  dire("la somme attend le service", versementDe(a.id).etat === "bloque");

  console.log("\n--- LE SERVICE EFFECTUE VERSE LA SOMME ---");
  await poster("/candidatures/" + c2.id + "/terminer", form({}), emp.cookie);
  const fin = versementDe(a.id);
  dire("le versement est fait", fin.etat === "verse");
  dire("a la personne retenue", fin.beneficiaire_id === p2.id);
  dire("la commission est retenue", fin.commission === 3000, String(fin.commission));
  dire("elle recoit le reste", fin.net === 27000, String(fin.net));
  dire("le calcul porte sur le prix de la DEMANDE, pas sur son tarif declare",
       fin.montant === 30000);
  dire("la date du versement est enregistree", typeof fin.denoue_le === "string");

  console.log("\n--- RETIRER UNE DEMANDE REND LA SOMME ---");
  const b = await publier("B", 10000, emp.cookie);
  dire("elle est d'abord bloquee", versementDe(b.id).etat === "bloque");
  await poster("/annonces/" + b.id + "/annuler", form({}), emp.cookie);
  dire("puis rendue", versementDe(b.id).etat === "rembourse");
  dire("sans beneficiaire", versementDe(b.id).beneficiaire_id === null);

  console.log("\n--- RETIRER ET REFUSER NE SE CONFONDENT PAS ---");
  // Refuser ecarte UNE personne et laisse la demande ouverte : la somme
  // reste bloquee, d'autres peuvent encore repondre. Retirer ferme la
  // demande pour tout le monde : la somme est rendue.
  const d = await publier("D", 15000, emp.cookie);
  await poster("/candidatures", form({ annonceId: String(d.id) }), p1.cookie);
  const cd = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ?").get(d.id);
  await poster("/candidatures/statut", form({ candidatureId: String(cd.id), statut: "refusee" }), emp.cookie);

  dire("apres un refus, la somme reste bloquee", versementDe(d.id).etat === "bloque");
  dire("et la demande reste dans la liste publique",
       (await (await lire("/annonces")).text()).includes(M + " D"));
  dire("une autre personne peut encore y repondre",
       (await poster("/candidatures", form({ annonceId: String(d.id) }), p2.cookie)).code === 200);

  const mesDemandes = await (await lire("/mes-demandes", emp.cookie)).text();
  dire("l'ecran dit ce que RETIRER ferme", mesDemandes.includes("Retirer ferme votre demande"));
  dire("et vers quoi se tourner pour ecarter une seule personne",
       mesDemandes.includes("Refuser cette candidature</strong> plus bas"));

  await poster("/annonces/" + d.id + "/annuler", form({}), emp.cookie);
  dire("retirer rend bien la somme", versementDe(d.id).etat === "rembourse");
  dire("et ferme la demande a tout le monde",
       !(await (await lire("/annonces")).text()).includes(M + " D"));

  console.log("\n--- ON NE REPREND PAS SON ARGENT APRES AVOIR EMBAUCHE ---");
  // Le bouton "Retirer" est cache une fois quelqu'un choisi. Mais cacher
  // un bouton n'est pas une regle : sans controle sur le serveur, un
  // employeur pouvait fermer sa demande APRES avoir embauche et
  // recuperer sa somme. La personne avait travaille pour rien.
  const e2 = await creerCompte("emp2", "employeur");
  const q1 = await creerCompte("q1", "prestataire", { metier: "menagere", tarif: "15000" });

  const aQ = await publier("Q", 18000, e2.cookie);
  await poster("/candidatures", form({ annonceId: String(aQ.id) }), q1.cookie);
  const cQ = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ?").get(aQ.id);
  await poster("/candidatures/statut",
    form({ candidatureId: String(cQ.id), statut: "acceptee" }), e2.cookie);

  const retrait = await poster("/annonces/" + aQ.id + "/annuler", form({}), e2.cookie);
  dire("retirer une demande pourvue est refuse", retrait.code === 409, "code " + retrait.code);
  dire("on lui dit pourquoi", retrait.corps.includes("Vous avez déjà choisi"));
  dire("et vers quoi se tourner", retrait.corps.includes("signalez le problème"));

  // LE POINT CENTRAL : la somme n'a pas bouge.
  dire("la somme reste bloquee", versementDe(aQ.id).etat === "bloque");
  dire("elle n'est pas rendue a l'employeur", versementDe(aQ.id).denoue_le === null);

  // Le meme controle protege le cas ou la demande est restee ouverte
  // avec une candidature acceptee - ce que d'anciennes donnees
  // permettent.
  base.prepare("UPDATE annonces SET annulee = 0, annulee_le = NULL WHERE id = ?").run(aQ.id);
  const rouverte = await poster("/annonces/" + aQ.id + "/annuler", form({}), e2.cookie);
  dire("meme si la demande est restee ouverte", rouverte.code === 409, "code " + rouverte.code);
  dire("la somme n'a toujours pas bouge", versementDe(aQ.id).etat === "bloque");

  console.log("\n--- SON COMPTE ---");
  const compteP2 = await (await lire("/mon-compte", p2.cookie)).text();
  dire("la personne voit ce qu'elle a recu", compteP2.includes("27 000"));
  dire("et chez qui elle a travaille", compteP2.includes("Test emp"));
  // Aucune coordonnee : ni numero Mobile Money, ni compte bancaire.
  dire("la page annonce qu'aucune coordonnee n'est demandee",
       compteP2.includes("ni numéro Mobile Money"));
  dire("elle annonce aussi que les montants sont simules",
       compteP2.includes("simulés"));

  const compteEmp = await (await lire("/mon-compte", emp.cookie)).text();
  dire("l'employeur voit ce qu'il a verse", compteEmp.includes("Versé à"));
  dire("et ce qui lui a ete rendu", compteEmp.includes("Rendu"));

  console.log("\n--- L'OBLIGATION EST ECRITE AVANT DE PUBLIER ---");
  const formulaire = await (await lire("/publier-annonce", emp.cookie)).text();
  dire("on annonce que la somme sera bloquee", formulaire.includes("bloquée par PamConnect"));
  dire("et qu'il faudra declarer le service", formulaire.includes("déclarez-le obligatoirement"));
  dire("et ce qui arrive s'il retire sa demande", formulaire.includes("la somme"));

  console.log("\n--- CE QUE L'EQUIPE VOIT ---");
  dire("un employeur ne peut pas ouvrir la page",
       (await lire("/admin/versements", emp.cookie)).status === 403);
  dire("une personne qui travaille non plus",
       (await lire("/admin/versements", p2.cookie)).status === 403);
  const vueEquipe = await (await lire("/admin/versements", eq.cookie)).text();
  // Une somme denouee QUITTE la liste de ce qui attend, mais reste dans
  // la trace en dessous. On coupe la page en deux pour le verifier :
  // chercher dans la page entiere ne prouverait rien.
  const attendent = vueEquipe.slice(0, vueEquipe.indexOf("Sommes dénouées"));
  dire("une somme versee ne figure plus dans ce qui attend",
       !attendent.includes(M + " A"));
  dire("une somme rendue non plus", !attendent.includes(M + " B"));
  // L'equipe peut desormais trancher, mais seulement en dernier recours.
  // La page doit dire exactement cela - ni "elle n'agit jamais", qui
  // serait faux, ni rien du tout.
  dire("la page dit qu'elle n'agit qu'en dernier recours",
       vueEquipe.includes("dernier recours"));
  dire("et a quelle condition", vueEquipe.includes("Vous n'intervenez qu'en cas de"));

  // L'EQUIPE DOIT VOIR L'ARGENT SORTIR, PAS SEULEMENT ENTRER. Sans cette
  // trace, elle ne pouvait pas repondre a "je n'ai jamais ete payee" :
  // l'information existait en base, illisible sans ouvrir la base.
  dire("la page separe ce qui attend de ce qui est fait",
       vueEquipe.includes("Sommes bloquées") && vueEquipe.includes("Sommes dénouées"));
  dire("un versement effectue y figure", vueEquipe.includes(M + " A"));
  dire("avec le nom de qui a recu", vueEquipe.includes("Test p2"));
  dire("le detail de la commission", vueEquipe.includes("Commission PamConnect"));
  dire("et la date ou le service a ete declare",
       vueEquipe.includes("Service déclaré effectué le"));
  dire("une somme rendue y figure aussi",
       vueEquipe.includes(M + " B") && vueEquipe.includes("Rendue à"));
  // Le metier repond a "pour quel service ?" - la question que l'equipe
  // se pose en premier devant une ligne d'argent.
  dire("le metier de la demande est indique", vueEquipe.includes("Ménage à domicile"));

  const c = await publier("C", 12000, emp.cookie);

  // Le rappel n'a de sens que sur une somme ENCORE bloquee : c'est la
  // seule que l'employeur peut encore liberer.
  const compteAvecBloque = await (await lire("/mon-compte", emp.cookie)).text();
  dire("l'obligation de declarer est rappelee sur une somme bloquee",
       compteAvecBloque.includes("déclarez-le à PamConnect"));
  // Le gabarit coupe la phrase : on cherche un morceau qu'il ne coupe pas.
  dire("et on lui dit pourquoi", compteAvecBloque.includes("s'ouvre pour rien"));
  const encore = await (await lire("/admin/versements", eq.cookie)).text();
  dire("une somme encore bloquee y figure", encore.includes(M + " C"));
  dire("avec le nom de l'employeur", encore.includes("Test emp"));
  // "Bloquee depuis 0 jour" etait juste et illisible : une somme posee il
  // y a deux heures n'attend pas depuis zero jour.
  // La valeur passe par une balise d'affichage, qui echappe l'apostrophe
  // en &#39; : on s'arrete avant elle.
  dire("une somme du jour se lit 'aujourd hui'", encore.includes("Bloquée depuis aujourd"));
  dire("et jamais 'depuis 0 jour'", !encore.includes("depuis 0 jour"));

  // Une somme vieille de dix jours sur une demande POURVUE : l'equipe
  // doit la voir en rouge.
  base.prepare("UPDATE versements SET cree_le = datetime('now', '-10 days') WHERE annonce_id = ?").run(c.id);
  await poster("/candidatures", form({ annonceId: String(c.id) }), p1.cookie);
  const cc = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ?").get(c.id);
  await poster("/candidatures/statut", form({ candidatureId: String(cc.id), statut: "acceptee" }), emp.cookie);
  const tardive = await (await lire("/admin/versements", eq.cookie)).text();
  dire("une somme trop vieille est signalee", tardive.includes("le service n'a pas été déclaré"));
  dire("avec sa duree en clair", tardive.includes("Bloquée depuis 10 jours"));

  console.log("\n--- L'EQUIPE TRANCHE UN LITIGE ---");
  // Sans arbitrage, une personne pouvait travailler et n'etre jamais
  // payee : avertir ou suspendre l'employeur ne la payait pas, et la
  // somme restait bloquee pour toujours.
  const eA = await creerCompte("empA", "employeur");
  const pA = await creerCompte("preA", "prestataire", { metier: "menagere", tarif: "15000" });

  const aA = await publier("Litige", 20000, eA.cookie);
  await poster("/candidatures", form({ annonceId: String(aA.id) }), pA.cookie);
  const cA = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ?").get(aA.id);
  await poster("/candidatures/statut",
    form({ candidatureId: String(cA.id), statut: "acceptee" }), eA.cookie);

  // L'employeur doit avoir eu sa chance : trancher avant, ce serait
  // decider a sa place alors qu'il n'a encore rien manque.
  const tropTot = await poster("/admin/versements/" + aA.id,
    form({ decision: "verser", motif: "je vais trop vite" }), eq.cookie);
  dire("trancher avant tout litige est refuse", tropTot.code === 409, "code " + tropTot.code);
  dire("et la somme n'a pas bouge", versementDe(aA.id).etat === "bloque");
  // La base contient d'autres sommes bloquees, dont certaines en litige.
  // On ne lit donc que LA CARTE de notre demande : chercher dans la page
  // entiere trouverait le formulaire d'un dossier etranger.
  const carteDe = async (titre) => {
    const page = await (await lire("/admin/versements", eq.cookie)).text();
    const i = page.indexOf(titre);
    if (i < 0) return "";
    const suivant = page.indexOf("<h3>", i);
    return page.slice(i, suivant < 0 ? page.length : suivant);
  };

  dire("le formulaire n'est pas propose",
       !(await carteDe(M + " Litige")).includes("Trancher ce désaccord"));

  // Sa declaration cree le litige : elle dit avoir travaille, lui se tait.
  await poster("/candidatures/" + cA.id + "/jai-effectue", form({}), pA.cookie);
  dire("une fois qu'elle a declare, le formulaire apparait",
       (await (await lire("/admin/versements", eq.cookie)).text()).includes("Trancher ce désaccord"));

  const sansMotif = await poster("/admin/versements/" + aA.id,
    form({ decision: "verser", motif: "   " }), eq.cookie);
  dire("trancher sans motif est refuse", sansMotif.code === 400, "code " + sansMotif.code);
  dire("on lui dit pourquoi", sansMotif.corps.includes("Écrivez pourquoi"));
  dire("la somme n'a toujours pas bouge", versementDe(aA.id).etat === "bloque");

  // C'est la seule action qui deplace de l'argent : elle est reservee.
  dire("un employeur ne peut pas trancher",
       (await poster("/admin/versements/" + aA.id,
         form({ decision: "verser", motif: "je me paie" }), eA.cookie)).code === 403);
  dire("une personne qui travaille non plus",
       (await poster("/admin/versements/" + aA.id,
         form({ decision: "verser", motif: "payez-moi" }), pA.cookie)).code === 403);

  const MOTIF = M + " l employeur confirme par telephone";
  const tranche = await poster("/admin/versements/" + aA.id,
    form({ decision: "verser", motif: MOTIF }), eq.cookie);
  dire("l'equipe verse a la personne", tranche.code === 302, "code " + tranche.code);

  const apresA = versementDe(aA.id);
  dire("la somme part chez elle", apresA.etat === "verse");
  dire("commission deduite", apresA.commission === 2000 && apresA.net === 18000);
  dire("qui a decide est conserve", typeof apresA.decide_par === "number");
  dire("et son motif aussi", apresA.motif_decision === MOTIF);
  // L'affaire est close : la laisser ouverte inviterait a discuter d'un
  // dossier deja tranche.
  dire("la discussion est archivee",
       typeof base.prepare("SELECT terminee_le FROM candidatures WHERE id = ?").get(cA.id).terminee_le === "string");

  dire("on ne rejuge pas une somme deja denouee",
       (await poster("/admin/versements/" + aA.id,
         form({ decision: "rendre", motif: "je change d avis" }), eq.cookie)).code === 409);

  const traceA = await (await lire("/admin/versements", eq.cookie)).text();
  dire("la trace nomme qui a tranche", traceA.includes("Tranché par"));
  dire("et cite son motif tel quel", traceA.includes(MOTIF));

  console.log("\n--- L'EQUIPE ECRIT AVANT DE TRANCHER ---");
  // Elle ne peut pas entrer dans la discussion des deux personnes : elle
  // ne lit pas leurs echanges prives. Son seul canal etait
  // l'avertissement, qui est une sanction - poser une question par ce
  // moyen serait injuste.
  const eC = await creerCompte("empC", "employeur");
  const pC = await creerCompte("preC", "prestataire", { metier: "menagere", tarif: "15000" });
  const aC = await publier("Question", 15000, eC.cookie);
  await poster("/candidatures", form({ annonceId: String(aC.id) }), pC.cookie);
  const cC = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ?").get(aC.id);
  await poster("/candidatures/statut",
    form({ candidatureId: String(cC.id), statut: "acceptee" }), eC.cookie);
  await poster("/candidatures/" + cC.id + "/jai-effectue", form({}), pC.cookie);

  const idEmpC = base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(eC.mail).id;

  dire("le formulaire d'ecriture apparait sur le desaccord",
       (await carteDe(M + " Question")).includes("Envoyer ce message"));

  const court = await poster("/admin/message/" + idEmpC, form({ texte: "court" }), eq.cookie);
  dire("un message trop court est refuse", court.code === 400, "code " + court.code);

  // Ecrire au nom de l'equipe est reserve a l'equipe.
  dire("un employeur ne peut pas ecrire au nom de l'equipe",
       (await poster("/admin/message/" + idEmpC,
         form({ texte: "je me fais passer pour l equipe" }), eC.cookie)).code === 403);
  dire("une personne qui travaille non plus",
       (await poster("/admin/message/" + idEmpC,
         form({ texte: "payez-moi tout de suite" }), pC.cookie)).code === 403);

  const TEXTE = M + " pouvez-vous confirmer que le service a eu lieu ?";
  dire("l'equipe ecrit",
       (await poster("/admin/message/" + idEmpC, form({ texte: TEXTE }), eq.cookie)).code === 302);

  const recu = base.prepare(
    "SELECT message_equipe, message_equipe_lu, avertissements, suspendu FROM utilisateurs WHERE id = ?")
    .get(idEmpC);
  dire("le message est enregistre tel quel", recu.message_equipe === TEXTE);
  dire("il n'est pas encore lu", recu.message_equipe_lu === 0);
  // CE N'EST PAS UNE SANCTION : c'est toute la difference avec
  // l'avertissement, et elle doit rester visible dans les donnees.
  dire("aucun avertissement n'a ete ajoute", recu.avertissements === 0);
  dire("et le compte n'est pas suspendu", recu.suspendu === 0);

  const profilC = await (await lire("/mon-profil", eC.cookie)).text();
  dire("il le lit en haut de son profil", profilC.includes(TEXTE));
  dire("l'ecran dit que c'est l'equipe qui ecrit",
       profilC.includes("PamConnect vous écrit"));
  // Sans signal, un message pouvait rester des semaines sans etre vu.
  dire("la pastille du menu l'avertit",
       (await (await lire("/annonces", eC.cookie)).text()).includes('class="pastille"'));

  await poster("/message-equipe/lu", form({}), eC.cookie);
  dire("une fois lu, il quitte son profil",
       !(await (await lire("/mon-profil", eC.cookie)).text()).includes(TEXTE));
  dire("et la pastille s'eteint",
       !(await (await lire("/annonces", eC.cookie)).text()).includes('class="pastille"'));
  dire("mais le texte reste en base",
       base.prepare("SELECT message_equipe FROM utilisateurs WHERE id = ?").get(idEmpC).message_equipe === TEXTE);

  console.log("\n--- ET DANS L'AUTRE SENS ---");
  // Si le service n'a pas eu lieu, la somme revient a l'employeur.
  const eB = await creerCompte("empB", "employeur");
  const pB = await creerCompte("preB", "prestataire", { metier: "menagere", tarif: "12000" });
  const aB = await publier("Litige2", 9000, eB.cookie);
  await poster("/candidatures", form({ annonceId: String(aB.id) }), pB.cookie);
  const cB = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ?").get(aB.id);
  await poster("/candidatures/statut",
    form({ candidatureId: String(cB.id), statut: "acceptee" }), eB.cookie);
  await poster("/candidatures/" + cB.id + "/jai-effectue", form({}), pB.cookie);

  await poster("/admin/versements/" + aB.id,
    form({ decision: "rendre", motif: M + " elle n est jamais venue" }), eq.cookie);
  const apresB = versementDe(aB.id);
  dire("la somme est rendue a l'employeur", apresB.etat === "rembourse");
  dire("sans beneficiaire", apresB.beneficiaire_id === null);
  dire("avec le motif ecrit", apresB.motif_decision.includes("jamais venue"));

  console.log("\n--- L'EQUIPE N'A PAS DE COMPTE ---");
  // Elle ne recoit ni ne verse rien : la page n'a pas de sens pour elle.
  dire("la page lui est refusee", (await lire("/mon-compte", eq.cookie)).status === 403);

  console.log("\n--- NETTOYAGE ---");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
