# Workout Maxing — sync server

Node + Fastify + MongoDB Atlas. Its only job is to be a merge point between a
user's devices. The phone is the source of truth and works entirely offline;
this server holds a copy so a second device can catch up.

## Run locally

    cp .env.example .env      # fill in MONGODB_URI and JWT_SECRET
    npm install
    npm run dev

## Database

MongoDB Atlas M0 (free, runs on AWS). One database, one collection per synced
table, plus `users` and `devices`. Every document carries `userId` and
`updatedAt`, and the compound index `{ userId: 1, updatedAt: 1 }` is what makes
a delta pull a single indexed range scan regardless of history size.
