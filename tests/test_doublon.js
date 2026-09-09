const http = require("http");
const PROJET = require("path").join(__dirname, "..");
process.chdir(PROJET);
require(PROJET + "/_serveur_test_temporaire.js");

const base = require(PROJET + "/node_modules/better-sqlite3")(PROJET + "/data/pamconnect.db");
base.pragma("foreign_keys = ON");

const M = "test-doublon";

function q(p, o) {
  o = o || {};
  const h = {};
  if (o.cookie) h.Cookie = o.cookie;
  if (o.body) {
    h["Content-Type"] = "application/x-www-form-urlencoded";
    h["Content-Length"] = Buffer.byteLength(o.body);
  }
  return new Promise((r) => {
    const x = http.request({ host: "127.0.0.1", port: 3999, path: p, method: o.method || "GET", headers: h }, (res) => {
      let c = "";
      res.on("data", (d) => (c += d));
      res.on("end", () => {
        const sc = res.headers["set-cookie"];
        r({ code: res.statusCode, corps: c, cookie: sc ? sc[0].split(";")[0] : null });
      });
    });
    x.on("error", (e) => r({ code: 0, corps: String(e) }));
    if (o.body) x.write(o.body);
    x.end();
  });
}

const f = (o) => Object.keys(o).map((k) => k + "=" + encodeURIComponent(o[k])).join("&");
// Cette serie n'avait pas de compteurs : elle affichait ses resultats
// sans jamais dire combien avaient reussi. Un plantage en cours de route
// passait donc inapercu.
let ok = 0, ko = 0;
const dire = (nom, cond, detail) => {
  if (cond) ok++; else ko++;
  console.log("  " + (cond ? "OK    " : "ECHEC ") + "| " + nom + (detail ? "   " + detail : ""));
};

setTimeout(async () => {
  const mdp = "motdepasse123";
  const emp = M + "-emp@example.com";
  const pre = M + "-pre@example.com";

  await q("/inscription", { method: "POST", body: f({ role: "employeur", nom: "Emp", email: emp, motdepasse: mdp, arrondissement: "Yaounde 1" }) });
  await q("/inscription", { method: "POST", body: f({ role: "prestataire", nom: "Pre", email: pre, motdepasse: mdp, arrondissement: "Yaounde 1", metier: "MetierDoublon", tarif: "10000" }) });

  const cEmp = (await q("/connexion", { method: "POST", body: f({ email: emp, motdepasse: mdp }) })).cookie;
  const cPre = (await q("/connexion", { method: "POST", body: f({ email: pre, motdepasse: mdp }) })).cookie;

  // Publier une demande ET y repondre exigent une identite verifiee.
  // Ce n'est pas le sujet de cette serie : on la donne a tous les
  // comptes qu'elle cree.
  base.prepare("UPDATE utilisateurs SET statut_verification = 'verifie' "
    + "WHERE email LIKE ?").run("%" + M + "%");

  await q("/annonces", { method: "POST", cookie: cEmp, body: f({ titre: M + " annonce", metier: "MetierDoublon", arrondissement: "Yaounde 1", quartier: "Bastos", horaire: "Lundi 8h-12h", prix: "10000" }) });
  const ann = base.prepare("SELECT * FROM annonces WHERE titre LIKE ?").get("%" + M + "%");

  const r1 = await q("/candidatures", { method: "POST", cookie: cPre, body: f({ annonceId: ann.id }) });
  const r2 = await q("/candidatures", { method: "POST", cookie: cPre, body: f({ annonceId: ann.id }) });
  const r3 = await q("/candidatures", { method: "POST", cookie: cPre, body: f({ annonceId: 999999 }) });
  const n = base.prepare("SELECT COUNT(*) n FROM candidatures WHERE annonce_id = ?").get(ann.id).n;

  console.log("");
  dire("1re candidature acceptee", r1.code === 200, "(code " + r1.code + ")");
  dire("2e candidature refusee", r2.code === 409, "(code " + r2.code + ")");
  // On verifie que la personne est ORIENTEE, pas la formulation exacte :
  // un test accroche aux mots casse des qu'on reecrit une phrase.
  dire("la personne est renvoyee vers ses candidatures",
       r2.corps.includes('href="/mon-profil"'));
  dire("annonce inexistante -> 404", r3.code === 404, "(code " + r3.code + ")");
  dire("une seule candidature en base", n === 1, "(" + n + " trouvee)");

  const s = base.prepare("DELETE FROM utilisateurs WHERE email LIKE ?").run("%" + M + "%").changes;
  console.log("  ----- | nettoyage : " + s + " comptes de test supprimes");

  // La meme ligne finale que les autres series : sans elle, on ne peut
  // pas distinguer une serie terminee d'une serie qui a plante en route.
  console.log("\nRESULTAT : " + ok + " reussis, " + ko + " echec(s)");
  process.exit(ko === 0 ? 0 : 1);
}, 500);
