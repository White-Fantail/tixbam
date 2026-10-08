import { apiRead } from "./lib";
import { AddonForm, SourceForm } from "./forms";
import { ArtistsManager, EventsManager, PerformancesManager, SalesManager } from "./directories";

export const dynamic = "force-dynamic";
type Collection = { items: any[] };
async function listing(path: string): Promise<any[]> {
  const result: Collection = await apiRead(path);
  return result.items || [];
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const notice = await searchParams;
  let connected = true;
  let artists: any[] = [], events: any[] = [], providers: any[] = [], sources: any[] = [], runs: any[] = [];
  try {
    [artists, events, providers, sources, runs] = await Promise.all([
      listing("/v1/artists"), listing("/v1/events?limit=500"), listing("/v1/addons"),
      listing("/v1/admin/sources"), listing("/v1/admin/crawl-runs")
    ]);
  } catch { connected = false; }
  if (!process.env.TIXBAM_API_URL || !process.env.TIXBAM_ADMIN_API_KEY) connected = false;

  return <main className="shell">
    <header className="top">
      <div className="logo">TIXBAM <span className="kicker">ADMIN</span></div>
      <span className="pill">{connected ? "API connected" : "API unavailable"}</span>
    </header>
    <nav><a href="#artists">Artists</a><a href="#events">Events</a><a href="#performances">Performances</a><a href="#sales">Ticket sales</a><a href="#addons">Add-ons</a><a href="#sources">Crawlers</a></nav>
    <div className="intro"><div className="kicker">CONTROL CENTER</div><h1>Ticketing platform operations</h1>
      <p>Manage real event information, providers, versioned add-on metadata and crawler health. All ticket purchases happen on the provider's official website.</p>
    </div>
    {notice.ok && <p className="notice">{notice.ok}</p>}
    {notice.error && <p className="notice warn">{notice.error}</p>}
    {!connected && <p className="notice warn">Set TIXBAM_API_URL and TIXBAM_ADMIN_API_KEY in the admin deployment and verify the Railway API is online.</p>}
    <section className="stats">
      <div className="stat"><span className="kicker">Artists</span><strong>{artists.length}</strong></div>
      <div className="stat"><span className="kicker">Events</span><strong>{events.length}</strong></div>
      <div className="stat"><span className="kicker">Performances</span><strong>{events.reduce((total, e) => total + (e.performances?.length || 0), 0)}</strong></div>
      <div className="stat"><span className="kicker">Providers</span><strong>{providers.length}</strong></div>
      <div className="stat"><span className="kicker">Crawl sources</span><strong>{sources.length}</strong></div>
    </section>
    <section className="section" id="artists"><h2>Artists</h2><ArtistsManager artists={artists} /></section>
    <section className="section" id="events"><h2>Concerts & fan meetings</h2><EventsManager artists={artists} events={events} /></section>
    <section className="section" id="performances"><h2>Performances & sessions</h2><p className="muted">One event may have multiple dated shows. The session's IANA timezone controls local clock times.</p><PerformancesManager events={events} /></section>
    <section className="section" id="sales"><h2>Ticket sales</h2><SalesManager events={events} providers={providers} /></section>
    <section className="section" id="addons"><h2>Add-on registry</h2><p className="muted">Version and publication metadata only. Remote execution and unsigned ZIP installation are deliberately disabled until the signed-package loader is implemented.</p>
      <div className="columns">{providers.map(p=><div className="panel" key={p.id}><h3>{p.name} <span className="pill">{p.id}</span></h3><AddonForm provider={p}/></div>)}</div>
    </section>
    <section className="section" id="sources"><h2>Crawler sources</h2>
      <div className="columns"><div className="panel"><SourceForm /></div><div className="panel tablewrap">
        <h3>Configured feeds</h3><table><thead><tr><th>Source</th><th>Interval</th><th>Last check</th></tr></thead><tbody>
        {sources.map(s=><tr key={s.id}><td><a href={s.url} target="_blank" rel="noreferrer">{s.name}</a></td><td>{s.intervalMinutes} min</td><td>{s.lastCheckedAt ? new Date(s.lastCheckedAt).toLocaleString("en-NZ") : "Never"}</td></tr>)}
        </tbody></table><p className="muted">Only register sources you are permitted to access. Cron jobs run in a separate Railway service.</p>
      </div></div>
      <div className="panel section tablewrap"><h3>Recent crawl runs</h3><table><thead><tr><th>Status</th><th>Found</th><th>Message</th><th>Time</th></tr></thead><tbody>
        {runs.map(r=><tr key={r.id}><td><span className="pill">{r.status}</span></td><td>{r.found}</td><td>{r.message}</td><td>{new Date(r.startedAt).toLocaleString("en-NZ")}</td></tr>)}
      </tbody></table>{!runs.length && <p className="muted">No crawler runs recorded.</p>}</div>
    </section>
  </main>;
}
