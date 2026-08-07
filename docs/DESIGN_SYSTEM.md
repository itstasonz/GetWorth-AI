# GetWorth Design System

**Status:** UI-002 foundation — landed, enforced in CI.
**Source of truth:** `src/index.css` (`:root`) → `tailwind.config.js` → `src/lib/tokens.js`.
**Enforced by:** `scripts/check-contrast.mjs` and `scripts/design-lint.mjs`, both wired into `npm test`.

This system exists because of a measured failure, not a preference. UI-001 found seven parallel token declarations, **0.89% token adoption** (8 `var()` references in all of `src/`), brand fonts downloaded but applied to ~1% of text, 158 raw `<button>` against 24 `<Btn>`, 11 hand-rolled bottom sheets against 1 primitive, and six text pairs below WCAG AA. The diagnosis was not bad taste — it was **absent authorship**: screens were transcribed one at a time from generated mockups, so nothing was ever decided once.

Everything below is the "decided once" layer.

---

## 1. Design principles

1. **Evidence over assertion.** The product's differentiator is that it tells you what it doesn't know. The interface should look like that sentence.
   *Forbids:* unbacked indicators, fabricated activity, confidence expressed as decoration.
2. **Visual weight tracks informational weight.** The loudest thing on a screen must carry the most meaning.
   *Forbids:* saturated decoration, glow on small controls, gradient-filled prices.
3. **One mechanism, held.** Depth is tone. Emphasis is size. Rank is content. Pick one carrier per axis and never stack substitutes.
   *Forbids:* gradient + border + shadow + inset bevel on one surface; hierarchy carried by weight because the type scale is too narrow.
4. **Colour is scarce and semantic.** A hue that means everything means nothing.
   *Forbids:* the accent as the generic "interactive" colour; two hues for money; four for caution.
5. **Trust looks institutional, never gamified.** A credential says an institution checked something; a tier says a platform is rewarding engagement — and buyers correctly discount the second.
   *Forbids:* rank gradients, tier ladders, emoji in trust chrome, scores without a published basis.
6. **The primitive is the path of least resistance.** If using the shared component produces a different result than not using it, the component loses.
   *Forbids:* primitives whose defaults differ from the majority treatment.
7. **Hebrew is the default, not the translation.** Every typographic decision is validated in Hebrew first.
   *Forbids:* uppercase and wide tracking as label mechanisms (both are no-ops or actively harmful in Hebrew); type floors set from Latin metrics.

### What "premium but accessible" means here

Conventional premium means lower contrast, lighter weight, more air. **All three are harmful in this product.** Contrast was already failing at 3.90:1 and 2.45:1 — there is no headroom to spend. Lighter weight destroys Heebo, which has no case and no ascender rhythm to carry legibility. More air on a `max-w-md` column pushes the primary action below the fold on a 375pt device. GetWorth also has **no identity graph to borrow trust from**, unlike Facebook Marketplace, so stripping trust affordances as "badge overload" would be the most expensive available mistake.

Premium here means **restraint in decoration and generosity in legibility** — the opposite trade to the usual one.

---

## 2. Token architecture

Three tiers. **Views may reference tier 2 and tier 3 only** — never a raw hex, never a tier-1 primitive.

| Tier | Where | Example |
|---|---|---|
| 1 — primitive values | `src/index.css` `:root` | `--gw-accent: 111 238 225` |
| 2 — semantic roles | `tailwind.config.js` | `bg-surface`, `text-muted`, `border-strong` |
| 3 — component tokens | props on `ui.jsx` primitives | `<Btn variant="primary">` |

### Why values are stored as RGB channels

```css
:root { --gw-surface: 28 27 27; }          /* channels, never hex */
```
```js
colors: { surface: 'rgb(var(--gw-surface) / <alpha-value>)' }
```

The previous tokens mapped to `var(--color-x)` — a **complete colour** — so Tailwind could not apply an opacity modifier and `bg-primary/20` silently produced nothing. The codebase's dominant idiom is exactly that, across ~999 alpha-bearing sites. **The token layer was architecturally incompatible with how the code is written**, which explains 0.89% adoption far better than discipline does. Fix the mechanism first; adoption follows.

