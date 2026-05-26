const { ESLint } = require("eslint");
const { detectJqueryTypos } = require("./typecheck");

const DEFAULT_GLOBALS = {
  $: "readonly"
};

const eslint = new ESLint({
  useEslintrc: false,
  baseConfig: {
    extends: ["eslint:recommended"],
    env: {
      browser: true,
      jquery: true,
      es2022: true
    },
    globals: DEFAULT_GLOBALS,
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "script"
    },
    rules: {
      // 핵심: 정의되지 않은 함수/식별자 사용을 정적으로 검출.
      "no-undef": "error",
      "no-unused-vars": "warn",
      "no-unused-expressions": "error"
    }
  }
});

async function lintSnippet(snippet) {
  const results = await eslint.lintText(snippet.code, {
    filePath: snippet.sourceFile || `snippet_${snippet.id}.js`
  });

  const [result] = results;
  return result.messages.map((message) => ({
    ruleId: message.ruleId,
    severity: message.severity === 2 ? "error" : "warning",
    message: message.message,
    snippetLine: message.line,
    snippetColumn: message.column,
    jspLine: snippet.startLineInJsp + message.line - 1,
    jspColumn: message.column
  }));
}

function mapCombinedMessageToSource(message, block) {
  const localLine = message.line - block.startLine + 1;
  const sourceType = block.snippet.sourceType || "jsp-inline";
  const sourceFile = block.snippet.sourceFile;
  const sourceLine = sourceType === "jsp-inline"
    ? block.snippet.startLineInJsp + localLine - 1
    : (block.snippet.startLineInSource || 1) + localLine - 1;

  return {
    ruleId: message.ruleId,
    severity: message.severity === 2 ? "error" : "warning",
    message: message.message,
    sourceType,
    sourceFile,
    sourceLine,
    sourceColumn: message.column,
    snippetLine: localLine,
    snippetColumn: message.column,
    jspLine: sourceType === "jsp-inline" ? sourceLine : null,
    jspColumn: sourceType === "jsp-inline" ? message.column : null
  };
}

async function runCombinedLintPass(snippets, options) {
  const blocks = [];
  const codeParts = [];
  let currentLine = 1;

  for (const snippet of snippets) {
    const code = snippet.code || "";
    codeParts.push(code);
    const lineCount = code.split(/\r?\n/).length;

    blocks.push({
      snippet,
      startLine: currentLine,
      endLine: currentLine + lineCount - 1
    });

    codeParts.push("");
    currentLine += lineCount + 1;
  }

  const combinedCode = codeParts.join("\n");
  const results = await eslint.lintText(combinedCode, {
    filePath: options.filePath || "combined_snippets.js"
  });
  const [result] = results;

  const detailsBySnippetId = new Map();
  for (const snippet of snippets) {
    detailsBySnippetId.set(snippet.id, {
      snippetId: snippet.id,
      startLineInJsp: snippet.startLineInJsp || null,
      sourceType: snippet.sourceType || "jsp-inline",
      sourceFile: snippet.sourceFile,
      messages: []
    });
  }

  for (const message of result.messages) {
    if (!message.line) {
      continue;
    }

    const block = blocks.find((item) => message.line >= item.startLine && message.line <= item.endLine);
    if (!block) {
      continue;
    }

    const mapped = mapCombinedMessageToSource(message, block);
    detailsBySnippetId.get(block.snippet.id).messages.push(mapped);
  }

  const details = Array.from(detailsBySnippetId.values());
  const allMessages = details.flatMap((item) => item.messages);
  return {
    ok: allMessages.length === 0,
    totalIssues: allMessages.length,
    details
  };
}

function isParsingError(message) {
  return message.ruleId == null && typeof message.message === "string" && message.message.startsWith("Parsing error");
}

async function lintCombinedSnippets(snippets, options) {
  const firstPass = await runCombinedLintPass(snippets, options);

  const parseErrorSnippetIds = new Set();
  for (const detail of firstPass.details) {
    if (detail.messages.some((message) => isParsingError(message))) {
      parseErrorSnippetIds.add(detail.snippetId);
    }
  }

  if (parseErrorSnippetIds.size === 0) {
    return firstPass;
  }

  const parseableSnippets = snippets.filter((snippet) => !parseErrorSnippetIds.has(snippet.id));
  const secondPass = parseableSnippets.length > 0
    ? await runCombinedLintPass(parseableSnippets, options)
    : { details: [] };

  const secondPassById = new Map(secondPass.details.map((detail) => [detail.snippetId, detail]));
  const mergedDetails = [];

  for (const snippet of snippets) {
    if (parseErrorSnippetIds.has(snippet.id)) {
      const firstDetail = firstPass.details.find((detail) => detail.snippetId === snippet.id);
      if (firstDetail) {
        mergedDetails.push(firstDetail);
      }
      continue;
    }

    const secondDetail = secondPassById.get(snippet.id);
    if (secondDetail) {
      mergedDetails.push(secondDetail);
      continue;
    }

    const firstDetail = firstPass.details.find((detail) => detail.snippetId === snippet.id);
    if (firstDetail) {
      mergedDetails.push(firstDetail);
    }
  }

  const allMessages = mergedDetails.flatMap((detail) => detail.messages);
  return {
    ok: allMessages.length === 0,
    totalIssues: allMessages.length,
    details: mergedDetails
  };
}

async function lintExtractedSnippets(snippets, options = {}) {
  let baseResult;

  if (options.combine === true) {
    baseResult = await lintCombinedSnippets(snippets, options);
  } else {
    const details = [];

    for (const snippet of snippets) {
      const messages = await lintSnippet(snippet);
      details.push({
        snippetId: snippet.id,
        startLineInJsp: snippet.startLineInJsp,
        sourceType: snippet.sourceType || "jsp-inline",
        sourceFile: snippet.sourceFile,
        messages
      });
    }

    const allMessages = details.flatMap((item) => item.messages);
    baseResult = {
      ok: allMessages.length === 0,
      totalIssues: allMessages.length,
      details
    };
  }

  const jqueryMessages = await detectJqueryTypos(snippets);
  if (jqueryMessages.length === 0) {
    return baseResult;
  }

  const detailBySnippetId = new Map((baseResult.details || []).map((detail) => [detail.snippetId, detail]));

  for (const issue of jqueryMessages) {
    if (!detailBySnippetId.has(issue.snippetId)) {
      const fallbackSnippet = snippets.find((snippet) => snippet.id === issue.snippetId);
      const detail = {
        snippetId: issue.snippetId,
        startLineInJsp: issue.startLineInJsp,
        sourceType: issue.sourceType || fallbackSnippet?.sourceType || "jsp-inline",
        sourceFile: issue.sourceFile || fallbackSnippet?.sourceFile,
        messages: []
      };
      detailBySnippetId.set(issue.snippetId, detail);
      baseResult.details.push(detail);
    }

    const detail = detailBySnippetId.get(issue.snippetId);
    const duplicate = detail.messages.some(
      (message) => message.ruleId === issue.ruleId
        && message.message === issue.message
        && message.sourceLine === issue.sourceLine
        && message.sourceColumn === issue.sourceColumn
    );

    if (!duplicate) {
      detail.messages.push(issue);
    }
  }

  const allMessages = baseResult.details.flatMap((detail) => detail.messages || []);
  return {
    ok: allMessages.length === 0,
    totalIssues: allMessages.length,
    details: baseResult.details
  };
}

module.exports = {
  lintExtractedSnippets
};
