# Shared workspace handoff

Codex is publishing the neon-arcade-street content changes, including the shared
street art and multiplayer work already present in the worktree. City homepage
changes in `site/shell/city/` and their tests are preserved for their author.

Interior implementation: `src/interior.js` imports Kenney Mini Arcade CC0 GLBs.
Do not replace these with generated boxes. Source/author/license information is
in `assets/interior/CREDITS.md`.

Movement supports scalar street bounds and explicit interior min/max bounds.
Multiplayer payload: `{k:'s', s:[x,y,z,yaw], a:'street'|'arcade'}`.
Legacy messages without `a` are treated as street positions.
The cabinet game is local; no coin/account or authoritative game rules changed.

Tests: node neon-street test, content validator, interior browser test.
Multiplayer harness must use an isolated port when another author is testing;
`ARCADE_TEST_ORIGIN` selects the browser test server.
