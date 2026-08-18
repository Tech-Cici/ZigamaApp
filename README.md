# Zigama Banking Platform

A mobile banking app: customers sign in with their account number and PIN, see
their balances, and deposit, withdraw and transfer money. Managers and admins
sign in with email and password and get an oversight console over every
customer, account and transaction.

```
banking-platform/
├── backend/    NestJS + Prisma + PostgreSQL API
└── mobile/     Expo (React Native) app — customer and staff, one codebase
```

**Versions:** Expo **SDK 54** (`expo@54.0.36`, `expo-router@6`, React 19.1,
React Native 0.81.5). The SDK is pinned to 54 deliberately — Expo Go installs
from the Play Store and App Store only run the SDK they were built against, so
the project has to match the Expo Go you can actually install. Upgrading the SDK
here without upgrading Expo Go on the device will produce a version-mismatch
error on launch.

---

## Quick start

Four terminals, in this order. The first two are the database and API.

**1. Database** (local Prisma Postgres dev server)

```bash
cd backend && npm run db:dev
```

**2. Migrate and seed** (once, in a second terminal)

```bash
cd backend && npm run db:migrate && npm run db:seed
```

**3. API**

```bash
cd backend && npm run start
```

**4. Mobile app**

```bash
cd mobile && npm start
```

Then press `i` for the iOS simulator, `a` for Android, `w` for the browser, or
scan the QR code with Expo Go on a real phone.

### Demo logins

Created by `npm run db:seed`. All data is fictional.

| Role | Sign in with | Credentials |
|---|---|---|
| Customer | Account number + PIN | `1000000001` / `1234` |
| Customer | Account number + PIN | `1000000002` / `2345` |
| Customer | Account number + PIN | `1000000003` / `3456` |
| Customer | Account number + PIN | `1000000004` / `4567` |
| *Awaiting approval* | Account number + PIN | `1000000005` / `5827` |
| *Awaiting approval* | Account number + PIN | `1000000006` / `6193` |
| Admin | Email + password | `admin@zigama.test` / `Admin@12345` |
| Manager | Email + password | `manager@zigama.test` / `Manager@12345` |

Account `1000000001` also has a second (savings) account, `2000000001`, so you
can try transfers between your own accounts.

The last two are seeded **unapproved on purpose** — try signing in as one to see
the hold, then sign in as the manager and clear them from the Approvals tab.

---

## What each role can do

| | Customer | Manager | Admin |
|---|---|---|---|
| See own balances and history | ✅ | — | — |
| Open a customer account | ❌ | ❌ | ✅ |
| Approve / reject an application | ❌ | ✅ | ❌ |
| Transfer between accounts | ✅ | ❌ | ✅ |
| Deposit / withdraw directly | ❌ | ❌ | ✅ (teller only) |
| Request a cash or mobile money movement | ✅ | ❌ | ❌ |
| Confirm a cash movement | ❌ | ✅ | ❌ |
| Run reconciliation | ❌ | ❌ | ✅ |
| See platform statistics | ❌ | ✅ | ✅ |
| See all customers and balances | ❌ | ✅ | ✅ |
| See every transaction | ❌ | ✅ | ✅ |
| Freeze / unfreeze accounts | ❌ | ❌ | ✅ |
| Activate / deactivate users | ❌ | ❌ | ✅ |
| Read the audit log | ❌ | ❌ | ✅ |

Managers are deliberately read-only: oversight without the ability to change
anyone's money.

---

## How money is handled

These are the decisions that matter most in a banking app.

**Money is never a float.** Balances and amounts are stored as `BigInt` in
*minor units* (1 RWF = 100). Binary floating point cannot represent `0.10`
exactly, and that error compounds over a ledger. Parsing happens in one place
(`backend/src/common/money.ts`) and works on the *string* form of the input, so
a float can never leak in. Amounts cross the API as decimal strings
(`"1500.50"`), which is also what a client wants to render.

