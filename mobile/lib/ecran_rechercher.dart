import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import 'api.dart';
import 'ecran_connexion.dart';
import 'ecran_fiche.dart';
import 'ecran_publier.dart';
import 'elements.dart';
import 'modeles.dart';
import 'theme.dart';

/// Rechercher : trouver quelqu'un par metier, comme la page Trouver
/// quelqu'un du site.
///
/// Deux boutons, comme sur le site : "Chercher pres de moi" demande la
/// position du telephone a ce moment-la ; "Chercher sans ma position"
/// laisse la proximite se mesurer a partir du quartier de l'employeur, et
/// le serveur le dit en une phrase. Le classement vient du serveur ; son
/// score ne s'affiche jamais.
class EcranRechercher extends StatefulWidget {
  const EcranRechercher({super.key, required this.api, this.rafraichir = 0});

  final ApiPamConnect api;

  /// Change quand l'onglet est rouvert : la recherche se relance.
  final int rafraichir;

  @override
  State<EcranRechercher> createState() => _EcranRechercherState();
}

class _EcranRechercherState extends State<EcranRechercher> {
  final _metier = TextEditingController();
  ResultatRecherche? _resultat;
  String? _erreur;
  bool _enCours = true;
  int _numero = 0;

  // La position de la derniere recherche "pres de moi" : Actualiser la
  // garde. "Chercher sans ma position" l'efface.
  double? _latitude;
  double? _longitude;
  bool _chercheLaPosition = false;
  String? _messagePosition;

  @override
  void initState() {
    super.initState();
    _chercher();
  }

  @override
  void didUpdateWidget(EcranRechercher ancien) {
    super.didUpdateWidget(ancien);
    if (ancien.rafraichir != widget.rafraichir) _chercher();
  }

  @override
  void dispose() {
    _metier.dispose();
    super.dispose();
  }

