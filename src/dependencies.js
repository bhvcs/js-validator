const fs = require("node:fs/promises");
const path = require("node:path");
const { extractExternalScriptSources, extractIncludeDirectives, extractJavaScriptFromJsp } = require("./extractor");

const DEFAULT_LAYOUT_INCLUDE_PATH = "/resources/common/layout.jsp";

function normalizeSrc(src) {
  return src.split("#")[0].split("?")[0].trim();
}

function resolveJspPath(filePath, baseDir, absoluteBaseDir = baseDir) {
  // For paths starting with /, resolve relative to the original JSP root directory.
  if (filePath.startsWith("/")) {
    return path.resolve(absoluteBaseDir, "." + filePath);
  }
  return path.resolve(baseDir, filePath);
}

function isRemoteSrc(src) {
  return /^https?:\/\//i.test(src) || src.startsWith("//");
}

function containsTemplateExpression(src) {
  return src.includes("<%") || src.includes("${");
}

function createLoadContext() {
  return {
    snippets: [],
    report: {
      loaded: [],
      skipped: [],
      missing: []
    },
    resolvedScriptSeen: new Set(),
    absoluteBaseDir: process.cwd(),
    visitedIncludeFiles: new Set()
  };
}

function pushInlineScriptsFromJspContent(context, jspContent, sourceFile) {
  const inlineScripts = extractJavaScriptFromJsp(jspContent);
  for (const script of inlineScripts) {
    context.snippets.push({
      id: `include:${context.snippets.length + 1}`,
      code: script.code,
      sourceType: "include",
      sourceFile,
      startLineInSource: script.startLineInJsp
    });
  }
}

async function loadExternalScriptDependencies(context, jspContent, jspFilePath) {
  const jspDir = path.dirname(jspFilePath);
  const rawSources = extractExternalScriptSources(jspContent);

  for (const rawSrc of rawSources) {
    const src = normalizeSrc(rawSrc);
    if (!src) {
      continue;
    }

    if (isRemoteSrc(src) || containsTemplateExpression(src)) {
      context.report.skipped.push({ src, reason: "remote-or-dynamic" });
      continue;
    }

    const resolvedPath = resolveJspPath(src, jspDir, context.absoluteBaseDir);
    if (context.resolvedScriptSeen.has(resolvedPath)) {
      continue;
    }
    context.resolvedScriptSeen.add(resolvedPath);

    try {
      const code = (await fs.readFile(resolvedPath, "utf-8"))
        .replace(/[\t ]+$/gm, "")
        .replace(/\s+$/, "");

      context.snippets.push({
        id: `dep:${context.snippets.length + 1}`,
        code,
        sourceType: "dependency",
        sourceFile: resolvedPath,
        startLineInSource: 1
      });
      context.report.loaded.push({ src, file: resolvedPath });
    } catch (error) {
      if (error && error.code === "ENOENT") {
        context.report.missing.push({ src, file: resolvedPath });
      } else {
        context.report.missing.push({ src, file: resolvedPath, error: error.message });
      }
    }
  }
}

async function loadIncludedJspDependencies(context, jspContent, jspFilePath) {
  const jspDir = path.dirname(jspFilePath);
  const includeFiles = extractIncludeDirectives(jspContent);

  for (const filePath of includeFiles) {
    const normalizedPath = normalizeSrc(filePath);
    if (!normalizedPath) {
      continue;
    }

    if (isRemoteSrc(normalizedPath) || containsTemplateExpression(normalizedPath)) {
      context.report.skipped.push({ src: normalizedPath, reason: "remote-or-dynamic" });
      continue;
    }

    const resolvedPath = resolveJspPath(normalizedPath, jspDir, context.absoluteBaseDir);
    if (context.visitedIncludeFiles.has(resolvedPath)) {
      context.report.skipped.push({ src: normalizedPath, reason: "circular-include" });
      continue;
    }

    try {
      const includedContent = await fs.readFile(resolvedPath, "utf-8");
      context.visitedIncludeFiles.add(resolvedPath);
      context.report.loaded.push({ src: normalizedPath, file: resolvedPath });

      // Include files can have both inline scripts and script src dependencies.
      pushInlineScriptsFromJspContent(context, includedContent, resolvedPath);
      await loadExternalScriptDependencies(context, includedContent, resolvedPath);
      await loadIncludedJspDependencies(context, includedContent, resolvedPath);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        context.report.missing.push({ src: normalizedPath, file: resolvedPath });
      } else {
        context.report.missing.push({
          src: normalizedPath,
          file: resolvedPath,
          error: error.message
        });
      }
    }
  }
}

async function preloadDefaultLayout(context, jspFilePath, includePath) {
  const jspDir = path.dirname(jspFilePath);
  const resolvedLayoutPath = resolveJspPath(includePath, jspDir, context.absoluteBaseDir);

  if (context.visitedIncludeFiles.has(resolvedLayoutPath)) {
    return;
  }

  try {
    const layoutContent = await fs.readFile(resolvedLayoutPath, "utf-8");
    context.visitedIncludeFiles.add(resolvedLayoutPath);
    context.report.loaded.push({ src: includePath, file: resolvedLayoutPath, reason: "default-layout" });

    pushInlineScriptsFromJspContent(context, layoutContent, resolvedLayoutPath);
    await loadExternalScriptDependencies(context, layoutContent, resolvedLayoutPath);
    await loadIncludedJspDependencies(context, layoutContent, resolvedLayoutPath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      context.report.missing.push({ src: includePath, file: resolvedLayoutPath, reason: "default-layout" });
    } else {
      context.report.missing.push({
        src: includePath,
        file: resolvedLayoutPath,
        reason: "default-layout",
        error: error.message
      });
    }
  }
}

async function loadDependencySnippetsFromJsp(jspContent, jspFilePath, options = {}) {
  const context = createLoadContext();
  context.absoluteBaseDir = path.dirname(jspFilePath);
  const includeDefaultLayout = options.includeDefaultLayout !== false;
  const defaultLayoutIncludePath = options.defaultLayoutIncludePath || DEFAULT_LAYOUT_INCLUDE_PATH;

  if (includeDefaultLayout) {
    await preloadDefaultLayout(context, jspFilePath, defaultLayoutIncludePath);
  }

  await loadExternalScriptDependencies(context, jspContent, jspFilePath);
  await loadIncludedJspDependencies(context, jspContent, jspFilePath);

  return {
    snippets: context.snippets,
    report: context.report
  };
}

module.exports = {
  DEFAULT_LAYOUT_INCLUDE_PATH,
  loadDependencySnippetsFromJsp
};
