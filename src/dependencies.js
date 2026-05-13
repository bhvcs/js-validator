const fs = require("node:fs/promises");
const path = require("node:path");
const { extractExternalScriptSources } = require("./extractor");

function normalizeSrc(src) {
  return src.split("#")[0].split("?")[0].trim();
}

function isRemoteSrc(src) {
  return /^https?:\/\//i.test(src) || src.startsWith("//");
}

function containsTemplateExpression(src) {
  return src.includes("<%") || src.includes("${");
}

async function loadDependencySnippetsFromJsp(jspContent, jspFilePath) {
  const jspDir = path.dirname(jspFilePath);
  const rawSources = extractExternalScriptSources(jspContent);
  const report = {
    loaded: [],
    skipped: [],
    missing: []
  };
  const snippets = [];
  const resolvedSeen = new Set();

  for (const rawSrc of rawSources) {
    const src = normalizeSrc(rawSrc);
    if (!src) {
      continue;
    }

    if (isRemoteSrc(src) || containsTemplateExpression(src)) {
      report.skipped.push({ src, reason: "remote-or-dynamic" });
      continue;
    }

    const resolvedPath = path.resolve(jspDir, src);
    if (resolvedSeen.has(resolvedPath)) {
      continue;
    }
    resolvedSeen.add(resolvedPath);

    try {
      const code = await fs.readFile(resolvedPath, "utf-8");
      snippets.push({
        id: `dep:${snippets.length + 1}`,
        code,
        sourceType: "dependency",
        sourceFile: resolvedPath,
        startLineInSource: 1
      });
      report.loaded.push({ src, file: resolvedPath });
    } catch (error) {
      if (error && error.code === "ENOENT") {
        report.missing.push({ src, file: resolvedPath });
      } else {
        report.missing.push({ src, file: resolvedPath, error: error.message });
      }
    }
  }

  return {
    snippets,
    report
  };
}

module.exports = {
  loadDependencySnippetsFromJsp
};