> **Tailwind 3 accepts any integer slash modifier regardless of `theme.opacity`.** The config *cannot* close the alpha ladder — that has to be lint-enforced. Shrinking the opacity scale would also silently drop `bg-black/70` (12 live uses) to no background.

### The `text-primary` trap, resolved

Tailwind's `primary` colour used to be the brand hue, so the generated `text-primary` utility painted text **teal**, while `--color-text-primary` meant near-white body text and had **zero uses** — the naming made the correct token unusable, and both files documented the wrong one.

Now: the brand hue is **`accent`** (aliased `action-primary` for interaction). `text-primary` unambiguously means primary **text**.

---

## 3. Colour

### Neutrals — one temperature

Warm sage throughout. UI-001 found two greys of opposite temperature in the same viewport constantly — warm `#BBC9C7` (14 uses) beside cool slate `#94a3b8` (117 uses). Nobody names it; everybody feels "two designers". The cool ramp's lower steps were also the app's largest contrast failure.

| Token | Value | On canvas | On lightest surface |
|---|---|---|---|
| `canvas` | `#131313` | — | — |
| `surface` | `#1C1B1B` | — | — |
| `elevated` | `#201F1F` | — | — |
| `surface-high` | `#2A2A2A` | — | — |
| `surface-highest` | `#353534` | — | — |
| `text-primary` | `#EDEBEA` | 15.64:1 | 12.08:1 |
| `text-secondary` | `#C2CBC9` | 11.22:1 | 8.66:1 |
| `text-muted` | `#96A3A1` | 7.12:1 | **4.71:1** |

Every step is validated against the **lightest surface it may sit on**, not merely canvas. Checking only against canvas is how the previous ramp shipped a muted grey that failed on three of four surfaces.

### Accent — three jobs, not eleven

`#6FEEE1` previously signified brand, active tab, filter chip, verified, order-status, link, spinner, focus ring, price, progress, and unread. When the brand colour is also the generic "something is interactive" colour, it stops reading as a brand and starts reading as a template default.

**It now means exactly:** brand identity · primary action · current/selected state.

| Was accent | Is now |
|---|---|
| verified / trust | flat outlined `<Credential>` — never coloured |
| order-status "blue" | the semantic status ramp |
| spinner / skeleton | `text-muted` |
| price | `text-primary` |

### Semantic — one hue per meaning

| Token | Value | On canvas | As a badge (12% tint) |
|---|---|---|---|
| `success` | `#3FCF93` | 10.48:1 | 4.96–8.35:1 |
| `warning` | `#EFB03A` | 11.34:1 | 5.02–8.91:1 |
| `danger` | `#FF9E93` | 9.15:1 | 4.88–7.57:1 |
| `info` | *neutral* | — | — |

**`info` deliberately has no hue.** A blue info family would reintroduce exactly the pre-rebrand blue residue UI-001 flagged — the `Card glow` shipping `rgba(59,130,246,.15)` in a teal app. Informational surfaces use the neutral ramp and let the icon carry meaning.

**Collisions resolved:** money (green 53 + emerald 47) → `text-primary`, no hue at all. Caution (amber/yellow/orange/star) → one `warning`. Red doing both destructive *and* save → destructive only; save moves to accent. Purple, pink, cyan and residual blue are **deleted** — no token exists for them.

### Alpha ladder — closed

`/04 /08 /12 /20 /40 /64`. Replaces 22 improvised values across 26 spellings (`0.1` and `0.10` both appearing is proof they were typed from scratch). Lint-enforced, since the config cannot enforce it.

---

## 4. Typography

**Global application is the whole point.** The app preloaded three brand font files and then rendered ~99% of its text in the OS UI font, because `tailwind.config.js` extended only `colors` and nothing set a family. Preflight applies `fontFamily.sans` to `<html>`, so declaring it in the config fixes it globally.

```
sans    → Inter, Heebo, system-ui      (body — default everywhere)
display → Manrope, Heebo, system-ui    (.gw-display / font-display)
```

Hebrew resolves to Heebo automatically through the existing `unicode-range` aliases in `index.css`, including at the ~58 call sites that still name `'Manrope'`/`'Inter'` inline.

### Scale — role-named, closed

