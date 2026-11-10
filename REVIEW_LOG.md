# Review log

Mistakes caught during review, mine and the AI's. Newest first.

| Date | Where | Mistake | Caught by | Fix |
|---|---|---|---|---|
| 2026-11-10 | `src/cli.ts` | The local server answered any `Host` header, so a page using DNS rebinding could read your project names and totals. | Security audit, `curl` with a forged Host | Only `localhost:<port>` and `127.0.0.1:<port>` are served; others get 403. Regression test in `src/cli.test.ts`. |
| 2026-11-10 | `src/cli.ts` | One malformed URL (`/%E0%A4%A`) threw in the request handler and killed the server; a directory path would have too. | Security audit, `curl` | Handler wrapped: bad URLs get 400, directories 404. Tested. |
| 2026-11-10 | `src/cli.ts` | A bad `--port` or an unreadable transcript ended in a stack trace. | Security audit | Clear messages; an unreadable transcript is skipped with a warning. |
| 2026-11-10 | `site/index.html` | three.js loaded from jsDelivr with no integrity check: a compromised CDN could run code on the page that holds your data. | Security audit | three.js is installed at an exact version and copied into `vendor/` at build time. |
| 2026-11-10 | `site/app.ts` | A dropped file with millions of prompts could overflow `Math.max(...)` spreads or the GPU, and non-ISO dates sorted wrongly as text. | Security audit | Caps of 50,000 stars and 300,000 dust motes; dates rewritten as ISO strings. |
| 2026-11-10 | `site/app.ts` | Loading a second sky left the first sky's project labels on screen. Removing a three.js group doesn't remove the HTML of CSS2D labels nested inside it. | Headless test that loads a file | Remove label elements before rebuilding. |
| 2026-11-10 | `site/app.ts` | Project spacing used session count only, so a project with two very long sessions overlapped its neighbour. | Screenshot of real data | Lay out each project first, measure its real radius, then space projects by the largest one. |
| 2026-11-10 | `site/app.ts` | With one model in every session, the whole sky was one colour. | Screenshot of real data | Colour by project when only one model is used. |
| 2026-11-10 | `src/extract.ts` | A first version made one star per session. Real data had only 24 sessions, too few for a sky. | Running the extractor on real transcripts | One star per prompt (511), with tool calls as dust. |
| 2026-11-10 | `src/extract.ts` | One API response is streamed as several transcript lines that repeat the same `usage`. Summing every line overcounts tokens. | Reading the transcript format | Count usage once per message id, but tool calls on every line. |
