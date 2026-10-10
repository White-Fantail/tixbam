"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const val = (f: FormData, name: string) => String(f.get(name) || "").trim();
const opt = (f: FormData, name: string) => val(f, name) || null;
const id = (f: FormData) => encodeURIComponent(val(f, "id"));
const bool = (f: FormData, name: string) => f.get(name) === "on";
const split = (f: FormData, name: string) => val(f, name).split(/[\n,]+/).map(x => x.trim()).filter(Boolean);

async function submit(apiPath: string, payload: object, method: string,
                      resource: string, back: string, fallbackId?: string) {
  const base = process.env.TIXBAM_API_URL;
  const token = process.env.TIXBAM_ADMIN_API_KEY;
  let error = "";
  let itemId = fallbackId;
  if (!base || !token) {
    error = "API is not configured";
  } else {
    try {
      const response = await fetch(base.replace(/\/$/, "") + apiPath, {
        method, cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Admin-Key": token },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = body.detail;
        error = Array.isArray(detail) ? detail.map((d: {msg?: string}) => d.msg || "Invalid field").join("; ")
              : String(detail || "HTTP " + response.status);
      } else {
        itemId = body.id || itemId;
      }
    } catch {
      error = "Could not reach the API";
    }
  }
  if (error) redirect(back + (back.includes("?") ? "&" : "?") + "error=" + encodeURIComponent(error));
  revalidatePath("/" + resource);
  if (itemId) revalidatePath("/" + resource + "/" + encodeURIComponent(itemId));
  redirect(itemId ? "/" + resource + "/" + encodeURIComponent(itemId) + "?ok=Saved"
                  : "/" + resource + "?ok=Saved");
}

export async function addArtist(f: FormData) {
  await submit("/v1/admin/artists", {name:val(f,"name"),country:opt(f,"country"),image_url:opt(f,"image_url")},
               "POST","artists","/artists/new");
}
export async function updateArtist(f: FormData) {
  await submit("/v1/admin/artists/"+id(f),{name:val(f,"name"),country:opt(f,"country"),image_url:opt(f,"image_url")},
               "PUT","artists","/artists/"+id(f)+"/edit",val(f,"id"));
}

function eventPayload(f: FormData) {
  return {artist_id: val(f,"artist_id"),title:val(f,"title"),city:val(f,"city"),
    country:val(f,"country"),venue:opt(f,"venue"),timezone:opt(f,"timezone"),
    starts_at_local:opt(f,"starts_at_local"),source_url:opt(f,"source_url")};
}
export async function addEvent(f: FormData) {
  await submit("/v1/admin/events",eventPayload(f),"POST","events","/events/new");
}
export async function updateEvent(f: FormData) {
  await submit("/v1/admin/events/"+id(f),eventPayload(f),"PUT","events","/events/"+id(f)+"/edit",val(f,"id"));
}
function performancePayload(f:FormData) {
  return {event_id:val(f,"event_id"),session_key:val(f,"session_key"),label:val(f,"label"),
    starts_at_local:opt(f,"starts_at_local"),timezone:opt(f,"timezone"),status:val(f,"status")||"scheduled"};
}
export async function addPerformance(f:FormData) {
  await submit("/v1/admin/performances",performancePayload(f),"POST","performances",
               "/performances/new"+(val(f,"event_id")?"?eventId="+encodeURIComponent(val(f,"event_id")):""));
}
export async function updatePerformance(f:FormData) {
  await submit("/v1/admin/performances/"+id(f),performancePayload(f),"PUT","performances",
               "/performances/"+id(f)+"/edit",val(f,"id"));
}
export async function deletePerformance(f:FormData) {
  await submit("/v1/admin/performances/"+id(f),{},"DELETE","performances",
               "/performances/"+id(f));
}
function salePayload(f:FormData) {
  return {event_id:val(f,"event_id"),provider_id:val(f,"provider_id"),sale_type:val(f,"sale_type"),
    sale_at_local:opt(f,"sale_at_local"),timezone:opt(f,"timezone"),city:opt(f,"city"),
    country:opt(f,"country"),booking_url:val(f,"booking_url"),applies_to_all:bool(f,"applies_to_all"),
    performance_ids:bool(f,"applies_to_all")?[]:f.getAll("performance_ids").map(String)};
}
export async function addSale(f:FormData) {
  await submit("/v1/admin/sales",salePayload(f),"POST","sales",
               "/sales/new"+(val(f,"event_id")?"?eventId="+encodeURIComponent(val(f,"event_id")):""));
}
export async function updateSale(f:FormData) {
  await submit("/v1/admin/sales/"+id(f),salePayload(f),"PUT","sales",
               "/sales/"+id(f)+"/edit",val(f,"id"));
}

function providerPayload(f: FormData) {
  return {id:val(f,"id"), name:val(f,"name"), url:val(f,"url"),region:val(f,"region")||"Global",
    country:val(f,"country")||"GL",allowed_hosts:split(f,"allowed_hosts"),
    capabilities:split(f,"capabilities"),automation: JSON.parse(val(f,"automation")||"{}"),
    version:val(f,"version")||"1.0.0",description:val(f,"description"),
    published:bool(f,"published"),artifact_url:opt(f,"artifact_url"),
    artifact_sha256:opt(f,"artifact_sha256")};
}
async function providerSubmit(f:FormData,method:"POST"|"PUT") {
  let payload;
  const back=method==="POST"?"/providers/new":"/providers/"+id(f)+"/edit";
  try { payload=providerPayload(f); }
  catch { redirect(back+"?error=Invalid+automation+JSON"); }
  await submit(method==="POST"?"/v1/admin/directory/providers":"/v1/admin/directory/providers/"+id(f),
               payload,method,"providers",back,method==="PUT"?val(f,"id"):undefined);
}
export async function addProvider(f:FormData) { await providerSubmit(f,"POST"); }
export async function updateProvider(f:FormData) { await providerSubmit(f,"PUT"); }

function sourcePayload(f:FormData) {
  return {name:val(f,"name"),url:val(f,"url"),interval_minutes:Number(val(f,"interval_minutes")||360),
    enabled:bool(f,"enabled")};
}
export async function addSource(f:FormData) {
  await submit("/v1/admin/sources",sourcePayload(f),"POST","crawlers","/crawlers/new");
}
export async function updateSource(f:FormData) {
  await submit("/v1/admin/sources/"+id(f),sourcePayload(f),"PUT","crawlers",
               "/crawlers/"+id(f)+"/edit",val(f,"id"));
}
export async function editAddon(f:FormData) {
  await submit("/v1/admin/addons/"+id(f),
    {version:val(f,"version"),published:bool(f,"published"),description:val(f,"description"),
     artifact_url:opt(f,"artifact_url"),artifact_sha256:opt(f,"artifact_sha256")},
    "PUT","addons","/addons/"+id(f)+"/edit",val(f,"id"));
}

/** AI settings are written server-to-server; browser never sees OpenRouter credentials. */
export async function saveAiPolicy(f: FormData) {
  const task = val(f, "task");
  if (!["rehearsal_guidance", "page_recovery", "seat_review", "planner_v1"].includes(task)) {
    redirect("/ai?error=Unknown+AI+feature");
  }
  const payload = {
    model: val(f, "model"), enabled: bool(f, "enabled"),
    timeout_seconds: Number(val(f, "timeout_seconds")),
    max_output_tokens: Number(val(f, "max_output_tokens")),
    structured_output_verified: task === "planner_v1" && bool(f, "structured_output_verified"),
  };
  const base = process.env.TIXBAM_API_URL;
  const token = process.env.TIXBAM_ADMIN_API_KEY;
  let error = "";
  if (!base || !token) error = "Admin API is not configured";
  else {
    try {
      const response = await fetch((base.endsWith("/") ? base.slice(0, -1) : base) + "/v1/admin/ai/tasks/" + task, {
        method: "PUT", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Admin-Key": token },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        error = typeof data.detail === "string" ? data.detail : "Could not save AI settings (" + response.status + ")";
      }
    } catch { error = "Could not reach the API"; }
  }
  if (error) redirect("/ai?error=" + encodeURIComponent(error));
  revalidatePath("/ai");
  redirect("/ai?ok=" + encodeURIComponent("Saved " + task.replaceAll("_", " ")));
}


/** AB-01: Admin can record restrictions/evidence but not grant permission. */
export async function saveAutomationPolicy(f: FormData) {
  const provider = val(f, "provider_id");
  const capability = val(f, "capability");
  const country = val(f, "country");
  const back = "/automation/" + encodeURIComponent(provider) + "?country=" + encodeURIComponent(country);
  const payload = {
    country, capability, state: val(f, "state"),
    reason: val(f, "reason"), evidence_url: opt(f, "evidence_url"),
    reviewer: val(f, "reviewer") || "admin-key",
    expires_at: opt(f, "expires_at"),
    expected_revision: Number(val(f, "expected_revision") || "0"),
  };
  await submit("/v1/admin/automation/providers/" + encodeURIComponent(provider) + "/policies",
               payload, "PUT", "automation", back, provider);
}

export async function saveAutomationKillSwitch(f: FormData) {
  const payload = {
    kill_switch: val(f, "kill_switch") === "true",
    expected_revision: Number(val(f, "expected_revision")),
  };
  await submit("/v1/admin/automation/kill-switch", payload, "PUT", "automation", "/automation");
}
