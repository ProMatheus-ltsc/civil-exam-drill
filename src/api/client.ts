export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const payload = (await response.json()) as {
    success: boolean;
    data: T;
    error: { message: string } | null;
  };
  if (!response.ok || !payload.success)
    throw new Error(payload.error?.message ?? "请求失败");
  return payload.data;
}
