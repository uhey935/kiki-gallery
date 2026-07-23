# CSS Style Guide

## Philosophy

The CSS architecture of KiKi Gallery is designed to prioritize readability, maintainability, and long-term sustainability.

CSS is treated as a blueprint for the user interface rather than a collection of visual styles.

Every stylesheet should communicate structure, responsibilities, and design intent as clearly as possible.

---

## Core Principles

The following principles guide every CSS decision.

- CSS is a blueprint for the UI.
- Organize code by responsibility.
- Readability is more important than brevity.
- Match CSS structure with UI structure.
- Prefer Design Tokens over hard-coded values.
- Keep components independent and reusable.

---

## Responsibility First

CSS should be organized according to responsibilities rather than file size.

Each section should represent a single responsibility.

Avoid creating miscellaneous sections such as:

- Misc
- Other
- Utilities (unless truly shared)

If a responsibility can be clearly identified, it deserves its own section.

---

## Page Structure

CSS structure should follow the structure of the page.

Example:

```
Page

↓

Hero

↓

Intro

↓

Gallery

↓

Footer
```

Developers should be able to understand the page simply by reading the stylesheet.

---

## Layout

Layout rules define spatial relationships.

Typical responsibilities include:

- width
- max-width
- display
- grid
- flex
- gap
- margin
- padding
- alignment

Avoid mixing typography or interaction rules inside layout sections.

---

## Typography

Typography sections define how content is presented.

Typical properties include:

- font-size
- font-weight
- line-height
- letter-spacing
- color
- text-transform

Typography should remain independent from layout whenever practical.

---

## Components

Reusable UI elements should have their own responsibility.

Examples include:

- cards
- buttons
- badges
- navigation
- media
- labels

Components should remain reusable across pages whenever possible.

---

## Interaction

Interaction should be separated from typography and layout.

Preferred order:

```
Typography

↓

Links

↓

Hover
```

Hover effects, transitions, and animations should be grouped together.

---

## Responsive Design

Responsive behavior should preserve architectural consistency.

Desktop First is the default strategy.

Breakpoints:

- 1279px (when necessary)
- 1023px
- 767px

General guideline:

Layout changes belong inside media queries.

Typography and spacing should use Design Tokens and `clamp()` whenever practical.

---

## Design Tokens

Shared values should always be preferred over page-specific values.

Priority:

```
Global Design Tokens

↓

Shared Variables

↓

Page-specific Values
```

New hard-coded values should only be introduced when no existing token is appropriate.

---

## Comments

Comments represent responsibilities.

Examples:

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
```

Avoid generic section names such as:

- Misc
- Other
- Temporary

Every comment should clearly describe the responsibility of the following code.

---

## Content Isolation

CMS content should remain independent from page layout.

Preferred structure:

```
Article

↓

Article Body
```

Page layout should never depend on the internal structure of CMS content.

---

## Readability

Readable code is preferred over compact code.

Guidelines:

- Use consistent formatting.
- Group related declarations.
- Leave appropriate whitespace.
- Avoid unnecessary shorthand when it reduces clarity.

Future maintainability is more important than minimizing the number of lines.

---

## Simplicity

Each page should contain only the responsibilities it actually requires.

Do not force every stylesheet to share identical sections.

Architecture should remain simple and reflect the actual UI.

---

## Architecture Principles

When designing new pages, follow this process.

```
UI

↓

Page Structure

↓

Responsibilities

↓

CSS
```

CSS should be the result of architectural thinking rather than visual styling alone.

---

## Checklist

Before completing a stylesheet, confirm the following.

- Responsibilities are clearly separated.
- CSS structure matches the UI structure.
- Design Tokens are used whenever possible.
- Comments represent responsibilities.
- Layout and Typography remain independent.
- Interaction is separated from content styling.
- Components remain reusable.
- Code prioritizes readability over brevity.
- The stylesheet is easy to understand without additional explanation.