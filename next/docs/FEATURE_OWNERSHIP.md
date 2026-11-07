# Feature-owned editor lifecycle

Code, Explorer, Terminal and Markdown now implement their view components directly in their respective feature packages instead of importing the implementations from a central presenters module.

A feature package owns its view factory and feature-specific behavior. Shared UI controls, browser-local storage, tool registry and services remain in their infrastructure packages. The four public view names are re-exported from `packages/client/src/views/Editors.tsx` for transitional import compatibility only; that file contains no editor behavior.

Cordis owns feature registration/enabling/disposal. Dockview owns tab/group/floating layout and tab identity. Disabling a feature preserves its tab placeholder for recovery. None of these editors mutate the Dockview group graph.

This structural change does not claim per-feature domain service isolation for all 31 plugins. The residual shared Zustand store and direct imports of browser-local services are explicit next migration targets.
