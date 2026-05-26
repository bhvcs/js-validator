import { mkdirSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import ts from "typescript";

const TYPECHECK_HEADER = [
  "// @ts-check",
  '/// <reference types="jquery" />',
  "",
].join("\n");

// Keep report focused on actionable issues (method/property typos, missing symbols, etc.).
// TS7006: Parameter '<name>' implicitly has an 'any' type.
// TS2683: 'this' implicitly has type 'any' because it does not have a type annotation.
const SUPPRESSED_DIAGNOSTIC_CODES = new Set([7006, 2683]);

const SUPPRESSED_MESSAGE_PATTERNS = [
  /implicitly has an 'any' type/i,
  /Duplicate identifier 'GridEditEvent'/i,
];

function shouldSuppressDiagnostic(diagCode, message) {
  if (SUPPRESSED_DIAGNOSTIC_CODES.has(diagCode)) {
    return true;
  }

  return SUPPRESSED_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

function toMessageText(messageText) {
  if (typeof messageText === "string") {
    return messageText;
  }

  return ts.flattenDiagnosticMessageText(messageText, "\n");
}

function toSeverity(category) {
  return category === ts.DiagnosticCategory.Error ? 2 : 1;
}

function addKendoEditEventHint(code) {
  return code.replace(
    /edit\s*:\s*function\s*\(\s*e\s*\)\s*\{/g,
    "edit: /** @param {{ container: JQuery<HTMLElement>, model?: any, sender?: any }} e */ function(e) {"
  );
}

function buildTypecheckCode(code) {
  const transformed = addKendoEditEventHint(code);
  return `${TYPECHECK_HEADER}${transformed}`;
}

function getInjectedHeaderLineCount() {
  return (TYPECHECK_HEADER.match(/\n/g) || []).length;
}

function makeTempPath(baseDir, source, index) {
  let name;

  try {
    name = new URL(source).pathname;
  } catch {
    name = source;
  }

  const safeName = path
    .basename(name || `inline-${index}`)
    .replace(/[^a-zA-Z0-9._-]/g, "_");

  return path.join(baseDir, `${String(index).padStart(4, "0")}-${safeName || "script"}.js`);
}

function createCompilerOptions(baseDir) {
  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    allowJs: true,
    checkJs: true,
    noEmit: true,
    strict: true,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    types: ["jquery"],
    typeRoots: [path.join(process.cwd(), "node_modules", "@types")],
    skipLibCheck: true,
    rootDir: baseDir,
  };
}

export async function typeCheckScripts(scripts) {
  const tempRoot = path.join(process.cwd(), "tmp", "typecheck");
  const runDir = path.join(tempRoot, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  mkdirSync(runDir, { recursive: true });

  const fileInfo = [];

  try {
    scripts.forEach((script, index) => {
      if (!script.code || !script.code.trim()) {
        return;
      }

      const filePath = makeTempPath(runDir, script.source, index);
      writeFileSync(filePath, buildTypecheckCode(script.code), "utf-8");
      fileInfo.push({ filePath, script });
    });

    if (!fileInfo.length) {
      return [];
    }

    const options = createCompilerOptions(runDir);
    const scriptFilePaths = fileInfo.map((item) => item.filePath);
    const program = ts.createProgram(scriptFilePaths, options);
    const diagnostics = ts.getPreEmitDiagnostics(program);

    const bySource = new Map();
    scripts.forEach((script) => {
      bySource.set(script.source, {
        source: script.source,
        kind: script.kind,
        messages: [],
      });
    });

    const fileToScript = new Map(fileInfo.map((item) => [path.resolve(item.filePath), item.script]));
    const headerLineCount = getInjectedHeaderLineCount();

    for (const diag of diagnostics) {
      if (!diag.file || typeof diag.start !== "number") {
        continue;
      }

      const fileName = path.resolve(diag.file.fileName);
      const script = fileToScript.get(fileName);
      if (!script) {
        continue;
      }

      const message = toMessageText(diag.messageText);
      if (!message) {
        continue;
      }

      if (shouldSuppressDiagnostic(diag.code, message)) {
        continue;
      }

      const { line, character } = diag.file.getLineAndCharacterOfPosition(diag.start);
      const messageLine = Math.max(1, line + 1 - headerLineCount);
      const messageColumn = Math.max(1, character + 1);

      bySource.get(script.source).messages.push({
        ruleId: "ts-check",
        severity: toSeverity(diag.category),
        line: messageLine,
        column: messageColumn,
        message,
      });
    }

    for (const result of bySource.values()) {
      result.messages.sort((a, b) => a.line - b.line || a.column - b.column);
    }

    return Array.from(bySource.values());
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
}
