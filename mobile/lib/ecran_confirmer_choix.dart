import 'package:flutter/material.dart';

import 'api.dart';
import 'ecran_connexion.dart';
import 'ecran_fiche.dart';
import 'elements.dart';
import 'modeles.dart';
import 'theme.dart';

/// Relire avant de choisir : l'ecran "Confirmer votre choix" du site.
///
/// Rien n'est decide tant que l'employeur n'a pas confirme. Le serveur
/// refuse de lui-meme un choix impossible (decision deja prise, demande
/// retiree, identite non verifiee) : l'ecran affiche alors sa phrase.
class EcranConfirmerChoix extends StatefulWidget {
  const EcranConfirmerChoix({super.key, required this.api, required this.candidatureId});

  final ApiPamConnect api;
  final int candidatureId;

  @override
  State<EcranConfirmerChoix> createState() => _EcranConfirmerChoixState();
}

class _EcranConfirmerChoixState extends State<EcranConfirmerChoix> {
  ConfirmationChoix? _ecran;

  /// Le serveur refuse d'ouvrir l'ecran : il dit pourquoi.
  String? _refus;
  String? _erreurEnvoi;
  bool _envoi = false;

  @override
  void initState() {
    super.initState();
    _charger();
  }

  Future<void> _charger() async {
    try {
      final ecran = await widget.api.confirmationChoix(widget.candidatureId);
      if (!mounted) return;
      setState(() => _ecran = ecran);
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      setState(() => _refus = erreur.message);
    }
  }

  Future<void> _confirmer() async {
    if (_envoi) return;
    setState(() {
      _envoi = true;
      _erreurEnvoi = null;
    });

    try {
      await widget.api.choisirCandidature(widget.candidatureId);
      if (!mounted) return;
      Navigator.of(context).pop();
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      setState(() {
        _envoi = false;
        _erreurEnvoi = erreur.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Confirmer votre choix')),
      body: SafeArea(child: _corps(context)),
    );
  }

  Widget _corps(BuildContext context) {
    final refus = _refus;
    final ecran = _ecran;
    const hauteurBouton = Size.fromHeight(48);

    if (refus != null) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Avertissement(texte: refus),
          const SizedBox(height: 16),
          OutlinedButton(
            onPressed: () => Navigator.of(context).pop(),
            style: OutlinedButton.styleFrom(minimumSize: hauteurBouton),
            child: const Text('Retour à mes demandes'),
          ),
        ],
      );
    }
    if (ecran == null) {
      return const Center(child: CircularProgressIndicator());
    }

