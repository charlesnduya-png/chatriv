# chatriv

Realtime private chat with ephemeral photos, reactions, stickers, and read receipts.

## Live

- Frontend (Vercel): https://chatriv-nine.vercel.app
- GitHub: https://github.com/charlesnduya-png/chatriv

> Socket.io needs a persistent Node server. Deploy the Docker backend (Fly/Render) and set `VITE_SOCKET_URL` on Vercel to that backend URL, plus `CLIENT_URLS` on the backend to your Vercel domain.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the Socket.io server and Vite client together |
| `npm run build` | Builds the production client |
| `npm start` | Serves the built app from the server (port 3001) |

## Features

- Join with a display name
- Online people stay private until searched by exact name
- Send messages in realtime
- Delete a conversation — it disappears for both people

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in two browser windows (or one normal + one private window), join with different names, and chat.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the Socket.io server and Vite client together |
| `npm run build` | Builds the production client |
| `npm start` | Serves the built app from the server (port 3001) |
