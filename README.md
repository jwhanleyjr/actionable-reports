# Bloomerang Search Tester

A minimal Next.js App Router page that tests Bloomerang constituent search by account number.

## Environment

Create a `.env.local` with:

```
BLOOMERANG_API_KEY=your_bloomerang_api_key
```

## Development

Install dependencies and start the dev server:

```
npm install
npm run dev
```

Open http://localhost:3000/search to use the tester. Enter an account number, submit, and the raw Bloomerang response will be shown.