  Future<void> _chercher() async {
    final numero = ++_numero;
    // Au tout premier chargement, l'ecran n'est pas encore affiche : pas de
    // setState avant la reponse.
    if (_resultat != null || _erreur != null) {
      setState(() {
        _enCours = true;
        _erreur = null;
      });
    }

    try {
      final resultat = await widget.api.rechercher(_metier.text, latitude: _latitude, longitude: _longitude);
      // Une reponse plus ancienne que la derniere recherche est ignoree.
      if (!mounted || numero != _numero) return;
      setState(() {
        _resultat = resultat;
        _enCours = false;
      });
    } on ErreurApi catch (erreur) {
      if (!mounted || numero != _numero) return;
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

  void _lancerSansPosition() {
    FocusScope.of(context).unfocus();
    setState(() {
      _latitude = null;
      _longitude = null;
      _messagePosition = null;
    });
    _chercher();
  }

  /// "Chercher pres de moi" : la position d'abord, puis la recherche. Si
  /// elle ne vient pas (refus, localisation coupee, delai depasse), la
  /// recherche part sans position, avec la phrase du site.
  Future<void> _lancerPresDeMoi() async {
    FocusScope.of(context).unfocus();
    setState(() {
      _chercheLaPosition = true;
      _messagePosition = 'Recherche de votre position...';
    });
    final position = await _positionDuTelephone();
    if (!mounted) return;
    setState(() {
      _chercheLaPosition = false;
      _latitude = position?.latitude;
      _longitude = position?.longitude;
      _messagePosition = position == null ? 'Position indisponible. Recherche sans classement par distance.' : null;
    });
    await _chercher();
  }

  /// La position du telephone, ou null. Android pose sa question la
  /// premiere fois ; apres un refus, on ne la force pas.
  Future<Position?> _positionDuTelephone() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return null;
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
        return null;
      }
      try {
        // Sans internet, seuls les satellites donnent la position, et dans
        // une salle ils peuvent ne jamais repondre : 15 secondes au plus.
        return await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.medium,
            timeLimit: Duration(seconds: 15),
          ),
        );
      } on TimeoutException {
        // La derniere position que le telephone connait, si elle a moins
        // d'une heure : au-dela, la personne a pu changer de quartier.
        final derniere = await Geolocator.getLastKnownPosition();
        if (derniere == null) return null;
        final age = DateTime.now().difference(derniere.timestamp);
        return age < const Duration(hours: 1) ? derniere : null;
      }
    } on Exception {
      return null;
    }
  }

  Future<void> _voirProfil(PersonneTrouvee personne) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(builder: (_) => EcranFiche(api: widget.api, personneId: personne.id)),
    );
  }

  Future<void> _publier() async {
    final texte = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => EcranPublier(api: widget.api)),
    );
    if (!mounted || texte == null) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(texte)));
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
        title: const Text("Trouver quelqu'un"),
        actions: [
          IconButton(tooltip: 'Actualiser', onPressed: _chercher, icon: const Icon(Icons.refresh)),
          IconButton(tooltip: 'Se déconnecter', onPressed: _seDeconnecter, icon: const Icon(Icons.logout)),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _chercher,
        child: ListView(
          padding: const EdgeInsets.all(16),
          physics: const AlwaysScrollableScrollPhysics(),
          children: _contenu(context),
        ),
      ),
    );
  }

  List<Widget> _contenu(BuildContext context) {
    final texte = Theme.of(context).textTheme;
    final gris = texte.bodyMedium?.copyWith(color: Couleurs.encreDouce);
    final aide = texte.bodyMedium?.copyWith(color: Couleurs.encrePale);
    const gras = TextStyle(fontWeight: FontWeight.w600, color: Couleurs.encre);
    final resultat = _resultat;
    final erreur = _erreur;
    final phraseLieu = resultat?.phraseLieu;

    return [
      Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _metier,
                textInputAction: TextInputAction.search,
                // Comme la touche Entree du site : le premier bouton.
                onSubmitted: (_) => _lancerPresDeMoi(),
                decoration: const InputDecoration(
                  labelText: 'Quel métier cherchez-vous ?',
                  hintText: 'ex : ménage, nounou, jardinage...',
                ),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: _enCours || _chercheLaPosition ? null : _lancerPresDeMoi,
                icon: const Icon(Icons.place_outlined),
                label: const Text('Chercher près de moi'),
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: _enCours || _chercheLaPosition ? null : _lancerSansPosition,
                icon: const Icon(Icons.search),
                label: const Text('Chercher sans ma position'),
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
              ),
              if (_messagePosition != null) ...[
                const SizedBox(height: 8),
                Text(_messagePosition!, style: aide),
              ],
            ],
          ),
        ),
      ),
      if (_enCours && resultat != null) const LinearProgressIndicator(),
      const SizedBox(height: 8),
      if (erreur != null) ...[
        Avertissement(texte: erreur),
        const SizedBox(height: 16),
      ],
      if (resultat == null && _enCours)
        const Padding(
          padding: EdgeInsets.all(32),
          child: Center(child: CircularProgressIndicator()),
        ),
      if (resultat != null) ...[
        TitreSection(resultat.titre),
        if (phraseLieu != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(phraseLieu, style: aide),
          ),
        // ON DIT CE QUI COMPTE, sans donner de note, et ce qui n'y entre pas.
        if (resultat.classementExplique)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text.rich(
              const TextSpan(
                children: [
                  TextSpan(text: "Le classement tient compte de l'"),
                  TextSpan(text: 'identité vérifiée', style: gras),
                  TextSpan(text: ', des '),
                  TextSpan(text: 'avis', style: gras),
                  TextSpan(text: ', des '),
                  TextSpan(text: 'services terminés', style: gras),
                  TextSpan(text: ' sans désaccord, des '),
                  TextSpan(text: 'disponibilités', style: gras),
                  TextSpan(text: ' et de la '),
                  TextSpan(text: 'proximité', style: gras),
                  TextSpan(text: '. Personne ne peut payer pour apparaître en premier.'),
                ],
              ),
              style: aide,
            ),
          ),
        if (resultat.personnes.isEmpty) ...[
          Text('Personne ne correspond à cette recherche.', style: texte.bodyLarge?.copyWith(color: Couleurs.encreDouce)),
          const SizedBox(height: 4),
          Text('Essayez un autre mot, par exemple « ménage » au lieu de « nettoyage ».', style: aide),
        ] else ...[
          // Une seule fois, en haut : la phrase vaut pour toute la liste.
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(
              'Identité vérifiée ne veut pas dire compétences vérifiées : le métier est déclaré par la personne.',
              style: gris,
            ),
          ),
          for (final personne in resultat.personnes) _CartePersonne(personne: personne, auVoirProfil: _voirProfil),
          // L'IMPASSE : on n'embauche pas en un clic. On propose une demande a
          // la personne depuis son profil, ou on publie pour tout le monde.
          if (resultat.peutPublier)
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: Couleurs.bleuClair, borderRadius: BorderRadius.circular(rayon)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    "Vous avez trouvé quelqu'un ?",
                    style: texte.titleSmall?.copyWith(color: Couleurs.bleu, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    "Depuis le profil d'une personne vérifiée, publiez une demande pour elle : elle la verra "
                    'en premier. Vous pouvez aussi publier une demande pour tout le monde.',
                    style: gris,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    "La somme que vous annoncez est bloquée dès la publication, et vous ne payez qu'après le "
                    'service.',
                    style: aide,
                  ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: _publier,
                    icon: const Icon(Icons.add),
                    label: const Text('Publier une demande'),
                  ),
                ],
              ),
            ),
        ],
      ],
    ];
  }
}

