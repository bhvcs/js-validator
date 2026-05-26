const fs = require("node:fs/promises");
const path = require("node:path");

function getEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function toComment(issue) {
  const severity = issue.severity === "warning" ? "WARN" : "ERROR";
  const rule = issue.ruleId ? `, rule: ${issue.ruleId}` : "";
  return `<!-- [JS ${severity}] col ${issue.jspColumn}: ${issue.message}${rule} -->`;
}

function buildAnnotatedJsp(jspContent, lintResult) {
  const eol = getEol(jspContent);
  const lines = jspContent.split(/\r?\n/);
  const issuesByLine = new Map();

  for (const detail of lintResult.details || []) {
    for (const message of detail.messages || []) {
      const line = Number(message.jspLine);
      if (!Number.isFinite(line) || line < 1) {
        continue;
      }

      if (!issuesByLine.has(line)) {
        issuesByLine.set(line, []);
      }
      issuesByLine.get(line).push(message);
    }
  }

  for (const lineIssues of issuesByLine.values()) {
    lineIssues.sort((a, b) => a.jspColumn - b.jspColumn);
  }

  const output = [];
  for (let i = 0; i < lines.length; i += 1) {
    const lineNumber = i + 1;
    const lineIssues = issuesByLine.get(lineNumber) || [];
    const suffix = lineIssues.map((issue) => toComment(issue)).join(" ");
    output.push(suffix ? `${lines[i]} ${suffix}` : lines[i]);
  }

  return output.join(eol);
}

function getAnnotatedFilePath(filePath) {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}.annotated${parsed.ext}`);
}

async function writeAnnotatedJspFile(sourceFilePath, jspContent, lintResult) {
  const annotatedPath = getAnnotatedFilePath(sourceFilePath);
  const annotatedContent = buildAnnotatedJsp(jspContent, lintResult);
  await fs.writeFile(annotatedPath, annotatedContent, "utf-8");

  return {
    annotatedPath,
    annotatedContent
  };
}

async function writeAnnotatedSourceFiles(sourceFilePath, jspContent, lintResult) {
  const { annotatedPath, annotatedContent } = await writeAnnotatedJspFile(sourceFilePath, jspContent, lintResult);

  return [
    {
      sourceFile: sourceFilePath,
      annotatedPath,
      annotatedContent
    }
  ];
}

module.exports = {
  buildAnnotatedJsp,
  getAnnotatedFilePath,
  writeAnnotatedJspFile,
  writeAnnotatedSourceFiles
};
