# GameVault Design System

## Product Frame

- Product type: self-hosted gaming vault and desktop-style store client
- Direction: Steam-like command deck with richer media surfaces and cleaner admin ergonomics
- Source motifs preserved from current product: dark shell, cool indigo accent, dense library browsing, utility-first controls, media-led cards

## Core Principles

1. Cover art first. Game media carries emotion; chrome stays restrained.
2. Dark by default. Shell should feel like launcher software, not marketing site.
3. Dense, not cramped. High information throughput with strong spacing rhythm.
4. Cool accent hierarchy. Indigo drives primary actions, cyan drives focus and live state, green handles installed/running success.
5. Utility with polish. Every control must feel fast, legible, and deliberate.

## Tokens

### Color

- `gv-bg`: app canvas
- `gv-shell`: outer shell / sidebar body
- `gv-panel`: default content panel
- `gv-panel-strong`: raised card / modal surface
- `gv-panel-soft`: inline control well / muted panel
- `gv-text`: primary foreground
- `gv-muted`: secondary copy
- `gv-line`: default border/divider
- `gv-line-strong`: emphasized border/hover edge
- `gv-accent`: primary accent
- `gv-accent-strong`: pressed / active accent edge
- `gv-accent-cool`: focus / active UI highlight
- `gv-success`: installed / ready state
- `gv-warning`: news / caution state
- `gv-danger`: destructive / failure state

### Typography

- Family: Inter everywhere; no decorative display font
- Heading weight: 700 with tight tracking
- Body: 400 to 500
- Meta labels: uppercase, `0.72rem`, high tracking
- Dynamic numbers: tabular numerals

### Spatial

- Base rhythm: 4px / 8px
- Panel radius: 24px to 28px
- Control radius: 14px to 18px
- Card radius: 20px to 24px
- Touch targets: minimum 44px

### Depth

- Outer shell: blurred translucent dark layer
- Cards: layered soft shadow plus 1px cool border
- Media actions: compact glass chips over cover art

### Motion

- Default: 150ms to 220ms `cubic-bezier(0.23, 1, 0.32, 1)`
- Hover: border + lift + shadow, never layout shift
- Press: `scale(0.98)` max
- Reduced motion: keep color/opacity feedback, cut transforms and long transitions

## Component Rules

### Sidebar

- Sidebar is its own shell panel, not flat page edge
- Active row gets filled panel plus accent rail
- Footer identity block sits on stronger contrast than nav body

### Buttons

- Primary: indigo fill, dark text inversion only when needed
- Secondary: soft dark panel with cool border on hover
- Icon buttons on media: translucent shell chip with 1px border

### Inputs and Filters

- Filters live inside panel wells, not white form fields
- Focus ring uses `gv-accent-cool`
- Labels use uppercase metadata style for scan speed

### Cards

- Cover cards keep art edge-to-edge
- Metadata stays compact below image
- Action affordances float over media corners

### Auth

- Auth pages share same launcher shell, simplified and centered
- Keep copy brief and utilitarian

## Accessibility Rules

- Focus always visible with cool cyan ring
- Normal text >= 4.5:1 in light and dark
- Interactive hit areas >= 44px
- Color never sole signal for filters, auth errors, or news state

## Anti-Patterns

- Flat black surfaces with no layering
- Random rainbow accents outside semantic badge use
- Marketing-style giant hero sections in app views
- Mixed rounded scales inside same component tree
- White-form-on-dark-shell contrast mismatch