# ASIF Stock Feed

This service refreshes the ASIF stock snapshot from Twelve Data and publishes the latest JSON/XML feeds to GitHub Pages.

## Recommended production setup

### 22Miles display URL

Use the static GitHub Pages display, not the Render web-service URL:

`https://harbertcobweb.github.io/asif-stock-feed/`

The GitHub Pages display reads:

`https://harbertcobweb.github.io/asif-stock-feed/feeds/stock-feed.json`

This keeps normal signage traffic off the Render free web service so the Render instance can spin down between scheduled refreshes.

### Render web service environment variables

Required for stock data:

- `TWELVEDATA_API_KEY`

Required for automatic GitHub publishing:

- `GITHUB_OWNER=HarbertCobweb`
- `GITHUB_REPO=asif-stock-feed`
- `GITHUB_BRANCH=main`
- `GITHUB_TOKEN=<GitHub token with Contents: Read and write access to this repository>`

Optional feed paths:

- `OUTPUT_JSON_PATH=feeds/stock-feed.json`
- `OUTPUT_XML_PATH=feeds/stock-feed.xml`

After these variables are configured, every successful `/api/refresh` request also syncs the cached JSON and XML feeds to GitHub. If the content is unchanged, no unnecessary GitHub commit is created.

You can verify the publishing configuration at:

`https://asif-stock-feed.onrender.com/api/status`

### Render Cron Job

The existing weekday schedule can continue to call `/api/refresh`. Use `curl -f` so Render marks the cron run failed if the refresh or GitHub publish returns an HTTP error:

```bash
curl -fsS https://asif-stock-feed.onrender.com/api/refresh
```

The application refresh window is 9:30 AM–4:10 PM Eastern on weekdays. Calls outside that window reuse cached data but will still attempt to sync that cached feed to GitHub.

## Local commands

```bash
npm start
npm run check
```

The older standalone publishing command remains available if needed:

```bash
npm run publish-static
```

That standalone command additionally requires `SOURCE_JSON_URL` and `SOURCE_XML_URL`. Normal production refreshes do not require those variables anymore.


## Automatic 10-minute refresh (Render Starter)

The web service now schedules its own market refreshes. A separate Render Cron Job is no longer required.

- Runs Monday through Friday
- Starts at 9:30 AM Eastern
- Refreshes every 10 minutes
- Final scheduled refresh is 4:00 PM Eastern
- 40 refreshes per weekday
- 17 holdings per refresh = about 680 Twelve Data credits per trading day
- Uses `America/New_York` internally so daylight saving time is handled automatically
- Publishes the refreshed JSON/XML feeds to GitHub after each successful refresh

Set `AUTO_REFRESH_ENABLED=false` in Render only if you need to temporarily disable the internal scheduler. It defaults to enabled.

After deploying this version, disable the old Render Cron Job that calls `/api/refresh`; otherwise it creates unnecessary extra refresh attempts.

The GitHub Pages display checks the published JSON once per minute and displays the update time in Central Time using `America/Chicago`.
