// Série : les jetons. Le socle — le solde, l'achat d'un pack, la
// confirmation par l'équipe, et les prix que l'équipe peut changer.
//
// CE QUE CETTE SÉRIE SURVEILLE AVANT TOUT :
//   - aucun prix n'est écrit dans le code : changer le réglage change
//     ce que TOUT LE MONDE voit, immédiatement ;
//   - un achat déjà payé garde son montant quand le prix change ;
//   - confirmer deux fois ne crédite pas deux fois.
//
// Elle modifie la table des prix : elle remet les valeurs d'origine à
// la fin, sinon elle laisserait la plateforme avec ses tarifs de test.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-jeton";
let ok = 0, ko = 0;

// Le saut de ligne qui separe les titres de sections.
const SAUT = String.fromCharCode(10);

const dire = (nom, cond, detail) => {
  if (cond) { ok++; console.log("  OK    | " + nom); }
  else { ko++; console.log("  ECHEC | " + nom + (detail ? "   -> " + detail : "")); }
};

const form = (o) => new URLSearchParams(o);

// Le formulaire des prix envoie une case "pack" par pack. URLSearchParams
// ne le fait pas depuis un objet : il faut les ajouter une par une.
const formPrix = (valeur, quantites) => {
  const p = new URLSearchParams();
  p.append("jeton_valeur_fcfa", String(valeur));
  quantites.forEach((q) => p.append("pack", String(q)));
  return p;
};
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
  const mail = (M + "-" + suffixe + "@example.com").toLowerCase();
  await poster("/inscription", form(Object.assign(
    { role, nom: "Test " + suffixe, email: mail, motdepasse: "motdepasse123", quartier: "Bastos" },
    extra || {})));
  const c = await poster("/connexion", form({ email: mail, motdepasse: "motdepasse123" }));
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email = ?").run(mail);
  return {
    mail, cookie: c.cookie,
    id: base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(mail).id,
  };
}

const solde = (id) => base.prepare(`
  SELECT COALESCE(SUM(quantite), 0) AS n FROM jetons_mouvements WHERE utilisateur_id = ?
`).get(id).n;

const dernierAchat = (id) =>
  base.prepare("SELECT * FROM jetons_achats WHERE utilisateur_id = ? ORDER BY id DESC LIMIT 1").get(id);

const prixDe = (cle) => base.prepare("SELECT valeur FROM parametres WHERE cle = ?").get(cle).valeur;

