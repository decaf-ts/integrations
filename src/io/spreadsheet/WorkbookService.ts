/**
 * @module integrations/io/spreadsheet/workbook
 * @summary Offline reader/writer for binary workbook files (XLSX, ODS, XLS).
 * @description {@link SpreadsheetService} handles tabular *text* (CSV, TSV,
 * JSON). This service handles the binary workbook formats, with no network,
 * credentials, or third-party dependency — only `node:zlib`:
 *
 * - **XLSX** — an OOXML package (a ZIP of SpreadsheetML parts). Written with
 *   inline strings; read with shared or inline strings.
 * - **ODS** — an OpenDocument package (a ZIP whose first, uncompressed entry
 *   is `mimetype`).
 * - **XLS** — a BIFF8 `Workbook` stream inside a Compound File Binary
 *   container, with a shared string table. Write only.
 *
 * A workbook is modelled as one sheet of rows; a cell is a string, a finite
 * number, a boolean, or empty. Dates travel as ISO strings, objects as JSON.
 */
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * @description The workbook formats the service writes
 * @typedef {("xlsx"|"ods"|"xls")} WorkbookFormat
 * @memberOf module:integrations/io/spreadsheet/workbook
 */
export type WorkbookFormat = "xlsx" | "ods" | "xls";

/**
 * @description A single workbook cell value
 * @typedef {(string|number|boolean|null|undefined)} WorkbookCell
 * @memberOf module:integrations/io/spreadsheet/workbook
 */
export type WorkbookCell = string | number | boolean | null | undefined;

/**
 * @description Options for {@link WorkbookService.write}
 * @interface WorkbookWriteOptions
 * @memberOf module:integrations/io/spreadsheet/workbook
 */
export interface WorkbookWriteOptions {
  /**
   * @description The file format to write
   */
  format: WorkbookFormat;
  /**
   * @description Sheet name; defaults to `"Sheet1"`. Characters a sheet name
   * cannot hold are replaced and the name is cut to 31 characters.
   */
  sheetName?: string;
  /**
   * @description Header row written before the data rows
   */
  header?: string[];
}

/**
 * @description Options for {@link WorkbookService.read}
 * @interface WorkbookReadOptions
 * @memberOf module:integrations/io/spreadsheet/workbook
 */
export interface WorkbookReadOptions {
  /**
   * @description The file format; detected from the package content when omitted
   */
  format?: "xlsx" | "ods";
  /**
   * @description Whether the first row is the header (default `true`)
   */
  header?: boolean;
  /**
   * @description Sheet to read, by name; the first sheet when omitted
   */
  sheetName?: string;
}

/**
 * @description The content of one sheet
 * @interface WorkbookReadResult
 * @memberOf module:integrations/io/spreadsheet/workbook
 */
export interface WorkbookReadResult {
  format: "xlsx" | "ods";
  sheetName: string;
  header: string[];
  rows: WorkbookCell[][];
}

/** XLS (BIFF8) sheet limits. */
const XLS_MAX_ROWS = 65536;
const XLS_MAX_COLUMNS = 256;
/** Largest data payload of one BIFF record. */
const BIFF_MAX_RECORD = 8224;
/** Upper bound on cells materialised from a repeated ODS row/column run. */
const ODS_MAX_REPEAT = 1024;

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

function normalizeCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "bigint") return value.toString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sheetNameOf(name: string | undefined): string {
  const cleaned = (name ?? "Sheet1").replace(/[\\/?*[\]:]/g, "_").trim();
  return (cleaned.length > 0 ? cleaned : "Sheet1").slice(0, 31);
}

function tableOf(
  rows: readonly (readonly unknown[])[],
  header: readonly string[] | undefined
): (string | number | boolean | null)[][] {
  const table: (string | number | boolean | null)[][] = [];
  if (header && header.length > 0) table.push(header.map(normalizeCell));
  for (const row of rows) {
    table.push(Array.isArray(row) ? row.map(normalizeCell) : []);
  }
  return table;
}

function xmlEscape(text: string): string {
  return (
    text
      // XML 1.0 forbids most control characters outright.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
  );
}

