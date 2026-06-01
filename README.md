# ScrollStop — Focus Intelligence Platform

A teen screen time research survey built for the **IRIS National Science Fair**. Participants answer a 6-step wizard about their daily app usage, sleep, mood, and focus habits. The app calculates a personalised **Focus Score Index (FSI)** and surfaces data-driven insights about the real cost of screen time.

---

## Features

- **Full-screen landing** with animated logo and hero CTA
- **6-step survey wizard** — About You → Screen Time → Apps → Sleep → Mood → Focus
- **Focus Score Index (FSI)** — weighted formula across screen time, sleep, mood, and academics
- **App hour mismatch detection** — warns if declared screen time doesn't match selected app hours
- **Personalised insights** — emoji-driven analysis with slide/shake animations
- **Cost breakdown card** — animated counter showing the real-world cost of screen time
- **Share button** — Web Share API on mobile, clipboard fallback on desktop
- Anonymous — no account or name required

---

## Tech Stack

| Layer | Technology |
|---|---|
| Server | Node.js + Express 4 |
| Templating | EJS |
| Survey UI | Single-file HTML (`scrollstop2.html`) — inline CSS & JS |
| Fonts | Syne, DM Sans (Google Fonts CDN) |
| Data | In-memory array + `submissions.json` |

---

## Getting Started

### Prerequisites

- Node.js v18+

### Install

```bash
git clone https://github.com/AgrimSinhaRoy/scrollstop.git
cd scrollstop
npm install
```

### Run

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

### Debug (VS Code)

Press **F5** — the included `.vscode/launch.json` launches the app with the Node.js debugger attached.

### Dev (auto-reload)

```bash
npm run dev
```

---

## Project Structure

```
scrollstop/
├── app.js              # Express server & routes
├── scrollstop2.html    # Main survey app (served at /)
├── public/
│   ├── css/style.css
│   └── js/main.js
├── views/              # EJS views (legacy dashboard pages)
│   ├── index.ejs
│   ├── goals.ejs
│   ├── log.ejs
│   ├── insights.ejs
│   └── partials/
├── submissions.json    # Survey responses (auto-created)
└── .vscode/
    └── launch.json     # VS Code debug config
```

---

## API

| Method | Route | Description |
|---|---|---|
| GET | `/` | Serves the survey (`scrollstop2.html`) |
| POST | `/survey/submit` | Saves a survey response |

---

## License

MIT
