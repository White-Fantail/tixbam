import Link from "next/link";
import { apiRead } from "./lib";
export const dynamic = "force-dynamic";
const items = [
  {name:"Artists",path:"artists",subtitle:"Manage artist identities"},
  {name:"Events",path:"events",subtitle:"Concert and fan meeting listings"},
  {name:"Performances",path:"performances",subtitle:"Individual sessions and local times"},
  {name:"Ticket Sales",path:"sales",subtitle:"Presales, providers and booking URLs"},
  {name:"Providers",path:"providers",subtitle:"Ticketing agents and metadata"},
  {name:"Crawlers",path:"sources",url:"crawlers",subtitle:"Approved discovery feeds"},
];
export default async function Dashboard() {
  const values = await Promise.allSettled(items.map(x =>
    apiRead("/v1/admin/directory/"+x.path+"?limit=1")));
  const connected=values.some(result=>result.status==="fulfilled");
  return <div className="page-content">
    <div className="page-heading"><div>
      <div className="kicker">CONTROL CENTER</div><h1>Dashboard</h1>
      <p className="muted">Manage verified concerts, show sessions, sales and provider integrations.</p>
    </div><span className={"connection-pill"+(connected?" connected":"")}>
      {connected?"API connected":"API unavailable"}</span></div>
    {!connected && <p className="notice warn">Could not contact the catalog API. Check Admin environment variables and Railway availability.</p>}
    <div className="dashboard-grid">
      {items.map((entry,i)=><Link className="stat dashboard-tile" key={entry.path} href={"/"+(entry.url||entry.path)}>
        <span className="kicker">{entry.name}</span>
        <strong>{values[i].status==="fulfilled" ? (values[i].value.total ?? "—") : "—"}</strong>
        <span className="muted">{entry.subtitle} →</span>
      </Link>)}
    </div>
    <section className="detail-section"><h2>Operations</h2>
      <p className="muted">Review recent crawler outcomes and add-on publication status.</p>
      <div className="quick-links"><Link className="button-subtle" href="/addons">Add-on registry →</Link>
        <Link className="button-subtle" href="/crawl-runs">Crawl runs →</Link></div>
    </section>
  </div>;
}
