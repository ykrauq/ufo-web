import { Icon } from './icons'

const TOOLS: [string, string][] = [
  ['workspace_status', 'Counts, progress, findings by severity, pending suggestions'],
  ['load_sample_case', 'Loads the synthetic 14-file case'],
  ['list_files', 'Tree with true type, size, flags, finding counts; filters; nested entries'],
  ['inspect', 'Receipt for one file: identity, name-vs-bytes, flags, findings, container, text units'],
  ['extract_text', 'Paged text with provenance: page, sheet, slide, notes, comments, hidden text, strings'],
  ['search', 'Text, metadata, findings and archive-entry search across everything'],
  ['find', 'Structured query: flags, kind, family, author, size, mismatch, severity'],
  ['privacy_scan', 'Everything that identifies a person, place, device or organization'],
  ['hidden_content_scan', 'Everything a reader would not see'],
  ['entities', 'People, addresses, domains, organizations, devices, with the files each appears in'],
  ['duplicates', 'Byte-identical files anywhere, including inside archives; same name, different content'],
  ['compare', 'Two files: bytes, metadata, flags, text diff'],
  ['timeline', 'Every internal date merged, with anomalies'],
  ['peek_bytes', 'Bounded hex dump of any file or archive entry'],
  ['propose_action', 'Suggest note, flag, strip_metadata, rename_extension or quarantine; the person executes or dismisses'],
  ['list_proposals', 'Decisions and results: cleaned-copy hash, findings before and after'],
  ['export_report', 'JSON or Markdown report: receipts, findings, decisions, what needs the apps'],
  ['filter_file_list', 'The sidebar filter form, exposed through the declarative API'],
]

export function About({ onClose }: { onClose: () => void }) {
  return (
    <main className="about">
      <div className="about-inner">
        <button className="link small" onClick={onClose}>← Back to the workspace</button>
        <h2>About UFO Web</h2>
        <p className="lead">
          A file investigation workspace that runs entirely in your browser tab and exposes itself to AI agents through
          WebMCP. You drop files. The page reads what is really inside them. Your agent reasons across all of it. You decide
          what happens next.
        </p>

        <h3><Icon name="shield" /> What stays where</h3>
        <ul>
          <li>Files are read into memory in this tab and parsed here. Nothing is uploaded and there is no account.</li>
          <li>The page makes no third-party requests. Its security policy allows no destination but its own origin.</li>
          <li>Reload the page and the workspace is gone. Cleaned copies and reports exist only as downloads you chose.</li>
        </ul>

        <h3><Icon name="agent" /> Using it with an agent</h3>
        <ul>
          <li><b>ChatGPT desktop (Windows/macOS):</b> open this page in the app's built-in browser and ask, for example, <em>"Load the sample case, run a privacy scan, and suggest what to clean before I send these files."</em> Site tools need the GPT-5.6 Sol or Terra models.</li>
          <li><b>Chrome 149+:</b> enable <code>chrome://flags/#enable-webmcp-testing</code>. DevTools → Application → WebMCP lists the tools and can run them. The <b>Scripted demo</b> button replays a fixed sequence of calls through the browser's own API; no language model is involved.</li>
          <li><b>Any browser:</b> the "Try a tool by hand" panel and the console (<code>ufoWeb.call('privacy_scan', {'{}'})</code>) call the same tools.</li>
        </ul>

        <h3><Icon name="check" /> Suggestions, not actions</h3>
        <p>
          The agent can suggest: strip metadata, rename to the true type, quarantine, flag, note. It cannot execute anything.
          Each suggestion is a card with a reason; you press <b>Execute</b> or <b>Dismiss</b>. Executing produces a new file
          (the original is never touched), re-inspects it, and records the result with its SHA-256. The report keeps who
          suggested what and what you decided.
        </p>

        <h3><Icon name="ghost" /> What it finds</h3>
        <ul>
          <li><b>Word:</b> author and editor names, comments, tracked insertions and deletions, hidden ("vanish") runs, white-on-white text, 1-2pt text, editing-session identifiers, external link targets, macros, embedded objects.</li>
          <li><b>Excel:</b> hidden and veryHidden sheets, hidden rows and columns, macros with auto-run entry points.</li>
          <li><b>PowerPoint:</b> hidden slides, speaker notes.</li>
          <li><b>PDF:</b> Info and XMP metadata and whether they disagree, incremental revisions, invisible render-mode text, white text, off-page text, JavaScript, embedded files.</li>
          <li><b>Images:</b> GPS, artist and copyright, camera and lens serials, software, embedded thumbnails, PNG text chunks, data appended after the image ends.</li>
          <li><b>Email:</b> Reply-To and Return-Path mismatches, relay chain, originating IP, attachments.</li>
          <li><b>Archives:</b> nested archives, renamed executables, path-traversal names, encrypted entries, appended data.</li>
          <li><b>Code and text:</b> zero-width and bidirectional characters, mixed-script look-alikes, personal-data patterns with checksums, credential-shaped strings, text addressed to AI agents.</li>
          <li><b>Across files:</b> who appears where, byte-identical copies, one timeline of every internal date with anomalies.</li>
        </ul>

        <h3><Icon name="code" /> The tools</h3>
        <table className="tools-table">
          <tbody>{TOOLS.map(([n, d]) => <tr key={n}><th className="mono">{n}</th><td>{d}</td></tr>)}</tbody>
        </table>

        <h3><Icon name="eyeOff" /> Rendering</h3>
        <p>
          The Preview tab shows images, PDF pages, code with syntax highlighting, CSV grids, email, and a structured
          rendering of Word, Excel and PowerPoint files: paragraphs, runs, tables, lists, images, tracked changes, sheet
          grids, positioned slide text. It is built to make hidden content visible with the <b>Reveal hidden</b> switch,
          not to reproduce page layout. Full-fidelity rendering and editing live in the UFO apps.
        </p>

        <h3><Icon name="info" /> Limits</h3>
        <ul>
          <li>Per file 150 MB, workspace 600 MB, 1500 files, PDFs read to 60 pages, sheets to 2000 rows, archives two levels deep.</li>
          <li>Legacy OLE formats (.doc, .xls, .ppt, .msg), RAR and 7z contents, OCR, redaction, repair and conversion are not in the browser edition. Receipts say so and name what does it.</li>
          <li>Pattern matches are pattern matches. Card numbers pass Luhn and IBANs pass mod-97; emails and phones are shape matches.</li>
        </ul>

        <h3><Icon name="sparkle" /> The sample case</h3>
        <p>
          Fourteen synthetic files. Every name, company, number and address in them is fictional; any resemblance to a real
          person or organization is coincidental.
        </p>

        <h3><Icon name="folder" /> Relation to Universal File Opener</h3>
        <p>
          UFO Web is the open-source browser edition of <a href="https://universalfileopener.com" target="_blank" rel="noreferrer">Universal File Opener</a>.
          The apps carry the long tail of formats and the actions that change files: OCR, redaction, editing, conversion,
          batch work. UFO Web is the part you can hand to an agent in a tab.
        </p>
        <p className="muted small">
          MIT licensed. Source at <a href="https://github.com/ykrauq/ufo-web" target="_blank" rel="noreferrer">github.com/ykrauq/ufo-web</a>.
          Built on JSZip, pdf.js, exifr, pdf-lib, highlight.js and React.
        </p>
      </div>
    </main>
  )
}
