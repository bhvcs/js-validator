const fs = require("node:fs/promises");
const path = require("node:path");
const { extractJavaScriptFromJsp } = require("./extractor");
const { loadDependencySnippetsFromJsp } = require("./dependencies");
const { lintExtractedSnippets } = require("./linter");
const { writeAnnotatedJspFile } = require("./annotator");

async function main() {
  const args = process.argv.slice(2);
  const targetPath = args.find((arg) => !arg.startsWith("--"));
  const withDependencies = !args.includes("--no-deps");

  if (!targetPath) {
    console.error("Usage: node src/cli.js <jsp-file-path> [--with-deps|--no-deps]");
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
  const result = await lintExtractedSnippets(snippets, {
    combine: withDependencies,
    filePath: fullPath
  });

  let annotatedFile;
  if (!result.ok) {
    const { annotatedPath } = await writeAnnotatedJspFile(fullPath, content, result);
    annotatedFile = annotatedPath;
  }

  console.log(
    JSON.stringify(
      {
        file: fullPath,
        scriptCount: inlineSnippets.length,
        withDependencies,
        dependencyReport,
        annotatedFile,
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
