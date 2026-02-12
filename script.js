const API_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

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
    // Fetch today's and yesterday's games in parallel
    const [todayGames, yesterdayGames] = await Promise.all([
      fetchGamesForDate(formatDateStr(today)),
      fetchGamesForDate(formatDateStr(yesterday))
    ]);

    if (todayGames.length === 0 && yesterdayGames.length === 0) {
      content.innerHTML = '<div class="no-games">No finalized games from today or yesterday.<br>Check back after games wrap up.</div>';
      return;
    }

    let html = '';
    if (yesterdayGames.length > 0) {
      html += `<div class="date-label">Yesterday</div><div class="receipts-container" id="receipts-yesterday"></div>`;
    }
    if (todayGames.length > 0) {
      html += `<div class="date-label">Today</div><div class="receipts-container" id="receipts-today"></div>`;
    }
    content.innerHTML = html;

    // Load box scores and render receipts for both days in parallel
    await Promise.all([
      renderReceipts(yesterdayGames, 'receipts-yesterday'),
      renderReceipts(todayGames, 'receipts-today')
    ]);
  } catch (err) {
    content.innerHTML = `<div class="no-games">Failed to load games: ${err.message}</div>`;
  }
}

async function renderReceipts(games, containerId) {
  const container = document.getElementById(containerId);
  if (!container || games.length === 0) return;

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

    // Only create a receipt for the winning team
    const winner = competition.competitors.find(c => c.winner);
    if (winner) {
      const opponent = competition.competitors.find(c => c.id !== winner.id);
      const receipt = buildReceipt(event, winner, opponent, summary);
      container.appendChild(receipt);
    }
  }
}

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
  const won = teamScore > opponentScore;

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

  // Build receipt element
  const el = document.createElement('div');
  el.className = 'receipt';

  // Build line items HTML
  let lineItemsHTML = '';
  for (const p of players) {
    const dots = '.'.repeat(Math.max(1,
      38 - p.name.length - p.pts.toFixed(2).length
    ));
    lineItemsHTML += `
      <div class="receipt-line-item">
        <span class="receipt-player-name">${p.name.toUpperCase()}</span>
        <span class="receipt-player-pts">${p.pts.toFixed(2)}</span>
      </div>`;
  }

  // Generate QR code
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

    <hr class="receipt-divider">

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

    <hr class="receipt-divider">

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
