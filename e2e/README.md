# End-to-end tests

Two layers:

1. **`consequence-loop.test.mjs`** (default, runs everywhere): spawns the
   compiled server as a separate OS process and plays the complete
   consequence loop over real HTTP — generated hex → travel → nested
   encounter → choice → remains → time advancement → later consequence —
   asserting the full event vocabulary and stored roll traces.

   ```bash
   npm run test:e2e
   ```

2. **`demo.mjs`**: the same loop, printed as a narrated transcript for
   humans (`npm run demo`).

## Browser journey (Playwright)

`playwright/consequence-loop.spec.ts` contains the browser-level journey
(create world → travel → encounter choice → return visit → consequence
visible in the UI). It is **not wired into `npm test`** because Playwright
browser binaries are not installed in every development environment. To run
it where browsers exist:

```bash
cd e2e && npm install @playwright/test && npx playwright install chromium
npx playwright test
```


The battlefield journey is in `playwright/battlefield.spec.ts`. It covers both
board layouts, token and obstacle placement, keyboard movement, saving and
reopening, scale changes, and a narrow viewport. Run it alone with
`npx playwright test playwright/battlefield.spec.ts`.

The server must be running (`npm run dev:memory`) before invoking it.
