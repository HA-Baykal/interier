# Проверки

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Unit/route tests isolate environment variables and databases. Provider responses and Blob/Redis HTTP endpoints are synthetic; they do not spend a real AI balance.

## Browser smoke (desktop + touch emulation)

Start a **separate local QA server**, with all cloud storage explicitly disabled and a deliberately invalid provider host. Do not use a live database or a real GenAPI token.

```bash
NEXT_TELEMETRY_DISABLED=1 \
VERCEL= VERCEL_ENV= \
UPSTASH_REDIS_REST_URL= UPSTASH_REDIS_REST_TOKEN= \
KV_REST_API_URL= KV_REST_API_TOKEN= \
BLOB_STORE_ID= BLOB_READ_WRITE_TOKEN= \
TELEGRAM_BOT_TOKEN= AUTH_PUBLIC_URL= VERCEL_AUTOMATION_BYPASS_SECRET= \
DATABASE_PATH="./data/model-lab-smoke-$(date +%s).json" \
ADMIN_EMAIL=model-lab-smoke@example.test \
ADMIN_PASSWORD=local-model-lab-only-2026 \
GENERATION_MODE=compatible \
COMPATIBLE_PROVIDER=genapi \
COMPATIBLE_API_KEY=synthetic-no-real-key \
COMPATIBLE_BASE_URL=https://genapi-fixture.invalid \
COMPATIBLE_MODEL=gpt-image-2 \
npm start -- --port 3000
```

In another terminal:

```bash
TEST_BASE_URL=http://127.0.0.1:3000 npm run test:browser
```

The script refuses non-local hosts and checks the QA admin and file storage first. It also checks local generation/copying of a 32-character Vercel setup key: masked by default, manual reveal available, and no network mutation triggered. The test value is not registered with any real service. It intercepts generation/history/gallery requests and uses synthetic PNGs. It checks model/variant selection, duplicate-submit prevention, precise before/after clipping, keyboard/mouse/touch interaction, enlargement, zoom, modal close/focus restoration and history reopening. It also checks the real local registration API: submitted verification/admin flags are ignored, an unverified account cannot generate or claim rewards, and an unverified referral does not credit the inviter. It also exercises the Telegram UI with simulated challenge/approval responses. Server tests separately verify Telegram webhook authentication, confirmation, replay protection and account linking. It does **not** verify real provider quality, delivery of a live Telegram/email confirmation, or an iOS/Android binary.

Screenshots and the local Chromium runtime are under ignored `data/browser-smoke/`. Playwright and Chromium are development dependencies only. If the Playwright CDN is unavailable, the script uses the Chromium binary and NSS/NSPR libraries bundled in the npm package; it does not disable web security. A local browser executable can be provided through `TEST_BROWSER_EXECUTABLE`.

Stop the QA server when finished. Do not expose these intentionally synthetic credentials as a real deployment.

## Live acceptance

The owner tests a single paid model/profile in Vercel, checks the saved original/result and history, and verifies persistence after a same-branch redeploy. A passing mock/browser test is not proof of a real model result or actual charge. Compare actual billing in GenAPI separately from the estimates in the UI.
