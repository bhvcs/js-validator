const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const TYPECHECK_HEADER = [
  "// @ts-check",
  '/// <reference types="jquery" />',
  ""
].join("\n");

const JQUERY_DIAGNOSTIC_PATTERNS = [
  /Property '([^']+)' does not exist on type 'JQuery/i,
  /Property '([^']+)' does not exist on type 'JQuery<[^>]+>'/i
];

const KNOWN_JQUERY_METHODS = new Set([
  "addClass", "after", "ajax", "append", "attr", "before", "bind", "blur", "change", "children",
  "click", "closest", "css", "data", "each", "empty", "eq", "filter", "find", "first",
  "focus", "hasClass", "height", "hide", "html", "is", "last", "map", "next", "off",
  "on", "one", "parent", "parents", "prepend", "prop", "ready", "remove", "removeAttr",
  "removeClass", "show", "siblings", "text", "toggle", "trigger", "unbind", "val", "width"
]);

function toMessageText(messageText) {
  if (typeof messageText === "string") {
    return messageText;
  }

  return ts.flattenDiagnosticMessageText(messageText, "\n");
}

function isJqueryMethodDiagnostic(message) {
  if (!message) {
    return false;
  }

  return JQUERY_DIAGNOSTIC_PATTERNS.some((pattern) => pattern.test(message));
}

function buildTypecheckCode(code) {
  const transformed = code.replace(
    /edit\s*:\s*function\s*\(\s*e\s*\)\s*\{/g,
    "edit: /** @param {{ container: JQuery<HTMLElement>, model?: any, sender?: any }} e */ function(e) {"
  );

  return `${TYPECHECK_HEADER}${transformed}`;
}

function getInjectedHeaderLineCount() {
  return (TYPECHECK_HEADER.match(/\n/g) || []).length;
}

function makeTempPath(baseDir, snippet, index) {
  const sourceFileName = path.basename(snippet.sourceFile || `snippet-${snippet.id || index}.js`);
  const safeName = sourceFileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(baseDir, `${String(index).padStart(4, "0")}-${safeName}`);
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
    rootDir: baseDir
  };
}

function isLikelyJqueryExpression(expr) {
  const value = String(expr || "");
  if (!value) {
    return false;
  }

  if (value.includes("$(") || value.includes("jQuery(")) {
    return true;
  }

  if (value.includes(".find(") || value.includes(".children(") || value.includes(".closest(")) {
    return true;
  }

  return value.includes("e.container");
}

function detectJqueryTyposHeuristic(snippet) {
  const code = String(snippet.code || "");
  const lines = code.split(/\r?\n/);
  const jqueryVars = new Set(["$", "jQuery", "e.container"]);
  const issues = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const assignmentRegex = /\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+)/g;
    let assignMatch;
    while ((assignMatch = assignmentRegex.exec(line)) !== null) {
      const varName = assignMatch[1];
      const rhs = assignMatch[2];
      const isKendoWidget = /\.data\(\s*["']kendo[A-Za-z]+["']\s*\)/.test(rhs);
      if (isKendoWidget) {
        continue;
      }

      if (isLikelyJqueryExpression(rhs)) {
        jqueryVars.add(varName);
      }
    }

    const callRegex = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
    let callMatch;
    while ((callMatch = callRegex.exec(line)) !== null) {
      const receiver = callMatch[1];
      const method = callMatch[2];
      const receiverRoot = receiver.split(".")[0];
      const receiverIsJquery = jqueryVars.has(receiver)
        || jqueryVars.has(receiverRoot)
        || isLikelyJqueryExpression(receiver)
        || receiver.startsWith("$");

      if (!receiverIsJquery) {
        continue;
      }

      if (KNOWN_JQUERY_METHODS.has(method)) {
        continue;
      }

      const snippetLine = i + 1;
      const snippetColumn = callMatch.index + receiver.length + 2;
      const sourceType = snippet.sourceType || "jsp-inline";
      const sourceLine = sourceType === "jsp-inline"
        ? (snippet.startLineInJsp || 1) + snippetLine - 1
        : (snippet.startLineInSource || 1) + snippetLine - 1;

      issues.push({
        snippetId: snippet.id,
        startLineInJsp: snippet.startLineInJsp || null,
        sourceType,
        sourceFile: snippet.sourceFile,
        ruleId: "jquery-unknown-method",
        severity: "error",
        message: `Unknown jQuery method '${method}' on '${receiver}'.`,
        sourceLine,
        sourceColumn: snippetColumn,
        snippetLine,
        snippetColumn,
        jspLine: sourceType === "jsp-inline" ? sourceLine : null,
        jspColumn: sourceType === "jsp-inline" ? snippetColumn : null
      });
    }
  }

  return issues;
}