function xmlUnescape(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_m, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10))
    )
    .replace(/&amp;/g, "&");
}

function columnName(index: number): string {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function columnIndex(reference: string): number {
  let index = 0;
  for (const char of reference) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

interface ZipEntry {
  name: string;
  data: Buffer;
  /** Store without compression (required for the ODS `mimetype` entry). */
  stored?: boolean;
}

function zipWrite(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const body = entry.stored ? entry.data : deflateRawSync(entry.data);
    const method = entry.stored ? 0 : 8;
    const checksum = crc32(entry.data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, body);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0x21, 14);
    header.writeUInt32LE(checksum, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

function zipRead(bytes: Buffer): Map<string, Buffer> {
  let end = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 65557; i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a ZIP package");
  const count = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index++) {
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("corrupt ZIP central directory");
    }
    const method = bytes.readUInt16LE(cursor + 10);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    const localName = bytes.readUInt16LE(localOffset + 26);
    const localExtra = bytes.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localName + localExtra;
    const body = bytes.subarray(start, start + compressed);
    if (method === 0) files.set(name, Buffer.from(body));
    else if (method === 8) files.set(name, inflateRawSync(body));
    else throw new Error(`unsupported ZIP compression method ${method}`);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function xlsxWrite(
  table: (string | number | boolean | null)[][],
  sheetName: string
): Buffer {
  const rows = table
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, cellIndex) => {
          if (cell === null) return "";
          const ref = `${columnName(cellIndex)}${rowIndex + 1}`;
          if (typeof cell === "number") return `<c r="${ref}"><v>${cell}</v></c>`;
          if (typeof cell === "boolean") {
            return `<c r="${ref}" t="b"><v>${cell ? 1 : 0}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(
            cell
          )}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  const text = (content: string): Buffer => Buffer.from(XML_HEADER + content, "utf8");
  return zipWrite([
    {
      name: "[Content_Types].xml",
      data: text(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          "</Types>"
      ),
    },
    {
      name: "_rels/.rels",
      data: text(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          "</Relationships>"
      ),
    },
    {
      name: "xl/workbook.xml",
      data: text(
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          `<sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
          "</workbook>"
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: text(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          "</Relationships>"
      ),
    },
    {
      name: "xl/styles.xml",
      data: text(
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
          '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
          '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
          '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
          '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
          '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
          "</styleSheet>"
      ),
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: text(
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
          `<sheetData>${rows}</sheetData>` +
          "</worksheet>"
      ),
    },
  ]);
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return match ? xmlUnescape(match[1]) : undefined;
}

function xlsxRead(
  files: Map<string, Buffer>,
  wanted: string | undefined
): { sheetName: string; table: WorkbookCell[][] } {
  const part = (name: string): string => files.get(name)?.toString("utf8") ?? "";
  const workbook = part("xl/workbook.xml");
  const rels = part("xl/_rels/workbook.xml.rels");
  const targets = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attribute(match[0], "Id");
    const target = attribute(match[0], "Target");
    if (id && target) targets.set(id, target);
  }
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((match) => ({
    name: attribute(match[0], "name") ?? "Sheet1",
    id: attribute(match[0], "r:id") ?? "",
  }));
  const sheet =
    (wanted ? sheets.find((entry) => entry.name === wanted) : sheets[0]) ??
    sheets[0];
  if (wanted && sheet?.name !== wanted) {
    throw new Error(`sheet '${wanted}' not found in the workbook`);
  }
  const target = targets.get(sheet?.id ?? "") ?? "worksheets/sheet1.xml";
  const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const xml = part(path);

  const shared: string[] = [];
  for (const item of part("xl/sharedStrings.xml").matchAll(
    /<si\b[^>]*>([\s\S]*?)<\/si>/g
  )) {
    shared.push(
      [...item[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
        .map((text) => xmlUnescape(text[1]))
        .join("")
    );
  }

  const table: WorkbookCell[][] = [];
  let nextRow = 0;
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const rowAttributes = rowMatch[1] ?? rowMatch[3] ?? "";
    const rowNumber = Number(attribute(rowAttributes, "r"));
    const rowIndex =
      Number.isInteger(rowNumber) && rowNumber > 0 ? rowNumber - 1 : nextRow;
    nextRow = rowIndex + 1;
    const row: WorkbookCell[] = [];
    let nextColumn = 0;
    for (const cellMatch of (rowMatch[2] ?? "").matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    )) {
      const attributes = cellMatch[1];
      const reference = attribute(attributes, "r");
      const column = reference ? columnIndex(reference) : nextColumn;
      nextColumn = column + 1;
      const type = attribute(attributes, "t");
      const body = cellMatch[2] ?? "";
      const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: WorkbookCell = null;
      if (type === "inlineStr") {
        value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
          .map((text) => xmlUnescape(text[1]))
          .join("");
      } else if (raw !== undefined) {
        if (type === "s") value = shared[Number(raw)] ?? "";
        else if (type === "b") value = raw === "1";
        else if (type === "str" || type === "e") value = xmlUnescape(raw);
        else {
          const numeric = Number(raw);
          value = Number.isFinite(numeric) ? numeric : xmlUnescape(raw);
        }
      }
      while (row.length < column) row.push(null);
      row[column] = value;
    }
    while (table.length < rowIndex) table.push([]);
    table[rowIndex] = row;
  }
  return { sheetName: sheet?.name ?? "Sheet1", table };
}

