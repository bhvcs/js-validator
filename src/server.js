const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const { extractJavaScriptFromJsp } = require("./extractor");
const { loadDependencySnippetsFromJsp } = require("./dependencies");
const { lintExtractedSnippets } = require("./linter");
const { buildAnnotatedJsp, writeAnnotatedJspFile } = require("./annotator");

const app = express();
app.use(express.json({ limit: "2mb" }));

async function lintJspContent(jspContent) {
  const snippets = extractJavaScriptFromJsp(jspContent).map((snippet) => ({
    ...snippet,
    sourceType: "jsp-inline"
  }));
  const lintResult = await lintExtractedSnippets(snippets);

  return {
    scriptCount: snippets.length,
    ...lintResult
  };
}

async function lintJspFile(jspPath, withDependencies) {
  const fullPath = path.resolve(process.cwd(), jspPath);
  const jspContent = await fs.readFile(fullPath, "utf-8");

  const inlineSnippets = extractJavaScriptFromJsp(jspContent).map((snippet) => ({
    ...snippet,
    sourceType: "jsp-inline",
    sourceFile: fullPath
  }));

  let dependencySnippets = [];
  let dependencyReport;
  if (withDependencies) {
    const loaded = await loadDependencySnippetsFromJsp(jspContent, fullPath);
    dependencySnippets = loaded.snippets;
    dependencyReport = loaded.report;
  }

  const snippets = withDependencies ? [...dependencySnippets, ...inlineSnippets] : inlineSnippets;
  const lintResult = await lintExtractedSnippets(snippets, {
    combine: withDependencies,
    filePath: fullPath
  });

  return {
    file: fullPath,
    jspContent,
    scriptCount: inlineSnippets.length,
    withDependencies,
    dependencyReport,
    ...lintResult
  };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    message: "JSP JS validator server is running",
    endpoints: {
      health: "GET /health",
      lintContent: "POST /lint/content",
      lintFile: "POST /lint/file"
    }
  });
});

app.post("/lint/content", async (req, res) => {
  try {
    const { jspContent, includeAnnotatedContent } = req.body || {};
    if (typeof jspContent !== "string") {
      return res.status(400).json({
        ok: false,
        error: "Request body must include string field: jspContent"
      });
    }

    const result = await lintJspContent(jspContent);
    if (!result.ok) {
      const response = { ...result };

      if (includeAnnotatedContent === true) {
        response.annotatedContent = buildAnnotatedJsp(jspContent, result);
      }

      return res.json(response);
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.post("/lint/file", async (req, res) => {
  try {
    const { jspPath, writeAnnotatedFile, withDependencies } = req.body || {};
    if (typeof jspPath !== "string") {
      return res.status(400).json({
        ok: false,
        error: "Request body must include string field: jspPath"
      });
    }

    const result = await lintJspFile(jspPath, withDependencies !== false);

    let annotatedFile;
    if (!result.ok) {
      if (writeAnnotatedFile !== false) {
        const { annotatedPath } = await writeAnnotatedJspFile(result.file, result.jspContent, result);
        annotatedFile = annotatedPath;
      }
    }

    return res.json({
      file: result.file,
      withDependencies: result.withDependencies,
      dependencyReport: result.dependencyReport,
      scriptCount: result.scriptCount,
      annotatedFile,
      ok: result.ok,
      totalIssues: result.totalIssues,
      details: result.details
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`JSP JS validator server is running on http://localhost:${port}`);
});
