# The Final Tab

NBA game results served as receipt-style box scores. See who cooked, who got served, and relive every winning performance — one receipt at a time.

## What It Does

The Final Tab pulls finished NBA games from the ESPN API and presents each winning team's box score as a stylized receipt. Players who scored 10+ points appear as line items, and standout performances in assists, rebounds, blocks, and steals get restaurant-themed labels like "Table Captain" or "Sent It Back."

### Sections

- **Today's Games** — winners from today's completed games
- **Yesterday's Games** — winners from yesterday
- **Earlier This Week** — up to 3 additional days of results, grouped by day with smaller buttons

### Features

- Click any team button to "print" their receipt with a thermal-printer animation and sound effect
- Close games (margin of 5 or fewer, or overtime) get a pulsing glow on their button
- Each receipt includes a QR code linking to the full ESPN game page
- Shareable via URL hash (e.g. `#LAL-0213`)
- Fully responsive across desktop, tablet, and mobile

## Tech Stack

- Vanilla HTML, CSS, and JavaScript — no frameworks or build step
- ESPN public scoreboard and summary APIs
- QR codes via `api.qrserver.com`
- Custom "Merchant Copy" receipt font

## Running Locally

Serve the project directory with any static file server:

```bash
npx serve .
```

Then open `http://localhost:3000` (or whichever port is assigned).

## Project Structure

```
index.html          Main page with semantic HTML and SEO meta tags
script.js           All game fetching, receipt building, and UI logic
styles.css          Receipt, keyboard, printer animation, and responsive styles
receipt-printer.mp3 Thermal printer sound effect
Merchant Copy.woff2 Receipt-style monospace font
```