**Every balance change is a locked, atomic transaction.** A deposit, withdrawal
or transfer opens a database transaction, takes a `SELECT ... FOR UPDATE` row
lock on the account, re-reads the balance under that lock, then writes both the
new balance and its ledger row. Concurrent withdrawals therefore queue instead
of interleaving, so the balance cannot go negative and money cannot be spent
twice.

Isolation is Postgres' default READ COMMITTED, which is correct *because* of the
explicit row lock. SERIALIZABLE would add nothing on top of it and would instead
abort competing transactions with `40001`, turning ordinary contention into
failed requests.

**Transfers are double-entry.** One transfer writes two ledger rows — a
`TRANSFER_OUT` on the sender and a `TRANSFER_IN` on the recipient — sharing a
`transferGroupId`. Both commit or neither does. Locks are always taken in sorted
account-id order so two simultaneous opposite transfers cannot deadlock.

**Lock waits are bounded.** Each transaction sets `lock_timeout = 1s` and
retries with jittered backoff. An unbounded wait holds its connection open, and
some managed Postgres services kill such connections outright — which surfaces
as an opaque failure rather than something retryable.

**The ledger is verifiable.** Every account's balance must equal the sum of its
ledger entries. The seed asserts this before finishing, and the test suite
re-checks it after running concurrent traffic.

---

## Onboarding: how a customer account is created

There is **no self-registration**. A customer account is opened by staff, under
maker-checker control:

```
ADMIN creates  →  PENDING  →  MANAGER approves  →  APPROVED (can sign in)
                           ↘  MANAGER rejects   →  REJECTED (told why)
```

**An administrator creates, a manager approves, and neither can do both.**
Self-approval is blocked separately, so the rule still holds if the roles are
ever widened. This is the control that stops one member of staff creating a
fabricated "ghost" account and using it to move money — no single person can
bring a usable account into existence.

The manager's queue shows who opened each application, and the approve button is
disabled on their own, so the separation is visible in the product rather than
only enforced by the API.

Three details worth knowing:

- **`AccountStatus.PENDING` is the default.** Accounts fail closed. Approval is
  what flips an account to `ACTIVE`, and only `ACTIVE` accounts can transact —
  see the allow-list note below.
- **Account numbers are random, not sequential.** Sequential numbers would let
  anyone holding one guess their neighbours', and the account number is the
  lookup key for transfers. New numbers start at 3-9; the seeded demo range
  (1xx/2xx) cannot collide. The unique index is the real guarantee.
- **Obvious PINs are refused** — a repeated digit (`0000`) or a run (`1234`,
  `9876`). Note this means the seeded demo PINs would not pass creation; they
  exist only because the seed writes them directly.

### A bug worth recording

`assertOperable` in the ledger originally rejected `FROZEN` and `CLOSED` by name
and allowed everything else. When `PENDING` was added it fell into the "else"
branch, and **unapproved accounts could receive money**. The test suite caught
it. It is now an allow-list — only `ACTIVE` passes — because enumerating the
states that may *not* transact is a standing invitation for the next new state
to be permitted by accident.

### A customer's account status at login

A pending or rejected applicant is told what is happening, but **only after
their PIN verifies**. Before that they get the same generic `Invalid
credentials` as anyone else, so account numbers still cannot be enumerated by
anyone who does not already hold the PIN.

Not implemented: forced PIN change on first login, and HTTP-level rate limiting.

---

## Moving money

Nothing moves the instant a button is tapped. Every cash movement is a
`MoneyRequest` on one state machine:

```
raised -> PENDING -> PROCESSING -> COMPLETED
                              \-> REJECTED / CANCELLED / EXPIRED / UNRESOLVED
```

Four rails share it, differing only in **what counts as confirmation**:

| Rail | Confirmed by |
|---|---|
| Branch cash deposit | a manager checking the slip against branch records |
| Branch cash withdrawal | a teller recording that cash was handed over |
| Mobile money deposit | a signed provider callback |
| Mobile money payout | a signed provider callback |

Customers cannot call the teller endpoints at all — `POST /transactions/deposit`
and `/withdraw` are ADMIN-only. A customer able to deposit from their phone can
invent a balance.

