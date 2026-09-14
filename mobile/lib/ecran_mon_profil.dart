import 'package:flutter/material.dart';

import 'api.dart';
import 'ecran_connexion.dart';
import 'elements.dart';
import 'modeles.dart';
import 'theme.dart';

/// Mon profil : qui je suis, et ce que les autres disent de moi. La page du
/// site, ecrite par le serveur.
///
/// Modifier mon profil, Mon compte et Mes jetons arriveront avec leurs
/// ecrans : un bouton qui ne mene nulle part n'a rien a faire ici.
class EcranMonProfil extends StatefulWidget {
  const EcranMonProfil({
    super.key,
    required this.api,
    this.rafraichir = 0,
    this.auALire,
    this.auDonnerAvis,
  });

  final ApiPamConnect api;

  /// Change quand l'onglet est rouvert : le profil se recharge.
  final int rafraichir;

  /// Donne a la barre de menu ce qui attend d'etre lu ici.
  final void Function(int aLire)? auALire;

  /// Mene a l'onglet Messages, la ou l'on donne ses avis.
  final VoidCallback? auDonnerAvis;

  @override
  State<EcranMonProfil> createState() => _EcranMonProfilState();
}

class _EcranMonProfilState extends State<EcranMonProfil> {
  MonProfil? _profil;
  String? _erreur;
  bool _enCours = true;

  /// Un "J'ai lu" ou un signalement en cours d'envoi.
  bool _action = false;

  @override
  void initState() {
    super.initState();
    _charger();
  }

  @override
  void didUpdateWidget(EcranMonProfil ancien) {
    super.didUpdateWidget(ancien);
    if (ancien.rafraichir != widget.rafraichir) _charger();
  }

  Future<void> _charger() async {
    try {
      final profil = await widget.api.monProfil();
      if (!mounted) return;
      setState(() {
        _profil = profil;
        _erreur = null;
        _enCours = false;
      });
      widget.auALire?.call(profil.aLire);
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      setState(() {
        _erreur = erreur.message;
        _enCours = false;
      });
    }
  }

