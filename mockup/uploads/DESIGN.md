# Cursor — Style Reference
> Warm ivory software studio.

**Theme:** light

Cursor's design language evokes a functional, precise studio environment, blending the tactile feel of physical tools with the clean, digital interface of modern software. A foundation of warm, off-white backgrounds (#f7f7f4) and subtle, multi-layered shadows create a sense of depth and hierarchy, mimicking stacked, floating interface elements. Typography is highly refined, utilizing custom mono and gothic fonts with precise letter-spacing and stylistic alternates that convey technical sophistication.

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Canvas Parchment | `#f7f7f4` | `--color-canvas-parchment` | Page backgrounds, card backgrounds, neutral button backgrounds — provides a soft, warm foundation. |
| Inkwell | `#262510` | `--color-inkwell` | Primary text, strong borders, navigation text — grounds the lighter surfaces with significant contrast. |
| Muted Stone | `#7a7974` | `--color-muted-stone` | Secondary text, subtle borders, icon fills — a mid-tone gray for less prominent information or structural lines. |
| Deep Shadow | `#141414` | `--color-deep-shadow` | Deepest text variant — for maximum contrast on headlines or critical information. |
| Pebble Gray | `#e6e5e0` | `--color-pebble-gray` | Hover states on neutral buttons, subtle card backgrounds — visually lighter than Canvas Parchment, indicating elevation. |
| Onyx Outline | `#f54e00` | `--color-onyx-outline` | Outlined action button borders and link text — a vibrant orange indicating interactive elements without a solid fill. |
| Chartreuse Alert | `#4ade80` | `--color-chartreuse-alert` | supporting accents, small interactive text snippets — a vivid green for positive or noteworthy cues, often within code examples. |
| Goldenrod Accent | `#c08532` | `--color-goldenrod-accent` | Accent for specific interactive states or icons, often found in button backgrounds for 'Build' actions. |
| Forest Green Action | `#34785c` | `--color-forest-green-action` | Specific button backgrounds/borders like 'View PR' — a moderate green for distinct, yet secondary actions. |
| Highlight Beige | `#cdcdc9` | `--color-highlight-beige` | Subtle card backgrounds on nested elements, faint border color — a light neutral for separation with low visual weight. |

## Tokens — Typography

### CursorGothic — Primary UI text for headlines, navigation items, and larger body copy. The custom font with precise letter-spacing and stylistic alternates ("ss09", "ss08", "tnum") creates a technically sophisticated, almost code-like feel. · `--font-cursorgothic`
- **Substitute:** system-ui
- **Weights:** 400
- **Sizes:** 13px, 14px, 16px, 22px, 26px, 36px, 72px
- **Line height:** 1.00, 1.10, 1.20, 1.25, 1.30, 1.43, 1.50
- **Letter spacing:** -0.45, -0.35, -0.19, -0.08, 0.08, 0.18
- **OpenType features:** `"ss09", "ss08", "tnum"`
- **Role:** Primary UI text for headlines, navigation items, and larger body copy. The custom font with precise letter-spacing and stylistic alternates ("ss09", "ss08", "tnum") creates a technically sophisticated, almost code-like feel.

### berkeleyMono — Code snippets, input text, and small descriptive body copy. The monospaced nature reinforces the developer tool identity. · `--font-berkeleymono`
- **Substitute:** monospace
- **Weights:** 400, 500
- **Sizes:** 12px, 13px
- **Line height:** 1.21, 1.43, 1.50, 1.63, 1.67
- **Role:** Code snippets, input text, and small descriptive body copy. The monospaced nature reinforces the developer tool identity.

### Lato — Secondary and utility text across various components like buttons, links, and small informational sections. Its geometric sans-serif quality adds versatility. · `--font-lato`
- **Substitute:** sans-serif
- **Weights:** 400, 600
- **Sizes:** 10px, 12px, 14px, 16px
- **Line height:** 1.10, 1.27, 1.33, 1.50
- **Letter spacing:** 0.06
- **Role:** Secondary and utility text across various components like buttons, links, and small informational sections. Its geometric sans-serif quality adds versatility.

