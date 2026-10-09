import Link from "next/link";
import { apiRead } from "../lib";
import { saveAutomationKillSwitch } from "../actions";

export const dynamic = "force-dynamic";

type Permission = {capability: string;permissionState: string;reason: string};
type Provider = {
  providerId:string;name:string;country:string;registeredCountry:string;
  ticketAgentRequired:boolean;autonomousCheckoutAvailable:boolean;policies:Permission[];
};
type Data = {
  items:Provider[];globalKillSwitch:boolean;switchRevision:number;note:string;
};

export default async function AutomationPage({
  searchParams,
}: {searchParams:Promise<{ok?:string;error?:string}>}) {
  const query = await searchParams;
  let data:Data|null = null;
  let error="";
  try { data = await apiRead("/v1/admin/automation/providers") as Data; }
  catch { error="Could not load provider automation policies. Verify the API connection and deployment."; }
  return <div className="page-content">
    <nav className="breadcrumbs"><Link href="/">Dashboard</Link><span>/</span><span>Automation Policy</span></nav>
    <div className="page-heading"><div>
      <div className="kicker">PLATFORM · SAFETY</div>
      <h1>Automation Policy</h1>
      <p className="muted">Track provider restrictions and evidence independently from reviewed add-on implementation.</p>
    </div></div>
    {error && <p className="notice warn" role="alert">{error}</p>}
    {query.error && <p className="notice warn" role="alert">{query.error}</p>}
    {query.ok && <p className="notice" role="status">{query.ok}</p>}
    <section className="panel">
      <div className="section-heading"><h2>Global safety gate</h2>
        <span className={data?.globalKillSwitch ? "muted" : "ai-active"}>{data?.globalKillSwitch ? "Kill switch ON" : "Kill switch OFF"}</span></div>
      <p className="muted">AB-01 never grants autonomous live purchasing. Turning this switch off is not authorization:
        vendor permission, local add-on verification and a future host release gate are separately required.</p>
      {data && <form action={saveAutomationKillSwitch} style={{display:"flex",gap:12,alignItems:"end",flexWrap:"wrap"}}>
        <input type="hidden" name="expected_revision" value={data.switchRevision}/>
        <label>Global kill switch
          <select name="kill_switch" defaultValue={String(data.globalKillSwitch)}>
            <option value="true">ON — block autonomous execution</option>
            <option value="false">OFF — other safeguards still apply</option>
          </select>
        </label>
        <button type="submit">Save safety switch</button>
      </form>}
    </section>
    <section className="detail-section">
      <h2>Provider permission registry</h2>
      <p className="muted">No site is eligible for autonomous checkout. A restricted vendor cannot be enabled with an Admin toggle.
        Evidence records and audit history are maintained per jurisdiction and operation.</p>
      <div className="tablewrap panel">
        <table className="resource-table"><thead><tr>
          <th>Provider</th><th>Jurisdiction</th><th>Restriction / status</th><th>Actions</th>
        </tr></thead><tbody>{(data?.items || []).map(p => {
          const states=new Set(p.policies.map(x=>x.permissionState));
          const status=states.has("restricted")?"Restricted":states.has("revoked")?"Revoked":"Unverified";
          return <tr key={p.providerId}>
            <td><Link className="row-link" href={"/automation/"+encodeURIComponent(p.providerId)}>{p.name}</Link>
              {p.ticketAgentRequired && <div className="field-help">Promoter — ticket-agent handoff required</div>}
            </td>
            <td className="secondary-cell">{p.registeredCountry}</td>
            <td>{status}<span className="field-help">Autonomous checkout unavailable</span></td>
            <td className="secondary-cell">9 capabilities · <span className="field-help">Open row for audit and notes</span></td>
          </tr>;
        })}</tbody></table>
      </div>
    </section>
    <section className="detail-section"><h2>Release requirements</h2>
      <p className="muted">Permission evidence ≠ technical implementation verification. An explicitly reviewed, bundled
        add-on manifest and host-side purchase safety checks are required before any live automation.
        Live Nation and other event promoters delegate checkout to the event&apos;s actual ticket agent.</p>
    </section>
  </div>;
}
