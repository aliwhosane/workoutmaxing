# Shipping Workout Maxing

A step-by-step guide to getting the app onto the App Store and Google Play.

Work through **Part 1 first** — those are things that will stop a submission
dead, and two of them need decisions only you can make.

---

## Part 1 — Blockers

### 1.1 Built-in training plans — decided

**Resolved 2026-09-01: only the generic plans ship.**

The named, authored ones — 5/3/1 (×2), StrongLifts, GreySkull, nSuns, GZCLP,
PHUL and PHAT — are removed from `mobile/src/data/programs.ts`. Wendler, Norton,
Campbell and Hadim all sell books, apps or coaching built on that material, and
republishing it under their names inside a distributed app is a different act
from following it yourself. A takedown would land on the app, not on the plan.

Six remain, none of which any single author owns: Novice LP, PPL, Upper/Lower,
Madcow 5×5, Texas Method and Minimalist Full Body.

Users who follow a named plan can still bring it in through **Import a plan**,
which is the point of that feature. The schema is unchanged, so a licensed
program later drops in as data with no code change.

The progression engine keeps its `gzclp_t1/t2/t3` schemes. Those are generic
progression rules reachable by any imported program, and the identifiers are
internal — no scheme name is ever shown to a user.

### 1.2 Server over HTTPS — done

Live at `https://u9yegyk6n2.execute-api.us-east-1.amazonaws.com` (Lambda behind
a Function URL); `/health` returns `{"ok":true}`. `API_BASE_URL` in `eas.json`
points both `preview` and `production` at it, and `eas config` was checked to
confirm the production profile resolves that value rather than localhost.

### 1.3 Publish a privacy policy

Both stores require a public URL before they will accept a submission, and
Apple additionally requires one for any app touching HealthKit.

A draft written against what the app actually does is in
[`docs/PRIVACY.md`](./PRIVACY.md). Fill in the contact address, have it reviewed,
and host it anywhere public.

### 1.4 Developer accounts

| | Cost | Notes |
|---|---|---|
| Apple Developer Program | $99/year | Enrolment can take 24–48h, longer for a company |
| Google Play Console | $25 once | Personal accounts now need identity verification, which takes days |

Start both now — the waiting is the slow part.

---

## Part 2 — Already done

You do not need to do any of this; it is recorded so you know it is handled.

- **Account deletion**, as Apple requires. `DELETE /account` removes synced rows,
  device records and the account itself, without a table scan; verified against
  the live table across multiple write batches, and idempotent on repeat.
- **R8 minification enabled for release builds**, so what you test locally is
  what the store ships. An APK with minification off can pass every local check
  and then fail in production, because R8 strips code that is only reached
  reflectively.
- App icon, adaptive icon, monochrome icon, splash and favicon — all generated
  from `mobile/scripts/generate-logo.py`, so they can be regenerated at any size.
- `version` 1.0.0, iOS `buildNumber` 1, Android `versionCode` 1.
- `ITSAppUsesNonExemptEncryption: false`, so App Store Connect stops asking the
  export-compliance question on every upload. This is accurate: the app uses only
  standard TLS, which is exempt. Re-check it if you ever add your own crypto.
- `minSdkVersion` 26, required by Health Connect.
- Health Connect permissions declared, matching exactly what the code requests.
- **Sign in with Apple is implemented.** This matters: App Store Review rejects
  apps that offer Google sign-in without also offering Apple's.
- `eas.json` with development, preview and production profiles.

---

## Part 3 — Apple, step by step

Values you will be asked for, all of them already fixed by the project:

| Field | Value |
|---|---|
| Bundle ID | `co.workoutmaxing.app` |
| App name | Workout Maxing |
| Version | 1.0.0 |
| Primary category | Health & Fitness |
| Price | Free |

### 3.1 Developer portal — the Identifier only

**You do not create certificates or provisioning profiles by hand.** EAS makes
the distribution certificate and the profile on the first build and stores
them; making your own first is the usual way to end up with a mismatched pair.
Say yes when it offers.