| Role | Size | Weight | Use |
|---|---|---|---|
| `text-display` | `clamp(2rem, 9vw, 2.75rem)` | 700 | The valuation reveal — the product's peak moment. Nothing else. |
| `text-title-lg` | 24px | 700 | Page / screen title |
| `text-title` | 18px | 600 | Section heading |
| `text-title-sm` | 16px | 600 | Card / list-row title |
| `text-body` | 15px | **400** | Default body |
| `text-body-sm` | 14px | 400 | Supporting prose |
| `text-label` | 13px | 500 | Form labels, button text |
| `text-meta` | 12px | 400 | Metadata, timestamps, counts — **the floor** |
| `text-price` | 24px | 600 | Money |
| `text-price-sm` | 18px | 600 | Money, inline |

**`text-meta` at 12px is the floor. Nothing smaller is sanctioned.** Hebrew raises it to 13px (`:lang(he)`), because Heebo has a smaller x-height at the same nominal size and no case distinction to aid word-shape recognition — the *default* language was strictly harder to read than the secondary one.

The old scale had ~20 discrete sizes with **65% of all text inside a 2px band** (`text-sm` 196 + `text-xs` 155). A scale with a 2px working range cannot express hierarchy, so hierarchy migrated to weight and colour — producing 346 bold-or-heavier tokens and **zero `font-normal`**. Body is now normal weight by design, with exactly two emphasis levels above it.

**Never use `uppercase` or wide tracking as a label mechanism.** Hebrew has no case, so `uppercase` is a no-op and the label degrades to "small + wide-tracked", which reads as broken letter-spacing.

---

## 5. Spacing and layout

8-point ladder: **4 · 8 · 12 · 16 · 24 · 32 · 48 · 64**. Semantic aliases: `gutter` (20px shell padding), `stack` (12px), `group` (24px), `section` (40px), `tap` (44px).

**Relationship rule** — the gap between two elements encodes whether they are one thought or two:

| Relationship | Gap |
|---|---|
| Same thought (label+value, icon+text) | 4–8 |
| Related but distinct (fields in a form, cards in a list) | 12–16 |
| New group / section break | 24–32 |
| Screen rhythm (hero → content) | 48+ |

Uniform spacing groups nothing. The old code put *the same 20px* between a search box and its category rail (tightly related) and between a result count and a six-card grid (a major structural break) — so spacing communicated nothing at all.

**Grid:** shell is `max-w-md mx-auto` with a fixed `px-gutter` (20px). Browse is `grid-cols-2 gap-4`. Do not vary the outer gutter per screen.

**`clamp()` is reserved for single hero/display elements** that must own the full viewport range. Every list, card and form uses the fixed ladder — two different clamp curves side by side are not comparable at a glance, which is exactly the "five gaps in one card" failure.

---

## 6. Radius, borders, elevation

**Radius — two values plus pills.** `control` 10px · `container` 16px · `rounded-full` for true pills only.

16px is chosen deliberately: `rounded-2xl` (78 uses) was the dominant ad-hoc card treatment while `<Card>` shipped `rounded-3xl` (13 uses), so **using the shared primitive produced a visibly different card than not using it** — a structural disincentive to adopt it. The nesting rule then falls out arithmetically: 16 − 6px inset = 10, so a correctly-padded control inside a card lands exactly on `control`.

**Borders.** `border-subtle` `#2E2D2D` for decorative grouping and dividers. `border-strong` `#7C8A86` for the boundary of an interactive component — inputs, focusable containers — which must clear WCAG 1.4.11's 3:1 on **every** surface it can sit on (3.41–5.16:1). The old `#3C4947` managed 1.98:1 and could not serve that role.

**Elevation is tonal, per Material 3.** Depth is carried by surface tone, not shadow.

| Level | Fill | Border | Shadow |
|---|---|---|---|
| e0 page | `canvas` | — | — |
| e1 card / row / input | `surface` | `border-subtle` | — |
| e2 menu / popover / selected | `elevated` | `border-subtle` | — |
| e3 dialog / sheet / toast | `surface-high` | `border-subtle` | `shadow-overlay` |

