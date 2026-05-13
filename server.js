const express = require('express');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const THEME_NAMES = {
  FM: 'Force Majeure / Hardship Defenses',
  AC: 'Asymmetrical Clauses',
  IM: 'Interim Measures',
};

// 6 groups: 2 per theme combination
// FM+AC → Groups 1,2 | FM+IM → Groups 3,4 | AC+IM → Groups 5,6
const GROUPS = [
  { id: 1, themes: ['FM', 'AC'] },
  { id: 2, themes: ['FM', 'AC'] },
  { id: 3, themes: ['FM', 'IM'] },
  { id: 4, themes: ['FM', 'IM'] },
  { id: 5, themes: ['AC', 'IM'] },
  { id: 6, themes: ['AC', 'IM'] },
];

const MAX_PER_GROUP = 34;
let participants = [];

function groupCounts() {
  const c = {};
  GROUPS.forEach(g => (c[g.id] = 0));
  participants.forEach(p => c[p.groupId]++);
  return c;
}

function assignGroup(ranking) {
  const [t1, t2, t3] = ranking;
  const c = groupCounts();

  // Try combos in priority order: top-2 first, then top1+3rd, then 2nd+3rd
  const priority = [[t1, t2], [t1, t3], [t2, t3]];

  for (const [a, b] of priority) {
    const matching = GROUPS
      .filter(g => g.themes.includes(a) && g.themes.includes(b))
      .sort((x, y) => c[x.id] - c[y.id]); // balance load across the 2 groups with same themes
    const pick = matching.find(g => c[g.id] < MAX_PER_GROUP);
    if (pick) return pick;
  }

  // Absolute fallback: least-full group with space
  return [...GROUPS]
    .sort((a, b) => c[a.id] - c[b.id])
    .find(g => c[g.id] < MAX_PER_GROUP) || null;
}

app.post('/api/submit', (req, res) => {
  const { gender, commission, themeRanking, commonLaw } = req.body;

  const validThemes = Object.keys(THEME_NAMES);
  const valid =
    ['male', 'female'].includes(gender) &&
    ['Litigation', 'Arbitration', 'T.R.AD.E.'].includes(commission) &&
    Array.isArray(themeRanking) &&
    themeRanking.length === 3 &&
    themeRanking.every(t => validThemes.includes(t)) &&
    new Set(themeRanking).size === 3 &&
    ['yes', 'no'].includes(commonLaw);

  if (!valid) {
    return res.status(400).json({ error: 'Please complete all fields.' });
  }

  const group = assignGroup(themeRanking);
  if (!group) {
    return res.status(503).json({ error: 'All groups are full. Please see the organizers.' });
  }

  participants.push({
    id: Date.now(),
    gender,
    commission,
    themeRanking,
    commonLaw,
    groupId: group.id,
    at: new Date().toISOString(),
  });

  res.json({
    groupId: group.id,
    themes: group.themes.map(t => THEME_NAMES[t]),
  });
});

app.get('/api/stats', (req, res) => {
  const c = groupCounts();
  res.json({
    total: participants.length,
    maxTotal: MAX_PER_GROUP * GROUPS.length,
    groups: GROUPS.map(g => ({
      id: g.id,
      themeNames: g.themes.map(t => THEME_NAMES[t]),
      themeKeys: g.themes,
      count: c[g.id],
      max: MAX_PER_GROUP,
    })),
    breakdown: {
      gender: {
        Male: participants.filter(p => p.gender === 'male').length,
        Female: participants.filter(p => p.gender === 'female').length,
      },
      commission: {
        Litigation: participants.filter(p => p.commission === 'Litigation').length,
        Arbitration: participants.filter(p => p.commission === 'Arbitration').length,
        'T.R.AD.E.': participants.filter(p => p.commission === 'T.R.AD.E.').length,
      },
      legalSystem: {
        'Common Law': participants.filter(p => p.commonLaw === 'yes').length,
        'Civil Law': participants.filter(p => p.commonLaw === 'no').length,
      },
    },
  });
});

app.post('/api/reset', (req, res) => {
  participants = [];
  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
  let networkIp = 'localhost';
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        networkIp = net.address;
        break;
      }
    }
  }

  console.log('\n  Workshop Registration App');
  console.log('  ─────────────────────────────────────────');
  console.log(`  Local:    http://localhost:${PORT}`);
  console.log(`  Network:  http://${networkIp}:${PORT}`);
  console.log(`  Admin:    http://${networkIp}:${PORT}/admin.html`);
  console.log('  ─────────────────────────────────────────');
  console.log('  Share the Network URL with participants via QR code.\n');
});
