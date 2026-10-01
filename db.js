'use strict';

/* =====================================================================
   THE LAST VIBE — Couche de données
   ---------------------------------------------------------------------
   Deux implémentations derrière la même interface :
     • PostgresStore : persistance réelle PostgreSQL (pool pg).
       Utilisée quand DATABASE_URL est fournie (Supabase / Neon / Replit).
     • MemoryStore   : clone en mémoire, utilisé si aucune DATABASE_URL
       (idéal pour tester instantanément ou sur un hébergement sans BDD).

   L'app se construit avec `createStore()`, qui choisit automatiquement.
===================================================================== */

const crypto = require('crypto');

/* ---------------------------------------------------------------------
   OUTILS COMMUNS
--------------------------------------------------------------------- */
const dateStr = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const addDays = (d, n) => {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
};
const slug = (len = 8) => crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);

/* Calcule la série de votes consécutifs à partir de la dernière date. */
function nextStreak(prevDate, count) {
  const today = dateStr(new Date());
  if (!prevDate) return 1;
  if (prevDate === today) return count;          // déjà voté aujourd'hui
  if (prevDate === dateStr(addDays(new Date(), -1))) return count + 1; // hier → on enchaîne
  return 1;                                       // coupure → on repart
}

/* Points "de justice" et badges (gamification, calculés à la volée). */
function pointsAndBadges(votes, streak) {
  const points = votes * 10 + Math.max(0, streak - 1) * 25;
  const badges = [];
  if (votes >= 5) badges.push({ icon: '🗡️', label: 'Recrue du prétoire' });
  if (votes >= 20) badges.push({ icon: '⚖️', label: 'Greffier' });
  if (votes >= 50) badges.push({ icon: '🧑‍⚖️', label: 'Bourreau' });
  if (votes >= 150) badges.push({ icon: '👑', label: 'Juge Suprême' });
  if (streak >= 3) badges.push({ icon: '🔥', label: 'Enchaîné' });
  if (streak >= 7) badges.push({ icon: '⚡', label: 'Inarrêtable' });
  return { points, badges };
}