The one thing worth doing by hand is the App ID, because its capabilities have
to match the entitlements in `app.json` or the build fails to sign.

1. developer.apple.com → **Certificates, Identifiers & Profiles** → **Identifiers** → **+**
2. **App IDs** → **App**
3. Description: `Workout Maxing` (internal only; letters, numbers and spaces)
4. Bundle ID: **Explicit**, exactly `co.workoutmaxing.app`
5. Tick exactly two capabilities, and nothing else:
   - **HealthKit** — matches `com.apple.developer.healthkit` in `app.json`
   - **Sign in with Apple** — leave it as *Enable as a primary App ID*
6. Register.

Anything ticked here that the app does not use has to be justified at review,
which is why background modes and push are deliberately absent.

Your **Team ID** is on **Membership details** — ten characters, like `A1B2C3D4E5`.

### 3.2 App Store Connect — create the record

appstoreconnect.apple.com → **Apps** → **+** → **New App**

| Field | What to enter |
|---|---|
| Platforms | iOS |
| Name | `Workout Maxing` — must be unique across the whole App Store; if it is taken you are told immediately |
| Primary language | English (U.S.) |
| Bundle ID | pick `co.workoutmaxing.app` from the list — it appears only after 3.1 |
| SKU | any private string, never shown to anyone: `workout-maxing-ios` |
| User Access | Full Access |

Once created, **App Information** shows an **Apple ID** — a long number. That
is `ascAppId` in `eas.json`.

### 3.3 Fill in `eas.json`

Under `submit.production.ios`, replace the three placeholders:

- `appleId` — the email you sign in to Apple with
- `ascAppId` — the number from 3.2
- `appleTeamId` — from Membership details

None of the three is a secret; they identify, they do not authenticate.

For submission itself, prefer an **App Store Connect API key** over your Apple
ID password: Team → **Users and Access** → **Integrations** → **App Store
Connect API** → **+**, role *App Manager*. You download the `.p8` exactly once.
It avoids the two-factor prompts that make `eas submit` fail halfway.
**Keep it out of the repo** — `.gitignore` already covers `secrets/`.

### 3.4 Build and upload

    cd mobile
    npm run build:ios
    npm run submit:ios

The `cd` matters: `eas-cli` is a dependency of `mobile/`, so `npx eas` from the
repository root fails with "could not determine executable to run". The npm
scripts exist so the profile and platform cannot be mistyped either.

The build config has been checked: the production profile resolves the HTTPS
API and the Google sign-in URL scheme, so it will not die at config evaluation.

### 3.5 The listing

Complete these before the build finishes; the version cannot be submitted until
every one of them is green.

- **Screenshots — two iPhone sizes are required, not one.** App Store Connect
  refuses the version with "You must upload a screenshot for 6.5-inch iPhone
  displays" if only the 6.9" set is there. Apple does not scale one iPhone size
  down to cover the other. Both sets are committed, six shots each, same content:

  | Slot | Folder | Size | Captured on |
  |---|---|---|---|
  | 6.9" | `store/screenshots/ios-6.9/` | 1320×2868 | iPhone 17 Pro Max |
  | 6.5" | `store/screenshots/ios-6.5/` | 1242×2688 | iPhone 11 Pro Max |

  Each is its slot's native size, so they upload without resizing. No 6.5"
  simulator ships with a current Xcode, but the device type does, so make one:

      xcrun simctl create "WM-6.5in" \
        com.apple.CoreSimulator.SimDeviceType.iPhone-11-Pro-Max \
        com.apple.CoreSimulator.SimRuntime.iOS-26-5

  Copy `Documents/SQLite/workoutmaxing.db` (with its `-wal` and `-shm`) from an
  already-seeded simulator's data container rather than re-entering a session by
  hand, so both sets show identical history. Marketing status bar via
  `xcrun simctl status_bar <udid> override --time 9:41 --batteryState charged
  --batteryLevel 100`, and `clear` when done.

  **History is thin** — one seeded session — so re-shoot both sets once there is
  real training to show.
