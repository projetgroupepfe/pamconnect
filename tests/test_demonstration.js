// Série : le scénario de démonstration se déroule-t-il vraiment ?
//
// Cette série ne teste pas une fonctionnalité : elle rejoue les SIX
// ÉCRANS de la fiche de soutenance, dans l'ordre, et vérifie que chacun
// affiche ce que la fiche annonce.
//
// Un scénario qui ne se déroule pas le jour J vaut moins que pas de
// scénario du tout. Tant que cette série passe, ce qui est écrit dans la
// fiche est vrai.
//
// Elle utilise des comptes jetables : les comptes de la démonstration
// (meena, asta) ne doivent surtout pas être consommés ici.
const fs = require("fs");
const path = require("path");
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const DOCS = path.join(PROJET, "data", "documents");
const M = "test-demo";
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
  const mail = (M + "-" + suffixe + "@example.com").toLowerCase();
  await poster("/inscription", form(Object.assign(
    { role, nom: "Demo " + suffixe, email: mail, motdepasse: "motdepasse123", quartier: "Bastos" },
    extra || {})));
  const c = await poster("/connexion", form({ email: mail, motdepasse: "motdepasse123" }));
  return { mail, cookie: c.cookie,
           id: base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(mail).id };
}

const fichier = (nom, octets, type) =>
  new File([new Uint8Array(octets)], nom, { type });

