const fs = require("node:fs/promises");
const path = require("node:path");
const { extractJavaScriptFromJsp } = require("./extractor");
const { loadDependencySnippetsFromJsp } = require("./dependencies");
const { lintExtractedSnippets } = require("./linter");
const { writeAnnotatedSourceFiles } = require("./annotator");
const { analyzeJspWithLlama, DEFAULT_LLAMA_URL, DEFAULT_TIMEOUT_MS } = require("./llama");

function getOptionValue(args, optionName) {
  const prefix = `${optionName}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }

  const optionIndex = args.indexOf(optionName);
  if (optionIndex === -1) {
    return undefined;
  }

  const nextValue = args[optionIndex + 1];
  if (!nextValue || nextValue.startsWith("--")) {
    throw new Error(`Option ${optionName} requires a value`);
  }

  return nextValue;
}

async function main() {
  const args = process.argv.slice(2);
  const targetPath = args.find((arg) => !arg.startsWith("--"));
  const withDependencies = !args.includes("--no-deps");
  const useLlama = args.includes("--llama");
  const llamaUrl = getOptionValue(args, "--llama-url") || process.env.LLAMA_CPP_URL || DEFAULT_LLAMA_URL;
  const llamaModel = getOptionValue(args, "--llama-model") || process.env.LLAMA_CPP_MODEL;
  const llamaTimeoutMs = Number(
    getOptionValue(args, "--llama-timeout") || process.env.LLAMA_CPP_TIMEOUT_MS || DEFAULT_TIMEOUT_MS
  );

  if (!targetPath) {
    console.error(
      "Usage: node src/cli.js <jsp-file-path> [--with-deps|--no-deps] [--llama] [--llama-url <url>] [--llama-model <model>] [--llama-timeout <ms>]"
    );
    process.exit(1);
  }

  const fullPath = path.resolve(process.cwd(), targetPath);
  const content = await fs.readFile(fullPath, "utf-8");
  const inlineSnippets = extractJavaScriptFromJsp(content).map((snippet) => ({
    ...snippet,
    sourceType: "jsp-inline",
    sourceFile: fullPath
  }));

  let dependencySnippets = [];
  let dependencyReport;
  if (withDependencies) {
    const loaded = await loadDependencySnippetsFromJsp(content, fullPath);
    dependencySnippets = loaded.snippets;
    dependencyReport = loaded.report;
  }

  const snippets = withDependencies ? [...dependencySnippets, ...inlineSnippets] : inlineSnippets;
  let result;

  if (useLlama) {
    result = await analyzeJspWithLlama({
      filePath: fullPath,
      jspContent: content,
      snippets,
      url: llamaUrl,
      model: llamaModel,
      timeoutMs: llamaTimeoutMs
    });
  } else {
    result = await lintExtractedSnippets(snippets, {
      combine: withDependencies,
      filePath: fullPath
    });
  }

  let annotatedFile;
  let annotatedFiles;
  if (!result.ok) {
    const annotatedOutputs = await writeAnnotatedSourceFiles(fullPath, content, result);
    annotatedFile = annotatedOutputs.find((item) => item.sourceFile === fullPath)?.annotatedPath;
    annotatedFiles = annotatedOutputs.map((item) => ({
      sourceFile: item.sourceFile,
      annotatedFile: item.annotatedPath
    }));
  }

  console.log(
    JSON.stringify(
      {
        file: fullPath,
        scriptCount: inlineSnippets.length,
        withDependencies,
        engine: useLlama ? "llama.cpp" : "eslint",
        llama: useLlama
          ? {
              url: llamaUrl,
              model: llamaModel || result.llama?.model,
              timeoutMs: llamaTimeoutMs
            }
          : undefined,
        dependencyReport,
        annotatedFile,
        annotatedFiles,
        ...result
      },
      null,
      2
    )
  );
  process.exit(result.ok ? 0 : 2);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