- **Description, keywords, subtitle** — drafts in Part 5.
- **Support URL** — `https://aliwhosane.github.io/workoutmaxing/` (live).
- **Privacy Policy URL** — the same page; required again for HealthKit.
- **Marketing URL** — leave blank until there is an actual marketing site.
- **Copyright** — `2026 CodeFlip`. Year first, then whoever holds the rights;
  Apple adds the © itself, and a URL here is rejected. Free text, not verified.

  This is *not* the developer name buyers see — that comes from the account
  type. An individual enrolment shows the person's legal name, and showing
  "CodeFlip" there instead would mean an organisation enrolment with a D-U-N-S
  number. Copyright naming a brand while the seller shows a person is allowed
  and ordinary for a solo developer.
- **App Privacy** — Health & Fitness and Identifiers, both *linked to the user*,
  both *App Functionality*, **not** used for tracking. It must match
  `docs/PRIVACY.md`; Apple checks answers against binary behaviour.
- **Age rating** — the questionnaire lands on 4+ for a training log.
- **Pricing** — Free.

### 3.6 Review notes — write these, they prevent the usual rejections

Paste something close to this into *App Review Information → Notes*:

> No account is required. The app is fully functional signed out — every
> feature, including all training plans and the full exercise library, works
> with no sign-in and no network.
>
> Sign-in is optional and exists only to sync between devices. Sign in with
> Apple is offered alongside Google.
>
> HealthKit access is optional and requested only when the user turns on
> "Save workouts to Apple Health" in Settings. Denying it changes nothing else.
>
> Account deletion is in Settings → Delete account, behind two confirmations.
> It erases everything the server holds. Local training history stays on the
> device by design, and the copy says so.

Reviewers use their own Apple ID, so no demo account is needed.

### 3.7 Before you press submit

- **Server configuration — checked 2026-09-01, all good.** The Lambda is
  `workout-maxing-sync`; `workout-maxing` is the API Gateway in front of it,
  which is an easy pair to confuse.

      aws lambda get-function-configuration --function-name workout-maxing-sync \
        --region us-east-1 --query 'Environment.Variables'

  `APPLE_CLIENT_ID` is `co.workoutmaxing.app`. That has to be exactly the bundle
  id: for a native app it is the `aud` claim Apple puts in the identity token,
  and `server/src/auth.js` fails closed on a mismatch, so a wrong value means
  sign-in fails for the reviewer and the app is rejected. `GOOGLE_CLIENT_ID` is
  set, and `JWT_SECRET` is 43 characters and — verified by fingerprint — not the
  copy sitting in `server/.env` on the laptop.

- **iPhone only.** `ios.supportsTablet` is `false` as of 2026-09-01, so no iPad
  screenshot set is required and review will not run the app on an iPad. The
  layout is portrait and phone-shaped throughout — tab bar, logger, dock — so
  shipping it stretched to a 13" canvas would have been judged on a design
  nobody drew. iPad is its own piece of work, not a checkbox.

## Part 4 — Google Play

### 4.1 Create the upload key

Generate it once and never lose it — Play identifies your app by this key.

