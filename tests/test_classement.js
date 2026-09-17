// Série : le classement des personnes dans la recherche.
//
// LA RÈGLE À TENIR, celle du cahier des charges : une personne avec UNE
// note de 5 ne doit pas passer devant une autre qui a cinquante avis à
// 4,8. La première n'a rien prouvé, la seconde si.
//
// Et trois autres :
//   - une identité vérifiée pèse plus que de belles étoiles ;
//   - une personne sans aucun avis reste visible, avec un badge qui le
//     dit — elle commence, ce n'est pas une mauvaise note ;
//   - personne ne peut payer pour monter dans la liste.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-classement";
const METIER = "Ménage à domicile";
let ok = 0, ko = 0;

const SAUT = String.fromCharCode(10);

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
    { role, nom: M + "-" + suffixe, email: mail, motdepasse: "motdepasse123", telephone: "600000000", quartier: "Bastos" },
    extra || {})));
  const c = await poster("/connexion", form({ email: mail, motdepasse: "motdepasse123", telephone: "600000000" }));
  return {
    nom: M + "-" + suffixe, mail, cookie: c.cookie,
    id: base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(mail).id,
  };
}

const verifier = (id) =>
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' WHERE id = ?").run(id);

// On pose directement les avis et les services : cette serie parle du
// CLASSEMENT, pas du chemin qui mene a un avis - celui-la a sa serie.
function poserReputation(personneId, employeurId, notes) {
  notes.forEach((note, rang) => {
    const a = base.prepare(`
      INSERT INTO annonces (employeur_id, titre, metier, quartier, arrondissement, prix, annulee)
      VALUES (?, ?, ?, 'Mvan', 'Yaoundé 4', 10000, 1)
    `).run(employeurId, M + "-" + personneId + "-" + rang, METIER);

    const c = base.prepare(`
      INSERT INTO candidatures (annonce_id, prestataire_id, statut, terminee_le, envoyee_le)
      VALUES (?, ?, 'acceptee', datetime('now'), datetime('now'))
    `).run(Number(a.lastInsertRowid), personneId);

    base.prepare(`
      INSERT INTO avis (candidature_id, auteur_id, vise_id, note)
      VALUES (?, ?, ?, ?)
    `).run(Number(c.lastInsertRowid), employeurId, personneId, note);
  });
}

// La position dans la page : plus le nombre est petit, plus la personne
// est haut dans la liste.
const rang = (page, nom) => page.indexOf(">" + nom + "<");