Shadow appears **only** where content floats over content it cannot predict. This replaces 18 inline `boxShadow` declarations in 13 distinct strings — no two alike — and removes the `Card` stack of gradient + border + shadow + `inset 0 1px 0` fake bevel, which simulated a light source no other element acknowledged.

**Glassmorphism is retired.** Blur survives only on the top app bar, bottom nav, and camera HUD — the three places where content genuinely scrolls underneath. `backdrop-blur-xl` was previously on **every** `Card`, including cards over an opaque background where it blurred nothing and cost a GPU layer.

---

## 7. Components

All primitives live in `src/components/ui.jsx`. Each is the only sanctioned way to render its role.

| Primitive | Purpose | Forbids |
|---|---|---|
| `Btn` | 4 variants × 3 sizes | Per-screen button treatments; sub-44px targets |
| `Card` | e1 surface | Stacked depth cues; blur; hover lift |
| `Badge` | Platform-asserted state | Solid fills with white text |
| `Chip` | A control the **user** sets | Looking like a fact |
| `Credential` | A fact backed by a stored value | `tier`, `color`, `variant`, caller-supplied labels |
| `InputField` | Labelled input | Unassociated labels |
| `Sheet` | **The** overlay | Any hand-rolled modal |
| `ConfirmSheet` | Destructive confirmation | — |
| `HitArea` | 44px hit-slop | Growing the glyph to hit target size |
| `EmptyState` / `ErrorState` / `LoadingState` | The three wait/none states | A failed load rendering as "you have nothing" |
| `AnchoredAction` | Thumb-zone primary action | Use on multi-action screens |
| `Toast` | Transient feedback | Saturated gradient surfaces |

### Badge / Chip / Credential — the taxonomy that survives a glance

UI-001 found a trust chip, a category filter and a valuation-confidence grade rendering **visually identically**, so a user could not tell a fact from a control from a machine judgement.

- **Facts are boxed** — `Badge` / `Credential`, 10px radius, outlined.
- **Controls are round** — `Chip`, full pill, always interactive.
- **Judgements are typographic** — no container at all.

### The only sanctioned badge recipe

Semantic text over its **own** 12% tint, with a 20% border. Solid, high-opacity fills with white text are **banned outright** — that pattern produced 1.71:1 on the condition badge, the single most price-relevant fact on a second-hand listing. The tinted form passes AA on every surface (4.88–10.22:1), verified in CI.

### Overlay contract

`Sheet` owns all of it, because these are behavioural properties of the overlay **role**, not styling choices: `role="dialog"` · `aria-modal` · `aria-labelledby` · focus trap · Escape · scrim-tap dismiss · body scroll lock · **focus restored to the trigger** · safe-area padding.

Previously: 11 hand-rolled copies, drifted to scrim `black/80` ×8 vs `black/70` ×4, **8 of 22** dismissing on scrim tap, **1 of 22** announcing as a dialog, **0 of 22** trapping focus. Half the sheets closed on outside tap and half trapped you — and on mobile, tap-outside is muscle memory, so a sheet that ignores it feels frozen.

---

## 8. Interaction states

Material 3 state layers: a full-bleed overlay in the content's own colour whose **opacity** encodes state. Applied via the `.state-layer` class.

| State | Opacity |
|---|---|
| Hover (pointer devices only) | 8% |
| Pressed | 12% |
| Selected (`aria-pressed`/`data-selected`) | 12% |
| Disabled | 40% content opacity, no layer, no pointer events |
| Focus | the ring below, plus the layer |

This replaces `active:scale-*`, which was applied inconsistently and far too slowly: `Card` used `transition-all duration-500`, so tapping a listing produced a **half-second** scale settle, while `Btn` used 80ms. A 6× difference in tactile response between the app's two primary tap targets is one of the most reliable "this feels cheap" signals there is, and it never shows up on a visual audit.

**Hover is gated behind `@media (hover: hover) and (pointer: fine)`.** There were 116 `hover:` utilities in a touch-first PWA, where hover either never fires or — worse — fires and *sticks* after a tap.

**Focus ring:** 2px `accent`, 2px offset, plus a canvas-coloured outer ring so it stays visible over photography. On accent-filled controls it **inverts to canvas** (13.27:1, the same pair reversed) — the one surface the teal ring cannot be seen against is teal.

