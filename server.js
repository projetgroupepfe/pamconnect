const http = require("http");
const fs = require("fs");
const path = require("path");
const querystring = require("querystring");
const crypto = require("crypto");

const PORT = 3000;
const FICHIER_UTILISATEURS = path.join(__dirname, "data", "utilisateurs.json");
const FICHIER_ANNONCES = path.join(__dirname, "data", "annonces.json");
const FICHIER_CANDIDATURES = path.join(__dirname, "data", "candidatures.json");
const sessions = {};

function genererToken() {
  return crypto.randomBytes(32).toString("hex");
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function lireUtilisateurs() {
  if (!fs.existsSync(FICHIER_UTILISATEURS)) {
    fs.writeFileSync(FICHIER_UTILISATEURS, "[]");
  }
  const contenu = fs.readFileSync(FICHIER_UTILISATEURS, "utf-8");
  return JSON.parse(contenu);
}

function sauvegarderUtilisateurs(utilisateurs) {
  fs.writeFileSync(FICHIER_UTILISATEURS, JSON.stringify(utilisateurs, null, 2));
}

function lireAnnonces() {
  if (!fs.existsSync(FICHIER_ANNONCES)) {
    fs.writeFileSync(FICHIER_ANNONCES, "[]");
  }
  const contenu = fs.readFileSync(FICHIER_ANNONCES, "utf-8");
  return JSON.parse(contenu);
}

function sauvegarderAnnonces(annonces) {
  fs.writeFileSync(FICHIER_ANNONCES, JSON.stringify(annonces, null, 2));
}

function lireCandidatures() {
  if (!fs.existsSync(FICHIER_CANDIDATURES)) {
    fs.writeFileSync(FICHIER_CANDIDATURES, "[]");
  }
  const contenu = fs.readFileSync(FICHIER_CANDIDATURES, "utf-8");
  return JSON.parse(contenu);
}

function sauvegarderCandidatures(candidatures) {
  fs.writeFileSync(FICHIER_CANDIDATURES, JSON.stringify(candidatures, null, 2));
}

function hacherMotDePasse(motDePasse) {
  const sel = crypto.randomBytes(16).toString("hex");
  const hache = crypto.scryptSync(motDePasse, sel, 64).toString("hex");
  return `${sel}:${hache}`;
}

function verifierMotDePasse(motDePasseSaisi, motDePasseHache) {
  const [sel, hache] = motDePasseHache.split(":");
  const hacheTest = crypto.scryptSync(motDePasseSaisi, sel, 64).toString("hex");
  return hache === hacheTest;
}

// Rend inoffensif tout texte venant d'un utilisateur avant de l'afficher dans une page.
// Les caracteres qui servent a ecrire du HTML sont remplaces par leur equivalent "texte".
function echapper(valeur) {
  if (valeur === null || valeur === undefined) return "";
  return String(valeur)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function calculerDistanceKm(lat1, lon1, lat2, lon2) {
  const rayonTerre = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return rayonTerre * c;
}

function trouverEmailConnecte(request) {
  const enteteCookie = request.headers.cookie || "";
  const paire = enteteCookie.split("; ").find((c) => c.startsWith("session="));
  if (!paire) return null;

  const token = paire.split("=")[1];
  return sessions[token] || null;
}

const server = http.createServer((request, response) => {
  if (request.method === "POST" && request.url === "/inscription") {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", () => {
      const donnees = querystring.parse(body);
      const emailNormalise = (donnees.email || "").trim().toLowerCase();

      const utilisateurs = lireUtilisateurs();
      const dejaInscrit = utilisateurs.find(
        (u) => (u.email || "").toLowerCase() === emailNormalise
      );

      if (dejaInscrit) {
        response.writeHead(409, { "Content-Type": "text/html; charset=utf-8" });
        response.end(`<h1>Email deja utilise</h1><p>Un compte existe deja avec l'adresse ${echapper(donnees.email)}.</p><a href="/connexion.html">Se connecter</a> - <a href="/inscription.html">Reessayer</a>`);
        return;
      }

      const nouvelUtilisateur = {
        id: Date.now(),
        role: donnees.role,
        nom: donnees.nom,
        email: emailNormalise,
        motdepasse: hacherMotDePasse(donnees.motdepasse),
        arrondissement: donnees.arrondissement,
        quartier: donnees.quartier || null,
        metier: donnees.metier || null,
        tarif: donnees.tarif || null,
        latitude: donnees.latitude || null,
        longitude: donnees.longitude || null,
      };

      utilisateurs.push(nouvelUtilisateur);
      sauvegarderUtilisateurs(utilisateurs);

      console.log("Nouvel utilisateur enregistré :", nouvelUtilisateur);

      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<h1>Merci ${echapper(donnees.nom)} !</h1><p>Ton inscription en tant que ${echapper(donnees.role)} a bien été enregistrée.</p><a href="/index.html">Retour à l'accueil</a>`);
    });

    return;
  }

  if (request.method === "POST" && request.url === "/connexion") {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", () => {
      const donnees = querystring.parse(body);
      const utilisateurs = lireUtilisateurs();

      const emailSaisi = (donnees.email || "").trim().toLowerCase();
      const utilisateurTrouve = utilisateurs.find(
        (u) => (u.email || "").toLowerCase() === emailSaisi
      );

      if (utilisateurTrouve && verifierMotDePasse(donnees.motdepasse, utilisateurTrouve.motdepasse)) {
        const token = genererToken();
        sessions[token] = utilisateurTrouve.email;

        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Set-Cookie": `session=${token}; HttpOnly; Path=/`,
        });
        response.end(`<h1>Bienvenue ${echapper(utilisateurTrouve.nom)} !</h1><p>Connexion réussie en tant que ${echapper(utilisateurTrouve.role)}.</p><a href="/mon-profil">Voir mon profil</a>`);
      } else {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(`<h1>Connexion échouée</h1><p>Email ou mot de passe incorrect.</p><a href="/connexion.html">Réessayer</a>`);
      }
    });

    return;
  }

  if (request.method === "GET" && request.url === "/mon-profil") {
    const emailConnecte = trouverEmailConnecte(request);

    if (!emailConnecte) {
      response.writeHead(302, { "Location": "/connexion.html" });
      response.end();
      return;
    }

    const utilisateurs = lireUtilisateurs();
    const utilisateur = utilisateurs.find((u) => u.email === emailConnecte);

    let sectionSupplementaire = "";

    if (utilisateur.role === "employeur") {
      const mesAnnonces = lireAnnonces().filter((a) => a.employeurEmail === emailConnecte);
      const toutesCandidatures = lireCandidatures();

      sectionSupplementaire += `<h2>Mes annonces</h2>`;

      if (mesAnnonces.length === 0) {
        sectionSupplementaire += `<p>Tu n'as publie aucune annonce.</p>`;
      } else {
        mesAnnonces.forEach((annonce) => {
          sectionSupplementaire += `<div style="border:1px solid #ccc; margin:10px auto; padding:10px; max-width:400px;">
            <p><strong>${echapper(annonce.titre)}</strong></p>`;

          const candidaturesPourAnnonce = toutesCandidatures.filter((c) => String(c.annonceId) === String(annonce.id));

          if (candidaturesPourAnnonce.length === 0) {
            sectionSupplementaire += `<p>Aucune candidature pour l'instant.</p>`;
          } else {
            candidaturesPourAnnonce.forEach((candidature) => {
              const prestataire = utilisateurs.find((u) => u.email === candidature.prestataireEmail);
              sectionSupplementaire += `<div style="border-top:1px solid #eee; padding-top:8px; margin-top:8px;">
                <p>${echapper(prestataire ? prestataire.nom : "Prestataire inconnu")} - Statut : ${echapper(candidature.statut)}</p>`;

              if (candidature.statut === "en attente") {
                sectionSupplementaire += `
                  <form action="/candidatures/statut" method="POST" style="display:inline;">
                    <input type="hidden" name="candidatureId" value="${echapper(candidature.id)}">
                    <input type="hidden" name="statut" value="acceptee">
                    <button type="submit">Accepter</button>
                  </form>
                  <form action="/candidatures/statut" method="POST" style="display:inline;">
                    <input type="hidden" name="candidatureId" value="${echapper(candidature.id)}">
                    <input type="hidden" name="statut" value="refusee">
                    <button type="submit">Refuser</button>
                  </form>`;
              }

              sectionSupplementaire += `</div>`;
            });
          }

          sectionSupplementaire += `</div>`;
        });
      }
    }

    if (utilisateur.role === "prestataire") {
      const mesCandidatures = lireCandidatures().filter((c) => c.prestataireEmail === emailConnecte);
      const toutesAnnonces = lireAnnonces();

      sectionSupplementaire += `<h2>Mes candidatures</h2>`;

      if (mesCandidatures.length === 0) {
        sectionSupplementaire += `<p>Tu n'as postule a aucune annonce.</p>`;
      } else {
        mesCandidatures.forEach((candidature) => {
          const annonce = toutesAnnonces.find((a) => String(a.id) === String(candidature.annonceId));
          sectionSupplementaire += `<div style="border:1px solid #ccc; margin:10px auto; padding:10px; max-width:400px;">
            <p><strong>${echapper(annonce ? annonce.titre : "Annonce supprimee")}</strong></p>
            <p>Statut : ${echapper(candidature.statut)}</p>
          </div>`;
        });
      }
    }

    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PamConnect - Mon profil</title>
        <link rel="stylesheet" href="/style.css">
      </head>
      <body>
        <nav>
          <a href="/index.html">Accueil</a>
          <a href="/employeur.html">Espace employeur</a>
          <a href="/prestataire.html">Espace prestataire</a>
          <a href="/recherche.html">Recherche</a>
          <a href="/annonces">Annonces</a>
          <a href="/inscription.html">Inscription</a>
          <a href="/connexion.html">Connexion</a>
        </nav>
        <h1>Mon profil</h1>
        <p><strong>Nom :</strong> ${echapper(utilisateur.nom)}</p>
        <p><strong>Email :</strong> ${echapper(utilisateur.email)}</p>
        <p><strong>Rôle :</strong> ${echapper(utilisateur.role)}</p>
        <p><strong>Arrondissement :</strong> ${echapper(utilisateur.arrondissement)}</p>
        <p><strong>Quartier :</strong> ${echapper(utilisateur.quartier || "Non renseigné")}</p>
        <p><strong>Métier :</strong> ${echapper(utilisateur.metier || "Non renseigné")}</p>
        <p><strong>Tarif :</strong> ${echapper(utilisateur.tarif || "Non renseigné")}</p>
        ${sectionSupplementaire}
      </body>
      </html>
    `);
    return;
  }

  if (request.method === "GET" && request.url === "/publier-annonce") {
    const emailConnecte = trouverEmailConnecte(request);
    if (!emailConnecte) {
      response.writeHead(302, { "Location": "/connexion.html" });
      response.end();
      return;
    }
    const utilisateurs = lireUtilisateurs();
    const utilisateur = utilisateurs.find((u) => u.email === emailConnecte);

    if (utilisateur.role !== "employeur") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<h1>Acces refuse</h1><p>Seuls les employeurs peuvent publier une annonce.</p><a href="/index.html">Retour a l'accueil</a>`);
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>PamConnect - Publier une annonce</title><link rel="stylesheet" href="/style.css"></head><body>
      <nav>
        <a href="/index.html">Accueil</a>
        <a href="/employeur.html">Espace employeur</a>
        <a href="/prestataire.html">Espace prestataire</a>
        <a href="/recherche.html">Recherche</a>
        <a href="/inscription.html">Inscription</a>
        <a href="/connexion.html">Connexion</a>
        <a href="/mon-profil">Mon profil</a>
      </nav>
      <h1>Publier une annonce</h1>
      <form action="/annonces" method="POST">
        <label for="titre">Titre :</label>
        <input type="text" id="titre" name="titre" required>

        <label for="description">Description :</label>
        <textarea id="description" name="description" required></textarea>

        <label for="metier">Metier recherche :</label>
        <input type="text" id="metier" name="metier" required>

        <label for="arrondissement">Arrondissement :</label>
        <select id="arrondissement" name="arrondissement" required>
          <option value="Yaounde 1">Yaounde 1</option>
          <option value="Yaounde 2">Yaounde 2</option>
          <option value="Yaounde 3">Yaounde 3</option>
          <option value="Yaounde 4">Yaounde 4</option>
          <option value="Yaounde 5">Yaounde 5</option>
          <option value="Yaounde 6">Yaounde 6</option>
          <option value="Yaounde 7">Yaounde 7</option>
        </select>

        <button type="submit">Publier</button>
      </form>
    </body></html>`);
    return;
  }

  if (request.method === "POST" && request.url === "/annonces") {
    const emailConnecte = trouverEmailConnecte(request);
    if (!emailConnecte) {
      response.writeHead(302, { "Location": "/connexion.html" });
      response.end();
      return;
    }
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const donnees = querystring.parse(body);
      const nouvelleAnnonce = {
        id: Date.now(),
        employeurEmail: emailConnecte,
        titre: donnees.titre,
        description: donnees.description,
        metier: donnees.metier,
        arrondissement: donnees.arrondissement,
      };
      const annonces = lireAnnonces();
      annonces.push(nouvelleAnnonce);
      sauvegarderAnnonces(annonces);

      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<h1>Annonce publiee !</h1><p>Ton annonce "${echapper(donnees.titre)}" a bien ete enregistree.</p><a href="/index.html">Retour a l'accueil</a>`);
    });
    return;
  }

  if (request.method === "GET" && request.url === "/annonces") {
    const emailConnecte = trouverEmailConnecte(request);
    let role = null;
    if (emailConnecte) {
      const utilisateurs = lireUtilisateurs();
      const utilisateur = utilisateurs.find((u) => u.email === emailConnecte);
      role = utilisateur ? utilisateur.role : null;
    }

    const annonces = lireAnnonces();

    let html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>PamConnect - Annonces</title><link rel="stylesheet" href="/style.css"></head><body>
      <nav>
        <a href="/index.html">Accueil</a>
        <a href="/employeur.html">Espace employeur</a>
        <a href="/prestataire.html">Espace prestataire</a>
        <a href="/recherche.html">Recherche</a>
        <a href="/annonces">Annonces</a>
        <a href="/inscription.html">Inscription</a>
        <a href="/connexion.html">Connexion</a>
        <a href="/mon-profil">Mon profil</a>
      </nav>
      <h1>Annonces disponibles</h1>`;

    if (annonces.length === 0) {
      html += `<p>Aucune annonce pour le moment.</p>`;
    } else {
      annonces.forEach((a) => {
        html += `<div style="border:1px solid #ccc; margin:10px auto; padding:10px; max-width:400px;">
          <p><strong>${echapper(a.titre)}</strong></p>
          <p>${echapper(a.description)}</p>
          <p>Metier : ${echapper(a.metier)}</p>
          <p>Arrondissement : ${echapper(a.arrondissement)}</p>`;

        if (role === "prestataire") {
          html += `<form action="/candidatures" method="POST">
            <input type="hidden" name="annonceId" value="${echapper(a.id)}">
            <button type="submit">Postuler</button>
          </form>`;
        } else {
          html += `<p><a href="/connexion.html">Connecte-toi en tant que prestataire</a> pour postuler.</p>`;
        }

        html += `</div>`;
      });
    }

    html += `</body></html>`;

    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
    return;
  }

  if (request.method === "POST" && request.url === "/candidatures") {
    const emailConnecte = trouverEmailConnecte(request);
    if (!emailConnecte) {
      response.writeHead(302, { "Location": "/connexion.html" });
      response.end();
      return;
    }
    const utilisateurs = lireUtilisateurs();
    const utilisateur = utilisateurs.find((u) => u.email === emailConnecte);
    if (!utilisateur || utilisateur.role !== "prestataire") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<h1>Acces refuse</h1><p>Seuls les prestataires peuvent postuler.</p><a href="/annonces">Retour aux annonces</a>`);
      return;
    }

    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const donnees = querystring.parse(body);
      const nouvelleCandidature = {
        id: Date.now(),
        annonceId: donnees.annonceId,
        prestataireEmail: emailConnecte,
        statut: "en attente",
      };
      const candidatures = lireCandidatures();
      candidatures.push(nouvelleCandidature);
      sauvegarderCandidatures(candidatures);

      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<h1>Candidature envoyee !</h1><p>Ta candidature a bien ete enregistree.</p><a href="/annonces">Retour aux annonces</a>`);
    });
    return;
  }

  if (request.method === "POST" && request.url === "/candidatures/statut") {
    const emailConnecte = trouverEmailConnecte(request);
    if (!emailConnecte) {
      response.writeHead(302, { "Location": "/connexion.html" });
      response.end();
      return;
    }
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const donnees = querystring.parse(body);
      const candidatures = lireCandidatures();
      const candidature = candidatures.find((c) => String(c.id) === String(donnees.candidatureId));

      if (candidature) {
        const annonces = lireAnnonces();
        const annonce = annonces.find((a) => String(a.id) === String(candidature.annonceId));
        if (annonce && annonce.employeurEmail === emailConnecte) {
          candidature.statut = donnees.statut;
          sauvegarderCandidatures(candidatures);
        }
      }

      response.writeHead(302, { "Location": "/mon-profil" });
      response.end();
    });
    return;
  }

  if (request.method === "GET" && (request.url === "/recherche" || request.url.startsWith("/recherche?"))) {
    const urlObjet = new URL(request.url, `http://${request.headers.host}`);
    const metierRecherche = (urlObjet.searchParams.get("metier") || "").toLowerCase();
    const latEmployeur = parseFloat(urlObjet.searchParams.get("latitude"));
    const lonEmployeur = parseFloat(urlObjet.searchParams.get("longitude"));

    const utilisateurs = lireUtilisateurs();
    let prestataires = utilisateurs.filter((u) => u.role === "prestataire");

    if (metierRecherche) {
      prestataires = prestataires.filter((p) =>
        (p.metier || "").toLowerCase().includes(metierRecherche)
      );
    }

    if (!isNaN(latEmployeur) && !isNaN(lonEmployeur)) {
      prestataires = prestataires
        .filter((p) => p.latitude && p.longitude)
        .map((p) => ({
          ...p,
          distance: calculerDistanceKm(latEmployeur, lonEmployeur, parseFloat(p.latitude), parseFloat(p.longitude)),
        }))
        .sort((a, b) => a.distance - b.distance);
    }

    let html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>PamConnect - Resultats</title><link rel="stylesheet" href="/style.css"></head><body>
      <nav>
        <a href="/index.html">Accueil</a>
        <a href="/employeur.html">Espace employeur</a>
        <a href="/prestataire.html">Espace prestataire</a>
        <a href="/inscription.html">Inscription</a>
        <a href="/connexion.html">Connexion</a>
        <a href="/mon-profil">Mon profil</a>
      </nav>
      <h1>Resultats de recherche</h1>`;

    if (prestataires.length === 0) {
      html += `<p>Aucun prestataire trouve.</p>`;
    } else {
      prestataires.forEach((p) => {
        const distanceTexte = p.distance !== undefined ? `${p.distance.toFixed(1)} km` : "Distance inconnue";
        html += `<div style="border:1px solid #ccc; margin:10px auto; padding:10px; max-width:400px;">
          <p><strong>${echapper(p.nom)}</strong> - ${echapper(p.metier)}</p>
          <p>${echapper(p.arrondissement)}, ${echapper(p.quartier || "")}</p>
          <p>Tarif : ${echapper(p.tarif || "Non renseigne")}</p>
          <p>Distance : ${distanceTexte}</p>
        </div>`;
      });
    }

    html += `<a href="/recherche.html">Nouvelle recherche</a></body></html>`;

    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
    return;
  }

  // On ne garde que le chemin de l'URL (sans les ?parametres), et on verifie
  // que le fichier demande se trouve bien A L'INTERIEUR du dossier public.
  const urlDemandee = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = urlDemandee.pathname === "/" ? "/index.html" : urlDemandee.pathname;

  const dossierPublic = path.join(__dirname, "public");
  const filePath = path.join(dossierPublic, requestedPath);

  if (!filePath.startsWith(dossierPublic + path.sep)) {
    response.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<h1>403 - Acces interdit</h1>");
    return;
  }

  const extension = path.extname(filePath);
  const contentType = MIME_TYPES[extension] || "text/plain";

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<h1>404 - Page introuvable</h1>");
      return;
    }
    response.writeHead(200, { "Content-Type": contentType });
    response.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`Serveur PamConnect démarré : http://localhost:${PORT}`);
});