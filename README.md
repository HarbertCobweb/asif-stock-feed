# ASIF Stock Feed — Alpha Vantage

Uses Alpha Vantage `TIME_SERIES_DAILY` to create cached JSON/XML feeds and a
16:9 six-row digital signage display.

## Render environment variable

ALPHAVANTAGE_API_KEY

## Render commands

Build: npm install
Start: npm start

## Routes

- `/api/refresh`
- `/api/status`
- `/data/stocks.json`
- `/data/stocks.xml`
- `/data/stocks.ixml`

## Daily cron command

node -e "fetch('https://asif-stock-feed.onrender.com/api/refresh').then(r=>r.text()).then(console.log)"

Do not repeatedly run `/api/refresh` on the free plan. A full refresh uses
17 requests, and Alpha Vantage's standard allowance is 25 requests per day.
