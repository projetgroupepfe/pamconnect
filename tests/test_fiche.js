// Série : la fiche publique d'une personne.
//
// Le point verifie ici est la CONFIDENTIALITE : cette page est ouverte a
// tous, y compris aux visiteurs non connectes. Ce qui en sort a ete
// choisi colonne par colonne, et rien d'autre ne doit fuir.
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const RACINE = "http://127.0.0.1:3999";
const M = "test-fiche";
let ok = 0, ko = 0;

const dire = (nom, cond, detail) => {
  if (cond) { ok++; console.log("  OK    | " + nom); }
  else { ko++; console.log("  ECHEC | " + nom + (detail ? "   -> " + detail : "")); }
};

const form = (o) => new URLSearchParams(o);
const lire = (chemin, cookie) =>
  fetch(RACINE + chemin, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });

async function creerCompte(suffixe, role, extra) {
  const mail = M + "-" + suffixe + "@example.com";
  const corps = form(Object.assign(
    { role, nom: "Test " + suffixe, email: mail, motdepasse: "motdepasse123", quartier: "Bastos" },
    extra || {}));
  if (extra && extra.creneaux) extra.creneaux.forEach((c) => corps.append("disponibilites", c));
  await fetch(RACINE + "/inscription", { method: "POST", body: corps });
  const r = await fetch(RACINE + "/connexion", { method: "POST", redirect: "manual",
    body: form({ email: mail, motdepasse: "motdepasse123" }) });
  return { mail, cookie: r.headers.getSetCookie()[0].split(";")[0] };
}

