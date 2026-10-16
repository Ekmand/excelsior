importScripts("csv.js");

self.onmessage = (event) => {
  const { id, text, delimiter } = event.data;
  try {
    const chosen = !delimiter || delimiter === "auto" ? ExcelsiorCSV.detectDelimiter(text) : delimiter;
    const parsed = ExcelsiorCSV.parseCSV(text, chosen);
    const table = ExcelsiorCSV.toTable(parsed.rows);
    const flags = ExcelsiorCSV.riskFlags(table.rows, table.colCount);
    self.postMessage(
      {
        id,
        ok: true,
        delimiter: chosen,
        rows: table.rows,
        rowLens: table.rowLens,
        flags,
        colCount: table.colCount,
        minCols: table.minCols,
        maxCols: table.maxCols,
        unclosedQuote: parsed.unclosedQuote,
      },
      [table.rowLens.buffer, flags.buffer],
    );
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error && error.message ? error.message : "Could not read this file.",
    });
  }
};
