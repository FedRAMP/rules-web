# cr26-site Tools

The `tools/` package prepares the Zensical site input and generates Markdown from the FedRAMP consolidated rules data.

The primary rules source is:

```text
tools/rules/fedramp-consolidated-rules.json
```

Generated pages are configured in `tools/config.json` and rendered through Handlebars templates in `tools/templates/`.

## Current Pipeline

Run all project tooling from `tools/`. The repository root does not have a `package.json`.

The build pipeline:

1. Reads shared paths and mappings from `config.json`.
2. Clears generated directories as needed.
3. Copies `../content` into `../src`.
4. Generates Markdown from `rules/fedramp-consolidated-rules.json`.
5. Builds `../src/todo.md` from the completed Markdown tree.
6. Runs Zensical with `../zensical.toml`.
7. Writes static output to `../html`.

`content/` is manual source content. Scripts should not write to it. Generated Markdown belongs in `src/`, and generated mappings must not shadow copied `content/` files.

## Commands

```bash
bun run dev
```

Starts the local development pipeline and Zensical preview. It copies `../content` into `../src`, generates configured Markdown, builds `../src/todo.md`, then starts `zensical serve` with `../zensical.toml`.

The dev script watches manual content, templates, config, generator code, the todo builder, and the consolidated rules JSON. Watch rebuilds are debounced by `dev.watchDebounceMs` in `config.json`; the current default is 1000 milliseconds.

```bash
bun test
```

Verifies the rules source schema, `tools/rules` sync status, generated Markdown pipeline, full static build output, and warns when built `src/*.md` pages are not linked from `zensical.toml`.

```bash
bun run check
```

Runs the local quality gate: `bun test` followed by `bunx tsc -p tsconfig.json --noEmit`.

```bash
bun run build
```

Runs the full static build and writes `../html`.

```bash
bun run sync
```

Syncs the `rules` submodule from the `main` branch of `https://github.com/FedRAMP/rules.git`.

```bash
bun run fix
```

Runs the header fixer script, currently `scripts/fix-headers.ts`.

## Git Hooks

This repo includes a tracked pre-commit hook in `../.githooks/pre-commit` that runs `bun run check` from `tools/`.

Enable it in a clone with:

```bash
git config core.hooksPath .githooks
```

## Configuration

All shared paths and generated Markdown mappings live in `tools/config.json`.

Important path settings:

- `paths.src`: generated Zensical input directory, currently `../src`.
- `paths.content`: manually edited source content, currently `../content`.
- `paths.html`: generated static output, currently `../html`.
- `paths.rulesFile`: consolidated rules JSON.
- `paths.template`: default Handlebars page template.
- `paths.partials`: shared Handlebars partials.
- `paths.zensicalConfig`: site configuration used by dev and build.

Generated files are tracked in the manifest named by `generated.manifest`, currently `.generated-markdown.json` inside `src/`. The generator removes files from the previous manifest before writing the next set, and it refuses to generate a file that would shadow a manual `content/` file.

## Page Pictographs

Manual Markdown pages can declare one source and one status in frontmatter. During build, the copy step reads this `picto` frontmatter and inserts the rendered pictograph span below the frontmatter before the first heading.

Manual source pages usually use:

```markdown
---
picto:
  source: person
  status: stable
---
```

Generated or machine-sourced pages use:

```markdown
---
picto:
  source: machine
  status: stable
---
```

Source values:

```text
person
machine
```

Status values:

```text
stable
placeholder
empty
```

Tooltips and rendered icon definitions are configured in `pictographs` in `config.json`.

## Generated TO DO Page

The `generated.todo` entry controls the machine-built TO DO page. The todo builder runs after manual content has been copied and generated pages have been written, so it can scan the completed `src/**/*.md` set.

It writes separate source/status sections with rows containing a linked section-to-page location, combined picto source/status icons, description, purpose, an edit icon link when `google_doc` frontmatter is present, and a Markdown icon when it is not.

## Generated Definitions

Add an entry to `generated.definitionDocuments` in `config.json`:

```json
{
  "id": "fedramp-definitions",
  "title": "FedRAMP Definitions",
  "output": "definitions.md",
  "includeEffectiveDates": false,
  "source": {
    "collection": "FRD",
    "types": ["20x", "rev5"],
    "includeBoth": true,
    "bothPosition": "first"
  }
}
```

Definition mapping fields:

- `id`: stable identifier for the mapping.
- `title`: page H1. If omitted, the FRD document title is used.
- `output`: destination path relative to `paths.src`; the default site location is `definitions.md`.
- `template`: optional Handlebars template path relative to `tools/`; defaults to `paths.template`.
- `emptyBehavior`: `write` keeps an empty page, `skip` omits it when no definitions match.
- `includeEffectiveDates`: set to `false` to omit the top applicability block.
- `status`: pictograph status for generated frontmatter.
- `source.collection`: must be `FRD`.
- `source.types`: one or more certification types, such as `["20x"]` or `["rev5"]`.
- `source.includeBoth`: include `data.both` definitions with each selected type.
- `source.bothPosition`: place `data.both` definitions `first` or `last`.

## Generated KSI Pages

Add an entry to `generated.ksiDocuments` in `config.json`:

