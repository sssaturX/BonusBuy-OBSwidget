<p align="center">
  <img src="preview.png" alt="BonusBuy widget in OBS" width="420">
</p>

<h1 align="center">BonusBuy Widget</h1>

<p align="center">
  <strong>An OBS overlay for streamers running bonus-buy sessions.</strong><br>
  Live buy-in, average multiplier, break-even target, and the current bonus — right on stream.
</p>

<p align="center">
  <img alt="Node.js 18+" src="https://img.shields.io/badge/Node.js-18%2B-3c873a?style=flat-square">
  <img alt="OBS Browser Source" src="https://img.shields.io/badge/OBS-Browser%20Source-302e31?style=flat-square">
  <img alt="MIT License" src="https://img.shields.io/badge/License-MIT-6f42c1?style=flat-square">
</p>

---

## Why it exists

During a bonus-buy stream, chat should see the session at a glance: how much is already in, which bonuses are open, what multiplier is needed to break even, and which game is spinning right now.

**BonusBuy Widget** is a small Node.js server plus an OBS page:

- **Public widget** `/` — display only. Viewers and the OBS browser source cannot edit anything.
- **Admin panel** `/admin` — the streamer or a moderator enters names, prices, and results. OBS picks up changes on its own.

Two windows, one shared state. You can update the list from a phone or a second PC while the stream is live.

## What the overlay shows

| Icon | Stat | Meaning |
| --- | --- | --- |
| Coin | **Buy-in** | Total cost of every bonus in the session |
| Scales | **To break even** | Average multiplier still needed on *unopened* bonuses to get back to zero |
| Cross | **Average X** | Average multiplier of bonuses already opened |
| Star | **Opened** | Opened bonuses vs the full list |

Under the header, the widget pins up to two best opened bonuses (by multiplier). The current row is marked with arrows:

```text
> 1. GATES OF OLYMPUS  (₽10.3k) = ₽2.5k  0.25X  <
```

A payout of `0` counts as opened if you actually typed `0`. An empty payout field means the bonus is still closed.

## How it works

```text
  ┌─────────────┐          PUT /api/state           ┌──────────────────┐
  │   /admin    │  ───────────────────────────────► │  Node.js server  │
  │  streamer   │                                   │  ADMIN_TOKEN     │
  └─────────────┘                                   │  data/state.json │
                                                    └────────┬─────────┘
                                                             │ GET /api/state
                                                             ▼
                                                    ┌──────────────────┐
                                                    │   OBS Browser    │
                                                    │   source      /  │
                                                    └──────────────────┘
```

- State lives on the server in `data/state.json`, not inside the OBS browser source.
- The public page polls about every 750 ms and refreshes without reloading the source.
- Admin saves shortly after you type.
- Offline, you can open `index.html` directly: data stays in `localStorage`, but OBS and admin will not stay in sync.

## Quick start

Requires **Node.js 18+**.

```bash
git clone https://github.com/sssaturX/BonusBuy-OBSwidget.git
cd widget

export ADMIN_TOKEN="$(openssl rand -hex 32)"
export PORT=3000

npm start
```

Then open:

| Page | URL | Who it's for |
| --- | --- | --- |
| Widget | http://localhost:3000/ | OBS, viewers, preview |
| Admin | http://localhost:3000/admin | Streamer |

The first visit to `/admin` asks for `ADMIN_TOKEN`. The token stays in the current tab only (`sessionStorage`) and **must not** be shown to viewers.

Without the server, you can still open `index.html` in a browser. That is fine for a local preview, not for a live OBS + admin setup.

## OBS setup

The sizes below keep the overlay sharp.

1. Sources → **Browser**.
2. URL — the public widget address **without** `/admin`.
3. Width **480**, height **523**.
4. FPS can stay at 30.
5. Right-click the source → Transform → **Reset Transform**.
6. Keep the source scale on the scene at **100%**.

The widget scales to the browser source, keeps aspect ratio, and centers itself. Change size in the browser source properties, not by stretching it on the scene.

| Size | Scale | Use when |
| --- | --- | --- |
| `480 × 523` | 1× | Default, sharpest |
| `960 × 1046` | 2× | Larger overlay on a big scene |

In-between sizes can slightly blur small type.

## Admin panel

From `/admin` you can:

- set the session number `BONUSBUY#`;
- pick a currency: **₽ RUB**, **$ USD**, **€ EUR**, **₸ KZT**, **₴ UAH**, **£ GBP**;
- add and remove bonuses;
- enter slot name, buy-in, and payout;
- select the current bonus with a click or **↑ / ↓**;
- move to the next field with **Enter**.

The public page hides those controls, so OBS cannot wipe the list by accident.

## VPS install

The script targets **Debian / Ubuntu**. It installs Node.js, systemd, Nginx, and HTTPS when DNS is ready.

```bash
sudo bash deploy-vps.sh
```

It will suggest an address like `widget.example.com`. Non-interactive:

```bash
sudo WIDGET_DOMAIN=widget.example.com bash deploy-vps.sh
```

Override the app port with `WIDGET_PORT` (default `3000`).

After install you get:

- widget: `https://your-domain/`;
- admin: `https://your-domain/admin`;
- admin token — **printed by the script only**, never stored in the repo.

Service logs:

```bash
journalctl -u bonus-buy-widget -f
```

## Environment

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ADMIN_TOKEN` | yes | — | Secret for writing state |
| `PORT` | no | `3000` | HTTP port |
| `HOST` | no | `0.0.0.0` | VPS deploy binds `127.0.0.1` behind Nginx |
| `DATA_FILE` | no | `data/state.json` | State file |

The server will not start without `ADMIN_TOKEN`.

## API

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/state` | public | Current widget state |
| `PUT` | `/api/state` | `Authorization: Bearer <ADMIN_TOKEN>` | Save state |
| `GET` | `/` | public | OBS page |
| `GET` | `/admin` | public page, writes need the token | Control panel |

State is JSON: bonus rows, session number, currency, and the current row index. The server trims long names, caps the list at 200 rows, and accepts only known currencies.

## Security

- The admin token comes from the environment. It is not in git.
- `PUT /api/state` without `Authorization` returns `401`.
- The public widget can only read state.
- On a VPS the token is generated with `openssl rand -hex 32` and stored in `/etc/bonus-buy-widget/widget.env` with mode `0600`.

Do not stream the `/admin` tab and do not paste the token in chat.

## Stack

One Node.js process. No framework, no database.

```text
index.html     widget markup
style.css      dark theme for slot streams
script.js      stats, admin, sync
server.js      HTTP, static files, API, JSON storage
deploy-vps.sh  Debian/Ubuntu install
```

## License

[MIT](LICENSE)
