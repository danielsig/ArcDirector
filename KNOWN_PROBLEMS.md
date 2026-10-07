# Known problems

Found on 2026-10-06 while checking the Character / Mind / Collective refactor live (ruins, market) and in the AI log. Every one of them also happens at HEAD `e5f835a`; the refactor did not cause them. Most harmful first. Line numbers are as of that day.

## 1. A collective with no commander cannot use its tools

**Seen:** MarketHive calls `see_map`, `grep_world_encyclopedia` and `observe`, and each returns `{"error":"no ctx"}`. It then answers in prose ("I am currently unable to see the world or my roster due to a context error…") and wastes its repair rounds.

**Cause:** a mind's tools run with the context of its voice. A collective without a commander is its own voice, and the game's `withContext` returns `undefined` for an id with no character in the world ([adapter.ts:159](game/src/director/adapter.ts#L159), [director.ts:1735](arc-director/src/director/director.ts#L1735)). `runTool` refuses every tool without a context ([mind.ts:1603](arc-director/src/mind/mind.ts#L1603)).

**Fix:** give such a collective's mind the context of its first living character, as its sight already does (`dummyHiveKernels`, [director.ts:1557](arc-director/src/director/director.ts#L1557)). Center those tools (`see_map`, `earshot`) on that character, or on the middle of the members. The smaller alternative: let `recall` and `grep_world_encyclopedia` run without a context, and leave `see_map` and `earshot` out of a commanderless mind's tool list.

## 2. A collective with no commander never hears anyone

**Seen:** MarketHive's prompts never show "… said …" lines, even while shoppers and vendors talk next to its members.

**Cause:** `TalkNet` delivers speech only to ids that the host's `others(speaker)` returns, plus the addressees ([talk.ts:378](arc-director/src/mind/talk.ts#L378)). The game returns characters in the world only ([playerTalk.ts:116](game/src/director/playerTalk.ts#L116)), so `MarketHive` never hears. Every member has a listener, but it drops speech unless that member is its mind's voice (`listen`, [director.ts:2068](arc-director/src/director/director.ts#L2068)). A party with a commander therefore hears only near the commander. The game's pooling helpers (`inCollectiveRange`, `collectiveCanSee`, `collectiveClearHear`, [adapter.ts:333-430](game/src/director/adapter.ts#L333)) help only listeners that are already in `others`.

**Fix:** pool hearing in the library. Each member listens for its collective's mind, and `TalkNet` delivers each utterance to a mind once, at the clearest member. A collective with no commander then hears through its characters. A party hears through all of its members. The game's listener-side pooling can be deleted.

## 3. Formations through `issue` never move anyone

**Seen:** with the units in `world.test.ts` "forms a line of units across the way to the foe" ([world.test.ts:322](arc-director/src/world/world.test.ts#L322)) placed off the line, `hold_line` leaves them where they were. The test passes only because A, B and C already stand in a line. The market hive's `hold_line` orders to its guards do nothing either.

**Cause:**
- `handleIssue` looks for the handler in `handlers` and `onVerb` only. It never looks at the stock world verbs that `withWorld` binds ([director.ts:1524](arc-director/src/director/director.ts#L1524)). With no catch-all handler, nothing runs, yet `issue` reports success.
- Any steps after the formation are issued right away. `enact` → `replaceProgram` → `abortArc` → `mover.stop` then cancels the formation's moves.
- A formation anywhere but the head of an issued arc fails with "formation must be issue arc head" ([director.ts:1471](arc-director/src/director/director.ts#L1471)). The hive writes it inside `when`, so it always fails there.
- A collective with no commander has no character for the call, so the director borrows its first troop.

**Fix:** make formations ordinary verbs that each troop runs. `issue` records the troops it lands on. When one troop runs `hold_line(at, facing)`, it computes the same slots for that group, walks only itself to its own slot, and the step ends on arrival.
- What goes away: the head-of-arc rule, the special branch in `handleIssue`, the borrowed character, and `VerbCall.units`; the handler reads the group off its character.
- What starts working: `&&` waits for arrival, and formations work inside `when` and `loop`.
- Also start the test's units off the line.

## 4. "Last I saw …" memories are mostly junk

**Seen:** in MarketHive's memories (shown to the memory handover):
- "Last I saw In: In talking range: Baker, Weaver…"
- "Last I saw Nothing: back: Traveler'sPack Purse: 23 gold…", plus the same line again for Purse, Backpack and Loaf
- "Last I saw Knife: bought Knife from Cutler for 7 gold"

About 40 of its memories are like this, and they fill "You remember" and the handover prompt.

**Cause:** `noteSeen` ([mind.ts:1236](arc-director/src/mind/mind.ts#L1236)) scans every sensed section joined together: sight, earshot, carrying and so on ([mind.ts:858](arc-director/src/mind/mind.ts#L858)). It treats every capitalized word as a name.

**Fix:** record sightings only from the sight sense, keyed by the ids it actually saw, not by capitalized words.

## 5. Reply errors become long-term memories

**Seen:** "your reply was not a valid Arc: unknown verb 'thought'" is stored as one of MarketHive's memories.

**Cause:** the director feeds a parse failure back as an arc result ([director.ts:2469](arc-director/src/director/director.ts#L2469)), and `absorbPending` keeps every result that is not trivial as a fact ([mind.ts:1186](arc-director/src/mind/mind.ts#L1186)).

**Fix:** keep the results of `think` repairs in short-term memory only, and skip `keepFact` for them.

## 6. The roster repeats tags

**Seen:** "- Mira: Shopper, Loaf, EastGate, Loaf, Knife, Bowl".

**Cause:** a spec tag (`Loaf`) and a tag the collective's mind added (`MarketHive:Loaf`) shorten to the same word ([collective.ts:179](arc-director/src/collective/collective.ts#L179)).

**Fix:** remove duplicates from the short tags: `[...new Set(tags)]`.

## 7. "Earlier:" runs events together

**Seen:** "Earlier: Ivo arrived from the street Ivo bought Loaf from Baker for 5 gold Tomas bought Loaf from Baker for 5 gold".

**Cause:** `foldRecent` joins the folded lines with spaces, and event texts have no final period ([mind.ts:166](arc-director/src/mind/mind.ts#L166)). It also trims to the last 600 characters, which can cut mid-word.

**Fix:** join with "; ", and when trimming, cut at a separator.

## 8. Small models echo the Laws block

**Seen:** in ruins, gemma-4-e2b sometimes answers with a copy of the "Laws (emergencies, list order; unlaw to drop)" lines instead of an arc.

**Cause:** law lines look like arcs: `- flee: who=… watch=… → go_to(Keep)` ([mind.ts:745](arc-director/src/mind/mind.ts#L745)).

**Fix:** say that they already run ("These run on their own; do not repeat them"), or write each law as a sentence: "When isHurt(me), it runs go_to(Keep)".

## 9. A collective with no commander cannot `wait`

**Cause:** every host verb needs a character; otherwise it fails with "no body" ([director.ts:1311](arc-director/src/director/director.ts#L1311)). That includes `wait`, which the director runs on its own clock. The hive's verb list still offers `wait` and the other body verbs.

**Fix:** let `wait` run on any runner (the director's timer needs only an id). Then either leave the verbs that need a character in the world out of a commanderless collective's verb list, or fail them with "you have no body; issue it to a character".

## 10. MarketHive replies run out of tokens

**Seen:** two repairs in a row: "That was not a valid Arc (reply was cut off at the token limit; answer shorter)", with reasoning on and `max_tokens` 4096.

**Cause:** a long system prompt plus reasoning. A repair keeps the conversation, so each retry starts longer.

**Fix (to try):** turn reasoning off for the first repair, not only later ones, or give collectives a larger token budget.

## 11. One test is flaky under load

"who= uses units not others; later when interrupts that unit only" ([collective.test.ts:358](arc-director/src/collective/collective.test.ts#L358)) failed once in a full run but passes on its own. It races 40 ms verb sleeps against a 400 ms wait. **Fix:** wait for the verb calls themselves, not for wall-clock time.
