import 'package:flutter/material.dart';

import 'api.dart';
import 'ecran_confirmer_choix.dart';
import 'ecran_connexion.dart';
import 'ecran_publier.dart';
import 'elements.dart';
import 'modeles.dart';
import 'theme.dart';

/// Les demandes de l'employeur et les reponses recues : la meme chose que la
/// page Mes demandes du site, puisque les deux lisent la meme fonction du
/// serveur.
///
/// On peut y publier une demande, choisir ou refuser une personne.
/// Discuter ou modifier arrivent ensuite, chacun avec sa route testee :
/// aucun bouton n'est affiche avant de fonctionner.
class EcranMesDemandes extends StatefulWidget {
  const EcranMesDemandes({super.key, required this.api, required this.moi});

  final ApiPamConnect api;
  final Moi moi;

  @override
  State<EcranMesDemandes> createState() => _EcranMesDemandesState();
}

class _EcranMesDemandesState extends State<EcranMesDemandes> {
  late Moi _moi = widget.moi;
  MesDemandes? _mesDemandes;
  String? _erreur;
  bool _enCours = true;

  /// La phrase du serveur apres une publication, gardee en haut de l'ecran.
  String? _confirmation;

  /// Les reponses dont le refus est en cours d'envoi : leurs boutons sont
  /// desactives, pour qu'un double appui n'envoie pas deux fois.
  final Set<int> _decisionsEnCours = {};

  @override
  void initState() {
    super.initState();
    _charger();
  }

  Future<void> _actualiser() async {
    setState(() {
      _enCours = true;
      _erreur = null;
    });
    await _charger();
  }

  Future<void> _charger() async {
    try {
      final moi = await widget.api.moi();
      final mesDemandes = await widget.api.mesDemandes();
      if (!mounted) return;
      setState(() {
        _moi = moi;
        _mesDemandes = mesDemandes;
        _erreur = null;
        _enCours = false;
      });
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      if (erreur.refus) {
        revenirALaConnexion(context, widget.api, erreur.message);
        return;
      }
      setState(() {
        _erreur = erreur.message;
        _enCours = false;
      });
    }
  }

  Future<void> _ouvrirPublication() async {
    final publication = await Navigator.of(context).push<Publication>(
      MaterialPageRoute(builder: (_) => EcranPublier(api: widget.api)),
    );
    if (publication == null || !mounted) return;
    setState(() => _confirmation = publication.texte);
    await _actualiser();
  }

  /// L'action principale, comme sur le site : toujours a portee de main.
  Widget _boutonPublier() {
    return FilledButton.icon(
      onPressed: _ouvrirPublication,
      icon: const Icon(Icons.add),
      label: const Text('Publier une demande'),
    );
  }

