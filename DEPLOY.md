# Deploying Zigama and building an APK

The goal: a hosted API on HTTPS, a real Postgres, and an APK you can send to
anyone. Everything below is free — the only thing that ever costs money is a
Google Play listing ($25, one time), which you do **not** need to share an APK
directly.

Work through it in order. Steps 1–3 need accounts, so they are yours to do; the
project is already prepared for them.

---

## Why the API has to be hosted

An APK contains the *app*, not the *backend*. Once the app is on someone else's
phone, `localhost:3000` means *their* phone, and your laptop is unreachable. The
API and database therefore have to live somewhere public.

Hosting on HTTPS also solves a second problem for free: Android blocks plain
HTTP in release builds, so an APK pointed at `http://192.168.x.x:3000` would
refuse to connect even on the right Wi-Fi.

---

## 1. Create a Postgres database (Neon)

1. Sign up at **neon.tech** — no card required.
2. Create a project. Any region; pick one near you.
3. Copy the connection string. It looks like:

   ```
   postgresql://USER:PASSWORD@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
   ```

Keep it somewhere safe for step 2. **Do not commit it.**

Nothing in the code changes for this. The app already talks to any standard
Postgres through the driver adapter — the local WASM server was only ever a
development convenience.

---

## 2. Deploy the API (Render)

Render deploys from a Git repository, so the project needs to be on GitHub
first.

**Remove the nested repository first.** `create-expo-app` initialised its own
`.git` inside `mobile/`. If you leave it, `git init` at the root treats `mobile/`
as a nested repo and silently commits it as an empty directory reference — you
would push a project with no app in it:

```bash
cd "/Users/ciara/Documents/Zigama App/banking-platform"
rm -rf mobile/.git
```

Then create the real repository:

```bash
git init && git add -A && git commit -m "Zigama banking platform"
```

Confirm the app actually made it in before pushing:

```bash
git ls-files mobile | head
```

That should list `mobile/app/...` files. If it prints nothing, the nested `.git`
is still there.

Then create an empty repo on GitHub and push to it.

> Check `backend/.env` is ignored before pushing — it holds your JWT secret.
> `backend/.gitignore` already covers it, but confirm with `git status`.

In Render:

1. **New → Web Service**, connect the GitHub repo.
2. **Root directory:** `backend`
3. **Build command:** `npm install && npm run build`
4. **Start command:** `npm run start:deploy`
5. **Instance type:** Free
6. **Health check path:** `/api/health`

### Environment variables to set in Render

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string from step 1 |
| `JWT_SECRET` | a long random string — generate one below |
| `DB_POOL_MAX` | `10` |
| `NODE_ENV` | `production` |

Generate the secret locally:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Leave `DIRECT_DATABASE_URL` unset. It only exists for the local dev server,
whose `prisma+postgres://` URL the driver cannot open; with a normal Postgres
one variable does both jobs.

`start:deploy` runs `prisma migrate deploy` before booting, so the schema is
created on the first deploy and kept current on every one after.

When it goes live, check:

```
https://your-service.onrender.com/api/health
```

You want `{"status":"ok","database":"reachable",...}`.

---

## 3. Seed the production database

Run this **from your laptop**, pointed at Neon — the seed is a dev dependency
and is not installed on the server:

```bash
cd backend
DIRECT_DATABASE_URL="<your-neon-connection-string>" npm run db:seed
```

This creates the staff logins, the demo customers, and the two applications
waiting for manager approval.

> It wipes and rebuilds everything. Run it once, before anyone starts using the
> deployment.

---

## 4. Build the APK

Point the build at your API by editing the `preview` profile in
`mobile/eas.json` — replace `REPLACE-ME`:

```json
"EXPO_PUBLIC_API_URL": "https://your-service.onrender.com/api"
```

Note the `/api` suffix. Then:

```bash
cd mobile
npx eas-cli@latest login          # free Expo account, create at expo.dev
npx eas-cli@latest build --platform android --profile preview
```

EAS generates and stores a signing keystore the first time. **Keep it** — losing
it means you can never update this app under the same Play Store listing.

The build runs on Expo's servers (free tier queues) and finishes with a download
link. Send that link to anyone; opening it on an Android phone installs the app.
They will need to allow "install from unknown sources" once.

### Building locally instead

If you would rather not use an Expo account, and you have the Android SDK:

```bash
cd mobile
EXPO_PUBLIC_API_URL="https://your-service.onrender.com/api" npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
```

The APK lands in `android/app/build/outputs/apk/release/`. You will need to
create and manage your own keystore for a distributable build. Java 17 is
already installed on this machine; the Android SDK is the remaining piece.

---

## The cold start, and how to live with it

Render's free tier idles a service out after about 15 minutes. The next request
then takes 30–60 seconds while it boots.

The app already handles this:

- it pings `/api/health` on launch, so the server starts waking while the user
  is still reaching for their PIN;
- the first request gets a 75-second budget instead of 15;
- if it still times out, the message says the server is waking rather than
  something generic.

For a live demo, open the health URL in a browser a minute beforehand and it
will be warm. If you need it always-on, Render's paid tier is about $7/month —
worth it only while you are actively showing the project to people.

Neon also autosuspends, but wakes in roughly a second, so it is not worth
worrying about.

---

## What is deliberately not here

- **Play Store submission.** Needs the $25 one-time registration and an AAB
  rather than an APK — the `production` profile in `eas.json` already builds
  one when you want it.
- **A custom domain.** The `onrender.com` subdomain is HTTPS already, which is
  all the app needs.
- **Log aggregation, metrics, backups.** Render and Neon both give you enough
  of each on the free tier for a portfolio deployment.

---

## Quick checklist

- [ ] Neon project created, connection string copied
- [ ] `mobile/.git` removed, `git ls-files mobile` lists the app
- [ ] Code pushed to GitHub, `.env` **not** committed
- [ ] Render web service created, root directory `backend`
- [ ] Four environment variables set
- [ ] `/api/health` returns `status: ok`
- [ ] Production database seeded from your laptop
- [ ] `EXPO_PUBLIC_API_URL` set in `mobile/eas.json`
- [ ] APK built and installed on a phone
- [ ] Signed in as `1000000001` / `1234`
