import Papa from "papaparse";
import type { ExportLabel } from "./detection";

export function toCSV(rows: Record<string, unknown>[], columns: readonly string[]): string {
  return Papa.unparse({ fields: columns as string[], data: rows.map((r) => columns.map((c) => r[c] ?? "")) });
}

export function downloadBlob(text: string, fileName: string, mime = "text/csv;charset=utf-8;") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadCSV(fileName: string, rows: Record<ExportLabel, string>[], columns: readonly ExportLabel[]) {
  downloadBlob(toCSV(rows, columns), fileName);
}

export function parseCSVFile(file: File): Promise<{ name: string; fields: string[]; data: Record<string, unknown>[] }> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (parsed) => resolve({ name: file.name, fields: parsed.meta.fields || [], data: parsed.data }),
      error: (err) => reject(new Error(`${file.name}: ${err.message || "could not be parsed"}`)),
    });
  });
}

export function parseCSVText(fileName: string, text: string): { name: string; fields: string[]; data: Record<string, unknown>[] } {
  const parsed = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true });
  return { name: fileName, fields: parsed.meta.fields || [], data: parsed.data };
}
