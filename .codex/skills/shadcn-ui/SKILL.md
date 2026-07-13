---
name: shadcn-ui
description: Use when adding, replacing, or styling shadcn/ui components in a frontend project, especially when a requested component is missing locally. Requires installing official shadcn components through the shadcn CLI or registry before using them; avoid hand-writing lookalike components as a first choice.
---

# Shadcn UI

## Workflow

When a task asks for shadcn/ui components, or an existing UI should be converted to shadcn style:

1. Inspect the project first:
   - Check `components.json`, package manager files, path aliases, and existing `src/components/ui/*` components.
   - Confirm whether the requested component already exists.

2. Use native shadcn components directly when they exist locally:
   - Prefer the component's official API and composition model.
   - Do not block, wrap, or replace native shadcn primitives just because they are generic.
   - Keep local className overrides small and token-based.

3. If the component is missing, install the official shadcn component before editing app code:
   - Prefer the project's package manager and existing shadcn setup.
   - Use the shadcn CLI/registry command, for example `npx shadcn@latest add select` or the repo's equivalent.
   - If network or sandbox restrictions block the install, request escalation instead of hand-writing the component.

4. Only hand-write a component when:
   - The official shadcn install is impossible after escalation or the user explicitly asks for a custom component.
   - The project already has a deliberate local fork pattern and the change follows that pattern.
   - The required UI is application-specific and has no practical shadcn primitive.

5. After installing or changing components:
   - Replace native controls like `<select>` with the installed shadcn component API.
   - Remove stale custom CSS that only existed for the native control.
   - Run the relevant build/typecheck.

## Native Shadcn Policy

- Native shadcn is the default, not a restricted fallback.
- Do not create lookalike buttons, dialogs, selects, tabs, drawers, forms, popovers, badges, cards, or toasts when the official component is available.
- Prefer fixing theme tokens, spacing, responsive layout, or component composition over forking a shadcn component.
- If a local `src/components/ui/*` component differs from upstream, treat it as the project's shadcn instance and keep changes compatible with its existing API.
- Keep destructive/error states mapped to shadcn `destructive` tokens and project aliases; do not hard-code neutral colors for errors.

## Toast Feedback

Use shadcn `sonner` toast for frontend operation feedback:

- Show frontend request errors and important failed operations with `toast.error(...)`.
- Show necessary successful operations with `toast.success(...)`, especially create/update/delete, login, refresh, save, health check, or other user-triggered operations where confirmation matters.
- Prefer top-center placement through the app-level `<Toaster position="top-center" />`.
- Keep inline/page errors only when the message must remain visible as durable form validation or blocking page state.
- If `sonner` is missing, install it with the official shadcn CLI before using toast.

## Forms

Use official shadcn `Form` patterns for substantial frontend forms:

- Install the official shadcn `form` component before converting or adding a form.
- Use `react-hook-form` for form state and submission.
- Use `zod` with `@hookform/resolvers/zod` for field validation when validation is needed.
- Structure fields with `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, and `FormMessage`.
- Prefer `FormMessage` for durable field-level validation errors.
- Use toast for submit success/failure outcomes that do not need to remain inline.
- Avoid building substantial forms with only local `useState` plus loose `Label/Input` wiring unless the form is trivial.

## Error Colors

Keep destructive/error states visibly red:

- `--destructive` must be a red token in both light and dark themes, not black, white, or neutral gray.
- Field errors shown through `FormMessage`, invalid borders, destructive buttons, and destructive badges should read as red.
- Legacy inline error helpers such as `.form-error` should use the same red family through project tokens like `--danger`, `--danger-bg`, and `--danger-border`.
- After changing theme tokens, check shadcn components that use `text-destructive`, `border-destructive`, or `aria-invalid:*`.

## Motion

Use Motion for meaningful UI animation in this project:

- Prefer the `motion` package and import React helpers from `motion/react`.
- Use Motion for pulse, entrance, state-change, and small feedback animations instead of hand-written CSS keyframes.
- Keep animations subtle and functional in admin/console surfaces.
- Respect component semantics: animate wrappers or decorative spans when the base shadcn component should remain unchanged.

## Notes

- For dropdowns/select menus, use the official shadcn `select` component rather than styling a native `<select>`.
- For selects that should stay visually anchored under the trigger, set `SelectContent position="popper"`; the default item-aligned positioning can shift the menu upward/downward based on the selected item.
- Keep component additions aligned with the project's existing shadcn naming, imports, and alias conventions.
