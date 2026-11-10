# Review log

Mistakes caught during review, mine and the AI's. Newest first.

| Date | Where | Mistake | Caught by | Fix |
|---|---|---|---|---|
| 2026-11-10 | `site/app.ts` | Loading a second sky left the first sky's project labels on screen. Removing a three.js group doesn't remove the HTML of CSS2D labels nested inside it. | Headless test that loads a file | Remove label elements before rebuilding. |
| 2026-11-10 | `site/app.ts` | Project spacing used session count only, so a project with two very long sessions overlapped its neighbour. | Screenshot of real data | Lay out each project first, measure its real radius, then space projects by the largest one. |
| 2026-11-10 | `site/app.ts` | With one model in every session, the whole sky was one colour. | Screenshot of real data | Colour by project when only one model is used. |
| 2026-11-10 | `src/extract.ts` | A first version made one star per session. Real data had only 24 sessions, too few for a sky. | Running the extractor on real transcripts | One star per prompt (511), with tool calls as dust. |
| 2026-11-10 | `src/extract.ts` | One API response is streamed as several transcript lines that repeat the same `usage`. Summing every line overcounts tokens. | Reading the transcript format | Count usage once per message id, but tool calls on every line. |