// ---------------------------------------------------------------------------
// ODS
// ---------------------------------------------------------------------------

const ODS_MIME = "application/vnd.oasis.opendocument.spreadsheet";
const ODS_NAMESPACES =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"';

function odsWrite(
  table: (string | number | boolean | null)[][],
  sheetName: string
): Buffer {
  const rows = table
    .map((row) => {
      const cells = row
        .map((cell) => {
          if (cell === null) return "<table:table-cell/>";
          if (typeof cell === "number") {
            return `<table:table-cell office:value-type="float" office:value="${cell}"><text:p>${cell}</text:p></table:table-cell>`;
          }
          if (typeof cell === "boolean") {
            return `<table:table-cell office:value-type="boolean" office:boolean-value="${cell}"><text:p>${
              cell ? "TRUE" : "FALSE"
            }</text:p></table:table-cell>`;
          }
          const paragraphs = cell
            .split(/\r?\n/)
            .map((line) => `<text:p>${xmlEscape(line)}</text:p>`)
            .join("");
          return `<table:table-cell office:value-type="string">${paragraphs}</table:table-cell>`;
        })
        .join("");
      return `<table:table-row>${cells}</table:table-row>`;
    })
    .join("");
  const xml = (content: string): Buffer =>
    Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n' + content, "utf8");
  return zipWrite([
    // The media type must be the first entry and must not be compressed.
    { name: "mimetype", data: Buffer.from(ODS_MIME, "ascii"), stored: true },
    {
      name: "content.xml",
      data: xml(
        `<office:document-content ${ODS_NAMESPACES} office:version="1.2">` +
          "<office:body><office:spreadsheet>" +
          `<table:table table:name="${xmlEscape(sheetName)}">${rows}</table:table>` +
          "</office:spreadsheet></office:body>" +
          "</office:document-content>"
      ),
    },
    {
      name: "styles.xml",
      data: xml(
        `<office:document-styles ${ODS_NAMESPACES} office:version="1.2"/>`
      ),
    },
    {
      name: "META-INF/manifest.xml",
      data: xml(
        '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">' +
          `<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="${ODS_MIME}"/>` +
          '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' +
          '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>' +
          "</manifest:manifest>"
      ),
    },
  ]);
}

