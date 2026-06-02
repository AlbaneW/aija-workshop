const express = require('express');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname)); // fallback if HTML files are at root

const THEME_NAMES = {
  FM: 'Force Majeure / Hardship Defenses',
  AC: 'Asymmetrical Clauses',
  IM: 'Interim Measures',
};

// 6 groups: 2 per topic, each with a dedicated speaker who presents twice
// Groups 1-2: FM | Groups 3-4: AC | Groups 5-6: IM
const GROUPS = [
  { id: 1, theme: 'FM' },
  { id: 2, theme: 'FM' },
  { id: 3, theme: 'AC' },
  { id: 4, theme: 'AC' },
  { id: 5, theme: 'IM' },
  { id: 6, theme: 'IM' },
];

const GROUPS_BY_THEME = {
  FM: [1, 2],
  AC: [3, 4],
  IM: [5, 6],
};

// Max participants per group per session slot (~200 / 6 ≈ 34)
const MAX_PER_GROUP = 34;

let participants = [];

// Count participants per group, separately for session 1 and session 2
function sessionCounts() {
  const s1 = {}, s2 = {};
  GROUPS.forEach(g => { s1[g.id] = 0; s2[g.id] = 0; });
  participants.forEach(p => {
    s1[p.group1]++;
    s2[p.group2]++;
  });
  return { s1, s2 };
}

// Find the best available pair of groups for two given themes
// Tries both orderings (themeA in S1 or themeB in S1)
// Picks the pair with the lowest max session count (best balance)
function findBestPair(themeA, themeB, s1, s2) {
  let best = null;
  let bestScore = Infinity;

  const evaluate = (groupsS1, groupsS2) => {
    for (const ga of groupsS1) {
      if (s1[ga] >= MAX_PER_GROUP) continue;
      for (const gb of groupsS2) {
        if (s2[gb] >= MAX_PER_GROUP) continue;
        const score = Math.max(s1[ga], s2[gb]);
        if (score < bestScore) {
          bestScore = score;
          best = { g1: ga, g2: gb };
        }
      }
    }
  };

  evaluate(GROUPS_BY_THEME[themeA], GROUPS_BY_THEME[themeB]);
  evaluate(GROUPS_BY_THEME[themeB], GROUPS_BY_THEME[themeA]);

  return best;
}

function assignGroups(ranking) {
  const [t1, t2, t3] = ranking;
  const { s1, s2 } = sessionCounts();

  // Priority: top-2 combo first, then 1st+3rd, then 2nd+3rd
  const combos = [[t1, t2], [t1, t3], [t2, t3]];
  for (const [ta, tb] of combos) {
    const pair = findBestPair(ta, tb, s1, s2);
    if (pair) return pair;
  }

  // Absolute fallback: any valid pair of different themes
  for (const ta of Object.keys(GROUPS_BY_THEME)) {
    for (const tb of Object.keys(GROUPS_BY_THEME)) {
      if (ta === tb) continue;
      const pair = findBestPair(ta, tb, s1, s2);
      if (pair) return pair;
    }
  }

  return null;
}

app.post('/api/submit', (req, res) => {
  const { gender, commission, themeRanking, commonLaw, seniority, dancefloor } = req.body;

  const validThemes = Object.keys(THEME_NAMES);
  const valid =
    ['male', 'female'].includes(gender) &&
    ['Litigation', 'Arbitration', 'T.R.AD.E.'].includes(commission) &&
    Array.isArray(themeRanking) && themeRanking.length === 3 &&
    themeRanking.every(t => validThemes.includes(t)) &&
    new Set(themeRanking).size === 3 &&
    ['yes', 'no'].includes(commonLaw) &&
    ['junior', 'mid', 'senior'].includes(seniority) &&
    ['low', 'medium', 'high'].includes(dancefloor);

  if (!valid) {
    return res.status(400).json({ error: 'Please complete all fields.' });
  }

  const assignment = assignGroups(themeRanking);
  if (!assignment) {
    return res.status(503).json({ error: 'All groups are full. Please see the organizers.' });
  }

  participants.push({
    id: Date.now(),
    gender, commission, themeRanking, commonLaw, seniority, dancefloor,
    group1: assignment.g1,
    group2: assignment.g2,
    at: new Date().toISOString(),
  });

  const g1 = GROUPS.find(g => g.id === assignment.g1);
  const g2 = GROUPS.find(g => g.id === assignment.g2);

  res.json({
    group1: { id: g1.id, themeName: THEME_NAMES[g1.theme] },
    group2: { id: g2.id, themeName: THEME_NAMES[g2.theme] },
  });
});

app.get('/api/stats', (req, res) => {
  const { s1, s2 } = sessionCounts();

  res.json({
    total: participants.length,
    maxTotal: MAX_PER_GROUP * GROUPS.length,
    groups: GROUPS.map(g => ({
      id: g.id,
      theme: g.theme,
      themeName: THEME_NAMES[g.theme],
      s1Count: s1[g.id],
      s2Count: s2[g.id],
      max: MAX_PER_GROUP,
    })),
    breakdown: {
      gender: {
        Male:   participants.filter(p => p.gender === 'male').length,
        Female: participants.filter(p => p.gender === 'female').length,
      },
      commission: {
        Litigation:  participants.filter(p => p.commission === 'Litigation').length,
        Arbitration: participants.filter(p => p.commission === 'Arbitration').length,
        'T.R.AD.E.': participants.filter(p => p.commission === 'T.R.AD.E.').length,
      },
      legalSystem: {
        'Common Law': participants.filter(p => p.commonLaw === 'yes').length,
        'Civil Law':  participants.filter(p => p.commonLaw === 'no').length,
      },
      seniority: {
        'Under 35':            participants.filter(p => p.seniority === 'junior').length,
        '35 – 40':             participants.filter(p => p.seniority === 'mid').length,
        'Almost overage (40+)': participants.filter(p => p.seniority === 'senior').length,
      },
      dancefloor: {
        'Less than 2h': participants.filter(p => p.dancefloor === 'low').length,
        '2 – 4h':       participants.filter(p => p.dancefloor === 'medium').length,
        'More than 4h': participants.filter(p => p.dancefloor === 'high').length,
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
  console.log('\n  Workshop Registration App — AIJA');
  console.log('  ─────────────────────────────────────────');
  console.log(`  Local:    http://localhost:${PORT}`);
  console.log(`  Network:  http://${networkIp}:${PORT}`);
  console.log(`  Admin:    http://${networkIp}:${PORT}/admin.html`);
  console.log('  ─────────────────────────────────────────\n');
});