setTimeout(async () => {
  const pre = await creerCompte("pre", "prestataire", {
    metier: "menagere", tarif: "20000", date_naissance: "1990-03-08",
    experience_annees: "6", creneaux: ["lundi-matin", "samedi-apresmidi"] });
  const u = base.prepare("SELECT * FROM utilisateurs WHERE email = ?").get(pre.mail);
  const emp = await creerCompte("emp", "employeur");

  console.log("\n--- LA FICHE EST OUVERTE A TOUS ---");
  dire("un visiteur non connecte peut la consulter",
       (await lire("/personnes/" + u.id)).status === 200);
  dire("un employeur aussi", (await lire("/personnes/" + u.id, emp.cookie)).status === 200);
  dire("un profil inexistant repond 404", (await lire("/personnes/999999")).status === 404);

  console.log("\n--- CE QU'ELLE MONTRE ---");
  const page = await (await lire("/personnes/" + u.id)).text();
  dire("le nom", page.includes("Test pre"));
  dire("le metier officiel", page.includes("Ménage à domicile"));
  // L'age n'est pas public : cette page est ouverte a tout le monde.
  dire("la tranche d'age n'est PAS montree a un visiteur",
       !page.includes("35 - 44 ans"));
  dire("l'experience", page.includes("6 ans d&#39;expérience"));
  dire("les disponibilites, jour par jour", page.includes("Samedi") && page.includes("Après-midi"));
  dire("le quartier", page.includes("Bastos"));
  // Le tarif du profil n'est plus ce qui sera paye : c'est le prix de
  // l'annonce qui compte. La fiche l'annonce comme une indication, sans
  // calcul de commission - le calcul se fait sur le prix, ailleurs.
  dire("le tarif demande est affiche", page.includes("20 000 FCFA"));
  dire("il est presente comme une indication",
       page.includes("celui que vous annoncez dans votre demande"));
  // La fiche ne suppose pas que la personne est une femme : son genre
  // n'est ni connu de la plateforme, ni demande.
  dire("la fiche ne suppose aucun genre",
       !page.includes("qu'elle souhaite") && !page.includes("Le tarif qu'elle demande"));
  dire("et elle a perdu le tiret long", !page.includes("votre demande —"));
  dire("aucun calcul de commission sur ce montant", !page.includes("Commission PamConnect"));
  // LES AVIS EXISTENT DEPUIS L ETAPE 5. La fiche annoncait le contraire,
  // juste au-dessus d une note affichee : le texte a ete retire.
  dire("la fiche ne dit plus que les avis manquent",
       !page.includes("ne sont pas encore"));
  dire("elle dit ce que la personne a fait, ou qu elle commence",
       page.includes("Nouveau prestataire") || page.includes("Pas encore not")
       || page.includes("sur 5"));

  console.log("\n--- CE QU'ELLE NE MONTRE PAS ---");
  dire("jamais l'adresse email", !page.includes(pre.mail));
  dire("jamais la date de naissance complete", !page.includes("1990-03-08"));
  dire("l'age n'apparait pas non plus pour un employeur qui n'a pas embauche",
       !(await (await lire("/personnes/" + u.id, emp)).text()).includes("35 - 44 ans"));
  dire("aucun nom de fichier d'identite",
       !page.includes(".jpg") && !page.includes(".png") && !page.includes(".pdf"));

  console.log("\n--- QUI N'A PAS DE FICHE PUBLIQUE ---");
  dire("un employeur n'en a pas", (await lire("/personnes/" + base.prepare(
    "SELECT id FROM utilisateurs WHERE email = ?").get(emp.mail).id)).status === 404);

  const eq = await creerCompte("eq", "employeur");
  const idEq = base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(eq.mail).id;
  base.prepare("UPDATE utilisateurs SET est_admin = 1, role = 'prestataire' WHERE id = ?").run(idEq);
  dire("un compte d'equipe non plus", (await lire("/personnes/" + idEq)).status === 404);

  // Une personne suspendue disparait de la vue publique - mais son compte
  // et ses donnees restent en base pour un eventuel litige.
  base.prepare("UPDATE utilisateurs SET suspendu = 1 WHERE id = ?").run(u.id);
  dire("un compte suspendu n'est plus consultable",
       (await lire("/personnes/" + u.id)).status === 404);
  dire("mais son compte existe toujours",
       Boolean(base.prepare("SELECT id FROM utilisateurs WHERE id = ?").get(u.id)));
  base.prepare("UPDATE utilisateurs SET suspendu = 0 WHERE id = ?").run(u.id);

  console.log("\n--- ON Y ACCEDE DEPUIS LES DEUX ECRANS QUI COMPTENT ---");
  const recherche = await (await lire("/recherche?metier=menage", emp.cookie)).text();
  dire("depuis la recherche", recherche.includes("/personnes/" + u.id));

  // Publier une demande ET y repondre exigent une identite verifiee.
  // Ce n'est pas le sujet de cette serie : on la donne a tous les
  // comptes qu'elle cree.
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' "
    + "WHERE email LIKE ?").run("%" + M + "%");

  await fetch(RACINE + "/annonces", { method: "POST", headers: { Cookie: emp.cookie },
    redirect: "manual", body: form({ titre: M + " demande", metier: "menagere",
      quartier: "Mvan", horaire: "Lundi 8h", prix: "10000" }) });
  const annonce = base.prepare("SELECT id FROM annonces WHERE titre LIKE ? ORDER BY id DESC LIMIT 1").get("%" + M + "%");
  await fetch(RACINE + "/candidatures", { method: "POST", headers: { Cookie: pre.cookie },
    redirect: "manual", body: form({ annonceId: String(annonce.id) }) });

  const profilEmp = await (await lire("/mon-profil", emp.cookie)).text();
  dire("depuis la candidature recue", profilEmp.includes("/personnes/" + u.id));
  dire("la candidature montre l'experience", profilEmp.includes("6 ans d&#39;expérience"));
  dire("et les jours de disponibilite", profilEmp.includes("lundi, samedi"));

  console.log("\n--- LA PLATEFORME NE VERIFIE PAS LES COMPETENCES ---");
  // Une famille qui lit "Identite et casier verifies" a cote du mot
  // "Jardinage" peut croire que le jardinage aussi a ete controle. Il ne
  // l'a pas ete. Le silence sur ce point serait plus grave qu'une limite
  // annoncee : c'est une question de responsabilite, pas d'affichage.
  const ecrans = [
    ["/personnes/" + u.id, null, "la fiche publique"],
    ["/recherche?metier=menage", emp.cookie, "la recherche"],
    ["/", null, "la page d'accueil"],
    ["/employeur", null, "la page employeur"],
  ];
  for (const [chemin, cookie, nom] of ecrans) {
    const p = await (await lire(chemin, cookie)).text();
    dire(nom + " dit ce qui n'est pas verifie",
         // Chaque ecran a sa formulation, plus ou moins courte. Ce qui est
    // teste, c'est qu'AUCUN ne se taise sur la limite.
    /pas les compétences|pas ce qu'elle sait faire|ne veut pas dire compétences|n'est pas vérifié/.test(p));
  }

  const fichePub = await (await lire("/personnes/" + u.id)).text();
  dire("la fiche explique ce que le badge vert signifie",
       fichePub.includes("pièce d'identité et le casier"));
  dire("elle dit que le metier n'est pas verifie",
       fichePub.includes("métier n'est pas vérifié"));
  // Fragment court : une phrase longue est coupee par un retour a la
  // ligne dans le gabarit, et la recherche echoue sur du texte pourtant
  // present.
  dire("et renvoie a la discussion pour poser des questions",
       fichePub.includes("Posez vos questions avant de choisir"));

  // La plateforme ne doit jamais laisser croire l'inverse.
  for (const [chemin, cookie, nom] of ecrans) {
    const p = await (await lire(chemin, cookie)).text();
    dire(nom + " ne promet jamais de competences verifiees",
         !/compétences vérifiées par|personnel qualifié|savoir-faire vérifié/i.test(p));
  }

  console.log("\n--- LA RECHERCHE PUBLIQUE NE CHARGE QUE CE QU'ELLE MONTRE ---");
  // Elle faisait SELECT * : rien ne fuyait a l'ecran, mais tout arrivait
  // jusqu'a la vue - mot de passe hache, email, date de naissance, noms
  // des fichiers d'identite. Une colonne ajoutee demain s'y serait
  // retrouvee sans que personne ne le decide.
  const publique = await (await lire("/recherche")).text();
  for (const secret of ["motdepasse", "cni_fichier", "casier_fichier",
                        "date_naissance", "message_equipe", "suspendu_motif"]) {
    dire("la recherche ne transporte pas " + secret, !publique.includes(secret));
  }
  dire("aucune adresse email n'y figure", !publique.includes("@example.com"));

  console.log("\n--- UN COMPTE SUSPENDU N'EST PLUS TROUVABLE ---");
  // La fiche publique ecartait deja les suspendus ; la liste, non. Une
  // personne suspendue continuait d'apparaitre et pouvait etre contactee.
  const suspendue = await creerCompte("suspendue", "prestataire",
    { metier: "menagere", tarif: "13000" });
  const idSusp = base.prepare("SELECT id FROM utilisateurs WHERE email = ?").get(suspendue.mail).id;

  dire("elle apparait d'abord dans la recherche",
       (await (await lire("/recherche?metier=menagere")).text()).includes("Test suspendue"));

  base.prepare("UPDATE utilisateurs SET suspendu = 1, suspendu_le = datetime('now'), "
    + "suspendu_motif = ? WHERE id = ?").run("essai", idSusp);

  dire("une fois suspendue, elle disparait de la recherche par metier",
       !(await (await lire("/recherche?metier=menagere")).text()).includes("Test suspendue"));
  dire("de la recherche approximative aussi",
       !(await (await lire("/recherche?metier=menag")).text()).includes("Test suspendue"));
  dire("et de la liste complete",
       !(await (await lire("/recherche")).text()).includes("Test suspendue"));
  // Sa fiche etait deja protegee : on verifie que ca n'a pas change.
  dire("sa fiche reste introuvable", (await lire("/personnes/" + idSusp)).status === 404);

  console.log("\n--- NETTOYAGE ---");
  const n = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  " + n + " comptes de test supprimes");

  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 600);