function odsRead(
  files: Map<string, Buffer>,
  wanted: string | undefined
): { sheetName: string; table: WorkbookCell[][] } {
  const xml = files.get("content.xml")?.toString("utf8") ?? "";
  const tables = [
    ...xml.matchAll(/<table:table\b([^>]*)>([\s\S]*?)<\/table:table>/g),
  ].map((match) => ({
    name: attribute(match[1], "table:name") ?? "Sheet1",
    body: match[2],
  }));
  const sheet =
    (wanted ? tables.find((entry) => entry.name === wanted) : tables[0]) ??
    tables[0];
  if (wanted && sheet?.name !== wanted) {
    throw new Error(`sheet '${wanted}' not found in the workbook`);
  }
  const table: WorkbookCell[][] = [];
  for (const rowMatch of (sheet?.body ?? "").matchAll(
    /<table:table-row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g
  )) {
    const row: WorkbookCell[] = [];
    for (const cellMatch of (rowMatch[2] ?? "").matchAll(
      /<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g
    )) {
      const attributes = cellMatch[1];
      const type = attribute(attributes, "office:value-type");
      let value: WorkbookCell = null;
      if (type === "float" || type === "percentage" || type === "currency") {
        const numeric = Number(attribute(attributes, "office:value"));
        value = Number.isFinite(numeric) ? numeric : null;
      } else if (type === "boolean") {
        value = attribute(attributes, "office:boolean-value") === "true";
      } else if (type === "date") {
        value = attribute(attributes, "office:date-value") ?? null;
      } else if (type !== undefined || cellMatch[2]) {
        const text = [
          ...(cellMatch[2] ?? "").matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g),
        ]
          .map((paragraph) => xmlUnescape(paragraph[1].replace(/<[^>]+>/g, "")))
          .join("\n");
        value = type === undefined && text === "" ? null : text;
      }
      const repeat = Math.min(
        Number(attribute(attributes, "table:number-columns-repeated")) || 1,
        ODS_MAX_REPEAT
      );
      // Trailing empty runs are padding and are trimmed below; an empty run
      // between values keeps the columns aligned.
      for (let index = 0; index < repeat; index++) row.push(value);
    }
    while (row.length > 0 && row[row.length - 1] === null) row.pop();
    const repeatRows = Math.min(
      Number(attribute(rowMatch[1], "table:number-rows-repeated")) || 1,
      row.length === 0 ? 1 : ODS_MAX_REPEAT
    );
    for (let index = 0; index < repeatRows; index++) table.push([...row]);
  }
  while (table.length > 0 && table[table.length - 1].length === 0) table.pop();
  return { sheetName: sheet?.name ?? "Sheet1", table };
}

// ---------------------------------------------------------------------------
// XLS (BIFF8 in a Compound File Binary container)
// ---------------------------------------------------------------------------

function biff(id: number, data: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt16LE(id, 0);
  head.writeUInt16LE(data.length, 2);
  return Buffer.concat([head, data]);
}

function biffBof(type: number): Buffer {
  const data = Buffer.alloc(16);
  data.writeUInt16LE(0x0600, 0); // BIFF8
  data.writeUInt16LE(type, 2);
  data.writeUInt16LE(0x0dbb, 4);
  data.writeUInt16LE(0x07cc, 6);
  data.writeUInt32LE(0, 8);
  data.writeUInt32LE(6, 12);
  return biff(0x0809, data);
}

function biffFont(): Buffer {
  const name = Buffer.from("Arial", "utf16le");
  const data = Buffer.alloc(16 + name.length);
  data.writeUInt16LE(200, 0); // 10pt
  data.writeUInt16LE(0, 2);
  data.writeUInt16LE(0x7fff, 4);
  data.writeUInt16LE(400, 6);
  data.writeUInt16LE(0, 8);
  data.writeUInt8(0, 10);
  data.writeUInt8(0, 11);
  data.writeUInt8(0, 12);
  data.writeUInt8(0, 13);
  data.writeUInt8(5, 14);
  data.writeUInt8(1, 15); // UTF-16
  name.copy(data, 16);
  return biff(0x0031, data);
}

function biffXf(style: boolean): Buffer {
  const data = Buffer.alloc(20);
  data.writeUInt16LE(0, 0);
  data.writeUInt16LE(0, 2);
  data.writeUInt16LE(style ? 0xfff5 : 0x0001, 4);
  data.writeUInt8(0x20, 6);
  data.writeUInt8(0, 7);
  data.writeUInt8(0, 8);
  data.writeUInt8(0, 9);
  data.writeUInt32LE(0, 10);
  data.writeUInt32LE(0, 14);
  data.writeUInt16LE(0x20c0, 18);
  return biff(0x00e0, data);
}

