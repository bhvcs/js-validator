const { ESLint } = require("eslint");

const eslint = new ESLint({
  useEslintrc: false,
  baseConfig: {
    env: {
      browser: true,
      es2022: true
    },
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "script"
    },
    rules: {}
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

async function lintCombinedSnippets(snippets, options) {
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

async function lintExtractedSnippets(snippets, options = {}) {
  if (options.combine === true) {
    return lintCombinedSnippets(snippets, options);
  }

  const details = [];

  for (const snippet of snippets) {
    const messages = await lintSnippet(snippet);
    details.push({
      snippetId: snippet.id,
      startLineInJsp: snippet.startLineInJsp,
      messages
    });
  }

  const allMessages = details.flatMap((item) => item.messages);
  return {
    ok: allMessages.length === 0,
    totalIssues: allMessages.length,
    details
  };
}

module.exports = {
  lintExtractedSnippets
};
