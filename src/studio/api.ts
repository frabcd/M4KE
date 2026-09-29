export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new ApiError(
      `Service returned HTTP ${response.status}, not JSON. Check the DGX connection.`,
      response.status,
    );
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(
      typeof result.error === "string"
        ? result.error
        : `HTTP ${response.status}`,
      response.status,
    );
  return result as T;
}
export const send = <T>(url: string, data: unknown, method = "POST") =>
  api<T>(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
export const readable = (value: unknown) =>
  value === undefined || value === null
    ? "UNKNOWN"
    : typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2);
export function safeExternal(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try {
    const u = new URL(value);
    if (["https:", "http:"].includes(u.protocol) && !u.username && !u.password)
      return u.href;
  } catch {
    /* Invalid source is not a link. */
  }
}
export function artifactUrl(jobId: string, path: string) {
  if (
    !/^[0-9a-f-]{36}$/.test(jobId) ||
    !path ||
    path.split("/").some((x) => x === ".." || !x)
  )
    return undefined;
  return `/api/studio/jobs/${encodeURIComponent(jobId)}/files/${path.split("/").map(encodeURIComponent).join("/")}`;
}
export function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
