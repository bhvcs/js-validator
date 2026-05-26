const { extractJavaScriptFromJsp } = require("./extractor");

const DEFAULT_LLAMA_URL = "http://127.0.0.1:8080";
const DEFAULT_TIMEOUT_MS = 600000;

function getLineCount(text) {
  return text.split(/\r?\n/).length;
}

function getSnippetSourceStartLine(snippet) {
  if (Number.isFinite(snippet.startLineInSource) && snippet.startLineInSource > 0) {
    return snippet.startLineInSource;
  }

  if (Number.isFinite(snippet.startLineInJsp) && snippet.startLineInJsp > 0) {
    return snippet.startLineInJsp;
  }

  return 1;
}

function getSnippetSourceLabel(snippet, filePath) {
  const sourceFile = snippet.sourceFile || filePath;
  const startLine = getSnippetSourceStartLine(snippet);
  const endLine = startLine + getLineCount(snippet.code) - 1;
  const sourceKind = snippet.sourceType === "jsp-inline" ? "JSP" : "source";
  return `Snippet ${snippet.id} (${sourceKind}: ${sourceFile}:${startLine}-${endLine})`;
}

function buildPromptPayload(snippets, filePath) {
  const lineMap = new Map();
  let analysisLine = 1;

  const formattedSnippets = snippets.map((snippet) => {
    const sourceStartLine = getSnippetSourceStartLine(snippet);
    const sourceFile = snippet.sourceFile || filePath;
    const sourceType = snippet.sourceType || "jsp-inline";
    const numberedLines = snippet.code
      .split(/\r?\n/)
      .map((line, index) => {
        const currentAnalysisLine = analysisLine + index;
        const sourceLine = sourceStartLine + index;

        lineMap.set(currentAnalysisLine, {
          snippetId: snippet.id,
          sourceType,
          sourceFile,
          sourceLine,
          snippetLine: index + 1,
          jspLine: sourceType === "jsp-inline" ? sourceLine : null,
          startLineInJsp: snippet.startLineInJsp || null
        });

        return `${currentAnalysisLine}| ${line}`;
      })
      .join("\n");

    analysisLine += getLineCount(snippet.code);

    return [
      getSnippetSourceLabel(snippet, filePath),
      "```javascript",
      numberedLines,
      "```"
    ].join("\n");
  });

  return {
    lineMap,
    prompt: [
      "You are reviewing JavaScript extracted from a JSP file.",
      "Only inspect the provided JavaScript snippets.",
      "Each code line is prefixed with an analysis line number as '<line>| <code>'.",
      "Snippet headers show the original source file and source line range for context.",
      "Report only clear defects that are likely wrong, such as syntax errors, undefined function usage, incorrect method names, or obviously invalid jQuery/DOM API usage.",
      "Do not return corrected code, rewritten code, or the original code.",
      "Do not report style suggestions or speculative issues.",
      "Return JSON only with this exact shape:",
      '{"issues":[{"line":1,"column":1,"severity":"error","message":"...","ruleId":"llama.cpp"}]}',
      "Line numbers must refer to the analysis line numbers shown before the pipe character, not the source line numbers in the snippet header.",
      "Column numbers must be 1-based positions within the code portion after the pipe character.",
      "If there are no issues, return {\"issues\":[]}",
      `File: ${filePath}`,
      "JavaScript snippets:",
      formattedSnippets.join("\n\n")
    ].join("\n")
  };
}

function normalizeSeverity(value) {
  if (typeof value !== "string") {
    return "error";
  }

  return value.toLowerCase() === "warning" ? "warning" : "error";
}

function extractJsonText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    throw new Error("llama.cpp returned an empty response");
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    return trimmed.slice(firstBracket, lastBracket + 1);
  }

  return trimmed;
}

function parseLlamaIssues(rawText, filePath, lineMap) {
  let parsed;
  try {
    parsed = JSON.parse(extractJsonText(rawText));
  } catch (error) {
    throw new Error(`Failed to parse llama.cpp JSON response: ${error.message}`);
  }

  const issues = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.issues) ? parsed.issues : null;
  if (!issues) {
    throw new Error("llama.cpp response JSON must be an array or an object with an issues array");
  }

  const detailsBySnippetId = new Map();

  const messages = issues
    .map((issue, index) => {
      const line = Number(issue.line ?? issue.jspLine);
      if (!Number.isFinite(line) || line < 1 || !lineMap.has(line)) {
        return null;
      }

      const mappedLine = lineMap.get(line);
      const column = Number(issue.column ?? issue.jspColumn ?? 1);
      const message = typeof issue.message === "string" ? issue.message.trim() : "";
      if (!message) {
        return null;
      }

      return {
        ruleId: typeof issue.ruleId === "string" && issue.ruleId.trim() ? issue.ruleId.trim() : "llama.cpp",
        severity: normalizeSeverity(issue.severity),
        message,
        sourceType: mappedLine.sourceType,
        sourceFile: mappedLine.sourceFile || filePath,
        sourceLine: mappedLine.sourceLine,
        sourceColumn: Number.isFinite(column) && column > 0 ? column : 1,
        snippetLine: mappedLine.snippetLine,
        snippetColumn: Number.isFinite(column) && column > 0 ? column : 1,
        jspLine: mappedLine.jspLine,
        jspColumn: mappedLine.jspLine ? (Number.isFinite(column) && column > 0 ? column : 1) : null,
        snippetId: mappedLine.snippetId,
        startLineInJsp: mappedLine.startLineInJsp,
        issueIndex: index
      };
    })
    .filter(Boolean);

  for (const message of messages) {
    if (!detailsBySnippetId.has(message.snippetId)) {
      detailsBySnippetId.set(message.snippetId, {
        snippetId: message.snippetId,
        startLineInJsp: message.startLineInJsp,
        sourceType: message.sourceType,
        sourceFile: message.sourceFile,
        messages: []
      });
    }

    detailsBySnippetId.get(message.snippetId).messages.push(message);
  }

  return {
    ok: messages.length === 0,
    totalIssues: messages.length,
    details: Array.from(detailsBySnippetId.values())
  };
}

