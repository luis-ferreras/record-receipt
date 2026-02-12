const API_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

// Store receipts keyed by team id
const receiptStore = {};

function formatDateStr(date) {
  return date.getFullYear()
    + String(date.getMonth() + 1).padStart(2, '0')
    + String(date.getDate()).padStart(2, '0');
}

async function fetchGamesForDate(dateStr) {
  const res = await fetch(`${API_BASE}/scoreboard?dates=${dateStr}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.events || []).filter(e => e.status.type.state === 'post');
}

async function init() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading games...</div>';

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  try {
    const [todayGames, yesterdayGames] = await Promise.all([
      fetchGamesForDate(formatDateStr(today)),
      fetchGamesForDate(formatDateStr(yesterday))
    ]);

    if (todayGames.length === 0 && yesterdayGames.length === 0) {
      content.innerHTML = '<div class="no-games">No finalized games from today or yesterday.<br>Check back after games wrap up.</div>';
      return;
    }

    // Fetch all box scores and build receipts in memory
    const allGames = [...yesterdayGames, ...todayGames];
    await loadAllReceipts(allGames);

    // Build the keyboard UI
    renderKeyboard(yesterdayGames, todayGames);
  } catch (err) {
    content.innerHTML = `<div class="no-games">Failed to load games: ${err.message}</div>`;
  }
}

async function loadAllReceipts(games) {
  const summaries = await Promise.all(
    games.map(async (event) => {
      try {
        const res = await fetch(`${API_BASE}/summary?event=${event.id}`);
        if (!res.ok) return null;
        return { event, summary: await res.json() };
      } catch { return null; }
    })
  );

  for (const item of summaries) {
    if (!item) continue;
    const { event, summary } = item;
    const competition = event.competitions[0];
    const winner = competition.competitors.find(c => c.winner);
    if (winner) {
      const opponent = competition.competitors.find(c => c.id !== winner.id);
      const receiptEl = buildReceipt(event, winner, opponent, summary);
      receiptStore[winner.team.id] = {
        el: receiptEl,
        teamName: winner.team.shortDisplayName,
        teamLogo: winner.team.logo,
        teamAbbrev: winner.team.abbreviation,
        score: `${winner.score}-${opponent.score}`,
        opponentAbbrev: opponent.team.abbreviation
      };
    }
  }
}

function renderKeyboard(yesterdayGames, todayGames) {
  const content = document.getElementById('content');
  let html = '';

  if (yesterdayGames.length > 0) {
    const yesterdayKeys = getWinnerKeys(yesterdayGames);
    if (yesterdayKeys.length > 0) {
      html += `<div class="date-label">Yesterday</div>`;
      html += `<div class="keyboard">${yesterdayKeys.map(buildKey).join('')}</div>`;
    }
  }

  if (todayGames.length > 0) {
    const todayKeys = getWinnerKeys(todayGames);
    if (todayKeys.length > 0) {
      html += `<div class="date-label">Today</div>`;
      html += `<div class="keyboard">${todayKeys.map(buildKey).join('')}</div>`;
    }
  }

  content.innerHTML = html;
}

function getWinnerKeys(games) {
  const keys = [];
  for (const event of games) {
    const competition = event.competitions[0];
    const winner = competition.competitors.find(c => c.winner);
    if (winner && receiptStore[winner.team.id]) {
      keys.push(receiptStore[winner.team.id]);
    }
  }
  return keys;
}

function buildKey(team) {
  return `
    <button class="key" onclick="showReceipt('${team.teamAbbrev}')" data-team-id="${team.teamAbbrev}">
      <img class="key-logo" src="${team.teamLogo}" alt="${team.teamName}">
      <span class="key-name">${team.teamAbbrev}</span>
      <span class="key-score">${team.score}</span>
    </button>`;
}

function showReceipt(abbrev) {
  const entry = Object.values(receiptStore).find(r => r.teamAbbrev === abbrev);
  if (!entry) return;

  const overlay = document.getElementById('receipt-overlay');
  const slide = document.getElementById('receipt-slide');

  // Clear previous receipt and insert new one
  slide.innerHTML = '';
  const clone = entry.el.cloneNode(true);
  slide.appendChild(clone);

  // Mark active key
  document.querySelectorAll('.key').forEach(k => k.classList.remove('key-active'));
  const activeKey = document.querySelector(`.key[data-team-id="${abbrev}"]`);
  if (activeKey) activeKey.classList.add('key-active');

  // Show overlay and trigger animation
  overlay.classList.remove('visible');
  // Force reflow so removing/re-adding class triggers animation
  void overlay.offsetHeight;
  overlay.classList.add('visible');
}

function closeReceipt() {
  const overlay = document.getElementById('receipt-overlay');
  overlay.classList.remove('visible');
  document.querySelectorAll('.key').forEach(k => k.classList.remove('key-active'));
}

// Close on overlay background click
document.getElementById('receipt-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    closeReceipt();
  }
});

// Close on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeReceipt();
});

function buildReceipt(event, team, opponent, summary) {
  const gameDate = new Date(event.date);
  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                       'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const dateFormatted = `${monthNames[gameDate.getMonth()]}. ${gameDate.getDate()}, ${gameDate.getFullYear()}`;
  const timeFormatted = gameDate.toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit'
  });

  const orderNum = String(gameDate.getMonth() + 1).padStart(2, '0')
    + String(gameDate.getDate()).padStart(2, '0');

  const teamScore = parseInt(team.score);
  const opponentScore = parseInt(opponent.score);

  // Get player stats from box score
  let players = [];
  if (summary.boxscore && summary.boxscore.players) {
    const teamBox = summary.boxscore.players.find(
      p => p.team.id === team.team.id
    );
    if (teamBox && teamBox.statistics && teamBox.statistics[0]) {
      const labels = teamBox.statistics[0].labels;
      const ptsIndex = labels.indexOf('PTS');

      if (ptsIndex !== -1) {
        players = teamBox.statistics[0].athletes
          .map(a => ({
            name: a.athlete.displayName,
            pts: parseInt(a.stats[ptsIndex]) || 0
          }))
          .filter(p => p.pts >= 10)
          .sort((a, b) => b.pts - a.pts);
      }
    }
  }

  const subtotal = players.reduce((sum, p) => sum + p.pts, 0);
  const bonusBuckets = teamScore - subtotal;

  const el = document.createElement('div');
  el.className = 'receipt';

  let lineItemsHTML = '';
  for (const p of players) {
    lineItemsHTML += `
      <div class="receipt-line-item">
        <span class="receipt-player-name">${p.name.toUpperCase()}</span>
        <span class="receipt-player-pts">${p.pts.toFixed(2)}</span>
      </div>`;
  }

  const gameUrl = `https://www.espn.com/nba/game/_/gameId/${event.id}`;
  const qr = qrcode(0, 'M');
  qr.addData(gameUrl);
  qr.make();
  const qrImgTag = qr.createImgTag(3, 0);

  el.innerHTML = `
    <div class="receipt-header">
      <img class="receipt-logo" src="${team.team.logo}" alt="${team.team.displayName}">
      <div class="receipt-team-name">${team.team.displayName}</div>
      <div class="receipt-tagline">Everyone Eats</div>
    </div>

    <div class="receipt-order">ORDER #${orderNum} FOR ${opponent.team.shortDisplayName.toUpperCase()}</div>
    <div class="receipt-datetime">${dateFormatted} ${timeFormatted}</div>

    <hr class="receipt-divider">

    ${lineItemsHTML}

    <hr class="receipt-divider">

    <div class="receipt-summary">
      <div class="receipt-summary-line">
        <span>SUBTOTAL</span>
        <span>${subtotal.toFixed(2)}</span>
      </div>
      <div class="receipt-summary-line">
        <span>BONUS BUCKETS</span>
        <span>${bonusBuckets.toFixed(2)}</span>
      </div>
    </div>

    <div class="receipt-total-line">
      <span>TOTAL</span>
      <span>${teamScore.toFixed(2)}</span>
    </div>

    <div class="receipt-result win">
      W ${teamScore} - ${opponentScore}
    </div>

    <hr class="receipt-divider">

    <div class="receipt-footer">
      <div class="receipt-thanks">Thank You For Dining!</div>
      <a class="receipt-qr-link" href="${gameUrl}" target="_blank" rel="noopener">${qrImgTag}</a>
      <div class="receipt-retain">Scan For Full Box Score</div>
    </div>
  `;

  return el;
}

init();
