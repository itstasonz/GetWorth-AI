# GetWorth Design System

**Status:** UI-002B foundation — landed, enforced by `npm test`, and the enforcement is itself tested.
**There is no CI runner in this repo.** No `.github/` exists, so every gate below runs only when a human types `npm test`. Earlier revisions of this document said "enforced in CI" four times; that was false and is corrected here. Wiring `npm test` into a required PR check is the single highest-leverage thing left — see § Known debt.
**Source of truth:** `src/index.css` (`:root`) → `tailwind.config.js` → `src/lib/tokens.js`.
**Enforced by:** `scripts/check-contrast.mjs` and `scripts/design-lint.mjs`, both wired into `npm test` (§15).
**Screens are not yet migrated.** UI-002B built and closed the system; UI-003 applies it. The budgets in §15 are the honest measure of how much of the old app is still standing.

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
| `IconButton` | Icon-only control | An unnamed icon; growing the glyph to reach 44px; `aria-pressed` on a non-toggle |
| `Card` | e1 surface | Stacked depth cues; blur; hover lift |
| `Badge` | Platform-asserted state | Solid fills with white text |
| `Chip` | A control the **user** sets | Looking like a fact |
| `Credential` | A fact backed by a stored value | `tier`, `color`, `variant`, caller-supplied labels |
| `InputField` | Labelled input | Unassociated labels |
| `TextArea` | Labelled multi-line input | Sub-16px type; an invisible character cap |
| `Stack` | Spacing rhythm | Off-scale gaps; `rtl ? a : b` for row order |
| `Section` | A titled region + its landmark | Unnamed landmarks; a section that paints its own box |
| `Sheet` | **The** overlay | Any hand-rolled modal |
| `ConfirmSheet` | Destructive confirmation | — |
| `HitArea` | 44px hit-slop | Growing the glyph to hit target size |
| `EmptyState` / `ErrorState` / `LoadingState` | The three wait/none states | A failed load rendering as "you have nothing" |
| `AnchoredAction` | Thumb-zone primary action | Use on multi-action screens |
| `Toast` | Transient feedback | Saturated gradient surfaces |

### Layout primitives have no visual opinion

`Stack` and `Section` deliberately render no background, border, radius or shadow. This is the rule that keeps a mobile screen from becoming a dashboard: nested panels each drawing their own box is what makes an app read as an admin console rather than a marketplace. A `Section` is a heading plus rhythm; if a region needs a surface, it contains a `Card` — it does not become one.

`Stack`'s `gap` accepts only the named scale (`none` · `tight` 8 · `stack` 12 · `group` 24 · `section` 40). There is no numeric escape, because a numeric `gap` prop reopens exactly the arbitrary-spacing hole the scale closes. An unrecognised value falls back to `stack` rather than emitting nothing.

### Dynamic class names must come from a lookup table

Never build a utility by interpolation:

```jsx
className={`items-${align}`}      // ✗ never emitted
className={STACK_ALIGN[align]}    // ✓
```

Tailwind's content scanner is a plain **text** match over the source. It never sees the completed name, so the rule is never emitted and the prop silently does nothing — while the rendered DOM looks correct in every test, because at runtime both forms produce the identical `className` string. This defect is invisible to a DOM test by construction; it is caught by the `interpolated-class` lint rule, which exists because a mutation run proved the DOM test could not catch it.

### Badge / Chip / Credential — the taxonomy that survives a glance

UI-001 found a trust chip, a category filter and a valuation-confidence grade rendering **visually identically**, so a user could not tell a fact from a control from a machine judgement.

- **Facts are boxed** — `Badge` / `Credential`, 10px radius, outlined.
- **Controls are round** — `Chip`, full pill, always interactive.
- **Judgements are typographic** — no container at all.

### The only sanctioned badge recipe

Semantic text over its **own** 12% tint, with a 20% border. Solid, high-opacity fills with white text are **banned outright** — that pattern produced 1.71:1 on the condition badge, the single most price-relevant fact on a second-hand listing. The tinted form passes AA on every surface (4.88–10.22:1), verified by `scripts/check-contrast.mjs`.

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

### Prefer the mechanism that cannot be got wrong

The codebase's dominant RTL idiom is a boolean prop and a ternary:

```jsx
className={`absolute ${rtl ? 'left-3' : 'right-3'}`}   // legacy
className="absolute end-3"                              // preferred
```

Both work. Only one is **correct by default**. The ternary form requires every call site to receive an `rtl` prop, remember to use it, and get the branch the right way round; nothing can lint it, and a missed site fails silently in the language most users see. Logical properties need no prop at all.

New primitives use flexbox and logical properties exclusively — a `Stack row` reverses under `dir="rtl"` with no prop and no conditional, and `Section`'s trailing action is placed by `justify-between` rather than pinned to a side. Migrating the ~40 existing ternaries is UI-003 work; writing new ones is not sanctioned.

---

## 10. Accessibility minimums

Non-negotiable, and testable:

1. **Contrast** — body/label ≥4.5:1 against its *composited* background; non-text UI ≥3:1. Verified by `scripts/check-contrast.mjs` (50 assertions), run from `npm test`.
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

## 15. Enforcement

A design system that is only documented decays at the speed of the next deadline. UI-001's root-cause finding was exactly that: a comment in `index.css` saying "screens can use `text-primary`" produced **zero** uses, and pointed at the wrong token.

So every rule that can be mechanised is mechanised, in `scripts/design-lint.mjs`, wired into `npm test`.

### The ledger

| Rule | Budget | Retired by |
|---|---|---|
| `raw-hex` | 273 | token classes / `tokens.js` |
| `tiny-type` | 180 | the 12px floor (13px Hebrew) |
| `emoji-in-jsx` | 44 | real icons |
| `off-ladder-alpha` | 17 | the closed `/04 /08 /12 /20 /40 /64` ladder |
| `decorative-gradient` | 77 | deletion — depth is tone |
| `glassmorphism` | 67 | deletion — opaque surfaces |
| `ad-hoc-shadow` | 44 | `raised` / `overlay` / `sheet` |
| `arbitrary-radius` | 246 | `control` 10 / `container` 16 / `full` |
| `legacy-token-import` | 5 | className adoption; then the shim is deleted |
| `interpolated-class` | **0** | — hard zero |
| `legacy-token-object` | **0** | — hard zero |
| `promotional-copy` | **0** | — hard zero |
| `focus-suppression` | **0** | — hard zero |
| `input-zoom-floor` | **0** | — hard zero |

A **budget** is a migration debt that may only fall. A **hard zero** is not a budget: each was fixed completely, and one reintroduction is a real regression rather than un-migrated legacy.

### The ratchet

`--update` used to rewrite every budget to the **current** count. That made "may only ratchet down" a matter of good manners: adding forty gradients and running `--update` turned a red build green and recorded the regression as the new normal — in a diff line that reads identically to a legitimate improvement.

`--update` now writes a number **only when it is lower**, and refuses the entire update if anything is over budget. There is no `--force`. Raising a budget means hand-editing the ledger, which is visible in review as exactly what it is.

### The linter is tested

`tests/design-lint.test.mjs` proves every rule **fires** on a real violation, against a zeroed ledger in a temp fixture tree. This is not ceremony: a rule whose regex stops matching after a refactor does not fail loudly — it reports a clean build forever, and the number in the ledger becomes a monument to a rule that no longer runs.

It also proves the ratchet refuses a raise **and writes nothing while refusing**, that no flag bypasses it, that the escape hatch is per-line, that naming an anti-pattern in a comment is not itself a violation, and that every rule has a budget entry — a rule without one compares against `undefined`, and `n > undefined` is `false`, so it could never fail.

`tests/mutations/ui-run.mjs` then attacks the linter itself: reverting the ratchet, deleting a budget entry, or breaking a rule's regex are all mutants that must be killed.

### What lint cannot do

Lint sees source, not pixels. It cannot judge whether a layout has hierarchy, whether a screen has one primary action, or whether copy is honest. Those stay human review items, and §13–14 are the checklist for them.

---

## 16. Component adoption inventory

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

## 17. Migration strategy

**Sequencing matters.** Ship the mechanism before the policy — an adoption mandate issued before the channel-triplet form existed is precisely what produced 0.89%.