/**
 * Builds the shared string table, splitting it into `SST` + `CONTINUE`
 * records. A string that does not fit starts a new record when it is small
 * enough to fit in one; a longer string is split on a character boundary and
 * each continuation restates the encoding flag, as the format requires.
 */
function biffSst(strings: string[], references: number): Buffer {
  const records: Buffer[] = [];
  let chunks: Buffer[] = [];
  let size = 0;
  let first = true;
  const flush = (): void => {
    records.push(biff(first ? 0x00fc : 0x003c, Buffer.concat(chunks)));
    first = false;
    chunks = [];
    size = 0;
  };
  const push = (chunk: Buffer): void => {
    chunks.push(chunk);
    size += chunk.length;
  };
  const head = Buffer.alloc(8);
  head.writeUInt32LE(references, 0);
  head.writeUInt32LE(strings.length, 4);
  push(head);
  for (const value of strings) {
    const text = Buffer.from(value, "utf16le");
    const length = value.length;
    // The 3-byte string header must not be split.
    if (size + 3 + Math.min(text.length, 2) > BIFF_MAX_RECORD) flush();
    if (3 + text.length <= BIFF_MAX_RECORD && size + 3 + text.length > BIFF_MAX_RECORD) {
      flush();
    }
    const header = Buffer.alloc(3);
    header.writeUInt16LE(length, 0);
    header.writeUInt8(1, 2); // UTF-16
    push(header);
    let offset = 0;
    while (offset < text.length) {
      let room = BIFF_MAX_RECORD - size;
      room -= room % 2;
      if (room <= 0) {
        flush();
        push(Buffer.from([1])); // continuation restates the encoding
        continue;
      }
      const take = Math.min(room, text.length - offset);
      push(text.subarray(offset, offset + take));
      offset += take;
    }
  }
  flush();
  return Buffer.concat(records);
}

function xlsWorkbookStream(
  table: (string | number | boolean | null)[][],
  sheetName: string
): Buffer {
  const strings: string[] = [];
  const stringIndex = new Map<string, number>();
  let references = 0;
  const cells: Buffer[] = [];
  let lastColumn = 0;
  table.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndexValue) => {
      if (cell === null) return;
      lastColumn = Math.max(lastColumn, columnIndexValue + 1);
      const head = Buffer.alloc(6);
      head.writeUInt16LE(rowIndex, 0);
      head.writeUInt16LE(columnIndexValue, 2);
      head.writeUInt16LE(15, 4); // the cell XF
      if (typeof cell === "number") {
        const value = Buffer.alloc(8);
        value.writeDoubleLE(cell, 0);
        cells.push(biff(0x0203, Buffer.concat([head, value])));
        return;
      }
      if (typeof cell === "boolean") {
        cells.push(
          biff(0x0205, Buffer.concat([head, Buffer.from([cell ? 1 : 0, 0])]))
        );
        return;
      }
      // Excel caps a cell at 32767 characters.
      const text = cell.slice(0, 32767);
      let index = stringIndex.get(text);
      if (index === undefined) {
        index = strings.length;
        strings.push(text);
        stringIndex.set(text, index);
      }
      references += 1;
      const value = Buffer.alloc(4);
      value.writeUInt32LE(index, 0);
      cells.push(biff(0x00fd, Buffer.concat([head, value])));
    });
  });

  const name = Buffer.from(sheetName, "utf16le");
  const window1 = Buffer.alloc(18);
  window1.writeUInt16LE(0x0168, 0);
  window1.writeUInt16LE(0x001e, 2);
  window1.writeUInt16LE(0x5d00, 4);
  window1.writeUInt16LE(0x3a98, 6);
  window1.writeUInt16LE(0x0038, 8);
  window1.writeUInt16LE(0, 10);
  window1.writeUInt16LE(0, 12);
  window1.writeUInt16LE(1, 14);
  window1.writeUInt16LE(0x0258, 16);
  const codepage = Buffer.alloc(2);
  codepage.writeUInt16LE(0x04b0, 0);
  const style = Buffer.from([0x00, 0x80, 0x00, 0xff]);

  const globalsHead = Buffer.concat([
    biffBof(0x0005),
    biff(0x0042, codepage),
    biff(0x003d, window1),
    biffFont(),
    biffFont(),
    biffFont(),
    biffFont(),
    biffFont(),
    ...Array.from({ length: 15 }, () => biffXf(true)),
    biffXf(false),
    biff(0x0293, style),
  ]);
  const boundLength = 4 + 8 + name.length;
  const globalsTail = Buffer.concat([
    biffSst(strings, references),
    biff(0x000a),
  ]);
  const sheetOffset = globalsHead.length + boundLength + globalsTail.length;
  const bound = Buffer.alloc(8 + name.length);
  bound.writeUInt32LE(sheetOffset, 0);
  bound.writeUInt8(0, 4);
  bound.writeUInt8(0, 5);
  bound.writeUInt8(sheetName.length, 6);
  bound.writeUInt8(1, 7); // UTF-16
  name.copy(bound, 8);

  const dimensions = Buffer.alloc(14);
  dimensions.writeUInt32LE(0, 0);
  dimensions.writeUInt32LE(table.length, 4);
  dimensions.writeUInt16LE(0, 8);
  dimensions.writeUInt16LE(lastColumn, 10);
  dimensions.writeUInt16LE(0, 12);
  const window2 = Buffer.alloc(18);
  window2.writeUInt16LE(0x06b6, 0);
  window2.writeUInt16LE(0, 2);
  window2.writeUInt16LE(0, 4);
  window2.writeUInt32LE(0x40, 6);

  return Buffer.concat([
    globalsHead,
    biff(0x0085, bound),
    globalsTail,
    biffBof(0x0010),
    biff(0x0200, dimensions),
    biff(0x023e, window2),
    ...cells,
    biff(0x000a),
  ]);
}