### Deposits and withdrawals are not symmetric

This is the part that trips people up, and getting it backwards loses real money:

- **A deposit writes no ledger entry until it is confirmed.** The money is not
  ours until it has actually arrived. A pending deposit shows as pending and
  affects nothing.
- **A withdrawal debits immediately and holds it.** Otherwise the same balance
  could back three pending withdrawals and all three get collected.

Undoing a held withdrawal writes a compensating `REVERSAL_CREDIT` entry. The
ledger is append-only — the attempt stays in the customer's history, and the
balance still equals the sum of its entries.

### The unknown payout

A payout whose outcome we never learn goes to `UNRESOLVED` and is **never
retried automatically**. Retrying a transfer that may already have succeeded is
how you pay someone twice. The money stays held, and only reconciliation — which
asks the provider directly — is allowed to decide. A provider that cannot be
reached reports `UNKNOWN`, never `FAILED`, for the same reason.

### Idempotency, in three independent layers

| Layer | Mechanism | Stops |
|---|---|---|
| Client | `idempotencyKey` unique | double-taps, retried requests |
| Webhook | `providerEventId` unique | provider replays |
| Ledger | compare-and-swap on status + unique `transactionId` | two callbacks racing |

The third is the actual guarantee: settling does `UPDATE ... WHERE status IN
(open states)`, so of two simultaneous deliveries exactly one matches a row. The
first two layers are cheap early exits.

Callbacks are also checked against the **recorded** amount. A correctly signed
payload reporting a different figure is refused — a provider that disagrees with
us is either buggy or the body was tampered with.

### Webhook handling

Signatures are HMAC-SHA256 over the **raw request bytes** (`rawBody: true` in
`main.ts`). Re-serialising parsed JSON changes key order and whitespace, so every
signature would fail. Comparison is timing-safe.

An unverified payload is never queued for retry — anyone can POST to a public
webhook URL, and queueing unsigned work lets a stranger fill the queue. Verified
callbacks always get a 200, even if processing failed: providers read non-2xx as
"send it again", so failures are retried internally instead with backoff, and
dead-lettered after 5 attempts.

### Reconciliation

A sweep runs every 5 minutes (`ReconciliationService`) and on demand via
`POST /api/admin/reconciliation/run`. It drains webhook retries, gives back
uncollected branch withdrawals, asks the provider about anything in flight too
long, and recomputes every balance from its ledger.

Mismatches are **reported, not repaired**. An automatic fix would hide the bug
that caused the drift and could itself move money wrongly.

### Provider setup

`PAYMENT_PROVIDER=mock` is the default. The mock needs no credentials and no
public URL, and it deliberately does not fire callbacks on a timer — tests and
demos post them, which is what makes replay and out-of-order delivery
exercisable. Amounts ending `.01` fail and `.02` never resolve, so you can drive
each path.

The MTN adapter is written and wired but inactive until you set
`PAYMENT_PROVIDER=mtn` plus `MTN_SUBSCRIPTION_KEY`, `MTN_API_USER`,
`MTN_API_KEY` and `MTN_ENVIRONMENT`. Those need registering by hand on MTN's
portal, and their sandbox cannot reach `localhost`, so webhooks need a tunnel.

---

## Authentication

Customers authenticate with account number + PIN; staff with email + password.
Both are stored only as bcrypt hashes. Five failed attempts lock the account for
15 minutes. Login failures return one generic message, and unknown accounts are
still compared against a dummy hash, so response timing and wording cannot be
used to discover which account numbers exist.

The JWT guard verifies the token signature and does **not** query the database
per request. An earlier version re-read the user every time so deactivation took
effect instantly, but that doubled connection demand on every authenticated
request and made requests fail while merely authenticating. Freshness is kept
where it matters instead:

- money movement re-reads the owner's `isActive` **inside the row lock it
  already takes**, so a deactivated or frozen account cannot move money even
  with a valid token, at no extra cost;