/* ---------------------------------------------------------------------
   DONNÉES INITIALES (seed) — les 10 affaires cultes du Tribunal
--------------------------------------------------------------------- */
const SEED_CASES = [
  { title: 'L’affaire du gâteau à minuit',
    author: 'Anonyme #007', original: 'c1',
    text: 'J’ai mangé la dernière part de gâteau à minuit sans rien dire… et j’ai laissé une note anonyme à ma colocataire. La note disait : « le gâteau est parti vivre ailleurs ».',
    verdict: {
      comment: 'Manger n’est pas un crime. Manger ET inventer un départ émotionnel pour un gâteau, c’est du vol avec finesse scénaristique. Vous avez l’étoffe d’un dealer de frigo.',
      crime: 'soustraction qualifiée d’un dessert avec récit d’exil',
      sentence: 'Condamné à remplacer le gâteau par un « bonjour » enrobé de culpabilité, et 48 h de jeûne médiatique.',
    } },
  { title: 'L’affaire du « k » vengeur',
    author: 'Anonyme #153', original: 'c2',
    text: 'J’ai répondu « k » à un message de rupture un peu lourde. Je regrette rien. Si, je regrette de pas avoir mis la majuscule.',
    verdict: {
      comment: 'Le « k » est officiellement le cimeterre de la messagerie moderne. Vous avez transformé un drame en opéra klezmer, et c’est presque élégant.',
      crime: 'exécution d’une relation à grands coups de touche « entrée »',
      sentence: '100 heures de messages avec des mots entiers. Interdiction d’utiliser le bouton entrée, sauf pour vomir son âme.',
    } },
  { title: 'L’affaire du micro-ondes éploré',
    author: 'Anonyme #021', original: 'c3',
    text: 'J’ai laissé le micro-ondes du bureau ouvert, la lumière allumée, le plateau tournant qui tourne en attendant que « les gens se reprennent ». C’est ma déclaration de guerre personnelle.',
    verdict: {
      comment: 'Laisser un micro-ondes couver son petit drame dans l’open space, c’est déclarer une guerre de basse intensité aux voisins de bureau. Sublime tacticien, terrible humain.',
      crime: 'levée d’un drapeau blanc du désespoir thermique',
      sentence: 'Interdiction de micro-ondes pendant 72 h. Vous chaufferez votre soupe au regard des collègues, ça la tiendra tiède.',
    } },
  { title: 'L’affaire du cardio de vestiaire',
    author: 'Anonyme #334', original: 'c4',
    text: 'Je paye la salle de sport depuis 8 mois, j’y vais uniquement pour respirer dans les vestiaires après le boulot. Le cardio, c’est le va-et-vient de la porte.',
    verdict: {
      comment: '99 % de planning non respecté, 100 % de l’objectif atteint : le cardio du vestiaire est accompli. On a moins affaire à un fainéant qu’à un philosophe des lieux humides.',
      crime: 'détournement d’abonnement au profit du calme intérieur',
      sentence: 'Réintégration d’office au club des « je paie pour l’éthique » pendant 6 mois, séance de vélo comprise.',
    } },
  { title: 'L’affaire du boss en meme',
    author: 'Anonyme #089', original: 'c5',
    text: 'J’ai posté un meme sur le visage de mon boss dans un groupe privé… sauf que le groupe privé a leaké, et le meme a fait 12 000 vues. Le boss met des coeurs. J’ai peur.',
    verdict: {
      comment: 'Publier votre boss en meme, c’est signer votre propre feuilleton RH. Le Tribunal rit avec vous ; il rira aussi quand les ressources humaines fermeront les volets.',
      crime: 'complicité de viralité avec la direction induite',
      sentence: 'Acquitté mais surveillé. Le Juge conserve le lien du meme. Pour… archivage.',
    } },
  { title: 'L’affaire de la grand-mère',
    author: 'Anonyme #777', original: 'c6',
    text: 'J’ai prétendu avoir appelé ma grand-mère tout le week-end. Pile le dimanche, elle appelle. J’ai scanné l’appel, disant que le réseau était mauvais, en criant : « ALLÔ ?! »',
    verdict: {
      comment: 'Oser prétendre qu’on a appelé sa grand-mère ? La grand-mère, elle, rappelle. Le tribunal, lui, a la facture détaillée de ce mensonge. Personne ne ment au réseau.',
      crime: 'faux et usage de famille en réunion',
      sentence: 'Deux appels de 45 minutes à votre mamie, mise sur écoute intégrale. Et un seul sujet : vous, et pourquoi vous mentez si mal.',
    } },
  { title: 'L’affaire du câble USB-C',
    author: 'Anonyme #411', original: 'c7',
    text: 'J’ai piqué un câble USB-C au bureau « pour le prêter ». Ça fait trois semaines. Il est devenu LE câble de la maison. Je le défends les soirs comme un enfant.',
    verdict: {
      comment: 'Un câble USB-C subtilisé au bureau n’est pas un larcin, c’est un phénomène naturel : les câbles se réincarnent toujours ailleurs. Vous avez simplement armé le cycle.',
      crime: 'prélèvement d’une ressource conductrice vitale',
      sentence: 'Prison préventive le temps de retrouver deux chargeurs homologués et un câble de rachat spirituel.',
    } },
  { title: 'L’affaire de la PR aveugle',
    author: 'Anonyme #222', original: 'c8',
    text: 'J’ai validé une PR sans la lire. Deux bugs sont partis en production. Le lead a dit « bien joué ». Je crois qu’il parlait au monotâche de l’étagère.',
    verdict: {
      comment: 'Valider une PR sans la lire, c’est le geste noble du gardien de phare qui éteint la lumière pour la forme. Deux bugs en prod, ce n’est pas une erreur, c’est un livrable signé.',
      crime: 'exécution d’un déploiement les yeux dans les étoiles',
      sentence: 'Condamné à subir la prochaine démo client en costume de licorne, moyen de preuve : humilité.',
    } },
  { title: 'L’affaire des poubelles diplomatiques',
    author: 'Anonyme #690', original: 'c9',
    text: 'J’ai écrit « je sors les poubelles » pour quitter un séminaire Teams. Les poubelles sont dans mon appart. Le séminaire était en visio. Personne n’a rien dit.',
    verdict: {
      comment: 'Utiliser « je sors les poubelles » pour quitter un séminaire en visio est la preuve que l’évasion assistée par ordinateur est devenue une discipline olympique.',
      crime: 'faux alibi écologique en réunion',
      sentence: 'Peine : 2 h de back-to-back à écouter un talk intitulé « L’impact transformationnel des synergies ». En présentiel. Sans poubelles.',
    } },
  { title: 'L’affaire du fromage « À personne »',
    author: 'Anonyme #999', original: 'c10',
    text: 'J’ai mangé la tranche de fromage du frigo collab marquée « À personne ». C’était le seul goût de la journée. Je hurlerais le prénom du fromage si je le connaissais.',
    verdict: {
      comment: 'Le fromage « À personne » du réfrigérateur collectif est le seul produit qui nourrit réellement le groupe : il teste la capacité d’abnégation des humains. Vous avez échoué, avec panache.',
      crime: 'défaussement de patrimoine alimentaire commun',
      sentence: 'Restitution par l’ouvrage : vous déposerez un fromage « À tous sauf à vous » samedi prochain, avec un mot anonyme soigneusement forgé.',
    } },
];

/* =====================================================================
   STORE POSTGRESQL
===================================================================== */
class PostgresStore {
  constructor(connectionString) {
    this.connectionString = connectionString;
    this.pool = null;
  }