**Motion:** one global `prefers-reduced-motion` rule using the universal selector, which reaches component-level `<style>` blocks. The previous rule enumerated ten transition classes and missed every infinite animation — shimmer, spin-slow, scan, progress, float, notifProgress, `animate-pulse`, and three concurrent loops in an inline `<style>` block the App.jsx query could never reach.

---

## 9. RTL / LTR

Hebrew is the **default** (`<html lang="he" dir="rtl">`).

- Use **logical properties**: `ps-`/`pe-`, `ms-`/`me-`, `start-`/`end-`, `text-start`/`text-end`. Never `text-left`/`text-right` — they do not flip.
- Mirror directional icons (chevrons) on `rtl`; never mirror logos, media controls, or numerals.
- The shekel sign is a hardcoded prefix and reads correctly in Hebrew commerce — leave it.
- **`uppercase` and wide tracking are forbidden as label mechanisms** (§4).
- Type floor rises to 13px under `:lang(he)`.
- Test every screen in Hebrew *first*. The existing RTL handling is structurally good — `dir` propagation, logical margins, direction-aware transitions, per-message direction detection in `Toast` — and should be preserved.

---

## 10. Accessibility minimums

Non-negotiable, and testable:

1. **Contrast** — body/label ≥4.5:1 against its *composited* background; non-text UI ≥3:1. Verified in CI by `scripts/check-contrast.mjs` (50 assertions).
2. **Touch targets** — ≥44×44px hit area via `min-h-tap`/`HitArea`. Padding counts; visual size may stay small.
3. **Zoom** — never `user-scalable=no` or `maximum-scale` < 5.
4. **Labels** — every input has an associated `htmlFor`/`id`; every icon-only control has `aria-label`.
5. **Focus** — everything interactive is Tab-reachable in visual order and shows the ring.
6. **Motion** — every animation neutralised under `prefers-reduced-motion`, including inline `<style>` blocks.
7. **Live regions** — async state changes the user did not initiate are announced (`aria-live`/`role="status"`).

---

## 11. Marketplace trust patterns

### The earned-vs-free rule

A signal may render as a **credential** only if a third party took a costly action the seller could not perform alone. Four tests, all must pass:

1. **Counterparty** — did someone other than the seller cause this value?
2. **Cost** — did producing it cost money, time, or exposure to a stranger? (Filling a form is not a cost.)
3. **Falsifiability** — is there a row in the DB that could be shown as the basis?
4. **Adversary** — could a fraudster with 30 minutes and no transactions reproduce it?

**EARNED** → may render as a credential, and must carry provenance. **FREE** → neutral metadata text only, never a chip. **DERIVED** → may never render above the signals it derives from.

The count of trust marks does **not** drop under this rule — three earned facts stand where one derived badge did. This is the opposite of badge reduction. **Trust surface area must not decrease; only its evidentiary quality increases.**

### Rules

- **Rank is expressed by content, never by hue.** "47 sales" beside "3 sales" *is* the ranking. Hue is reserved for state and is never applied to a person.
- **Trust values are read, never computed in a view.** This is the structural fix for the same seller showing a different badge one tap apart, which was only possible because the badge was computed at render time from inputs each caller supplied differently.
- **Every asserted number carries its basis** — an `n`/denominator, a ≤4-word source clause, and a reachable definition. If any is unavailable, the number does not render.
- **No rounding may favour the platform.** 4.5 renders as 4.5 or 4 stars, never 5.
- **"Verified" is reserved for facts an operator checked.** It may never be produced by a formula. See Phase 0 fix 1.
- **No seller-authoring feedback on a buyer surface.** See Phase 0 fix 2.
- **No dead safety controls.** An interactive-looking control with no action is worse than an honest absence — a user in distress taps the one thing that looks like help and gets silence. See Phase 0 fix 3.

---

## 12. AI and valuation presentation

These apply **anywhere a valuation appears** — results, publish, listing card, detail, chat, notification, email.

