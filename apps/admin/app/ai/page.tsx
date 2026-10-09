import Link from "next/link";
import { apiRead } from "../lib";
import { saveAiPolicy } from "../actions";

export const dynamic = "force-dynamic";
type Policy = {task:string;label:string;description:string;model:string;enabled:boolean;
  timeoutSeconds:number;maxOutputTokens:number;updatedAt:string|null};
type Response = {items: Policy[]; configured:boolean;provider:string};

export default async function AIModelsPage({ searchParams }: {
  searchParams: Promise<{ok?:string;error?:string}>
}) {
  const query = await searchParams;
  let data: Response | null = null;
  let problem = "";
  try { data = await apiRead("/v1/admin/ai/tasks") as Response; }
  catch { problem = "Could not load AI configuration. Check the API connection."; }
  return <div className="page-content">
    <nav className="breadcrumbs"><Link href="/">Dashboard</Link><span>/</span><span>AI Models</span></nav>
    <div className="page-heading"><div>
      <div className="kicker">PLATFORM · AUTOMATION</div><h1>AI Models</h1>
      <p className="muted">Manage the model for each capability. Fans and add-ons cannot change these settings.</p>
    </div><span className={"connection-pill"+(data?.configured ? " connected" : "")}>
      {data?.configured ? "OpenRouter configured" : "OpenRouter key missing"}</span></div>
    {problem && <p className="notice warn" role="alert">{problem}</p>}
    {query.error && <p className="notice warn" role="alert">{query.error}</p>}
    {query.ok && <p className="notice" role="status">{query.ok}</p>}
    {!data?.configured && <p className="notice warn" role="alert">
      Set OPENROUTER_API_KEY on the Railway API service, then redeploy. Model IDs are editable now,
      but AI requests remain unavailable without the server-side key.
    </p>}
    <section className="detail-section" style={{marginTop:0}}>
      <h2>Function assignments</h2>
      <p className="muted">Changes take effect on the next request, with no desktop update.
        A disabled task falls back to the normal deterministic workflow. Every response is advice only:
        AI never receives account credentials, cookies, payment details or authority to click.</p>
      <div className="ai-policy-grid">
        {(data?.items||[]).map(item=><section key={item.task} className="panel ai-policy-panel">
          <div className="section-heading"><h2>{item.label}</h2>
            <span className={item.enabled ? "ai-active" : "muted"}>{item.enabled ? "Enabled" : "Disabled"}</span></div>
          <p className="muted">{item.description}</p>
          <form action={saveAiPolicy}>
            <input type="hidden" name="task" value={item.task}/>
            <label>OpenRouter model ID
              <input name="model" defaultValue={item.model} required minLength={3} maxLength={160}
                pattern="[a-zA-Z0-9][a-zA-Z0-9._:/+\\-]{1,159}" autoComplete="off" spellCheck={false}/>
              <span className="field-help">Example: openai/gpt-4.1-mini. Check supported features on the
                {" "}<a href="https://openrouter.ai/models" target="_blank" rel="noreferrer">OpenRouter model catalog ↗</a></span>
            </label>
            <div className="ai-limits">
              <label>Timeout (seconds)<input name="timeout_seconds" type="number" min={2} max={12}
                defaultValue={item.timeoutSeconds} required/></label>
              <label>Max output tokens<input name="max_output_tokens" type="number" min={128} max={1200}
                defaultValue={item.maxOutputTokens} required/></label>
            </div>
            <label className="inline"><input type="checkbox" name="enabled" defaultChecked={item.enabled}/>
              Enable AI advice for this function</label>
            <button type="submit">Save settings</button>
          </form>
          <p className="field-help">{item.updatedAt ? "Last updated: "+new Date(item.updatedAt).toLocaleString("en-NZ") : "Using initial defaults; disabled until enabled."}</p>
        </section>)}
      </div>
    </section>
    <section className="detail-section"><h2>Safety &amp; resilience</h2>
      <p className="muted">Per-user request limits, structured inputs/outputs, strict timeouts and local deterministic fallbacks
        protect booking sessions. AI responses never trigger checkout, change budgets or override a provider's restrictions.</p>
    </section>
  </div>;
}