class _CartePersonne extends StatelessWidget {
  const _CartePersonne({required this.personne, required this.auVoirProfil});

  final PersonneTrouvee personne;
  final void Function(PersonneTrouvee) auVoirProfil;

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;
    final gris = texte.bodyMedium?.copyWith(color: Couleurs.encreDouce);
    final metier = personne.metier;
    final jours = personne.joursDisponibles;
    final experience = personne.experience;
    final lieu = personne.lieu;
    final distance = personne.distance;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    backgroundColor: Couleurs.bleuClair,
                    foregroundColor: Couleurs.bleuFonce,
                    child: Text(personne.nom.isEmpty ? '' : personne.nom.characters.first),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          personne.nom,
                          style: texte.titleSmall?.copyWith(color: Couleurs.bleu, fontWeight: FontWeight.w600),
                        ),
                        if (metier != null) Text(metier, style: gris),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              // LA REPUTATION, A COTE DE LA VERIFICATION : les deux seules
              // choses de cette carte qui ne viennent pas de la personne.
              Wrap(
                spacing: 8,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  personne.verifiee
                      ? Pastille(
                          texte: personne.libelleVerification,
                          icone: Icons.verified_user_outlined,
                          fond: Couleurs.vertFond,
                          couleur: Couleurs.vert,
                        )
                      : Pastille(texte: personne.libelleVerification, fond: Couleurs.trait, couleur: Couleurs.encreDouce),
                  Pastille(texte: personne.note.badge, icone: personne.note.notee ? Icons.star_border : null),
                  Text(personne.note.detail, style: gris),
                ],
              ),
              if (jours != null) LigneDetail(icone: Icons.calendar_today_outlined, texte: 'Disponible', enGras: jours),
              if (experience != null) LigneDetail(icone: Icons.work_outline, texte: experience),
              if (lieu != null) LigneDetail(icone: Icons.place_outlined, texte: lieu),
              LigneDetail(icone: Icons.payments_outlined, texte: 'Tarif demandé :', enGras: personne.tarif),
              // Comme le site : "Distance inconnue" quand la recherche est
              // partie sans position.
              LigneDetail(icone: Icons.schedule, texte: distance ?? 'Distance inconnue'),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: () => auVoirProfil(personne),
                icon: const Icon(Icons.person_outline),
                label: const Text('Voir le profil'),
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