- **V1 — Two axes, permanently separate.** Identity confidence and pricing evidence never share a container, heading, or visual scale, and neither collapses into a single "accuracy" figure.
- **V2 — Precision may not exceed its source.** Pricing evidence is a verbal ordinal (Strong / Limited / Weak) and must **not** render as a percentage, bar, ring, meter or star. A bar's dimension may only be driven by the axis it is labelled with.
- **V3 — Unknown renders as an action, never a value.** `manual_required` → "Set your own price". Never ₪0, never "—", never an empty bar.
- **V4 — The disclaimer is structural.** `estimateOnly` renders outside every tier branch, on every surface showing a machine price. If a valuation crosses a screen boundary, the disclaimer crosses with it.
- **V5 — Identity hedging is part of the item name.** "Likely X" is a property of the string, not a decoration beside it, so a caller rendering only the name cannot drop it.
- **V6 — Uniform hedging.** *Every claim on a screen carries the confidence of the weakest evidence on that screen.* Prose is not exempt. No demand or speed-of-sale claim may render while comparable-sales observation is unbuilt. **One unhedged claim retroactively devalues every hedge on the screen.**
- **V7 — No mechanism theatre.** UI may state what the system is doing in user terms and what it produced. It may never describe internal mechanism, scale, or data volume. Test: *if this string were false, could a user ever discover it?* If not, it must not ship.

---

## 13. Correct and incorrect usage

```jsx
// ✅ Money — one ink, one weight, tabular figures
<p className="text-price gw-numeric text-text-primary">{formatPrice(price)}</p>

// ❌ Gradient-filled currency — the single strongest Temu signal
<p className="text-2xl font-bold bg-gradient-to-r from-green-400 to-emerald-400
              bg-clip-text text-transparent">{formatPrice(price)}</p>
```

```jsx
// ✅ Status — tinted pill, passes AA on every surface
<Badge tone="success">{t.completed}</Badge>

// ❌ Solid fill + white text — this is the 1.71:1 failure
<div className="bg-[#6FEEE1]/90 text-white text-[10px]">{condition}</div>
```

```jsx
// ✅ A fact, with its basis
<Credential icon={Check} label="12 completed sales" basis="Orders marked complete by both sides" />

// ❌ A rank rendered as a reward
<span className="bg-gradient-to-r from-yellow-500 to-amber-600
                 shadow-yellow-500/30">⭐ Elite Seller</span>
```

```jsx
// ✅ Small control, real target
<HitArea onClick={next} aria-label={t.nextPhoto}><span className="w-2 h-1 rounded-full bg-accent" /></HitArea>

// ❌ 6×4px hit area
<button className="w-1.5 h-1" onClick={next} />
```

```jsx
// ✅ A failed load is not an empty list
{error ? <ErrorState title={t.loadFailed} onRetry={reload} /> : items.length === 0 ? <EmptyState … /> : …}

// ❌ Both render as "you have nothing"
{items.length === 0 && <EmptyState title={t.noOrders} />}
```

---

## 14. Temu-removal rules

Mechanical, lint-backed where possible.

| # | Rule | Enforcement |
|---|---|---|
| 1 | Money is `text-primary`, never a gradient or a second hue | review |
| 2 | One overlay maximum on product imagery | review |
| 3 | No emoji in system chrome | `emoji-in-jsx` budget |
| 4 | Nothing below 12px (13px Hebrew) | `tiny-type` budget |
| 5 | No raw colour literals in views | `raw-hex` budget |
| 6 | Alpha only from the closed ladder | `off-ladder-alpha` budget |
| 7 | No promotional or fabricated-urgency copy | `promotional-copy` budget (0, hard) |
| 8 | No view-local token objects | `legacy-token-object` budget (0, hard) |
| 9 | No unbacked indicator; animation requires a real source | review |
| 10 | No rank gradient, glow, or tier ladder | review |
| 11 | Blur only on app bar, nav, camera HUD | review |
| 12 | Two radii; no arbitrary bracket values | review |
| 13 | One shadow token, e3 only | review |
| 14 | `font-normal` is the body default | review |

Budgets **only ratchet down**. Run `node scripts/design-lint.mjs --update` after migration work to lock in progress. Raising a budget requires justification in the PR.

---

## 15. Component adoption inventory

Counts measured at UI-002 landing. Priority: **P0** blocks UI-003 · **P1** first migration wave · **P2** opportunistic · **P3** deferred.

