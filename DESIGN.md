# Portfolio AI — Design System

Design tokens and component patterns extracted from the live codebase. All dark-theme styles are applied via inline `style={{}}` props — CSS variable utility classes (`bg-card`, `text-muted-foreground`, etc.) resolve to light-theme values and must not be used for dark UI.

---

## Color Palette

### Backgrounds

| Token | Value | Usage |
|-------|-------|-------|
| Page background | `#0A0B14` | All page wrappers (`min-h-screen`) |
| Sidebar | `#0d0d16` | Left nav + top bar |
| Card surface | `#1a1d27` | Cards, dropdowns, tooltips |
| Metric strip / dark inset | `#111219` | Stats strips, nested inset sections |

### Accent — Gold

| Token | Value | Usage |
|-------|-------|-------|
| Gold primary | `#C9A84C` | Borders, text, icons, active states |
| Gold warm | `#EBB66A` | Gradient endpoint, chart highlights |
| CSS var `--accent` / `--gold` | `#d4af37` | Tailwind var (not used in dark UI) |

Gradient (active toggle, submit button backgrounds): `linear-gradient(135deg, #C9A84C, #EBB66A)`

### Status / Semantic

| Status | Color | Usage |
|--------|-------|-------|
| Active / success | `#22c55e` | Active badge, closed deals, positive growth |
| Building / warning | `#f97316` | Draft or in-progress states |
| Idle / muted | `#6b7280` | Inactive, secondary labels |
| Error / destructive | `#ef4444` | Error states, delete confirm |
| Blue | `#60a5fa` | Curative Title template |
| Purple | `#a78bfa` | Wholesale Pipeline template |
| Cyan | `#22d3ee` | Content Strategy template |
| Indigo | `#818cf8` | Business Acquisition template |

### Text

| Token | Value | Usage |
|-------|-------|-------|
| Primary | `#ffffff` | Headings, card titles, values |
| Secondary | `rgba(255,255,255,0.45)` | Subtitles, description text |
| Muted | `rgba(255,255,255,0.35)` | Supporting copy |
| Dim | `rgba(255,255,255,0.25)` | Section labels, placeholders |
| Ultra-dim | `rgba(255,255,255,0.18)` | Second subtitle line in KPI cards |

---

## Typography

| Role | Font | Size | Weight | Notes |
|------|------|------|--------|-------|
| Body / UI | `DM Sans` | 14px | 400–500 | Default for all body copy |
| Display headings | `Playfair Display, serif` | 24px | 600–700 | `h1`, `h2`, section headers |
| Data / mono | `JetBrains Mono` | 12–13px | 600 | Dollar amounts, IDs, chart values |
| Section label | DM Sans | 10px | 700 | Uppercase, `letter-spacing: 0.1em` |
| Card title | DM Sans | 15–16px | 600 | Card primary text |
| Caption / badge | DM Sans | 10–11px | 600–700 | Uppercase pill text |

---

## Spacing

| Context | Value |
|---------|-------|
| Page padding (desktop) | `32px–40px` vertical, `24px–32px` horizontal |
| Page padding (mobile) | `16px` |
| Max content width | `max-w-7xl` (`1280px`) |
| Card padding | `20px` (`p-5`) |
| Section gap | `24px` (`space-y-6`) |
| Card grid gap | `16px` (`gap-4`) |
| Inner card element gap | `8–12px` |

---

## Border Radius

| Element | Value | Tailwind |
|---------|-------|---------|
| Cards | `16px` | `rounded-2xl` |
| Inputs | `10–12px` | `rounded-xl` |
| Buttons (primary) | `10px` | `rounded-xl` |
| Toggle group | `12px` container / `8px` item | `rounded-xl` / `rounded-lg` |
| Badges / pills | `999px` | `rounded-full` |
| Tooltips / dropdowns | `12px` | `rounded-xl` |

---

## Borders

