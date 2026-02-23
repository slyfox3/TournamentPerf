# Tournament Performance Calculator

A client-side tool that computes performance ratings for pool players in a tournament, using the [Fargo Rate](https://www.fargorate.com/fargorateblog/archive/behindthecurtain/) win expectation formula and least-squares optimization.

## Why not just use rack ratios?

The traditional approach computes performance from a fixed formula: take a player's rack win ratio against each opponent and map it to a rating using that opponent's official rating. This anchors every calculation to opponents' *official* ratings, which may not reflect how they actually played that day. Beating someone having a bad tournament counts the same as beating them at their best.

## What this tool does differently

Instead of computing each match independently, this tool finds a **single set of ratings for all players simultaneously** that best explains the observed results across the entire tournament.

It sets up a system of residual equations — one per match, plus one per player's official rating — and finds the ratings that minimize the total squared error across all of them at once. This means:

- Say B and C have similar official ratings and C is performing around average. If B dominates C, the optimizer infers B is playing above their official level. Now if A beats B, A gets more credit than the traditional approach would give — because B's rating has been adjusted upward based on how B actually played, not just their official number.
- The ratings are **mutually consistent**: every player's performance rating reflects the performance of everyone they played, and everyone *those* players played, and so on.

The result is a performance rating that captures how the entire tournament unfolded, not a fixed formula applied to each player independently.

## How the optimization works

### Fargo win expectation

Given two players with ratings Ra and Rb:

```
ratio = 2^((Ra - Rb) / 100)
P(A wins a rack) = ratio / (1 + ratio)
```

A 100-point gap means 2:1 expected rack ratio. 200 points means 4:1.

### Residuals

For each match between player A (score1 racks) and player B (score2 racks):

```
expected_A = (score1 + score2) * P(A wins | Ra, Rb)
residual = score1 - expected_A
```

If the ratings perfectly predict the outcome, the residual is zero. The optimizer adjusts all ratings to make residuals collectively as small as possible.

### Official rating anchors

Without any constraint, the optimizer could shift all ratings up or down by the same amount and produce identical residuals. Official ratings anchor the system.

For each player with an official Fargo rating, a "ghost match" residual is added: a simulated match against a phantom opponent at the player's official rating. The weight of this ghost match (called **stickiness**) is set to 20% of the average rack count played per player, so official ratings gently anchor the optimization without overpowering actual results.

Players without an official rating get no prior — their performance rating is determined entirely by match results.

### Solver

The system uses [Levenberg-Marquardt](https://en.wikipedia.org/wiki/Levenberg%E2%80%93Marquardt_algorithm), a standard algorithm for nonlinear least-squares problems. It iterates in chunks of 5 steps, stopping when no player's rating changes by more than 0.5 points, or after 1000 iterations.

## Usage

Open `index.html` in a browser. Paste a DigitalPool tournament URL and press Enter. The page fetches match data via GraphQL and runs the optimization client-side.

If CORS blocks the fetch, use the "paste JSON manually" fallback.

Shareable links: the URL updates to `?digitalpool=<slug>` so you can bookmark or share a direct link to any tournament.

## Tech stack

Single HTML file, no build step. Uses [ml-levenberg-marquardt](https://github.com/mljs/levenberg-marquardt) loaded from esm.sh.