| Current | Inconsistency (measured) | Target primitive | Priority | Risk |
|---|---|---|---|---|
| Raw `<button>` ×158 vs `<Btn>` ×24 | ~20 distinct treatments; 3 radii, 9 padding recipes, 3 weights, 5 shadows; targets 30–64px | `Btn` | **P0** | Med — visual diff per screen |
| 11 bottom-sheet copies vs `ConfirmSheet` ×1 | scrim 80/70 split; 8/22 scrim-dismiss; 1/22 `role="dialog"`; 0/22 focus trap | `Sheet` | **P0** | Med — focus/scroll behaviour changes |
| `AppContext` loaders ×3 | `loadOrders`/`loadConversations`/`loadMessages` capture no error → failed load renders as empty | `ErrorState` | **P0** | Low — additive |
| Raw `<input>`/`<textarea>` ×32 vs `InputField` ×9 | **zero** `htmlFor` in the codebase | `InputField` | **P0** | Low |
| 7 badge colour registries | 4 alpha ladders, 2 mechanisms (class vs inline style) | `Badge` / `Credential` | **P1** | Med — trust semantics |
| Ad-hoc cards ×66 + inline panels ×54 | 5 surface treatments coexisting | `Card` | **P1** | Low — radius now matches majority |
| Photo-dot indicators ×2 | 6×4px and 8×8px hit areas | `HitArea` | **P1** | Low |
| Results CTA | off-screen on load at 375×667 | `AnchoredAction` | **P1** | Med — layout change |
| 5 loading treatments | pulse skeleton / shimmer / `Loader2` / SVG ring / pulsing text | `Skeleton` + `LoadingState` | **P2** | Low |
| `text-slate-*` ×281 | cool-grey intruder; `-500`/`-600` fail AA | `text-secondary`/`text-muted` | **P2** | Low — mechanical |
| 45 `135deg` gradients | LLM-default angle; decorative only | flat token surfaces | **P2** | Low |
| 17 `animate-pulse` | ~8 purely ornamental | delete | **P2** | Low |
| 5 ambient blur blobs | purple + cyan in a teal brand | delete | **P2** | Low |
| `computeSellerTrust` in views | same seller, two badges, one tap apart | server-side value | **P3** | High — needs backend |
| `AnalyticsView` telemetry | hardcoded 99.9% uptime, 4 fake "OK" lights | delete | **P3** | Low |

---

## 16. Migration strategy

**Sequencing matters.** Ship the mechanism before the policy — an adoption mandate issued before the channel-triplet form existed is precisely what produced 0.89%.

1. **Landed (UI-002).** Channel-triplet tokens · global font · type scale · spacing/radius/elevation/z-index ladders · primitives · contrast + lint gates in CI · 7 token declarations → 1 · 3 trust fixes.
2. **Wave 1 (P0).** `Btn` codemod; `Sheet` migration; `ErrorState` into the three loaders; `InputField` for auth and listing forms. Lower budgets after each.
3. **Wave 2 (P1).** Badge/Credential consolidation; `Card` adoption; `HitArea`; anchored results CTA.
4. **Wave 3 (P2).** `text-slate-*` purge; gradient and ornamental-pulse removal; loading convergence.
5. **Wave 4 (P3/UI-003).** Screen redesigns; server-side trust values; report/block schema.

**Rules for every migration commit**
- One primitive or one screen per commit. Never both.
- Run `--update` to ratchet budgets down; never up.
- Delete a `tokens.js` shim key when its last consumer becomes a className. The shim is finished when `STITCH` and `C` are empty.
- Any visual delta gets stated in the PR body. "No visual change" is a claim that must be true.

### Known debt carried forward

- `tiny-type` 181 and `raw-hex` 273 remain; both are budgeted and only ratchet down.
- `Card`'s `gradient` prop is honoured but deprecated, so ~20 tinted cards still render a tint.
- `Card`'s `glow` prop is accepted and **neutralised** (it emitted a blue glow in a teal app).
- `CameraResultsView.jsx:148-151` puts Tailwind classes inside a CSS `border` property — a real correctness bug the colour rules cannot catch. Needs a separate fix.
- The chat Report/Block flow is removed, not implemented: `reports` has no `reported_user_id`/`conversation_id`, and schema changes are out of UI-002 scope.
