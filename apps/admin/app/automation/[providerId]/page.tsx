import Link from "next/link";
import { apiRead } from "../../lib";
import { saveAutomationPolicy, saveProviderVerification } from "../../actions";

export const dynamic = "force-dynamic";

type Row = {
  country:string;capability:string;permissionState:string;recordedState:string;
  reason:string;revision:number;evidenceUrl:string|null;reviewer:string|null;
  reviewedAt:string|null;expiresAt:string|null;
};
type Audit={id:string;country:string|null;capability:string|null;action:string;actor:string;
  oldValue:Record<string,unknown>;newValue:Record<string,unknown>;createdAt:string;revision:number};
type VerificationRow={
  country:string;capability:string;state:string;recordedState:string;
  reason:string;revision:number;addonVersion:string;profileId:string|null;
  fixtureSuite:string|null;fixtureSha256:string|null;evidenceUrl:string|null;
  reviewer:string|null;expiresAt:string|null;hostPermission:false;liveExecution:false;
};
type VerificationData={registeredVersion:string;verifications:VerificationRow[];liveExecutionAvailable:false};
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
  let data:Data|null=null;let evidence:VerificationData|null=null;let error="";
  try {
    const countryQuery=code?"?country="+encodeURIComponent(code):"";
    [data,evidence]=await Promise.all([
      apiRead("/v1/admin/automation/providers/"+encodeURIComponent(providerId)+"/policies"+
        countryQuery) as Promise<Data>,
      apiRead("/v1/admin/automation/providers/"+encodeURIComponent(providerId)+"/verifications"+
        countryQuery) as Promise<VerificationData>
    ]);
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
      <section className="detail-section">
        <h2>AB-12 — Technical fixture verification</h2>
        <p className="muted">Evidence is recorded separately from provider permission.
          A passed OFFLINE fixture is <strong>not</strong> official seat-map approval,
          payment authorization or live checkout permission. Reviewers enter an evidence
          URL, fixture digest, exact bundled profile/version and expiry. Revocations are permanent
          until a separate onboarding review.</p>
        {evidence&&<div className="ai-policy-grid">
          {evidence.verifications.map(item=><section key={item.capability} className="panel ai-policy-panel">
            <h3>{item.capability}</h3>
            <p className="field-help">Technical status: <strong>{item.state}</strong> ·
              Current bundled version: {evidence.registeredVersion} ·
              Live execution: OFF</p>
            <p className="field-help">{item.reason}</p>
            <form action={saveProviderVerification}>
              <input type="hidden" name="provider_id" value={data.providerId}/>
              <input type="hidden" name="country" value={data.country}/>
              <input type="hidden" name="capability" value={item.capability}/>
              <input type="hidden" name="expected_revision" value={item.revision}/>
              <label>Fixture review state
                <select name="state" defaultValue={item.recordedState}>
                  <option value="pending" disabled={item.recordedState==="revoked"}>Pending / unverified</option>
                  <option value="fixture_verified" disabled={item.recordedState==="revoked"||
                    ["ticketmaster","nol","axs","livenation"].includes(data.providerId)}>Offline fixture recorded</option>
                  <option value="revoked">Revoked</option>
                </select>
              </label>
              <label>Bundled add-on version<input name="addon_version" required maxLength={60}
                defaultValue={item.addonVersion||evidence.registeredVersion}/></label>
              <label>Reviewed adapter profile<input name="profile_id" required maxLength={120}
                defaultValue={item.profileId|| (data.providerId==="cityline"?"cityline-event-detail-v1":"")}/></label>
              <label>Fixture suite
                <select name="fixture_suite" defaultValue={item.fixtureSuite||(
                  ["OBSERVE","LIST_OFFERS","READ_ORDER"].includes(item.capability)?"observe-v1":
                  ["SELECT_PERFORMANCE","SELECT_PRICE_TIER"].includes(item.capability)?"options-v1":
                  item.capability==="SELECT_OFFER"?"seats-v1":
                  item.capability==="PAYMENT_EXECUTOR"?"payment-mock-v1":"checkout-v1")}>
                  {["observe-v1","options-v1","seats-v1","checkout-v1","payment-mock-v1"].map(v=>
                    <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label>Offline fixture SHA-256<input name="fixture_sha256" required
                pattern="[a-f0-9]{64}" maxLength={64}
                defaultValue={item.fixtureSha256||""} placeholder="64 lowercase hex characters"/></label>
              <label>Test report / reviewer evidence (HTTPS)
                <input name="evidence_url" type="url" maxLength={1500}
                  defaultValue={item.evidenceUrl||""} placeholder="https://github.com/.../actions/runs/..."/></label>
              <label>Review note / revocation reason
                <input name="reason" maxLength={500} defaultValue={item.reason.startsWith("No ")?"":item.reason}/></label>
              <label>Reviewer note<input name="reviewer" required defaultValue={item.reviewer||"qa-review"} maxLength={120}/></label>
              <label>Expires at (ISO timezone; required for fixture_verified)
                <input name="expires_at" defaultValue={item.expiresAt||""}
                  placeholder="2027-01-10T00:00:00+13:00"/></label>
              <button type="submit">Save offline verification record</button>
              <p className="field-help">Revision {item.revision} · Protected vendor permission is not editable here.</p>
            </form>
          </section>)}
        </div>}
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