| State | Value |
|-------|-------|
| Default card | `1px solid rgba(255,255,255,0.06)` |
| Slightly elevated card | `1px solid rgba(255,255,255,0.07–0.08)` |
| Input default | `1px solid rgba(255,255,255,0.10)` |
| Input focus | `1px solid rgba(201,168,76,0.5)` |
| Active / selected | `1px solid rgba(201,168,76,0.5)` |
| New item / dashed | `2px dashed #2a2d3a` |
| Top bar bottom | `1px solid rgba(255,255,255,0.06)` |

---

## Hover & Interaction

### Card hover (gold glow)
```css
box-shadow: 0 0 0 1px rgba(201,168,76,0.4), 0 8px 24px rgba(201,168,76,0.15);
border-color: rgba(201,168,76,0.3);
transition: all 200ms ease;
```

### Icon / chevron on hover
- Default: `rgba(255,255,255,0.20)`
- Hover: `#C9A84C`
- Transition: `color 200ms ease`

### Input focus
```css
border-color: rgba(201,168,76,0.5);
transition: border-color 150ms ease;
```

### Template card selected
```css
background: rgba(201,168,76,0.08);
border: 1px solid rgba(201,168,76,0.5);
box-shadow: 0 0 0 1px rgba(201,168,76,0.2);
```

---

## Component Patterns

### Dark Theme Rule
Never use Tailwind CSS variable utility classes for dark UI. Always use inline `style={{}}` props with explicit hex/rgba values. This is because the CSS variables are wired to a light theme.

### Page Skeleton (Suspense Loading)
Pages that fetch data from Supabase use React Suspense with an inline skeleton component:
```tsx
export default async function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PageContent />   {/* async server component */}
    </Suspense>
  );
}
```
Skeleton elements use `animate-pulse` with `rgba(255,255,255,0.04–0.06)` backgrounds.

### Hover State (client cards)
Use a single `useState(hovered)` boolean and apply all hover styles conditionally in inline `style`:
```tsx
const [hovered, setHovered] = useState(false);
<div
  onMouseEnter={() => setHovered(true)}
  onMouseLeave={() => setHovered(false)}
  style={{
    boxShadow: hovered ? "0 0 0 1px rgba(201,168,76,0.4), 0 8px 24px rgba(201,168,76,0.15)" : "none",
    transition: "all 200ms ease",
  }}
/>
```

### Controlled Input Pattern
For editable values that must avoid stale state, use `editValue: string | null`:
```tsx
const [editValue, setEditValue] = useState<string | null>(null);
// null = not editing; string = in-flight edit
```

### Section Label
```tsx
<div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.25)" }}>
  SECTION TITLE
</div>
```

### KPI Card
```tsx
<div style={{ background: "#1a1d27", borderRadius: "16px", padding: "20px", border: "1px solid rgba(255,255,255,0.06)" }}>
  <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)" }}>
    Label
  </div>
  <div style={{ fontSize: "32px", fontWeight: 700, color: "#fff", fontFamily: "JetBrains Mono, monospace" }}>
    42
  </div>
  <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)" }}>$1.6M projected</div>
  <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.18)" }}>$42K in fees</div>
</div>
```

### Badge / Status Pill
```tsx
<span style={{
  display: "inline-flex", alignItems: "center", gap: "5px",
  borderRadius: "999px", padding: "2px 10px",
  fontSize: "10px", fontWeight: 600,
  background: "rgba(34,197,94,0.12)", color: "#22c55e",
}}>
  <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#22c55e", animation: "pulse 2s infinite" }} />
  Active
</span>
```

### Toggle Button Group
```tsx
<div style={{ display: "flex", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.1)", background: "#1a1d27", padding: "4px" }}>
  {options.map(opt => (
    <button
      key={opt}
      style={active === opt
        ? { background: "linear-gradient(135deg, #C9A84C, #EBB66A)", color: "#0A0B14", borderRadius: "8px", padding: "6px 16px" }
        : { color: "rgba(255,255,255,0.45)", borderRadius: "8px", padding: "6px 16px" }
      }
    >
      {opt}
    </button>
  ))}
</div>
```