1. **Landed (UI-002).** Channel-triplet tokens · global font · type scale · spacing/radius/elevation/z-index ladders · primitives · contrast + lint gates in `npm test` · 7 token declarations → 1 · 3 trust fixes.
1b. **Landed (UI-002A).** Overlay stack, focus trap, refcounted scroll lock, focus restore, toast lifecycle, reduced motion, iOS 16px inputs, focus rings — behaviour-tested and mutation-verified.
1c. **Landed (UI-002B).** `IconButton` · `TextArea` · `Stack` · `Section`; five decoration rules + `interpolated-class`; the `--update` ratchet; the linter's own test suite; elevation tokens de-duplicated between `tokens.js` and `index.css`.
2. **Wave 1 (P0).** `Btn` codemod; `Sheet` migration; `ErrorState` into the three loaders; `InputField`/`TextArea` for auth and listing forms. Lower budgets after each.
3. **Wave 2 (P1).** Badge/Credential consolidation; `Card` adoption; `HitArea`; anchored results CTA.
4. **Wave 3 (P2).** `text-slate-*` purge; gradient and ornamental-pulse removal; loading convergence.
5. **Wave 4 (P3/UI-003).** Screen redesigns; server-side trust values; report/block schema.

**Rules for every migration commit**
- One primitive or one screen per commit. Never both.
- Run `--update` to ratchet budgets down; never up.
- Delete a `tokens.js` shim key when its last consumer becomes a className. The shim is finished when `STITCH` and `C` are empty.
- Any visual delta gets stated in the PR body. "No visual change" is a claim that must be true.

### The budgets will not ratchet themselves

A budget seeded at the measured count **legalises the current level**. `decorative-gradient: 77` licenses any screen to keep gradients so long as it adds none, and the predictable outcome is that every UI-003 PR lands "no net new" and the number still reads 77 at the end — at which point the app looks the same and the lint suite reports success. A ratchet that only blocks increase is debt insurance, not debt repayment.

Three mechanisms, all decidable, to be in place before UI-003 step 1:

1. **Publish exit targets now**, as the acceptance criterion for the wave — gradients 0 (bar the three §14 survivors), glassmorphism 3 (app bar, bottom nav, camera HUD), arbitrary radii 0, legacy token imports 0.
2. **Assign each remaining count to a specific screen** in the order below, so every screen PR carries a numeric debt it must retire.
3. A PR that touches a view file and leaves every budget unchanged should be treated as incomplete.

### UI-003 order

Sequenced by *blast radius per unit of proof*, not by screen importance. Each step lowers a §15 budget, and the budget is the acceptance criterion — "it looks better" is not.

1. **`text-slate-*` purge and `raw-hex` sweep.** Mechanical, no layout risk, and it retires the largest number. Do it first so every later diff is readable.
2. **Radius convergence** (`arbitrary-radius` 246 → 0). Pure find-and-replace onto `control`/`container`; the two-value scale means there is nothing to decide per site.
3. **Gradient and glass deletion** (77 + 67 → near 0). Highest visual payoff of the whole programme. Expect real pixel change and state it in each PR.
4. **Shadow convergence** (44 → 0), including the four coloured glows still in the bundle.
5. **`Btn` / `InputField` / `TextArea` adoption** — the P0 rows in §16. Behavioural risk, so it goes after the cosmetic sweeps, not before.
6. **`Sheet` migration** for the remaining hand-rolled modals. Highest risk in the programme; UI-002A's overlay tests are the safety net.
7. **Screen redesigns**, in the order **Listing Detail → Marketplace → Valuation → Scan → Home → Profile → Orders → Chat.**

   *This order was corrected on review.* The earlier plan led with Valuation on the reasoning that the peak moment should set the language. That is backwards: Valuation is the **least typical** surface in the app — a one-off full-bleed moment with tier branching, an off-screen CTA needing a layout change, and a live correctness bug at `CameraResultsView.jsx:148-151` (Tailwind classes inside a CSS `border` property). What the other seven screens must inherit is the *repeating* vocabulary — card, row, price, condition badge, seller block, section header, empty state.

   **Listing Detail** contains every one of those in ordinary composition, is read-only, has no tier branching, and `ListingCard` falls out of it as a compression. **Marketplace second**, because a card at density is the actual Temu test — a card that survives a grid of 20 is proven. **Valuation third**: spend the language there, don't author it there. Scan is the least reusable surface (camera HUD, the one place blur stays legal) and belongs late.

### Live defects found by specialist review — UI-003 wave 0

