import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { apiRead } from "../lib";
import { ArtistForm, EventForm, PerformanceForm, SaleForm, SourceForm, ProviderForm, AddonForm } from "../forms";
import { DualTime } from "../_components/dual-time";
import { DeletePerformance } from "../_components/delete-performance";
import type { Artist, Event, Performance, Sale } from "../catalog-types";
import type { SourceRecord, ProviderRecord } from "../forms";

type RecordItem = Record<string, any>;
type Query = Record<string, string | string[] | undefined>;
const metadata: Record<string, {title: string; singular: string; endpoint: string; writable: boolean; create: boolean}> = {
  artists: {title:"Artists",singular:"Artist",endpoint:"artists",writable:true,create:true},
  events: {title:"Events",singular:"Event",endpoint:"events",writable:true,create:true},
  performances: {title:"Performances",singular:"Performance",endpoint:"performances",writable:true,create:true},
  sales: {title:"Ticket Sales",singular:"Ticket Sale",endpoint:"sales",writable:true,create:true},
  providers: {title:"Providers",singular:"Provider",endpoint:"providers",writable:true,create:true},
  addons: {title:"Add-ons",singular:"Add-on",endpoint:"addons",writable:true,create:false},
  crawlers: {title:"Crawlers",singular:"Crawler Source",endpoint:"sources",writable:true,create:true},
  "crawl-runs": {title:"Crawl Runs",singular:"Crawl Run",endpoint:"crawl-runs",writable:false,create:false},
};
const safe = (value: string | string[] | undefined) => typeof value === "string" ? value : "";
const directory = (name: string) => "/v1/admin/directory/" + metadata[name].endpoint;

