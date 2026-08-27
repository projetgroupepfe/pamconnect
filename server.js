const http = require("http");
const fs = require("fs");
const path = require("path");
const querystring = require("querystring");
const crypto = require("crypto");

const PORT = 3000;
const FICHIER_UTILISATEURS = path.join(__dirname, "data", "utilisateurs.json");
const FICHIER_ANNONCES = path.join(__dirname, "data", "annonces.json");

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

      const nouvelUtilisateur = {
        id: Date.now(),
        role: donnees.role,
        nom: donnees.nom,
        email: donnees.email,
        motdepasse: hacherMotDePasse(donnees.motdepasse),
        arrondissement: donnees.arrondissement,
        quartier: donnees.quartier || null,
        metier: donnees.metier || null,
        tarif: donnees.tarif || null,
        latitude: donnees.latitude || null,
        longitude: donnees.longitude || null,
      };

      const utilisateurs = lireUtilisateurs();
      utilisateurs.push(nouvelUtilisateur);
      sauvegarderUtilisateurs(utilisateurs);

      console.log("Nouvel utilisateur enregistré :", nouvelUtilisateur);

      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<h1>Merci ${donnees.nom} !</h1><p>Ton inscription en tant que ${donnees.role} a bien été enregistrée.</p><a href="/index.html">Retour à l'accueil</a>`);
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

      const utilisateurTrouve = utilisateurs.find((u) => u.email === donnees.email);

      if (utilisateurTrouve && verifierMotDePasse(donnees.motdepasse, utilisateurTrouve.motdepasse)) {
        const token = genererToken();
        sessions[token] = utilisateurTrouve.email;

        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Set-Cookie": `session=${token}; HttpOnly; Path=/`,
        });
        response.end(`<h1>Bienvenue ${utilisateurTrouve.nom} !</h1><p>Connexion réussie en tant que ${utilisateurTrouve.role}.</p><a href="/mon-profil">Voir mon profil</a>`);
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
          <a href="/inscription.html">Inscription</a>
          <a href="/connexion.html">Connexion</a>
        </nav>
        <h1>Mon profil</h1>
        <p><strong>Nom :</strong> ${utilisateur.nom}</p>
        <p><strong>Email :</strong> ${utilisateur.email}</p>
        <p><strong>Rôle :</strong> ${utilisateur.role}</p>
        <p><strong>Arrondissement :</strong> ${utilisateur.arrondissement}</p>
        <p><strong>Quartier :</strong> ${utilisateur.quartier || "Non renseigné"}</p>
        <p><strong>Métier :</strong> ${utilisateur.metier || "Non renseigné"}</p>
        <p><strong>Tarif :</strong> ${utilisateur.tarif || "Non renseigné"}</p>
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
          response.end(`<h1>Annonce publiee !</h1><p>Ton annonce "${donnees.titre}" a bien ete enregistree.</p><a href="/index.html">Retour a l'accueil</a>`);
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
              <p><strong>${p.nom}</strong> - ${p.metier}</p>
              <p>${p.arrondissement}, ${p.quartier || ""}</p>
              <p>Tarif : ${p.tarif || "Non renseigne"}</p>
              <p>Distance : ${distanceTexte}</p>
            </div>`;
          });
        }

        html += `<a href="/recherche.html">Nouvelle recherche</a></body></html>`;

        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(html);
        return;
      }

  let requestedPath = request.url === "/" ? "/index.html" : request.url;
  const filePath = path.join(__dirname, "public", requestedPath);
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