    final texte = Theme.of(context).textTheme;
    final gris = texte.bodyMedium?.copyWith(color: Couleurs.encreDouce);
    final aide = texte.bodyMedium?.copyWith(color: Couleurs.encrePale);
    final metier = ecran.metier;
    final experience = ecran.experience;
    final service = ecran.service;
    final duree = ecran.duree;
    final lieu = ecran.lieu;
    final conditions = ecran.conditions;
    final paiement = ecran.paiement;
    final refusAnnonces = ecran.refusAnnonces;
    final erreurEnvoi = _erreurEnvoi;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          "Relisez ce sur quoi vous vous engagez. Rien n'est décidé tant que vous "
          "n'avez pas confirmé.",
          style: texte.bodyLarge?.copyWith(color: Couleurs.encreDouce),
        ),
        const SizedBox(height: 8),
        const TitreSection('La personne que vous choisissez'),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      backgroundColor: Couleurs.bleuClair,
                      foregroundColor: Couleurs.bleuFonce,
                      child: Text(ecran.nom.isEmpty ? '' : ecran.nom.characters.first),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            ecran.nom,
                            style: texte.titleMedium?.copyWith(
                              color: Couleurs.encre,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          if (metier != null) Text(metier, style: gris),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    // Le serveur n'ouvre cet ecran que pour une identite
                    // verifiee : l'etiquette est donc toujours vraie ici.
                    const Pastille(
                      texte: 'Identité et casier vérifiés',
                      icone: Icons.verified_user_outlined,
                      fond: Couleurs.vertFond,
                      couleur: Couleurs.vert,
                    ),
                    Pastille(
                      texte: ecran.note.badge,
                      icone: ecran.note.notee ? Icons.star_border : null,
                    ),
                    Text(ecran.note.detail, style: gris),
                    if (experience != null)
                      Pastille(texte: experience, icone: Icons.work_history_outlined),
                  ],
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: () => Navigator.of(context).push<void>(
                    MaterialPageRoute(
                      builder: (_) => EcranFiche(api: widget.api, personneId: ecran.prestataireId),
                    ),
                  ),
                  icon: const Icon(Icons.person_outline),
                  label: const Text('Voir son profil'),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          'Identité vérifiée ne veut pas dire compétences vérifiées : le métier '
          'est déclaré par la personne.',
          style: aide,
        ),
        const SizedBox(height: 8),
        const TitreSection('La prestation'),
        Card(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (service != null)
                  LigneDetail(icone: Icons.work_outline, texte: 'Service :', enGras: service),
                LigneDetail(
                  icone: Icons.calendar_today_outlined,
                  texte: 'Horaire :',
                  enGras: ecran.horaire,
                ),
                if (duree != null)
                  LigneDetail(icone: Icons.timer_outlined, texte: 'Durée estimée :', enGras: duree),
                // Le lieu general, jamais l'adresse exacte.
                if (lieu != null) LigneDetail(icone: Icons.place_outlined, texte: 'Lieu :', enGras: lieu),
                if (conditions != null) LigneDetail(icone: Icons.info_outline, texte: conditions),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        const TitreSection('Ce que vous payez'),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Les montants arrivent calcules par le serveur : la
                // commission n'est jamais recalculee ici.
                if (paiement != null) ...[
                  _LignePaiement(libelle: 'Vous payez', montant: paiement.vousPayez, fort: true),
                  _LignePaiement(
                    libelle: 'Commission PamConnect (${paiement.pourcentageCommission} %)',
                    montant: '− ${paiement.commission}',
                  ),
                  const Divider(height: 20),
                  _LignePaiement(libelle: '${ecran.nom} reçoit', montant: paiement.recoit, fort: true),
                ] else ...[
                  Text("${ecran.nom} n'a pas encore indiqué de tarif."),
                  Text('Demandez-lui son montant dans la discussion.', style: aide),
                ],
                const SizedBox(height: 12),
                Text(
                  "C'est le prix que vous avez annoncé dans votre demande. "
                  '${ecran.nom} a répondu en le connaissant.',
                  style: aide,
                ),
                const SizedBox(height: 8),
                Text(
                  "Aucun autre frais ne s'ajoute : l'employeur paie le montant affiché, "
                  'rien de plus. La commission est retenue sur la part de la personne.',
                  style: aide,
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        // Ce qui va se passer, dit AVANT d'appuyer.
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Semantics(
                  header: true,
                  child: Text(
                    'Ce qui se passera ensuite',
                    style: texte.titleMedium?.copyWith(
                      color: Couleurs.bleuFonce,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                const _LigneEnsuite(
                  icone: Icons.description_outlined,
                  debut: 'Votre demande sera ',
                  gras: 'retirée de la liste',
                  fin: " : quelqu'un a été choisi.",
                ),
                if (refusAnnonces != null)
                  _LigneEnsuite(
                    icone: Icons.close,
                    gras: '${refusAnnonces.nombre}',
                    fin: ' ${refusAnnonces.suite}',
                  ),
                const _LigneEnsuite(
                  icone: Icons.chat_bubble_outline,
                  debut: 'Vos discussions restent accessibles, y compris avec les autres candidates.',
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 24),
        if (erreurEnvoi != null) ...[
          Avertissement(texte: erreurEnvoi),
          const SizedBox(height: 16),
        ],
        FilledButton(
          onPressed: _envoi ? null : _confirmer,
          child: _envoi
              ? const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2.5, color: Couleurs.bleuFonce),
                )
              : Text('Confirmer et choisir ${ecran.nom}', textAlign: TextAlign.center),
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: _envoi ? null : () => Navigator.of(context).pop(),
          style: OutlinedButton.styleFrom(minimumSize: hauteurBouton),
          child: const Text('Annuler'),
        ),
      ],
    );
  }
}

/// Une ligne du detail du paiement : le libelle a gauche, le montant a droite.
class _LignePaiement extends StatelessWidget {
  const _LignePaiement({required this.libelle, required this.montant, this.fort = false});

  final String libelle;
  final String montant;
  final bool fort;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodyLarge?.copyWith(
          color: fort ? Couleurs.encre : Couleurs.encreDouce,
          fontWeight: fort ? FontWeight.w600 : FontWeight.normal,
        );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: Text(libelle, style: style)),
          const SizedBox(width: 12),
          Text(montant, style: style),
        ],
      ),
    );
  }
}

/// Une consequence annoncee, avec sa partie importante en gras.
class _LigneEnsuite extends StatelessWidget {
  const _LigneEnsuite({required this.icone, this.debut = '', this.gras = '', this.fin = ''});

  final IconData icone;
  final String debut;
  final String gras;
  final String fin;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icone, size: 18, color: Couleurs.encreDouce),
          const SizedBox(width: 8),
          Expanded(
            child: Text.rich(
              TextSpan(
                children: [
                  if (debut.isNotEmpty) TextSpan(text: debut),
                  if (gras.isNotEmpty)
                    TextSpan(
                      text: gras,
                      style: const TextStyle(fontWeight: FontWeight.w600, color: Couleurs.encre),
                    ),
                  if (fin.isNotEmpty) TextSpan(text: fin),
                ],
              ),
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Couleurs.encreDouce),
            ),
          ),
        ],
      ),
    );
  }
}
