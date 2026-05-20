# 🔭 Future Sight

A self-hosted, household-shared **investment and wealth scenario planner**. Project net worth over time, model "what-if" events (lump sums, withdrawals, rate changes), and compare alternative scenarios side-by-side. Built for couples and families who've outgrown spreadsheets.

> Inspired by the [`homedash`](https://github.com/breezinstein/homedash) project for self-hosted homelab UX.

---

## ✨ Features

### 🏠 Household collaboration
- Multi-user with role-based access (**owner**, **editor**, **viewer**)
- Shared plans, activity log of who changed what
- Lightweight email + password auth, sessions stored in SQLite

### 📊 Scenario planning
- One **base** scenario per household + unlimited "what-if" clones
- Clone any scenario to fork your future
- Side-by-side **comparison view** with overlay charts and diff tables at 5/10/20-year horizons

### 💰 Buckets & contributions
- Investment "pots" with configurable expected return, currency, target amount, and target date
- Variable contribution schedules over time (monthly / quarterly / annual)
- 16 Lucide icons for visual identification

### 📅 Event-driven modelling
- **Cash-flow events**: one-off deposits, withdrawals, contribution changes
- **Rate-change events**: override a bucket's return from a date forward
- **Recurring events** with cadence + end date
- Toggle events on/off for sensitivity testing without deleting

### 📈 Historical tracking
- Record actual balances per bucket over time
- Compare projected vs. actual on the dashboard with drift indicator
- CSV import of historical actuals

### 🌍 Multi-currency
- Each bucket has its own currency
- Live FX conversion to the plan's base currency via **[frankfurter.app](https://frankfurter.app)** (ECB-backed, no API key)
- Local cache with 6-hour TTL on latest rates; historical rates cached forever

### 🎨 Design
- Dark-first, Linear-inspired aesthetic
- Inter typography with tabular figures throughout
- Generated UI from a Stitch design brief; tokens locked in `src/index.css`

---

## 🚀 Quick start

### Option 1: Docker Compose (recommended)

```bash
git clone <repo-url> future-sight
cd future-sight
# Optional: generate a secure session secret
echo "SESSION_SECRET=$(openssl rand -hex 32)" > .env
docker compose up -d --build
```

Open <http://localhost:3002> and create your first account.

### Option 2: Local development

```bash
npm install
npm run dev
```

This starts both:
- Backend API on http://localhost:3002
- Vite dev server on http://localhost:5174 (with proxy to the API)

Open <http://localhost:5174>.

### Option 3: Production build (no Docker)

```bash
npm install
npm run build
NODE_ENV=production PORT=3002 SESSION_SECRET=<random> npm start
```

Open <http://localhost:3002>.

---

## 🛠 Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 19, TypeScript, Tailwind CSS 4, Vite |
| Charts | Recharts |
| Forms | react-hook-form + zod |
| Icons | lucide-react |
| Dates | date-fns |
| Backend | Node 20, Express 5 (ESM) |
| Database | SQLite via `better-sqlite3` (WAL mode) |
| Auth | bcrypt + express-session + connect-sqlite3 |
| FX | [frankfurter.app](https://frankfurter.app) (ECB-backed) |
| Testing | Vitest |
| Deploy | Single Docker container, multi-stage build |

---

## 🗄️ Data model

```
users
plans (created_by) ──┬── plan_members (role)
                     └── scenarios (is_base, cloned_from)
                          ├── buckets (currency, return, target)
                          │    ├── contribution_schedules
                          │    └── actuals
                          └── events (cash-flow & rate-change)
fx_cache    audit_log
```

All updates to plan / scenario data bump a `version` counter on the plan for cheap polling-based sync between household members (homedash-style).

---

## 🔐 Security notes

- Passwords hashed with **bcrypt** (cost 12).
- Sessions stored server-side in `data/sessions.db`. The cookie holds only an opaque session ID.
- Set `TRUST_PROXY=true` when running behind a TLS-terminating reverse proxy so secure cookies are issued.
- Lock down new account registration with `ALLOW_REGISTRATION=false` (the bootstrap user can still be created when the user table is empty).
- The frankfurter.app API is the only external dependency. Disable network egress if you don't need multi-currency.

---

## 🧪 Tests

```bash
npm test                # run the projection engine tests
npm run test:watch      # watch mode
```

The projection engine has 11 tests covering compounding, contributions, deposits, withdrawals, rate changes, and milestone detection.

---

## 📜 API reference (selected)

```
POST   /api/auth/signup            # create user + default plan + base scenario
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/plans                  # list my plans
POST   /api/plans                  # create plan
GET    /api/plans/:id              # plan + members + scenarios
GET    /api/plans/:id/activity     # audit log
GET    /api/plans/:id/members
POST   /api/plans/:id/members
POST   /api/plans/:id/compare      # multi-scenario comparison

GET    /api/plans/:id/scenarios
POST   /api/plans/:id/scenarios
GET    /api/scenarios/:id
PATCH  /api/scenarios/:id
DELETE /api/scenarios/:id
POST   /api/scenarios/:id/clone
GET    /api/scenarios/:id/projection
GET    /api/scenarios/:id/export?type=actuals|events|contributions

POST   /api/scenarios/:id/buckets
GET    /api/buckets/:id
PATCH  /api/buckets/:id
DELETE /api/buckets/:id
POST   /api/buckets/:id/contributions
POST   /api/buckets/:id/actuals
POST   /api/buckets/:id/actuals/import

POST   /api/scenarios/:id/events
PATCH  /api/events/:id
DELETE /api/events/:id

GET    /api/fx/currencies
GET    /api/fx/rate?base=USD&quote=EUR
```

---

## 📁 Project layout

```
future-sight/
├── server/
│   ├── index.js              # Express entry
│   ├── db/
│   │   ├── database.js       # better-sqlite3 setup + WAL
│   │   └── schema.sql        # tables, indexes, triggers
│   ├── lib/
│   │   ├── auth.js           # bcrypt, session middleware
│   │   ├── audit.js          # audit log writer
│   │   ├── projection.js     # projection engine
│   │   ├── fx.js             # frankfurter.app + cache
│   │   └── csv.js            # tiny CSV parser/emitter
│   └── routes/               # auth, plans, scenarios, buckets, events, ...
├── src/
│   ├── App.tsx               # router
│   ├── main.tsx              # ReactDOM + providers
│   ├── index.css             # Tailwind 4 @theme tokens
│   ├── api/                  # typed fetch client
│   ├── components/           # AppLayout, Sidebar, BucketEditor, EventEditor, ...
│   ├── context/              # AuthContext, ToastContext
│   ├── hooks/
│   ├── lib/format.ts         # currency/date helpers
│   ├── pages/                # Dashboard, ScenarioDetail, ScenarioCompare, ...
│   └── types.ts              # shared types
├── tests/
│   └── projection.test.js    # projection engine tests
├── data/                     # SQLite DB + sessions DB (mounted volume in Docker)
├── Dockerfile
├── docker-compose.yml
└── entrypoint.sh
```

---

## 🗺️ Roadmap / nice-to-haves

These are intentionally out of scope for v1 but would be useful next steps:

- [ ] Email-based household invites (vs. requiring the member to sign up first)
- [ ] CSV column-mapping wizard (currently expects fixed column names)
- [ ] Server-Sent Events for live sync between concurrent editors
- [ ] Daily-snapshot backups with retention policy
- [ ] Inflation toggle (real vs. nominal projections)
- [ ] Tax modelling
- [ ] Bank/brokerage account sync (explicitly out of scope per design)

---

## 📄 License

MIT.
