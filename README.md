# Auburn Market Watch Secure Setup

This version keeps your OpenAI API key out of browser code.

## Files

- `public/index.html` — Auburn-themed responsive frontend
- `server.js` — secure Express backend endpoint at `/api/stock-feed`
- `.env.example` — example environment variable file
- `package.json` — Node dependencies and scripts

## Setup

1. Install Node.js if needed.
2. Open this folder in Terminal.
3. Run:

```bash
npm install
```

4. Create a `.env` file from the example:

```bash
cp .env.example .env
```

5. Open `.env` and replace the placeholder with your real OpenAI API key:

```bash
OPENAI_API_KEY=sk-your-real-key
```

6. Start the local server:

```bash
npm start
```

7. Visit:

```text
http://localhost:3000
```

## Important

Do not put your OpenAI key in `public/index.html` or any frontend JavaScript. Anything in the browser can be viewed by users.

Also, if you previously pasted a live key into chat or browser code, rotate it in your OpenAI dashboard.