  Future<void> _choisir(ReponseRecue reponse) async {
    setState(() {
      _confirmation = null;
      _erreur = null;
    });
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => EcranConfirmerChoix(api: widget.api, candidatureId: reponse.id),
      ),
    );
    // Au retour, choix fait ou non, on relit l'etat decide par le serveur.
    if (!mounted) return;
    await _actualiser();
  }

  /// Refuser reste immediat, comme sur le site : on ne s'engage a rien en
  /// refusant, et la demande reste ouverte.
  Future<void> _refuser(ReponseRecue reponse) async {
    if (_decisionsEnCours.contains(reponse.id)) return;
    setState(() {
      _decisionsEnCours.add(reponse.id);
      _confirmation = null;
      _erreur = null;
    });

    String? probleme;
    try {
      await widget.api.refuserCandidature(reponse.id);
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      probleme = erreur.message;
    }

    if (!mounted) return;
    await _charger();
    if (!mounted) return;
    setState(() {
      _decisionsEnCours.remove(reponse.id);
      if (probleme != null) _erreur = probleme;
    });
    // Le refus du serveur s'affiche en haut de la liste : la personne,
    // elle, regarde la carte plus bas. On le lui montre la ou elle est.
    if (probleme != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(probleme)));
    }
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
        title: const Text('Mes demandes'),
        actions: [
          IconButton(
            tooltip: 'Actualiser',
            onPressed: _enCours ? null : _actualiser,
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: 'Se déconnecter',
            onPressed: _seDeconnecter,
            icon: const Icon(Icons.logout),
          ),
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
    final gris = Theme.of(context).textTheme.bodyLarge?.copyWith(color: Couleurs.encreDouce);
    final donnees = _mesDemandes;
    return [
      EnTetePersonne(moi: _moi),
      const SizedBox(height: 12),
      Text('Ce que vous avez publié, et qui vous a répondu.', style: gris),
      const SizedBox(height: 16),
      if (_confirmation != null) ...[
        Confirmation(texte: _confirmation!),
        const SizedBox(height: 16),
      ],
      if (_erreur != null) ...[
        Avertissement(texte: _erreur!),
        const SizedBox(height: 16),
      ],
      if (donnees == null && _enCours)
        const Padding(
          padding: EdgeInsets.all(32),
          child: Center(child: CircularProgressIndicator()),
        ),
      if (donnees != null) ..._listes(donnees, gris),
    ];
  }

  List<Widget> _listes(MesDemandes donnees, TextStyle? gris) {
    if (donnees.demandes.isEmpty) {
      // Quand la liste est vide, le bouton est ici, et une seule fois.
      return [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 32),
          child: Text("Vous n'avez publié aucune demande.", textAlign: TextAlign.center, style: gris),
        ),
        _boutonPublier(),
      ];
    }

    final enCours = donnees.enCours;
    final terminees = donnees.terminees;
    return [
      _boutonPublier(),
      const SizedBox(height: 16),
      // UN TITRE SERT A DISTINGUER : "Demandes en cours" n'apparait que s'il y
      // a aussi des demandes terminees. La meme regle que sur le site.
      if (enCours.isNotEmpty && terminees.isNotEmpty) const TitreSection('Demandes en cours'),
      if (enCours.isEmpty)
        Padding(
          padding: const EdgeInsets.only(bottom: 16),
          child: Text('Aucune demande en cours.', style: gris),
        ),
      for (final demande in enCours) _CarteDemandePubliee(
            demande: demande,
            auChoix: _choisir,
            auRefus: _refuser,
            decisionsEnCours: _decisionsEnCours,
          ),
      if (terminees.isNotEmpty) ...[
        const TitreSection('Demandes terminées'),
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Text(
            "Retirées ou pourvues. Elles n'apparaissent plus dans la liste publique, "
            'mais vos discussions et vos versements y restent rattachés.',
            style: gris,
          ),
        ),
        for (final demande in terminees) _CarteDemandePubliee(
            demande: demande,
            auChoix: _choisir,
            auRefus: _refuser,
            decisionsEnCours: _decisionsEnCours,
          ),
      ],
    ];
  }
}

class _CarteDemandePubliee extends StatelessWidget {
  const _CarteDemandePubliee({
    required this.demande,
    required this.auChoix,
    required this.auRefus,
    required this.decisionsEnCours,
  });