### EB Garamond — EB Garamond — detected in extracted data but not described by AI · `--font-eb-garamond`
- **Weights:** 400, 500
- **Sizes:** 16px
- **Line height:** 1, 1.5
- **Role:** EB Garamond — detected in extracted data but not described by AI

### -apple-system — -apple-system — detected in extracted data but not described by AI · `--font-apple-system`
- **Weights:** 400
- **Sizes:** 16px
- **Line height:** 1.5
- **Role:** -apple-system — detected in extracted data but not described by AI

### Type Scale

| Role | Size | Line Height | Letter Spacing | Token |
|------|------|-------------|----------------|-------|
| caption | 10px | 1.1 | 0.06px | `--text-caption` |
| body-lg | 14px | 1.43 | 0.08px | `--text-body-lg` |
| heading-sm | 22px | 1.25 | -0.08px | `--text-heading-sm` |
| heading | 26px | 1.2 | -0.35px | `--text-heading` |
| heading-lg | 36px | 1.1 | -0.45px | `--text-heading-lg` |
| display | 72px | 1 | -2.16px | `--text-display` |

## Tokens — Spacing & Shapes

**Density:** compact

### Spacing Scale

| Name | Value | Token |
|------|-------|-------|
| 4 | 4px | `--spacing-4` |
| 5 | 5px | `--spacing-5` |
| 6 | 6px | `--spacing-6` |
| 8 | 8px | `--spacing-8` |
| 10 | 10px | `--spacing-10` |
| 11 | 11px | `--spacing-11` |
| 12 | 12px | `--spacing-12` |
| 13 | 13px | `--spacing-13` |
| 15 | 15px | `--spacing-15` |
| 16 | 16px | `--spacing-16` |
| 18 | 18px | `--spacing-18` |
| 20 | 20px | `--spacing-20` |
| 22 | 22px | `--spacing-22` |
| 28 | 28px | `--spacing-28` |
| 43 | 43px | `--spacing-43` |
| 67 | 67px | `--spacing-67` |

### Border Radius

| Element | Value |
|---------|-------|
| cards | 4px |
| buttons | 4px |
| general | 4px |
| prominent | 8px |

### Shadows

| Name | Value | Token |
|------|-------|-------|
| xl | `rgba(0, 0, 0, 0.14) 0px 28px 70px 0px, rgba(0, 0, 0, 0.1)...` | `--shadow-xl` |
| xl-2 | `rgba(0, 0, 0, 0.25) 0px 25px 50px -12px, rgba(0, 0, 0, 0....` | `--shadow-xl-2` |
| subtle | `oklab(0.263084 -0.00230259 0.0124794 / 0.1) 0px 0px 0px 1...` | `--shadow-subtle` |

### Layout

- **Page max-width:** 1300px
- **Section gap:** 43px
- **Card padding:** 12px
- **Element gap:** 8px

## Components

### Primary Filled Button
**Role:** Interactive element

