(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ExcelsiorCSV = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const RISK_INFO = [
    {
      bit: 2,
      id: "zero",
      short: "Leading zeros",
      detail: "Excel treats this as a number and drops the leading zeros.",
    },
    {
      bit: 4,
      id: "date",
      short: "Dates and fractions",
      detail:
        "Excel may read this as a date. 01/02/2024 can become January 2 or February 1, and a fraction like 1/2 can become a day in January or February.",
    },
    {
      bit: 8,
      id: "long",
      short: "Long numbers",
      detail:
        "Excel keeps about 15 digits of precision and may display this in scientific notation. Digits past that are lost.",
    },
    {
      bit: 64,
      id: "month",
      short: "Month names",
      detail: "Excel may turn values like SEPT2 or MARCH1 into dates.",
    },
    {
      bit: 32,
      id: "decimal",
      short: "Trailing zeros",
      detail: "Excel may drop zeros after the decimal, so 19.90 can become 19.9.",
    },
    {
      bit: 16,
      id: "sci",
      short: "Scientific notation",
      detail: "Excel may turn this into a rounded decimal.",
    },
    {
      bit: 1,
      id: "space",
      short: "Extra spaces",
      detail: "This field has a leading or trailing space.",
    },
  ];

  const SAMPLE_TEXT = [
    "account_id,zip,opened,ratio,amount,gene,phone,note",
    '001239,02108,01/02/2024,1/2,19.90,SEPT2,+1 801 555 0100,"Hello, world"',
    '00042,94107,2024-03-15,3/4,1.10,MARCH1,+1 801 555 0199,"  kept spaces  "',
    "9876543210987654321,10001,12/31/2023,5/8,2500.00,OCT4,+1 801 555 0110,plain text",
    '12345,00501,03-04-2022,2,10,BRCA1,+1 801 555 0148,"a quoted',
    'newline"',
  ].join("\n");

  // A trailing newline ends the last record. It does not create an extra empty row.
  // A blank line in the middle does.
  function parseCSV(text, delimiter) {
    const rows = [];
    let row = [];
    let fieldParts = null;
    let start = 0;
    let inQuotes = false;
    let afterQuote = false;
    let unclosedQuote = false;
    const n = text.length;

    function finishField(end) {
      let value;
      if (fieldParts) {
        if (end > start) fieldParts.push(text.slice(start, end));
        value = fieldParts.join("");
        fieldParts = null;
      } else {
        value = text.slice(start, end);
      }
      row.push(value);
      afterQuote = false;
    }

    let i = 0;
    while (i < n) {
      const c = text[i];

      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            if (!fieldParts) fieldParts = [];
            fieldParts.push(text.slice(start, i), '"');
            i += 2;
            start = i;
            continue;
          }
          if (!fieldParts) fieldParts = [];
          fieldParts.push(text.slice(start, i));
          inQuotes = false;
          afterQuote = true;
          i += 1;
          start = i;
          continue;
        }
        i += 1;
        continue;
      }

      if (afterQuote && (c === " " || c === "\t")) {
        i += 1;
        start = i;
        continue;
      }

      if (c === '"' && i === start && !fieldParts) {
        inQuotes = true;
        afterQuote = false;
        i += 1;
        start = i;
        continue;
      }

      if (c === delimiter) {
        finishField(i);
        i += 1;
        start = i;
        continue;
      }

      if (c === "\n" || c === "\r") {
        finishField(i);
        rows.push(row);
        row = [];
        i += c === "\r" && text[i + 1] === "\n" ? 2 : 1;
        start = i;
        continue;
      }

      afterQuote = false;
      i += 1;
    }

    if (inQuotes) unclosedQuote = true;

    if (start < n || fieldParts || row.length) {
      finishField(n);
      rows.push(row);
    }

    return { rows, unclosedQuote };
  }

  function sampleForDetection(text) {
    const max = 65536;
    if (text.length <= max) return text;
    const slice = text.slice(0, max);
    const nl = slice.lastIndexOf("\n");
    return nl > 1000 ? slice.slice(0, nl) : slice;
  }

  function scoreDelimiter(text, delimiter) {
    const parsed = parseCSV(text, delimiter);
    const lens = [];
    for (let i = 0; i < parsed.rows.length && lens.length < 40; i++) {
      const row = parsed.rows[i];
      if (row.length === 1 && row[0] === "") continue;
      lens.push(row.length);
    }
    if (!lens.length) return 0;

    const tally = new Map();
    for (const n of lens) tally.set(n, (tally.get(n) || 0) + 1);

    let mode = 1;
    let modeCount = 0;
    for (const [n, count] of tally) {
      if (count > modeCount || (count === modeCount && n > mode)) {
        mode = n;
        modeCount = count;
      }
    }
    if (mode < 2) return 0;
    return modeCount * 100 + mode;
  }

  function detectDelimiter(text) {
    const sample = sampleForDetection(text);
    const candidates = [",", "\t", ";", "|"];
    let best = ",";
    let bestScore = -1;
    for (const delimiter of candidates) {
      const score = scoreDelimiter(sample, delimiter);
      if (score > bestScore) {
        best = delimiter;
        bestScore = score;
      }
    }
    return best;
  }

  function toTable(rows) {
    const rowLens = new Uint32Array(rows.length);
    let colCount = 0;
    let minCols = rows.length ? Infinity : 0;
    for (let i = 0; i < rows.length; i++) {
      const n = rows[i].length;
      rowLens[i] = n;
      if (n > colCount) colCount = n;
      if (n < minCols) minCols = n;
    }
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      while (row.length < colCount) row.push("");
    }
    return { rows, rowLens, colCount, minCols, maxCols: colCount };
  }

  function classify(value) {
    if (!value) return 0;
    let bits = 0;
    if (value !== value.trim()) bits |= 1;
    if (/^0\d+(\.\d+)?$/.test(value)) bits |= 2;
    if (/^\d{1,4}[\/\-]\d{1,2}([\/\-]\d{1,4})?$/.test(value)) bits |= 4;
    if (/^-?\d{12,}$/.test(value)) bits |= 8;
    if (/^[+-]?(?:\d+\.\d+|\d+)[eE][+-]?\d+$/.test(value)) bits |= 16;
    if (/^-?\d+\.\d*0$/.test(value)) bits |= 32;
    if (
      /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\d{1,2}$/i.test(
        value,
      )
    ) {
      bits |= 64;
    }
    return bits;
  }

  function riskFlags(rows, colCount) {
    const flags = new Uint8Array(rows.length * colCount);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < colCount; c++) {
        flags[r * colCount + c] = classify(row[c] || "");
      }
    }
    return flags;
  }

  function decodeBytes(bytes) {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      return {
        text: stripBom(new TextDecoder("utf-16le").decode(bytes)),
        encoding: "UTF-16 LE",
        binary: false,
      };
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return {
        text: stripBom(new TextDecoder("utf-16be").decode(bytes)),
        encoding: "UTF-16 BE",
        binary: false,
      };
    }
    if (containsNul(bytes)) {
      return { text: "", encoding: "binary", binary: true };
    }

    const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    try {
      const text = stripBom(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      return { text, encoding: hasBom ? "UTF-8 with BOM" : "UTF-8", binary: false };
    } catch {
      return {
        text: new TextDecoder("windows-1252").decode(bytes),
        encoding: "Windows-1252",
        binary: false,
      };
    }
  }

  function containsNul(bytes) {
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0) return true;
    }
    return false;
  }

  function stripBom(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  function serializeCSV(rows, delimiter) {
    const body = rows
      .map((row) =>
        row
          .map((field) => {
            const value = field == null ? "" : String(field);
            if (
              value.includes('"') ||
              value.includes(delimiter) ||
              value.includes("\n") ||
              value.includes("\r")
            ) {
              return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
          })
          .join(delimiter),
      )
      .join("\r\n");
    return body ? `${body}\r\n` : "";
  }

  function delimiterLabel(delimiter) {
    if (delimiter === ",") return "comma";
    if (delimiter === ";") return "semicolon";
    if (delimiter === "\t") return "tab";
    if (delimiter === "|") return "pipe";
    return "custom";
  }

  function detailFor(info, value) {
    if (info.bit === 4 && /^\d{1,2}[/\-]\d{1,2}$/.test(value)) {
      return "Excel may read this fraction as a date, such as January 2 or February 1.";
    }
    if (info.bit === 8 && value.replace(/^-/, "").length >= 16) {
      return "Excel keeps about 15 digits of precision. This number is longer than that, so opening it in Excel can round it or show it in scientific notation.";
    }
    return info.detail;
  }

  return {
    RISK_INFO,
    SAMPLE_TEXT,
    parseCSV,
    detectDelimiter,
    toTable,
    riskFlags,
    classify,
    decodeBytes,
    serializeCSV,
    delimiterLabel,
    detailFor,
  };
});
