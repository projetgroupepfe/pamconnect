// Série : l'employeur renonce à la personne qu'il avait choisie, l'équipe
// libère la demande.
//
// LE CAS. L'employeur choisit quelqu'un ; l'équipe appelle cette personne,
// note son prix, puis appelle l'employeur, qui trouve le prix trop élevé.
// Avant, la personne restait « choisie » et la demande restait fermée :
// personne ne pouvait plus y répondre et l'employeur ne pouvait pas en
// choisir une autre.
//
// Maintenant : l'équipe a un bouton « L'employeur renonce à cette personne ».
// La personne est écartée, les autres reprennent leur place, la demande
// rouvre, et l'employeur peut choisir de nouveau.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-liberer";
let ok = 0, ko = 0;

const dire = (nom, cond, detail) => {
  if (cond) { ok++; console.log("  OK    | " + nom); }
  else { ko++; console.log("  ECHEC | " + nom + (detail ? "   -> " + detail : "")); }
};

const form = (o) => new URLSearchParams(o);
const lire = (chemin, cookie) =>
  fetch(RACINE + chemin, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
const texte = async (chemin, cookie) => (await lire(chemin, cookie)).text();
const plat = (t) => t.replace(/\s+/g, " ");

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

const statutDe = (annonceId, personneId) => {
  const c = base.prepare("SELECT statut FROM candidatures WHERE annonce_id = ? AND prestataire_id = ?")
    .get(annonceId, personneId);
  return c ? c.statut : null;
};
const fermee = (annonceId) =>
  base.prepare("SELECT annulee FROM annonces WHERE id = ?").get(annonceId).annulee === 1;

setTimeout(async () => {
  const emp = await creerCompte("emp", "employeur");
  const a = await creerCompte("a", "prestataire", { metier: "menagere", tarif: "20000" });
  const b = await creerCompte("b", "prestataire", { metier: "menagere", tarif: "15000" });
  const eq = await creerCompte("eq", "employeur");
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE email = ?").run(eq.mail.toLowerCase());
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE email LIKE ?")
    .run("%" + M + "%");
  for (const p of [a, b]) {
    base.prepare(`INSERT INTO jetons_mouvements (utilisateur_id, quantite, nature, motif, detail)
                  VALUES (?, 5, 'achete', 'achat', 'Credit de test')`).run(p.id);
  }

  const publier = async (nom) => {
    await poster("/annonces", form({ titre: M + " " + nom, metier: "menagere",
      quartier: "Bastos", arrondissement: "Yaounde 1", horaire: "Lundi 8h" }), emp.cookie);
    return base.prepare("SELECT id FROM annonces WHERE titre = ? ORDER BY id DESC LIMIT 1")
      .get(M + " " + nom).id;
  };
  const repondre = (annonceId, personne) =>
    poster("/candidatures", form({ annonceId: String(annonceId) }), personne.cookie);
  const idCandidature = (annonceId, personne) =>
    base.prepare("SELECT id FROM candidatures WHERE annonce_id = ? AND prestataire_id = ?")
      .get(annonceId, personne.id).id;
  const liberer = (annonceId, cookie) =>
    poster("/admin/demandes/" + annonceId + "/liberer", form({}), cookie);
  const ouvrirFiche = (annonceId, personne, prix) =>
    poster("/admin/mises-en-relation",
      form({ annonceId: String(annonceId), prestataireId: String(personne.id), prix: String(prix) }), eq.cookie);
  const reponse = (annonceId, decision) => {
    const f = base.prepare("SELECT id FROM mises_en_relation WHERE annonce_id = ? AND statut = 'en cours'")
      .get(annonceId);
    return poster("/admin/mises-en-relation/" + f.id + "/reponse", form({ decision }), eq.cookie);
  };
  const carte = async (titre) => {
    const page = plat(await texte("/admin/mises-en-relation", eq.cookie));
    const debut = page.indexOf(titre);
    const fin = page.indexOf("<h3>", debut + 1);
    return debut === -1 ? "" : page.slice(debut, fin === -1 ? undefined : fin);
  };

  console.log("\n--- 1. LE CAS COMPLET : CHOIX, PRIX REFUSE, DEMANDE LIBEREE ---");
  const d1 = await publier("un");
  await repondre(d1, a);
  await repondre(d1, b);
  const candA = idCandidature(d1, a);
  const candB = idCandidature(d1, b);
  await poster("/candidatures/statut", form({ candidatureId: String(candA), statut: "acceptee" }), emp.cookie);
  dire("l'employeur choisit A : A est retenue", statutDe(d1, a.id) === "acceptee");
  dire("B est écartée d'office", statutDe(d1, b.id) === "refusee");
  dire("la demande est fermée", fermee(d1));

  await ouvrirFiche(d1, a, 20000);
  await reponse(d1, "refuse");
  dire("l'employeur refuse le prix : rien ne bouge tout seul, A reste choisie",
       statutDe(d1, a.id) === "acceptee" && fermee(d1));
  const avant = await carte(M + " un");
  dire("l'équipe voit le bouton pour libérer la demande",
       avant.includes("/admin/demandes/" + d1 + "/liberer") &&
       avant.includes("L'employeur renonce à cette personne"));
  dire("l'équipe voit le prix refusé", avant.includes("Prix déjà refusés"));

  const r = await liberer(d1, eq.cookie);
  dire("l'équipe libère la demande", r.code === 302, "code " + r.code);
  dire("A est écartée", statutDe(d1, a.id) === "refusee");
  dire("B retrouve sa place", statutDe(d1, b.id) === "en attente");
  dire("la demande est de nouveau ouverte", !fermee(d1));
  const listeB = await texte("/annonces", b.cookie);
  dire("elle réapparaît dans la liste publique", listeB.includes(M + " un"));

  console.log("\n--- 2. L'EMPLOYEUR ET L'EQUIPE VOIENT LE NOUVEL ETAT ---");
  const mesDemandes = plat(await texte("/mes-demandes", emp.cookie));
  dire("l'employeur lit pourquoi sa demande est rouverte",
       mesDemandes.includes("Le prix proposé pour <strong>Test a</strong> n'a pas convenu") &&
       mesDemandes.includes("vous pouvez choisir une autre personne"));
  const apres = await carte(M + " un");
  dire("l'équipe ne voit plus « choisie par l'employeur »", !apres.includes("Choisie par l'employeur"));
  dire("le bouton de libération a disparu", !apres.includes("/liberer"));
  dire("B est sur la liste d'appels de l'équipe", apres.includes("Test b"));
  dire("A n'y est plus : l'employeur y a renoncé", !apres.includes("<strong>Test a</strong>"));

  console.log("\n--- 3. L'EMPLOYEUR PEUT CHOISIR UNE AUTRE PERSONNE ---");
  await poster("/candidatures/statut", form({ candidatureId: String(candB), statut: "acceptee" }), emp.cookie);
  dire("B est choisie", statutDe(d1, b.id) === "acceptee");
  dire("la demande est de nouveau fermée", fermee(d1));
  await ouvrirFiche(d1, b, 15000);
  await reponse(d1, "accepte");
  const conclue = base.prepare("SELECT statut FROM mises_en_relation WHERE annonce_id = ? AND prestataire_id = ?")
    .get(d1, b.id);
  dire("l'employeur accepte le prix de B : la mise en relation est conclue", conclue.statut === "acceptee");

  console.log("\n--- 4. ON NE LIBERE PAS N'IMPORTE QUOI ---");
  const r2 = await liberer(d1, eq.cookie);
  dire("un prix accepté ne se libère plus", r2.code === 409, "code " + r2.code);
  dire("B reste choisie", statutDe(d1, b.id) === "acceptee" && fermee(d1));

  const d2 = await publier("deux");
  await repondre(d2, a);
  const r3 = await liberer(d2, eq.cookie);
  dire("personne n'est choisie : rien à libérer", r3.code === 409, "code " + r3.code);
  dire("la réponse de A n'a pas bougé", statutDe(d2, a.id) === "en attente");

  await poster("/candidatures/statut",
    form({ candidatureId: String(idCandidature(d2, a)), statut: "acceptee" }), emp.cookie);
  await ouvrirFiche(d2, a, 20000);
  const r4 = await liberer(d2, eq.cookie);
  dire("un prix en attente de réponse : on note d'abord la réponse", r4.code === 409, "code " + r4.code);
  dire("A reste choisie", statutDe(d2, a.id) === "acceptee" && fermee(d2));

  const r5 = await liberer(d2, emp.cookie);
  dire("un employeur ne peut pas libérer lui-même", r5.code === 403, "code " + r5.code);
  const r6 = await liberer(d2, a.cookie);
  dire("une personne non plus", r6.code === 403, "code " + r6.code);
  const r7 = await liberer(d2, null);
  dire("un visiteur non plus", r7.code === 302 || r7.code === 401 || r7.code === 403, "code " + r7.code);
  dire("rien n'a bougé", statutDe(d2, a.id) === "acceptee" && fermee(d2));

  const r8 = await liberer(99999999, eq.cookie);
  dire("une demande inconnue répond 404", r8.code === 404, "code " + r8.code);

  console.log("\n--- 5. UNE PERSONNE REFUSEE PAR L'EMPLOYEUR RESTE REFUSEE ---");
  const c = await creerCompte("c", "prestataire", { metier: "menagere", tarif: "10000" });
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE id = ?").run(c.id);
  base.prepare(`INSERT INTO jetons_mouvements (utilisateur_id, quantite, nature, motif, detail)
                VALUES (?, 5, 'achete', 'achat', 'Credit de test')`).run(c.id);
  const d3 = await publier("trois");
  await repondre(d3, a);
  await repondre(d3, b);
  await repondre(d3, c);
  // L'employeur refuse C lui-même, bien avant de choisir : ce refus n'a rien
  // à voir avec le choix et ne doit pas être annulé par la libération.
  await poster("/candidatures/statut",
    form({ candidatureId: String(idCandidature(d3, c)), statut: "refusee" }), emp.cookie);
  base.prepare(`UPDATE candidatures SET statut_change_le = datetime('now', '-1 hour')
                WHERE annonce_id = ? AND prestataire_id = ?`).run(d3, c.id);
  await poster("/candidatures/statut",
    form({ candidatureId: String(idCandidature(d3, a)), statut: "acceptee" }), emp.cookie);
  await ouvrirFiche(d3, a, 20000);
  await reponse(d3, "refuse");
  await liberer(d3, eq.cookie);
  dire("A est écartée", statutDe(d3, a.id) === "refusee");
  dire("B reprend sa place", statutDe(d3, b.id) === "en attente");
  dire("C, refusée à part par l'employeur, reste refusée", statutDe(d3, c.id) === "refusee");
  dire("la demande est ouverte", !fermee(d3));

  const supprimes = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?")
    .run("%" + M + "%").changes;
  console.log("  ----- | nettoyage : " + supprimes + " comptes de test supprimés");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 500);
