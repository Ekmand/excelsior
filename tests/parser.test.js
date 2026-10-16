const assert = require("assert");
const CSV = require("../js/csv.js");

function field(text, row, col, delimiter = ",") {
  const table = CSV.toTable(CSV.parseCSV(text, delimiter).rows);
  return table.rows[row][col];
}

assert.deepEqual(CSV.parseCSV("a,b,c", ",").rows, [["a", "b", "c"]]);
assert.deepEqual(CSV.parseCSV("a,b,c\n", ",").rows, [["a", "b", "c"]]);
assert.deepEqual(CSV.parseCSV("a,b,c\n\n", ",").rows, [["a", "b", "c"], [""]]);
assert.deepEqual(CSV.parseCSV("a,b,c\r\nd,e,f\r\n", ",").rows, [
  ["a", "b", "c"],
  ["d", "e", "f"],
]);
assert.deepEqual(CSV.parseCSV("a,b\rc,d", ",").rows, [
  ["a", "b"],
  ["c", "d"],
]);
assert.deepEqual(CSV.parseCSV("", ",").rows, []);
assert.deepEqual(CSV.parseCSV("a,,c", ",").rows, [["a", "", "c"]]);
assert.deepEqual(field('"a,b",c', 0, 0), "a,b");
assert.deepEqual(field('"a""b",c', 0, 0), 'a"b');
assert.deepEqual(field('"say ""hi""" ,next', 0, 0), 'say "hi"');
assert.deepEqual(field('"hello" ,x', 0, 0), "hello");
assert.deepEqual(field("  hello  ,x", 0, 0), "  hello  ");
assert.deepEqual(field('"a\nb",c', 0, 0), "a\nb");
assert.equal(CSV.parseCSV('"abc,d', ",").unclosedQuote, true);
assert.deepEqual(CSV.parseCSV('"abc,d', ",").rows, [["abc,d"]]);

const table = CSV.toTable(CSV.parseCSV("a,b\nc", ",").rows);
assert.deepEqual(table.rows, [
  ["a", "b"],
  ["c", ""],
]);
assert.deepEqual(Array.from(table.rowLens), [2, 1]);
assert.equal(table.minCols, 1);
assert.equal(table.maxCols, 2);

assert.equal(CSV.detectDelimiter("a;b;c\n1;2;3\n"), ";");
assert.equal(CSV.detectDelimiter("a,b,c\n1,2,3\n"), ",");
assert.equal(CSV.detectDelimiter("a\tb\tc\n1\t2\t3\n"), "\t");
assert.equal(CSV.detectDelimiter("a|b|c\nx|y|z\n"), "|");
assert.equal(CSV.detectDelimiter('"a,b";c;d\n1;2;3\n'), ";");
assert.equal(CSV.detectDelimiter(CSV.SAMPLE_TEXT), ",");

const sample = CSV.toTable(CSV.parseCSV(CSV.SAMPLE_TEXT, ",").rows);
assert.equal(sample.rows.length, 5);
assert.equal(sample.rows[1][0], "001239");
assert.equal(sample.rows[1][1], "02108");
assert.equal(sample.rows[2][7], "  kept spaces  ");
assert.equal(sample.rows[4][7], "a quoted\nnewline");
assert.equal(sample.colCount, 8);

const flags = CSV.riskFlags(sample.rows, sample.colCount);
const at = (row, col) => flags[row * sample.colCount + col];
assert.equal(at(1, 0), 2);
assert.equal(at(1, 1), 2);
assert.equal(at(1, 2), 4);
assert.equal(at(1, 3), 4);
assert.equal(at(1, 4), 32);
assert.equal(at(1, 5), 64);
assert.equal(at(1, 6), 0);
assert.equal(at(1, 7), 0);
assert.equal(at(2, 7), 1);
assert.equal(at(3, 0), 8);
assert.equal(at(3, 5), 64);
assert.equal(at(4, 5), 0);
assert.equal(at(4, 1), 2);
assert.equal(CSV.classify("BRCA1"), 0);
assert.equal(CSV.classify("10"), 0);
assert.equal(CSV.classify("1.2E10"), 16);
assert.equal(CSV.classify("MAY1") & 64, 64);

const round = CSV.parseCSV(CSV.serializeCSV([["a,b", 'say "hi"', "plain"]], ","), ",").rows;
assert.deepEqual(round, [["a,b", 'say "hi"', "plain"]]);

const curly = CSV.decodeBytes(Uint8Array.from([0x93, 0x48, 0x69, 0x94]));
assert.equal(curly.encoding, "Windows-1252");
assert.equal(curly.text, "“Hi”");

const utf8 = CSV.decodeBytes(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61, 0x62]));
assert.equal(utf8.encoding, "UTF-8 with BOM");
assert.equal(utf8.text, "ab");

const binary = CSV.decodeBytes(Uint8Array.from([0x61, 0x00, 0x62]));
assert.equal(binary.binary, true);

const utf16 = new Uint8Array(Buffer.from("\ufeffa,b", "utf16le"));
const decoded16 = CSV.decodeBytes(utf16);
assert.equal(decoded16.encoding, "UTF-16 LE");
assert.equal(decoded16.text, "a,b");

console.log("parser tests passed");