setTimeout(async () => {
  // L'employeur de la demonstration est prepare a l'avance : c'est ce
  // que la fiche conseille, pour ne jouer en direct que la verification
  // de la personne.
  const emp = await creerCompte("employeur", "employeur");
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE id = ?").run(emp.id);
  const eq = await creerCompte("equipe", "employeur");
  base.prepare("UPDATE utilisateurs SET est_admin = 1 WHERE id = ?").run(eq.id);
  const pre = await creerCompte("personne", "prestataire",
    { metier: "Garde d'enfants", tarif: "15000" });

  await poster("/annonces", form({ titre: M + " garde des enfants", metier: "Garde d'enfants",
    quartier: "Mvan", horaire: "Lundi a vendredi", prix: "20000" }), emp.cookie);
  const annonce = base.prepare(
    "SELECT id FROM annonces WHERE titre = ? ORDER BY id DESC LIMIT 1").get(M + " garde des enfants");

  console.log("\n--- LA VEILLE : LES TROIS CONDITIONS ---");
  // La fiche demande de verifier ces trois points avant le jour J.
  dire("la personne n'a jamais envoye de documents",
       base.prepare("SELECT statut_verification FROM utilisateurs WHERE id = ?")
         .get(pre.id).statut_verification === "non soumis");
  dire("la demande est ouverte",
       base.prepare("SELECT annulee FROM annonces WHERE id = ?").get(annonce.id).annulee === 0);
  dire("elle n'y a pas encore repondu",
       base.prepare("SELECT COUNT(*) n FROM candidatures WHERE annonce_id = ?").get(annonce.id).n === 0);

  console.log("\n--- ECRAN 1 : SANS VERIFICATION, ELLE NE PEUT PAS REPONDRE ---");
  const listeAnnonces = await (await lire("/annonces", pre.cookie)).text();
  dire("la demande apparait dans les annonces", listeAnnonces.includes(M + " garde des enfants"));
  dire("avec le bouton Je suis disponible", listeAnnonces.includes("Je suis disponible"));

  // LE PREMIER MOMENT FORT : la porte est fermee, et l'ecran dit
  // pourquoi. La protection ne va pas dans un seul sens - l'employeur
  // aussi a le droit de savoir qui entre chez lui.
  const porteFermee = await lire("/candidatures/nouvelle/" + annonce.id, pre.cookie);
  dire("l'ecran de reponse lui est refuse", porteFermee.status === 403, String(porteFermee.status));
  const texteRefus = await porteFermee.text();
  dire("la raison est celle qui la concerne",
       texteRefus.includes("il a le droit de savoir qui vient"));
  dire("et on lui propose de faire verifier son identite",
       texteRefus.includes("Faire vérifier mon identité"));

  // La regle est sur le serveur, pas dans la page.
  dire("envoyer la requete a la main ne change rien",
       (await poster("/candidatures", form({ annonceId: String(annonce.id) }), pre.cookie)).code === 403);
  dire("aucune reponse n'est enregistree",
       base.prepare("SELECT COUNT(*) n FROM candidatures WHERE annonce_id = ?").get(annonce.id).n === 0);

  console.log("\n--- ECRAN 2 : ELLE DEPOSE SES PAPIERS ---");
  const f = new FormData();
  f.append("cni", fichier("cni.jpg", 2000, "image/jpeg"));
  f.append("casier", fichier("casier.pdf", 3000, "application/pdf"));
  const envoi = await poster("/verification", f, pre.cookie);
  dire("les deux documents sont acceptes", envoi.code === 200, "code " + envoi.code);
  dire("l'ecran annonce le delai de 24 heures", envoi.corps.includes("24 heures"));
  dire("son statut passe en attente",
       base.prepare("SELECT statut_verification FROM utilisateurs WHERE id = ?")
         .get(pre.id).statut_verification === "en attente");
  dire("son profil dit depuis quand elle attend",
       (await (await lire("/mon-profil", pre.cookie)).text()).includes("Réponse attendue"));

  console.log("\n--- ECRAN 3 : L'EQUIPE VERIFIE, ET LES JETONS ARRIVENT ---");
  const espaceEquipe = await (await lire("/admin", eq.cookie)).text();
  dire("le dossier apparait", espaceEquipe.includes("Demo personne"));
  dire("avec depuis quand il attend", espaceEquipe.includes("Reçu il y a"));
  dire("la piece d'identite s'ouvre",
       (await lire("/admin/document/" + pre.id + "/cni", eq.cookie)).status === 200);
  dire("le casier aussi",
       (await lire("/admin/document/" + pre.id + "/casier", eq.cookie)).status === 200);
  dire("elle n'a aucun jeton avant la validation",
       base.prepare("SELECT COALESCE(SUM(quantite),0) n FROM jetons_mouvements WHERE utilisateur_id = ?")
         .get(pre.id).n === 0);

  await poster("/admin/verification",
    form({ utilisateurId: String(pre.id), decision: "valider" }), eq.cookie);
  dire("la validation passe le statut a verifie",
       base.prepare("SELECT statut_verification FROM utilisateurs WHERE id = ?")
         .get(pre.id).statut_verification === "verifie");

  // La fiche affirme que les documents sont supprimes du disque.
  const apresValidation = base.prepare("SELECT cni_fichier, casier_fichier FROM utilisateurs WHERE id = ?").get(pre.id);
  dire("les deux documents sont effaces du disque",
       apresValidation.cni_fichier === null && apresValidation.casier_fichier === null);

  // DEUXIEME MOMENT FORT : la validation credite les jetons offerts.
  // La cause et l'effet tiennent dans le meme geste.
  const soldeOffert = base.prepare(
    "SELECT COALESCE(SUM(quantite),0) n FROM jetons_mouvements WHERE utilisateur_id = ?").get(pre.id).n;
  dire("trois jetons lui sont offerts", soldeOffert === 3, String(soldeOffert));
  const pageJetons = await (await lire("/mes-jetons", pre.cookie)).text();
  dire("sa page dit d ou ils viennent", pageJetons.includes("Offerts à la vérification"));
  dire("et jusqu a quand ils durent", pageJetons.includes("à utiliser avant le"));
  dire("et ce qu'ils lui permettent", pageJetons.includes("répondre à 3 demandes"));

  console.log("\n--- ECRAN 4 : ELLE REPOND, ET VOIT CE QU'ELLE TOUCHERA ---");
  const ecranReponse = await (await lire("/candidatures/nouvelle/" + annonce.id, pre.cookie)).text();
  dire("l'ecran s'ouvre maintenant", ecranReponse.includes("Confirmer ma réponse"));
  dire("il montre le prix annonce", ecranReponse.includes("20 000"));
  dire("la commission", ecranReponse.includes("2 000"));
  dire("et ce qu'elle touchera", ecranReponse.includes("18 000"));

  // ELLE NE DEMANDE RIEN : c est l employeur qui a annonce ce prix.
  // "Vous demandez" n est juste que sur son propre profil.
  dire("le prix est presente comme celui de l employeur",
       ecranReponse.includes("employeur paie"));
  dire("et jamais comme le sien", !ecranReponse.includes("Vous demandez"));

  // TROISIEME MOMENT FORT : le prix de la reponse, annonce AVANT l'envoi.
  dire("le cout de la reponse est annonce avant", ecranReponse.includes("Envoyer cette réponse"));
  dire("en jetons et en francs", ecranReponse.includes("1 jeton (100 FCFA)"));
  dire("ce qu'il lui restera aussi", ecranReponse.includes("Il vous restera"));

  const reponse = await poster("/candidatures", form({ annonceId: String(annonce.id) }), pre.cookie);
  const cand = base.prepare("SELECT id FROM candidatures WHERE annonce_id = ?").get(annonce.id);
  dire("sa reponse est enregistree", Boolean(cand));
  dire("un jeton a ete preleve",
       base.prepare("SELECT COALESCE(SUM(quantite),0) n FROM jetons_mouvements WHERE utilisateur_id = ?")
         .get(pre.id).n === 2);
  dire("l'ecran le lui dit", reponse.corps.includes("Il vous reste"));
  dire("le prelevement porte le nom de la demande",
       String(base.prepare(`SELECT detail FROM jetons_mouvements
                            WHERE utilisateur_id = ? AND motif = 'candidature'`)
         .get(pre.id).detail).includes("garde des enfants"));

  console.log("\n--- ECRAN 5 : L'EMPLOYEUR LA CHOISIT ---");
  const profilApres = await (await lire("/mon-profil", emp.cookie)).text();
  dire("il voit la candidature", profilApres.includes("Demo personne"));
  dire("le badge est vert", profilApres.includes("Identité vérifiée"));
  dire("le bouton Choisir cette personne existe",
       profilApres.includes("Choisir cette personne"));

  const confirmation = await (await lire("/candidatures/" + cand.id + "/confirmer", emp.cookie)).text();
  dire("l'ecran de confirmation s'ouvre", confirmation.includes("quelqu'un a été choisi"));

  await poster("/candidatures/statut",
    form({ candidatureId: String(cand.id), statut: "acceptee" }), emp.cookie);
  dire("elle est retenue",
       base.prepare("SELECT statut FROM candidatures WHERE id = ?").get(cand.id).statut === "acceptee");
  dire("une pastille apparait dans son menu",
       (await (await lire("/annonces", pre.cookie)).text()).includes('class="pastille"'));
  dire("et sa candidature dit qu'elle est acceptee",
       (await (await lire("/mon-profil", pre.cookie)).text()).includes("Votre candidature a été acceptée"));

  console.log("\n--- ECRAN 6 : L'ARGENT ---");
  const compteEmp = await (await lire("/mon-compte", emp.cookie)).text();
  dire("l'employeur voit sa somme bloquee", compteEmp.includes("Bloqué par PamConnect"));
  dire("avec le rappel de declarer", compteEmp.includes("déclarez-le à PamConnect"));

  await poster("/candidatures/" + cand.id + "/terminer", form({}), emp.cookie);

  const comptePre = await (await lire("/mon-compte", pre.cookie)).text();
  dire("elle a recu 18 000 FCFA", comptePre.includes("18 000"));
  dire("avec le detail de la commission", comptePre.includes("2 000"));
  dire("la discussion rejoint les services termines",
       (await (await lire("/messages", pre.cookie)).text()).includes("Services terminés"));

  const versementsEquipe = await (await lire("/admin/versements", eq.cookie)).text();
  const attendent = versementsEquipe.slice(0, versementsEquipe.indexOf("Sommes dénouées"));
  dire("la somme quitte les sommes bloquees de l'equipe",
       !attendent.includes(M + " garde des enfants"));
  dire("mais reste dans la trace", versementsEquipe.includes(M + " garde des enfants"));

  console.log("\n--- NETTOYAGE ---");
  // Les documents ont deja ete effaces par la validation ; on nettoie au
  // cas ou la serie se serait arretee avant.
  for (const u of base.prepare("SELECT cni_fichier, casier_fichier FROM utilisateurs WHERE email LIKE ?").all("%" + M + "%")) {
    [u.cni_fichier, u.casier_fichier].forEach((nom) => {
      if (nom && fs.existsSync(path.join(DOCS, nom))) fs.unlinkSync(path.join(DOCS, nom));
    });
  }
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
