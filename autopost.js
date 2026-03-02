const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { TwitterApi } = require('twitter-api-v2');

const HISTORY_FILE = path.join(__dirname, 'autopost-history.json');

// NBA team Twitter/X handles keyed by ESPN abbreviation
const TEAM_HANDLES = {
  ATL: '@ATLHawks',
  BOS: '@celtics',
  BKN: '@BrooklynNets',
  CHA: '@hornets',
  CHI: '@chicagobulls',
  CLE: '@cavs',
  DAL: '@dallasmavs',
  DEN: '@nuggets',
  DET: '@DetroitPistons',
  GS: '@warriors',
  HOU: '@HoustonRockets',
  IND: '@Pacers',
  LAC: '@LAClippers',
  LAL: '@Lakers',
  MEM: '@memgrizz',
  MIA: '@MiamiHEAT',
  MIL: '@Bucks',
  MIN: '@Timberwolves',
  NO: '@PelicansNBA',
  NY: '@nyknicks',
  OKC: '@OKCThunder',
  ORL: '@OrlandoMagic',
  PHI: '@sixers',
  PHX: '@Suns',
  POR: '@trailblazers',
  SAC: '@SacramentoKings',
  SA: '@spurs',
  TOR: '@Raptors',
  UTAH: '@utahjazz',
  WSH: '@WashWizards',
};
const DRY_RUN = process.env.DRY_RUN === 'true';
const PORT = 9182;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.json': 'application/json',
};

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    return { posted: [] };
  }
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function startServer() {
  const server = http.createServer((req, res) => {
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : decodeURIComponent(req.url));
    const ext = path.extname(filePath);
    const mime = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': mime });
      res.end(data);
    });
  });

  return new Promise((resolve) => {
    server.listen(PORT, () => resolve(server));
  });
}

async function captureReceipts(page) {
  // Wait for the site to load games
  await page.waitForSelector('.key, .no-games', { timeout: 30000 });

  // Check if there are any games
  const hasGames = await page.$('.key');
  if (!hasGames) {
    const pageText = await page.$eval('#content', (el) => el.textContent);
    console.log(`No finished games found. Page shows: "${pageText.trim()}"`);
    return [];
  }

  // Get all winner button keys
  const keys = await page.$$eval('.key', (buttons) =>
    buttons.map((b) => ({
      id: b.dataset.teamId,
      name: b.querySelector('.key-name')?.textContent || '',
      score: b.querySelector('.key-score')?.textContent || '',
    }))
  );

  console.log(`Found ${keys.length} winners to process.`);

  const receipts = [];

  for (const key of keys) {
    // Click the winner button
    await page.click(`.key[data-team-id="${key.id}"]`);

    // Wait for overlay to become visible
    await page.waitForSelector('.receipt-overlay.visible', { timeout: 5000 });

    // Disable animations and jump to final state for a clean screenshot
    await page.evaluate(() => {
      const slide = document.querySelector('.receipt-slide');
      slide.style.animation = 'none';
      slide.style.transform = 'translateX(-50%) translateY(0)';

      document.querySelectorAll('.receipt-line-item, .receipt-line-extra').forEach((el) => {
        el.style.animation = 'none';
        el.style.opacity = '1';
        el.classList.add('printed');
      });
    });

    // Wait for all images inside the receipt to fully load
    await page.evaluate(() => {
      const receipt = document.querySelector('.receipt');
      if (!receipt) return;
      const images = Array.from(receipt.querySelectorAll('img'));
      return Promise.all(images.map((img) => {
        if (img.complete) return;
        return new Promise((resolve) => {
          img.addEventListener('load', resolve);
          img.addEventListener('error', resolve);
        });
      }));
    });

    // Wait for rendering to fully complete
    await new Promise((r) => setTimeout(r, 1000));

    // Get the receipt element and its tagline for the tweet
    const tagline = await page.$eval('.receipt .receipt-tagline', (el) => el.textContent);

    // Screenshot just the receipt
    const receiptEl = await page.$('.receipt');
    const screenshot = await receiptEl.screenshot({ type: 'png' });

    receipts.push({
      id: key.id,
      teamAbbrev: key.name,
      score: key.score,
      tagline,
      image: screenshot,
    });

    console.log(`  Captured: ${key.name} (${key.score}) - ${tagline}`);

    // Close the receipt and wait for overlay to fully dismiss
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 800));
  }

  return receipts;
}