```bash
keytool -genkeypair -v -keystore ~/workout-maxing-upload.jks \
  -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

Back the file and its password up somewhere you will still have in five years.
If you let EAS manage credentials instead, it holds the key for you — either is
fine, but know which one you chose.

### 4.2 Keep the R8 mapping file

Release builds are minified, so a crash report from the store is unreadable
without `android/app/build/outputs/mapping/release/mapping.txt`. Play Console
accepts it as a deobfuscation file — upload it with every release, and keep the
one that matches each version.

### 4.3 Build the bundle

Play requires an `.aab`, which the production profile already produces.

```bash
cd mobile
npx eas build --platform android --profile production
```

### 4.4 Declare Health Connect access

**This one is easy to miss and will block the release.** Google treats Health
Connect as sensitive: you must complete the **Health apps declaration** form in
Play Console and explain each permission. Yours are:

| Permission | Why |
|---|---|
| `WRITE_EXERCISE` | Save finished workouts so they appear with other activity |
| `READ_WEIGHT` | Show strength relative to bodyweight |
| `WRITE_WEIGHT` | Save bodyweight the user logs in the app |

Review takes days, sometimes longer. Submit it early.

### 4.5 The rest of the console

- **Data safety form** — mirrors the privacy policy. Declare account identifiers
  and health data; state that data is encrypted in transit and can be deleted.
- **Content rating** — a questionnaire; a training tracker rates "Everyone".
- **Target audience** — 13+ avoids the extra rules that apply to child-directed apps.
- **Screenshots** plus a **1024×500 feature graphic** (the WM mark on the black
  canvas works).

### 4.6 Roll out gradually

Internal testing → closed testing → production. Do not skip straight to
production on a first release; the internal track installs in minutes and is the
cheapest place to find out the production server URL is wrong.

---

## Part 5 — Listing copy

Drafts. Edit freely.

**Name:** Workout Maxing
**Subtitle (30 chars):** Lift. Log. Get stronger.

**Description:**

> Workout Maxing is a training log built around one number: how long it takes to
> record a set. A set that goes as planned costs one tap — the weight and reps
> are already there, taken from what you lifted last time.
>
> Pick a proven plan or build your own from a library of 873 exercises, each with
> written instructions and a demonstration. The app works out what you should
> lift next and tells you why, so you are never guessing at the bar.
>
> Everything works offline and without an account. Sign in only if you want the
> same history on a second phone.
>
> • 873 exercises with instructions and demonstrations
> • Proven training plans, or build your own
> • Automatic progressive overload with the reasoning shown
> • Rest timer that starts itself
> • Kilograms or pounds, your choice
> • Saves to Apple Health / Health Connect
> • Works completely offline

**Keywords:** workout log, gym tracker, weight lifting, strength training,
progressive overload, 5x5, powerlifting, workout planner

---

## Part 6 — Known gaps before v1.0

Things a reviewer or a user will notice.

- **The sync engine has never been exercised between two devices.** It is
  verified against the server, but two phones converging has not been tried.
- **No crash reporting and no analytics.** Shipping blind. Worth adding, but
  four things move together when you do:

  - **The labels gain rows**: Diagnostics → Crash Data and Performance Data,
    Usage Data → Product Interaction. Labels are metadata, so they can be
    edited the day it ships without a new build.
  - **"Used for tracking" stays No.** In Apple's vocabulary tracking means
    linking your data with third-party data for advertising, or handing it to a
    data broker. Measuring how people use your own app is not that. Answering
    Yes obliges you to show the App Tracking Transparency prompt, and shipping
    that answer without the prompt is a rejection.
  - **`docs/PRIVACY.md` currently promises the opposite** — "No analytics,
    crash reporting or tracking SDKs". That claim becomes false the moment an
    SDK lands, and the published page has to change in the same release.
  - **The SDK needs its own privacy manifest.** Apple requires one, plus a
    signature, from commonly-used third-party SDKs. Sentry ships both; check
    before picking something more obscure.
- **No offline indication for a failed sync.** Failures are silent by design, but
  a user with a broken account will not know.
- **The exercise images load from a CDN** and are not bundled. First view of an
  exercise needs a network connection.
- **HealthKit read access is requested and never used.** Deferred past 1.0 on
  2026-09-01; this is the note so it is not lost.

  `READ = ['HKQuantityTypeIdentifierBodyMass']` on iOS, and `read Weight` on
  Health Connect, but `readLatestBodyweightKg` and `writeBodyweightKg` have no
  callers anywhere, and `body_metric` has no writer at all. Only `saveWorkout`
  is live. So three things currently overclaim:

  - `NSHealthShareUsageDescription` in `app.json` says the app reads bodyweight
    and reads workouts logged elsewhere. Neither happens.
  - `docs/PRIVACY.md` and the published page say the same.
  - Apple reviews HealthKit strictly, and read access requested but unused is a
    rejection risk under data minimisation.

  Two ways out: implement bodyweight (the schema is already there — the app was
  designed to show strength relative to it), or drop the read permission and
  narrow the strings to "saves your finished workouts". Usage strings are baked
  into the binary, so either needs a rebuild; the policy wording does not.
