import { inflateRawSync } from "node:zlib";
import { WorkbookService } from "../../../src/io/spreadsheet";

const header = ["sku", "qty", "active", "note"];
const rows = [
  ["bolt", 4, true, "plain"],
  ["nüt & <co>", 9.5, false, "line1\nline2"],
  ["gear", -3, null, "日本語"],
];

describe("WorkbookService", () => {
  const workbooks = new WorkbookService();

  describe.each(["xlsx", "ods"] as const)("%s", (format) => {
    it("round-trips typed cells, the header and the sheet name", () => {
      const bytes = workbooks.write(rows, {
        format,
        header,
        sheetName: "Stock/2026",
      });
      const sheet = workbooks.read(bytes);
      expect(sheet.format).toBe(format);
      expect(sheet.sheetName).toBe("Stock_2026");
      expect(sheet.header).toEqual(header);
      expect(sheet.rows).toEqual([
        ["bolt", 4, true, "plain"],
        ["nüt & <co>", 9.5, false, "line1\nline2"],
        ["gear", -3, null, "日本語"],
      ]);
    });

    it("writes and reads records", () => {
      const bytes = workbooks.writeRecords(
        [{ a: 1, b: "x" }, { a: 2, c: true }],
        { format }
      );
      expect(workbooks.readRecords(bytes)).toEqual([
        { a: 1, b: "x", c: null },
        { a: 2, b: null, c: true },
      ]);
    });

    it("keeps columns aligned across empty cells and reads headerless sheets", () => {
      const bytes = workbooks.write([["a", null, null, "d"], [1]], { format });
      expect(workbooks.read(bytes, { header: false }).rows).toEqual([
        ["a", null, null, "d"],
        [1],
      ]);
    });

    it("serialises dates as ISO text and objects as JSON", () => {
      const bytes = workbooks.write(
        [[new Date("2026-01-05T10:00:00Z"), { k: 1 }, Number.NaN]],
        { format }
      );
      expect(workbooks.read(bytes, { header: false }).rows).toEqual([
        ["2026-01-05T10:00:00.000Z", '{"k":1}'],
      ]);
    });
  });

  it("rejects a sheet that does not exist and a non-workbook package", () => {
    const bytes = workbooks.write(rows, { format: "xlsx" });
    expect(() => workbooks.read(bytes, { sheetName: "nope" })).toThrow(
      /sheet 'nope' not found/
    );
    expect(() => workbooks.read(new Uint8Array([1, 2, 3]))).toThrow(
      /not a ZIP package/
    );
  });

  it("stores the ODS media type first and uncompressed", () => {
    const bytes = Buffer.from(workbooks.write(rows, { format: "ods" }));
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(bytes.readUInt16LE(8)).toBe(0); // stored
    expect(bytes.toString("ascii", 30, 38)).toBe("mimetype");
    expect(bytes.toString("ascii", 38, 84)).toBe(
      "application/vnd.oasis.opendocument.spreadsheet"
    );
  });

  it("compresses XLSX parts with a valid deflate stream", () => {
    const bytes = Buffer.from(workbooks.write(rows, { format: "xlsx" }));
    const nameLength = bytes.readUInt16LE(26);
    const size = bytes.readUInt32LE(18);
    const body = bytes.subarray(30 + nameLength, 30 + nameLength + size);
    expect(inflateRawSync(body).toString("utf8")).toContain("<Types ");
  });

  describe("xls", () => {
    it("writes a compound file holding a BIFF8 Workbook stream", () => {
      const bytes = Buffer.from(
        workbooks.write(rows, { format: "xls", header, sheetName: "Stock" })
      );
      expect(bytes.subarray(0, 8)).toEqual(
        Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
      );
      expect(bytes.length % 512).toBe(0);
      const directory = (bytes.readUInt32LE(48) + 1) * 512;
      expect(bytes.toString("utf16le", directory, directory + 20)).toBe(
        "Root Entry"
      );
      expect(bytes.toString("utf16le", directory + 128, directory + 144)).toBe(
        "Workbook"
      );
      const stream = (bytes.readUInt32LE(directory + 128 + 116) + 1) * 512;
      // BOF record, BIFF8, workbook globals.
      expect(bytes.readUInt16LE(stream)).toBe(0x0809);
      expect(bytes.readUInt16LE(stream + 4)).toBe(0x0600);
      expect(bytes.readUInt16LE(stream + 6)).toBe(0x0005);
      // Strings live in the shared string table as UTF-16.
      expect(bytes.includes(Buffer.from("日本語", "utf16le"))).toBe(true);
    });

    it("never emits a record larger than the BIFF limit", () => {
      const bytes = Buffer.from(
        workbooks.write([["x".repeat(20000), "y".repeat(9000)]], {
          format: "xls",
        })
      );
      const directory = (bytes.readUInt32LE(48) + 1) * 512;
      let cursor = (bytes.readUInt32LE(directory + 128 + 116) + 1) * 512;
      const ids: number[] = [];
      for (;;) {
        const id = bytes.readUInt16LE(cursor);
        const length = bytes.readUInt16LE(cursor + 2);
        expect(length).toBeLessThanOrEqual(8224);
        ids.push(id);
        cursor += 4 + length;
        // Second EOF closes the sheet substream.
        if (id === 0x000a && ids.filter((entry) => entry === 0x000a).length === 2) {
          break;
        }
      }
      expect(ids).toContain(0x00fc); // SST
      expect(ids).toContain(0x003c); // CONTINUE
    });

    it("enforces the sheet limits", () => {
      expect(() =>
        workbooks.write([Array.from({ length: 257 }, () => 1)], { format: "xls" })
      ).toThrow(/at most 256 columns/);
      expect(() =>
        workbooks.write(
          Array.from({ length: 65537 }, () => [1]),
          { format: "xls" }
        )
      ).toThrow(/at most 65536 rows/);
    });
  });

  it("rejects an unknown format", () => {
    expect(() =>
      workbooks.write(rows, { format: "numbers" as never })
    ).toThrow(/unsupported workbook format/);
  });
});
