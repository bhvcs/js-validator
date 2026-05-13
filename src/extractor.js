const JS_SCRIPT_TYPE_PATTERN = /(text|application)\/javascript|module/i;

function countLine(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function shouldIncludeScriptTag(attributes) {
  if (/\bsrc\s*=\s*["'][^"']+["']/i.test(attributes)) {
    return false;
  }

  const typeMatch = attributes.match(/\btype\s*=\s*["']([^"']+)["']/i);
  if (!typeMatch) {
    return true;
  }

  return JS_SCRIPT_TYPE_PATTERN.test(typeMatch[1]);
}

function extractScriptSrc(attributes) {
  const srcMatch = attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
  return srcMatch ? srcMatch[1] : null;
}

function shouldIncludeExternalScriptTag(attributes) {
  const typeMatch = attributes.match(/\btype\s*=\s*["']([^"']+)["']/i);
  if (!typeMatch) {
    return true;
  }

  return JS_SCRIPT_TYPE_PATTERN.test(typeMatch[1]);
}

function stripJspFragments(scriptCode) {
  // Remove JSP scriptlet/directive/expression blocks from JS snippets.
  return scriptCode
    .replace(/<%@[\s\S]*?%>/g, "")
    .replace(/<%=[\s\S]*?%>/g, "")
    .replace(/<%[\s\S]*?%>/g, "");
}

function extractJavaScriptFromJsp(jspContent) {
  const scriptTagRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  const snippets = [];
  let match;

  while ((match = scriptTagRegex.exec(jspContent)) !== null) {
    const attributes = match[1] || "";
    const rawCode = match[2] || "";

    if (!shouldIncludeScriptTag(attributes)) {
      continue;
    }

    const code = stripJspFragments(rawCode).trim();
    if (!code) {
      continue;
    }

    const scriptStartIndex = match.index + match[0].indexOf(rawCode);
    snippets.push({
      id: snippets.length + 1,
      code,
      startLineInJsp: countLine(jspContent, scriptStartIndex)
    });
  }

  return snippets;
}

function extractExternalScriptSources(jspContent) {
  const scriptTagRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  const sources = [];
  let match;

  while ((match = scriptTagRegex.exec(jspContent)) !== null) {
    const attributes = match[1] || "";
    const src = extractScriptSrc(attributes);

    if (!src) {
      continue;
    }

    if (!shouldIncludeExternalScriptTag(attributes)) {
      continue;
    }

    sources.push(src);
  }

  return sources;
}

module.exports = {
  extractExternalScriptSources,
  extractJavaScriptFromJsp
};
