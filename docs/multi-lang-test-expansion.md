# Multi-Language Test Expansion Plan

Current state: 4 tools tested per language (smoke test).
Goal: expand to ~10 tools per language, covering the features that distinguish lsp-mcp from alternatives.

---

## Tiers

### Tier 1 — Current (smoke test, every PR)
`start_lsp` → `open_document` → `get_diagnostics` → `get_info_on_location`

Confirms: server starts, workspace initializes, hover works.

### Tier 2 — This plan (functional coverage, every PR)
Add 6 tools: `get_document_symbols`, `go_to_definition`, `get_references`, `get_completions`, `get_workspace_symbols`, `format_document`

Covers: symbol index, navigation, cross-file intelligence, formatting.
Total: ~10 tools per language.

### Tier 3 — Future (nightly or manual)
`rename_symbol`, `get_code_actions`, `apply_edit`, `go_to_implementation`, `get_signature_help`, `restart_lsp_server`

Deferred: higher complexity, server capability variance, needs `apply_edit` cleanup logic.

---

## Per-Language Capability Matrix

| Tool                  | TS | Go | Rust | Python | Java | C   | PHP |
|-----------------------|----|----|------|--------|------|-----|-----|
| get_document_symbols  | ✓  | ✓  | ✓    | ✓      | ✓    | ✓   | ✓   |
| go_to_definition      | ✓  | ✓  | ✓    | ✓      | ✓    | ✓   | ✓   |
| get_references        | ✓  | ✓  | ✓    | ✓      | ✓    | ✓   | ✓   |
| get_completions       | ✓  | ✓  | ✓    | ✓      | ✓    | ✓   | ✓   |
| get_workspace_symbols | ✓  | ✓  | ✓    | ✓      | ✓    | ✓   | ✓   |
| format_document       | ✓  | ✓  | ✓    | ?      | ?    | ✓   | ?   |
| go_to_declaration     | ✗  | ✗  | ✗    | ✗      | ✗    | ✓   | ✗   |

`?` = capability-gated: check `serverCapabilities.documentFormattingProvider` and skip gracefully if absent.
`go_to_declaration` is C/C++ only (header/source distinction); covered in Tier 2 for C only.

---

## Fixture Additions Required

Current fixtures are single-file per language. `get_references` is most useful when a symbol is
imported from another file. Without a second file, the test only confirms intra-file references
(declaration site + usage sites within the same file) — still meaningful, but weaker.

### TypeScript — no changes needed
`consumer.ts` already imports `add`, `Person`, and `Greeter` from `example.ts`.
`get_references` on `add` (line 4, col 17 in `example.ts`) will return both the definition
and the `consumer.ts` call site.

### Go — add `greeter.go`
```go
package main

import "fmt"

// Greeter wraps a Person and produces greetings.
type Greeter struct {
    person Person
}

func NewGreeter(p Person) Greeter {
    return Greeter{person: p}
}

func (g Greeter) SayHello() string {
    return fmt.Sprintf("Greeter says: %s", g.person.Greet())
}
```
`Person` appears at lines 7, 11, and 14 — plus `main.go` line 6 (definition) and line 21 (usage).
`get_references` on `Person` in `main.go` should return 5+ locations across both files.

### Python — add `greeter.py`
```python
from main import Person

class Greeter:
    def __init__(self, person: Person) -> None:
        self.person = person

    def say_hello(self) -> str:
        return f"Greeter says: {self.person.greet()}"
```
`Person` appears in `greeter.py` as import target and type annotation.

### Rust — add `src/greeter.rs`
Requires `Person` to be `pub` in `main.rs` (currently not). Plan:
1. Add `pub` to `struct Person` and its methods in `main.rs`.
2. Add `mod greeter;` to `main.rs`.
3. Create `src/greeter.rs`:
```rust
use crate::Person;

pub struct Greeter {
    person: Person,
}

impl Greeter {
    pub fn new(person: Person) -> Self {
        Greeter { person }
    }

    pub fn say_hello(&self) -> String {
        format!("Greeter says: {}", self.person.greet())
    }
}
```

### Java — add `Greeter.java`
```java
package com.example;

public class Greeter {
    private Person person;

    public Greeter(Person person) {
        this.person = person;
    }

    public String sayHello() {
        return "Greeter says: " + this.person.greet();
    }
}
```

### C — add `person.h` + `greeter.c`
C needs a header to share the type across files. Refactor:
1. Split `person.c` into `person.h` (struct + function declarations) and `person.c` (implementations).
2. Add `greeter.c`:
```c
#include "person.h"
#include <stdio.h>

void greet_person(Person p) {
    printf("Greeter says: Hello, %s\n", p.name);
}
```
Note: `go_to_declaration` should now work — `person.h` is the declaration, `person.c` is the definition.
Add a `compile_commands.json` so clangd can index both files.