Solid Inkwell (#26251e) background, Canvas Parchment (#f7f7f4) text, 4px border-radius, with 17.5px padding on all sides. Used for primary calls to action.

### Ghost Action Button
**Role:** Interactive element

Transparent background, Inkwell (#26251e) text, 4px border-radius, with 2px vertical and 6px horizontal padding. Typically used for less prominent actions or text buttons within interfaces.

### Outlined Accent Button
**Role:** Interactive element

Transparent background, Onyx Outline (#f54e00) text and 1px border, 4px border-radius, often with 17.5px padding. Signals an important interaction without being a solid fill.

### Elevated Content Card
**Role:** Content container

Pebble Gray (#e6e5e0) background, 10px border-radius, with a multi-layered shadow: rgba(0, 0, 0, 0.14) 0px 28px 70px 0px, rgba(0, 0, 0, 0.1) 0px 14px 32px 0px, oklab(0.263084 -0.00230259 0.0124794 / 0.1) 0px 0px 0px 1px. No explicit padding mentioned in variants, implies content defines padding.

### Flat Background Card
**Role:** Content container

Canvas Parchment (#f7f7f4) background, 4px border-radius, no shadow. Padding 0px vertical and 7.5px horizontal. Used for subtle content grouping without strong visual separation.

### Text Input Field
**Role:** Form element

Transparent background, Muted Stone (#7a7974) border, Inkwell (#26251e) text, 0px border-radius, 8px horizontal and 6-8px vertical padding. Designed for content editing.

### Icon Button
**Role:** Interactive element

Transparent background with Muted Stone (#7a7974) border and text, 0px border-radius. Padding 0px on all sides, implies icon dictates clickable area not visual padding.

### Branding Card
**Role:** Informational display

Pebble Gray (#e6e5e0) background, 4px border-radius, no shadow on the card itself, but the text beneath may have a shadow. Used to display partner logos or small brand mentions.

## Do's and Don'ts

### Do
- Use CursorGothic for all headings and primary UI text, applying precise letter-spacing values (e.g., -0.45px at 72px, -0.08px at 22px).
- Elevate content with the multi-layered shadow token: rgba(0, 0, 0, 0.14) 0px 28px 70px 0px, rgba(0, 0, 0, 0.1) 0px 14px 32px 0px, oklab(0.263084 -0.00230259 0.0124794 / 0.1) 0px 0px 0px 1px.
- Apply Canvas Parchment (#f7f7f4) as the primary background for all major page sections and UI elements.
- Reserve Onyx Outline (#f54e00) exclusively for outlined interactive elements or prominent link text to signal primary action.
- Use 4px border-radius for most general rounded elements like cards and buttons, with 8px radius for more visually distinct components.
- Maintain a compact information density with an 8px element gap between related UI elements.
- Ensure input fields use a transparent background with Muted Stone (#7a7974) for borders, prioritizing readability of the input over strong visual containment.

### Don't
- Do not use solid background colors for primary call-to-action buttons; prefer bordered actions with Onyx Outline (#f54e00).
- Avoid arbitrary shadow values; adhere strictly to the defined multi-layered shadow for all elevated cards and elements.
- Never use purely achromatic grays for primary text or borders; always use Inkwell (#26251e) or Muted Stone (#7a7974).
- Do not introduce new font families or weights beyond CursorGothic (400), Lato (400, 600), and berkeleyMono (400, 500).
- Do not use the vivid accent color Onyx Outline (#f54e00) as a background fill for any component.
- Avoid large, uncontained background images; all visuals should appear within component bounds or as subtle, textural overlays.
- Do not vary letter-spacing for standard body text or inputs; only apply the specified letter-spacing values for CursorGothic headlines.

## Surfaces

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 0 | Canvas Parchment | `#f7f7f4` | Base page background, light card surfaces. |
| 1 | Pebble Gray | `#e6e5e0` | Elevated card backgrounds, hover states, subtle section differentiation. |
| 2 | Highlight Beige | `#cdcdc9` | Nesting card elements, subtle background variations within components. |

## Elevation

- **Elevated Content Card:** `rgba(0, 0, 0, 0.14) 0px 28px 70px 0px, rgba(0, 0, 0, 0.1) 0px 14px 32px 0px, oklab(0.263084 -0.00230259 0.0124794 / 0.1) 0px 0px 0px 1px`

## Imagery

The visual language for imagery is driven by product screenshots and UI examples, emphasizing the tool's functionality. These are typically contained within card-like structures, often floating with subtle shadows, and sometimes overlapping to create a dynamic, multi-windowed feel. The product screenshots themselves feature a dark UI with distinct syntax highlighting, contrasting with the light surrounding page, effectively showcasing the software environment. There is minimal photography; the focus is on UI and code. Icons are simple, monochrome, using Muted Stone (#7a7974) for fills, suggesting utility over embellishment. Density is balanced, with imagery illustrating explanations rather than dominating sections.

## Layout

The page adheres to a max-width of 1300px, creating a contained, spacious feel. The hero section is a split layout, featuring a prominent headline next to a contextual product screenshot, providing an immediate understanding of the tool. Content sections alternate between visually distinct blocks, often with a large left-aligned text column paired with right-aligned product imagery or stacked UI elements. A central element on the page is the responsive display of product screenshots, often overlapping, giving the impression of a live, multi-tasking interface on the screen. The overall rhythm is unhurried, with generous vertical spacing between sections, avoiding a dense, information-heavy presentation. Navigation is a simple top bar with distinct links and a primary download button.

## Similar Brands

- **Linear** — Similar focus on precise typography, subtle neutral palette, and nuanced elevation to create a sophisticated SaaS aesthetic centered on productivity.
- **Stripe** — Adopts a clean, light-themed UI with strong typography and a measured use of functional accent colors, echoing Cursor's blend of professionalism and subtle branding.
- **OpenAI** — Combines a light, spacious layout with restrained color application and a distinct focus on showcasing software interfaces and code, similar to Cursor's presentation of AI tools.
- **Figma** — Features a light UI with carefully selected typographic choices and the use of soft neutral tones contrasted with specific brand accents, much like Cursor's approach.

## Quick Start

### CSS Custom Properties

```css
:root {
  /* Colors */
  --color-canvas-parchment: #f7f7f4;
  --color-inkwell: #262510;
  --color-muted-stone: #7a7974;
  --color-deep-shadow: #141414;
  --color-pebble-gray: #e6e5e0;
  --color-onyx-outline: #f54e00;
  --color-chartreuse-alert: #4ade80;
  --color-goldenrod-accent: #c08532;
  --color-forest-green-action: #34785c;
  --color-highlight-beige: #cdcdc9;

  /* Typography — Font Families */
  --font-cursorgothic: 'CursorGothic', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-berkeleymono: 'berkeleyMono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --font-lato: 'Lato', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-eb-garamond: 'EB Garamond', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-apple-system: '-apple-system', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  /* Typography — Scale */
  --text-caption: 10px;
  --leading-caption: 1.1;
  --tracking-caption: 0.06px;
  --text-body-lg: 14px;
  --leading-body-lg: 1.43;
  --tracking-body-lg: 0.08px;
  --text-heading-sm: 22px;
  --leading-heading-sm: 1.25;
  --tracking-heading-sm: -0.08px;
  --text-heading: 26px;
  --leading-heading: 1.2;
  --tracking-heading: -0.35px;
  --text-heading-lg: 36px;
  --leading-heading-lg: 1.1;
  --tracking-heading-lg: -0.45px;
  --text-display: 72px;
  --leading-display: 1;
  --tracking-display: -2.16px;

  /* Typography — Weights */
  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  /* Spacing */
  --spacing-4: 4px;
  --spacing-5: 5px;
  --spacing-6: 6px;
  --spacing-8: 8px;
  --spacing-10: 10px;
  --spacing-11: 11px;
  --spacing-12: 12px;
  --spacing-13: 13px;
  --spacing-15: 15px;
  --spacing-16: 16px;
  --spacing-18: 18px;
  --spacing-20: 20px;
  --spacing-22: 22px;
  --spacing-28: 28px;
  --spacing-43: 43px;
  --spacing-67: 67px;

  /* Layout */
  --page-max-width: 1300px;
  --section-gap: 43px;
  --card-padding: 12px;
  --element-gap: 8px;

  /* Border Radius */
  --radius-sm: 1.5px;
  --radius-md: 4px;
  --radius-lg: 8px;
  --radius-xl: 12px;

  /* Named Radii */
  --radius-cards: 4px;
  --radius-buttons: 4px;
  --radius-general: 4px;
  --radius-prominent: 8px;

  /* Shadows */
  --shadow-xl: rgba(0, 0, 0, 0.14) 0px 28px 70px 0px, rgba(0, 0, 0, 0.1) 0px 14px 32px 0px, oklab(0.263084 -0.00230259 0.0124794 / 0.1) 0px 0px 0px 1px;
  --shadow-xl-2: rgba(0, 0, 0, 0.25) 0px 25px 50px -12px, rgba(0, 0, 0, 0.15) 0px 12px 24px -8px, oklab(0.263084 -0.00230259 0.0124794 / 0.1) 0px 0px 0px 0.5px;
  --shadow-subtle: oklab(0.263084 -0.00230259 0.0124794 / 0.1) 0px 0px 0px 1px, rgba(0, 0, 0, 0.28) 0px 18px 36px -18px;

  /* Surfaces */
  --surface-canvas-parchment: #f7f7f4;
  --surface-pebble-gray: #e6e5e0;
  --surface-highlight-beige: #cdcdc9;
}
```

### Tailwind v4

```css
@theme {
  /* Colors */
  --color-canvas-parchment: #f7f7f4;
  --color-inkwell: #262510;
  --color-muted-stone: #7a7974;
  --color-deep-shadow: #141414;
  --color-pebble-gray: #e6e5e0;
  --color-onyx-outline: #f54e00;
  --color-chartreuse-alert: #4ade80;
  --color-goldenrod-accent: #c08532;
  --color-forest-green-action: #34785c;
  --color-highlight-beige: #cdcdc9;

  /* Typography */
  --font-cursorgothic: 'CursorGothic', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-berkeleymono: 'berkeleyMono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --font-lato: 'Lato', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-eb-garamond: 'EB Garamond', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-apple-system: '-apple-system', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  /* Typography — Scale */
  --text-caption: 10px;
  --leading-caption: 1.1;
  --tracking-caption: 0.06px;
  --text-body-lg: 14px;
  --leading-body-lg: 1.43;
  --tracking-body-lg: 0.08px;
  --text-heading-sm: 22px;
  --leading-heading-sm: 1.25;
  --tracking-heading-sm: -0.08px;
  --text-heading: 26px;
  --leading-heading: 1.2;
  --tracking-heading: -0.35px;
  --text-heading-lg: 36px;
  --leading-heading-lg: 1.1;
  --tracking-heading-lg: -0.45px;
  --text-display: 72px;
  --leading-display: 1;
  --tracking-display: -2.16px;

  /* Spacing */
  --spacing-4: 4px;
  --spacing-5: 5px;
  --spacing-6: 6px;
  --spacing-8: 8px;
  --spacing-10: 10px;
  --spacing-11: 11px;
  --spacing-12: 12px;
  --spacing-13: 13px;
  --spacing-15: 15px;
  --spacing-16: 16px;
  --spacing-18: 18px;
  --spacing-20: 20px;
  --spacing-22: 22px;
  --spacing-28: 28px;
  --spacing-43: 43px;
  --spacing-67: 67px;

  /* Border Radius */
  --radius-sm: 1.5px;
  --radius-md: 4px;
  --radius-lg: 8px;
  --radius-xl: 12px;

  /* Shadows */
  --shadow-xl: rgba(0, 0, 0, 0.14) 0px 28px 70px 0px, rgba(0, 0, 0, 0.1) 0px 14px 32px 0px, oklab(0.263084 -0.00230259 0.0124794 / 0.1) 0px 0px 0px 1px;
  --shadow-xl-2: rgba(0, 0, 0, 0.25) 0px 25px 50px -12px, rgba(0, 0, 0, 0.15) 0px 12px 24px -8px, oklab(0.263084 -0.00230259 0.0124794 / 0.1) 0px 0px 0px 0.5px;
  --shadow-subtle: oklab(0.263084 -0.00230259 0.0124794 / 0.1) 0px 0px 0px 1px, rgba(0, 0, 0, 0.28) 0px 18px 36px -18px;
}
```