Nine specialists reviewed the implemented UI-002B. These are verified, pre-existing, and out of UI-002B's scope; several are more serious than anything the design work addressed. **Fix these before any screen redesign begins.**

**Keyboard and screen-reader**
1. **`Card` with `onClick` renders a non-interactive `<div>`** — `ui.jsx` `Card`, live at `ListingCard.jsx:79`. No `role`, no `tabIndex`, no Enter/Space handler, so the app's primary browse affordance is unreachable by keyboard or switch control. **Highest-severity accessibility defect in the codebase.** Fix in the primitive.
2. **The document language never updates.** `index.html` is `lang="he"`; `App.jsx` sets `dir` on a wrapper div and never writes `lang` to `<html>`. English UI is announced in a Hebrew voice (WCAG 3.1.1), and `:lang(he)` applies the 13px Hebrew floor to English text.
3. `BackButton` emits a `<button>` with no `type` — it submits any enclosing form.
4. `Toast` accepts an `rtl` prop and never reads it.

**Trust honesty — the gap UI-002B should have closed**
5. **`CameraResultsView.jsx:1130,1436` render "מאומת"/"Authenticated"/"Authenticity Verified" with Shield glyphs, derived from an AI `authenticityStatus`.** This is the exact defect UI-002A fixed one layer down in `utils.js`, still live one layer up: reserved wording, reserved glyph, machine source.
6. **A degraded valuation renders ₪0 as a confident price.** `valuation-guard.js` emits 0/0/0 with `MANUAL_REQUIRED`, but `analyze.js` only maps to `manual_required` when `pricing_source` also says so, so the degrade path falls through to `ai_estimate` and `CameraResultsView.jsx:1251` prints `formatPrice(0)` at 5xl under an "estimate" disclaimer. **Branch on `mid > 0`, never on a status string.**
7. `computeSellerTrust` runs at render time in `BrowseDetailView.jsx:307,589` — the "computed in a view" pattern §11 bans, and the cause of "same seller, two badges, one tap apart".
8. `getSellerBadgeStyle` still returns per-tier gradient/shadow/gold/purple (`utils.js:248-256`), consumed at four call sites. §11's "rank is expressed by content, never by hue" is text only.

**Mobile**
9. **`AnchoredAction` has zero call sites and its z-order is inverted** — it uses `z-sticky` (20) while the bottom nav is a raw `z-40`, so an anchored CTA would paint *behind* the nav. The first UI-003 screen to adopt it hits this.
10. **`ImageGallery` is broken under RTL** — the flex track reverses, `translateX(-current*100%)` does not, so slides move away from the viewport.
11. **`ScreenTransition` runs backwards in Hebrew** — CSS transforms are direction-blind. Both this and #10 are fixed by one mechanism: a `--gw-dir: 1/-1` custom property on `[dir]`, with keyframes written as `translateX(calc(var(--gw-dir) * 100%))`.
12. **58 `active:scale-*` remain against 6 `state-layer` uses.** The M3 state layer did not displace what it replaced; the invariant is prose in `ui.jsx` and enforced nowhere.
13. No `-webkit-tap-highlight-color` reset — the OS paints its own rectangle above the state layer, so a `rounded-full` Chip shows a rectangular highlight.

**Enforcement**
14. **`design-lint.mjs` never reads `.css` or the Tailwind config** (`walk()` filters `/\.(jsx?|mjs)$/`). Decoration moved out of JSX into CSS escapes every budget — the cheapest way for UI-003 to "reduce" a number without deleting anything.
15. **No negative fixtures.** Broadening `arbitrary-radius` to match `rounded-full`, or stripping `ad-hoc-shadow`'s sanctioned-vocabulary lookahead, leaves all lint tests green. The false-positive side of every new regex is untested.
16. `off-ladder-alpha` permits fourteen values while §3 claims six.
17. The token-drift rule still does not exist, so `tokens.js` — exempt from `raw-hex` — is verified by nothing. `tokens.js` declares `sunken: '#0E0E0E'` against a `--gw-sunken` that is **not in `index.css`**: live drift, today.

### Found by adversarial review, not yet fixed

An independent critique of UI-002B verified the following. All are real; none are fixed, and each is listed here rather than quietly left in place.

