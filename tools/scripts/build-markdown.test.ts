import { afterAll, describe, expect, test } from "bun:test";
import { execFile, spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type { AnySchema } from "ajv";
import {
  buildMarkdown,
  collectArtifacts,
  loadRules,
  OUTPUT_DIR,
  RULES_FILE,
} from "./build-markdown";
import {
  loadToolConfig,
  REPO_ROOT,
  resolveToolPath,
  type ToolConfig,
} from "./config";
import { deploy } from "./deploy";
import { buildTodo } from "./todo-builder";

const execFileAsync = promisify(execFile);
const RULES_REMOTE_URL = "https://github.com/FedRAMP/rules.git";
const RULES_REMOTE_BRANCH = "main";
const RULES_SCHEMA_FILE = resolveToolPath(
  "rules/schemas/fedramp-consolidated-rules.schema.json",
);
const MACHINE_PICTOGRAPH =
  ':lucide-computer:{ .machine title="This content is machine-generated from FedRAMP Machine-Readable Rules." }';
const PERSON_PICTOGRAPH =
  ':lucide-person-standing:{ .person title="This content was written by a human just for this page." }';
const STABLE_PICTOGRAPH =
  ':lucide-book-open-check:{ .stable title="This content is relatively stable and only minor changes are expected." }';
const PLACEHOLDER_PICTOGRAPH =
  ':lucide-pencil:{ .placeholder title="This content is a placeholder and is not complete." }';
const EMPTY_PICTOGRAPH =
  ':lucide-circle-slash:{ .empty title="This content has not been produced or ported to this website yet." }';
const STABLE_STATUS_SPAN =
  '<span class="picto">:lucide-computer:{ .machine title="This content is machine-generated from FedRAMP Machine-Readable Rules." } :lucide-book-open-check:{ .stable title="This content is relatively stable and only minor changes are expected." }</span>';
const PLACEHOLDER_STATUS_SPAN =
  '<span class="picto">:lucide-computer:{ .machine title="This content is machine-generated from FedRAMP Machine-Readable Rules." } :lucide-pencil:{ .placeholder title="This content is a placeholder and is not complete." }</span>';
const MANUAL_STABLE_STATUS_SPAN =
  '<span class="picto">:lucide-person-standing:{ .person title="This content was written by a human just for this page." } :lucide-book-open-check:{ .stable title="This content is relatively stable and only minor changes are expected." }</span>';
const WARNING_ORANGE = "\x1b[38;5;208m";
const WARNING_RESET = "\x1b[0m";
const WARNING_MARK = "⚠";
const ERROR_RED = "\x1b[31m";
const COLOR_RESET = "\x1b[0m";
let unlinkedMarkdownWarningPaths: string[] = [];
let boldMarkdownHeadingWarnings: string[] = [];
let contentPictographWarnings: string[] = [];
let contentFrontmatterWarnings: string[] = [];
let emptyContentFrontmatterWarnings: string[] = [];
const humanReadableFailureSummaries: string[] = [];

afterAll(() => {
  printUnlinkedMarkdownWarnings();
  printBoldMarkdownHeadingWarnings();
  printContentPictographWarnings();
  printContentFrontmatterWarnings();
  printEmptyContentFrontmatterWarnings();
  printHumanReadableFailureSummaries();
});

function printUnlinkedMarkdownWarnings(): void {
  if (!unlinkedMarkdownWarningPaths.length) {
    return;
  }

  console.warn(
    [
      "",
      `${WARNING_ORANGE}${WARNING_MARK} Markdown files exist in src/ after bun run build but are not linked in zensical.toml:${WARNING_RESET}`,
      "",
      ...unlinkedMarkdownWarningPaths.map(
        (relativePath) =>
          `    ${WARNING_ORANGE}${WARNING_MARK} ${relativePath}${WARNING_RESET}`,
      ),
      "",
    ].join("\n"),
  );
}

function printBoldMarkdownHeadingWarnings(): void {
  if (!boldMarkdownHeadingWarnings.length) {
    return;
  }

  console.warn(
    [
      "",
      `${WARNING_ORANGE}${WARNING_MARK} Markdown headings should not be wrapped in bold markers:${WARNING_RESET}`,
      "",
      ...boldMarkdownHeadingWarnings.map(
        (location) =>
          `    ${WARNING_ORANGE}${WARNING_MARK} ${location}${WARNING_RESET}`,
      ),
      "",
    ].join("\n"),
  );
}

function printContentPictographWarnings(): void {
  if (!contentPictographWarnings.length) {
    return;
  }

  console.warn(
    [
      "",
      `${WARNING_ORANGE}${WARNING_MARK} Content markdown files should declare picto.source and picto.status in frontmatter:${WARNING_RESET}`,
      "",
      ...contentPictographWarnings.map(
        (warning) => `    ${WARNING_ORANGE}${WARNING_MARK} ${warning}${WARNING_RESET}`,
      ),
      "",
    ].join("\n"),
  );
}

function printContentFrontmatterWarnings(): void {
  if (!contentFrontmatterWarnings.length) {
    return;
  }

  console.warn(
    [
      "",
      `${WARNING_ORANGE}${WARNING_MARK} Content markdown files should declare description, purpose, and google_doc in frontmatter:${WARNING_RESET}`,
      "",
      ...contentFrontmatterWarnings.map(
        (warning) => `    ${WARNING_ORANGE}${WARNING_MARK} ${warning}${WARNING_RESET}`,
      ),
      "",
    ].join("\n"),
  );
}

function printEmptyContentFrontmatterWarnings(): void {
  if (!emptyContentFrontmatterWarnings.length) {
    return;
  }

  console.warn(
    [
      "",
      `${WARNING_ORANGE}${WARNING_MARK} Content markdown description and purpose frontmatter should not be empty:${WARNING_RESET}`,
      "",
      ...emptyContentFrontmatterWarnings.map(
        (warning) => `    ${WARNING_ORANGE}${WARNING_MARK} ${warning}${WARNING_RESET}`,
      ),
      "",
    ].join("\n"),
  );
}

function printHumanReadableFailureSummaries(): void {
  if (!humanReadableFailureSummaries.length) {
    return;
  }

  console.error(
    [
      "",
      `${ERROR_RED}Human-readable failure summary:${COLOR_RESET}`,
      "",
      ...humanReadableFailureSummaries.map(
        (summary, index) =>
          `${ERROR_RED}${index + 1}. ${summary
            .trim()
            .replaceAll("\n", `\n   `)}${COLOR_RESET}`,
      ),
      "",
    ].join("\n"),
  );
}

function expectWithFailureSummary(
  summary: string,
  assertion: () => void,
): void {
  try {
    assertion();
  } catch (error) {
    humanReadableFailureSummaries.push(summary);
    throw error;
  }
}

function expectFileToStartWith(
  filePath: string,
  contents: string,
  expectedStart: string,
  description: string,
): void {
  const relativePath = path.relative(REPO_ROOT, filePath);
  const summary = `${description}: ${relativePath}`;

  expectWithFailureSummary(summary, () => {
    expect(contents, summary).toStartWith(expectedStart);
  });
}

function expectTextOrder(
  contents: string,
  expectedTexts: string[],
  description: string,
): void {
  expectWithFailureSummary(description, () => {
    let previousIndex = -1;
    for (const expectedText of expectedTexts) {
      const index = contents.indexOf(expectedText, previousIndex + 1);
      expect(
        index,
        `${description}: missing or out-of-order text: ${expectedText}`,
      ).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
  });
}

async function git(args: string[], cwd = REPO_ROOT): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function runCommandWithSpinner(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  const spinnerFrames = ["-", "\\", "|", "/"];
  let frameIndex = 0;
  const renderSpinner = () => {
    const frame = spinnerFrames[frameIndex % spinnerFrames.length];
    frameIndex++;
    process.stderr.write(`\rRunning build pipeline ${frame}`);
  };

  renderSpinner();
  const spinner = setInterval(renderSpinner, 120);

  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code, signal) => {
        if (signal) {
          reject(new Error(`${command} exited from signal ${signal}`));
          return;
        }

        if (code && code !== 0) {
          const details = [stderr.trim(), stdout.trim()]
            .filter(Boolean)
            .join("\n\n");
          reject(
            new Error(
              `${command} ${args.join(" ")} exited with code ${code}${
                details ? `\n\n${details}` : ""
              }`,
            ),
          );
          return;
        }

        resolve({ stdout, stderr });
      });
    });
  } finally {
    clearInterval(spinner);
    process.stderr.write("\r\x1b[2K");
  }
}

