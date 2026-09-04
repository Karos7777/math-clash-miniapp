# Math Clash — Android

A cross-math puzzle game. Every cell of the grid belongs to a row equation and a
column equation at the same time, so a number that fixes one line usually breaks
the other. That crossing is the whole game.

```
  7 × 3 − 4 = 17
  +     −     ×
  2 + 9 − 1 = 10
  ×     +     −
  5 − 8 + 6 =  3
  =     =     =
 45     4    17
```

Place every number from the tray so all six equations (or eight, on a 4×4) come
out to the target printed at the end of the line. Each number is used exactly
once.

## Install it on a phone

Every push to this branch builds an APK. Two ways to get it:

- **Direct link** — open
  [the preview release](../../releases/tag/android-preview) on the phone and
  download `math-clash.apk`. Android asks once for permission to install from
  the browser; allow it and the game installs.
- **From the Actions tab** — open the latest *Android APK* run and download the
  `math-clash-apk` artifact.

Requires **Android 7.0 (API 24) or newer**. No Play Store account, no accounts
of any kind.

The APK is signed with `app/preview.keystore`, a fixed key committed alongside
the code. That is deliberate and it is not a secret: it exists so every preview
build carries the same signature and a newer one installs straight over an older
one, the same reason Android ships a well-known debug key. A Play Store release
would need its own, private key.

If Android still says the app was not installed:

- check the Android version — 7.0 is the floor;
- if an older build is on the phone from before the fixed key existed, uninstall
  it first, then install again;
- make sure the browser is allowed to install apps (Settings → Apps → your
  browser → Install unknown apps).

## Modes

| Mode | What it is |
| --- | --- |
| **Practice** | Endless boards at the level you pick. |
| **Focus run** | Five boards under one clock, starting below your level and ending above it. |
| **Board of the day** | One board a day, rebuilt from the date so it is identical on every device. The week ramps from an easy Monday to a brutal Sunday. |

Six levels: Warm-up (2×2, `+ −`), Easy (3×3, `+ −`), Medium (3×3, `+ − ×`),
Hard (3×3, `+ − × ÷`), Expert (4×4, `+ − ×`), Insane (4×4, `+ − × ÷`).

## The rules the app enforces

- **Order of operations** is a setting. By default `×` and `÷` are worked out
  before `+` and `−` (`2 + 3 × 4 = 14`); the alternative reads every line
  strictly left to right (`2 + 3 × 4 = 20`). Boards are generated for whichever
  rule is active.
- **Arithmetic is exact.** The evaluator keeps the running value as a fraction,
  so `12 ÷ 8 × 2` is accepted as a legal way to reach `3`, and `9 ÷ 2` simply
  never equals a whole target. Generation is stricter than play: the intended
  solution never has a fractional step in the middle.
- **Any correct arrangement wins**, not just the one the generator had in mind —
  though in practice every board it ships has exactly one answer.

## How a board is built

Working backwards is what makes generation tractable:

1. Deal the numbers into the grid at random.
2. Fit operators to each row and column — every combination is evaluated, the
   ones landing on a clean whole target in range are kept, and one is drawn by
   weight so boards lean interesting instead of turning into six sums.
3. Hand the board to the solver, which reveals cells one at a time until exactly
   one answer remains, then drops any reveal a later one made redundant.

`Generator` is a pure function of the `Random` it is given, which is what lets
the daily board be rebuilt from its date instead of downloaded.

## How the solver works

A cell-by-cell search is hopeless on a 4×4 — 16! orderings — so `Solver` works a
row at a time:

1. Each row is expanded into the list of number tuples that satisfy its own
   equation: a few hundred, out of tens of thousands of orderings.
2. The same is done per column, and those are indexed by prefix.
3. Rows are then chosen top to bottom, and a partial board is dropped the moment
   a column prefix is one no valid column can start with.

Step 3 is what makes it quick: a wrong number in row 0 is usually refuted before
the bottom of the board is reached. Measured on a laptop JVM, a 4×4 board takes
about 15 ms to generate (100 ms at the 99th percentile) and a hint solves in
under 50 ms. Generation and hints both run off the main thread anyway.

The same solver powers the hint button. If the board can still be finished, a
hint opens one correct cell — chosen from the line closest to completion, where
it does the most good. If the player has already played into a dead end, the
hint takes back the most recent moves until the board can be saved, says how
many went, and then opens a cell.

## Layout

```
app/src/main/java/com/karos/mathclash/
├── engine/     puzzle rules — no Android in here, all of it unit tested
│   ├── Expression.kt   exact evaluation, both precedence rules, no allocation
│   ├── Solver.kt       row expansion + column prefix pruning
│   ├── Generator.kt    deal, fit operators, pin down to one answer
│   ├── Puzzle.kt       BoardSpec (the shape) and Puzzle (shape + answer)
│   ├── Difficulty.kt   the ladder and what each rung allows
│   └── Scoring.kt      score, stars, focus index
├── game/       a board being played: moves, undo, hints, the app state machine
├── data/       shared-preferences save file
└── ui/         Compose screens, board rendering, theme
```

## Build it yourself

```bash
cd android
./gradlew testDebugUnitTest   # engine, solver, scoring, board rules
./gradlew assembleDebug       # app/build/outputs/apk/debug/app-debug.apk
```

Needs JDK 17 and an Android SDK with platform 35. Nothing else — no keys, no
network calls, no accounts. The game is entirely offline and stores progress in
one local preferences file.

## About the focus index

The number on the home screen is a rolling read on your pace and accuracy
against par for the level, where 100 means "on par, no help". It is a training
log, not a test score — the game trains mental arithmetic under time pressure
and the habit of holding several constraints in working memory at once, which is
the useful part.
