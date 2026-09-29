'use strict';

/* =====================================================================
   THE LAST VIBE — Serveur (Express + PostgreSQL)
   ---------------------------------------------------------------------
   Routes :
     • API            /api/bootstrap, /api/cases, /api/votes, /api/me,
                      /api/stats/wall, réactions, partage, signalement
• Temps réel     /events (Server-Sent Events → votes en direct)
     • Partage        /c/:id, /w/:voter (pages sociales + og:image) et
                      /og/:id.png, /og/week/:voter.png
     • Admin protégé  /api/admin/* (login par mot de passe + jeton)
   ---------------------------------------------------------------------
   Configuration :
     DATABASE_URL     chaîne PostgreSQL (Supabase/Neon/Replit…) ;
                       sans elle, un store mémoire est utilisé (fallback).
     PORT             port d'écoute (défaut 3000).
     ADMIN_PASSWORD   mot de passe de modération (défaut de démo).
===================================================================== */

process.env.TZ = 'Europe/Paris';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { createStore } = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const store = createStore();

/* ---------------------------------------------------------------------
   GÉNÉRATION DES VERDICTS (simulation "Juge IA")
   Templates cyniques/théâtraux + intégration du texte de l'utilisateur.
--------------------------------------------------------------------- */
const AI_OPENERS = [
  'Après mûre et très longue réflexion…',
  'Le Juge Suprême a été tiré de sa sieste pour ça. Vous m’en direz tant…',
  'Le greffier a lu le dossier en diagonale, la dignité est sauve.',
  'Session extraordinaire ouverte. L’audience retient son souffle (et son téléphone).',
  'Le tribunal, émerveillé par tant d’audace, consent enfin à trancher.',
];

const AI_GEARS = [
  'L’acte, soigneusement aligné au feuilleton des fautes ordinales, relève du ',
  'On a tout relu, recoupé avec la jurisprudence des lieux communs : c’est du ',
  'Le flair du greffier désigne sans hésiter un ',
  'Classé, non sans humour, dans la catégorie des ',
  'Le dossier sent le vécu. Le tribunal le range dans le casier du ',
];

const AI_CRIMES = [
  'trouble à l’ordre établi par soi-même',
  'vol avec effraction du bon sens',
  'atteinte à la sincérité numérique',
  'pacte germinatif avec le couvercle du frigo',
  'hérésie relationnelle mineure',
  'complicité de maladresse organisée',
  'ignominie administrative avec préméditation',
  'outrage à la logique commune',
  'délit de fuite devant les responsabilités',
  'faute lourde contre le collectif',
];

const AI_SENTENCES = [
  'Condamné à dire « vous me pardonnez ? » chaque matin face au miroir, avec intonation lyrique, pendant 10 jours.',
  'Prison… conceptuelle. La cellule : un groupe WhatsApp plein, dont l’intéressé devient administrateur.',
  '100 € d’amende sociale, réglables en compliments gratuits adressés à un inconnu chaque jour.',
  'Interdiction d’ouvrir le réfrigérateur collectif pendant une semaine. Ration : eau claire et bons sentiments.',
  'Peine : rédiger des excuses DÉTAILLÉES (plus de 60 caractères, avec ponctuation, sans « lol »).',
  'Deux dimanches de visite obligatoire chez la personne ignorée. Bisous compris, émotion non garantie.',
  'Le tribunal exige une vidéo muette de 15 s, mime théâtral d’excuses, hashtag #jessaiemeux.',
  'Travaux d’intérêt communautaire : tenir la porte d’entrée du bureau 3 jours, avec un sourire crédible.',
  'Confiscation du privilège de « dernière part du frigo » à vie. Les parts reviendront au peuple.',
  'Exil doux dans la cave à buanderies pendant 48 h, avec pour seul divertissement le bruit de la machine.',
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const abbreviate = (t, n) => (t.length > n ? t.slice(0, n - 1).trim() + '…' : t);

function generateVerdict(text) {
  const short = abbreviate(text, 90);
  const comment =
    pick(AI_OPENERS) + ' ' +
    '« ' + short + ' ». ' +
    'Soumis à la sagesse souveraine du Tribunal, l’affaire mérite la gravure : ' +
    pick(AI_GEARS) + pick(AI_CRIMES) + '. ' +
    'Le juge signe, le greffier applaudit, personne ne comprend la procédure.';
  return {
    comment,
    crime: pick(AI_CRIMES),
    sentence: pick(AI_SENTENCES),
  };
}

/* Génère un titre éditorial accrocheur à partir du texte du cas. */
function generateTitle(text) {
  const clean = text.replace(/\s+/g, ' ').trim().replace(/^["«“]+|["»”]+$/g, '');
  const words = clean.split(' ');
  const head = words.slice(0, 7).join(' ');
  return 'L’affaire du ' + abbreviate(head, 52).toLowerCase().replace(/[.!?]+$/, '');
}

/* ---------------------------------------------------------------------
   MIDDLEWARES : CORS, headers, identité du votant
--------------------------------------------------------------------- */
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Voter-Id, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '50kb' }));
app.set('trust proxy', 1);

