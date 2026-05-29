// lib/adf.js — Atlassian Document Format (ADF) -> plain Markdown text.
//
// Why this exists: Jira REST API v3 returns rich-text fields (our "Changelog
// Entry") as an ADF JSON tree, not a string. We convert it back to text at the
// point of use so the rest of the pipeline keeps treating the entry as the
// plain Markdown an engineer typed.
//
// Design intent — fidelity to the documented workflow: engineers TYPE plain
// Markdown into the field. That arrives as ADF text nodes and passes through
// verbatim (no marks to re-encode). If someone instead uses Jira's native
// formatting (bold, links, lists, code), we render the common cases to their
// Markdown equivalent so the output is still clean Markdown either way.
//
// Pure, no I/O, no config: every function takes what it needs and returns a
// string. Trivially unit-testable offline (see scripts/_selftest.js).

// Convert an ADF value to text. Tolerant by design: a plain string (v2 field,
// or a Jira config that returns plain text) passes straight through, and
// null/undefined become "". Unknown node types recurse into their children so
// we never silently drop content.
export function adfToText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value; // plain-text field / v2 fallback
  if (typeof value !== "object") return String(value);
  return renderNode(value, "").replace(/\n{3,}/g, "\n\n").trim();
}

// Block-level nodes are separated by a blank line; inline nodes concatenate.
function renderNode(node, indent) {
  if (!node || typeof node !== "object") return "";
  const kids = Array.isArray(node.content) ? node.content : [];

  switch (node.type) {
    case "doc":
      return blocks(kids, indent);

    case "paragraph":
      return inline(kids);

    case "heading": {
      const level = Math.min(Math.max(node.attrs?.level || 1, 1), 6);
      return `${"#".repeat(level)} ${inline(kids)}`;
    }

    case "bulletList":
      return kids.map((li) => listItem(li, indent, "- ")).join("\n");

    case "orderedList": {
      let n = node.attrs?.order ?? 1;
      return kids.map((li) => listItem(li, indent, `${n++}. `)).join("\n");
    }

    case "blockquote":
      return blocks(kids, indent)
        .split("\n")
        .map((l) => (l ? `> ${l}` : ">"))
        .join("\n");

    case "codeBlock": {
      const lang = node.attrs?.language || "";
      const code = kids.map((k) => k.text || "").join("");
      return "```" + lang + "\n" + code + "\n```";
    }

    case "rule":
      return "---";

    case "text":
      return applyMarks(node.text || "", node.marks);

    case "hardBreak":
      return "\n";

    case "mention":
      return node.attrs?.text || "";

    case "emoji":
      return node.attrs?.text || node.attrs?.shortName || "";

    case "inlineCard":
      return node.attrs?.url || "";

    default:
      // Unknown/unhandled node: render any children so text is never dropped.
      return kids.length ? blocks(kids, indent) : "";
  }
}

function blocks(nodes, indent) {
  return nodes
    .map((n) => renderNode(n, indent))
    .filter((s) => s !== "")
    .join("\n\n");
}

function inline(nodes) {
  return nodes.map((n) => renderNode(n, "")).join("");
}

// One list item -> a single Markdown line (plus indented continuation lines for
// multi-paragraph or nested-list items).
function listItem(li, indent, marker) {
  const childIndent = indent + " ".repeat(marker.length);
  const inner = (Array.isArray(li.content) ? li.content : [])
    .map((n) => renderNode(n, childIndent))
    .filter((s) => s !== "")
    .join("\n");
  const [first, ...rest] = inner.split("\n");
  const head = `${indent}${marker}${first}`;
  if (!rest.length) return head;
  return [head, ...rest.map((l) => (l ? `${childIndent}${l}` : l))].join("\n");
}

// Re-encode inline marks as Markdown. These only fire when a user leaned on
// Jira's formatting toolbar; literal Markdown typed as text has no marks and is
// untouched.
function applyMarks(text, marks) {
  if (!Array.isArray(marks)) return text;
  for (const m of marks) {
    switch (m.type) {
      case "code":
        text = "`" + text + "`";
        break;
      case "strong":
        text = `**${text}**`;
        break;
      case "em":
        text = `*${text}*`;
        break;
      case "strike":
        text = `~~${text}~~`;
        break;
      case "link":
        if (m.attrs?.href) text = `[${text}](${m.attrs.href})`;
        break;
    }
  }
  return text;
}