async function listRelativeFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(root, entry.name);

      if (entry.isDirectory()) {
        const childFiles = await listRelativeFiles(entryPath);
        return childFiles.map((childFile) =>
          path.join(entry.name, childFile),
        );
      }

      if (entry.isFile()) {
        return [entry.name];
      }

      return [];
    }),
  );

  return files.flat().map((filePath) => filePath.split(path.sep).join("/"));
}

function markdownToHtmlPath(htmlRoot: string, relativePath: string): string {
  const parsedPath = path.posix.parse(relativePath);
  const directoryParts = parsedPath.dir ? parsedPath.dir.split("/") : [];

  if (parsedPath.name === "index") {
    return path.join(htmlRoot, ...directoryParts, "index.html");
  }

  return path.join(htmlRoot, ...directoryParts, parsedPath.name, "index.html");
}

function markdownPathsInZensicalConfig(source: string): string[] {
  return Array.from(
    new Set(
      Array.from(source.matchAll(/"([^"]+\.md)"/g), (match) => match[1])
        .filter((relativePath): relativePath is string => Boolean(relativePath))
        .sort(),
    ),
  );
}

interface ZensicalNavLocation {
  sectionHref?: string;
  sectionLabel: string;
}

function navLocationsInZensicalConfig(
  source: string,
): Map<string, ZensicalNavLocation> {
  const locationByPath = new Map<string, ZensicalNavLocation>();
  const sectionHrefByLabel = new Map<string, string>();
  let currentSectionLabel: string | null = null;
  const topLevelSectionPattern =
    /^  \{\s*(?:"([^"]+)"|([A-Za-z][A-Za-z0-9 _'-]*))\s*=/;

  for (const line of source.split(/\r?\n/)) {
    const sectionMatch = line.match(topLevelSectionPattern);
    if (sectionMatch) {
      currentSectionLabel = (sectionMatch[1] ?? sectionMatch[2] ?? "").trim();
    }

    if (!currentSectionLabel) {
      continue;
    }

    for (const pathMatch of line.matchAll(/"([^"]+\.md)"/g)) {
      const relativePath = pathMatch[1];
      if (!relativePath) {
        continue;
      }

      if (!sectionHrefByLabel.has(currentSectionLabel)) {
        sectionHrefByLabel.set(currentSectionLabel, relativePath);
      }

      if (!locationByPath.has(relativePath)) {
        locationByPath.set(relativePath, {
          sectionHref: sectionHrefByLabel.get(currentSectionLabel),
          sectionLabel: currentSectionLabel,
        });
      }
    }
  }

  return locationByPath;
}

function expectedTodoLocationFromZensicalConfig(
  zensicalConfig: string,
  pageTitle: string,
  relativePath: string,
): string {
  const location = navLocationsInZensicalConfig(zensicalConfig).get(relativePath);
  if (!location) {
    throw new Error(`${relativePath} must be linked in zensical.toml`);
  }

  const sectionLink = location.sectionHref
    ? `[${location.sectionLabel}](${location.sectionHref})`
    : location.sectionLabel;

  return `${sectionLink} :lucide-circle-arrow-out-down-right:<br> [${pageTitle}](${relativePath})`;
}

async function findBoldMarkdownHeadingWarnings(root: string): Promise<string[]> {
  const markdownPaths = (await listRelativeFiles(root))
    .filter((relativePath) => relativePath.endsWith(".md"))
    .sort();
  const warnings: string[] = [];
  const boldHeadingPattern = /^#{1,6}\s+\*\*.+\*\*\s*(?:#+\s*)?$/;

  for (const relativePath of markdownPaths) {
    const contents = await readFile(path.join(root, relativePath), "utf8");
    const lines = contents.split(/\r?\n/);

    lines.forEach((line, index) => {
      if (boldHeadingPattern.test(line.trim())) {
        warnings.push(`${relativePath}:${index + 1}: ${line.trim()}`);
      }
    });
  }

  return warnings;
}

function frontmatterLines(contents: string): string[] | null {
  const lines = contents.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return null;
  }

  const frontmatterEndIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  if (frontmatterEndIndex === -1) {
    return null;
  }

  return lines.slice(1, frontmatterEndIndex);
}

function pictoFrontmatterValue(
  contents: string,
): { source?: string; status?: string } | null {
  const frontmatter = frontmatterLines(contents);
  if (!frontmatter) {
    return null;
  }

  const pictoIndex = frontmatter.findIndex(
    (line) => line.trim() === "picto:",
  );
  if (pictoIndex === -1) {
    return null;
  }

  const value: { source?: string; status?: string } = {};
  for (let index = pictoIndex + 1; index < frontmatter.length; index++) {
    const line = frontmatter[index];
    if (!line) {
      continue;
    }

    if (!line.startsWith(" ")) {
      break;
    }

    const sourceMatch = line.match(/^\s+source:\s*([A-Za-z0-9_-]+)\s*$/);
    const statusMatch = line.match(/^\s+status:\s*([A-Za-z0-9_-]+)\s*$/);
    if (sourceMatch?.[1]) {
      value.source = sourceMatch[1];
    }
    if (statusMatch?.[1]) {
      value.status = statusMatch[1];
    }
  }

  return value;
}

function validateRequiredContentFrontmatter(
  relativePath: string,
  contents: string,
): string | null {
  const frontmatter = frontmatterLines(contents);
  if (!frontmatter) {
    return `${relativePath}: missing yaml frontmatter`;
  }

  const declaredKeys = new Set(
    frontmatter
      .map((line) => line.match(/^([A-Za-z0-9_-]+):(?:\s|$)/)?.[1])
      .filter((key): key is string => Boolean(key)),
  );
  const missingKeys = ["description", "purpose", "google_doc"].filter(
    (key) => !declaredKeys.has(key),
  );

  if (!missingKeys.length) {
    return null;
  }

  return `${relativePath}: missing ${missingKeys.join(", ")}`;
}

function validateNonEmptyContentFrontmatter(
  relativePath: string,
  contents: string,
): string | null {
  const frontmatter = frontmatterLines(contents);
  if (!frontmatter) {
    return null;
  }

  const emptyKeys = ["description", "purpose"].filter((key) => {
    const line = frontmatter.find((frontmatterLine) =>
      frontmatterLine.match(new RegExp(`^${key}:`)),
    );
    if (!line) {
      return false;
    }

    const value = line.slice(line.indexOf(":") + 1).trim();
    return value === "" || value === '""' || value === "''";
  });

  if (!emptyKeys.length) {
    return null;
  }

  return `${relativePath}: empty ${emptyKeys.join(", ")}`;
}