async function parseJsonResponse(response) {
  const text = await response.text();
  let json;

  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`llama.cpp returned non-JSON HTTP payload: ${error.message}`);
  }

  if (!response.ok) {
    const detail = typeof json.error === "string"
      ? json.error
      : typeof json.message === "string"
        ? json.message
        : response.statusText;
    throw new Error(`llama.cpp request failed (${response.status}): ${detail}`);
  }

  return json;
}

function getChatContent(body) {
  return body?.choices?.[0]?.message?.content ?? body?.content ?? "";
}

function formatFetchError(error, requestUrl) {
  const cause = error?.cause;
  const causeCode = typeof cause?.code === "string" ? cause.code : "";
  const causeMessage = typeof cause?.message === "string" ? cause.message : "";

  if (error?.name === "TimeoutError") {
    return `Request to llama.cpp timed out: ${requestUrl}`;
  }

  if (error?.name === "AbortError") {
    return `Request to llama.cpp was aborted: ${requestUrl}`;
  }

  if (causeCode || causeMessage) {
    const detail = [causeCode, causeMessage].filter(Boolean).join(" - ");
    return `Failed to reach llama.cpp at ${requestUrl}: ${detail}`;
  }

  if (typeof error?.message === "string" && error.message.trim()) {
    return `Failed to reach llama.cpp at ${requestUrl}: ${error.message}`;
  }

  return `Failed to reach llama.cpp at ${requestUrl}`;
}

async function fetchWithDiagnostics(requestUrl, requestOptions) {
  try {
    return await fetch(requestUrl, requestOptions);
  } catch (error) {
    throw new Error(formatFetchError(error, requestUrl));
  }
}

async function callChatCompletions(baseUrl, prompt, model, timeoutMs) {
  const requestUrl = `${baseUrl}/v1/chat/completions`;
  const requestBody = {
    temperature: 0,
    messages: [
      {
        role: "system",
        content: "You are a precise static analysis assistant. Return JSON only."
      },
      {
        role: "user",
        content: prompt
      }
    ]
  };

  if (model) {
    requestBody.model = model;
  }

  const response = await fetchWithDiagnostics(requestUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(timeoutMs)
  });

  const body = await parseJsonResponse(response);
  const content = getChatContent(body);
  if (!content) {
    throw new Error("llama.cpp chat response did not include assistant content");
  }

  return content;
}

async function callLegacyCompletion(baseUrl, prompt, timeoutMs) {
  const requestUrl = `${baseUrl}/completion`;
  const response = await fetchWithDiagnostics(requestUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      prompt,
      temperature: 0,
      n_predict: 1024
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  const body = await parseJsonResponse(response);
  const content = body?.content ?? "";
  if (!content) {
    throw new Error("llama.cpp legacy completion response did not include content");
  }

  return content;
}

async function detectModelId(baseUrl, timeoutMs) {
  try {
    const requestUrl = `${baseUrl}/v1/models`;
    const response = await fetchWithDiagnostics(requestUrl, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs)
    });
    const body = await parseJsonResponse(response);
    const modelId = body?.data?.[0]?.id;
    return typeof modelId === "string" && modelId.trim() ? modelId.trim() : undefined;
  } catch (_error) {
    return undefined;
  }
}

async function analyzeJspWithLlama(options) {
  const filePath = options.filePath;
  const jspContent = options.jspContent;
  const baseUrl = String(options.url || DEFAULT_LLAMA_URL).replace(/\/$/, "");
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const snippets = Array.isArray(options.snippets) && options.snippets.length > 0
    ? options.snippets
    : extractJavaScriptFromJsp(jspContent);

  if (snippets.length === 0) {
    return {
      engine: "llama.cpp",
      llama: {
        url: baseUrl,
        model: options.model
      },
      ok: true,
      totalIssues: 0,
      details: []
    };
  }

  const { prompt, lineMap } = buildPromptPayload(snippets, filePath);
  const model = options.model || await detectModelId(baseUrl, timeoutMs);

  let rawResponse;
  try {
    rawResponse = await callChatCompletions(baseUrl, prompt, model, timeoutMs);
  } catch (error) {
    const message = String(error.message || "");
    const shouldFallback = message.includes("404") || message.includes("405") || message.includes("did not include assistant content");
    if (!shouldFallback) {
      throw error;
    }

    rawResponse = await callLegacyCompletion(baseUrl, prompt, timeoutMs);
  }

  return {
    engine: "llama.cpp",
    llama: {
      url: baseUrl,
      model
    },
    ...parseLlamaIssues(rawResponse, filePath, lineMap)
  };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_LLAMA_URL,
  analyzeJspWithLlama
};