function Notice({query}: {query:Query}) {
  return <>
    {safe(query.ok) && <p className="notice" role="status">{safe(query.ok)}</p>}
    {safe(query.error) && <p className="notice warn" role="alert">{safe(query.error)}</p>}
  </>;
}
function Breadcrumb({resource,title}: {resource:string;title?:string}) {
  return <nav className="breadcrumbs" aria-label="Breadcrumb">
    <Link href="/">Dashboard</Link><span>/</span><Link href={"/"+resource}>{metadata[resource].title}</Link>
    {title && <><span>/</span><span aria-current="page">{title}</span></>}
  </nav>;
}
function Head({title,description,actions}: {title:string;description?:string;actions?:ReactNode}) {
  return <div className="page-heading"><div><h1>{title}</h1>{description && <p className="muted">{description}</p>}</div>{actions && <div className="heading-actions">{actions}</div>}</div>;
}
function Field({name,children}: {name:string;children:ReactNode}) {
  return <div className="detail-field"><dt>{name}</dt><dd>{children || "—"}</dd></div>;
}
function external(url: string | null | undefined) {
  if (!url) return "—";
  if (!url.startsWith("https://")) return url;
  return <a href={url} target="_blank" rel="noopener noreferrer" className="external-link">{url} ↗</a>;
}
function time(value:string|null|undefined, zone?:string|null, city?:string|null, country?:string|null, label?:string) {
  return <DualTime iso={value} timezone={zone} city={city} country={country} label={label} />;
}
function label(resource:string, item:RecordItem) {
  switch(resource) {
    case "artists": return String(item.name);
    case "events": return String(item.title);
    case "performances": return String(item.label || item.sessionKey);
    case "sales": return String((item.providerName || item.providerId) + " · " + item.saleType);
    case "providers": case "addons": return String(item.name);
    case "crawlers": return String(item.name);
    default: return String(item.status + " · " + item.id.slice(0,8));
  }
}
function sublabel(resource:string, item:RecordItem) {
  switch(resource) {
    case "artists": return item.country || "Country unknown";
    case "events": return (item.artist || "Unknown artist") + " · " + (item.city || "Location TBA");
    case "performances": return item.eventTitle || item.eventId;
    case "sales": return item.eventTitle || item.eventId;
    case "providers": case "addons": return item.id;
    case "crawlers": return item.url;
    default: return item.message || "No message";
  }
}
function listExtra(resource:string, item:RecordItem) {
  switch(resource) {
    case "events": return <>{item.performances?.length || 0} sessions · {item.country || "TBA"}</>;
    case "performances": return <>{item.status} · {time(item.startsAt,item.timezone || item.eventTimezone,item.city,item.country)}</>;
    case "sales": return time(item.saleAt,item.timezone||item.eventTimezone,item.city||item.eventCity,item.country||item.eventCountry,"Sale region");
    case "providers": case "addons": return <>{item.published ? "Published" : "Unpublished"} · {item.version}</>;
    case "crawlers": return <>{item.enabled ? "Enabled" : "Disabled"} · Every {item.intervalMinutes} min</>;
    case "crawl-runs": return item.startedAt ? new Date(item.startedAt).toLocaleString("en-NZ", {timeZone:"UTC"})+" UTC" : "—";
    default: return item.imageUrl ? "Image available" : "";
  }
}
async function listPage(resource:string,query:Query) {
  const meta=metadata[resource],q=safe(query.q).slice(0,100);
  const pageNo=Math.max(1, Math.min(10000,Number.parseInt(safe(query.page),10)||1));
  const limit=25, offset=(pageNo-1)*limit;
  const data=await apiRead(directory(resource)+"?"+new URLSearchParams({q,limit:String(limit),offset:String(offset)}));
  const items:RecordItem[]=data.items||[], total:number=data.total||0;
  const path=(p:number)=>"/"+resource+"?"+new URLSearchParams({q,page:String(p)});
  return <div className="page-content">
    <Breadcrumb resource={resource}/>
    <Head title={meta.title} description={total+" records"}
      actions={meta.create && <Link className="button" href={"/"+resource+"/new"}>+ Add {meta.singular}</Link>}/>
    <Notice query={query}/>
    <form method="get" action={"/"+resource} className="list-search">
      <input name="q" defaultValue={q} placeholder={"Search "+meta.title.toLowerCase()+"…"}
        aria-label={"Search "+meta.title} />
      <button type="submit">Search</button>
      {q && <Link className="button-subtle" href={"/"+resource}>Clear</Link>}
    </form>
    <div className="panel tablewrap">
      <table className="resource-table">
        <thead><tr><th>{meta.singular}</th><th>Information</th><th>Status / Schedule</th></tr></thead>
        <tbody>
          {items.map(item=><tr key={item.id}>
            <td><Link className="row-link" href={"/"+resource+"/"+encodeURIComponent(item.id)}>
              <strong>{label(resource,item)}</strong></Link></td>
            <td className="secondary-cell">{sublabel(resource,item)}</td>
            <td>{listExtra(resource,item)}</td>
          </tr>)}
        </tbody>
      </table>
      {!items.length && <div className="empty-state">No records found.</div>}
    </div>
    <div className="pagination">
      <span className="muted">{total ? offset+1 : 0}–{Math.min(offset+items.length,total)} of {total}</span>
      <div>{pageNo>1 && <Link className="button-subtle" href={path(pageNo-1)}>← Previous</Link>}
        {offset+items.length<total && <Link className="button-subtle" href={path(pageNo+1)}>Next →</Link>}</div>
    </div>
  </div>;
}