function composeTweet(receipt) {
  const [winScore, loseScore] = receipt.score.split('-');
  const handle = TEAM_HANDLES[receipt.teamAbbrev] || receipt.teamAbbrev;
  return [
    `${receipt.tagline}`,
    `${handle} win ${winScore}-${loseScore}`,
    `#NBA #${receipt.teamAbbrev} #FinalTabs`,
  ].join('\n');
}

function isAuthError(err) {
  const code = err.code || err.data?.detail?.status;
  const twitterCode = err.data?.errors?.[0]?.code;
  return code === 401 || code === 403 || twitterCode === 215 || twitterCode === 261 || twitterCode === 89;
}

async function postToTwitter(client, receipt) {
  const text = composeTweet(receipt);

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would tweet:\n    ${text.replace(/\n/g, '\n    ')}`);
    return;
  }

  // Upload the image
  let mediaId;
  try {
    mediaId = await client.v1.uploadMedia(Buffer.from(receipt.image), {
      mimeType: 'image/png',
    });
    console.log(`  Media uploaded: ${mediaId}`);
  } catch (uploadErr) {
    console.error(`  Media upload failed: ${JSON.stringify(uploadErr.data || uploadErr.message)}`);
    throw uploadErr;
  }

  // Post the tweet with the image
  try {
    await client.v2.tweet({
      text,
      media: { media_ids: [mediaId] },
    });
  } catch (tweetErr) {
    console.error(`  Tweet failed: ${JSON.stringify(tweetErr.data || tweetErr.message)}`);
    throw tweetErr;
  }

  console.log(`  Posted tweet for ${receipt.teamAbbrev}`);
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN MODE ===' : '=== AUTOPOST ===');

  // Validate Twitter credentials (unless dry run)
  const { TWITTER_APP_KEY, TWITTER_APP_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET } =
    process.env;

  if (!DRY_RUN && (!TWITTER_APP_KEY || !TWITTER_APP_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET)) {
    console.error('Missing Twitter API credentials. Set these env vars:');
    console.error('  TWITTER_APP_KEY, TWITTER_APP_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET');
    process.exit(1);
  }

  let twitterClient = null;
  if (!DRY_RUN) {
    twitterClient = new TwitterApi({
      appKey: TWITTER_APP_KEY,
      appSecret: TWITTER_APP_SECRET,
      accessToken: TWITTER_ACCESS_TOKEN,
      accessSecret: TWITTER_ACCESS_SECRET,
    });
  }

  const history = loadHistory();

  // Start local server to serve the site
  const server = startServer();
  console.log(`Local server started on port ${PORT}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900 });

    // Mute audio
    const session = await page.createCDPSession();
    await session.send('Page.setWebLifecycleState', { state: 'active' });

    // Forward browser console and errors to Node for debugging
    page.on('console', (msg) => console.log(`[BROWSER] ${msg.text()}`));
    page.on('pageerror', (err) => console.error(`[BROWSER ERROR] ${err.message}`));
    page.on('requestfailed', (req) => console.error(`[REQUEST FAILED] ${req.url()} - ${req.failure()?.errorText}`));

    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle2' });

    const receipts = await captureReceipts(page);

    let posted = 0;
    let toPost = 0;
    for (const receipt of receipts) {
      if (history.posted.includes(receipt.id)) {
        console.log(`  Skipping ${receipt.teamAbbrev} (${receipt.id}) - already posted`);
        continue;
      }

      toPost++;
      try {
        await postToTwitter(twitterClient, receipt);
        history.posted.push(receipt.id);
        saveHistory(history);
        posted++;

        // Small delay between tweets to avoid rate limits
        if (!DRY_RUN) await new Promise((r) => setTimeout(r, 2000));
      } catch (err) {
        console.error(`  Failed to post ${receipt.teamAbbrev}: ${err.message}`);
        if (isAuthError(err)) {
          console.error('\nAuth/permission error detected — skipping remaining posts.');
          console.error('Check your Twitter app permissions and regenerate access tokens with read+write scope.');
          break;
        }
      }
    }

    console.log(`\nDone. Posted ${posted} new receipts.`);

    if (!DRY_RUN && toPost > 0 && posted === 0) {
      process.exit(1);
    }
  } finally {
    if (browser) await browser.close();
    (await server).close();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