async function detectJqueryTypos(snippets) {
  const tempRoot = path.join(process.cwd(), "tmp", "typecheck");
  const runDir = path.join(tempRoot, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  fs.mkdirSync(runDir, { recursive: true });
  const fileInfo = [];

  try {
    snippets.forEach((snippet, index) => {
      if (!snippet || typeof snippet.code !== "string" || !snippet.code.trim()) {
        return;
      }

      const filePath = makeTempPath(runDir, snippet, index);
      fs.writeFileSync(filePath, buildTypecheckCode(snippet.code), "utf-8");
      fileInfo.push({ filePath, snippet });
    });

    if (fileInfo.length === 0) {
      return [];
    }

    const options = createCompilerOptions(runDir);
    const program = ts.createProgram(fileInfo.map((item) => item.filePath), options);
    const diagnostics = ts.getPreEmitDiagnostics(program);

    const fileToSnippet = new Map(fileInfo.map((item) => [path.resolve(item.filePath), item.snippet]));
    const headerLineCount = getInjectedHeaderLineCount();
    const issues = [];

    for (const diagnostic of diagnostics) {
      if (!diagnostic.file || typeof diagnostic.start !== "number") {
        continue;
      }

      const fileName = path.resolve(diagnostic.file.fileName);
      const snippet = fileToSnippet.get(fileName);
      if (!snippet) {
        continue;
      }

      const message = toMessageText(diagnostic.messageText);
      if (!isJqueryMethodDiagnostic(message)) {
        continue;
      }

      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      const snippetLine = Math.max(1, line + 1 - headerLineCount);
      const snippetColumn = Math.max(1, character + 1);
      const sourceType = snippet.sourceType || "jsp-inline";
      const sourceLine = sourceType === "jsp-inline"
        ? (snippet.startLineInJsp || 1) + snippetLine - 1
        : (snippet.startLineInSource || 1) + snippetLine - 1;

      issues.push({
        snippetId: snippet.id,
        startLineInJsp: snippet.startLineInJsp || null,
        sourceType,
        sourceFile: snippet.sourceFile,
        ruleId: "jquery-unknown-method",
        severity: diagnostic.category === ts.DiagnosticCategory.Error ? "error" : "warning",
        message,
        sourceLine,
        sourceColumn: snippetColumn,
        snippetLine,
        snippetColumn,
        jspLine: sourceType === "jsp-inline" ? sourceLine : null,
        jspColumn: sourceType === "jsp-inline" ? snippetColumn : null
      });
    }

    const fallbackIssues = snippets.flatMap((snippet) => detectJqueryTyposHeuristic(snippet));

    const deduped = new Map();
    for (const issue of [...issues, ...fallbackIssues]) {
      const key = [
        issue.snippetId,
        issue.ruleId,
        issue.message,
        issue.sourceLine,
        issue.sourceColumn
      ].join("|");

      if (!deduped.has(key)) {
        deduped.set(key, issue);
      }
    }

    return Array.from(deduped.values());
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
}

module.exports = {
  detectJqueryTypos
};