async function relations(resource:string,item:RecordItem) {
  if(resource==="artists") {
    const data=await apiRead("/v1/events?artist_id="+encodeURIComponent(item.id)+"&limit=500");
    const events:Event[]=data.items||[];
    return <section className="detail-section">
      <div className="section-heading"><h2>Events ({events.length})</h2>
        <Link className="button-subtle" href="/events/new">+ Add event</Link></div>
      <div className="related-list">
        {events.map(event=><Link className="related-item" key={event.id} href={"/events/"+encodeURIComponent(event.id)}>
          <span><strong>{event.title}</strong><small>{event.city||"Location TBA"}</small></span>
          {time(event.startsAt,event.timezone,event.city,event.country)}
          <span aria-hidden="true">→</span>
        </Link>)}
        {!events.length && <p className="muted">No events registered.</p>}
      </div>
    </section>;
  }
  if(resource==="events") return <>
    <section className="detail-section">
      <div className="section-heading"><h2>Performances ({item.performances?.length||0})</h2>
        <Link className="button-subtle" href={"/performances/new?eventId="+encodeURIComponent(item.id)}>+ Add performance</Link></div>
      <div className="related-list">{(item.performances||[]).map((p:Performance)=>
        <Link className="related-item" href={"/performances/"+encodeURIComponent(p.id)} key={p.id}>
          <span><strong>{p.label||p.sessionKey}</strong><small>{p.status}</small></span>
          {time(p.startsAt,p.timezone||item.timezone,item.city,item.country)}<span aria-hidden="true">→</span>
        </Link>)}
        {!item.performances?.length && <p className="muted">No sessions registered.</p>}
      </div>
    </section>
    <section className="detail-section">
      <div className="section-heading"><h2>Ticket Sales ({item.sales?.length||0})</h2>
        <Link className="button-subtle" href={"/sales/new?eventId="+encodeURIComponent(item.id)}>+ Add ticket sale</Link></div>
      <div className="related-list">{(item.sales||[]).map((s:Sale)=>
        <Link className="related-item" href={"/sales/"+encodeURIComponent(s.id)} key={s.id}>
          <span><strong>{s.providerId} · {s.saleType}</strong><small>{s.appliesToAll?"All sessions":s.performanceIds.length+" selected sessions"}</small></span>
          {time(s.saleAt,s.timezone||item.timezone,s.city||item.city,s.country||item.country,"Sale region")}<span aria-hidden="true">→</span>
        </Link>)}
        {!item.sales?.length && <p className="muted">No ticket sales registered.</p>}
      </div>
    </section>
  </>;
  return null;
}
async function detailPage(resource:string,id:string,query:Query) {
  const meta=metadata[resource];
  let item:RecordItem;
  try { item=await apiRead(directory(resource)+"/"+encodeURIComponent(id)); }
  catch(error){if(String(error).includes("404")) notFound();throw error;}
  const title=label(resource,item);
  let parent:RecordItem|undefined;
  if((resource==="performances"||resource==="sales") && item.eventId) {
    try {parent=await apiRead(directory("events")+"/"+encodeURIComponent(item.eventId));} catch { /* Show record independently */ }
  }
  return <div className="page-content">
    <Breadcrumb resource={resource} title={title}/>
    <Head title={title} description={meta.singular} actions={meta.writable &&
      <Link className="button" href={"/"+resource+"/"+encodeURIComponent(id)+"/edit"}>Edit</Link>} />
    <Notice query={query}/>
    <section className="panel">
      <h2>Details</h2><dl className="detail-grid">
        {resource==="artists" && <>
          <Field name="Artist name">{item.name}</Field><Field name="Country">{item.country}</Field>
          <Field name="Image">{external(item.imageUrl)}</Field>
        </>}
        {resource==="events" && <>
          <Field name="Artist"><Link href={"/artists/"+encodeURIComponent(item.artistId)}>{item.artist}</Link></Field>
          <Field name="Event title">{item.title}</Field>
          <Field name="City / Country">{[item.city,item.country].filter(Boolean).join(", ")}</Field>
          <Field name="Venue">{item.venue}</Field>
          <Field name="Earliest session">{time(item.startsAt,item.timezone,item.city,item.country)}</Field>
          <Field name="Official source">{external(item.sourceUrl)}</Field>
        </>}
        {resource==="performances" && <>
          <Field name="Event"><Link href={"/events/"+encodeURIComponent(item.eventId)}>{parent?.title||item.eventId}</Link></Field>
          <Field name="Session key">{item.sessionKey}</Field>
          <Field name="Session label">{item.label}</Field>
          <Field name="Status">{item.status}</Field>
          <Field name="Show time">{time(item.startsAt,item.timezone||parent?.timezone,parent?.city,parent?.country)}</Field>
        </>}
        {resource==="sales" && <>
          <Field name="Event"><Link href={"/events/"+encodeURIComponent(item.eventId)}>{parent?.title||item.eventId}</Link></Field>
          <Field name="Provider"><Link href={"/providers/"+encodeURIComponent(item.providerId)}>{item.providerName||item.providerId}</Link></Field>
          <Field name="Sale type">{item.saleType}</Field>
          <Field name="Sale time">{time(item.saleAt,item.timezone||parent?.timezone,item.city||parent?.city,item.country||parent?.country,"Sale region")}</Field>
          <Field name="Applicable performances">{item.appliesToAll ? "All performances" : item.performanceIds?.map((pid:string)=>parent?.performances?.find((p:Performance)=>p.id===pid)?.label || pid).join(", ")}</Field>
          <Field name="Official booking link">{external(item.bookingUrl)}</Field>
        </>}
        {(resource==="providers"||resource==="addons") && <>
          <Field name="Provider ID">{item.id}</Field><Field name="Name">{item.name}</Field>
          <Field name="Official website">{external(item.url)}</Field>
          <Field name="Region">{item.region} · {item.country}</Field>
          <Field name="Allowed hosts">{item.allowedHosts?.join(", ")||"—"}</Field>
          <Field name="Capabilities">{item.capabilities?.join(", ")||"Not configured"}</Field>
          <Field name="Version">{item.version}</Field><Field name="Published">{item.published?"Yes":"No"}</Field>
          <Field name="Description">{item.description}</Field>
          <Field name="Artifact">{external(item.artifactUrl)}</Field>
          <Field name="SHA-256">{item.artifactSha256}</Field>
        </>}
        {resource==="crawlers" && <>
          <Field name="Name">{item.name}</Field><Field name="Approved URL">{external(item.url)}</Field>
          <Field name="Enabled">{item.enabled?"Yes":"No"}</Field>
          <Field name="Interval">{item.intervalMinutes} min</Field>
          <Field name="Last checked">{item.lastCheckedAt || "Never"}</Field>
        </>}
        {resource==="crawl-runs" && <>
          <Field name="Source"><Link href={"/crawlers/"+encodeURIComponent(item.sourceId)}>{item.sourceId}</Link></Field>
          <Field name="Status">{item.status}</Field><Field name="Found">{String(item.found)}</Field>
          <Field name="Message">{item.message}</Field>
          <Field name="Started">{item.startedAt}</Field>
        </>}
        <Field name="Record ID"><code>{item.id}</code></Field>
      </dl>
    </section>
    {await relations(resource,item)}
    {resource==="performances" && <section className="detail-section">
      <h2>Danger zone</h2><DeletePerformance id={item.id}/>
    </section>}
  </div>;
}

