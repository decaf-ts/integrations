export function parseJsonBody<T>(value: unknown): T | undefined {
  if (typeof value !== "string") return value as T | undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export function responseBodyAsText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? "");
  } catch {
    return String(value ?? "");
  }
}