### PHP — add `Greeter.php`
```php
<?php

require_once 'Person.php';

class Greeter {
    private Person $person;

    public function __construct(Person $person) {
        $this->person = $person;
    }

    public function sayHello(): string {
        return "Greeter says: " . $this->person->greet();
    }
}
```

---

## Test Structure Changes

### Language config additions
Each language entry needs:
- `definitionLine` / `definitionColumn` — position of `add()` function definition (for `go_to_definition`)
- `callSiteLine` / `callSiteColumn` — position of a call to `add()` (for `go_to_definition`)
- `referenceLine` / `referenceColumn` — position of the `Person` identifier (for `get_references`)
- `completionLine` / `completionColumn` — position after a dot or open paren (for `get_completions`)
- `workspaceSymbolQuery` — e.g. `"Person"` (for `get_workspace_symbols`)
- `supportsFormatting` — bool; skip `format_document` if false (or detect from server capabilities)
- `secondFile` — path of the cross-file fixture (for `get_references` assertion count)

### New test functions
```js
async function testGetDocumentSymbols(client, lang) { ... }
async function testGoToDefinition(client, lang) { ... }
async function testGetReferences(client, lang) { ... }
async function testGetCompletions(client, lang) { ... }
async function testGetWorkspaceSymbols(client, lang) { ... }
async function testFormatDocument(client, lang) { ... }
// C-only:
async function testGoToDeclaration(client, lang) { ... }
```

Each returns `{ tool, status: 'pass'|'skip'|'fail', detail }`.

### Assertions

**get_document_symbols:** Result is non-empty array; contains at least one entry matching `Person` (or the language's main type name).

**go_to_definition:** Called at a call site (e.g. `add(1, 2)`). Result is a location pointing to the function definition line. Assert `uri` ends with the expected filename and `range.start.line` matches.

**get_references:** Called on the `Person` type definition. Result is an array with length ≥ 2 when cross-file fixture exists (definition + at least one usage). Length ≥ 1 for single-file fixtures.

**get_completions:** Called after a `.` (e.g. `p.` in main). Result is non-empty array. No assertion on specific items — server-dependent.

**get_workspace_symbols:** Query = `"Person"`. Result contains an entry whose name is `"Person"` (or `"type Person struct"` for Go).

**format_document:** Result is an array (possibly empty if file is already formatted). Assert no error. Skip if `serverCapabilities.documentFormattingProvider` is falsy.

### Result reporting
Expand the summary table to show per-tool status per language:

```
Language    | T1 | symbols | definition | references | completions | workspace | format
------------|----|---------| -----------|------------|-------------|-----------|-------
TypeScript  | ✓  |   ✓     |    ✓       |    ✓       |     ✓       |    ✓      |   ✓
Go          | ✓  |   ✓     |    ✓       |    ✓       |     ✓       |    ✓      |   ✓
...
```

---

## CI Impact

| Phase             | Estimated time per language | Total (7 langs) |
|-------------------|-----------------------------|-----------------|
| Current (4 tools) | ~10s                        | ~2 min          |
| After Tier 2      | ~25s (Java: ~90s)           | ~5 min          |

Java dominates due to jdtls indexing time (~60-90s). Acceptable for a PR gate.
If CI time becomes a concern, Java can be moved to a separate `ci-java` job that runs only on main.

---

## Implementation Order

1. [ ] Add fixture second files (Go, Python, Rust, Java, PHP)
2. [ ] Refactor C fixture: split to `person.h` + `greeter.c` + `compile_commands.json`
3. [ ] Update language configs in `multi-lang.test.js` with new position metadata
4. [ ] Implement `testGetDocumentSymbols` and wire into `testLanguage`
5. [ ] Implement `testGoToDefinition` and wire in
6. [ ] Implement `testGetReferences` and wire in
7. [ ] Implement `testGetCompletions` and wire in
8. [ ] Implement `testGetWorkspaceSymbols` and wire in
9. [ ] Implement `testFormatDocument` (capability-gated) and wire in
10. [ ] Implement `testGoToDeclaration` (C only) and wire in
11. [ ] Update summary table format
12. [ ] Run locally against available language servers
13. [ ] Verify CI passes

---

## Open Questions

- **C fixture complexity:** Splitting into header + greeter.c is the right call for `go_to_declaration`, but it requires a `compile_commands.json` for clangd to index both files. Need to verify clangd can pick up `compile_commands.json` in the fixture directory without a full CMake setup.
- **Python formatting:** pyright-langserver does not support `textDocument/formatting`. Skip gracefully via capability check. (black/ruff are formatters, not language servers.)
- **PHP formatting:** intelephense's formatting support is license-gated (premium feature). Skip gracefully.
- **Java formatting:** jdtls supports formatting but is slow; may add significant time to Tier 2. Consider capability-gating it separately.
- **Rust completions position:** After `p.` the cursor needs to be after the dot, which requires knowing the exact column in the fixture. Verify against actual fixture content.
