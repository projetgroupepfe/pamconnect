// Test complet du parcours PamConnect apres la migration Express.
const http = require("http");
const fs = require("fs");
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "\\_serveur_test_temporaire.js");

// Connexion a la base, pour verifier et nettoyer les donnees de test.
const base = require("C:/Users/PC/Documents/PamConnect/node_modules/better-sqlite3")(
  PROJET + "\\data\\pamconnect.db"
);
base.pragma("foreign_keys = ON");


const MARQUE = "test-etape9";
let ok = 0, ko = 0;

function requete(chemin, o) {
  o = o || {};
  const entetes = Object.assign({}, o.headers);
  if (o.cookie) entetes["Cookie"] = o.cookie;
  if (o.body) {
    entetes["Content-Type"] = "application/x-www-form-urlencoded";
    entetes["Content-Length"] = Buffer.byteLength(o.body);
  }
  return new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port: 3999, path: chemin, method: o.method || "GET", headers: entetes },
      (res) => {
        let c = "";
        res.on("data", (x) => (c += x));
        res.on("end", () => {
          const sc = res.headers["set-cookie"];
          resolve({ code: res.statusCode, corps: c, entetes: res.headers,
                    cookie: sc ? sc[0].split(";")[0] : null });
        });
      }
    );
    req.on("error", (e) => resolve({ code: 0, corps: String(e) }));
    if (o.body) req.write(o.body);
    req.end();
  });
}

function v(nom, cond, detail) {
  if (cond) { ok++; console.log("  OK    | " + nom); }
  else { ko++; console.log("  ECHEC | " + nom + (detail ? "   -> " + detail : "")); }
}

function form(obj) {
  return Object.keys(obj).map((k) => k + "=" + encodeURIComponent(obj[k])).join("&");
}