/* ---------------------------------------------------------------------
   COMPTES — sessions signées (cookie httpOnly) + OAuth
   ---------------------------------------------------------------------
   Les sessions sont un HMAC-SHA256 sur un payload {uid, exp} :
   aucun état côté serveur, valide le temps de SESSION_SECRET.
   L'identité du jeu ("voter") est portée par le compte quand il y en a
   un, sinon par le header X-Voter-Id du client (anonyme).
--------------------------------------------------------------------- */
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('   ⚠️ SESSION_SECRET non défini → sessions invalidées à chaque redémarrage. Définissez-le en prod.');
}
const SESSION_TTL = 30 * 24 * 3600000;   // 30 jours

const isHttps = (req) => req.secure || (process.env.PUBLIC_URL || '').startsWith('https://');
const baseUrl = (req) =>
  (process.env.PUBLIC_URL || '').replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`;

function signPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `v1.${body}.${mac}`;
}
function verifySigned(token) {
  try {
    const [v, body, mac] = String(token).split('.');
    if (v !== 'v1' || !body || !mac) return null;
    const expect = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    const a = Buffer.from(mac), b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch (_) { return null; }
}
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setSessionCookie(req, res, uid) {
  res.cookie('tlv_session', signPayload({ uid, exp: Date.now() + SESSION_TTL }), {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_TTL, secure: isHttps(req),
  });
}
function clearSessionCookie(req, res) {
  res.clearCookie('tlv_session', { path: '/', httpOnly: true, sameSite: 'lax', secure: isHttps(req) });
}

/* Charge le compte attaché à la session (aucun cookie → rien à charger). */
app.use(async (req, res, next) => {
  try {
    const tok = parseCookies(req).tlv_session;
    if (tok) {
      const p = verifySigned(tok);
      if (p && p.uid) req.tlvUser = await store.findUserById(p.uid);
    }
  } catch (_) { /* session illisible → visiteur anonyme */ }
  next();
});

/* Identité du votant : le compte connecté prime, sinon le voter anonyme. */
const voterId = (req) =>
  (req.tlvUser && req.tlvUser.voter) || req.headers['x-voter-id'] || 'anon-' + (req.ip || 'inconnu');
const publicUser = (u) => u ? ({ name: u.name, avatar: u.avatar, provider: u.provider, voter: u.voter }) : null;

/* Fournisseurs OAuth configurables via variables d'environnement. */
const OAUTH_PROVIDERS = {
  github: {
    label: 'GitHub', icon: '🐙',
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    userinfo: 'https://api.github.com/user',
    scope: 'read:user',
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    map: (g) => ({ providerId: String(g.id), name: g.name || g.login || 'Justicier', avatar: g.avatar_url || null, email: g.email || null }),
    headers: { 'User-Agent': 'The-Last-Vibe' },
  },
  discord: {
    label: 'Discord', icon: '💬',
    authorize: 'https://discord.com/api/oauth2/authorize',
    token: 'https://discord.com/api/oauth2/token',
    userinfo: 'https://discord.com/api/users/@me',
    scope: 'identify',
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    map: (d) => ({
      providerId: String(d.id),
      name: d.global_name || d.username || 'Justicier',
      avatar: d.avatar ? `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png?size=128` : null,
      email: d.email || null,
    }),
  },
  google: {
    label: 'Google', icon: '🔷',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    map: (g) => ({ providerId: String(g.sub), name: g.name || g.given_name || g.email || 'Justicier', avatar: g.picture || null, email: g.email || null }),
    extra: { prompt: 'select_account' },
  },
};
const DEV_LOGIN = process.env.DEV_LOGIN === '1';
const providerReady = (p) => !!(p.clientId && p.clientSecret);
const readyProviders = () =>
  Object.entries(OAUTH_PROVIDERS).filter(([, p]) => providerReady(p)).map(([id, p]) => ({ id, label: p.label, icon: p.icon }));

if (readyProviders().length === 0 && !DEV_LOGIN) {
  console.warn('   ⚠️ Aucun fournisseur OAuth configuré (GITHUB_/DISCORD_/GOOGLE_CLIENT_ID+SECRET). Connexion désactivée.');
}
if (DEV_LOGIN) console.warn('   🧪 DEV_LOGIN=1 → connexion de test disponible sur /api/auth/dev');

app.get('/api/auth/providers', (_req, res) => {
  res.json({ providers: readyProviders(), dev: DEV_LOGIN });
});

/* Étape 1 : redirection vers le fournisseur (state signé en cookie). */
app.get('/api/auth/:provider', (req, res) => {
  const provider = req.params.provider;
  if (provider === 'dev') return devLogin(req, res);
  const p = OAUTH_PROVIDERS[provider];
  if (!p || !providerReady(p)) return res.status(404).send('Fournisseur indisponible.');

  const state = crypto.randomBytes(18).toString('hex');
  const anonVoter = String(req.query.voter || '').slice(0, 64);
  res.cookie('tlv_oauth', signPayload({ s: state, p: provider, v: anonVoter, exp: Date.now() + 600000 }), {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600000, secure: isHttps(req),
  });
  const params = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: `${baseUrl(req)}/api/auth/${provider}/callback`,
    response_type: 'code',
    scope: p.scope,
    state,
    ...(p.extra || {}),
  });
  res.redirect(p.authorize + '?' + params.toString());
});

/* Étape 2 : retour du fournisateur → profil → compte → session. */
app.get('/api/auth/:provider/callback', async (req, res) => {
  const provider = req.params.provider;
  const p = OAUTH_PROVIDERS[provider];
  const fail = (msg) => res.redirect('/?auth_error=' + encodeURIComponent(msg));
  if (!p || !providerReady(p)) return fail('Fournisseur indisponible.');

  try {
    const st = verifySigned(parseCookies(req).tlv_oauth || '');
    res.clearCookie('tlv_oauth', { path: '/', httpOnly: true, sameSite: 'lax' });
    if (!st || st.s !== String(req.query.state || '') || st.p !== provider) {
      return fail('Session expirée, réessayez.');
    }
    if (req.query.error) return fail(String(req.query.error_description || req.query.error));
    const code = String(req.query.code || '');
    if (!code) return fail('Code manquant.');

    const redirectUri = `${baseUrl(req)}/api/auth/${provider}/callback`;
    const body = new URLSearchParams({
      client_id: p.clientId, client_secret: p.clientSecret, code,
      redirect_uri: redirectUri,
    });
    if (provider !== 'github') body.set('grant_type', 'authorization_code');
    const tr = await fetch(p.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });
    const tj = await tr.json().catch(() => ({}));
    if (!tj.access_token) {
      return fail('Échange de jeton refusé (' + (tj.error_description || tj.error || tr.status) + ')');
    }

    const ur = await fetch(p.userinfo, {
      headers: { Authorization: `Bearer ${tj.access_token}`, Accept: 'application/json', ...(p.headers || {}) },
    });
    if (!ur.ok) return fail('Profil injoignable (' + ur.status + ')');
    const info = p.map(await ur.json());
    if (!info || !info.providerId) return fail('Profil incomplet.');

    let user = await store.findUserByProvider(provider, info.providerId);
    const claimed = st.v || null;
    if (!user) {
      // première connexion : le voter anonyme devient celui du compte
      user = await store.createUser({
        provider, providerId: info.providerId,
        name: info.name, avatar: info.avatar, email: info.email, voter: claimed,
      });
    } else {
      user = (await store.touchLogin(user.id, { name: info.name, avatar: info.avatar })) || user;
      // connexion depuis un autre appareil : on transfère les stats locales
      if (claimed && claimed !== user.voter && !(await store.findUserByVoter(claimed))) {
        await store.mergeVoters(claimed, user.voter);
      }
    }
    setSessionCookie(req, res, user.id);
    res.redirect('/?bienvenue=' + encodeURIComponent(user.name));
  } catch (err) {
    console.error('OAuth callback:', err.message);
    return fail('Erreur serveur pendant la connexion.');
  }
});

/* Connexion de test (DEV_LOGIN=1 uniquement) — même cycle que l'OAuth. */
function devLogin(req, res) {
  if (!DEV_LOGIN) return res.status(404).send('Connexion de test désactivée.');
  const name = String(req.query.name || 'Joueur de test').slice(0, 40) || 'Joueur de test';
  const claimed = String(req.query.voter || '').slice(0, 64) || null;
  (async () => {
    const providerId = name.toLowerCase();
    let user = await store.findUserByProvider('dev', providerId);
    if (!user) {
      user = await store.createUser({ provider: 'dev', providerId, name, avatar: null, email: null, voter: claimed });
    } else {
      user = (await store.touchLogin(user.id, {})) || user;
      if (claimed && claimed !== user.voter && !(await store.findUserByVoter(claimed))) {
        await store.mergeVoters(claimed, user.voter);
      }
    }
    setSessionCookie(req, res, user.id);
    res.redirect('/?bienvenue=' + encodeURIComponent(user.name));
  })().catch((err) => {
    console.error('Dev login:', err.message);
    res.redirect('/?auth_error=' + encodeURIComponent('Erreur serveur'));
  });
}

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

/* ---------------------------------------------------------------------
   ADMIN — authentification par mot de passe + jeton signé
--------------------------------------------------------------------- */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'thelastvibe';
if (!process.env.ADMIN_PASSWORD) {
  console.warn('   ⚠️ ADMIN_PASSWORD non défini → accès démo "/thelastvibe". Définissez-le en prod.')
}
const adminTokens = new Map(); // token -> expiration (ms)
const ADMIN_TTL = 12 * 3600000;

function issueAdminToken() {
  const token = crypto.randomBytes(24).toString('hex');
  adminTokens.set(token, Date.now() + ADMIN_TTL);
  return token;
}
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const exp = adminTokens.get(token);
  if (!exp || exp < Date.now()) {
    if (exp) adminTokens.delete(token);
    return res.status(401).json({ error: 'Accès refusé. Connectez-vous en tant que greffier en chef.' });
  }
  next();
}

app.post('/api/admin/login', (req, res) => {
  const pass = String(req.body && req.body.password || '');
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Mot de passe invalide.' });
  res.json({ token: issueAdminToken(), expiresIn: ADMIN_TTL });
});

/* Anti-spam : soumission de cas limitée (1 / 45 s, max 20 / jour par IP). */
const spamLog = new Map();
function rateLimitCase(req) {
  const key = req.ip || 'local';
  const now = Date.now();
  const arr = (spamLog.get(key) || []).filter((t) => now - t < 86400000);
  spamLog.set(key, arr);
  if (arr.length >= 20) return 'Journée bien remplie : limite de 20 dépôts atteinte. Le Juge se repose.';
  if (arr.some((t) => now - t < 45000)) return 'Un peu d’émoi, du calme ! Patientez 45 s avant un nouveau dépôt.';
  arr.push(now);
  return null;
}

/* ---------------------------------------------------------------------
   TEMPS RÉEL — flux SSE (votes, nouveaux cas)
--------------------------------------------------------------------- */
const sseClients = new Set();
function broadcast(obj) {
  const payload = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of sseClients) res.write(payload);
}
setInterval(() => {
  for (const res of sseClients) res.write(': ping\n\n');
}, 25000);

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

/* ---------------------------------------------------------------------
   STATIQUES (front + PWA)
--------------------------------------------------------------------- */
const PUBLIC = path.join(__dirname, 'public');
app.use(express.static(PUBLIC, { maxAge: '1h' }));

/* ---------------------------------------------------------------------
   API — DONNÉES
--------------------------------------------------------------------- */
app.get('/api/bootstrap', async (req, res) => {
  try {
    const [cases, daily] = await Promise.all([
      store.listCases({ limit: 30, offset: 0 }),
      store.daily(),
    ]);
    res.json({
      mode: store.getMode(), cases, daily, serverNow: Date.now(),
      auth: { providers: readyProviders(), dev: DEV_LOGIN, user: publicUser(req.tlvUser) },
    });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message) });
  }
});

app.get('/api/cases', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const offset = Number(req.query.offset) || 0;
  try {
    res.json({ cases: await store.listCases({ limit, offset }) });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message) });
  }
});

app.get('/api/cases/:id', async (req, res) => {
  try {
    const c = await store.getCase(req.params.id);
    if (!c) return res.status(404).json({ error: 'Cas introuvable' });
    const reactions = await store.getReactions(c.id);
    res.json({ case: c, reactions });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message) });
  }
});

/* Soumission d'un cas + verdict simulé immédiatement. */
app.post('/api/cases', async (req, res) => {
  const blocked = rateLimitCase(req);
  if (blocked) return res.status(429).json({ error: blocked });

  const text = String(req.body && req.body.text || '').trim();
  if (text.length < 12 || text.length > 280) {
    return res.status(400).json({ error: 'Votre crime doit faire entre 12 et 280 caractères.' });
  }
  if (/[<>{}]/.test(text)) {
    return res.status(400).json({ error: 'Interdit d’invoquer le HTML devant le Tribunal.' });
  }

  try {
    const c = await store.createCase({
      title: generateTitle(text),
      text,
      verdict: generateVerdict(text),
      author: 'Anonyme #' + Math.floor(Math.random() * 900 + 100),
    });
    broadcast({ type: 'newcase', id: c.id });
    res.status(201).json({ case: c });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message) });
  }
});

/* ---------------------------------------------------------------------
   API — VOTES (mise à jour en direct)
--------------------------------------------------------------------- */
app.post('/api/votes', async (req, res) => {
  const { caseId, side } = req.body || {};
  if (!caseId || !['guilty', 'innocent'].includes(side)) {
    return res.status(400).json({ error: 'Vote invalide.' });
  }
  try {
    const exists = await store.getCase(caseId);
    if (!exists) return res.status(404).json({ error: 'Cas introuvable' });

    const result = await store.vote(caseId, voterId(req), side);
    // diffusion en temps réel aux autres visiteurs
    broadcast({ type: 'votes', caseId, guilty: result.guilty, innocent: result.innocent });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message) });
  }
});

/* ---------------------------------------------------------------------
   API — PROFIL "JUSTICIER" (streak, points, badges)
--------------------------------------------------------------------- */
app.get('/api/me', async (req, res) => {
  try {
    res.json({ voter: voterId(req), user: publicUser(req.tlvUser), ...await store.voterStats(voterId(req)) });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message) });
  }
});

/* Semaine du justicier : bilan des 7 derniers jours pour un votant. */
app.get('/api/week', async (req, res) => {
  try {
    res.json({ voter: voterId(req), ...await store.voterWeekStats(voterId(req)) });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message) });
  }
});

/* ---------------------------------------------------------------------
   API — RÉACTIONS, PARTAGE, SIGNALEMENT
--------------------------------------------------------------------- */
app.post('/api/cases/:id/react', async (req, res) => {
  const { emoji, comment } = req.body || {};
  try {
    if (!await store.getCase(req.params.id)) return res.status(404).json({ error: 'Cas introuvable' });
    const reactions = await store.addReaction(
      req.params.id, voterId(req),
      typeof emoji === 'string' ? emoji.slice(0, 4) : null,
      typeof comment === 'string' ? comment.trim().slice(0, 140) : null
    );
    broadcast({ type: 'reaction', caseId: req.params.id });
    res.json({ ok: true, reactions });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message) });
  }
});

app.post('/api/cases/:id/share', async (req, res) => {
  try {
    await store.incrementShare(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message) });
  }
});

app.post('/api/cases/:id/flag', async (req, res) => {
  try {
    const ok = await store.flag(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Cas introuvable' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message) });
  }
});

/* ---------------------------------------------------------------------
   API — MUR DE LA HONTE (palmarès)
--------------------------------------------------------------------- */
app.get('/api/stats/wall', async (req, res) => {
  try {
    const [wall, contributors] = await Promise.all([store.wallStats(), store.contributors()]);
    res.json({ ...wall, contributors });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message) });
  }
});

/* ---------------------------------------------------------------------
   ADMIN PROTÉGÉ (modération des signalements)
--------------------------------------------------------------------- */
app.get('/api/admin/flagged', requireAdmin, async (req, res) => {
  try {
    res.json({ cases: await store.adminFlagged() });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message) });
  }
});
app.delete('/api/admin/cases/:id', requireAdmin, async (req, res) => {
  try {
    const ok = await store.adminDelete(req.params.id);
    res.json({ ok });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message) });
  }
});

/* ---------------------------------------------------------------------
   IMAGE DE PARTAGE — /og/:id.png (1200×630)
   Génération SVG → PNG via sharp si disponible, sinon SVG direct.
--------------------------------------------------------------------- */
let sharp = null;
try { sharp = require('sharp'); } catch (_) { /* optionnel */ }

function wrapText(text, maxLen) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxLen) {
      if (line) lines.push(line.trim());
      line = w;
    } else {
      line += ' ' + w;
    }
  }
  if (line) lines.push(line.trim());
  return lines;
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function buildOgSvg(c) {
  const t = c.guilty + c.innocent;
  const p = Math.round(t ? (c.guilty / t) * 100 : 0);
  const titleLines = wrapText(c.title || 'Un crime ordinaire du quotidien', 26);
  const sentLines = wrapText(c.verdict.sentence, 60).slice(0, 3);

  const tp = titleLines
    .map((l, i) => `<tspan x="70" dy="${i === 0 ? 0 : 34}">${xml(l)}</tspan>`)
    .join('');
  const sp = sentLines
    .map((l, i) => `<tspan x="70" dy="${i === 0 ? 0 : 26}">${xml(l)}</tspan>`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#160a33"/>
        <stop offset="0.55" stop-color="#0b0620"/>
        <stop offset="1" stop-color="#1d0a1e"/>
      </linearGradient>
      <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#c4b5fd"/>
        <stop offset="0.5" stop-color="#818cf8"/>
        <stop offset="1" stop-color="#38bdf8"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#bg)"/>
    <circle cx="180" cy="140" r="260" fill="#8b5cf6" opacity="0.16"/>
    <circle cx="1050" cy="520" r="300" fill="#38bdf8" opacity="0.12"/>
    <rect x="30" y="30" width="1140" height="570" rx="32" fill="none" stroke="#ffffff" stroke-opacity="0.1" stroke-width="2"/>
    <text x="70" y="96" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="700" letter-spacing="6" fill="#8b5cf6">⚖️ THE LAST VIBE</text>
    <text x="1130" y="96" font-family="Inter, Arial, sans-serif" font-size="20" font-weight="700" fill="#16d987" text-anchor="end">${p}% COUPABLE</text>
    <text x="70" y="330" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="600" fill="url(#brand)">${tp}</text>
    <line x1="70" y1="368" x2="1130" y2="368" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1"/>
    <text x="70" y="410" font-family="Inter, Arial, sans-serif" font-size="17" font-weight="600" letter-spacing="3" fill="#38bdf8">LA SENTENCE DU JUGE SUPRÊME</text>
    <text x="70" y="448" font-family="Inter, Arial, sans-serif" font-size="21" fill="#e8e6f5" opacity="0.92">“ ${sp} ”</text>
    <text x="1130" y="580" font-family="Inter, Arial, sans-serif" font-size="17" font-weight="600" fill="#ffffff" text-anchor="end" opacity="0.55">judge-quotidien → thelastvibe.app</text>
  </svg>`;
}

