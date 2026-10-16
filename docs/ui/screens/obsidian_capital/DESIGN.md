---
name: Obsidian Capital
colors:
  surface: '#111317'
  surface-dim: '#111317'
  surface-bright: '#37393d'
  surface-container-lowest: '#0c0e11'
  surface-container-low: '#1a1c1f'
  surface-container: '#1e2023'
  surface-container-high: '#282a2d'
  surface-container-highest: '#333538'
  on-surface: '#e2e2e6'
  on-surface-variant: '#bacbb9'
  inverse-surface: '#e2e2e6'
  inverse-on-surface: '#2f3034'
  outline: '#859585'
  outline-variant: '#3c4a3d'
  surface-tint: '#18e376'
  primary: '#46fc8b'
  on-primary: '#003918'
  primary-container: '#05df72'
  on-primary-container: '#005d2b'
  inverse-primary: '#006d34'
  secondary: '#ffb3b0'
  on-secondary: '#670211'
  secondary-container: '#881d24'
  on-secondary-container: '#ff9996'
  tertiary: '#ffd6bc'
  on-tertiary: '#4f2500'
  tertiary-container: '#ffb178'
  on-tertiary-container: '#794112'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#62ff96'
  primary-fixed-dim: '#18e376'
  on-primary-fixed: '#00210b'
  on-primary-fixed-variant: '#005226'
  secondary-fixed: '#ffdad8'
  secondary-fixed-dim: '#ffb3b0'
  on-secondary-fixed: '#410006'
  on-secondary-fixed-variant: '#881d24'
  tertiary-fixed: '#ffdcc5'
  tertiary-fixed-dim: '#ffb783'
  on-tertiary-fixed: '#301400'
  on-tertiary-fixed-variant: '#6e3908'
  background: '#111317'
  on-background: '#e2e2e6'
  surface-variant: '#333538'
typography:
  display-hero:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.03em
  headline-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  metric-num-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.02em
  metric-num-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.02em
  micro-badge:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 12px
    letterSpacing: 0.04em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 0.75rem
  margin: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system embodies high-frequency clarity, surgical precision, and institutional-grade poise calibrated for mobile-first retail investors navigating multi-currency, multi-broker portfolios. 

The aesthetic is ultra-minimalist and utility-driven. It eliminates unnecessary decoration, skeumorphism, and sluggish animations in favor of instantaneous data comprehension. Visual density is balanced with deliberate macro-whitespace and micro-gap structure, evoking the atmosphere of modern quantitative trading terminals re-imagined for an iPhone screen.

Key emotional tenets:
- **Absolute Composure:** Zero garish banners or gamified distractions; every pixel conveys portfolio health, exposure, and performance.
- **Instrument Precision:** Hairline dividers, strict tabular alignment, and crisp monospaced metric figures ensure unambiguous balance scanning under volatile market conditions.
- **Dual-Market Fluidity:** Intuitive spatial handling for disparate markets (NSE/BSE and NYSE/NASDAQ) with seamless currency duality (INR/USD).

## Colors

The palette relies on a pitch-tinted charcoal hierarchy that keeps OLED panels power-efficient while minimizing eye fatigue during late-night US market sessions.

### Surface Tiers
- **Canvas Base:** `#0D0F12` (True root background)
- **Surface Level 1:** `#14171D` (Card backgrounds, list containers)
- **Surface Level 2:** `#1A1E26` (Active states, elevated chips, nested cards)
- **Border / Outline:** `#262B35` (Razor-sharp structural strokes, 1px thickness)

### Typography & Icons
- **Text Primary:** `#F3F4F6` (High-contrast numbers, ticker titles, primary labels)
- **Text Secondary:** `#9CA3AF` (Subtitles, exchange tags, share counts, timestamps)
- **Text Muted:** `#4B5563` (Inactive tabs, unselected segments, subtle icons)

### Data Status Tokens
- **Gain / Bullish (Primary):** `#05DF72` (Vibrant electric emerald for affirmative metrics, sparklines, up-ticks)
- **Gain Tinted Glow:** `rgba(5, 223, 114, 0.12)` (Pill fill background for positive change)
- **Loss / Bearish (Secondary):** `#F87171` (Crisp coral red for drawdowns, down-ticks, loss values)
- **Loss Tinted Glow:** `rgba(248, 113, 113, 0.12)` (Pill fill background for negative change)
- **Neutral Accent:** `#60A5FA` (Cash balance, pending orders, multi-broker aggregation indicators)

## Typography

The type system is powered by **Inter**, configured with tabular numbers (`tnum`) across all numerical metrics to prevent horizontal layout jiggle during real-time streaming price updates.

Key typographic rules:
- **Metric Formatting:** Total Net Worth, Day P&L, and asset prices must employ `tnum` and `cv01` alternates where applicable.
- **Micro-Hierarchy:** Stock ticker symbols (`AAPL`, `RELIANCE`, `NVDA`) are set in uppercase `label-md` with `fontWeight: 600`, while the company legal name sits beneath in `body-md` with `Text Secondary` styling.
- **Scale Restraint:** Display sizes are capped at 36px on mobile viewports to prevent line-wrapping on 10+ digit Indian Rupee values (e.g., `₹12,45,230.50`) and USD conversions.

## Layout & Spacing