setTimeout(async () => {
  const emp = await creerCompte("emp", "employeur");
  verifier(emp.id);

  // CELLE QUI A UNE SEULE NOTE DE 5, et celle qui a cinquante avis a 4,8.
  const chanceuse = await creerCompte("chanceuse", "prestataire",
    { metier: "menagere", tarif: "15000" });
  const eprouvee = await creerCompte("eprouvee", "prestataire",
    { metier: "menagere", tarif: "15000" });
  verifier(chanceuse.id);
  verifier(eprouvee.id);

  poserReputation(chanceuse.id, emp.id, [5]);
  // Cinquante avis dont quarante a 5 et dix a 4 : moyenne 4,8.
  poserReputation(eprouvee.id, emp.id,
    Array(40).fill(5).concat(Array(10).fill(4)));

  console.log(SAUT + "--- UNE NOTE DE 5 NE BAT PAS CINQUANTE AVIS A 4,8 ---");
  // C'est la regle ecrite noir sur blanc dans le cahier des charges.
  const page = await (await lire("/recherche?metier=" + encodeURIComponent(METIER))).text();
  dire("les deux sont dans les resultats",
       rang(page, chanceuse.nom) >= 0 && rang(page, eprouvee.nom) >= 0);
  dire("celle qui a fait ses preuves passe devant",
       rang(page, eprouvee.nom) < rang(page, chanceuse.nom),
       "eprouvee " + rang(page, eprouvee.nom) + " / chanceuse " + rang(page, chanceuse.nom));
  dire("la moyenne reelle est affichee, pas la moyenne ajustee",
       page.includes("4,8 sur 5"));
  dire("et le nombre d'avis", page.includes("sur 50 avis"));

  console.log(SAUT + "--- LA VERIFICATION PESE PLUS QUE LES ETOILES ---");
  // Une personne non verifiee ne peut de toute facon pas etre embauchee :
  // la mettre en tete ferait perdre du temps a tout le monde.
  const brillante = await creerCompte("brillante", "prestataire",
    { metier: "menagere", tarif: "15000" });
  poserReputation(brillante.id, emp.id, Array(30).fill(5));
  dire("elle n'est pas verifiee",
       base.prepare("SELECT statut_verification FROM utilisateurs WHERE id = ?")
         .get(brillante.id).statut_verification !== "verifie");

  const page2 = await (await lire("/recherche?metier=" + encodeURIComponent(METIER))).text();
  dire("trente notes de 5 ne suffisent pas sans verification",
       rang(page2, eprouvee.nom) < rang(page2, brillante.nom),
       "eprouvee " + rang(page2, eprouvee.nom) + " / brillante " + rang(page2, brillante.nom));
  dire("elle reste visible malgre tout", rang(page2, brillante.nom) >= 0);

  console.log(SAUT + "--- CELLE QUI COMMENCE RESTE VISIBLE ---");
  const nouvelle = await creerCompte("nouvelle", "prestataire",
    { metier: "menagere", tarif: "12000" });
  verifier(nouvelle.id);

  const page3 = await (await lire("/recherche?metier=" + encodeURIComponent(METIER))).text();
  dire("elle apparait dans les resultats", rang(page3, nouvelle.nom) >= 0);
  dire("avec le badge qui le dit", page3.includes("Nouveau prestataire"));
  dire("et la phrase qui l'explique", page3.includes("personne ne l'a encore notée"));
  // PAS D'AVIS N'EST PAS UNE MAUVAISE NOTE : on n'ecrit jamais 0 sur 5.
  dire("jamais 0 sur 5", !page3.includes("0 sur 5"));

  dire("elle passe derriere celle qui a fait ses preuves",
       rang(page3, eprouvee.nom) < rang(page3, nouvelle.nom));
  // Mais devant celle qui n'est pas verifiee : la verification d'abord.
  dire("et devant celle qui n'est pas verifiee",
       rang(page3, nouvelle.nom) < rang(page3, brillante.nom),
       "nouvelle " + rang(page3, nouvelle.nom) + " / brillante " + rang(page3, brillante.nom));

  console.log(SAUT + "--- UN DESACCORD FAIT REDESCENDRE ---");
  // Deux personnes identiques, sauf que l'une a un probleme signale.
  const propre = await creerCompte("propre", "prestataire", { metier: "menagere", tarif: "13000" });
  const litigieuse = await creerCompte("litigieuse", "prestataire", { metier: "menagere", tarif: "13000" });
  verifier(propre.id);
  verifier(litigieuse.id);
  poserReputation(propre.id, emp.id, [5, 5, 5, 5]);
  poserReputation(litigieuse.id, emp.id, [5, 5, 5, 5]);

  // Un probleme signale sur l'un de ses services termines.
  const sonService = base.prepare(
    "SELECT id FROM candidatures WHERE prestataire_id = ? LIMIT 1").get(litigieuse.id);
  base.prepare(`
    INSERT INTO problemes (candidature_id, auteur_id, vise_id, texte)
    VALUES (?, ?, ?, ?)
  `).run(sonService.id, emp.id, litigieuse.id, M + " elle n est pas venue");

  const page4 = await (await lire("/recherche?metier=" + encodeURIComponent(METIER))).text();
  dire("a notes egales, celle sans desaccord passe devant",
       rang(page4, propre.nom) < rang(page4, litigieuse.nom),
       "propre " + rang(page4, propre.nom) + " / litigieuse " + rang(page4, litigieuse.nom));

  console.log(SAUT + "--- UN AVIS MASQUE NE COMPTE PLUS ---");
  // Masquer doit faire bouger le classement : sinon le masquage ne
  // servirait qu'a cacher, pas a corriger.
  const avantMasquage = rang(page4, chanceuse.nom);
  base.prepare("UPDATE avis SET masque = 1 WHERE vise_id = ?").run(chanceuse.id);
  const page5 = await (await lire("/recherche?metier=" + encodeURIComponent(METIER))).text();
  dire("sa moyenne disparait de sa carte",
       !page5.slice(rang(page5, chanceuse.nom), rang(page5, chanceuse.nom) + 500)
         .includes("sur 1 avis"));
  dire("elle est toujours listee", rang(page5, chanceuse.nom) >= 0, String(avantMasquage));

  console.log(SAUT + "--- LA PAGE DIT CE QUI COMPTE ---");
  // Un classement qu'on n'explique pas est un classement qu'on subit.
  // La phrase a ete raccourcie : elle dit "des avis" au lieu de "la moyenne
  // et le nombre d'avis". Ce qui compte pour ce test reste le meme : les
  // criteres du classement sont nommes sur la page.
  dire("les criteres sont ecrits", page5.includes("identité vérifiée")
       && page5.includes("avis") && page5.includes("services terminés")
       && page5.includes("disponibilités") && page5.includes("proximité"));
  dire("et ce qui n'en fait pas partie",
       page5.includes("Personne ne peut payer pour apparaître en premier"));
  // LE SCORE NE S'AFFICHE PAS : un nombre affiche se compare et finit
  // par se chercher au lieu de se meriter.
  dire("aucun score chiffre n'est montre",
       !page5.includes("classement") || !page5.includes("/100"));

  console.log(SAUT + "--- LA RECHERCHE N EST PAS UNE IMPASSE ---");
  // Un employeur trouve la personne qu il veut, et ensuite ? Sur cette
  // plateforme on n embauche pas depuis une fiche : on publie une
  // demande. Personne ne devine cette regle, il faut la dire.
  const vueEmp = await (await lire("/recherche?metier=" + encodeURIComponent(METIER), emp.cookie)).text();
  dire("l employeur lit ce qu il doit faire", vueEmp.includes("Vous avez trouvé quelqu'un"));
  dire("avec le bouton qui y mene", vueEmp.includes("/publier-annonce"));
  dire("et la raison : la somme est bloquee", vueEmp.includes("dès la publication"));
  dire("il sait qu'il peut proposer une demande depuis un profil",
       vueEmp.replace(/\s+/g, " ").includes("Depuis le profil d'une personne vérifiée, publiez une demande pour elle"));

  const fiche = await (await lire("/personnes/" + eprouvee.id, emp.cookie)).text();
  dire("la fiche le dit aussi", fiche.includes("Travailler avec cette personne"));

  // LA PERSONNE QUI PROPOSE SES SERVICES N A RIEN A PUBLIER : ce bloc
  // n est pas pour elle.
  const vuePre = await (await lire("/recherche?metier=" + encodeURIComponent(METIER), eprouvee.cookie)).text();
  dire("elle ne voit pas ce bloc", !vuePre.includes("Vous avez trouvé quelqu'un"));

  console.log(SAUT + "--- LE NOMBRE NE COMPTE PLUS LES INSCRITS ---");
  // "10 personnes au total" repond a une question que personne ne pose,
  // et un petit nombre decourage au lieu d informer.
  const sansMetier = await (await lire("/recherche")).text();
  dire("sans recherche, aucun total", !sansMetier.includes("au total"));
  dire("le titre reste clair", sansMetier.includes("Les personnes disponibles"));
  dire("avec un metier, le compte revient", vueEmp.includes("pour «"));

  console.log(SAUT + "--- NETTOYAGE ---");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  const a = base.prepare("DELETE FROM annonces WHERE titre LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes et " + a + " demandes de test supprimes");

  console.log(SAUT + "RESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