  async init() {
    const { Pool } = require('pg');
    // Neon/Render imposent SSL : on force si la chaîne le demande,
    // sans vérification de certificat (hébergeurs avec CA custom).
    const ssl = /sslmode=(require|verify-ca|verify-full)/i.test(this.connectionString)
      ? { rejectUnauthorized: false }
      : undefined;
    this.pool = new Pool({
      connectionString: this.connectionString,
      ...(ssl ? { ssl } : {}),
      ...( { connectionTimeoutMillis: 10000 } ),
    });
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS cases (
        id          TEXT PRIMARY KEY,
        title       TEXT,
        text        TEXT NOT NULL,
        verdict     JSONB NOT NULL,
        author      TEXT NOT NULL DEFAULT 'Anonyme',
        daily_date  DATE,
        share_count INTEGER NOT NULL DEFAULT 0,
        flagged     BOOLEAN NOT NULL DEFAULT FALSE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_daily ON cases(daily_date);

      CREATE TABLE IF NOT EXISTS votes (
        case_id    TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        voter      TEXT NOT NULL,
        side       TEXT NOT NULL CHECK (side IN ('guilty','innocent')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (case_id, voter)
      );
      CREATE INDEX IF NOT EXISTS idx_votes_case ON votes(case_id);
      CREATE INDEX IF NOT EXISTS idx_votes_created ON votes(created_at);

      CREATE TABLE IF NOT EXISTS reactions (
        case_id    TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        voter      TEXT NOT NULL,
        emoji      TEXT,
        comment    TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (case_id, voter)
      );
      CREATE INDEX IF NOT EXISTS idx_reactions_case ON reactions(case_id);

      CREATE TABLE IF NOT EXISTS streaks (
        voter      TEXT PRIMARY KEY,
        last_vote  DATE,
        count      INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS users (
        id          TEXT PRIMARY KEY,
        provider    TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        name        TEXT NOT NULL,
        avatar      TEXT,
        email       TEXT,
        voter       TEXT NOT NULL UNIQUE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_login  TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (provider, provider_id)
      );

      ALTER TABLE cases ADD COLUMN IF NOT EXISTS lang TEXT;

      CREATE TABLE IF NOT EXISTS case_i18n (
        case_id    TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        lang       TEXT NOT NULL,
        title      TEXT,
        text       TEXT NOT NULL,
        verdict    JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (case_id, lang)
      );
    `);
    await this.seedIfEmpty();
    return this;
  }

  async seedIfEmpty() {
    const { rows } = await this.pool.query('SELECT COUNT(*)::int AS n FROM cases');
    if (rows[0].n > 0) return;
    for (const s of SEED_CASES) {
      await this.pool.query(
        `INSERT INTO cases (id, title, text, verdict, author, daily_date, share_count)
         VALUES ($1, $2, $3, $4, $5, NULL, $6)
         ON CONFLICT (id) DO NOTHING`,
        [slug(10), s.title, s.text, JSON.stringify(s.verdict), s.author, Math.floor(Math.random() * 30) + 4]
      );
    }
    // démarre le "cas du jour" dès l'installation
    await this.ensureDaily();
  }

  // --- helpers SQL de comptage (requête commune) ---
  async countTotals() {
    const { rows } = await this.pool.query(
      `SELECT
         v.case_id,
         COUNT(*) FILTER (WHERE v.side = 'guilty') AS guilty,
         COUNT(*) FILTER (WHERE v.side = 'innocent') AS innocent
       FROM votes v GROUP BY v.case_id`
    );
    const totals = {};
    for (const r of rows) totals[r.case_id] = { guilty: Number(r.guilty), innocent: Number(r.innocent) };
    return totals;
  }

  async createCase({ title, text, verdict, author, lang }) {
    const id = slug(10);
    const { rows } = await this.pool.query(
      `INSERT INTO cases (id, title, text, verdict, author, lang)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, title || null, text, JSON.stringify(verdict), author || 'Anonyme', lang || 'fr']
    );
    return this.toCase(rows[0]);
  }

  async getTranslation(caseId, lang) {
    const { rows } = await this.pool.query(
      'SELECT title, text, verdict FROM case_i18n WHERE case_id = $1 AND lang = $2',
      [caseId, lang]
    );
    if (!rows[0]) return null;
    return {
      title: rows[0].title || null,
      text: rows[0].text,
      verdict: typeof rows[0].verdict === 'string' ? JSON.parse(rows[0].verdict) : rows[0].verdict,
    };
  }

  async saveTranslation(caseId, lang, { title, text, verdict }) {
    await this.pool.query(
      `INSERT INTO case_i18n (case_id, lang, title, text, verdict)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (case_id, lang) DO UPDATE SET
         title = EXCLUDED.title, text = EXCLUDED.text, verdict = EXCLUDED.verdict`,
      [caseId, lang, title || null, text, JSON.stringify(verdict)]
    );
  }

  async listCases({ limit = 20, offset = 0 } = {}) {
    const { rows } = await this.pool.query(
      `SELECT c.*, COALESCE(g.g, 0) AS guilty, COALESCE(i.i, 0) AS innocent,
              COALESCE(r.cnt, 0) AS reactions_count
       FROM cases c
       LEFT JOIN (SELECT case_id, COUNT(*) AS g FROM votes WHERE side='guilty' GROUP BY case_id) g ON g.case_id = c.id
       LEFT JOIN (SELECT case_id, COUNT(*) AS i FROM votes WHERE side='innocent' GROUP BY case_id) i ON i.case_id = c.id
       LEFT JOIN (SELECT case_id, COUNT(*) AS cnt FROM reactions GROUP BY case_id) r ON r.case_id = c.id
       WHERE c.flagged = FALSE
       ORDER BY c.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows.map((r) => this.toCase(r));
  }

  async getCase(id) {
    const { rows } = await this.pool.query(
      `SELECT c.*, COALESCE(g.g, 0) AS guilty, COALESCE(i.i, 0) AS innocent,
              COALESCE(r.cnt, 0) AS reactions_count
       FROM cases c
       LEFT JOIN (SELECT case_id, COUNT(*) AS g FROM votes WHERE side='guilty' GROUP BY case_id) g ON g.case_id = c.id
       LEFT JOIN (SELECT case_id, COUNT(*) AS i FROM votes WHERE side='innocent' GROUP BY case_id) i ON i.case_id = c.id
       LEFT JOIN (SELECT case_id, COUNT(*) AS cnt FROM reactions GROUP BY case_id) r ON r.case_id = c.id
       WHERE c.id = $1`,
      [id]
    );
    return rows[0] ? this.toCase(rows[0]) : null;
  }

  async vote(caseId, voter, side) {
    const ins = await this.pool.query(
      `INSERT INTO votes (case_id, voter, side) VALUES ($1, $2, $3)
       ON CONFLICT (case_id, voter) DO NOTHING RETURNING side`,
      [caseId, voter, side]
    );
    const isNew = ins.rows.length > 0;

    // mise à jour de la série quotidienne
    const str = await this.pool.query(
      `INSERT INTO streaks (voter, last_vote, count)
       VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (voter) DO UPDATE SET
         last_vote = CASE
           WHEN streaks.last_vote = CURRENT_DATE - 1 THEN CURRENT_DATE
           WHEN streaks.last_vote = CURRENT_DATE THEN streaks.last_vote
           ELSE CURRENT_DATE
         END,
         count = CASE
           WHEN streaks.last_vote = CURRENT_DATE - 1 THEN streaks.count + 1
           WHEN streaks.last_vote = CURRENT_DATE THEN streaks.count
           ELSE 1
         END
       RETURNING count, last_vote`,
      [voter]
    );

    const totals = await this.countTotals();
    const t = totals[caseId] || { guilty: 0, innocent: 0 };
    const { votes } = await this.voterTotalVotes(voter);
    const { points, badges } = pointsAndBadges(votes, Number(str.rows[0].count));

    return {
      state: isNew ? 'voted' : 'already',
      guilty: t.guilty,
      innocent: t.innocent,
      streak: Number(str.rows[0].count),
      votes,
      points,
      badges: badges.map((b) => b.label),
    };
  }

  async voterTotalVotes(voter) {
    const { rows } = await this.pool.query(
      'SELECT COUNT(*)::int AS votes FROM votes WHERE voter = $1',
      [voter]
    );
    return { votes: rows[0].votes };
  }

  async voterStats(voter) {
    const v = await this.voterTotalVotes(voter);
    const s = await this.pool.query('SELECT last_vote, count FROM streaks WHERE voter = $1', [voter]);
    const streak = s.rows.length ? Number(s.rows[0].count) : 0;
    const { points, badges } = pointsAndBadges(v.votes, streak);
    return { votes: v.votes, streak, points, badges: badges.map((b) => b.label) };
  }

  /* Bilan des 7 derniers jours d'un votant (pour le visuel de partage). */
  async voterWeekStats(voter) {
    const { rows } = await this.pool.query(
      `SELECT side, COUNT(*)::int AS n,
              COUNT(DISTINCT created_at::date)::int AS days
       FROM votes
       WHERE voter = $1 AND created_at >= now() - interval '7 days'
       GROUP BY side`,
      [voter]
    );
    let guilty = 0, innocent = 0;
    let activeDays = 0;
    for (const r of rows) {
      if (r.side === 'guilty') guilty = r.n;
      else innocent = r.n;
      activeDays = Math.max(activeDays, r.days);
    }
    const v = await this.voterTotalVotes(voter);
    const s = await this.pool.query('SELECT count FROM streaks WHERE voter = $1', [voter]);
    const streak = s.rows.length ? Number(s.rows[0].count) : 0;
    const { badges } = pointsAndBadges(v.votes, streak);
    return {
      votes: guilty + innocent,
      guilty, innocent, activeDays,
      streak,
      badges: badges.map((b) => b.label),
      weekBadge: weekBadgeName(guilty + innocent, activeDays),
    };
  }

  async addReaction(caseId, voter, emoji, comment) {
    // emoji === undefined → commentaire seul : l'emoji déjà posé est conservé
    if (emoji === undefined) {
      await this.pool.query(
        `INSERT INTO reactions (case_id, voter, comment)
         VALUES ($1, $2, $3)
         ON CONFLICT (case_id, voter) DO UPDATE SET
           comment = COALESCE(EXCLUDED.comment, reactions.comment),
           created_at = now()`,
        [caseId, voter, comment || null]
      );
    } else {
      await this.pool.query(
        `INSERT INTO reactions (case_id, voter, emoji, comment)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (case_id, voter) DO UPDATE SET
           emoji = EXCLUDED.emoji,
           comment = COALESCE(EXCLUDED.comment, reactions.comment),
           created_at = now()`,
        [caseId, voter, emoji || null, comment || null]
      );
    }
    return this.getReactions(caseId);
  }

  async getReactions(caseId) {
    const { rows } = await this.pool.query(
      `SELECT r.emoji, r.comment, r.created_at, u.name AS user_name
         FROM reactions r
         LEFT JOIN users u ON u.voter = r.voter
        WHERE r.case_id = $1
        ORDER BY r.created_at DESC`,
      [caseId]
    );
    const counts = {};
    const comments = [];
    for (const r of rows) {
      if (r.emoji) counts[r.emoji] = (counts[r.emoji] || 0) + 1;
      if (r.comment) comments.push({ comment: r.comment, at: r.created_at, author: r.user_name || 'Anonyme' });
    }
    return { counts, comments: comments.slice(0, 30) };
  }

  async incrementShare(caseId) {
    await this.pool.query('UPDATE cases SET share_count = share_count + 1 WHERE id = $1', [caseId]);
  }

  async flag(caseId) {
    const { rows } = await this.pool.query(
      'UPDATE cases SET flagged = TRUE WHERE id = $1 RETURNING id', [caseId]);
    return rows.length > 0;
  }

  async wallStats() {
    const totals = await this.countTotals();
    const list = await this.listCases({ limit: 100 });
    return buildWall(list);
  }

  /* Top contributedeurs (votants) des 7 derniers jours. */
  async contributors() {
    const { rows } = await this.pool.query(
      `SELECT voter, COUNT(*)::int AS votes
       FROM votes
       WHERE created_at >= now() - interval '7 days'
       GROUP BY voter
       ORDER BY votes DESC
       LIMIT 5`
    );
    return rows;
  }

  async daily() {
    const today = dateStr(new Date());
    const { rows } = await this.pool.query(
      `SELECT c.*,
              COALESCE(g.g, 0) AS guilty, COALESCE(i.i, 0) AS innocent,
              COALESCE(r.cnt, 0) AS reactions_count
       FROM cases c
       LEFT JOIN (SELECT case_id, COUNT(*) AS g FROM votes WHERE side='guilty' GROUP BY case_id) g ON g.case_id = c.id
       LEFT JOIN (SELECT case_id, COUNT(*) AS i FROM votes WHERE side='innocent' GROUP BY case_id) i ON i.case_id = c.id
       LEFT JOIN (SELECT case_id, COUNT(*) AS cnt FROM reactions GROUP BY case_id) r ON r.case_id = c.id
       WHERE c.daily_date = $1 AND c.flagged = FALSE
       LIMIT 1`,
      [today]
    );
    return rows[0] ? this.toCase(rows[0]) : null;
  }

  async topByScore(except = null) {
    const { rows } = await this.pool.query(
      `SELECT c.id, COALESCE(v.v, 0) AS total
       FROM cases c
       LEFT JOIN (SELECT case_id, COUNT(*) AS v FROM votes GROUP BY case_id) v ON v.case_id = c.id
       WHERE c.flagged = FALSE AND ($1::text IS NULL OR c.id <> $1)
       ORDER BY v.v DESC NULLS LAST, c.created_at ASC
       LIMIT 1`,
      [except]
    );
    return rows[0] ? rows[0].id : null;
  }

  async hasDaily(day) {
    const has = await this.pool.query('SELECT 1 FROM cases WHERE daily_date = $1 LIMIT 1', [day]);
    return has.rows.length > 0;
  }

  async setDaily(day, id) {
    await this.pool.query('UPDATE cases SET daily_date = $1 WHERE id = $2', [day, id])
      .catch(() => {}); // conflit éventuel → on ignore
  }

  async ensureDaily() {
    const today = dateStr(new Date());
    const tomorrow = dateStr(addDays(new Date(), 1));
    const usedToday = await this.assignDaily(today, null);
    await this.assignDaily(tomorrow, usedToday);
  }

  async assignDaily(day, except) {
    if (await this.hasDaily(day)) return null;
    const top = await this.topByScore(except);
    if (!top) return null;
    await this.setDaily(day, top);
    return top;
  }

  async adminFlagged() {
    const { rows } = await this.pool.query(
      'SELECT id, title, text, author, created_at FROM cases WHERE flagged = TRUE ORDER BY created_at DESC'
    );
    return rows;
  }

  async adminDelete(id) {
    const { rows } = await this.pool.query('DELETE FROM cases WHERE id = $1 RETURNING id', [id]);
    return rows.length > 0;
  }

  /* -----------------------------------------------------------------
     COMPTES — recherche / création / fusion d'identité
  ----------------------------------------------------------------- */
  toUser(r) {
    if (!r) return null;
    return {
      id: r.id, provider: r.provider, name: r.name,
      avatar: r.avatar || null, email: r.email || null, voter: r.voter,
      created_at: r.created_at, last_login: r.last_login,
    };
  }

  async findUserByProvider(provider, providerId) {
    const { rows } = await this.pool.query(
      'SELECT * FROM users WHERE provider = $1 AND provider_id = $2',
      [provider, providerId]
    );
    return this.toUser(rows[0]);
  }

  async findUserById(id) {
    const { rows } = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return this.toUser(rows[0]);
  }

  async findUserByVoter(voter) {
    const { rows } = await this.pool.query('SELECT * FROM users WHERE voter = $1', [voter]);
    return this.toUser(rows[0]);
  }

  async createUser({ provider, providerId, name, avatar, email, voter }) {
    // le voter revendiqué n'est adopté que s'il n'appartient déjà à aucun compte
    let v = voter || null;
    if (v && await this.findUserByVoter(v)) v = null;
    for (let i = 0; !v && i < 6; i++) {
      const cand = 'usr_' + slug(12);
      if (!await this.findUserByVoter(cand)) v = cand;
    }
    const id = 'usr_' + slug(12);
    const { rows } = await this.pool.query(
      `INSERT INTO users (id, provider, provider_id, name, avatar, email, voter)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (provider, provider_id) DO UPDATE SET
         name = EXCLUDED.name, avatar = EXCLUDED.avatar, last_login = now()
       RETURNING *`,
      [id, provider, providerId, name || 'Justicier', avatar || null, email || null, v]
    );
    return this.toUser(rows[0]);
  }

  async touchLogin(id, { name, avatar }) {
    const { rows } = await this.pool.query(
      `UPDATE users SET last_login = now(),
         name = COALESCE($2, name), avatar = COALESCE($3, avatar)
       WHERE id = $1 RETURNING *`,
      [id, name || null, avatar || null]
    );
    return this.toUser(rows[0]);
  }

  /* Transfère votes/réactions/série d'un votant anonyme vers un compte. */
  async mergeVoters(from, to) {
    if (!from || !to || from === to) return;
    await this.pool.query(
      `UPDATE votes v SET voter = $2
         WHERE voter = $1
           AND NOT EXISTS (SELECT 1 FROM votes x WHERE x.case_id = v.case_id AND x.voter = $2)`,
      [from, to]
    );
    await this.pool.query('DELETE FROM votes WHERE voter = $1', [from]);
    await this.pool.query(
      `UPDATE reactions r SET voter = $2
         WHERE voter = $1
           AND NOT EXISTS (SELECT 1 FROM reactions x WHERE x.case_id = r.case_id AND x.voter = $2)`,
      [from, to]
    );
    await this.pool.query('DELETE FROM reactions WHERE voter = $1', [from]);
    await this.pool.query(
      `INSERT INTO streaks (voter, last_vote, count)
       SELECT $2, last_vote, count FROM streaks WHERE voter = $1
       ON CONFLICT (voter) DO UPDATE SET
         last_vote = GREATEST(streaks.last_vote, EXCLUDED.last_vote),
         count     = GREATEST(streaks.count, EXCLUDED.count)`,
      [from, to]
    ).catch(() => {});
    await this.pool.query('DELETE FROM streaks WHERE voter = $1', [from]).catch(() => {});
  }

  getMode() { return 'postgres'; }

  toCase(r) {
    return {
      id: r.id,
      title: r.title || null,
      text: r.text,
      verdict: typeof r.verdict === 'string' ? JSON.parse(r.verdict) : r.verdict,
      author: r.author,
      lang: r.lang || 'fr',
      daily_date: r.daily_date ? dateStr(new Date(r.daily_date)) : null,
      share_count: Number(r.share_count || 0),
      guilty: Number(r.guilty || 0),
      innocent: Number(r.innocent || 0),
      reactions_count: Number(r.reactions_count || 0),
      created_at: r.created_at,
    };
  }
}

/* =====================================================================
   STORE MÉMOIRE (fallback sans base de données)
===================================================================== */
class MemoryStore {
  constructor() {
    this.cases = new Map();
    this.votes = new Map();      // caseId -> Map(voter -> side)
    this.voteLog = new Map();    // caseId -> Map(voter -> { side, at })
    this.reactions = new Map();  // caseId -> Map(voter -> {emoji, comment, at})
    this.streaks = new Map();    // voter -> {last_vote, count}
    this.users = new Map();      // id -> user
    this.i18n = new Map();       // `caseId|lang` -> {title, text, verdict}
    this.seq = 1;
  }

  async init() {
    for (const s of SEED_CASES) {
      const id = slug(10);
      this.cases.set(id, {
        id, title: s.title, text: s.text,
        verdict: s.verdict, author: s.author, lang: 'fr',
        daily_date: null,
        share_count: Math.floor(Math.random() * 30) + 4,
        flagged: false,
        created_at: new Date(),
      });
    }
    await this.ensureDaily();
    return this;
  }

  async createCase({ title, text, verdict, author, lang }) {
    const id = slug(10);
    this.cases.set(id, {
      id, title: title || null, text, verdict,
      author: author || 'Anonyme', lang: lang || 'fr', daily_date: null,
      share_count: 0, flagged: false, created_at: new Date(),
    });
    return this.getCase(id);
  }

  async getTranslation(caseId, lang) {
    const t = this.i18n.get(caseId + '|' + lang);
    return t ? { title: t.title, text: t.text, verdict: t.verdict } : null;
  }

  async saveTranslation(caseId, lang, { title, text, verdict }) {
    this.i18n.set(caseId + '|' + lang, { title: title || null, text, verdict });
  }

  async listCases({ limit = 20, offset = 0 } = {}) {
    const list = [...this.cases.values()]
      .filter((c) => !c.flagged)
      .sort((a, b) => b.created_at - a.created_at)
      .slice(offset, offset + limit);
    return list.map((c) => this.toCase(c));
  }

  async getCase(id) {
    const c = this.cases.get(id);
    return c ? this.toCase(c) : null;
  }

  async vote(caseId, voter, side) {
    const vm = this.votes.get(caseId) || new Map();
    const isNew = !vm.has(voter);
    if (isNew) {
      vm.set(voter, side);
      this.votes.set(caseId, vm);
      const log = this.voteLog.get(caseId) || new Map();
      log.set(voter, { side, at: new Date() });
      this.voteLog.set(caseId, log);
    }

    // série quotidienne
    const today = dateStr(new Date());
    const s = this.streaks.get(voter) || {};
    const newCount = nextStreak(s.last_vote, s.count || 0);
    const streak = { last_vote: today, count: newCount };
    this.streaks.set(voter, streak);

    const { guilty, innocent } = this.totals(caseId);
    const { votes } = await this.voterStats(voter);
    const { points, badges } = pointsAndBadges(votes, newCount);
    return {
      state: isNew ? 'voted' : 'already',
      guilty, innocent,
      streak: newCount, votes,
      points, badges: badges.map((b) => b.label),
    };
  }

  async voterStats(voter) {
    let votes = 0;
    for (const vm of this.votes.values()) if (vm.has(voter)) votes += 1;
    const s = this.streaks.get(voter);
    const streak = s ? s.count : 0;
    const { points, badges } = pointsAndBadges(votes, streak);
    return { votes, streak, points, badges: badges.map((b) => b.label) };
  }

  /* Bilan des 7 derniers jours d'un votant (pour le visuel de partage). */
  async voterWeekStats(voter) {
    const cutoff = Date.now() - 7 * 86400000;
    let guilty = 0, innocent = 0;
    const days = new Set();
    for (const log of this.voteLog.values()) {
      const entry = log.get(voter);
      if (!entry) continue;
      const at = entry.at.getTime();
      if (at < cutoff) continue;
      if (entry.side === 'guilty') guilty += 1;
      else innocent += 1;
      days.add(dateStr(entry.at));
    }
    const votes = guilty + innocent;
    const s = this.streaks.get(voter);
    const streak = s ? s.count : 0;
    const total = await this.voterStats(voter);
    return {
      votes, guilty, innocent,
      activeDays: days.size,
      streak,
      badges: total.badges,
      weekBadge: weekBadgeName(votes, days.size),
    };
  }

  async addReaction(caseId, voter, emoji, comment) {
    const rm = this.reactions.get(caseId) || new Map();
    const old = rm.get(voter) || {};
    rm.set(voter, {
      // emoji undefined → commentaire seul, l'emoji existant est conservé ;
      // emoji null explicite → efface l'emoji (désélection)
      emoji: emoji === undefined ? (old.emoji || null) : emoji,
      comment: comment || old.comment || null,
      at: new Date(),
    });
    this.reactions.set(caseId, rm);
    return this.getReactions(caseId);
  }

  async getReactions(caseId) {
    const rm = this.reactions.get(caseId) || new Map();
    // voter → nom du compte lié (sinon « Anonyme »)
    const names = new Map();
    for (const u of this.users.values()) if (u.voter) names.set(u.voter, u.name);
    const counts = {};
    const comments = [];
    for (const [voter, r] of rm.entries()) {
      if (r.emoji) counts[r.emoji] = (counts[r.emoji] || 0) + 1;
      if (r.comment) comments.push({ comment: r.comment, at: r.at, author: names.get(voter) || 'Anonyme' });
    }
    return { counts, comments: comments.slice(0, 30) };
  }

  async incrementShare(caseId) {
    const c = this.cases.get(caseId);
    if (c) c.share_count += 1;
  }

  async flag(caseId) {
    const c = this.cases.get(caseId);
    if (!c) return false;
    c.flagged = true;
    return true;
  }

  async wallStats() {
    const list = [...this.cases.values()].filter((c) => !c.flagged);
    return buildWall(list);
  }

  async contributors() {
    const counts = new Map();
    for (const vm of this.votes.values()) {
      for (const voter of vm.keys()) counts.set(voter, (counts.get(voter) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([voter, votes]) => ({ voter, votes }))
      .sort((a, b) => b.votes - a.votes)
      .slice(0, 5);
  }

  async daily() {
    const today = dateStr(new Date());
    const found = [...this.cases.values()].find(
      (c) => c.daily_date === today && !c.flagged
    );
    return found ? this.toCase(found) : null;
  }

  async topByScore(except = null) {
    const list = [...this.cases.values()].filter((c) => !c.flagged && c.id !== except);
    let best = null;
    let bestV = -1;
    for (const c of list) {
      const { total } = cScore(c, this.votes.get(c.id));
      if (total > bestV) { bestV = total; best = c.id; }
    }
    return best;
  }

  hasDaily(day) {
    return [...this.cases.values()].some((c) => c.daily_date === day);
  }

  setDaily(day, id) {
    const c = this.cases.get(id);
    if (c) c.daily_date = day;
  }

  async ensureDaily() {
    const today = dateStr(new Date());
    const tomorrow = dateStr(addDays(new Date(), 1));
    const usedToday = await this.assignDaily(today, null);
    await this.assignDaily(tomorrow, usedToday);
  }

  async assignDaily(day, except) {
    if (this.hasDaily(day)) return null;
    const top = await this.topByScore(except);
    if (!top) return null;
    this.setDaily(day, top);
    return top;
  }

  async adminFlagged() {
    return [...this.cases.values()]
      .filter((c) => c.flagged)
      .map((c) => ({ id: c.id, title: c.title, text: c.text, author: c.author, created_at: c.created_at }));
  }

  async adminDelete(id) {
    this.votes.delete(id);
    this.reactions.delete(id);
    for (const k of [...this.i18n.keys()]) {
      if (k.startsWith(id + '|')) this.i18n.delete(k);
    }
    return this.cases.delete(id);
  }

  /* -----------------------------------------------------------------
     COMPTES — recherche / création / fusion d'identité
  ----------------------------------------------------------------- */
  async findUserByProvider(provider, providerId) {
    for (const u of this.users.values()) {
      if (u.provider === provider && u.provider_id === providerId) return { ...u };
    }
    return null;
  }

  async findUserById(id) {
    const u = this.users.get(id);
    return u ? { ...u } : null;
  }

  async findUserByVoter(voter) {
    for (const u of this.users.values()) {
      if (u.voter === voter) return { ...u };
    }
    return null;
  }

  async createUser({ provider, providerId, name, avatar, email, voter }) {
    const existing = await this.findUserByProvider(provider, providerId);
    if (existing) return this.touchLogin(existing.id, { name, avatar });

    let v = voter || null;
    if (v && await this.findUserByVoter(v)) v = null;
    for (let i = 0; !v && i < 6; i++) {
      const cand = 'usr_' + slug(12);
      if (!await this.findUserByVoter(cand)) v = cand;
    }
    const now = new Date();
    const user = {
      id: 'usr_' + slug(12),
      provider, provider_id: providerId,
      name: name || 'Justicier', avatar: avatar || null, email: email || null,
      voter: v, created_at: now, last_login: now,
    };
    this.users.set(user.id, user);
    return { ...user };
  }

  async touchLogin(id, { name, avatar } = {}) {
    const u = this.users.get(id);
    if (!u) return null;
    u.last_login = new Date();
    if (name) u.name = name;
    if (avatar) u.avatar = avatar;
    return { ...u };
  }

  async mergeVoters(from, to) {
    if (!from || !to || from === to) return;
    for (const map of [this.votes, this.voteLog, this.reactions]) {
      for (const vm of map.values()) {
        if (!vm.has(from)) continue;
        if (!vm.has(to)) vm.set(to, vm.get(from));
        vm.delete(from);
      }
    }
    const s = this.streaks.get(from);
    if (s) {
      const t = this.streaks.get(to) || { count: 0 };
      t.count = Math.max(t.count || 0, s.count || 0);
      t.last_vote = (t.last_vote && s.last_vote && t.last_vote > s.last_vote) ? t.last_vote : (s.last_vote || t.last_vote);
      this.streaks.set(to, t);
      this.streaks.delete(from);
    }
  }

  getMode() { return 'memory'; }

  totals(caseId) {
    const vm = this.votes.get(caseId) || new Map();
    let guilty = 0, innocent = 0;
    for (const side of vm.values()) {
      if (side === 'guilty') guilty += 1;
      else innocent += 1;
    }
    return { guilty, innocent };
  }

  toCase(c) {
    const { guilty, innocent } = this.totals(c.id);
    const reactionsCount = (this.reactions.get(c.id) || new Map()).size;
    return {
      id: c.id, title: c.title, text: c.text, verdict: c.verdict,
      author: c.author, lang: c.lang || 'fr', daily_date: c.daily_date,
      share_count: c.share_count,
      guilty, innocent,
      reactions_count: reactionsCount,
      created_at: c.created_at,
    };
  }
}

function cScore(c, vm) {
  vm = vm || new Map();
  let guilty = 0, innocent = 0;
  for (const side of vm.values()) { if (side === 'guilty') guilty += 1; else innocent += 1; }
  return { guilty, innocent, total: guilty + innocent };
}

/* Rang de la semaine d'un justicier (pour le visuel de partage). */
function weekBadgeName(votes, days) {
  if (days >= 6) return '⚡ Inarrêtable';
  if (votes >= 20) return '🧑‍⚖️ Bourreau';
  if (days >= 3) return '🔥 Enchaîné';
  if (votes >= 5) return '⚖️ Greffier';
  return votes > 0 ? '🗡️ Recrue du prétoire' : 'Nouveau greffé';
}

/* Construit le palmarès (cas jugés + mauvaises foi + contributeurs). */
function buildWall(list) {
  const scored = list.map((c) => ({ c, ...cScore(c) }));

  const top = scored
    .slice()
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)
    .map((s) => ({ id: s.c.id, text: s.c.text, guilty: s.guilty, innocent: s.innocent }));

  const shame = scored
    .filter((s) => s.total >= 8)
    .sort((a, b) => b.guilty / b.total - a.guilty / a.total)
    .slice(0, 5)
    .map((s) => ({ id: s.c.id, text: s.c.text, guilty: s.guilty, innocent: s.innocent }));

  return { top, shame };
}

/* ---------------------------------------------------------------------
   FABRIQUE : choisit le store selon la configuration
--------------------------------------------------------------------- */
function createStore() {
  const url = process.env.DATABASE_URL;
  return url ? new PostgresStore(url) : new MemoryStore();
}

module.exports = { createStore, PostgresStore, MemoryStore, pointsAndBadges, dateStr };