The architecture operates on an aggressive compact 4px base module, tuned for maximum screen utilization on 375px–430px mobile device viewports while remaining responsive across foldables and tablets.

### Layout Mechanics
- **Canvas Margins:** Fixed `1rem` (16px) left/right bounds on mobile, expanding to `1.5rem` (24px) on tablet viewports.
- **Component Padding:** Standard cards utilize `0.75rem` (12px) horizontal and vertical inner padding to conserve vertical real estate, enabling at least 5-6 asset rows above the fold.
- **Stack Rhythm:** 8px (`space-sm`) separates items within the same conceptual cluster; 16px (`space-lg`) marks the transition between disparate sections (e.g., Net Worth Overview to Broker Allocations).
- **Sticky Viewports:** The aggregate portfolio total, Day P&L summary, and segment switcher lock to the sub-header upon upward scroll, keeping primary financial vectors accessible at all times.

## Elevation & Depth

This system intentionally rejects diffused blur shadows and heavy ambient cast lights. In their place, visual hierarchy is constructed through **Tonal Stacking and Razor-Edge Hairlines**.

### Structural Tiers
- **Base (0dp):** Canvas backdrop (`#0D0F12`), completely flat, hosting root section headers and overall graph baselines.
- **Layer 1 (Card/List Surface):** `#14171D` encapsulated by a 1px solid stroke of `#262B35`. This provides crisp contrast separation without lifting the element toward the user.
- **Layer 2 (Interactive Floating Modules / Menus):** `#1A1E26` bound by `#262B35`. Overlays, bottom sheets, and multi-broker switcher drawdowns utilize an ultra-subtle backdrop tint (`rgba(13, 15, 18, 0.85)`) paired with a CSS backdrop filter blur of `12px` to isolate the focus area cleanly.

Zero blurred colored drop-shadows are permitted around performance percentages. Glowing aesthetics are strictly achieved through low-opacity background fills (`rgba(5, 223, 114, 0.12)`) confined cleanly within badge boundaries.

## Shapes

The geometric signature is precise, tight, and structured (`roundedness: 1`).

- **Standard Containers & Cards:** Rounded with `0.5rem` (8px, `rounded-lg`) to balance structural rigour with subtle ergonomic comfort.
- **Data Badges & P&L Pills:** Trimmed to `0.25rem` (4px, base rounded) or fully pill-shaped (only for interactive segment tabs).
- **Buttons & Control Sliders:** Radiused strictly to `0.375rem` (6px) to maintain a modern, industrial fintech feel rather than a bubbly consumer profile.
- **Dividers & Grid Lines:** Hairline 1px thickness without corner smoothing.

## Components

### Buttons
- **Primary Action (Deposit / Sync / Trade):** Fill `#05DF72`, text `#0D0F12` (`fontWeight: 600`), 0.375rem corner radius. Minimum height 42px on mobile. Pressed state transitions to `#10B981`.
- **Secondary / Broker Connect:** Background `#1A1E26`, border 1px solid `#262B35`, text `#F3F4F6`. Pressed state scales subtly to `opacity: 0.8`.
- **Destructive Action:** Border 1px solid `#EF4444`, transparent background, text `#F87171`.

### Data Cards & Asset Rows
- **Portfolio Summary Card:** Base `#14171D`, border 1px solid `#262B35`, radius 8px. Houses headline Net Worth in `#F3F4F6`, secondary benchmark delta (+1.82% / ₹14,200) enclosed in an emerald-tinted pill tag.
- **Holding Row Item:** Left-aligned column contains ticker symbol (bold 14px), legal name truncated with subtitle (12px `#9CA3AF`), and a miniature broker provenance dot (e.g., Zerodha Blue, Robinhood Green, Groww Teal). Right-aligned column contains the asset valuation (`tnum`, `#F3F4F6`) directly stacked on top of the percentage change badge.

### Status Chips & Pills
- **P&L Badge (Positive):** Background `rgba(5, 223, 114, 0.12)`, text `#05DF72`, `fontWeight: 600`, font size 11px, horizontal padding 6px, vertical padding 2px, radius 4px. Prefixed with `▲`.
- **P&L Badge (Negative):** Background `rgba(248, 113, 113, 0.12)`, text `#F87171`, `fontWeight: 600`, font size 11px, horizontal padding 6px, vertical padding 2px, radius 4px. Prefixed with `▼`.
- **Broker Source Pill:** Background `#1A1E26`, border 1px solid `#262B35`, text `#9CA3AF`, 10px uppercase tracking.

### Inputs & Selectors
- **Market / Search Field:** Inset fill `#14171D`, border 1px solid `#262B35`. Text input `#F3F4F6` with `#4B5563` placeholder. Focus ring switches border to `#60A5FA` with 0px outline spread.
- **Segmented Control (Timeframes 1D, 1W, 1M, 1Y, ALL):** Container `#14171D` with 4px inner padding. Active segment fills `#1A1E26` with 1px border `#262B35` and `#F3F4F6` active typography.

### Domain-Specific Components
- **Sparkline Vector Chart:** Monochromatic 1.5px stroke path rendered in `#05DF72` or `#F87171` based on interval delta; zero gradient flood under the curve.
- **Multi-Broker Health Indicator:** A segmented micro-bar visualizing total assets divided by connected source (e.g., 45% Zerodha, 35% Robinhood, 20% Groww) using distinct broker brand accents with a shared 1px black separation border.