```json
{
  "id": "provider-20x-key-security-indicators",
  "output": "providers/20x/key-security-indicators/{KSI}.md",
  "definitionsHref": "../../../definitions/",
  "source": {
    "collection": "KSI",
    "themes": "ALL"
  }
}
```

KSI mapping fields:

- `id`: stable identifier for the mapping.
- `title`: page H1. If omitted, the KSI theme name is used.
- `output`: destination path relative to `paths.src`. Use `{KSI}` or `{theme}` as the lowercase KSI theme `web_name` placeholder.
- `template`: optional Handlebars template path relative to `tools/`; defaults to `paths.template`.
- `definitionsHref`: relative link prefix for generated term links.
- `emptyBehavior`: `write` keeps an empty page, `skip` omits it when no indicators match.
- `status`: pictograph status for generated frontmatter.
- `source.collection`: must be `KSI`.
- `source.theme`: one KSI theme key from the rules JSON, such as `CMT`.
- `source.themes`: an array of KSI theme keys, such as `["CMT", "IAM"]`, or `"ALL"` to process every KSI theme.

## Generated Deadline Pages

Add an entry to `generated.deadlineDocuments` in `config.json`:

```json
{
  "id": "provider-important-deadlines",
  "title": "Important Deadlines",
  "output": "providers/updating/deadlines/{type}.md",
  "template": "templates/deadlines.hbs",
  "source": {
    "collection": "FRR",
    "documents": ["MKT", "FRC"],
    "types": ["20x", "rev5"],
    "affects": ["Providers"]
  }
}
```

Deadline documents generate one page per configured type. They read each selected FRR document's `info.short_name`, `info.name`, `info.web_name`, and `info.effective` values. The generated table links each rule family name to the matching provider rule page for that type.

Use `{type}` or `{version}` in `output` to place each type page explicitly. Use `source.ignoreDocuments` to remove specific FRR keys after `source.documents` is resolved, including when `source.documents` is `"ALL"`.
Use `source.affects` to omit selected FRR documents that do not contain any rule affecting that audience, such as excluding assessor-only recognition rules from provider deadline pages.

## Generated Rule Pages

Add an entry to `generated.ruleDocuments` in `config.json`:

```json
{
  "id": "frc-provider-20x-initial-certification",
  "title": "FedRAMP 20x Initial Certification Responsibilities",
  "output": "providers/20x/initial/certification.md",
  "definitionsHref": "../../../definitions/",
  "rulesHref": "../../../",
  "emptyBehavior": "write",
  "source": {
    "collection": "FRR",
    "document": "FRC",
    "types": ["20x"],
    "affects": ["Providers"],
    "includeBoth": true,
    "bothPosition": "first"
  }
}
```

Mapping fields:

- `id`: stable identifier for the mapping.
- `title`: page H1. If omitted, the FRR document title is used.
- `output`: destination path relative to `paths.src`. For `outputMode: "documents"`, use `{FRR}` as the lowercase FRR key placeholder.
- `outputMode`: optional output behavior. Omit it or use `single` for one output file; use `documents` to generate one file per selected FRR.
- `template`: optional Handlebars template path relative to `tools/`; defaults to `paths.template`.
- `definitionsHref`: relative link prefix for generated term links.
- `rulesHref`: relative link prefix for `reference_url_web_name` references.
- `emptyBehavior`: `write` keeps an empty page, `skip` omits it when no rules match.
- `includeEffectiveDates`: set to `false` to omit the top applicability block.
- `status`: pictograph status for generated frontmatter.
- `source.document`: one FRR key from the rules JSON, such as `FRC`.
- `source.documents`: an array of FRR keys, such as `["FSI", "ICP"]`, or `"ALL"` to process every FRR.
- `source.ignoreDocuments`: optional array of FRR keys to remove after `source.document` or `source.documents` is resolved.
- `source.types`: one or more certification types, such as `["20x"]` or `["rev5"]`.
- `source.affects`: optional filter matched against each rule's `affects` list.
- `source.sections`: optional list of section keys to include, such as `["CSO", "CSX"]`.
- `source.includeBoth`: include `data.both` rules with each selected type.
- `source.bothPosition`: place `data.both` rules `first` or `last`.
- `source.groupBy`: for multi-FRR mappings, `section` keeps source label sections and `document` groups matches under each FRR document title. Single-FRR mappings always render source label sections so the page title is not repeated as the first section heading.

For example, this mapping processes every FRR and generates one page per rule family for rules that affect FedRAMP:

```json
{
  "id": "fedramp-responsibilities",
  "output": "responsibilities/{FRR}.md",
  "outputMode": "documents",
  "definitionsHref": "../definitions/",
  "rulesHref": "../",
  "emptyBehavior": "skip",
  "includeEffectiveDates": false,
  "source": {
    "collection": "FRR",
    "documents": "ALL",
    "types": ["20x", "rev5"],
    "affects": ["FedRAMP"],
    "includeBoth": true,
    "bothPosition": "first"
  }
}
```

The default template is `templates/template.hbs`, with partials in `templates/partials/`. New templates can use the same view model as the default template: effective entries, sections, requirements, definitions, and requirement metadata such as terms, controls, notes, examples, and references.
