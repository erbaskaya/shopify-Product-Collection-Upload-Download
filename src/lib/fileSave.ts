import { desktopApi } from "./desktopApi";

function contentDispositionFilename(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const match = value.match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export async function saveResponse(response: Response, fallbackName: string): Promise<string | null> {
  const filename = contentDispositionFilename(
    response.headers.get("Content-Disposition"),
    fallbackName,
  );
  const contentType = response.headers.get("Content-Type") || "";

  if (contentType.includes("text/") || contentType.includes("json")) {
    return desktopApi.saveTextFile(filename, await response.text());
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  return desktopApi.saveBinaryFile(filename, bytesToBase64(bytes));
}

export function csvCell(value: unknown, delimiter = ","): string {
  const text = String(value ?? "");
  return text.includes(delimiter) || /["\r\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}
