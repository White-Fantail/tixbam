/** Server-only admin API client. Never expose the key to the browser. */
export async function apiRead(path: string): Promise<any> {
  const endpoint = process.env.TIXBAM_API_URL;
  const token = process.env.TIXBAM_ADMIN_API_KEY;
  if (!endpoint || !token) throw new Error("Admin API is not configured");
  const response = await fetch(endpoint.replace(/\/$/, "") + path, {
    cache:"no-store", headers:{"X-Admin-Key":token}
  });
  if (!response.ok) throw new Error("API request failed: "+response.status);
  return response.json();
}