setTimeout(async () => {
  // Les prix d'origine, pour les remettre a la fin.
  const prixInitiaux = base.prepare("SELECT cle, valeur FROM parametres").all();

  const emp = await creerCompte("emp", "employeur");
  const pre = await creerCompte("pre", "prestataire", { metier: "menagere", tarif: "15000" });
  const eq = await creerCompte("eq", "employeur");
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE id = ?").run(eq.id);

  console.log("\n--- LA PAGE ET SON PUBLIC ---");
  dire("un employeur y accede", (await lire("/mes-jetons", emp.cookie)).status === 200);
  dire("une personne qui propose ses services aussi",
       (await lire("/mes-jetons", pre.cookie)).status === 200);
  dire("l'equipe n'en a pas", (await lire("/mes-jetons", eq.cookie)).status === 403);
  dire("un visiteur non connecte est renvoye",
       [302, 401, 403].includes((await lire("/mes-jetons")).status));

  console.log("\n--- LE SOLDE COMMENCE A ZERO ---");
  // Aucun jeton n'apparait tout seul : rien n'est offert a l'inscription.
  dire("aucun jeton au depart", solde(emp.id) === 0, String(solde(emp.id)));

  console.log("\n--- LE PRIX EST TOUJOURS DIT DANS LES DEUX UNITES ---");
  let page = await (await lire("/mes-jetons", emp.cookie)).text();
  dire("le pack de 10 est propose", page.includes("10 jetons"));
  dire("avec son prix en FCFA", page.includes("1 000 FCFA"));
  dire("le pack de 30 aussi", page.includes("3 000 FCFA"));
  dire("la valeur d'un jeton est annoncee", page.includes("100 FCFA"));
  dire("il est dit qu'un jeton n'est pas de l'argent",
       page.includes("ne se retire ni en espèces ni par Mobile Money"));

  console.log("\n--- DEMANDER UN PACK NE CREDITE RIEN ---");
  // Tant que l'equipe n'a pas constate le paiement, le solde ne bouge pas.
  await poster("/mes-jetons/acheter", form({ quantite: "10" }), emp.cookie);
  const achat = dernierAchat(emp.id);
  dire("la demande est enregistree", Boolean(achat));
  dire("elle attend l'equipe", achat.etat === "en attente");
  dire("pour la quantite demandee", achat.quantite === 10);
  dire("au prix du serveur", achat.montant_fcfa === 1000, String(achat.montant_fcfa));
  dire("le solde n'a pas bouge", solde(emp.id) === 0, String(solde(emp.id)));

  console.log("\n--- LE PRIX NE VIENT JAMAIS DU FORMULAIRE ---");
  // Sinon n'importe qui achete 60 jetons pour 1 FCFA en renvoyant la page.
  const triche = await poster("/mes-jetons/acheter",
    form({ quantite: "60", prix: "1", montant: "1" }), pre.cookie);
  dire("un pack invente est refuse",
       triche.code === 400 || dernierAchat(pre.id).montant_fcfa === 6000,
       String(triche.code));
  if (dernierAchat(pre.id)) {
    dire("le montant retenu est celui de la plateforme",
         dernierAchat(pre.id).montant_fcfa === 6000, String(dernierAchat(pre.id).montant_fcfa));
  }
  const inconnu = await poster("/mes-jetons/acheter", form({ quantite: "999" }), emp.cookie);
  dire("un pack qui n'existe pas est refuse", inconnu.code === 400 || inconnu.code === 409);

  console.log("\n--- UNE SEULE DEMANDE A LA FOIS ---");
  const encore = await poster("/mes-jetons/acheter", form({ quantite: "30" }), emp.cookie);
  dire("la seconde demande est refusee", encore.code === 409, String(encore.code));
  dire("aucune demande en double",
       base.prepare("SELECT COUNT(*) n FROM jetons_achats WHERE utilisateur_id = ? AND etat = 'en attente'")
         .get(emp.id).n === 1);

  console.log("\n--- L'ECRAN DE L'EQUIPE ---");
  dire("l'equipe voit la page", (await lire("/admin/jetons", eq.cookie)).status === 200);
  dire("un employeur ne la voit pas", (await lire("/admin/jetons", emp.cookie)).status === 403);
  dire("une personne qui propose ses services non plus",
       (await lire("/admin/jetons", pre.cookie)).status === 403);
  const ecranEquipe = await (await lire("/admin/jetons", eq.cookie)).text();
  dire("la demande en attente y figure", ecranEquipe.includes(emp.mail));

  console.log("\n--- CONFIRMER CREDITE LES JETONS ---");
  const conf = await poster("/admin/jetons/" + achat.id, form({ decision: "confirmer" }), eq.cookie);
  dire("la confirmation aboutit", conf.code === 302, String(conf.code));
  dire("les jetons sont credites", solde(emp.id) === 10, String(solde(emp.id)));
  dire("la demande est marquee confirmee", dernierAchat(emp.id).etat === "confirme");
  const mouvement = base.prepare(
    "SELECT * FROM jetons_mouvements WHERE utilisateur_id = ? ORDER BY id DESC LIMIT 1").get(emp.id);
  dire("le mouvement est un achat", mouvement.motif === "achat");
  dire("les jetons achetes n'expirent pas", mouvement.nature === "achete" && mouvement.expire_le === null);
  dire("qui a decide est conserve", dernierAchat(emp.id).traite_par === eq.id);

  console.log("\n--- CONFIRMER DEUX FOIS NE CREDITE PAS DEUX FOIS ---");
  const deuxieme = await poster("/admin/jetons/" + achat.id, form({ decision: "confirmer" }), eq.cookie);
  dire("la seconde confirmation est refusee", deuxieme.code === 409, String(deuxieme.code));
  dire("le solde n'a pas double", solde(emp.id) === 10, String(solde(emp.id)));

  console.log("\n--- REFUSER DEMANDE UN MOTIF ---");
  await poster("/mes-jetons/acheter", form({ quantite: "30" }), emp.cookie);
  const aRefuser = dernierAchat(emp.id);
  const sansMotif = await poster("/admin/jetons/" + aRefuser.id, form({ decision: "refuser" }), eq.cookie);
  dire("un refus sans motif est bloque", sansMotif.code === 400, String(sansMotif.code));
  dire("la demande attend toujours", dernierAchat(emp.id).etat === "en attente");

  const refus = await poster("/admin/jetons/" + aRefuser.id,
    form({ decision: "refuser", motif: "Paiement non recu" }), eq.cookie);
  dire("le refus motive aboutit", refus.code === 302);
  dire("la demande est refusee", dernierAchat(emp.id).etat === "refuse");
  dire("aucun jeton n'a ete ajoute", solde(emp.id) === 10, String(solde(emp.id)));
  dire("le motif est conserve", String(dernierAchat(emp.id).motif_refus).includes("Paiement"));
  page = await (await lire("/mes-jetons", emp.cookie)).text();
  dire("la personne lit le motif sur sa page", page.includes("Paiement non recu"));

  console.log("\n--- LES PRIX NE SONT PAS FIGES ---");
  // Le point central : l'equipe change le tarif, et TOUT LE MONDE voit
  // le nouveau. Pas un prix par utilisateur, pas un prix dans le code.
  const majPrix = await poster("/admin/parametres", formPrix(200, [5, 50]), eq.cookie);
  dire("l'equipe peut changer les prix", majPrix.code === 302, String(majPrix.code));
  dire("la valeur du jeton est enregistree", prixDe("jeton_valeur_fcfa") === "200");
  dire("un pack ne garde que sa quantite", prixDe("packs_jetons") === "5|50",
       prixDe("packs_jetons"));

  page = await (await lire("/mes-jetons", emp.cookie)).text();
  dire("l'employeur voit le nouveau pack", page.includes("5 jetons"));
  // 5 jetons a 200 FCFA : le prix se CALCULE, il ne se saisit pas.
  dire("le prix du pack suit la valeur du jeton", page.includes("1 000 FCFA"));
  dire("le grand pack aussi", page.includes("10 000 FCFA"));
  dire("son solde est reevalue au nouveau tarif", page.includes("2 000 FCFA"));

  // UN COMPTE NEUF, sans historique d'achat : c'est le seul endroit ou
  // l'on peut affirmer qu'un ancien pack a disparu. Sur les autres, le
  // nombre "30 jetons" reste ecrit dans la liste de leurs demandes
  // passees - et c'est normal, une demande refusee garde sa quantite.
  const neuf = await creerCompte("neuf", "employeur");
  const pageNeuve = await (await lire("/mes-jetons", neuf.cookie)).text();
  dire("un nouvel utilisateur voit exactement le meme prix", pageNeuve.includes("10 000 FCFA"));
  dire("et le meme pack", pageNeuve.includes("5 jetons"));
  dire("l'ancien pack n'est plus propose", !pageNeuve.includes("30 jetons"));
  dire("l'ancien prix n'est plus propose", !pageNeuve.includes("3 000 FCFA"));

  console.log("\n--- UN ACHAT DEJA PAYE GARDE SON MONTANT ---");
  dire("le pack paye 1 000 FCFA vaut toujours 1 000 FCFA",
       base.prepare("SELECT montant_fcfa FROM jetons_achats WHERE id = ?").get(achat.id).montant_fcfa === 1000);

  console.log("\n--- UN PRIX ABSURDE EST REFUSE ---");
  const zero = await poster("/admin/parametres", formPrix(0, [5]), eq.cookie);
  dire("une valeur de jeton nulle est refusee", zero.code === 400, String(zero.code));
  dire("rien n'a ete ecrit", prixDe("jeton_valeur_fcfa") === "200");

  const casse = await poster("/admin/parametres",
    formPrix(200, ["dix"]), eq.cookie);
  dire("un pack mal ecrit est refuse", casse.code === 400, String(casse.code));
  dire("les packs precedents sont intacts", prixDe("packs_jetons") === "5|50");

  // Tout vider fermerait la vente. C'est peut-etre voulu, jamais par accident.
  const vide = await poster("/admin/parametres", formPrix(200, []), eq.cookie);
  dire("supprimer tous les packs est refuse", vide.code === 400, String(vide.code));
  dire("les packs sont toujours la", prixDe("packs_jetons") === "5|50");

  // Deux fois le meme pack ne doit pas donner deux lignes identiques.
  await poster("/admin/parametres", formPrix(100, [10, 10, 30]), eq.cookie);
  dire("un pack en double est ramene a un seul", prixDe("packs_jetons") === "10|30",
       prixDe("packs_jetons"));

  console.log("\n--- QUI A CHANGE LE PRIX ---");
  // Partout ailleurs dans l'espace equipe, une decision garde le nom de
  // qui l'a prise. Un tarif est une decision : c'est ce que paient les
  // utilisateurs.
  const trace = base.prepare(`
    SELECT p.modifie_par, p.modifie_le, u.nom
    FROM parametres p LEFT JOIN utilisateurs u ON u.id = p.modifie_par
    WHERE p.cle = 'jeton_valeur_fcfa'
  `).get();
  dire("le nom de qui a change le prix est garde", trace.modifie_par === eq.id,
       String(trace.modifie_par));
  dire("la date aussi", typeof trace.modifie_le === "string");

  const ecranPrix = await (await lire("/admin/jetons", eq.cookie)).text();
  dire("l'equipe lit le dernier changement sur son ecran",
       ecranPrix.includes("Dernier changement"));
  dire("avec le nom du membre", ecranPrix.includes("Test eq"));

  console.log(SAUT + "--- SUPPRIMER LE COMPTE NE BLOQUE RIEN ---");
  // Le prix reste, la date reste, seul le nom disparait. Sans cette
  // regle, un compte d'equipe qui a touche un prix serait indestructible.
  const jetable = await creerCompte("jetable", "employeur");
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE id = ?").run(jetable.id);
  await poster("/admin/parametres", formPrix(150, [10]), jetable.cookie);
  base.prepare("DELETE FROM utilisateurs WHERE id = ?").run(jetable.id);
  const apres = base.prepare(
    "SELECT valeur FROM parametres WHERE cle = 'jeton_valeur_fcfa'").get();
  dire("le compte a pu etre supprime",
       !base.prepare("SELECT 1 FROM utilisateurs WHERE id = ?").get(jetable.id));
  dire("le prix qu'il a fixe reste applique", apres.valeur === "150", apres.valeur);

  // On ne verifie pas ce que la colonne contient : selon l'age de la
  // base, elle repasse a NULL ou garde un identifiant qui ne designe
  // plus personne. Ce qui compte est identique dans les deux cas -
  // l'ecran ne montre ni erreur ni case vide.
  const ecranSansNom = await (await lire("/admin/jetons", eq.cookie)).text();
  dire("l'ecran ne plante pas sans le nom", ecranSansNom.includes("Dernier changement"));
  dire("il dit que le compte a disparu", ecranSansNom.includes("compte supprim"));

  console.log(SAUT + "--- LES JETONS NE SE TRANSFERENT PAS ---");
  // Aucune route ne le permet. La verification est faite ici pour que
  // l'ajout d'une telle route casse la serie.
  const transfert = await poster("/mes-jetons/transferer",
    form({ vers: String(pre.id), quantite: "5" }), emp.cookie);
  dire("aucune route de transfert n'existe", transfert.code === 404, String(transfert.code));
  dire("le solde de l'autre est inchange", solde(pre.id) === 0, String(solde(pre.id)));

  console.log("\n--- NETTOYAGE ---");
  prixInitiaux.forEach((p) =>
    base.prepare("UPDATE parametres SET valeur = ?, modifie_par = NULL, modifie_le = NULL WHERE cle = ?")
      .run(p.valeur, p.cle));
  console.log("  prix d'origine remis, sans trace de test");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
