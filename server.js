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

// All 9 groups: 2 base + 1 expansion per topic
// Groups 1-2: FM | Groups 3-4: AC | Groups 5-6: IM (always active)
// Groups 7 (FM), 8 (AC), 9 (IM) unlocked by organizers if needed
const ALL_GROUPS = [
  { id: 1, theme: 'FM' },
  { id: 2, theme: 'FM' },
  { id: 3, theme: 'AC' },
  { id: 4, theme: 'AC' },
  { id: 5, theme: 'IM' },
  { id: 6, theme: 'IM' },
  { id: 7, theme: 'FM' },
  { id: 8, theme: 'AC' },
  { id: 9, theme: 'IM' },
];

const GROUPS_BY_THEME_BASE     = { FM: [1, 2],    AC: [3, 4],    IM: [5, 6]    };
const GROUPS_BY_THEME_EXPANDED = { FM: [1, 2, 7], AC: [3, 4, 8], IM: [5, 6, 9] };

// Target ~20-25 people per group per session
const MAX_PER_GROUP  = 25;
const FILL_TOLERANCE = 2;

let participants   = [];
let groupsExpanded = false; // groups 7, 8, 9 locked by default

function getGroupsByTheme() {
  return groupsExpanded ? GROUPS_BY_THEME_EXPANDED : GROUPS_BY_THEME_BASE;
}

// ── Session counts (for capacity & numerical balance) ──────────────
function sessionCounts() {
  const s1 = {}, s2 = {};
  ALL_GROUPS.forEach(g => { s1[g.id] = 0; s2[g.id] = 0; });
  participants.forEach(p => { s1[p.group1]++; s2[p.group2]++; });
  return { s1, s2 };
}

// ── Demographic composition of a group (across both its session slots) ──
function groupComposition(groupId) {
  const comp = { commission: {}, gender: {}, legalSystem: {}, seniority: {} };
  let total = 0;
  participants.forEach(p => {
    if (p.group1 === groupId || p.group2 === groupId) {
      comp.commission[p.commission] = (comp.commission[p.commission] || 0) + 1;
      comp.gender[p.gender]         = (comp.gender[p.gender] || 0) + 1;
      comp.legalSystem[p.commonLaw] = (comp.legalSystem[p.commonLaw] || 0) + 1;
      comp.seniority[p.seniority]   = (comp.seniority[p.seniority] || 0) + 1;
      total++;
    }
  });
  return { comp, total };
}

// Higher (less negative) score = candidate's traits are under-represented = preferred assignment
function diversityScore(groupId, candidate) {
  const { comp, total } = groupComposition(groupId);
  if (total === 0) return 0;
  const representation =
    (comp.commission[candidate.commission] || 0) +
    (comp.gender[candidate.gender] || 0) +
    (comp.legalSystem[candidate.commonLaw] || 0) +
    (comp.seniority[candidate.seniority] || 0);
  return -(representation / total);
}

function findBestPair(themeA, themeB, s1, s2, candidate) {
  const byTheme = getGroupsByTheme();
  const options = [];
  const collect = (groupsX, groupsY) => {
    for (const gx of groupsX) {
      if (s1[gx] >= MAX_PER_GROUP) continue;
      for (const gy of groupsY) {
        if (s2[gy] >= MAX_PER_GROUP) continue;
        options.push({ g1: gx, g2: gy, fill: Math.max(s1[gx], s2[gy]) });
      }
    }
  };
  collect(byTheme[themeA], byTheme[themeB]);
  collect(byTheme[themeB], byTheme[themeA]);

  if (options.length === 0) return null;

  const minFill = Math.min(...options.map(o => o.fill));
  const shortlisted = options.filter(o => o.fill <= minFill + FILL_TOLERANCE);

  let best = shortlisted[0];
  let bestScore = diversityScore(best.g1, candidate) + diversityScore(best.g2, candidate);
  for (const o of shortlisted.slice(1)) {
    const score = diversityScore(o.g1, candidate) + diversityScore(o.g2, candidate);
    if (score > bestScore) { bestScore = score; best = o; }
  }
  return best;
}

function assignGroups(candidate) {
  const [t1, t2, t3] = candidate.themeRanking;
  const { s1, s2 } = sessionCounts();

  const combos = [[t1, t2], [t1, t3], [t2, t3]];
  for (const [ta, tb] of combos) {
    const pair = findBestPair(ta, tb, s1, s2, candidate);
    if (pair) return pair;
  }

  // Absolute fallback: any valid pair of different themes
  const byTheme = getGroupsByTheme();
  for (const ta of Object.keys(byTheme)) {
    for (const tb of Object.keys(byTheme)) {
      if (ta === tb) continue;
      const pair = findBestPair(ta, tb, s1, s2, candidate);
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

  const candidate = { gender, commission, themeRanking, commonLaw, seniority, dancefloor };
  const assignment = assignGroups(candidate);
  if (!assignment) {
    return res.status(503).json({ error: 'All groups are full. Please see the organizers.' });
  }

  participants.push({
    id: Date.now(),
    ...candidate,
    group1: assignment.g1,
    group2: assignment.g2,
    at: new Date().toISOString(),
  });

  const g1 = ALL_GROUPS.find(g => g.id === assignment.g1);
  const g2 = ALL_GROUPS.find(g => g.id === assignment.g2);

  res.json({
    group1: { id: g1.id, themeName: THEME_NAMES[g1.theme] },
    group2: { id: g2.id, themeName: THEME_NAMES[g2.theme] },
  });
});

app.get('/api/stats', (req, res) => {
  const { s1, s2 } = sessionCounts();
  const activeCount = groupsExpanded ? 9 : 6;

  res.json({
    total: participants.length,
    maxTotal: MAX_PER_GROUP * activeCount,
    expanded: groupsExpanded,
    groups: ALL_GROUPS.map(g => ({
      id: g.id,
      theme: g.theme,
      themeName: THEME_NAMES[g.theme],
      s1Count: s1[g.id],
      s2Count: s2[g.id],
      max: MAX_PER_GROUP,
      active: groupsExpanded || g.id <= 6,
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
        'Under 35': participants.filter(p => p.seniority === 'junior').length,
        '35 – 40':  participants.filter(p => p.seniority === 'mid').length,
        '40+':      participants.filter(p => p.seniority === 'senior').length,
      },
      dancefloor: {
        'Less than 2h': participants.filter(p => p.dancefloor === 'low').length,
        '2 – 4h':       participants.filter(p => p.dancefloor === 'medium').length,
        'More than 4h': participants.filter(p => p.dancefloor === 'high').length,
      },
    },
  });
});

// Toggle groups 7, 8, 9 on/off (organizer action)
app.post('/api/toggle-expansion', (req, res) => {
  groupsExpanded = !groupsExpanded;
  res.json({ expanded: groupsExpanded });
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