  final DemandePubliee demande;
  final void Function(ReponseRecue) auChoix;
  final void Function(ReponseRecue) auRefus;
  final Set<int> decisionsEnCours;

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;
    final gris = texte.bodyMedium?.copyWith(color: Couleurs.encreDouce);
    final metier = demande.metier;
    final prix = demande.prixLisible;
    final duree = demande.dureeEstimee;
    final lieu = demande.lieu;
    final phraseFermeture = demande.phraseFermeture;
    final jusquAu = demande.enAvantJusquAu;

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                demande.titre,
                style: texte.titleMedium?.copyWith(
                  color: Couleurs.encre,
                  fontWeight: FontWeight.w600,
                ),
              ),
              if (metier != null) LigneDetail(icone: Icons.work_outline, texte: metier),
              LigneDetail(icone: Icons.calendar_today_outlined, texte: demande.horaire),
              if (prix != null) LigneDetail(icone: Icons.payments_outlined, texte: prix, aide: duree),
              if (lieu != null) LigneDetail(icone: Icons.place_outlined, texte: lieu),
              const SizedBox(height: 12),
              if (phraseFermeture != null)
                Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(
                        text: phraseFermeture,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      const TextSpan(
                        text: " Elle n'apparaît plus dans la liste et n'accepte plus de "
                            'réponse. Vos discussions restent accessibles.',
                      ),
                    ],
                  ),
                  style: gris,
                )
              else if (demande.enAvant)
                Row(
                  children: [
                    const Pastille(texte: 'Mise en avant'),
                    if (jusquAu != null) ...[
                      const SizedBox(width: 8),
                      Flexible(child: Text("jusqu'au $jusquAu", style: gris)),
                    ],
                  ],
                ),
              const Divider(height: 32),
              if (demande.reponses.isEmpty)
                Text("Personne n'a encore répondu.", style: gris)
              else
                for (final reponse in demande.reponses)
                  _CarteReponse(
                    reponse: reponse,
                    prix: prix,
                    auChoix: auChoix,
                    auRefus: auRefus,
                    occupe: decisionsEnCours.contains(reponse.id),
                  ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CarteReponse extends StatelessWidget {
  const _CarteReponse({
    required this.reponse,
    required this.prix,
    required this.auChoix,
    required this.auRefus,
    required this.occupe,
  });

  final ReponseRecue reponse;
  final void Function(ReponseRecue) auChoix;
  final void Function(ReponseRecue) auRefus;

  /// Un refus est en cours d'envoi pour cette reponse.
  final bool occupe;

  /// Le montant retenu pour cette reponse, comme sur le site.
  final String? prix;

  /// La couleur suit l'etat de l'identite ; le texte, lui, vient du serveur.
  Pastille _pastilleIdentite() => switch (reponse.verification) {
        'verifie' => Pastille(
            texte: reponse.libelleVerification,
            icone: Icons.verified_user_outlined,
            fond: Couleurs.vertFond,
            couleur: Couleurs.vert,
          ),
        'en attente' => Pastille(
            texte: reponse.libelleVerification,
            fond: Couleurs.ambreFond,
            couleur: Couleurs.ambre,
          ),
        'refuse' => Pastille(
            texte: reponse.libelleVerification,
            fond: Couleurs.rougeFond,
            couleur: Couleurs.rouge,
          ),
        _ => Pastille(
            texte: reponse.libelleVerification,
            fond: Couleurs.bleuClair,
            couleur: Couleurs.encreDouce,
          ),
      };

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;
    final gris = texte.bodyMedium?.copyWith(color: Couleurs.encreDouce);
    final prix = this.prix;
    final experience = reponse.experience;
    final disponibilites = reponse.disponibilites;

    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                backgroundColor: Couleurs.bleuClair,
                foregroundColor: Couleurs.bleuFonce,
                child: Text(reponse.nom.isEmpty ? '' : reponse.nom.characters.first),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      reponse.nom,
                      style: texte.titleSmall?.copyWith(
                        color: Couleurs.encre,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(reponse.phrase, style: gris),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              _pastilleIdentite(),
              Pastille(
                texte: reponse.note.badge,
                icone: reponse.note.notee ? Icons.star_border : null,
              ),
              Text(reponse.note.detail, style: gris),
            ],
          ),
          if (prix != null) LigneDetail(icone: Icons.payments_outlined, texte: prix),
          if (experience != null) LigneDetail(icone: Icons.work_history_outlined, texte: experience),
          if (disponibilites != null)
            LigneDetail(icone: Icons.calendar_today_outlined, texte: 'Disponible', enGras: disponibilites),
          if (reponse.attendVerification)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                'Vous pourrez accepter cette candidature dès que PamConnect aura '
                "vérifié l'identité de cette personne.",
                style: gris,
              ),
            ),
          // Les boutons suivent les decisions du serveur : ni sur une reponse
          // deja tranchee, ni sur une demande retiree.
          if (reponse.peutChoisir || reponse.peutRefuser) const SizedBox(height: 12),
          if (reponse.peutChoisir) ...[
            FilledButton.icon(
              onPressed: occupe ? null : () => auChoix(reponse),
              icon: const Icon(Icons.check),
              label: const Text('Choisir cette personne'),
            ),
            const SizedBox(height: 8),
          ],
          if (reponse.peutRefuser) ...[
            OutlinedButton.icon(
              onPressed: occupe ? null : () => auRefus(reponse),
              icon: const Icon(Icons.close),
              label: const Text('Refuser cette candidature'),
              style: OutlinedButton.styleFrom(
                foregroundColor: Couleurs.rouge,
                side: const BorderSide(color: Couleurs.rouge),
                minimumSize: const Size.fromHeight(48),
              ),
            ),
            // La question se pose exactement ici : refuser ferme-t-il la
            // demande ? Non, seul un choix la pourvoit.
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                "Refuser ne retire pas votre demande : elle reste visible, et d'autres "
                'personnes peuvent encore y répondre.',
                style: gris,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
