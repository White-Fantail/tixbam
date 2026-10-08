"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const str = (f: FormData, k: string) => String(f.get(k) || "").trim();

async function submit(path: string, body: object, method = "POST") {
  const base = process.env.TIXBAM_API_URL;
  const token = process.env.TIXBAM_ADMIN_API_KEY;
  if (!base || !token) redirect("/?error=API+is+not+configured");
  let error = "";
  try {
    const result = await fetch(base.replace(/\/$/, "") + path, {
      method, cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Admin-Key": token },
      body: JSON.stringify(body)
    });
    if (!result.ok) {
      const data = await result.json().catch(() => null);
      const detail = data?.detail;
      error = Array.isArray(detail)
        ? detail.map((item: { msg?: string }) => item.msg || "Invalid field").join("; ")
        : String(detail || "HTTP " + result.status);
    }
  } catch {
    error = "Could not reach the API";
  }
  revalidatePath("/");
  redirect(error ? "/?error=" + encodeURIComponent(error) : "/?ok=Saved");
}

export async function addArtist(f: FormData) {
  await submit("/v1/admin/artists", { name: str(f,"name"), country: str(f,"country") || null, image_url: str(f,"image_url") || null });
}
export async function updateArtist(f: FormData) {
  await submit("/v1/admin/artists/" + encodeURIComponent(str(f,"id")), {
    name: str(f,"name"), country: str(f,"country") || null,
    image_url: str(f,"image_url") || null
  }, "PUT");
}
export async function addEvent(f: FormData) {
  await submit("/v1/admin/events", {
    artist_id: str(f,"artist_id"), title: str(f,"title"), city: str(f,"city"),
    country: str(f,"country"), starts_at_local: str(f,"starts_at_local") || null,
    timezone: str(f,"timezone") || null, venue: str(f,"venue") || null,
    source_url: str(f,"source_url") || null
  });
}
export async function updateEvent(f: FormData) {
  await submit("/v1/admin/events/" + encodeURIComponent(str(f,"id")), {
    artist_id: str(f,"artist_id"), title: str(f,"title"), city: str(f,"city"),
    country: str(f,"country"), venue: str(f,"venue") || null,
    timezone: str(f,"timezone") || null, starts_at_local: str(f,"starts_at_local") || null,
    source_url: str(f,"source_url") || null
  }, "PUT");
}
export async function addSale(f: FormData) {
  await submit("/v1/admin/sales", {
    event_id: str(f,"event_id"), provider_id: str(f,"provider_id"), sale_type: str(f,"sale_type"),
    sale_at_local: str(f,"sale_at_local") || null, timezone: str(f,"timezone") || null,
    city: str(f,"city") || null, country: str(f,"country") || null, booking_url: str(f,"booking_url")
  });
}
export async function updateSale(f: FormData) {
  await submit("/v1/admin/sales/" + encodeURIComponent(str(f,"id")), {
    event_id: str(f,"event_id"), provider_id: str(f,"provider_id"), sale_type: str(f,"sale_type"),
    sale_at_local: str(f,"sale_at_local") || null, timezone: str(f,"timezone") || null,
    city: str(f,"city") || null, country: str(f,"country") || null, booking_url: str(f,"booking_url")
  }, "PUT");
}
export async function addSource(f: FormData) {
  await submit("/v1/admin/sources", { name: str(f,"name"), url: str(f,"url"),
    interval_minutes: Number(str(f,"interval_minutes") || "360"), enabled: true });
}
export async function editAddon(f: FormData) {
  await submit("/v1/admin/addons/" + encodeURIComponent(str(f,"id")), {
    version: str(f,"version"), published: f.get("published") === "on",
    description: str(f,"description"), artifact_url: str(f,"artifact_url") || null,
    artifact_sha256: str(f,"artifact_sha256") || null
  }, "PUT");
}
