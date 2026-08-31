# Shipping Workout Maxing

A step-by-step guide to getting the app onto the App Store and Google Play.

Work through **Part 1 first** — those are things that will stop a submission
dead, and two of them need decisions only you can make.

---

## Part 1 — Blockers

### 1.1 Decide what to do about the built-in training plans

**This is the one that carries real risk, and it needs your decision.**

The app ships fourteen plans. They divide into two groups:

| Group | Plans | Risk |
|---|---|---|
| Generic / classic | Novice LP, PPL, Upper/Lower, Madcow, Texas Method, Minimalist | Low — no single author owns a 5×5 |
| Named, authored | 5/3/1 (×2), GZCLP, PHUL, PHAT, StrongLifts, GreySkull, nSuns | **Needs a decision** |

Publishing another author's program under their name, in an app you distribute,
is a different act from running it yourself. Jim Wendler, Layne Norton, Brandon
Campbell and Mehdi Hadim all sell books, apps or coaching built on this material.

Three honest options:

- **Ship only the generic plans.** Delete the named ones from
  `mobile/src/data/programs.ts`. Zero risk, and the importer means users can
  still bring in whatever they follow.
- **Ask permission.** Several of these authors licence their programs. It costs
  an email and gives you something competitors cannot copy.
- **Ship as-is.** Some apps do. Understand it is a takedown risk, and takedowns
  land on the app, not on the plan.

Nothing else in Part 1 requires judgement. This one does.

### 1.2 Deploy the server over HTTPS

The app currently points at `http://192.168.1.206:8080` — a machine on your desk.
That cannot ship:

- iOS App Transport Security blocks plain HTTP.
- Android blocks cleartext in release builds.
- The address is not reachable from the internet.

You need the `server/` app running somewhere with a TLS certificate.
[`docs/DEPLOY.md`](./DEPLOY.md) covers this: Lambda behind a Function URL, which
costs nothing at this scale and needs no server to maintain. `server/scripts/deploy.sh`
does it in one command.

Whatever you choose:

- Set `DYNAMODB_TABLE`, `AWS_REGION`, `JWT_SECRET`, `APPLE_CLIENT_ID` and
  `GOOGLE_CLIENT_ID` as environment variables there.
- **Use an IAM role rather than access keys** if the host supports it. If not,
  create a fresh key for the deployment — do not reuse a local one.
- Generate a **new** `JWT_SECRET` for production. The local one has been on your
  laptop in plain text.
- Put the resulting URL into `API_BASE_URL` in `eas.json` under both `preview`
  and `production`.

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

## Part 3 — Apple

### 3.1 Register the app

1. **developer.apple.com → Certificates, Identifiers & Profiles → Identifiers**
2. Register `co.workoutmaxing.app` if it is not already there.
3. Enable these capabilities on it:
   - **HealthKit**
   - **Sign in with Apple**
4. **App Store Connect → Apps → +** and create the app record. Note the **Apple
   ID** number it gives you — that is `ascAppId` in `eas.json`.

### 3.2 Fill in `eas.json`

Replace the three placeholders under `submit.production.ios`: your Apple ID
email, the `ascAppId` from the step above, and your Team ID (top right of the
developer portal).

### 3.3 Build and upload

```bash
cd mobile
npx eas build --platform ios --profile production
npx eas submit --platform ios --profile production
```

EAS creates the distribution certificate and provisioning profile for you the
first time; say yes when it offers.

### 3.4 The listing

- **Screenshots** — required for 6.9" and 6.5" iPhones. Take them on the
  simulator: Today with a plan loaded, the logger mid-session, the exercise
  library, a plan detail, History.
- **Description, keywords, subtitle** — drafts in Part 5 below.
- **App Privacy** — declare what `docs/PRIVACY.md` describes: identifiers and
  health data, linked to the user, used only for app functionality. Not used for
  tracking. Answer honestly; Apple checks against binary behaviour.

### 3.5 What review will ask about

- **HealthKit.** Explain in the review notes that health access is optional, is
  used to write finished workouts and read bodyweight, and that the app is fully
  functional with it denied. Apps that break without HealthKit get rejected.
- **Sign-in.** Reviewers will check Apple sign-in works. It must succeed against
  your production server, so deploy before submitting.
- **Account deletion.** Apple requires apps with account creation to offer
  in-app deletion. Settings → Delete account does this: it erases everything the
  server holds, behind two confirmations. Local history is kept deliberately —
  deleting the account is a decision about syncing, not about throwing away a
  training log — and the copy says so.

---

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
- **No crash reporting.** Shipping blind. Sentry or similar is worth adding, and
  changes the privacy disclosure if you do.
- **No offline indication for a failed sync.** Failures are silent by design, but
  a user with a broken account will not know.
- **The exercise images load from a CDN** and are not bundled. First view of an
  exercise needs a network connection.