const CFB_SECTOR = 512;
const CFB_END_OF_CHAIN = 0xfffffffe;
const CFB_FREE = 0xffffffff;
const CFB_FAT_SECTOR = 0xfffffffd;
const CFB_DIFAT_SECTOR = 0xfffffffc;

function cfbDirectoryEntry(
  name: string,
  type: number,
  child: number,
  start: number,
  size: number
): Buffer {
  const entry = Buffer.alloc(128);
  const encoded = Buffer.from(name, "utf16le");
  encoded.copy(entry, 0);
  entry.writeUInt16LE(name.length === 0 ? 0 : encoded.length + 2, 64);
  entry.writeUInt8(type, 66);
  entry.writeUInt8(1, 67);
  entry.writeUInt32LE(CFB_FREE, 68);
  entry.writeUInt32LE(CFB_FREE, 72);
  entry.writeUInt32LE(child, 76);
  entry.writeUInt32LE(start, 116);
  entry.writeUInt32LE(size, 120);
  return entry;
}

/**
 * Wraps a `Workbook` stream in a Compound File Binary container. The stream
 * is padded to at least 4096 bytes so it lives in regular sectors and no
 * mini-stream is needed.
 */
function cfbWrite(stream: Buffer): Buffer {
  const length = Math.max(
    4096,
    Math.ceil(stream.length / CFB_SECTOR) * CFB_SECTOR
  );
  const data = Buffer.alloc(length);
  stream.copy(data);
  const dataSectors = length / CFB_SECTOR;
  const entriesPerSector = CFB_SECTOR / 4;

  // Sector layout: [FAT...][DIFAT...][directory][data...]
  let fatSectors = 0;
  let difatSectors = 0;
  for (;;) {
    const total = fatSectors + difatSectors + 1 + dataSectors;
    const neededFat = Math.ceil(total / entriesPerSector);
    const neededDifat =
      neededFat > 109 ? Math.ceil((neededFat - 109) / (entriesPerSector - 1)) : 0;
    if (neededFat === fatSectors && neededDifat === difatSectors) break;
    fatSectors = neededFat;
    difatSectors = neededDifat;
  }
  const directorySector = fatSectors + difatSectors;
  const firstData = directorySector + 1;
  const totalSectors = firstData + dataSectors;

  const fat = Buffer.alloc(fatSectors * CFB_SECTOR, 0xff);
  for (let index = 0; index < fatSectors; index++) {
    fat.writeUInt32LE(CFB_FAT_SECTOR, index * 4);
  }
  for (let index = 0; index < difatSectors; index++) {
    fat.writeUInt32LE(CFB_DIFAT_SECTOR, (fatSectors + index) * 4);
  }
  fat.writeUInt32LE(CFB_END_OF_CHAIN, directorySector * 4);
  for (let sector = firstData; sector < totalSectors; sector++) {
    fat.writeUInt32LE(
      sector === totalSectors - 1 ? CFB_END_OF_CHAIN : sector + 1,
      sector * 4
    );
  }

  const header = Buffer.alloc(CFB_SECTOR);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  header.writeUInt16LE(0x003e, 24);
  header.writeUInt16LE(0x0003, 26);
  header.writeUInt16LE(0xfffe, 28);
  header.writeUInt16LE(9, 30);
  header.writeUInt16LE(6, 32);
  header.writeUInt32LE(0, 40);
  header.writeUInt32LE(fatSectors, 44);
  header.writeUInt32LE(directorySector, 48);
  header.writeUInt32LE(0, 52);
  header.writeUInt32LE(4096, 56);
  header.writeUInt32LE(CFB_END_OF_CHAIN, 60);
  header.writeUInt32LE(0, 64);
  header.writeUInt32LE(difatSectors > 0 ? fatSectors : CFB_END_OF_CHAIN, 68);
  header.writeUInt32LE(difatSectors, 72);
  for (let index = 0; index < 109; index++) {
    header.writeUInt32LE(index < fatSectors ? index : CFB_FREE, 76 + index * 4);
  }

  const difat = Buffer.alloc(difatSectors * CFB_SECTOR, 0xff);
  for (let index = 109; index < fatSectors; index++) {
    const position = index - 109;
    const sector = Math.floor(position / (entriesPerSector - 1));
    const slot = position % (entriesPerSector - 1);
    difat.writeUInt32LE(index, sector * CFB_SECTOR + slot * 4);
  }
  for (let sector = 0; sector < difatSectors; sector++) {
    difat.writeUInt32LE(
      sector === difatSectors - 1
        ? CFB_END_OF_CHAIN
        : fatSectors + sector + 1,
      sector * CFB_SECTOR + (entriesPerSector - 1) * 4
    );
  }

  const directory = Buffer.concat([
    cfbDirectoryEntry("Root Entry", 5, 1, CFB_END_OF_CHAIN, 0),
    cfbDirectoryEntry("Workbook", 2, CFB_FREE, firstData, length),
    cfbDirectoryEntry("", 0, CFB_FREE, 0, 0),
    cfbDirectoryEntry("", 0, CFB_FREE, 0, 0),
  ]);
  return Buffer.concat([header, fat, difat, directory, data]);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * @description Offline reader/writer for XLSX, ODS and XLS workbooks
 * @summary Writes one sheet of rows to a workbook file and reads one sheet
 * back. No dependency beyond `node:zlib`, no network, no credentials.
 * @class WorkbookService
 * @category IO
 * @example
 * ```ts
 * import { WorkbookService } from "@decaf-ts/integrations/io/spreadsheet";
 *
 * const workbooks = new WorkbookService();
 * const bytes = workbooks.write([["bolt", 4], ["nut", 9]], {
 *   format: "xlsx",
 *   header: ["sku", "qty"],
 * });
 * const sheet = workbooks.read(bytes);
 * // sheet.header === ["sku", "qty"], sheet.rows === [["bolt", 4], ["nut", 9]]
 * ```
 * @memberOf module:integrations/io/spreadsheet/workbook
 */
export class WorkbookService {
  /**
   * @description Writes rows to a workbook file
   * @summary Cells are written with their type: finite numbers as numbers,
   * booleans as booleans, everything else as text (dates as ISO strings,
   * objects as JSON); `null`/`undefined` leave the cell empty.
   * @param {unknown[][]} rows - The data rows.
   * @param {WorkbookWriteOptions} options - Format, sheet name and header.
   * @returns {Uint8Array} The file bytes.
   * @throws {Error} When the rows exceed the format's limits (XLS: 65536 rows,
   * 256 columns) or the format is unknown.
   */
  write(
    rows: readonly (readonly unknown[])[],
    options: WorkbookWriteOptions
  ): Uint8Array {
    const table = tableOf(rows, options.header);
    const sheetName = sheetNameOf(options.sheetName);
    switch (options.format) {
      case "xlsx":
        return xlsxWrite(table, sheetName);
      case "ods":
        return odsWrite(table, sheetName);
      case "xls": {
        if (table.length > XLS_MAX_ROWS) {
          throw new Error(
            `an XLS sheet holds at most ${XLS_MAX_ROWS} rows; got ${table.length}`
          );
        }
        const widest = table.reduce((max, row) => Math.max(max, row.length), 0);
        if (widest > XLS_MAX_COLUMNS) {
          throw new Error(
            `an XLS sheet holds at most ${XLS_MAX_COLUMNS} columns; got ${widest}`
          );
        }
        return cfbWrite(xlsWorkbookStream(table, sheetName));
      }
      default:
        throw new Error(
          `unsupported workbook format '${String(options.format)}'`
        );
    }
  }

  /**
   * @description Writes records to a workbook file
   * @summary The header is the union of the records' keys, in first-seen
   * order; a record without a key leaves that cell empty.
   * @param {Record<string, unknown>[]} records - The records to write.
   * @param {Omit<WorkbookWriteOptions, "header">} options - Format and sheet name.
   * @returns {Uint8Array} The file bytes.
   */
  writeRecords(
    records: readonly Record<string, unknown>[],
    options: Omit<WorkbookWriteOptions, "header">
  ): Uint8Array {
    const header: string[] = [];
    const seen = new Set<string>();
    for (const record of records) {
      for (const key of Object.keys(record ?? {})) {
        if (!seen.has(key)) {
          seen.add(key);
          header.push(key);
        }
      }
    }
    return this.write(
      records.map((record) => header.map((key) => record?.[key])),
      { ...options, header }
    );
  }

  /**
   * @description Reads one sheet of an XLSX or ODS workbook
   * @summary The format is detected from the package content when not given.
   * The first row becomes the header unless `header: false`.
   * @param {Uint8Array} bytes - The file bytes.
   * @param {WorkbookReadOptions} [options] - Format, header and sheet selection.
   * @returns {WorkbookReadResult} The sheet name, header and data rows.
   * @throws {Error} When the bytes are not a readable XLSX or ODS package, or
   * the requested sheet does not exist.
   */
  read(bytes: Uint8Array, options: WorkbookReadOptions = {}): WorkbookReadResult {
    const files = zipRead(Buffer.from(bytes));
    const format =
      options.format ??
      (files.has("xl/workbook.xml")
        ? "xlsx"
        : files.has("content.xml")
          ? "ods"
          : undefined);
    if (!format) {
      throw new Error("the package is neither an XLSX nor an ODS workbook");
    }
    const { sheetName, table } =
      format === "xlsx"
        ? xlsxRead(files, options.sheetName)
        : odsRead(files, options.sheetName);
    if (options.header === false || table.length === 0) {
      return { format, sheetName, header: [], rows: table };
    }
    const [first, ...rows] = table;
    return {
      format,
      sheetName,
      header: first.map((cell) =>
        cell === null || cell === undefined ? "" : String(cell)
      ),
      rows,
    };
  }

  /**
   * @description Reads one sheet as records keyed by the header row
   * @param {Uint8Array} bytes - The file bytes.
   * @param {Omit<WorkbookReadOptions, "header">} [options] - Format and sheet selection.
   * @returns {Record<string, WorkbookCell>[]} One record per data row.
   */
  readRecords(
    bytes: Uint8Array,
    options: Omit<WorkbookReadOptions, "header"> = {}
  ): Record<string, WorkbookCell>[] {
    const { header, rows } = this.read(bytes, { ...options, header: true });
    return rows.map((row) => {
      const record: Record<string, WorkbookCell> = {};
      header.forEach((key, index) => {
        if (key !== "") record[key] = row[index] ?? null;
      });
      return record;
    });
  }
}