setTimeout(async () => {
  console.log("\n--- PARTIE 1 : fichiers statiques (express.static) ---");
  const accueil = await requete("/");
  v("GET / affiche l'accueil", accueil.code === 200 && accueil.corps.includes("PamConnect"), "code " + accueil.code);
  v("l'accueil a un en-tete avec le nom et la zone couverte",
    accueil.corps.includes('class="entete"') && accueil.corps.includes('class="lieu-entete"'));
  const css = await requete("/style.css");
  v("GET /style.css marche", css.code === 200 && css.corps.includes("font-family"));
  v("le bon Content-Type est devine", (css.entetes["content-type"] || "").includes("text/css"), css.entetes["content-type"]);
  const insPage = await requete("/inscription");
  v("GET /inscription affiche le formulaire", insPage.code === 200 && insPage.corps.includes("compte"), "code " + insPage.code);
  const ancienne = await requete("/inscription.html");
  v("l'ancienne adresse .html redirige", ancienne.code === 301, "code " + ancienne.code);
  const fuite = await requete("/../data/utilisateurs.json");
  v("la faille de traversee reste bloquee", !fuite.corps.includes("motdepasse"), "code " + fuite.code);
  const perdu = await requete("/page-inexistante");
  v("une page inconnue renvoie 404", perdu.code === 404, "code " + perdu.code);

  console.log("\n--- PARTIE 2 : POST /inscription migre vers Express ---");
  const empMail = MARQUE + "-employeur@example.com";
  const preMail = MARQUE + "-prestataire@example.com";
  const insc1 = await requete("/inscription", { method: "POST",
    body: form({ role: "employeur", nom: "Employeur Test", email: empMail,
                 motdepasse: "motdepasse123", telephone: "600000000", arrondissement: "Yaounde 3", quartier: "Bastos" }) });
  v("inscription employeur acceptee", insc1.code === 200 && insc1.corps.includes("Merci"), "code " + insc1.code);
  v("le charset est bien pose (accents)", (insc1.entetes["content-type"] || "").includes("utf-8"), insc1.entetes["content-type"]);
  // Ce test verifie l'ENCODAGE, pas la formulation : des accents lisibles
  // et aucun "Ã" (la marque d'un texte utf-8 lu comme du latin-1).
  v("les accents passent", /[éèêàçôû]/.test(insc1.corps) && !insc1.corps.includes("Ã"));

  const insc2 = await requete("/inscription", { method: "POST",
    body: form({ role: "employeur", telephone: "600000000", nom: "Doublon", email: empMail.toUpperCase(),
                 motdepasse: "x", arrondissement: "Yaounde 1" }) });
  v("email en double refuse (409)", insc2.code === 409, "code " + insc2.code);

  const inscXss = await requete("/inscription", { method: "POST",
    body: form({ role: "prestataire", nom: "<script>alert(1)</script>", email: preMail,
                 motdepasse: "motdepasse123", telephone: "600000000", arrondissement: "Yaounde 5",
                 metier: "Menage", tarif: "5000" }) });
  v("inscription prestataire acceptee", inscXss.code === 200);
  v("XSS toujours neutralise", inscXss.corps.includes("&lt;script&gt;") && !inscXss.corps.includes("<script>alert(1)</script>"));

  console.log("\n--- PARTIE 3 : ancien code (pas encore migre) ---");
  const coEmp = await requete("/connexion", { method: "POST",
    body: form({ email: empMail, motdepasse: "motdepasse123", telephone: "600000000" }) });
  v("connexion employeur reussie", coEmp.code === 200 && coEmp.corps.includes("Bienvenue"), "code " + coEmp.code);
  v("un cookie de session est bien pose", !!coEmp.cookie, String(coEmp.cookie));
  const cookieEmp = coEmp.cookie;

  // Publier une demande ET y repondre exigent une identite verifiee.
  // Ce n'est pas le sujet de cette serie : on la donne a tous les
  // comptes qu'elle cree.
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' "
    + "WHERE email LIKE ?").run("%" + MARQUE + "%");


  const coMaj = await requete("/connexion", { method: "POST",
    body: form({ email: empMail.toUpperCase(), motdepasse: "motdepasse123", telephone: "600000000" }) });
  v("connexion insensible aux majuscules", coMaj.corps.includes("Bienvenue"));

  const profil1 = await requete("/mon-profil", { cookie: cookieEmp });
  v("GET /mon-profil affiche le profil", profil1.code === 200 && profil1.corps.includes("Employeur Test"), "code " + profil1.code);
  v("section 'Mes demandes' presente (etape 7)", profil1.corps.includes("Mes demandes"));

  const profilAnon = await requete("/mon-profil");
  v("sans cookie, /mon-profil redirige", profilAnon.code === 302, "code " + profilAnon.code);

  const pub = await requete("/publier-annonce", { cookie: cookieEmp });
  v("GET /publier-annonce affiche le formulaire", pub.code === 200 && pub.corps.includes("Publier une demande"));

  const titreAnnonce = MARQUE + " <b>gras</b>";
  const post = await requete("/annonces", { method: "POST", cookie: cookieEmp,
    body: form({ titre: titreAnnonce, metier: "Menage", arrondissement: "Yaounde 3",
                 quartier: "Bastos", horaire: "Lundi et jeudi, 8h a 12h", prix: "10000" }) });
  // On verifie que la demande EXISTE, pas le libelle de l'ecran de
  // confirmation : un texte se reecrit, une ligne en base ne ment pas.
  v("POST /annonces publie l'annonce", post.code === 200
    && Boolean(base.prepare("SELECT id FROM annonces WHERE titre = ?").get(titreAnnonce)),
    "code " + post.code);
  v("et aucune somme n'est bloquee",
    !base.prepare(
      "SELECT v.id FROM versements v JOIN annonces a ON a.id = v.annonce_id "
      + "WHERE a.titre = ?").get(titreAnnonce));

  console.log("\n--- PARTIE 4 : GET /annonces migre vers Express ---");
  const liste = await requete("/annonces");
  v("GET /annonces affiche la liste", liste.code === 200 && liste.corps.includes("Demandes disponibles"), "code " + liste.code);
  v("la nouvelle annonce apparait", liste.corps.includes(MARQUE));
  v("le titre est echappe (&lt;b&gt;)", liste.corps.includes("&lt;b&gt;gras&lt;/b&gt;"));
  v("visiteur non connecte : invite a se connecter", liste.corps.includes("Connectez-vous"));

  const coPre = await requete("/connexion", { method: "POST",
    body: form({ email: preMail, motdepasse: "motdepasse123", telephone: "600000000" }) });
  const cookiePre = coPre.cookie;
  v("connexion prestataire reussie", !!cookiePre);

  const listePre = await requete("/annonces", { cookie: cookiePre });
  v("prestataire connecte : il peut se proposer", listePre.corps.includes("Je suis disponible"));

  console.log("\n--- PARTIE 5 : candidatures (etape 6 + 7) ---");
  const monAnnonce = base
    .prepare("SELECT * FROM annonces WHERE titre LIKE ?")
    .get("%" + MARQUE + "%");
  v("l'annonce est bien enregistree en base", !!monAnnonce);

  // REPONDRE EXIGE UNE IDENTITE VERIFIEE, comme publier. Cette serie
  // parle de ce qui vient APRES : un employeur qui voudrait choisir
  // quelqu'un dont le dossier n'est pas valide. Ce cas ne s'atteint plus
  // par le parcours normal, mais la regle du serveur existe toujours -
  // on la met donc a l'epreuve en ramenant la candidate a son etat de
  // depart, une fois sa reponse envoyee.
  const cand = await requete("/candidatures", { method: "POST", cookie: cookiePre,
    body: form({ annonceId: monAnnonce.id }) });
  v("POST /candidatures accepte la candidature",
    cand.code === 200 && cand.corps.includes("Votre r"), "code " + cand.code);

  base.prepare("UPDATE utilisateurs SET statut_verification = 'non soumis' WHERE email = ?")
    .run(preMail.toLowerCase());

  const profil2 = await requete("/mes-demandes", { cookie: cookieEmp });
  v("l'employeur voit la candidature recue", profil2.corps.includes("En attente"));
  // Nouvelle regle : pas d'embauche sans verification d'identite.
  v("Accepter n'est PAS propose (prestataire non verifie)", !profil2.corps.includes(">Accepter<"));
  v("le refus reste possible malgre la verification en attente",
    profil2.corps.includes('value="refusee"'));

  const maCand = base
    .prepare("SELECT * FROM candidatures WHERE annonce_id = ?")
    .get(monAnnonce.id);
  const maj = await requete("/candidatures/statut", { method: "POST", cookie: cookieEmp,
    body: form({ candidatureId: maCand.id, statut: "acceptee" }) });
  v("accepter un prestataire non verifie -> 403", maj.code === 403, "code " + maj.code);

  const profil3 = await requete("/mes-reponses", { cookie: cookiePre });
  v("la candidature reste en attente, et l'ecran le dit a la personne",
    profil3.corps.includes("Votre candidature est en attente"));

  console.log("\n--- PARTIE 6 : recherche (etape 4) ---");
  const rech = await requete("/recherche?metier=menage");
  v("GET /recherche?metier=menage marche", rech.code === 200 && rech.corps.includes("Rechercher un prestataire"), "code " + rech.code);
  const rechGps = await requete("/recherche?metier=menage&latitude=3.848&longitude=11.502");
  v("recherche avec GPS marche", rechGps.code === 200 && rechGps.corps.includes("km"));

  console.log("\n--- NETTOYAGE des donnees de test ---");
  const supprimes = base
    .prepare("DELETE FROM utilisateurs WHERE email LIKE ?")
    .run("%" + MARQUE + "%").changes;
  console.log("  " + supprimes + " compte(s) de test supprime(s) (annonces et candidatures en cascade)");

  console.log("\n" + "=".repeat(50));
  console.log("RESULTAT : " + ok + " tests reussis, " + ko + " echec(s)");
  console.log("=".repeat(50));
  process.exit(ko === 0 ? 0 : 1);
}, 500);
