# Opportunity Engine visual system

Opportunity Engine uses graphite surfaces and signal red to express discovery and active work. The existing routes, APIs, permissions, workflow states, and semantic status mappings are preserved.

## Shared tokens

`tailwind.config.js` defines the `graphite` neutral scale, `accent` signal scale, and named `console` surfaces. `src/index.css` supplies shared control treatments, focus indicators, table typography, responsive navigation, and reduced-motion support.

- Base: `#111318`; raised: `#171A20`; panel: `#1D2027`; selected: `#252932`.
- Border: `#30343D`; primary text: `#F5F7FA`; secondary: `#A7ADB7`.
- Brand red: `#E10600`; interaction red: `#FF241D`; dark red: `#3A1112`.
- Lighter accent shades are used for readable small text. Bright red is reserved for edges, fills, and progress.
- Emerald means success, amber means review/warning, rose means failure/destructive, and sky means information. These retain labels and existing state semantics.

## Reusable treatments

`oe-primary` adds a crisp border and restrained inner highlight to existing primary actions. It has a solid red fallback and does not belong on destructive actions or ordinary status badges. `oe-selected` adds a signal rail to selected opportunity rows. `oe-nav-active` adds a persistent underline alongside the active background and router-provided current-page semantics. `oe-filter-active` marks non-default filters. `oe-kpi` and `oe-kpi-value` are available for compact workload summaries. The release preserves the existing root redirect and batch routes; the unmerged dashboard feature is excluded.

Tables retain their existing local horizontal scroll containers on small screens. Navigation becomes a scrollable second row below desktop width. The review stepper wraps; keyboard focus uses an offset high-contrast outline. Numeric table values and KPIs use tabular figures.

Use the shared tokens for new components instead of adding isolated hex colours. Keep the polished treatment limited to primary actions; ordinary red indicators stay flat.
