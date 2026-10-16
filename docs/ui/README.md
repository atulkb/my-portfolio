# UI Reference (Google Stitch screen designs)

Screen designs (generated with Google Stitch) are the visual reference for the LLD and implementation. Claude Code can read PNG/JPG/PDF files directly, so **the exported PNGs are the source of truth**; HTML and markdown add exact values and intent.

## Folder layout
Stitch exports are kept **exactly as downloaded**, one folder per screen. The table below maps each folder to a screen ID used in the HLD/LLD.
```
docs/ui/screens/
├── obsidian_capital/DESIGN.md      # design system "Obsidian Capital": colours, typography, spacing, components
└── <stitch_screen_folder>/
    ├── screen.png                  # visual reference (source of truth for layout)
    └── code.html                   # exact colours, spacing, copy (reference only, never shipped)
```
- The HTML is a **design reference**. The app is React Native, so Tailwind values are translated into RN components and theme tokens (from `DESIGN.md`) rather than copied.
- Re-exporting a screen from Stitch: replace the folder; git keeps the history.
- Stitch fills screens with sample data; the numbers are not requirements.

## Screen index

| ID | Screen | Stitch folder | Status |
|---|---|---|---|
| S01 | Login | `login_obsidian_capital` | ✅ reviewed |
| S01a | Sign up | `sign_up_obsidian_capital` | ✅ reviewed |
| S02 | Portfolio | `portfolio_dashboard_us_india_tracking` | ✅ v2 reviewed |
| S02a | Portfolio → Filter sheet | `filter_holdings_portfolio_subscreen` | ✅ reviewed |
| S02b | Portfolio → Holding actions sheet (research / edit buys by broker / remove all) | `portfolio_dashboard_stock_operations` | ✅ reviewed ("Keep history" = disabled placeholder) |
| ~~S03~~ | ~~Stock holding detail~~ | — | dropped: individual buys are edited via S02b → Edit |
| S04 | Research / Deep Analysis | `nvda_deep_analysis_ai_verdict_research` | ✅ reviewed |
| S05 | CSV upload: + button menu (Add stock / Upload CSV) → system file picker → success toast **or** error sheet (row · column · issue · suggested fix) | — | optional: design the expanded + menu and the error sheet |
| S06 | Add / Edit holding | `add_stock_manually_portfolio_subscreen` | ✅ reviewed |
| S07 | Watchlist | `watchlist_ai_signals` | ✅ reviewed |
| S08 | Rules hub | `create_rule_ai_rule_studio` ⚠️ | ✅ reviewed |
| S08a | Create Rule sheet | `rules_active_rules_ai_studio` ⚠️ | ✅ reviewed |
| S09 | Settings | `settings` | ✅ reviewed (delete-account confirm sheet to be built in the same style) |

⚠️ The two Rules folders look swapped: `create_rule_…` contains the Rules hub and `rules_active_rules_…` contains the Create Rule sheet. Rename on the next export if you like; the mapping above is correct either way.

## Extra notes (optional)
For complex screens add `requirements.md` to the screen folder describing: purpose, data shown (field → source), user actions, navigation targets, and edge states. This is what turns a picture into an implementable spec.
