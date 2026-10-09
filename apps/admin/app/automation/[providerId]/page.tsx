import Link from "next/link";
import { apiRead } from "../../lib";
import { saveAutomationPolicy } from "../../actions";

export const dynamic = "force-dynamic";

type Row = {
  country:string;capability:string;permissionState:string;recordedState:string;
  reason:string;revision:number;evidenceUrl:string|null;reviewer:string|null;
  reviewedAt:string|null;expiresAt:string|null;
};
type Audit={id:string;country:string|null;capability:string|null;action:string;actor:string;
  oldValue:Record<string,unknown>;newValue:Record<string,unknown>;createdAt:string;revision:number};
type Data={providerId:string;name:string;country:string;registeredCountry:string;ticketAgentRequired:boolean;
  globalKillSwitch:boolean;policies:Row[];recentAudit:Audit[]};

export default async function ProviderAutomationPage({
  params, searchParams
}: {
  params:Promise<{providerId:string}>;
  searchParams:Promise<{country?:string;error?:string;ok?:string}>;
}) {
  const {providerId}=await params;
  const query=await searchParams;
  const code=(query.country || "").toUpperCase();
  let data:Data|null=null;let error="";
  try {
    data=await apiRead("/v1/admin/automation/providers/"+encodeURIComponent(providerId)+"/policies"+
      (code?"?country="+encodeURIComponent(code):"")) as Data;
  } catch { error="Unable to load policies. Check provider, country scope and API connection."; }
  const protectedBaseline = data?.policies.some(p=>p.permissionState==="restricted" && p.recordedState!=="restricted");
  return <div className="page-content">
    <nav className="breadcrumbs"><Link href="/">Dashboard</Link><span>/</span>
      <Link href="/automation">Automation Policy</Link><span>/</span><span>{data?.name||providerId}</span></nav>
    <div className="page-heading"><div><div className="kicker">VENDOR PERMISSION · EVIDENCE</div>
      <h1>{data?.name||providerId}</h1>
      <p className="muted">Per-operation evidence and restrictions. No control on this page can grant live checkout.</p></div></div>
    {error && <p className="notice warn" role="alert">{error}</p>}
    {query.error && <p className="notice warn" role="alert">{query.error}</p>}
    {query.ok && <p className="notice" role="status">{query.ok}</p>}
    {data && <>
      <section className="panel">
        <p className="muted">Default country: {data.registeredCountry} · Global kill switch: <strong>{data.globalKillSwitch?"ON":"OFF"}</strong>
          {data.ticketAgentRequired?" · Ticket-agent handoff required":""}</p>
        {protectedBaseline && <p className="notice warn">This provider has a protected published restriction.
          Editing a record cannot lift it. Only a separately verified authorization workflow can change the baseline.</p>}
        <form method="get" action={"/automation/"+encodeURIComponent(providerId)}
          style={{display:"flex",gap:12,alignItems:"end",flexWrap:"wrap"}}>
          <label>Country / jurisdiction (ISO 2-letter)
            <input name="country" defaultValue={data.country} pattern="[A-Z]{2}" minLength={2} maxLength={2}
              required style={{maxWidth:140}}/>
          </label>
          <button type="submit" className="button-subtle">Load jurisdiction</button>
        </form>
      </section>
      <section className="detail-section"><h2>Capability policy records — {data.country}</h2>
        <p className="muted">Allowed statuses: Unverified, Restricted, Revoked. &quot;Permitted&quot; is intentionally unavailable in AB-01.
          Changes create an audit record and are rejected when another administrator has already updated the row.</p>
        <div className="ai-policy-grid">{data.policies.map(row => {
          const immutable=row.permissionState==="restricted" && row.recordedState!=="restricted";
          return <section key={row.capability} className="panel ai-policy-panel">
            <div className="section-heading"><h2 style={{fontSize:15,overflowWrap:"anywhere"}}>{row.capability}</h2>
              <span className="muted">{row.permissionState}</span></div>
            <p className="field-help">{row.reason}</p>
            <form action={saveAutomationPolicy}>
              <input type="hidden" name="provider_id" value={data.providerId}/>
              <input type="hidden" name="country" value={data.country}/>
              <input type="hidden" name="capability" value={row.capability}/>
              <input type="hidden" name="expected_revision" value={row.revision}/>
              <label>Recorded state<select name="state" defaultValue={row.recordedState}>
                {["unverified","restricted","revoked"].map(state=>
                  <option key={state} value={state} disabled={immutable && state!=="restricted" || row.recordedState==="revoked" && state!=="revoked"}>{state}</option>)}
              </select></label>
              <label>Reason<input name="reason" defaultValue={row.reason.startsWith("No verified")?"":row.reason}
                maxLength={500} placeholder="Why is this restricted / unverified?"/></label>
              <label>Official evidence URL (optional)<input name="evidence_url" type="url" defaultValue={row.evidenceUrl||""}
                placeholder="https://..." maxLength={1500}/></label>
              <label>Reviewer note<input name="reviewer" defaultValue={row.reviewer||"admin-key"} maxLength={120}/></label>
              <label>Expiry (optional, ISO with timezone)<input name="expires_at" type="text"
                defaultValue={row.expiresAt||""} placeholder="2027-01-10T00:00:00+13:00"/></label>
              <button type="submit">Save evidence</button>
              <p className="field-help">Revision {row.revision} · {row.reviewedAt||"Never reviewed"}</p>
            </form>
          </section>;
        })}</div>
      </section>
      <section className="detail-section"><h2>Recent audit history</h2>
        {data.recentAudit.length===0?<p className="muted">No policy changes have been recorded.</p>:
          <div className="panel tablewrap"><table className="resource-table"><thead><tr>
            <th>When</th><th>Capability</th><th>Change</th><th>Revision</th><th>Actor</th>
          </tr></thead><tbody>{data.recentAudit.map(a=><tr key={a.id}>
            <td>{new Date(a.createdAt).toLocaleString("en-NZ")}</td>
            <td>{a.capability||"Global"}</td>
            <td>{String(a.oldValue.state||"unset")} → {String(a.newValue.state||a.action)}</td>
            <td>{a.revision}</td><td>{a.actor}</td>
          </tr>)}</tbody></table></div>}
        <p className="field-help">The shared Admin API key identifies the action as admin-key,
          not a verified individual. Named reviewer fields are notes only until individual Admin accounts exist.</p>
      </section>
    </>}
  </div>;
}