- admin mutations re-check the actor before acting.

The residual tradeoff: a deactivated user can still *read* their own data until
their token expires (`JWT_EXPIRES_IN`, 12h by default). Shorten that if you need
tighter revocation.

Tokens are stored in the device keychain via `expo-secure-store`. The web build
falls back to `localStorage`, which is weaker — treat web as a development and
demo convenience, not a way to ship a banking client.

---

## Configuration

### Backend (`backend/.env`, see `.env.example`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Used by the Prisma CLI for migrations. |
| `DIRECT_DATABASE_URL` | Used by the app at runtime. |
| `DB_POOL_MAX` | node-postgres pool size (default 5). |
| `JWT_SECRET` | Signing key. Generate a long random value. |
| `JWT_EXPIRES_IN` | Token lifetime, default `12h`. |
| `PORT` | API port, default 3000. |
| `PAYMENT_PROVIDER` | `mock` (default) or `mtn`. |
| `PAYMENT_WEBHOOK_SECRET` | HMAC secret provider callbacks are signed with. |

Two database URLs because Prisma 7 connects through a **driver adapter** that
speaks plain Postgres over TCP and cannot open the `prisma+postgres://` URL the
local dev server prints. `DIRECT_DATABASE_URL` holds the plain `postgres://`
form. Against a hosted Postgres (Supabase, Neon, RDS, Docker) both are the same
value and `DIRECT_DATABASE_URL` can be deleted.

Note that the `connection_limit` query parameter often seen in `DATABASE_URL` is
read by Prisma's own engine and is **ignored** by the driver adapter, which is
backed by node-postgres and sized by `max`. Use `DB_POOL_MAX`.

### Mobile

The app derives the API host from the Metro dev server, so it works on a real
phone over Wi-Fi with no hand-edited IP address (`localhost` on a phone means
the phone itself). Override when the API is elsewhere:

```bash
EXPO_PUBLIC_API_URL=https://api.example.com/api npm start
```

---

## API

All routes are under `/api`. Everything except the two login routes requires
`Authorization: Bearer <token>`.

| Method | Route | Who |
|---|---|---|
| POST | `/auth/login` | public — customer (account number + PIN) |
| POST | `/auth/staff/login` | public — staff (email + password) |
| GET | `/auth/me` | any signed-in user |
| GET | `/accounts/dashboard` | customer |
| GET | `/accounts` | customer |
| GET | `/accounts/lookup/:accountNumber` | any — confirms a recipient, name masked |
| GET | `/accounts/:id` | owner or staff |
| POST | `/transactions/deposit` | owner or admin |
| POST | `/transactions/withdraw` | owner or admin |
| POST | `/transactions/transfer` | owner or admin |
| GET | `/transactions` | own entries; staff see all |
| GET | `/admin/stats` | manager, admin |
| GET | `/admin/users` | manager, admin |
| GET | `/admin/users/:id` | manager, admin |
| GET | `/admin/transactions` | manager, admin |
| GET | `/admin/audit-logs` | admin |
| POST | `/admin/customers` | **admin only** — opens a customer account |
| GET | `/admin/customers/pending` | manager, admin — approval queue |
| POST | `/admin/customers/:id/approve` | **manager only** |
| POST | `/admin/customers/:id/reject` | **manager only** — reason required |
| GET | `/health` | public — liveness, also wakes an idled instance |
| POST | `/movements/deposits/branch` | customer — declare a branch cash deposit |
| POST | `/movements/withdrawals/branch` | customer — reserve cash to collect |
| POST | `/movements/deposits/momo` | customer — mobile money collection |
| POST | `/movements/withdrawals/momo` | customer — mobile money payout |
| GET | `/movements/mine` | customer |
| POST | `/movements/:id/cancel` | customer — own request only |
| GET | `/movements/pending` | manager, admin |
| POST | `/movements/:id/approve` | **manager only** |
| POST | `/movements/:id/reject` | **manager only** |
| POST | `/payments/webhooks/:provider` | public — HMAC-signed provider callback |
| POST | `/admin/reconciliation/run` | **admin only** |
| GET | `/admin/reconciliation/unresolved` | manager, admin |
| GET | `/admin/reconciliation/dead-letters` | manager, admin |
| GET | `/admin/reconciliation/webhooks` | manager, admin |
| PATCH | `/admin/accounts/:id/status` | admin |
| PATCH | `/admin/users/:id/status` | admin |

