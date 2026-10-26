---
name: OpenAPI generator runtime
description: Node compatibility behavior that can break OpenAPI client generation.
---

If OpenAPI code generation fails with `Map.groupBy is not a function`, check the active Node runtime and use Node 24 before changing generator or application code.

**Why:** The workspace shell initially used Node 20 even though the project expected Node 24; the same generator succeeded after the runtime was aligned.

**How to apply:** When a generator reports a missing built-in JavaScript API, verify `node --version`, switch to the project-compatible runtime, and rerun codegen and typechecks.