1. **No CI runner.** `npm test` is the only gate and a human has to type it. Wiring it to a required PR check is worth more than every other item on this list combined. *Nothing else here matters without it.*
2. **The alpha ladder is not closed.** §3 says `/04 /08 /12 /20 /40 /64`; `off-ladder-alpha` actually permits fourteen values (it also allows 5/10/30/50/60/70/80/90). The lint opened the ladder the doc claims it closes.
3. **The token-drift rule does not exist.** Comments in `design-lint.mjs` and `tokens.js` claimed for two phases that the `@gw` annotations are checked against `index.css`. Nothing reads them. Both comments are now corrected to say so, but `tokens.js` remains exempt from `raw-hex` and therefore unverified.
4. **`emoji-in-jsx` is budgeted at 44, and some are on trust surfaces** — `OrderViews.jsx:676` renders `⭐` on a rating surface and `:642` a `🎉`, against §1.5's ban on emoji in trust chrome.
5. **`tiny-type` only matches `text-[Npx]`.** An inline `fontSize: '0.6rem'` (9.6px) at `SellViews.jsx:85` is below the floor and invisible to the rule.
6. **Budgets are global totals, not per-file.** Deleting a gradient in one file funds adding one in another.
7. **Fabricated telemetry still ships** — `AnalyticsView.jsx:222` renders a hardcoded `99.9%` beside a green dot, which §1.1 forbids outright.
8. **Purple is live** at `CameraResultsView.jsx:2270` despite §3 stating no token exists for it, inside a `🔬 Pipeline Debug` panel on a user surface.
9. **The four new primitives have zero call sites outside `ui.jsx`.** §1.6 says the primitive must be the path of least resistance; four primitives nobody imports are a path nobody is on. UI-003 step 5 is where that changes.
10. **Nothing observes a rendered pixel.** Fourteen lint rules grep source; fifty contrast assertions compare declared tokens to each other. Live classes like `text-yellow-400` and `text-emerald-200` are unmeasured — which is the same shape as the failure that motivated the whole token rewrite. A headless render sampling one composited pixel would close it.

**What the review confirmed is genuinely fixed:** the `--update` ratchet is mechanical rather than mannerly; `tests/design-lint.test.mjs` proves each rule fires; and the `DESIGN_LINT_SRC` bypass it found — one env var made all rules pass over an empty directory — now requires an explicit `--fixture` flag, with a test asserting the corpus cannot be redirected by environment alone.

**An honest label for UI-002B:** it is a *measurement and enforcement* release, not a visual one. The application is byte-identical to before it apart from two pixel-equivalent swaps. What changed is that the numbers are written down and cannot grow.

### Known debt carried forward

- `tiny-type` 181 and `raw-hex` 273 remain; both are budgeted and only ratchet down.
- `Card`'s `gradient` prop is honoured but deprecated, so ~20 tinted cards still render a tint.
- `Card`'s `glow` prop is accepted and **neutralised** (it emitted a blue glow in a teal app).
- `CameraResultsView.jsx:148-151` puts Tailwind classes inside a CSS `border` property — a real correctness bug the colour rules cannot catch. Needs a separate fix.
- The chat Report/Block flow is removed, not implemented: `reports` has no `reported_user_id`/`conversation_id`, and schema changes are out of UI-002 scope.
- **`shadow-raised` has zero call sites.** The elevation scale declares three steps and only two are used. Either adopt it during UI-003 step 4 or delete it — a token with no consumer is a claim the system does not keep.
- **Four coloured glows are live in the bundle** (`shadow-green-500`, `shadow-purple-500`, `shadow-red-500`, `shadow-slate-500`). They are inside the `ad-hoc-shadow` budget; the CSS contract suite separately guarantees none can arrive via a *token*.
- **`src/components/ui.jsx` is ~1,060 lines** against the repo's 500-line guideline. Splitting it was deliberately deferred: `tests/ui-interaction.test.mjs` and the mutation harness bundle it as their entry point, and UI-002B's remit was explicitly not to churn production-verified overlay code. The split (a barrel re-exporting `ui/overlay`, `ui/forms`, `ui/layout`, `ui/feedback`) belongs in UI-003 step 5, where the primitives are being touched anyway.
- ~40 `rtl ? a : b` ternaries remain in views. New code uses logical properties (§9); migrating the old ones is UI-003.