function validatePictographFrontmatter(
  relativePath: string,
  contents: string,
  config: ToolConfig,
): string | null {
  const picto = pictoFrontmatterValue(contents);
  if (!picto) {
    return `${relativePath}: missing picto frontmatter`;
  }

  const knownSources = new Set(Object.keys(config.pictographs.source));
  const knownStatuses = new Set(Object.keys(config.pictographs.status));

  if (!picto.source) {
    return `${relativePath}: missing picto.source`;
  }

  if (!knownSources.has(picto.source)) {
    return `${relativePath}: unknown picto.source "${picto.source}"`;
  }

  if (!picto.status) {
    return `${relativePath}: missing picto.status`;
  }

  if (!knownStatuses.has(picto.status)) {
    return `${relativePath}: unknown picto.status "${picto.status}"`;
  }

  return null;
}

async function findContentPictographWarnings(
  root: string,
  config: ToolConfig,
): Promise<string[]> {
  const markdownPaths = (await listRelativeFiles(root))
    .filter((relativePath) => relativePath.endsWith(".md"))
    .sort();
  const warnings: string[] = [];

  for (const relativePath of markdownPaths) {
    const contents = await readFile(path.join(root, relativePath), "utf8");
    const warning = validatePictographFrontmatter(
      relativePath,
      contents,
      config,
    );
    if (warning) {
      warnings.push(warning);
    }
  }

  return warnings;
}

async function findContentFrontmatterWarnings(root: string): Promise<string[]> {
  const markdownPaths = (await listRelativeFiles(root))
    .filter((relativePath) => relativePath.endsWith(".md"))
    .sort();
  const warnings: string[] = [];

  for (const relativePath of markdownPaths) {
    const contents = await readFile(path.join(root, relativePath), "utf8");
    const warning = validateRequiredContentFrontmatter(relativePath, contents);
    if (warning) {
      warnings.push(warning);
    }
  }

  return warnings;
}

async function findEmptyContentFrontmatterWarnings(
  root: string,
): Promise<string[]> {
  const markdownPaths = (await listRelativeFiles(root))
    .filter(
      (relativePath) =>
        relativePath.endsWith(".md") && !relativePath.startsWith("authority/"),
    )
    .sort();
  const warnings: string[] = [];

  for (const relativePath of markdownPaths) {
    const contents = await readFile(path.join(root, relativePath), "utf8");
    const warning = validateNonEmptyContentFrontmatter(relativePath, contents);
    if (warning) {
      warnings.push(warning);
    }
  }

  return warnings;
}

function generatedMappingStatusFailures(config: ToolConfig): string[] {
  const configuredStatuses = new Set(Object.keys(config.pictographs.status));
  const generatedMappingGroups: Array<
    [string, Array<{ id?: unknown; status?: unknown }>]
  > = [
    ["todo", config.generated.todo ? [config.generated.todo] : []],
    ["definitionDocuments", config.generated.definitionDocuments ?? []],
    ["ksiDocuments", config.generated.ksiDocuments ?? []],
    ["deadlineDocuments", config.generated.deadlineDocuments ?? []],
    ["ruleDocuments", config.generated.ruleDocuments],
  ];
  const failures: string[] = [];

  for (const [groupName, mappings] of generatedMappingGroups) {
    mappings.forEach((mapping, index) => {
      const mappingLabel =
        typeof mapping.id === "string" ? mapping.id : "unknown mapping";

      if (typeof mapping.status !== "string") {
        failures.push(
          `generated.${groupName}[${index}] (${mappingLabel}) is missing status`,
        );
        return;
      }

      if (!configuredStatuses.has(mapping.status)) {
        failures.push(
          `generated.${groupName}[${index}] (${mappingLabel}) uses unknown status "${mapping.status}"`,
        );
      }
    });
  }

  return failures;
}

function pictographTooltipFailures(config: ToolConfig): string[] {
  const failures: string[] = [];
  const tooltipKeys = [
    ...Object.keys(config.pictographs.source),
    ...Object.keys(config.pictographs.status),
  ] as Array<keyof ToolConfig["pictographs"]["tooltips"]>;

  for (const key of tooltipKeys) {
    if (!config.pictographs.tooltips[key]?.trim()) {
      failures.push(`pictographs.tooltips.${key} is missing or empty`);
    }
  }

  return failures;
}

