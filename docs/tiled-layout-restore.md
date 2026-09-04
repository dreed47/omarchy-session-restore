# Deferred: tiled layout restore

**Status: deferred. Blocked on Hyprland core.**

## What is missing

Session Restore brings back, per window:

- which workspace and which monitor
- floating position / size
- fullscreen state
- browser tabs

It does **not** bring back the *tiled* arrangement inside a workspace - which
window is left/right/top/bottom of which, and the split ratios between them. On
restore, tiled windows are launched onto their workspace and land wherever
Hyprland's dwindle layout puts them, in whatever order their windows happen to
map.

## Why it is deferred (not just unbuilt)

Doing this properly needs two things from Hyprland that do not exist today.

### 1. Read the dwindle tree + split ratios

`hyprctl -j clients` exposes geometry (`at`, `size`) but **nothing about how
windows relate in the tiling tree** - no parent/child, no split direction, no
ratio. That data lives only in dwindle's internal `SDwindleNodeData` and is not
queryable.

Upstream request: **[hyprwm/Hyprland Discussion #13035](https://github.com/hyprwm/Hyprland/discussions/13035)**
- "Read-only hyprctl command to query dwindle layout tree structure"
- proposes `hyprctl layouttree -j` with `splitVertical` / `splitRatio` per node
- opened 2026-01-20, **no maintainer response, no PR** as of this writing

### 2. Set an absolute split ratio

The `splitratio` dispatcher was **removed** from Hyprland. Only relative
`resizeactive` pixel nudges remain, which can approximate a ratio but not set
one directly.

## The two implementation tiers

| Tier | Needs core? | Quality |
|---|---|---|
| **A** - infer the split tree from saved window rectangles, rebuild empty workspaces with `preselect` + interleaved launch + relative-resize nudges | No | Fragile heuristic. Login-only (empty workspaces). This is what `io.github.imryiuk.workspace-profiles` already does. |
| **B** - feed the same rebuild with the *real* tree from `hyprctl layouttree -j` | **Yes** | Robust. Works mid-session. No geometry guessing. |

We are **not building Tier A** - `workspace-profiles` already owns that approach,
and none of this plugin's differentiators (snapshot of reality, browser tabs,
exact floating geometry, moving already-running windows) depend on tiling.

## Trigger condition for building Tier B

Implement Tier B **only when** a released Hyprland exposes the dwindle tree +
ratios (via `hyprctl layouttree -j` from #13035, or an equivalent). Until then
this stays deferred.

Tier B sketch, once unblocked:

1. `save`: also record `hyprctl layouttree -j` per workspace into the profile.
2. `restore` into an empty workspace: translate the saved tree into an ordered
   step list (pre-order over splits - see `lib/plan.jq` in `workspace-profiles`
   for the shape), then for each split: focus the seed window, `preselect` the
   side, launch the app, wait for its window to map, and apply the ratio with a
   relative `resizeactive` nudge (measure-nudge-measure, twice) while the split
   still has exactly two children.
3. Leave non-empty workspaces on the existing coordinate/workspace restore path.

## Action items

- [ ] Comment on **[#13035](https://github.com/hyprwm/Hyprland/discussions/13035)**
      with this plugin's concrete use case and an offer to co-write the PR.
      Two real dependents (this + `workspace-profiles`) is leverage on an
      unanswered thread.
- [ ] Write the `hyprctl layouttree -j` PR **only if** a maintainer signals
      interest on #13035.
- [ ] **When this plugin is submitted to the Omarchy marketplace**, add a note
      on #13035 (and any follow-on PR) linking the published plugin as a
      dependent that is waiting on the feature.
