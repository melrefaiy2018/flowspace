import DOMPurify from 'dompurify';

/** Sanitize HTML produced by renderMarkdown before inserting into the DOM. */
export function safeMarkdown(text: string): string {
  return DOMPurify.sanitize(renderMarkdown(text));
}

/** @internal — use safeMarkdown() instead to prevent XSS */
function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) =>
    `<pre class="md-pre"><code>${code.trim()}</code></pre>`
  );

  html = html.replace(
    /((?:^.*\|.*$\n?){2,})/gm,
    (block) => {
      const rows = block.trim().split('\n');
      const dataRows = rows.filter((row) => !/^\|[\s\-:|]+\|$/.test(row) && !/^[\s\-:|]+$/.test(row));
      if (dataRows.length === 0) return block;

      const parseRow = (row: string) => row.split('|').map((cell) => cell.trim()).filter(Boolean);
      const headerCells = parseRow(dataRows[0]);
      const bodyRows = dataRows.slice(1);

      let table = '<table class="md-table">';
      table += '<thead><tr>' + headerCells.map((cell) => `<th>${inlineFormat(cell)}</th>`).join('') + '</tr></thead>';
      if (bodyRows.length > 0) {
        table += '<tbody>';
        for (const row of bodyRows) {
          const cells = parseRow(row);
          table += '<tr>' + cells.map((cell) => `<td>${inlineFormat(cell)}</td>`).join('') + '</tr>';
        }
        table += '</tbody>';
      }
      table += '</table>';
      return table;
    }
  );

  const lines = html.split('\n');
  const out: string[] = [];
  let inList = false;
  let listType: 'ul' | 'ol' = 'ul';

  for (const line of lines) {
    if (line.startsWith('<pre') || line.startsWith('<table')) {
      if (inList) { out.push(`</${listType}>`); inList = false; }
      out.push(line);
      continue;
    }

    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      if (inList) { out.push(`</${listType}>`); inList = false; }
      out.push('<hr class="md-hr"/>');
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      if (inList) { out.push(`</${listType}>`); inList = false; }
      const level = headingMatch[1].length;
      const cls = level === 1 ? 'md-h1' : level === 2 ? 'md-h2' : 'md-h3';
      out.push(`<div class="${cls}">${inlineFormat(headingMatch[2])}</div>`);
      continue;
    }

    const ulMatch = line.match(/^[\s]*[-*]\s+(.+)$/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) out.push(`</${listType}>`);
        out.push('<ul class="md-ul">');
        inList = true;
        listType = 'ul';
      }
      out.push(`<li>${inlineFormat(ulMatch[1])}</li>`);
      continue;
    }

    const olMatch = line.match(/^[\s]*\d+[.)]\s+(.+)$/);
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) out.push(`</${listType}>`);
        out.push('<ol class="md-ol">');
        inList = true;
        listType = 'ol';
      }
      out.push(`<li>${inlineFormat(olMatch[1])}</li>`);
      continue;
    }

    if (inList) { out.push(`</${listType}>`); inList = false; }

    if (line.trim() === '') {
      out.push('<div class="h-2"></div>');
      continue;
    }

    out.push(`<p class="md-p">${inlineFormat(line)}</p>`);
  }

  if (inList) out.push(`</${listType}>`);
  return out.join('');
}

function inlineFormat(text: string): string {
  return text
    .replace(/!!(.+?)!!/g, '<span class="md-deadline">$1</span>')
    .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Markdown links: [text](url)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer" class="md-link">$1</a>')
    // Bare URLs (not already inside an href)
    .replace(/(?<!href="|">)(https?:\/\/[^\s<)"]+)/g, '<a href="$1" target="_blank" rel="noreferrer" class="md-link">$1</a>');
}
