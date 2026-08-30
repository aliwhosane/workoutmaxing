# Workout Maxing

A workout tracker for iOS and Android. One job: log what you lifted, with as
little friction as physically possible.

    mobile/    Expo + React Native app (the product)
    server/    Node + Fastify + MongoDB sync service
    docs/      architecture and design decisions

## Run the app

    cd mobile
    npm install
    npx expo start --ios      # or --android

The app is fully functional offline with no server running. Sign-in and sync
are additive.

## Run the sync server

    cd server
    cp .env.example .env       # fill in MONGODB_URI + JWT_SECRET
    npm install
    npm run dev

## Where things are

| Path | What it is |
|---|---|
| `mobile/app/` | Screens (expo-router, file-based) |
| `mobile/src/design/` | Tokens and primitives — the whole visual system |
| `mobile/src/db/` | SQLite schema, migrations, queries |
| `mobile/src/data/` | Bundled exercise catalogue + built-in programs |
| `mobile/src/sync/` | Delta sync client |
| `mobile/scripts/` | `build-exercise-db.mjs` regenerates the catalogue |