  /// "J'ai lu" : le serveur le retient, puis le profil se recharge.
  Future<void> _marquerLu(Future<void> Function() envoi) async {
    if (_action) return;
    setState(() => _action = true);
    try {
      await envoi();
      if (!mounted) return;
      await _charger();
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(erreur.message)));
    }
    if (mounted) setState(() => _action = false);
  }

  Future<void> _signalerAvis(AvisPublic avis) async {
    final id = avis.id;
    if (id == null || _action) return;
    setState(() => _action = true);

    String message;
    try {
      message = (await widget.api.signalerAvis(id)).texte;
      if (!mounted) return;
      await _charger();
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      message = erreur.message;
    }
    if (!mounted) return;
    setState(() => _action = false);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _seDeconnecter() async {
    await widget.api.deconnexion();
    if (!mounted) return;
    revenirALaConnexion(context, widget.api);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Mon profil'),
        actions: [
          IconButton(tooltip: 'Actualiser', onPressed: _charger, icon: const Icon(Icons.refresh)),
          IconButton(tooltip: 'Se déconnecter', onPressed: _seDeconnecter, icon: const Icon(Icons.logout)),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _charger,
        child: ListView(
          padding: const EdgeInsets.all(16),
          physics: const AlwaysScrollableScrollPhysics(),
          children: _contenu(context),
        ),
      ),
    );
  }

  List<Widget> _contenu(BuildContext context) {
    final profil = _profil;
    final erreur = _erreur;

    if (profil == null) {
      return [
        if (erreur != null) Avertissement(texte: erreur),
        if (_enCours)
          const Padding(
            padding: EdgeInsets.all(32),
            child: Center(child: CircularProgressIndicator()),
          ),
      ];
    }

    final texte = Theme.of(context).textTheme;
    final gris = texte.bodyMedium?.copyWith(color: Couleurs.encreDouce);
    final aide = texte.bodyMedium?.copyWith(color: Couleurs.encrePale);
    final corps = texte.bodyLarge?.copyWith(color: Couleurs.encre);
    const fort = TextStyle(fontWeight: FontWeight.w600, color: Couleurs.encre);
    final message = profil.messageEquipe;
    final avertissement = profil.avertissement;
    final verification = profil.verification;
    final attente = verification?.attente;
    final lieu = profil.lieu;
    final trancheAge = profil.trancheAge;
    final tarif = profil.tarif;
    final phraseTarif = tarif?.phrase;
    final aideTarif = tarif?.aide;
    final moyenne = profil.avis.moyenne;
    final vide = profil.avis.vide;
    final aNoter = profil.servicesANoter;
    final motifRefus = profil.motifRefus;

    return [
      if (erreur != null) ...[
        Avertissement(texte: erreur),
        const SizedBox(height: 16),
      ],
      // Un message de l'equipe n'est PAS une sanction : il n'a donc pas la
      // couleur d'un avertissement.
      if (message != null) ...[
        _Encadre(
          fond: Couleurs.bleuClair,
          children: [
            Text(
              "L'équipe PamConnect vous écrit",
              style: texte.titleSmall?.copyWith(color: Couleurs.bleuFonce, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 4),
            Text('Le ${message.le}', style: aide),
            const SizedBox(height: 8),
            Text(message.texte, style: corps),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: _action ? null : () => _marquerLu(widget.api.marquerMessageEquipeLu),
              icon: const Icon(Icons.check),
              label: const Text("J'ai lu"),
            ),
          ],
        ),
        const SizedBox(height: 16),
      ],
      // Un avertissement se lit avant tout le reste, et ne disparait que
      // lorsque la personne l'a reconnu.
      if (avertissement != null) ...[
        _Encadre(
          fond: Couleurs.ambreFond,
          children: [
            Text(
              "Un avertissement de l'équipe PamConnect",
              style: texte.titleSmall?.copyWith(color: Couleurs.ambre, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            Text.rich(
              TextSpan(
                children: [
                  const TextSpan(text: "L'équipe a examiné un message signalé le "),
                  TextSpan(text: avertissement.le, style: fort),
                  const TextSpan(text: ' et vous adresse cet avertissement :'),
                ],
              ),
              style: gris,
            ),
            const SizedBox(height: 8),
            Text(avertissement.motif, style: corps),
            const SizedBox(height: 8),
            Text(
              "Votre compte fonctionne normalement. Cet avertissement est conservé : si un nouveau "
              "message est signalé, l'équipe saura que la règle vous avait déjà été rappelée.",
              style: aide,
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: _action ? null : () => _marquerLu(widget.api.marquerAvertissementLu),
              icon: const Icon(Icons.check),
              label: const Text("J'ai lu cet avertissement"),
            ),
          ],
        ),
        const SizedBox(height: 16),
      ],
      Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    radius: 26,
                    backgroundColor: Couleurs.bleuClair,
                    foregroundColor: Couleurs.bleuFonce,
                    child: Text(profil.nom.isEmpty ? '' : profil.nom.characters.first),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          profil.nom,
                          style: texte.titleLarge?.copyWith(color: Couleurs.bleuFonce, fontWeight: FontWeight.w600),
                        ),
                        Text(profil.fonction, style: gris),
                      ],
                    ),
                  ),
                ],
              ),
              if (verification != null) ...[
                const SizedBox(height: 12),
                _PastilleVerification(verification: verification),
                if (attente != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(attente, style: aide),
                  ),
              ],
              if (lieu != null) LigneDetail(icone: Icons.place_outlined, texte: lieu),
              LigneDetail(icone: Icons.mail_outline, texte: profil.email),
              // Les badges ne disent QUE ce que la plateforme a verifie ou ce
              // que la personne a declare.
              if (profil.badges.isNotEmpty) ...[
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: [
                    for (final badge in profil.badges)
                      badge.verifie
                          ? Pastille(
                              texte: badge.texte,
                              icone: Icons.verified_user_outlined,
                              fond: Couleurs.vertFond,
                              couleur: Couleurs.vert,
                            )
                          : Pastille(texte: badge.texte),
                  ],
                ),
              ],
              if (trancheAge != null) LigneDetail(icone: Icons.person_outline, texte: trancheAge),
              if (profil.disponibilites.isNotEmpty) ...[
                const SizedBox(height: 16),
                Text(
                  'Vos disponibilités',
                  style: texte.titleSmall?.copyWith(color: Couleurs.encre, fontWeight: FontWeight.w600),
                ),
                for (final creneau in profil.disponibilites)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.calendar_today_outlined, size: 18, color: Couleurs.encreDouce),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text.rich(
                            TextSpan(
                              children: [
                                TextSpan(text: creneau.jour, style: fort),
                                TextSpan(text: ' : ${creneau.moments}'),
                              ],
                            ),
                            style: gris,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
              if (tarif != null) ...[
                const SizedBox(height: 16),
                if (phraseTarif != null) Text(phraseTarif, style: gris),
                for (final ligne in tarif.lignes)
                  Container(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    decoration: ligne.total
                        ? const BoxDecoration(border: Border(top: BorderSide(color: Couleurs.trait)))
                        : null,
                    child: Row(
                      children: [
                        Expanded(child: Text(ligne.libelle, style: ligne.total ? fort : gris)),
                        Text(ligne.montant, style: ligne.retenue ? gris : fort),
                      ],
                    ),
                  ),
                if (aideTarif != null) Text(aideTarif, style: aide),
              ],
            ],
          ),
        ),
      ),
      const SizedBox(height: 8),
      const TitreSection('Les avis reçus'),
      // PAS DE NOTE N'EST PAS UNE MAUVAISE NOTE : jamais "0 sur 5".
      if (profil.avis.nombre == 0 && vide != null)
        Text(vide, style: gris)
      else ...[
        if (moyenne != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Wrap(
              spacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Pastille(texte: moyenne, icone: Icons.star_border),
                Text('sur ${profil.avis.nombre} avis', style: gris),
              ],
            ),
          ),
        // SIGNALER, PAS EFFACER : l'equipe tranche.
        for (final avis in profil.avis.liste)
          CarteAvis(avis: avis, auSignaler: _signalerAvis, signalementEnCours: _action),
      ],
      // Cette page ne sert qu'a lire : elle dit que l'autre chemin existe.
      if (aNoter != null) ...[
        const SizedBox(height: 8),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(text: aNoter.phrase, style: fort),
                      TextSpan(text: ' ${aNoter.suite}'),
                    ],
                  ),
                  style: gris,
                ),
                const SizedBox(height: 12),
                FilledButton.icon(
                  onPressed: widget.auDonnerAvis,
                  icon: const Icon(Icons.star_border),
                  label: const Text('Donner mes avis'),
                ),
              ],
            ),
          ),
        ),
      ],
      if (motifRefus != null)
        Padding(
          padding: const EdgeInsets.only(top: 16),
          child: Text('Motif du refus : $motifRefus', style: aide),
        ),
    ];
  }
}

/// Un cadre colore, pour ce que l'equipe adresse a la personne.
class _Encadre extends StatelessWidget {
  const _Encadre({required this.fond, required this.children});

  final Color fond;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: fond, borderRadius: BorderRadius.circular(rayon)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
    );
  }
}

/// L'etat de la verification, avec la couleur des pastilles du site : le
/// vert reste reserve a ce qui a ete controle.
class _PastilleVerification extends StatelessWidget {
  const _PastilleVerification({required this.verification});

  final VerificationDuProfil verification;

  @override
  Widget build(BuildContext context) {
    return switch (verification.statut) {
      'verifie' => Pastille(
          texte: verification.libelle,
          icone: Icons.verified_user_outlined,
          fond: Couleurs.vertFond,
          couleur: Couleurs.vert,
        ),
      'en attente' => Pastille(texte: verification.libelle, fond: Couleurs.ambreFond, couleur: Couleurs.ambre),
      'refuse' => Pastille(texte: verification.libelle, fond: Couleurs.rougeFond, couleur: Couleurs.rouge),
      _ => Pastille(texte: verification.libelle, fond: Couleurs.trait, couleur: Couleurs.encreDouce),
    };
  }
}