app.get('/og/:id.png', async (req, res) => {
  try {
    let c;
    if (req.params.id === 'banner') {
      c = {
        title: 'The Last Vibe — Le Tribunal du Quotidien',
        text: 'Juge anonymement les petits crimes du quotidien.',
        verdict: { sentence: 'Venez trancher : 🔥 Coupable ou 👑 Innocent.' },
        guilty: 666,
        innocent: 314,
      };
    } else {
      c = await store.getCase(req.params.id);
    }
    if (!c) return res.status(404).end();
    const svg = buildOgSvg(c);
    if (sharp) {
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(png);
    }
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(svg);
  } catch (err) {
    res.status(500).end(String(err && err.message));
  }
});

/* ---------------------------------------------------------------------
   PAGE DE PARTAGE — /c/:id (métadonnées sociales + redirection SPA)
--------------------------------------------------------------------- */
app.get('/c/:id', async (req, res) => {
  try {
    const c = await store.getCase(req.params.id);
    if (!c) return res.status(404).send('Cas introuvable. Le Juge pleure.');
    const base = `${req.protocol}://${req.get('host')}`;
    const ogTitle = c.title && c.title !== 'L’affaire du '
      ? c.title + ' — à juger'
      : 'Jugez ce crime du quotidien';
    const sent = abbreviate(c.verdict.sentence, 140);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${xml(ogTitle)} · The Last Vibe</title>
  <meta name="description" content="${xml(sent)}"/>
  <meta property="og:type" content="website"/>
  <meta property="og:site_name" content="The Last Vibe"/>
  <meta property="og:title" content="${xml(ogTitle)}"/>
  <meta property="og:description" content="${xml(sent)}"/>
  <meta property="og:image" content="${base}/og/${encodeURIComponent(c.id)}.png"/>
  <meta property="og:url" content="${base}/c/${encodeURIComponent(c.id)}"/>
  <meta property="twitter:card" content="summary_large_image"/>
  <meta property="twitter:title" content="${xml(ogTitle)}"/>
  <meta property="twitter:description" content="${xml(sent)}"/>
  <meta property="twitter:image" content="${base}/og/${encodeURIComponent(c.id)}.png"/>
  <meta name="theme-color" content="#070312"/>
  <style>
    body{margin:0;background:#070312;color:#e8e6f5;font-family:system-ui,-apple-system,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
    .card{max-width:520px;width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:24px;padding:28px;backdrop-filter:blur(12px)}
    .brand{color:#8b5cf6;font-weight:700;letter-spacing:.2em;font-size:12px}
    h1{font-size:22px;line-height:1.4;margin:10px 0}
    .sent{border-left:3px solid #38bdf8;color:#ffffffcc;margin:16px 0;padding-left:14px;font-size:14px}
    .go{display:block;text-align:center;background:linear-gradient(90deg,#8b5cf6,#38bdf8);color:#fff;font-weight:700;padding:14px;border-radius:14px;text-decoration:none;margin-top:18px}
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">⚖️ THE LAST VIBE</div>
    <h1>${xml(ogTitle)}</h1>
    <p style="color:#ffffff88;font-size:14px">« ${xml(abbreviate(c.text, 120))} »</p>
    <div class="sent">“ ${xml(sent)} ”</div>
    <a class="go" href="/">⚖️ Venir juger ce cas</a>
  </div>
  <script>location.replace('/?cas=${encodeURIComponent(c.id)}')</script>
</body>
</html>`);
  } catch (err) {
    res.status(500).send(String(err && err.message));
  }
});

/* ---------------------------------------------------------------------
   IMAGE "MA SEMAINE" — /og/week/:voter.png (1200×630)
   Bilan partageable des 7 derniers jours d'un justicier.
--------------------------------------------------------------------- */
function buildWeekSvg(s) {
  const t = (s.guilty || 0) + (s.innocent || 0);
  const p = Math.round(t ? (s.guilty / t) * 100 : 0);
  const badge = s.weekBadge || s.badges[s.badges.length - 1] || 'Justicier';
  const days = s.activeDays || 0;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#160a33"/>
        <stop offset="0.55" stop-color="#0b0620"/>
        <stop offset="1" stop-color="#1d0a1e"/>
      </linearGradient>
      <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#c4b5fd"/>
        <stop offset="0.5" stop-color="#818cf8"/>
        <stop offset="1" stop-color="#38bdf8"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#bg)"/>
    <circle cx="180" cy="140" r="260" fill="#8b5cf6" opacity="0.16"/>
    <circle cx="1050" cy="520" r="300" fill="#38bdf8" opacity="0.12"/>
    <rect x="30" y="30" width="1140" height="570" rx="32" fill="none" stroke="#ffffff" stroke-opacity="0.1" stroke-width="2"/>
    <text x="70" y="96" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="700" letter-spacing="6" fill="#8b5cf6">⚖️ THE LAST VIBE</text>
    <text x="1130" y="96" font-family="Inter, Arial, sans-serif" font-size="20" font-weight="700" fill="#16d987" text-anchor="end">BILAN DE MA SEMAINE</text>
    <text x="70" y="250" font-family="Inter, Arial, sans-serif" font-size="46" font-weight="700" fill="url(#brand)">Ma saison au prétoire</text>
    <text x="70" y="300" font-family="Inter, Arial, sans-serif" font-size="20" fill="#e8e6f5" opacity="0.8">${t} verdicts rendus cette semaine · série de ${days} jour(s)</text>
    <line x1="70" y1="340" x2="1130" y2="340" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1"/>
    <rect x="70" y="380" width="310" height="130" rx="20" fill="#ffffff" fill-opacity="0.05" stroke="#ffffff" stroke-opacity="0.1"/>
    <text x="225" y="430" font-family="Inter, Arial, sans-serif" font-size="44" font-weight="700" fill="#ff3b5c" text-anchor="middle">${p}%</text>
    <text x="225" y="476" font-family="Inter, Arial, sans-serif" font-size="16" fill="#ffffff99" text-anchor="middle">de verdicts COUPABLE</text>
    <rect x="420" y="380" width="310" height="130" rx="20" fill="#ffffff" fill-opacity="0.05" stroke="#ffffff" stroke-opacity="0.1"/>
    <text x="575" y="430" font-family="Inter, Arial, sans-serif" font-size="44" font-weight="700" fill="#16d987" text-anchor="middle">${t}</text>
    <text x="575" y="476" font-family="Inter, Arial, sans-serif" font-size="16" fill="#ffffff99" text-anchor="middle">affaires tranchées en 7 j</text>
    <rect x="770" y="380" width="360" height="130" rx="20" fill="url(#brand)" fill-opacity="0.14" stroke="#8b5cf6" stroke-opacity="0.5"/>
    <text x="950" y="430" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="700" fill="#c4b5fd" text-anchor="middle">${xml(badge)}</text>
    <text x="950" y="476" font-family="Inter, Arial, sans-serif" font-size="16" fill="#ffffffb3" text-anchor="middle">rang atteint</text>
    <text x="1130" y="580" font-family="Inter, Arial, sans-serif" font-size="17" font-weight="600" fill="#ffffff" text-anchor="end" opacity="0.55">rejoignez le tribunal → thelastvibe.app</text>
  </svg>`;
}

app.get('/og/week/:voter.png', async (req, res) => {
  try {
    let s = await store.voterWeekStats(req.params.voter).catch(() => null);
    if (!s) s = { votes: 0, guilty: 0, innocent: 0, activeDays: 0, badges: [], weekBadge: 'Nouveau greffé' };
    const svg = buildWeekSvg(s);
    if (sharp) {
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.send(png);
    }
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(svg);
  } catch (err) {
    res.status(500).end(String(err && err.message));
  }
});

/* ---------------------------------------------------------------------
   PAGE DE PARTAGE "MA SEMAINE" — /w/:voter (og + redirection SPA)
--------------------------------------------------------------------- */
app.get('/w/:voter', async (req, res) => {
  try {
    let s = await store.voterWeekStats(req.params.voter).catch(() => null);
    if (!s) return res.status(404).send('Justicier introuvable. Le greffier a égaré son plume.');
    const t = (s.guilty || 0) + (s.innocent || 0);
    const p = Math.round(t ? (s.guilty / t) * 100 : 0);
    const ogTitle = 'Ma semaine au tribunal : ' + t + ' verdicts !';
    const desc = `${t} affaires tranchées, ${s.activeDays || 0} jours de série et ${p}% de verdicts coupables.`;
    const base = `${req.protocol}://${req.get('host')}`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${xml(ogTitle)} · The Last Vibe</title>
  <meta name="description" content="${xml(desc)}"/>
  <meta property="og:type" content="website"/>
  <meta property="og:site_name" content="The Last Vibe"/>
  <meta property="og:title" content="${xml(ogTitle)}"/>
  <meta property="og:description" content="${xml(desc)}"/>
  <meta property="og:image" content="${base}/og/week/${encodeURIComponent(req.params.voter)}.png"/>
  <meta property="og:url" content="${base}/w/${encodeURIComponent(req.params.voter)}"/>
  <meta property="twitter:card" content="summary_large_image"/>
  <meta property="twitter:title" content="${xml(ogTitle)}"/>
  <meta property="twitter:description" content="${xml(desc)}"/>
  <meta property="twitter:image" content="${base}/og/week/${encodeURIComponent(req.params.voter)}.png"/>
  <meta name="theme-color" content="#070312"/>
  <style>
    body{margin:0;background:#070312;color:#e8e6f5;font-family:system-ui,-apple-system,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
    .card{max-width:520px;width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:24px;padding:28px;text-align:center}
    .brand{color:#8b5cf6;font-weight:700;letter-spacing:.2em;font-size:12px}
    h1{font-size:24px;margin:12px 0}
    .stats{display:flex;justify-content:center;gap:28px;margin:22px 0;font-size:14px;color:#ffffff88}
    .stats b{display:block;font-size:28px;color:#38bdf8}
    .go{display:inline-block;background:linear-gradient(90deg,#8b5cf6,#38bdf8);color:#fff;font-weight:700;padding:14px 26px;border-radius:14px;text-decoration:none;margin-top:8px}
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">⚖️ THE LAST VIBE</div>
    <h1>⭐⭐⭐ ${xml(ogTitle)}</h1>
    <div class="stats"><div><b>${t}</b>verdicts</div><div><b>${p}%</b>coupable</div><div><b>${s.activeDays || 0} j</b> de série</div></div>
    <a class="go" href="/">⚖️ Venir juger moi aussi</a>
  </div>
  <script>location.replace('/')</script>
</body>
</html>`);
  } catch (err) {
    res.status(500).send(String(err && err.message));
  }
});

/* ---------------------------------------------------------------------
   PAGE ADMIN (modération des signalements)
--------------------------------------------------------------------- */
app.get('/admin', (_req, res) => {
  res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Admin — The Last Vibe</title><style>
body{background:#0b0620;color:#e8e6f5;font-family:system-ui,sans-serif;padding:24px;max-width:760px;margin:auto}
.card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:16px;margin-bottom:12px}
button{background:#ff3b5c;color:#fff;border:0;border-radius:10px;padding:8px 14px;cursor:pointer;font-weight:700}
.meta{color:#ffffff66;font-size:12px}
input,form button{font-size:16px;padding:10px 14px;border-radius:10px;border:1px solid rgba(139,92,246,.4);background:#120b2b;color:#fff}
button.go{background:linear-gradient(90deg,#8b5cf6,#38bdf8)}
.hidden{display:none}
</style></head><body><h1>🛡️ Modération</h1>
<div id="login"><p style="color:#ffffff88">Accès réservé au greffier en chef.</p>
<input type="password" id="pass" placeholder="Mot de passe"/><br/><br/>
<button class="go" onclick="login()">Se connecter</button>
<p id="err" style="color:#ff3b5c"></p></div>
<div id="panel" class="hidden"><h2>Signalements</h2>
<p><button class="go" onclick="logout()">Se déconnecter</button></p>
<div id="box"><p>Chargement…</p></div></div>
<script>
const TOKEN_KEY = 'tlv_admin_token';
function token(){ return sessionStorage.getItem(TOKEN_KEY) || ''; }
async function login(){
  document.getElementById('err').textContent = '';
  try{
    const r = await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('pass').value})});
    const d = await r.json();
    if(!r.ok){ document.getElementById('err').textContent = d.error || 'Erreur'; return; }
    sessionStorage.setItem(TOKEN_KEY, d.token);
    enter();
  }catch(e){ document.getElementById('err').textContent = 'Serveur injoignable'; }
}
function logout(){ sessionStorage.removeItem(TOKEN_KEY); location.reload(); }
function enter(){
  document.getElementById('login').classList.add('hidden');
  document.getElementById('panel').classList.remove('hidden');
  load();
}
async function api(u, opts){
  opts = opts || {};
  opts.headers = Object.assign({'Authorization':'Bearer '+token()}, opts.headers||{});
  return fetch(u, opts);
}
async function load(){
  const panel = document.getElementById('box');
  const r = await api('/api/admin/flagged');
  if(r.status === 401){ sessionStorage.removeItem(TOKEN_KEY); location.reload(); return; }
  const d = await r.json();
  if(!d.cases || !d.cases.length){ panel.innerHTML = '<p style="color:#16d987">Aucun signalement en attente. Le Tribunal est serein.</p>'; return; }
  panel.innerHTML = d.cases.map(c => '<div class="card"><div><b>'+(c.title||'(sans titre)')+'</b></div><div class="meta">'+c.author+' · '+new Date(c.created_at).toLocaleString('fr-FR')+'</div><p>'+c.text+'</p><button onclick="del(\\''+c.id+'\\')">Supprimer</button></div>').join('');
}
async function del(id){ await api('/api/admin/cases/'+id,{method:'DELETE'}); load(); }
if(token()) enter(); else document.getElementById('pass').focus();
</script></body></html>`);
});

/* ---------------------------------------------------------------------
   CAS DU JOUR — routine (relancée chaque heure + à chaque démarrage)
--------------------------------------------------------------------- */
async function keepDailyFresh() {
  try { await store.ensureDaily(); } catch (err) { console.error('ensureDaily:', err.message); }
}
setInterval(keepDailyFresh, 3600000);

/* ---------------------------------------------------------------------
   DÉMARRAGE
--------------------------------------------------------------------- */
store.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`⚖️ The Last Vibe en ligne → http://localhost:${PORT} (store: ${store.getMode()})`);
      if (store.getMode() === 'memory') {
        console.log('   ℹ️ Mode mémoire (aucune DATABASE_URL). Pour PostgreSQL : DATABASE_URL="postgres://…" npm start');
      }
      Promise.all([require('./scripts/pwa-icons')()])
        .then(([icons]) => { if (icons.length) console.log('   📱 Icônes PWA : ' + icons.join(', ')); })
        .catch((err) => console.warn('   ⚠️ Icônes PWA non générées :', err.message));
    });
  })
  .catch((err) => {
    console.error('❌ Échec de l’initialisation du store :', err.message);
    process.exit(1);
  });