### User Avatar (initials)
```tsx
<button style={{
  width: "34px", height: "34px", borderRadius: "50%",
  background: "rgba(201,168,76,0.15)",
  border: "1px solid rgba(201,168,76,0.35)",
  color: "#C9A84C", fontSize: "11px", fontWeight: 700,
}}>
  JG
</button>
```

### Gold Primary Button
```tsx
<button style={{
  background: "#C9A84C", border: "none", borderRadius: "10px",
  padding: "10px 24px", fontSize: "14px", fontWeight: 600,
  color: "#0A0B14", cursor: "pointer",
}}>
  Create
</button>
```

### Ghost / Secondary Button
```tsx
<button style={{
  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "10px", padding: "10px 20px", fontSize: "14px",
  color: "rgba(255,255,255,0.5)", cursor: "pointer",
}}>
  Cancel
</button>
```

### Metric Strip (4-column stats bar)
```tsx
<div style={{
  background: "#111219", borderRadius: "16px",
  border: "1px solid rgba(255,255,255,0.05)",
  padding: "20px 24px",
  display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px",
}}>
  <div>
    <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", marginBottom: "6px" }}>
      Total
    </div>
    <div style={{ fontSize: "28px", fontWeight: 700, color: "#fff", fontFamily: "JetBrains Mono, monospace" }}>
      12
    </div>
  </div>
</div>
```

### Card with Gold Hover (full pattern)
```tsx
function SandboxCard({ title }: { title: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: "#1a1d27",
        borderRadius: "16px",
        border: `1px solid ${hovered ? "rgba(201,168,76,0.3)" : "rgba(255,255,255,0.06)"}`,
        boxShadow: hovered ? "0 0 0 1px rgba(201,168,76,0.4), 0 8px 24px rgba(201,168,76,0.15)" : "none",
        transition: "all 200ms ease",
        padding: "20px",
        cursor: "pointer",
      }}
    >
      {title}
    </div>
  );
}
```

---

## Template Badge Colors

| Template | Background | Text |
|----------|-----------|------|
| Curative Title | `rgba(59,130,246,0.12)` | `#60a5fa` |
| Wholesale Pipeline | `rgba(139,92,246,0.12)` | `#a78bfa` |
| Creative Finance | `rgba(201,168,76,0.12)` | `#C9A84C` |
| Content Strategy | `rgba(6,182,212,0.12)` | `#22d3ee` |
| Multifamily Strategy | `rgba(249,115,22,0.12)` | `#fb923c` |
| Business Acquisition | `rgba(99,102,241,0.12)` | `#818cf8` |
| Blank | `rgba(255,255,255,0.06)` | `rgba(255,255,255,0.3)` |

---

## Layout Structure

```
<html>
  <body>
    <div className="flex h-screen overflow-hidden">
      <Sidebar />                          {/* #0d0d16, fixed left, hidden on mobile */}
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <TopBar />                         {/* #0d0d16, sticky top, h-14, z-40 */}
        <main className="flex-1 overflow-y-auto">
          <div style={{ background: "#0A0B14", minHeight: "100vh" }}>
            {/* page content */}
          </div>
        </main>
      </div>
    </div>
  </body>
</html>
```

- Sidebar width: `w-64` (desktop only, `hidden md:flex`)
- Top bar: full width, `h-14`, shows mobile logo (`md:hidden`) + `<UserMenu />`
- Main scroll: `overflow-y-auto` on the flex column, not on `<body>`

---

## Money Formatting

```ts
function compactMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;   // $1.6M
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;             // $160K
  return `$${n.toLocaleString()}`;
}

function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;   // $1.62M (precision)
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}
```

---

## CSS Variables (globals.css)

These exist but resolve to light-theme values; do not use in dark UI components:

```css
--background: 0 0% 100%;
--sidebar: #0d0d16;          /* safe to use — opaque hex */
--accent: #d4af37;           /* gold, safe as hex reference */
--gold: #d4af37;
--radius: 0.75rem;
```