async function editorPage(resource:string,id:string|null,query:Query) {
  const meta=metadata[resource];
  if(!meta.writable || (!id&&!meta.create)) notFound();
  let item:RecordItem|undefined;
  if(id) {
    try {item=await apiRead(directory(resource)+"/"+encodeURIComponent(id));}
    catch(error){if(String(error).includes("404")) notFound();throw error;}
  }
  const eventId=safe(query.eventId);
  let artists:Artist[]=[];
  let events:Event[]=[];
  let providers:ProviderRecord[]=[];
  if(resource==="events") artists=(await apiRead("/v1/artists")).items||[];
  if(resource==="performances"||resource==="sales") {
    events=(await apiRead("/v1/events?limit=500")).items||[];
    if(eventId&&!id) events.sort((a,b)=>Number(b.id===eventId)-Number(a.id===eventId));
  }
  if(resource==="sales") providers=(await apiRead(directory("providers")+"?limit=100")).items||[];
  const title=(id?"Edit ":"Add ")+meta.singular;
  return <div className="page-content">
    <Breadcrumb resource={resource} title={title}/>
    <Head title={title} actions={<Link className="button-subtle" href={
      id?"/"+resource+"/"+encodeURIComponent(id):"/"+resource}>Cancel</Link>} />
    <Notice query={query}/>
    <div className="panel editor-panel">
      {resource==="artists" && <ArtistForm artist={item as Artist|undefined}/>}
      {resource==="events" && <EventForm artists={artists} event={item as Event|undefined}/>}
      {resource==="performances" && <PerformanceForm events={events} performance={item as Performance|undefined}/>}
      {resource==="sales" && <SaleForm events={events} providers={providers.filter(p => p.kind !== "event-presale" || p.id === item?.providerId)} sale={item as Sale|undefined}/>}
      {resource==="providers" && <ProviderForm provider={item as ProviderRecord|undefined}/>}
      {resource==="addons" && item && <AddonForm provider={item}/>}
      {resource==="crawlers" && <SourceForm source={item as SourceRecord|undefined}/>}
    </div>
  </div>;
}

export async function renderResource(resource:string, segments:string[], query:Query) {
  if(!Object.prototype.hasOwnProperty.call(metadata, resource)) notFound();
  if(segments.length===0) return listPage(resource,query);
  if(segments.length===1&&segments[0]==="new") return editorPage(resource,null,query);
  if(segments.length===1) return detailPage(resource,segments[0],query);
  if(segments.length===2&&segments[1]==="edit") return editorPage(resource,segments[0],query);
  notFound();
}
