# CSS Style Guide for KiKi Gallery

| Property | Value |
| --- | --- |
| Version | v1.0 |
| Status | Draft |
| Last Updated | 2026-07-30 |
| Owner | KiKi Gallery |

> This document defines the CSS architecture, conventions, and styling guidelines used throughout the KiKi Gallery website.

---

## Purpose

This document defines the CSS architecture used by the KiKi Gallery website.

Its purpose is to establish consistent styling conventions that improve readability, maintainability, and long-term scalability.

This document focuses on architectural principles rather than visual design decisions.

---

## Relationship to Other Documents

This document should be read together with the following architectural documents.

| Document | Purpose |
| --- | --- |
| Architecture Audit | Evaluates the current architecture and identifies opportunities for improvement. |
| Content Model Specification | Defines the canonical content architecture and data model. |
| Architecture Review Report | Verifies that the architecture is internally consistent and ready for implementation. |

The CSS Style Guide defines how the architecture should be implemented within the presentation layer.

---

# 1. Design Philosophy

The CSS architecture is designed around a small number of consistent principles.

The primary goals are:

- Readability
- Predictability
- Maintainability
- Long-term scalability

CSS should describe presentation only.

Content structure, business logic, and application behavior belong outside the styling layer.

---

# 2. CSS Architecture

## 2.1 Architecture Principles

The stylesheet follows a component-oriented architecture.

Each stylesheet is responsible for a single page or reusable component.

Global styles should remain minimal.

Component styles should remain self-contained.

---

## 2.2 Separation of Responsibilities

CSS is responsible for presentation.

HTML is responsible for document structure.

Astro components are responsible for rendering.

Content Collections are responsible for data.

Responsibilities should never overlap.

---

## 2.3 Desktop First

Layouts are designed for desktop first.

Responsive behavior is introduced progressively through media queries.

Current breakpoints are:

```css
@media (max-width: 1279px) {}

@media (max-width: 1023px) {}

@media (max-width: 767px) {}
```

Additional breakpoints should only be introduced when justified by a genuine layout requirement.

---

# 3. Naming Conventions

## 3.1 Component Prefixes

Every page or component uses its own namespace.

Examples:

```text
home-

artists-

works-

journal-

news-

about-

privacy-

404-
```

Generic class names should be avoided.

Examples of prohibited names include:

```text
.title

.card

.grid

.wrapper

.item
```

---

## 3.2 BEM

Classes follow a simplified BEM convention.

```text
component

component__element

component--modifier
```

Example:

```css
.home-stories {}

.home-stories__card {}

.home-stories__card--featured {}
```

Nested selectors should be kept to a minimum.

---

## 3.3 Modifier Classes

Modifiers represent variations of an existing component.

Examples:

```css
.artists-works-section--double-a

.artists-works-section--double-b

.artists-works-section--single-a

.artists-works-section--single-b
```

Modifiers should never introduce unrelated behavior.

---

# 4. Layout Principles

## 4.1 Layout Responsibility

Layout is controlled using:

- Grid
- Flexbox
- Gap
- Margin
- Padding

Layout adjustments belong inside responsive breakpoints when they depend on screen width.

Typography should not be modified inside layout rules unless necessary.

---

## 4.2 Spacing

Spacing should primarily use design tokens.

Repeated spacing values should be extracted into CSS custom properties.

Component-specific spacing may remain local when reuse is unlikely.

---

## 4.3 Width

Widths should be fluid whenever practical.

Preferred techniques include:

- `max-width`
- `%`
- `clamp()`

Fixed widths should only be used when required by the design.

---

# 5. Typography

## 5.1 Typography Scale

Typography should use shared variables whenever possible.

Examples include:

- Heading sizes
- Body text
- Supporting text
- Reading text

Individual components should avoid introducing unique font scales unless justified.

---

## 5.2 clamp()

Responsive typography should prefer `clamp()` over multiple breakpoint-specific font sizes.

Example:

```css
font-size: clamp(1.2rem, 2vw, 1.5rem);
```

---

## 5.3 Line Height

Line height should prioritize readability.

Body text should generally use larger line heights than headings.

---

# 6. Responsive Design

## 6.1 Responsive Strategy

Responsive design follows three stages.

1. Layout
2. Spacing
3. Typography

Layouts should be simplified before typography is adjusted.

---

## 6.2 Grid

Grid layouts should collapse progressively.

Examples:

```text
4 Columns

↓

2 Columns

↓

1 Column
```

Horizontal scrolling should only be used when it improves the browsing experience.

---

## 6.3 Images

Images should preserve their aspect ratio.

Cropping should be intentional rather than accidental.

Presentation rules should remain independent from content.

---

# 7. CSS Variables

CSS custom properties are the primary source of reusable design values.

Variables should be defined globally when shared.

Component-specific values should remain local.

Examples include:

```css
--layout-space

--section-gap-lg

--page-heading-offset

--index-h1-size

--index-h1-line-height
```

Variables should describe purpose rather than appearance.

Preferred:

```text
--section-gap-lg
```

Avoid:

```text
--large-gap
```

---

# 8. Animation

Animations should support interaction rather than decoration.

Transitions should remain subtle.

Animations must never reduce usability or delay content visibility.

Hover interactions should not be relied upon for touch devices.

---

# 9. Performance

CSS should remain lightweight and predictable.

Avoid:

- Deep selector nesting
- Unnecessary specificity
- Duplicate declarations
- Dead code

Reusable rules should be extracted whenever appropriate.

---

# 10. Documentation

Every stylesheet should follow a consistent section structure.

Example:

```css
/* =========================
   Layout
========================= */

/* =========================
   Typography
========================= */

/* =========================
   Components
========================= */

/* =========================
   Responsive
========================= */
```

Sections should be ordered consistently across every stylesheet.

---

# 11. Guiding Principles

When making styling decisions, prioritize the following principles.

1. Readability over cleverness.
2. Consistency over convenience.
3. Simplicity over abstraction.
4. Maintainability over short-term optimization.
5. Predictability over personal preference.

These principles apply to every stylesheet within the project.

---

**End of CSS Style Guide**