Recipient lookup masks the account holder's name (`G**** U****`). Returning it
in full would let anyone walk the 10-digit account-number space and harvest
customer names.

---

## Testing

Four end-to-end suites, **148 checks total**, covering auth, registration,
validation, authorization boundaries, freeze behaviour, concurrency and ledger
reconciliation.

With the API running and the database seeded:

```bash
cd backend && npm run test:all
```

Or individually: `npm test` (ledger, 45), `npm run test:onboarding` (40),
`npm run test:movements` (33), `npm run test:payments` (30).

The payment suite needs the same webhook secret the API is using:

```bash
PAYMENT_WEBHOOK_SECRET="$(grep '^PAYMENT_WEBHOOK_SECRET' .env | cut -d'\"' -f2)" npm run test:payments
```

**The ledger concurrency check** fires 12 simultaneous withdrawals each worth a
sixth of the balance: exactly 6 succeed, the other 6 are cleanly rejected as
insufficient funds, the balance never goes negative, and every account still
reconciles against its ledger afterwards.

**The onboarding check** covers the whole approval workflow: that an admin can
create but not approve, a manager can approve but not create, nobody approves
their own work, a pending customer can neither sign in nor receive money, a
rejected one is told why, and no partial user records survive a failed create.

**The movement suite** proves deposits credit only on confirmation, withdrawals
reserve at request time, and rejection or cancellation reverses exactly once.

**The payment suite** covers the cases that actually bite: a replayed webhook
credits once, three simultaneous identical deliveries credit once, a tampered
body fails verification, a signed callback with the wrong amount is refused, a
failed payout refunds exactly once, and an unmatched callback is retried rather
than dropped.

All suites accept an `API_URL` environment variable, so you can point them at a
server on another port without stopping the one you are running.

Run the suites a few seconds apart. Back to back, the second one can fail while
the local WASM database recovers from the first one's concurrent traffic — see
below.

---

## Known limitations

- **The local `prisma dev` server has a low connection ceiling.** It is Postgres
  17.5 compiled to WebAssembly (`wasm32-unknown-linux-gnu`), not a native
  install, and it starts dropping connections above roughly half a dozen — which
  is why `DB_POOL_MAX` defaults to 5. Verified as a server limit, not an
  application or ORM one: raw `pg` shows identical behaviour at the same
  concurrency. Write transactions retry transient drops
  (`backend/src/common/db-retry.ts`), which absorbs most of it, but ~5
  simultaneous signups will still see one or two fail locally. A real Postgres
  handles them without trouble; raise `DB_POOL_MAX` when you point at one.
- **`npm run db:seed` wipes everything**, including accounts opened through
  registration. It is a reset-to-known-demo-state tool, and the reset has to be
  total — a partial reset leaves accounts holding a balance with no ledger rows,
  which is exactly the invariant the seed asserts.
- **No refresh tokens.** Sessions last `JWT_EXPIRES_IN` and then require signing
  in again.
- **No rate limiting at the HTTP layer.** Per-account lockout exists, but a
  reverse proxy or `@nestjs/throttler` should front a real deployment.
- **The app was verified on web and via the API suite, not on a simulator** —
  this machine has no full Xcode install. See below.
- Transaction history is paginated by the API but the app currently loads only
  the first page (50 entries).

---

## Running on a simulator

The iOS simulator needs a full Xcode install (the command-line tools alone are
not enough). Install Xcode from the Mac App Store, then:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

Then `cd mobile && npm start` and press `i`. For Android, install Android Studio
and press `a`. Neither is needed to run on a physical phone with Expo Go, or in
the browser with `w`.