describe("build-markdown", () => {
  test("the consolidated rules source exists", async () => {
    await access(RULES_FILE);
  });

  test("generated config mappings declare known statuses", async () => {
    const config = await loadToolConfig();
    const failures = generatedMappingStatusFailures(config);
    const statusFailureSummary = [
      "Generated markdown mappings in tools/config.json must declare a status from pictographs.status.",
      ...failures,
    ].join("\n");

    expectWithFailureSummary(statusFailureSummary, () => {
      expect(failures, statusFailureSummary).toEqual([]);
    });
  });

  test("pictographs declare tooltips", async () => {
    const config = await loadToolConfig();
    const failures = pictographTooltipFailures(config);
    const tooltipFailureSummary = [
      "Pictographs in tools/config.json must declare matching tooltips.",
      ...failures,
    ].join("\n");

    expectWithFailureSummary(tooltipFailureSummary, () => {
      expect(failures, tooltipFailureSummary).toEqual([]);
    });
  });

  test("the consolidated rules source matches the bundled schema", async () => {
    const schema = await readJson<AnySchema>(RULES_SCHEMA_FILE);
    const rules = await readJson<unknown>(RULES_FILE);
    const ajv = new Ajv2020({ allErrors: true });
    addFormats(ajv);

    const validate = ajv.compile(schema);
    const valid = validate(rules);
    const schemaFailureSummary = [
      `${path.relative(REPO_ROOT, RULES_FILE)} does not match ${path.relative(
        REPO_ROOT,
        RULES_SCHEMA_FILE,
      )}.`,
      ajv.errorsText(validate.errors, { separator: "\n" }),
    ].join("\n");

    expectWithFailureSummary(schemaFailureSummary, () => {
      expect(valid, schemaFailureSummary).toBe(true);
    });
  });

  test("the rules submodule is synced to the latest upstream main", async () => {
    const rulesPath = resolveToolPath("rules");
    const localHead = await git(["rev-parse", "HEAD"], rulesPath);
    const latestRemoteRef = await git([
      "ls-remote",
      RULES_REMOTE_URL,
      `refs/heads/${RULES_REMOTE_BRANCH}`,
    ]);
    const latestRemoteHead = latestRemoteRef.split(/\s+/)[0];
    if (!latestRemoteHead) {
      throw new Error(
        `Could not resolve ${RULES_REMOTE_URL} ${RULES_REMOTE_BRANCH}.`,
      );
    }

    const syncFailureSummary = [
      `tools/rules is not synced to ${RULES_REMOTE_URL} ${RULES_REMOTE_BRANCH}.`,
      `Run "bun run sync" from tools/ and commit the updated submodule pointer.`,
      `Local HEAD: ${localHead}`,
      `Upstream ${RULES_REMOTE_BRANCH}: ${latestRemoteHead}`,
    ].join("\n");

    expectWithFailureSummary(syncFailureSummary, () => {
      expect(localHead, syncFailureSummary).toBe(latestRemoteHead);
    });
  });

  test("builds configured markdown files from the JSON source", async () => {
    const config = await loadToolConfig();
    const rules = await loadRules(config);
    const expectedArtifacts = collectArtifacts(rules, config);

    await deploy();
    const summary = await buildMarkdown();
    expect(summary.artifactCount).toBe(expectedArtifacts.length);

    const relativePaths = summary.artifacts
      .map((artifact) => artifact.relativePath)
      .sort();
    expect(relativePaths).toEqual(
      expectedArtifacts.map((artifact) => artifact.relativePath).sort(),
    );
    for (const relativePath of [
      "agencies/rules/collaborative-continuous-monitoring.md",
      "agencies/rules/vulnerability-detection-and-response.md",
      "definitions.md",
      "providers/20x/key-security-indicators/change-management.md",
      "providers/20x/key-security-indicators/cloud-native-architecture.md",
      "providers/20x/rules/fedramp-certification.md",
      "providers/updating/deadlines/20x.md",
      "providers/updating/deadlines/rev5.md",
      "responsibilities/fedramp-security-inbox.md",
      "responsibilities/incident-communications-procedures.md",
      "responsibilities/marketplace-listing.md",
      "responsibilities/significant-change-notifications.md",
      "responsibilities/vulnerability-detection-and-response.md",
    ]) {
      expect(relativePaths).toContain(relativePath);
    }
    expect(relativePaths).not.toContain(
      "assessors/20x/rules/marketplace-listing.md",
    );

    for (const artifact of expectedArtifacts) {
      await access(artifact.outputPath);
      const contents = await readFile(artifact.outputPath, "utf8");

      expect(contents).toContain(`# ${artifact.title}`);
      expect(contents.trim().length).toBeGreaterThan(0);
    }

    const definitionsContents = await readFile(
      path.join(OUTPUT_DIR, "definitions.md"),
      "utf8",
    );
    const definitionsPurpose = rules.FRD.info.purpose;
    expect(definitionsPurpose).toBeTruthy();
    expect(definitionsContents).toStartWith(
      `---\ntags:\n  - 20x\n  - Rev5\n---\n\n${STABLE_STATUS_SPAN}\n\n# FedRAMP Definitions`,
    );
    expectTextOrder(
      definitionsContents,
      [
        "# FedRAMP Definitions",
        definitionsPurpose ?? "",
        "\n---",
        "## General Terms",
      ],
      "Generated FRD markdown should place info.purpose before the first body rule",
    );
    expect(definitionsContents).not.toContain("**Rule Sections**");
    expect(definitionsContents).not.toContain(
      '??? abstract "Background & Authority"',
    );
    expect(definitionsContents).not.toContain("Effective Date(s)");
    expect(definitionsContents).not.toContain("Overall Applicability");
    expect(definitionsContents).toContain('!!! quote ""');
    const definitionSectionHeaders = Array.from(
      definitionsContents.matchAll(/^## (.+)$/gm),
      (match) => match[1],
    );
    const definitionTags = Array.from(
      new Set(
        Object.values(rules.FRD.data.both ?? {})
          .map((entry) => entry.tag?.trim())
          .filter((tag): tag is string => Boolean(tag)),
      ),
    ).sort((left, right) => left.localeCompare(right));
    expect(definitionSectionHeaders).toEqual([
      "General Terms",
      ...definitionTags.map((tag) => `Related Terms: ${tag}`),
    ]);
    expect(definitionsContents).toContain("## Related Terms: Vulnerability");

    const ksiArtifactPaths = relativePaths.filter((relativePath) =>
      relativePath.startsWith("providers/20x/key-security-indicators/"),
    );
    expect(ksiArtifactPaths).toHaveLength(Object.keys(rules.KSI).length);

    const ksiChangeManagementContents = await readFile(
      path.join(
        OUTPUT_DIR,
        "providers",
        "20x",
        "key-security-indicators",
        "change-management.md",
      ),
      "utf8",
    );
    expect(ksiChangeManagementContents).toStartWith(
      `---\ntags:\n  - 20x\n---\n\n${STABLE_STATUS_SPAN}\n\n# Change Management`,
    );
    expect(ksiChangeManagementContents).toContain("# Change Management");
    expect(ksiChangeManagementContents).not.toContain("**Rule Sections**");
    expect(ksiChangeManagementContents).not.toContain('!!! info ""');
    expect(ksiChangeManagementContents).toContain("KSI-CMT-LMC");
    expect(ksiChangeManagementContents).toContain("### Logging Changes");
    expect(ksiChangeManagementContents).toContain(
      "**Related SP 800-53 Controls:**",
    );
    expect(ksiChangeManagementContents).toContain(
      "[AU-2](https://controlfreak.risk-redux.io/controls/AU-02)",
    );
    expect(ksiChangeManagementContents).toContain(
      "../../../definitions/#cloud-service-offering",
    );
    const ksiPolicyInventoryContents = await readFile(
      path.join(
        OUTPUT_DIR,
        "providers",
        "20x",
        "key-security-indicators",
        "policy-and-inventory.md",
      ),
      "utf8",
    );
    expect(ksiPolicyInventoryContents).toContain("KSI-PIY-RES");
    expect(ksiPolicyInventoryContents).toContain(
      "[Persistently](../../../definitions/#persistently){ data-preview }",
    );
    expect(ksiPolicyInventoryContents).not.toContain(
      "[Provider](../../../definitions/#provider){ data-preview }",
    );

    const deadlines20xPath = path.join(
      OUTPUT_DIR,
      "providers",
      "updating",
      "deadlines",
      "20x.md",
    );
    const deadlines20xContents = await readFile(deadlines20xPath, "utf8");
    expectFileToStartWith(
      deadlines20xPath,
      deadlines20xContents,
      `---\ntags:\n  - 20x\n---\n\n${PLACEHOLDER_STATUS_SPAN}\n\n# 20x Deadlines`,
      "Generated provider 20x deadlines markdown has an unexpected header",
    );
    expect(deadlines20xContents).toContain(
      "| FRC | [FedRAMP Certification](../../20x/rules/fedramp-certification.md) | 2026-07-04 | 2027-05-04 | 2027-05-04 |",
    );
    expect(deadlines20xContents).not.toContain("| AGU |");
    expect(deadlines20xContents).not.toContain("| REC |");
    expect(deadlines20xContents).not.toContain("Rev5 Deadlines");
    expect(
      deadlines20xContents.indexOf(
        "| SCG | [Secure Configuration Guide](../../20x/rules/secure-configuration-guide.md) | 2026-03-01 | 2026-03-01 | 2026-07-01 |",
      ),
    ).toBeLessThan(
      deadlines20xContents.indexOf(
        "| MKT | [Marketplace Listing](../../20x/rules/marketplace-listing.md) | 2026-07-04 | 2027-01-01 | 2027-05-04 |",
      ),
    );

    const deadlinesRev5Contents = await readFile(
      path.join(OUTPUT_DIR, "providers", "updating", "deadlines", "rev5.md"),
      "utf8",
    );
    expect(deadlinesRev5Contents).toStartWith(
      `---\ntags:\n  - Rev5\n---\n\n${PLACEHOLDER_STATUS_SPAN}\n\n# Rev5 Deadlines`,
    );
    expect(deadlinesRev5Contents).toContain(
      "| FRC | [FedRAMP Certification](../../rev5/rules/fedramp-certification.md) | 2027-01-01 | 2027-01-01 | 2027-01-01 |",
    );
    expect(deadlinesRev5Contents).toContain(
      "| MAS | [Minimum Assessment Scope](../../rev5/rules/minimum-assessment-scope.md) | 2027-01-01 | 2027-01-01 | Within 2 months of the next annual assessment after 2027-01-01 |",
    );
    expect(deadlinesRev5Contents).not.toContain("| REC |");
    expect(deadlinesRev5Contents).not.toContain("20x Deadlines");

    const assessorDeadlines20xContents = await readFile(
      path.join(OUTPUT_DIR, "assessors", "updating", "deadlines", "20x.md"),
      "utf8",
    );
    expect(assessorDeadlines20xContents).toContain(
      "| FRC | [FedRAMP Certification](../../20x/rules/fedramp-certification.md) |",
    );
    expect(assessorDeadlines20xContents).toContain(
      "| MKT | [Marketplace Listing](../../recognition/rules/marketplace-listing.md) |",
    );
    expect(assessorDeadlines20xContents).toContain(
      "| REC | [FedRAMP Recognition of Independent Assessment Services](../../recognition/rules/fedramp-recognition.md) |",
    );
    expect(assessorDeadlines20xContents).not.toContain(
      "../../../providers/20x/rules/",
    );

    const assessorDeadlinesRev5Contents = await readFile(
      path.join(OUTPUT_DIR, "assessors", "updating", "deadlines", "rev5.md"),
      "utf8",
    );
    expect(assessorDeadlinesRev5Contents).toContain(
      "| FRC | [FedRAMP Certification](../../rev5/rules/fedramp-certification.md) |",
    );
    expect(assessorDeadlinesRev5Contents).toContain(
      "| REC | [FedRAMP Recognition of Independent Assessment Services](../../recognition/rules/fedramp-recognition.md) |",
    );
    expect(assessorDeadlinesRev5Contents).not.toContain(
      "../../../providers/rev5/rules/",
    );

    const contentDefinitionsPath = path.join(
      resolveToolPath(config.paths.content),
      "definitions.md",
    );
    await expect(access(contentDefinitionsPath)).rejects.toThrow();

    const provider20xContents = await readFile(
      path.join(
        OUTPUT_DIR,
        "providers",
        "20x",
        "rules",
        "fedramp-certification.md",
      ),
      "utf8",
    );
    const fedrampCertificationPurpose = rules.FRR.FRC?.info.purpose;
    expect(fedrampCertificationPurpose).toBeTruthy();
    expect(provider20xContents).toStartWith(
      `---\ntags:\n  - 20x\n---\n\n${PLACEHOLDER_STATUS_SPAN}\n\n# FedRAMP Certification`,
    );
    expectTextOrder(
      provider20xContents,
      [
        "# FedRAMP Certification",
        fedrampCertificationPurpose ?? "",
        "**Rule Sections**",
        "- [General Provider Responsibilities](#general-provider-responsibilities)",
        "- [20x-Specific Provider Responsibilities](#20x-specific-provider-responsibilities)",
        "\n---",
        "## General Provider Responsibilities {#general-provider-responsibilities}",
      ],
      "Generated FRR markdown should place info.purpose and a multi-section TOC before the first body rule",
    );
    expect(provider20xContents).toContain("# FedRAMP Certification");
    expect(provider20xContents).toContain("FRC-CSO-CDS");
    expect(provider20xContents).toContain("FRC-CSX-SUM");
    expect(provider20xContents).not.toContain("FRC-CSL-CDE");
    expect(provider20xContents).toContain("../../../definitions/#");
    expect(provider20xContents).toContain(
      "[Certification Data](../../../definitions/#certification-data){ data-preview }",
    );
    expect(provider20xContents).not.toContain(
      "[Provider](../../../definitions/#provider){ data-preview }",
    );

    const providerRev5Contents = await readFile(
      path.join(
        OUTPUT_DIR,
        "providers",
        "rev5",
        "rules",
        "fedramp-certification.md",
      ),
      "utf8",
    );
    expect(providerRev5Contents).toStartWith(
      `---\ntags:\n  - Rev5\n---\n\n${PLACEHOLDER_STATUS_SPAN}\n\n# FedRAMP Certification`,
    );
    expect(providerRev5Contents).toContain("FRC-CSL-CDE");
    expect(providerRev5Contents).not.toContain("FRC-CSX-SUM");

    const fedrampFsiContents = await readFile(
      path.join(OUTPUT_DIR, "responsibilities", "fedramp-security-inbox.md"),
      "utf8",
    );
    expect(fedrampFsiContents).toStartWith(
      `---\ntags:\n  - 20x\n  - Rev5\n---\n\n${STABLE_STATUS_SPAN}\n\n# FedRAMP Security Inbox`,
    );
    expect(fedrampFsiContents).toContain("# FedRAMP Security Inbox");
    expect(fedrampFsiContents).not.toContain("Effective Date(s)");
    expect(fedrampFsiContents).toContain("FSI-FRP-VRE");
    expect(fedrampFsiContents).not.toContain("FRC-CSO-CDS");

    const fedrampVdrContents = await readFile(
      path.join(
        OUTPUT_DIR,
        "responsibilities",
        "vulnerability-detection-and-response.md",
      ),
      "utf8",
    );
    expect(fedrampVdrContents).toContain(
      "# Vulnerability Detection and Response",
    );
    expect(fedrampVdrContents).toContain("## FedRAMP Responsibilities");
    expect(fedrampVdrContents).not.toContain(
      "## Vulnerability Detection and Response",
    );
    expect(fedrampVdrContents).toContain("VDR-FRP-ARP");

    const agencyCcmContents = await readFile(
      path.join(
        OUTPUT_DIR,
        "agencies",
        "rules",
        "collaborative-continuous-monitoring.md",
      ),
      "utf8",
    );
    const collaborativeMonitoringPurpose = rules.FRR.CCM?.info.purpose;
    expect(collaborativeMonitoringPurpose).toBeTruthy();
    expect(agencyCcmContents).toStartWith(
      `---\ntags:\n  - 20x\n  - Rev5\n---\n\n${STABLE_STATUS_SPAN}\n\n# Collaborative Continuous Monitoring`,
    );
    expectTextOrder(
      agencyCcmContents,
      [
        "# Collaborative Continuous Monitoring",
        collaborativeMonitoringPurpose ?? "",
        "\n---",
        "## Agency Guidance {#agency-guidance}",
      ],
      "Generated single-label FRR markdown should place info.purpose before the first body rule without a TOC",
    );
    expect(agencyCcmContents).toContain("# Collaborative Continuous Monitoring");
    expect(agencyCcmContents).not.toContain("**Rule Sections**");
    expect(agencyCcmContents).toContain("## Agency Guidance");
    expect(agencyCcmContents).toContain("CCM-AGM-ROR");
    expect(agencyCcmContents).not.toContain("## Ongoing Certification Reports");

    const agencyVdrContents = await readFile(
      path.join(
        OUTPUT_DIR,
        "agencies",
        "rules",
        "vulnerability-detection-and-response.md",
      ),
      "utf8",
    );
    expect(agencyVdrContents).toContain("# Vulnerability Detection and Response");
    expect(agencyVdrContents).toContain("## Agency Guidance");
    expect(agencyVdrContents).toContain("VDR-AGM-RVR");
    expect(agencyVdrContents).not.toContain("VDR-FRP-ARP");
  });

  test("ignores configured rule documents after resolving the source selection", async () => {
    const config = await loadToolConfig();
    const rules = await loadRules(config);
    const artifacts = collectArtifacts(rules, {
      ...config,
      generated: {
        ...config.generated,
        definitionDocuments: [],
        ksiDocuments: [],
        deadlineDocuments: [],
        ruleDocuments: [
          {
            id: "assessor-20x-with-ignored-marketplace",
            output: "assessors/20x/rules/{FRR}.md",
            outputMode: "documents",
            status: "placeholder",
            emptyBehavior: "skip",
            source: {
              collection: "FRR",
              documents: "ALL",
              ignoreDocuments: ["MKT"],
              types: ["20x"],
              affects: ["Assessors"],
              includeBoth: true,
              bothPosition: "first",
            },
          },
        ],
      },
    });

    expect(artifacts.some((artifact) => artifact.sourceDocument === "MKT")).toBe(
      false,
    );
    expect(
      artifacts.some(
        (artifact) =>
          artifact.relativePath === "assessors/20x/rules/marketplace-listing.md",
      ),
    ).toBe(false);
  });

  test("ignores configured deadline documents after resolving the source selection", async () => {
    const config = await loadToolConfig();
    const rules = await loadRules(config);
    const artifacts = collectArtifacts(rules, {
      ...config,
      generated: {
        ...config.generated,
        definitionDocuments: [],
        ksiDocuments: [],
        deadlineDocuments: [
          {
            id: "deadlines-with-ignored-marketplace",
            title: "Important Deadlines",
            output: "providers/updating/deadlines/{type}.md",
            status: "stable",
            template: "templates/deadlines.hbs",
            source: {
              collection: "FRR",
              documents: ["MKT", "FRC"],
              ignoreDocuments: ["MKT"],
              types: ["20x"],
            },
          },
        ],
        ruleDocuments: [],
      },
    });

    const deadlineArtifact = artifacts.find(
      (artifact) =>
        artifact.documentType === "DEADLINES" &&
        artifact.relativePath === "providers/updating/deadlines/20x.md",
    );
    const shortNames =
      deadlineArtifact?.context.deadlineTables.flatMap((table) =>
        table.rows.map((row) => row.shortName),
      ) ?? [];

    expect(deadlineArtifact).toBeDefined();
    expect(shortNames).toContain("FRC");
    expect(shortNames).not.toContain("MKT");
  });

  test("ignores deadline documents with no rules affecting the configured audience", async () => {
    const config = await loadToolConfig();
    const rules = await loadRules(config);
    const artifacts = collectArtifacts(rules, {
      ...config,
      generated: {
        ...config.generated,
        definitionDocuments: [],
        ksiDocuments: [],
        deadlineDocuments: [
          {
            id: "provider-deadlines-with-rec",
            title: "Important Deadlines",
            output: "providers/updating/deadlines/{type}.md",
            status: "stable",
            template: "templates/deadlines.hbs",
            source: {
              collection: "FRR",
              documents: ["REC", "FRC"],
              types: ["20x"],
              affects: ["Providers"],
            },
          },
        ],
        ruleDocuments: [],
      },
    });

    const deadlineArtifact = artifacts.find(
      (artifact) =>
        artifact.documentType === "DEADLINES" &&
        artifact.relativePath === "providers/updating/deadlines/20x.md",
    );
    const shortNames =
      deadlineArtifact?.context.deadlineTables.flatMap((table) =>
        table.rows.map((row) => row.shortName),
      ) ?? [];

    expect(deadlineArtifact).toBeDefined();
    expect(shortNames).toEqual(["FRC"]);
  });

  test("adds page info admonitions below content pictograph spans", async () => {
    const config = await loadToolConfig();
    const tempDir = await mkdtemp(path.join(tmpdir(), "cr26-site-tools-"));
    const tempContentDir = path.join(tempDir, "content");
    const tempSrcDir = path.join(tempDir, "src");
    const tempHtmlDir = path.join(tempDir, "html");

    try {
      await mkdir(tempContentDir, { recursive: true });
      await mkdir(tempSrcDir, { recursive: true });
      await writeFile(
        path.join(tempSrcDir, "index.md"),
        [
          "---",
          "description: This page contains an overview of the Public Preview, including descriptions of the content sources and status.",
          "purpose: Helps folks understand the goals of the Public Preview and how to approach reviewing it.",
          "picto:",
          "  source: person",
          "  status: stable",
          "---",
          "",
          "# Public Preview",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        path.join(tempSrcDir, "purpose-only.md"),
        [
          "---",
          'description: ""',
          "purpose: Explains why this page exists.",
          "picto:",
          "  source: person",
          "  status: stable",
          "---",
          "",
          "# Purpose Only",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        path.join(tempSrcDir, "empty.md"),
        [
          "---",
          'description: ""',
          "purpose: ''",
          "picto:",
          "  source: person",
          "  status: stable",
          "---",
          "",
          "# Empty Page Info",
          "",
        ].join("\n"),
        "utf8",
      );

      await buildMarkdown({
        ...config,
        paths: {
          ...config.paths,
          content: path.relative(resolveToolPath("."), tempContentDir),
          src: path.relative(resolveToolPath("."), tempSrcDir),
          html: path.relative(resolveToolPath("."), tempHtmlDir),
        },
        generated: {
          ...config.generated,
          definitions: undefined,
          definitionDocuments: [],
          ksiDocuments: [],
          deadlineDocuments: [],
          ruleDocuments: [],
        },
      });

      const indexContents = await readFile(
        path.join(tempSrcDir, "index.md"),
        "utf8",
      );
      expect(indexContents).toContain(
        [
          MANUAL_STABLE_STATUS_SPAN,
          "",
          '??? info inline end "Page Info"',
          "",
          "    **Description:** This page contains an overview of the Public Preview, including descriptions of the content sources and status.",
          "    ",
          "    **Purpose:** Helps folks understand the goals of the Public Preview and how to approach reviewing it.",
        ].join("\n"),
      );

      const purposeOnlyContents = await readFile(
        path.join(tempSrcDir, "purpose-only.md"),
        "utf8",
      );
      expect(purposeOnlyContents).toContain(
        [
          MANUAL_STABLE_STATUS_SPAN,
          "",
          '??? info inline end "Page Info"',
          "",
          "    **Purpose:** Explains why this page exists.",
        ].join("\n"),
      );
      expect(purposeOnlyContents).not.toContain("**Description:**");

      const emptyContents = await readFile(
        path.join(tempSrcDir, "empty.md"),
        "utf8",
      );
      expect(emptyContents).toContain(`---\n\n${MANUAL_STABLE_STATUS_SPAN}`);
      expect(emptyContents).not.toContain('??? info inline end "Page Info"');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("builds a todo page from the completed src markdown set", async () => {
    const config = await loadToolConfig();
    const tempDir = await mkdtemp(path.join(tmpdir(), "cr26-site-tools-"));
    const tempContentDir = path.join(tempDir, "content");
    const tempSrcDir = path.join(tempDir, "src");
    const tempHtmlDir = path.join(tempDir, "html");
    const generatedAt = new Date("2026-05-03T12:00:00.000Z");

    try {
      await mkdir(tempContentDir, { recursive: true });
      await mkdir(tempSrcDir, { recursive: true });
      await writeFile(
        path.join(tempSrcDir, "index.md"),
        [
          "---",
          'description: "Manual description"',
          'purpose: "Manual purpose"',
          'google_doc: "https://docs.google.com/document/d/example/edit"',
          "picto:",
          "  source: person",
          "  status: empty",
          "---",
          "",
          "# Manual Page",
          "",
        ].join("\n"),
        "utf8",
      );
      await mkdir(path.join(tempSrcDir, "authority", "law"), {
        recursive: true,
      });
      await writeFile(
        path.join(tempSrcDir, "authority", "law", "index.md"),
        [
          "---",
          "picto:",
          "  source: person",
          "  status: stable",
          "---",
          "",
          "# Authority Page",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        path.join(tempSrcDir, "generated.md"),
        [
          "---",
          "tags:",
          "  - 20x",
          "---",
          "",
          STABLE_STATUS_SPAN,
          "",
          "# Generated Page",
          "",
        ].join("\n"),
        "utf8",
      );

      const summary = await buildTodo(
        {
          ...config,
          paths: {
            ...config.paths,
            content: path.relative(resolveToolPath("."), tempContentDir),
            src: path.relative(resolveToolPath("."), tempSrcDir),
            html: path.relative(resolveToolPath("."), tempHtmlDir),
          },
        },
        { generatedAt },
      );

      expect(summary.relativePath).toBe("todo.md");
      expect(summary.pageCount).toBe(3);

      const contents = await readFile(path.join(tempSrcDir, "todo.md"), "utf8");
      expect(contents).toStartWith(
        [
          "---",
          `description: ${JSON.stringify(config.generated.todo?.description)}`,
          `purpose: ${JSON.stringify(config.generated.todo?.purpose)}`,
          'google_doc: ""',
          "picto:",
          "  source: machine",
          "  status: placeholder",
          "---",
          "",
          PLACEHOLDER_STATUS_SPAN,
        ].join("\n"),
      );
      expect(contents).toContain("**Generated:** 2026-05-03T12:00:00.000Z");
      expect(contents).toContain(
        `## Stable Human-Written Pages ${PERSON_PICTOGRAPH} ${STABLE_PICTOGRAPH}`,
      );
      expect(contents).toContain(
        `## Placeholder Human-Written Pages ${PERSON_PICTOGRAPH} ${PLACEHOLDER_PICTOGRAPH}`,
      );
      expect(contents).toContain(
        `## Empty Human-Written Pages ${PERSON_PICTOGRAPH} ${EMPTY_PICTOGRAPH}`,
      );
      expect(contents).toContain(
        `## Stable Machine-Generated Pages ${MACHINE_PICTOGRAPH} ${STABLE_PICTOGRAPH}`,
      );
      expect(contents).toContain(
        `## Placeholder Machine-Generated Pages ${MACHINE_PICTOGRAPH} ${PLACEHOLDER_PICTOGRAPH}`,
      );
      expect(contents).toContain(
        `## Empty Machine-Generated Pages ${MACHINE_PICTOGRAPH} ${EMPTY_PICTOGRAPH}`,
      );
      expect(contents).toContain(
        `| [Overview](index.md) :lucide-circle-arrow-out-down-right:<br> [Manual Page](index.md) | ${PERSON_PICTOGRAPH} ${EMPTY_PICTOGRAPH} | Manual description | Manual purpose | [:material-file-edit-outline:](https://docs.google.com/document/d/example/edit){ title="Link to FedRAMP Internal Google Doc" } |`,
      );
      expect(contents).toContain(
        `| Unlinked :lucide-circle-arrow-out-down-right:<br> [Generated Page](generated.md) | ${MACHINE_PICTOGRAPH} ${STABLE_PICTOGRAPH} |  |  | :material-language-markdown-outline: |`,
      );
      expect(contents).toContain(
        `| [Overview](index.md) :lucide-circle-arrow-out-down-right:<br> [TO DO](todo.md) | ${MACHINE_PICTOGRAPH} ${PLACEHOLDER_PICTOGRAPH} | A table showing all pages, their source, and their progress along with links to internal documentation only available to FedRAMP. | The FedRAMP team will have a simple place to see progress that is machine-generated. | :material-language-markdown-outline: |`,
      );
      expect(contents).not.toContain("Authority Page");
      expect(contents).not.toContain("authority/law/index.md");

      const manifest = await readJson<{ files: string[] }>(
        path.join(tempSrcDir, config.generated.manifest),
      );
      expect(manifest.files).toEqual(["todo.md"]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("builds configured FRD definition document mappings", async () => {
    const config = await loadToolConfig();
    const tempDir = await mkdtemp(path.join(tmpdir(), "cr26-site-tools-"));
    const tempContentDir = path.join(tempDir, "content");
    const tempSrcDir = path.join(tempDir, "src");
    const tempHtmlDir = path.join(tempDir, "html");

    try {
      await mkdir(tempContentDir, { recursive: true });

      const summary = await buildMarkdown({
        ...config,
        paths: {
          ...config.paths,
          content: path.relative(resolveToolPath("."), tempContentDir),
          src: path.relative(resolveToolPath("."), tempSrcDir),
          html: path.relative(resolveToolPath("."), tempHtmlDir),
        },
        generated: {
          ...config.generated,
          definitions: undefined,
          definitionDocuments: [
            {
              id: "custom-definitions",
              title: "Custom FedRAMP Definitions",
              output: "reference/fedramp-definitions.md",
              status: "placeholder",
              includeEffectiveDates: false,
              source: {
                collection: "FRD",
                types: ["20x", "rev5"],
                includeBoth: true,
                bothPosition: "first",
              },
            },
          ],
          ksiDocuments: [],
          deadlineDocuments: [],
          ruleDocuments: [],
        },
      });

      expect(summary.artifactCount).toBe(1);
      expect(summary.artifacts[0]?.mappingId).toBe("custom-definitions");
      expect(summary.artifacts[0]?.relativePath).toBe(
        "reference/fedramp-definitions.md",
      );

      const contents = await readFile(
        path.join(tempSrcDir, "reference", "fedramp-definitions.md"),
        "utf8",
      );
      expect(contents).toContain("# Custom FedRAMP Definitions");
      expect(contents).toStartWith(
        `---\ntags:\n  - 20x\n  - Rev5\n---\n\n${STABLE_STATUS_SPAN}\n\n# Custom FedRAMP Definitions`,
      );
      expect(contents).toContain("## General Terms");
      expect(contents).not.toContain("Effective Date(s)");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("rejects generated outputs that already exist in content", async () => {
    const config = await loadToolConfig();
    const tempDir = await mkdtemp(path.join(tmpdir(), "cr26-site-tools-"));
    const tempContentDir = path.join(tempDir, "content");
    const tempSrcDir = path.join(tempDir, "src");
    const tempHtmlDir = path.join(tempDir, "html");

    try {
      await mkdir(tempContentDir, { recursive: true });
      await writeFile(
        path.join(tempContentDir, "definitions.md"),
        "# Manual definitions\n",
        "utf8",
      );

      await expect(
        buildMarkdown({
          ...config,
          paths: {
            ...config.paths,
            content: path.relative(resolveToolPath("."), tempContentDir),
            src: path.relative(resolveToolPath("."), tempSrcDir),
            html: path.relative(resolveToolPath("."), tempHtmlDir),
          },
        }),
      ).rejects.toThrow(/would shadow content\/definitions\.md/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("content quality", () => {
  test("warns when content markdown is missing valid pictograph frontmatter", async () => {
    const config = await loadToolConfig();
    const contentPath = resolveToolPath(config.paths.content);

    contentPictographWarnings = await findContentPictographWarnings(
      contentPath,
      config,
    );

    expect(Array.isArray(contentPictographWarnings)).toBe(true);
  });

  test("warns when content markdown is missing required frontmatter fields", async () => {
    const config = await loadToolConfig();
    const contentPath = resolveToolPath(config.paths.content);

    contentFrontmatterWarnings =
      await findContentFrontmatterWarnings(contentPath);

    expect(Array.isArray(contentFrontmatterWarnings)).toBe(true);
  });

  test("warns when content markdown has empty description or purpose frontmatter", async () => {
    const config = await loadToolConfig();
    const contentPath = resolveToolPath(config.paths.content);

    emptyContentFrontmatterWarnings =
      await findEmptyContentFrontmatterWarnings(contentPath);

    expect(Array.isArray(emptyContentFrontmatterWarnings)).toBe(true);
  });

  test("warns when markdown headings are wrapped in bold markers", async () => {
    const config = await loadToolConfig();
    const contentPath = resolveToolPath(config.paths.content);

    boldMarkdownHeadingWarnings =
      await findBoldMarkdownHeadingWarnings(contentPath);

    expect(Array.isArray(boldMarkdownHeadingWarnings)).toBe(true);
  });
});

describe("build pipeline", () => {
  test("bun run build produces a complete Zensical site", async () => {
    const config = await loadToolConfig();
    const rules = await loadRules(config);
    const expectedArtifacts = collectArtifacts(rules, config);
    const expectedGeneratedFiles = expectedArtifacts
      .map((artifact) => artifact.relativePath)
      .concat(config.generated.todo?.output ?? "todo.md")
      .sort();
    const srcPath = resolveToolPath(config.paths.src);
    const contentPath = resolveToolPath(config.paths.content);
    const htmlPath = resolveToolPath(config.paths.html);

    const { stdout } = await runCommandWithSpinner(
      "bun",
      ["run", "build"],
      resolveToolPath("."),
    );

    expect(stdout).toContain(
      `Generated ${expectedArtifacts.length} markdown files.`,
    );
    expect(stdout).toContain("Generated todo.md with ");
    expect(stdout).toContain("Build finished");

    const manifest = await readJson<{ files: string[] }>(
      path.join(srcPath, config.generated.manifest),
    );
    expect(manifest.files).toEqual(expectedGeneratedFiles);

    const contentFiles = await listRelativeFiles(contentPath);
    for (const relativePath of contentFiles) {
      await access(path.join(srcPath, relativePath));
    }

    const copiedIndexMarkdown = await readFile(
      path.join(srcPath, "index.md"),
      "utf8",
    );
    expect(copiedIndexMarkdown).toContain(
      [
        "picto:",
        "  source: person",
        "  status: stable",
        "---",
        "",
        MANUAL_STABLE_STATUS_SPAN,
        "",
        '??? info inline end "Page Info"',
        "",
        "    **Description:** This page contains an overview of the Public Preview, including descriptions of the content sources and status.",
        "    ",
        "    **Purpose:** Helps folks understand the goals of the Public Preview and how to approach reviewing it.",
        "",
        "# Public Preview",
      ].join("\n"),
    );

    const zensicalConfig = await readFile(
      resolveToolPath(config.paths.zensicalConfig),
      "utf8",
    );
    const linkedMarkdownPaths = new Set(
      markdownPathsInZensicalConfig(zensicalConfig),
    );
    const srcMarkdownPaths = (await listRelativeFiles(srcPath))
      .filter((relativePath) => relativePath.endsWith(".md"))
      .sort();
    const unlinkedMarkdownPaths = srcMarkdownPaths.filter(
      (relativePath) => !linkedMarkdownPaths.has(relativePath),
    );

    unlinkedMarkdownWarningPaths = unlinkedMarkdownPaths;

    for (const relativePath of markdownPathsInZensicalConfig(zensicalConfig)) {
      await access(path.join(srcPath, relativePath));
      await access(markdownToHtmlPath(htmlPath, relativePath));
    }

    for (const artifact of expectedArtifacts) {
      await access(path.join(srcPath, artifact.relativePath));
      await access(markdownToHtmlPath(htmlPath, artifact.relativePath));

      const generatedMarkdown = await readFile(
        path.join(srcPath, artifact.relativePath),
        "utf8",
      );
      expect(generatedMarkdown).not.toContain("{{");
      expect(generatedMarkdown).not.toContain("[object Object]");
    }

    const todoMarkdown = await readFile(path.join(srcPath, "todo.md"), "utf8");
    expect(todoMarkdown).toContain("# TO DO");
    expect(todoMarkdown).toContain("**Generated:**");
    expect(todoMarkdown).toContain(
      "| Location | Picto | Description | Purpose | :lucide-file-cog: |",
    );
    expect(todoMarkdown).toContain(
      `## Stable Human-Written Pages ${PERSON_PICTOGRAPH} ${STABLE_PICTOGRAPH}`,
    );
    expect(todoMarkdown).toContain(
      `## Placeholder Machine-Generated Pages ${MACHINE_PICTOGRAPH} ${PLACEHOLDER_PICTOGRAPH}`,
    );
    expect(todoMarkdown).toContain("[Public Preview](index.md)");
    expect(todoMarkdown).toContain("[FedRAMP Definitions](definitions.md)");
    expect(todoMarkdown).toContain("[FedRAMP](responsibilities/index.md)");
    expect(todoMarkdown).toContain(
      expectedTodoLocationFromZensicalConfig(
        zensicalConfig,
        "FedRAMP Definitions",
        "definitions.md",
      ),
    );
    expect(todoMarkdown).not.toContain("authority/");
    expect(todoMarkdown).toContain(
      "A table showing all pages, their source, and their progress along with links to internal documentation only available to FedRAMP.",
    );
    expect(todoMarkdown).not.toContain("{{");
    expect(todoMarkdown).not.toContain("[object Object]");

    for (const relativePath of [
      "index.html",
      "search.json",
      "sitemap.xml",
      "assets/fr-only-logo-black.png",
      "stylesheets/custom.css",
      "authority/m-24-15/m-24-15-official.png",
    ]) {
      await access(path.join(htmlPath, relativePath));
    }

    const renderedPages = [
      {
        path: "definitions/index.html",
        expectedText: ["FedRAMP Definitions", "Cloud Service Offering"],
      },
      {
        path: "providers/20x/rules/fedramp-certification/index.html",
        expectedText: ["FedRAMP Certification", "FRC-CSO-CDS"],
      },
      {
        path: "providers/20x/key-security-indicators/change-management/index.html",
        expectedText: ["Change Management", "KSI-CMT-LMC"],
      },
      {
        path: "providers/updating/deadlines/20x/index.html",
        expectedText: ["20x Deadlines", "FedRAMP Certification"],
      },
      {
        path: "agencies/rules/agency-use/index.html",
        expectedText: ["Agency Use of FedRAMP Certified Cloud Services"],
      },
      {
        path: "todo/index.html",
        expectedText: ["TO DO", "Public Preview", "FedRAMP Definitions"],
      },
    ];

    for (const page of renderedPages) {
      const contents = await readFile(path.join(htmlPath, page.path), "utf8");

      for (const expectedText of page.expectedText) {
        expect(contents).toContain(expectedText);
      }
      expect(contents).not.toContain("{{");
      expect(contents).not.toContain("[object Object]");
    }
  });
});
