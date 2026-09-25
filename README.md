# chatriv

A realtime chat platform where people stay hidden while online. Search an exact name to start talking, then delete the conversation when you are done.

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
