"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const groups = [
  {title: "Overview", links: [{href: "/", label: "Dashboard", icon: "▦"}]},
  {title: "Catalog", links: [
    {href: "/artists", label: "Artists", icon: "◉"},
    {href: "/events", label: "Events", icon: "▤"},
    {href: "/performances", label: "Performances", icon: "◷"},
    {href: "/sales", label: "Ticket Sales", icon: "◈"},
  ]},
  {title: "Platform", links: [
    {href: "/providers", label: "Providers", icon: "◎"},
    {href: "/addons", label: "Add-ons", icon: "⬡"},
    {href: "/ai", label: "AI Models", icon: "✧"},
  ]},
  {title: "Operations", links: [
    {href: "/crawlers", label: "Crawlers", icon: "⌘"},
    {href: "/crawl-runs", label: "Crawl Runs", icon: "↺"},
  ]},
];

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return <>
    <button className="mobile-menu-toggle" type="button" aria-expanded={open}
      aria-controls="admin-sidebar" onClick={() => setOpen(!open)}>
      ☰ Menu
    </button>
    {open && <button aria-label="Close navigation" className="sidebar-backdrop" onClick={() => setOpen(false)} />}
    <aside id="admin-sidebar" className={"sidebar" + (open ? " sidebar-open" : "")}>
      <Link href="/" className="brand" onClick={() => setOpen(false)}>TIXBAM <small>ADMIN</small></Link>
      <div className="sidebar-content">
        {groups.map(group => <div className="nav-group" key={group.title}>
          <div className="nav-group-title">{group.title}</div>
          {group.links.map(link => {
            const active = link.href === "/" ? pathname === "/" : pathname === link.href || pathname.startsWith(link.href + "/");
            return <Link href={link.href} key={link.href}
              aria-current={active ? "page" : undefined}
              className={"nav-link" + (active ? " active" : "")}
              onClick={() => setOpen(false)}>
              <span className="nav-icon" aria-hidden="true">{link.icon}</span>{link.label}
            </Link>;
          })}
        </div>)}
      </div>
      <div className="sidebar-footer">Ticketing platform operations</div>
    </aside>
  </>;
}
