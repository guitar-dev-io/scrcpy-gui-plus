# Design System

## Status

This contract formalizes the visual language already present in the application. The reference images are currently placeholder text, so these values are intentionally conservative. They may be tuned after real assets are supplied, but semantic names and component APIs should remain stable.

Phase 2 defines foundations only. Existing pages are not migrated in this phase.

## Principles

- Use semantic roles instead of hard-coded palette values in new components.
- Preserve all five accent themes and light/dark/system modes.
- Keep application state, commands, IPC, and device logic outside UI primitives.
- Compose primitives with native HTML props and accessible defaults.
- Use existing localized strings when primitives are adopted by feature UI.
- Respect reduced-motion preferences.

## Colors

### Accent

| Token | Role |
| --- | --- |
| `--primary` | Current theme accent |
| `--text-on-primary` | Content displayed on the accent |
| `--focus-ring` | Keyboard focus indication derived from the accent |

Supported accent themes remain `ultraviolet`, `astro`, `carbon`, `emerald`, and `bloodmoon`.

### Content and surfaces

| Token | Role |
| --- | --- |
| `--bg-base` | Application background |
| `--bg-surface` | Standard panel and control surface |
| `--bg-elevated` | Menus, dialogs, and raised surfaces |
| `--bg-input` | Input and interactive control fill |
| `--text-base` | Primary content |
| `--text-muted` | Secondary content |
| `--text-subtle` | Hints and low-emphasis metadata |
| `--border-base` | Standard boundary |
| `--border-subtle` | Low-emphasis divider |
| `--glass-bg` | Translucent panel background |
| `--glass-border` | Translucent panel boundary |

### Feedback

| Token | Value | Role |
| --- | --- | --- |
| `--status-success` | `#10b981` | Connected, complete, healthy |
| `--status-warning` | `#f59e0b` | Attention or degraded state |
| `--status-danger` | `#ef4444` | Errors and destructive actions |
| `--status-info` | `#3b82f6` | Informational state |

## Typography

The default stack remains `Inter, system-ui, Avenir, Helvetica, Arial, sans-serif`.

| Token | Size | Intended use |
| --- | --- | --- |
| `--font-size-caption` | `9px` | Compact metadata |
| `--font-size-label` | `10px` | Uppercase control and section labels |
| `--font-size-body-sm` | `12px` | Secondary body copy |
| `--font-size-body` | `14px` | Standard body copy |
| `--font-size-title` | `16px` | Panel and page titles |

Labels use `--tracking-label`; body copy uses `--line-height-body`.

## Spacing

The base scale is 4, 8, 12, 16, 20, 24, and 32 pixels through `--space-1` to `--space-8`. New components should prefer this scale over arbitrary values.

## Radius

| Token | Value | Role |
| --- | --- | --- |
| `--radius-sm` | `6px` | Compact controls and badges |
| `--radius-md` | `8px` | Standard controls |
| `--radius-lg` | `12px` | Nested cards |
| `--radius-xl` | `16px` | Panels |
| `--radius-2xl` | `24px` | Dialogs and major surfaces |
| `--radius-round` | full | Pills and circular controls |

## Shadows

- `--shadow-sm`: subtle control separation.
- `--shadow-md`: standard panel elevation.
- `--shadow-lg`: dialogs and major overlays.

## Motion

Durations use `--duration-fast`, `--duration-base`, and `--duration-slow` with `--ease-standard`. They resolve to zero when the operating system requests reduced motion.

## Components

Reusable primitives live under `src/components/ui/`:

- `Button`: primary, secondary, ghost, and danger variants; small, medium, and large sizes.
- `IconButton`: accessible icon-only action requiring a label.
- `Panel`: surface, glass, and elevated container variants.
- `SectionHeader`: consistent title, optional description, icon, and action slot.
- `Badge`: neutral, accent, success, warning, and danger statuses.

Primitives accept native element props and `className` overrides. They contain no application state, services, commands, or IPC calls.

## Adoption Rules

1. Do not perform a global mechanical replacement.
2. Adopt primitives page by page during the approved migration phase.
3. Keep existing feature components operational until their replacement passes parity checks.
4. Do not change local-storage keys, IPC payloads, or handler contracts during visual adoption.
5. Validate keyboard focus, disabled states, contrast, localization expansion, and reduced motion for each migrated page.
