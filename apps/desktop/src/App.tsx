import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight, ArrowUpRight, Bell, CalendarDays, Check, ChevronRight,
  Clock3, ExternalLink, Globe2, Heart, LayoutDashboard, Layers3,
  Link2, LockKeyhole, Monitor, Plus, Radio, Search, Settings2, ShieldCheck,
  Sparkles, Star, Ticket, Trash2, UserRound, X, Zap
} from "lucide-react";
import { BookingPanel } from "./booking/BookingPanel";
import { BookingRunList } from "./booking/BookingRunList";
import { CardVaultPanel } from "./booking/CardVaultPanel";
import providerData from "../addons/catalog.json";
import { getPublicData, initialApiUrl, type AuthMethods, type RemoteArtist, type RemoteEvent, type RemotePerformance, type RemoteAddon } from "./api";
import type { CloudAccount, CloudSnapshot, Provider, TicketAddon, Section, TicketWindow, WatchEvent, AutomationSupportStatus } from "./types";

const catalog = providerData as unknown as Omit<TicketAddon, "installed">[];
const providers: Provider[] = catalog;
const STORAGE_KEY = "tixbam.watchlist.v1";
const MAX_WINDOWS = 6;

const demos = [
  { id: "sample-1", artist: "NOVA8", title: "AFTERGLOW WORLD TOUR", city: "Seoul, South Korea", providerId: "nol", theme: "violet", edition: "01" },
  { id: "sample-2", artist: "MOONLINE", title: "STARLIGHT FAN MEETING", city: "Hong Kong", providerId: "cityline", theme: "orange", edition: "02" },
  { id: "sample-3", artist: "ECHO/WAVE", title: "LIVE IN TAIPEI", city: "Taipei, Taiwan", providerId: "kktix", theme: "cyan", edition: "03" },
] as const;

const navItems = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "discover", label: "Discover events", icon: CalendarDays },
  { id: "artists", label: "My artists", icon: Star },
  { id: "watchlist", label: "My events", icon: Heart },
  { id: "sessions", label: "Live windows", icon: Layers3 },
  { id: "providers", label: "Ticket providers", icon: Globe2 },
  { id: "settings", label: "Settings", icon: Settings2 },
] as const;

type EventFormState = {
  artist: string;
  title: string;
  city: string;
  providerId: string;
  saleAt: string;
  url: string;
};

function emptyEvent(): EventFormState {
  return { artist: "", title: "", city: "", providerId: "cityline", saleAt: "", url: "" };
}

function loadWatchlist(): WatchEvent[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(data)) return [];
    return data.filter((item): item is WatchEvent =>
      Boolean(item && typeof item === "object" &&
        typeof item.id === "string" && typeof item.artist === "string" &&
        typeof item.title === "string" && typeof item.providerId === "string" &&
        typeof item.url === "string" && typeof item.saleAt === "string" &&
        typeof item.city === "string" && typeof item.addedAt === "string"));
  } catch {
    return [];
  }
}

function providerFor(id: string): Provider | undefined {
  return providers.find((p) => p.id === id);
}

function humanDate(value: string) {
  if (!value) return "Sale date not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Sale date not set" :
    new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function countdown(value: string, now: number) {
  if (!value) return "DATE TO BE ANNOUNCED";
  const difference = new Date(value).getTime() - now;
  if (Number.isNaN(difference)) return "DATE TO BE ANNOUNCED";
  if (difference <= 0) return "SALE TIME PASSED";
  const days = Math.floor(difference / 86400000);
  const hours = Math.floor((difference % 86400000) / 3600000);
  const minutes = Math.floor((difference % 3600000) / 60000);
  return days > 0 ? days + "D " + hours + "H UNTIL SALE" : hours + "H " + minutes + "M UNTIL SALE";
}

function validateTicketUrl(value: string, provider: Provider) {
  if (!value.trim()) return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return "Use an HTTPS ticket URL.";
    const hostname = url.hostname.toLowerCase();
    if (!provider.allowedHosts.some((host) => hostname === host || hostname.endsWith("." + host))) {
      return "The ticket URL must be on " + provider.name + "'s website.";
    }
    return "";
  } catch {
    return "Enter a valid ticket URL.";
  }
}

function ProviderMark({ provider, small = false }: { provider: Provider; small?: boolean }) {
  return (
    <span className={"provider-mark" + (small ? " provider-mark-small" : "")}
      style={{ background: provider.color + "1d", color: provider.color, borderColor: provider.color + "44" }}>
      {provider.initials}
    </span>
  );
}

const levels = [
  { key: "level1", name: "L1", title: "Assistant" },
  { key: "level2", name: "L2", title: "Assisted" },
  { key: "level3", name: "L3", title: "Full Auto" }
] as const;

const supportLabels: Record<AutomationSupportStatus, string> = {
  available: "Available",
  restricted: "Restricted",
  unverified: "Unverified",
  delegated: "Via agent"
};

function AddonAutomationLevels({ addon }: { addon: TicketAddon }) {
  return (
    <div className="automation-levels" aria-label={addon.name + " automation support"}>
      {levels.map((level) => {
        const support = addon.automation[level.key];
        return (
          <div className="automation-level" key={level.key}>
            <span className="automation-level-name">{level.name}<small>{level.title}</small></span>
            <span className={"automation-support automation-support-" + support.status}
              title={support.summary}>
              {support.status === "available" ? <Check size={12} /> : support.status === "restricted" ? <X size={12} /> : support.status === "delegated" ? <ArrowUpRight size={12} /> : <Clock3 size={12} />}
              {supportLabels[support.status]}
            </span>
          </div>
        );
      })}
      <p className="automation-support-note">{addon.automation.level2.summary} {addon.automation.level2.sourceUrl &&
        <a href={addon.automation.level2.sourceUrl} target="_blank" rel="noopener noreferrer">Policy <ArrowUpRight size={11}/></a>}
      </p>
      <p className="automation-support-note">{addon.automation.level3.summary} {addon.automation.level3.sourceUrl &&
        <a href={addon.automation.level3.sourceUrl} target="_blank" rel="noopener noreferrer">Policy <ArrowUpRight size={11}/></a>}
      </p>
    </div>
  );
}

function SectionHeading({ eyebrow, title, description, action }: {
  eyebrow: string; title: string; description?: string; action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <div className="eyebrow"><span className="eyebrow-line" />{eyebrow}</div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

function App() {
  const [section, setSection] = useState<Section>("overview");
  const [watchlist, setWatchlist] = useState<WatchEvent[]>(loadWatchlist);
  const [windows, setWindows] = useState<TicketWindow[]>([]);
  const [addons, setAddons] = useState<TicketAddon[]>(() => catalog.map(p => ({ ...p, installed: true })));
  const [siteByProvider, setSiteByProvider] = useState<Record<string, string>>({});
  const installedIds = new Set(addons.filter(a => a.installed).map(a => a.id));
  const [search, setSearch] = useState("");
  const apiUrl = initialApiUrl();
  const [apiRefresh, setApiRefresh] = useState(0);
  const [remoteEvents, setRemoteEvents] = useState<RemoteEvent[]>([]);
  const [remoteArtists, setRemoteArtists] = useState<RemoteArtist[]>([]);
  const [favoriteArtistIds, setFavoriteArtistIds] = useState<string[]>([]);
  const [favoriteEventIds, setFavoriteEventIds] = useState<string[]>([]);
  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [authMethods, setAuthMethods] = useState<AuthMethods>({ developmentLogin: false, google: false, apple: false });
  const [demoAccount, setDemoAccount] = useState<"fan-one" | "fan-two">("fan-one");
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudError, setCloudError] = useState("");
  const [onlyFavoriteArtists, setOnlyFavoriteArtists] = useState(false);
  const [chosenPerformances, setChosenPerformances] = useState<Record<string, string>>({});
  const [remoteAddons, setRemoteAddons] = useState<RemoteAddon[]>([]);
  const [apiStatus, setApiStatus] = useState("Connecting...");
  const [now, setNow] = useState(() => Date.now());
  const [bookingEvent, setBookingEvent] = useState<WatchEvent | null>(null);
  const [eventModal, setEventModal] = useState(false);
  const [form, setForm] = useState<EventFormState>(emptyEvent);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState("");
  const desktop = Boolean(window.tixbam);

  useEffect(() => {
    if (!account) localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlist));
  }, [watchlist, account]);

  useEffect(() => {
    if (!window.tixbam) return;
    let mounted = true;
    window.tixbam.accountStatus().then(snapshot => {
      if (mounted && snapshot) applySnapshot(snapshot);
    }).catch(err => {
      if (mounted) setCloudError(err instanceof Error ? err.message : "Account service unavailable");
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!window.tixbam) return;
    let mounted = true;
    window.tixbam.listAddons().then(items => { if (mounted) setAddons(items); })
      .catch(() => { if (mounted) inform("Could not load add-on settings.", true); });
    const unsubscribe = window.tixbam.onAddonsChanged(items => { if (mounted) setAddons(items); });
    return () => { mounted = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!window.tixbam) return;
    let mounted = true;
    window.tixbam.listWindows().then((list) => {
      if (mounted) setWindows(list);
    }).catch(() => {});
    const unsubscribe = window.tixbam.onWindowsChanged((list) => {
      if (mounted) setWindows(list);
    });
    return () => { mounted = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    let mounted = true;
    setApiStatus("Connecting...");
    const refresh = async () => {
      try {
        const [events, registry, artists, methods] = await Promise.all([
          getPublicData<{ items: RemoteEvent[] }>(apiUrl, "/v1/events"),
          getPublicData<{ items: RemoteAddon[] }>(apiUrl, "/v1/addons"),
          getPublicData<{ items: RemoteArtist[] }>(apiUrl, "/v1/artists"),
          getPublicData<AuthMethods>(apiUrl, "/v1/auth/methods").catch(() => ({ developmentLogin: false, google: false, apple: false }))
        ]);
        if (mounted) {
          setRemoteEvents(events.items);
          setRemoteAddons(registry.items);
          setRemoteArtists(artists.items);
          setAuthMethods(methods);
          setApiStatus("Connected");
        }
      } catch {
        if (mounted) {
          setRemoteEvents([]);
          setRemoteAddons([]);
          setRemoteArtists([]);
          setAuthMethods({ developmentLogin: false, google: false, apple: false });
          setApiStatus("Offline – local ticketing still works");
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 300000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [apiUrl, apiRefresh]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!eventModal) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setEventModal(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [eventModal]);

  const filteredEvents = useMemo(() => {
    const query = search.toLowerCase().trim();
    return watchlist.filter((item) => (
      [item.artist, item.title, item.city, providerFor(item.providerId)?.name || ""].join(" ").toLowerCase().includes(query)
    ));
  }, [watchlist, search]);

  function inform(message: string, error = false) {
    setToast({ message, error });
  }

  function applySnapshot(snapshot: CloudSnapshot) {
    setAccount(snapshot.user);
    setWatchlist(snapshot.watchlist);
    setFavoriteArtistIds(snapshot.favoriteArtistIds);
    setFavoriteEventIds(snapshot.favoriteEventIds);
    setCloudError("");
  }

  async function demoLogin() {
    if (!window.tixbam || cloudBusy) return;
    setCloudBusy(true);
    try {
      applySnapshot(await window.tixbam.accountDemoLogin(apiUrl, demoAccount));
      inform("Signed in. Your favorites and events are now saved to TIXBAM cloud.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign-in failed";
      setCloudError(message);
      inform(message, true);
    } finally { setCloudBusy(false); }
  }

  async function signOut() {
    if (!window.tixbam || cloudBusy) return;
    setCloudBusy(true);
    try {
      await window.tixbam.accountSignOut();
      setAccount(null);
      setWatchlist(loadWatchlist());
      setFavoriteArtistIds([]);
      setFavoriteEventIds([]);
      setCloudError("");
      inform("Signed out. Guest items remain on this device.");
    } catch (err) {
      inform(err instanceof Error ? err.message : "Sign-out failed", true);
    } finally { setCloudBusy(false); }
  }

  async function refreshAccount() {
    if (!window.tixbam || !account) return;
    setCloudBusy(true);
    try {
      const snapshot = await window.tixbam.accountStatus();
      if (snapshot) applySnapshot(snapshot);
      else {
        setAccount(null);
        setWatchlist(loadWatchlist());
        setFavoriteArtistIds([]);
        setFavoriteEventIds([]);
        inform("Session expired. Please sign in again.", true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not sync";
      setCloudError(message);
      inform(message, true);
    } finally { setCloudBusy(false); }
  }

  async function importGuestEvents() {
    if (!window.tixbam || !account || cloudBusy) return;
    const items = loadWatchlist();
    if (!items.length) return;
    if (!window.confirm("Copy this device's guest events into your cloud account?")) return;
    setCloudBusy(true);
    try {
      for (const item of items) {
        await window.tixbam.accountRequest("PUT", "/v1/me/watchlist/" + item.id, item);
      }
      const snapshot = await window.tixbam.accountStatus();
      if (snapshot) applySnapshot(snapshot);
      inform("Guest events copied to your account.");
    } catch (err) {
      inform(err instanceof Error ? err.message : "Import incomplete. Retry sync.", true);
    } finally { setCloudBusy(false); }
  }

  async function toggleFavorite(kind: "artists" | "events", id: string) {
    if (!account || !window.tixbam) {
      setSection("settings");
      inform("Sign in to save your favorite artists and events.", true);
      return;
    }
    if (cloudBusy) return;
    const saved = kind === "artists" ? favoriteArtistIds : favoriteEventIds;
    const exists = saved.includes(id);
    setCloudBusy(true);
    try {
      await window.tixbam.accountRequest(exists ? "DELETE" : "PUT", "/v1/me/" + kind + "/" + id);
      const update = (items: string[]) => exists ? items.filter(value => value !== id) : [...items, id];
      if (kind === "artists") setFavoriteArtistIds(update);
      else setFavoriteEventIds(update);
      inform(exists ? "Removed from favorites." : "Saved to your account.");
    } catch (err) {
      inform(err instanceof Error ? err.message : "Could not sync favorite", true);
    } finally { setCloudBusy(false); }
  }

  async function addWatchItem(item: WatchEvent) {
    if (account && window.tixbam) {
      await window.tixbam.accountRequest("PUT", "/v1/me/watchlist/" + item.id, item);
    }
    setWatchlist(items => [item, ...items]);
  }

  async function toggleAddon(addon: TicketAddon) {
    if (!window.tixbam) {
      inform("Install and remove add-ons in the desktop app.", true);
      return;
    }
    if (busy) return;
    if (addon.installed && windows.some(w => w.providerId === addon.id)) {
      inform("Close all " + addon.name + " windows before removing the add-on.", true);
      return;
    }
    setBusy(addon.id);
    try {
      const updated = await window.tixbam.setAddonInstalled(addon.id, !addon.installed);
      setAddons(updated);
      inform(addon.name + (addon.installed ? " add-on removed. Existing sign-in data was preserved." : " add-on installed."));
    } catch (err) {
      inform(err instanceof Error ? err.message : "Could not update the add-on.", true);
    } finally {
      setBusy("");
    }
  }

  async function launch(providerId: string, url?: string) {
    if (!installedIds.has(providerId)) {
      inform("Install the " + providerFor(providerId)?.name + " add-on first.", true);
      setSection("providers");
      return;
    }
    if (!window.tixbam) {
      inform("Launch the Electron desktop app to open ticketing browser windows.", true);
      return;
    }
    setBusy(providerId);
    try {
      await window.tixbam.openWindow({ providerId, url: url || undefined });
      inform(providerFor(providerId)?.name + " window opened. Complete login and verification yourself.");
    } catch (err) {
      inform(err instanceof Error ? err.message : "Could not open the ticketing window.", true);
    } finally {
      setBusy("");
    }
  }

  async function handoffToTicketAgent(sourceWindowId: number) {
    if (!window.tixbam) return;
    const agentUrl = window.prompt("Paste the official ticket agent URL from the Live Nation event (for example, its Cityline event link):");
    if (!agentUrl?.trim()) return;
    try {
      const opened = await window.tixbam.openTicketAgent(sourceWindowId, agentUrl.trim());
      inform((providerFor(opened.providerId)?.name || "Ticket agent") + " opened in its own browser session. Sign in there if needed.");
    } catch (err) {
      inform(err instanceof Error ? err.message : "Could not open the ticket agent.", true);
    }
  }

  async function controlWindow(action: "focus" | "close", id: number) {
    if (!window.tixbam) return;
    try {
      if (action === "focus") await window.tixbam.focusWindow(id);
      else await window.tixbam.closeWindow(id);
    } catch (err) {
      inform(err instanceof Error ? err.message : "Window action failed.", true);
    }
  }

  async function clearProvider(provider: Provider) {
    if (!window.tixbam) {
      inform("Session storage controls require the desktop app.", true);
      return;
    }
    if (!window.confirm("Clear cookies and sign-in data for " + provider.name + "? This will log you out.")) return;
    try {
      await window.tixbam.clearProviderData(provider.id);
      inform(provider.name + " session data cleared.");
    } catch (err) {
      inform(err instanceof Error ? err.message : "Could not clear session.", true);
    }
  }

  function openCreate() {
    setForm(emptyEvent());
    setFormError("");
    setEventModal(true);
  }

  async function saveEvent(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const provider = providerFor(form.providerId);
    if (!provider) return setFormError("Choose a ticketing provider.");
    if (!form.artist.trim() || !form.title.trim()) return setFormError("Artist and event name are required.");
    const validation = validateTicketUrl(form.url, provider);
    if (validation) return setFormError(validation);
    const saleAt = form.saleAt ? new Date(form.saleAt) : null;
    if (saleAt && Number.isNaN(saleAt.getTime())) return setFormError("Enter a valid sale date.");
    const item: WatchEvent = {
      id: crypto.randomUUID(),
      artist: form.artist.trim(),
      title: form.title.trim(),
      city: form.city.trim(),
      providerId: form.providerId,
      saleAt: saleAt?.toISOString() || "",
      url: form.url.trim(),
      addedAt: new Date().toISOString(),
    };
    try {
      await addWatchItem(item);
      setEventModal(false);
      setSection("watchlist");
      setSearch("");
      inform(account ? "Event saved to your TIXBAM account." : "Event saved on this device.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save event to cloud");
    }
  }

  async function saveDiscoveredEvent(event: RemoteEvent, sale: RemoteEvent["sales"][number], performance?: RemotePerformance) {
    if (performance && (performance.status === "cancelled" || performance.status === "postponed")) {
      inform("This performance is not available to book.", true);
      return;
    }
    if (performance && !sale.appliesToAll && !sale.performanceIds.includes(performance.id)) {
      inform("This ticket sale does not cover the selected performance.", true);
      return;
    }
    if (!providerFor(sale.providerId)) {
      inform("This ticket provider is not installed in the current app.", true);
      return;
    }
    if (watchlist.some(item => item.url === sale.bookingUrl && item.title === event.title
      && item.performanceId === performance?.id)) {
      inform("This event is already in your watchlist.");
      return;
    }
    const item: WatchEvent = {
      id: crypto.randomUUID(), eventId: event.id, artist: event.artist, title: event.title,
      city: event.city, providerId: sale.providerId, performanceId: performance?.id,
      performanceAt: performance?.startsAt || undefined,
      saleAt: sale.saleAt || "", url: sale.bookingUrl,
      addedAt: new Date().toISOString()
    };
    try {
      await addWatchItem(item);
      inform(account ? "Added to your cloud watchlist." : "Added to your local watchlist.");
    } catch (err) {
      inform(err instanceof Error ? err.message : "Could not save event", true);
    }
  }

  async function removeEvent(id: string) {
    try {
      if (account && window.tixbam) {
        await window.tixbam.accountRequest("DELETE", "/v1/me/watchlist/" + id);
      }
      setWatchlist((items) => items.filter((item) => item.id !== id));
      inform("Event removed from your watchlist.");
    } catch (err) {
      inform(err instanceof Error ? err.message : "Could not remove event", true);
    }
  }

  const localClock = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit", minute: "2-digit", hour12: false
  }).format(new Date(now));
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll("_", " ").split("/").pop();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-symbol"><span>✳</span></div>
          <div className="brand-wordmark">TIX<span>BAM</span><small>THE FAN FIRST PLATFORM</small></div>
        </div>

        <div className="nav-label">YOUR SPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <button key={item.id} onClick={() => { setSection(item.id); setSearch(""); }}
              className={"nav-item" + (section === item.id ? " active" : "")}>
              <item.icon size={18} strokeWidth={1.9} />
              <span>{item.label}</span>
              {item.id === "sessions" && windows.length > 0 && <b className="nav-count">{windows.length}</b>}
              {section === item.id && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>

        <div className="nav-label providers-label">QUICK LAUNCH</div>
        <div className="quick-providers">
          {providers.filter(provider => installedIds.has(provider.id)).slice(0, 4).map((provider) => (
            <button className="quick-provider" key={provider.id} onClick={() => launch(provider.id)} disabled={busy === provider.id}>
              <ProviderMark provider={provider} small />
              <span>{provider.name}</span>
              <ArrowUpRight size={15} />
            </button>
          ))}
          <button className="all-providers-link" onClick={() => setSection("providers")}>View all providers <ArrowRight size={14} /></button>
        </div>

        <div className="sidebar-bottom">
          <div className="sidebar-guide">
            <span className="guide-icon"><Sparkles size={18} /></span>
            <strong>Ready for the rush?</strong>
            <p>Get set up before tickets go live.</p>
            <button onClick={() => setSection("settings")}>How it works <ArrowUpRight size={13} /></button>
          </div>
          <div className="desktop-label"><span className="status-pulse" />{desktop ? "DESKTOP APP · PROTOTYPE" : "WEB PREVIEW · PROTOTYPE"}</div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb"><span>WORKSPACE</span><ChevronRight size={14} /><strong>{navItems.find((item) => item.id === section)?.label}</strong></div>
          <div className="top-actions">
            <div className="top-time"><Clock3 size={14} />{localClock}<span>{localZone}</span></div>
            <span className="top-divider" />
            <span className="preview-tag"><span /> PROTOTYPE V0.1</span>
            <button className="avatar-button" aria-label="App profile information" title={account?.displayName || "Sign in"} onClick={() => setSection("settings")}>{account ? account.displayName.trim().slice(0, 2).toUpperCase() : "TB"}</button>
          </div>
        </header>

        <main className="main-content">
          {section === "overview" && <>
            <div className="hero">
              <div className="hero-glow hero-glow-one" />
              <div className="hero-glow hero-glow-two" />
              <div className="hero-grid-lines" />
              <div className="hero-copy">
                <div className="hero-label"><span className="starburst">✳</span> YOUR FRONT ROW STARTS HERE</div>
                <h1>THE SHOW IS<br /> <em>YOURS TO CHASE.</em></h1>
                <p>Every ticket site. One powerful place to get ready. Your next unforgettable moment starts here.</p>
                <div className="hero-buttons">
                  <button className="button button-dark" onClick={openCreate}><Plus size={18} /> Add an event</button>
                  <button className="hero-secondary" onClick={() => setSection("providers")}>Explore providers <ArrowUpRight size={16} /></button>
                </div>
              </div>
              <div className="hero-art" aria-hidden="true">
                <div className="hero-orbit" />
                <div className="hero-ring">
                  <div className="hero-ring-inner"><span>TIX</span><b>BAM!</b></div>
                </div>
                <span className="hero-art-star star-a">✦</span>
                <span className="hero-art-star star-b">✳</span>
                <span className="hero-art-star star-c">✦</span>
                <span className="floating-mini-ticket"><Ticket size={17} /> ACCESS GRANTED TO DREAM BIG</span>
              </div>
            </div>

            <div className="stats-grid">
              <div className="stat-card"><div className="stat-top"><span>YOUR WATCHLIST</span><Heart size={18} /></div><div className="stat-value">{watchlist.length.toString().padStart(2, "0")}<span>EVENTS</span></div><div className="stat-foot">Your upcoming ticket drops</div></div>
              <div className="stat-card"><div className="stat-top"><span>LIVE BROWSER WINDOWS</span><Layers3 size={18} /></div><div className="stat-value">{windows.length.toString().padStart(2, "0")}<span>OF {MAX_WINDOWS}</span></div><div className="stat-foot"><span className="tiny-green-dot" />{desktop ? "Desktop session manager" : "Requires desktop app"}</div></div>
              <div className="stat-card"><div className="stat-top"><span>READY TO LAUNCH</span><Globe2 size={18} /></div><div className="stat-value">{installedIds.size.toString().padStart(2, "0")}<span>ADD-ONS</span></div><div className="stat-foot">Across multiple regions</div></div>
            </div>

            <div className="featured-row">
              <SectionHeading eyebrow="THE LINEUP" title="Picture yourself there." description="Fictional showcase events to explore the workflow." />
              <button className="subtle-link" onClick={() => setSection("watchlist")}>My watchlist <ArrowUpRight size={17} /></button>
            </div>
            <div className="sample-grid">
              {demos.map((demo) => {
                const provider = providerFor(demo.providerId)!;
                return (
                  <article key={demo.id} className="sample-card">
                    <div className={"sample-cover cover-" + demo.theme}>
                      <div className="cover-noise" />
                      <span className="sample-badge">FICTIONAL DEMO</span>
                      <span className="cover-topline">TIXBAM PRESENTS • {demo.edition}</span>
                      <div className="cover-shape"><span>{demo.artist}</span></div>
                      <span className="cover-bottomline">LIVE THE MOMENT / FEEL THE MAGIC</span>
                    </div>
                    <div className="sample-body">
                      <div className="sample-kicker"><span><Radio size={12} /> SAMPLE EVENT</span><span>— DATE TBD</span></div>
                      <h3>{demo.artist}</h3><p>{demo.title}</p>
                      <div className="sample-place"><Globe2 size={14} />{demo.city}</div>
                      <div className="sample-bottom"><div className="sample-provider"><ProviderMark provider={provider} small /><span>{provider.name}</span></div><button aria-label={"Open " + provider.name} onClick={() => launch(provider.id)} disabled={!installedIds.has(provider.id)} title={!installedIds.has(provider.id) ? "Install provider add-on first" : "Open provider"}><ArrowUpRight size={18} /></button></div>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="overview-bottom">
              <div className="getting-ready-card">
                <span className="eyebrow"><span className="eyebrow-line" /> THE PLAYBOOK</span>
                <h3>Less chaos.<br /><span>More concert energy.</span></h3>
                <div className="playbook-steps">
                  <div><b>01</b><span>Save an event and official ticket link.</span></div>
                  <div><b>02</b><span>Open your provider browser and sign in manually.</span></div>
                  <div><b>03</b><span>Keep the window handy for the ticket drop.</span></div>
                </div>
              </div>
              <div className="safety-card">
                <div className="safety-circle"><ShieldCheck size={29} /></div>
                <div><strong>Human first. Fan always.</strong><p>TIXBAM pauses for CAPTCHAs, queues and bank verification. You stay in control of every purchase.</p><button onClick={() => setSection("settings")}>Privacy & limitations <ArrowUpRight size={15} /></button></div>
              </div>
            </div>
          </>}

          {section === "discover" && <>
            <SectionHeading eyebrow="FROM THE TIXBAM SERVER" title="Discover events" description="Concerts and ticket sales published by the TIXBAM platform." />
            <div className="remote-banner"><Globe2 size={17} /><span>API: {apiStatus}</span>
              <button onClick={() => setSection("settings")}>Service status <ArrowUpRight size={15}/></button></div>
            {remoteEvents.length ? <div className="remote-grid">
              {remoteEvents.filter(e => [e.title, e.artist, e.city].join(" ").toLowerCase().includes(search.toLowerCase())).map(event => {
                const sessions = event.performances || [];
                const selectedSession = sessions.find(p => p.id === chosenPerformances[event.id]) || sessions[0];
                const sessionTime = (p: RemotePerformance) => {
                  if (!p.startsAt) return "TBA";
                  try {
                    return new Intl.DateTimeFormat(undefined, {
                      timeZone: p.timezone || event.timezone || "UTC",
                      dateStyle: "medium", timeStyle: "short"
                    }).format(new Date(p.startsAt));
                  } catch { return "Time zone unavailable"; }
                };
                return <article key={event.id} className="remote-card">
                  <span className="eyebrow">LIVE CATALOG · {event.country || "GLOBAL"}</span>
                  <h3>{event.artist}</h3><p>{event.title}</p>
                  <div className="favorite-actions"><button className="button button-outline" disabled={cloudBusy} aria-pressed={favoriteEventIds.includes(event.id)} onClick={() => void toggleFavorite("events", event.id)}><Heart size={15} fill={favoriteEventIds.includes(event.id) ? "currentColor" : "none"}/>{favoriteEventIds.includes(event.id) ? "Event saved" : "Favorite event"}</button><button className="button button-outline" disabled={cloudBusy} aria-pressed={favoriteArtistIds.includes(event.artistId)} onClick={() => void toggleFavorite("artists", event.artistId)}><Star size={15} fill={favoriteArtistIds.includes(event.artistId) ? "currentColor" : "none"}/>{favoriteArtistIds.includes(event.artistId) ? "Following artist" : "Follow artist"}</button></div>
                  <div className="sample-place"><Globe2 size={14}/>{event.city || "City TBA"}{event.venue ? " · " + event.venue : ""}</div>
                  <div className="sample-place"><CalendarDays size={14}/>{sessions.length} session{sessions.length === 1 ? "" : "s"}</div>
                  {sessions.length > 0 && <label className="remote-performance-picker">Performance / session
                    <select aria-label={"Choose performance for " + event.title}
                      value={selectedSession?.id || ""}
                      onChange={e => setChosenPerformances(prev => ({ ...prev, [event.id]: e.target.value }))}>
                      {sessions.map(p => <option key={p.id} value={p.id}>
                        {p.label || p.sessionKey} · {sessionTime(p)} ({p.timezone || event.timezone || "UTC"}){p.status !== "scheduled" ? " · " + p.status : ""}
                      </option>)}
                    </select>
                  </label>}
                  <div className="remote-sales">
                    {event.sales.length ? event.sales.map(sale => {
                      const eligible = !selectedSession || (sale.appliesToAll !== false ||
                        (sale.performanceIds || []).includes(selectedSession.id));
                      const active = !selectedSession || !["cancelled", "postponed"].includes(selectedSession.status);
                      return <div className="remote-sale" key={sale.id}>
                        <div><strong>{providerFor(sale.providerId)?.name || sale.providerId}</strong>
                          <span>{sale.saleType} · {sale.saleAt ? new Date(sale.saleAt).toLocaleString() : "Sale TBA"}</span>
                          {!eligible && <span>Not valid for this session</span>}
                        </div>
                        <button className="button button-outline" disabled={!eligible || !active}
                          onClick={() => saveDiscoveredEvent(event, sale, selectedSession)}>Watch</button>
                        <button className="button button-primary" disabled={!eligible || !active || !installedIds.has(sale.providerId)}
                          onClick={() => launch(sale.providerId, sale.bookingUrl)}>Open</button>
                      </div>;
                    }) : <span className="muted">Ticket sale details not published yet.</span>}
                  </div>
                </article>;
              })}

            </div> : <div className="empty-state"><div className="empty-icon"><CalendarDays size={28}/></div><h3>No published events yet.</h3><p>Events appear automatically when published in TIXBAM Admin. You can still create local events manually.</p><button className="button button-primary" onClick={openCreate}>Add local event</button></div>}
          </>}

          {section === "artists" && <>
             <SectionHeading eyebrow="YOUR FAVORITE ARTISTS" title="My artists" description="Follow artists to keep your preferences synced across devices." />
             <div className="content-toolbar">
               <label className="search-field"><Search size={18} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find an artist..." /></label>
               <label className="favorite-filter"><input type="checkbox" checked={onlyFavoriteArtists} onChange={e => setOnlyFavoriteArtists(e.target.checked)} /> Followed only ({favoriteArtistIds.length})</label>
             </div>
             {!account && <div className="remote-banner"><UserRound size={16}/>Sign in from Settings to follow artists and sync favorites.<button onClick={() => setSection("settings")}>Sign in <ArrowRight size={14}/></button></div>}
             <div className="artist-grid">
               {remoteArtists.filter(a => (!onlyFavoriteArtists || favoriteArtistIds.includes(a.id)) && a.name.toLowerCase().includes(search.toLowerCase())).map(artist => (
                 <article className="artist-card" key={artist.id}><div className="artist-avatar">{artist.imageUrl ? <img src={artist.imageUrl} alt="" /> : <Star size={24}/>}</div><div><h3>{artist.name}</h3><p>{artist.country || "Global"} · {remoteEvents.filter(e => e.artistId === artist.id).length} events</p></div><button className="button button-outline" disabled={cloudBusy} aria-pressed={favoriteArtistIds.includes(artist.id)} onClick={() => void toggleFavorite("artists", artist.id)}><Star size={15} fill={favoriteArtistIds.includes(artist.id) ? "currentColor" : "none"}/>{favoriteArtistIds.includes(artist.id) ? "Following" : "Follow"}</button></article>
               ))}
             </div>
           </>}

           {section === "watchlist" && <>
            <SectionHeading eyebrow="YOUR NEXT BIG MOMENT" title="My events" description="Your personal calendar of tickets worth chasing."
              action={<button className="button button-primary" onClick={openCreate}><Plus size={17} /> Add event</button>} />
            <div className="content-toolbar">
              <label className="search-field"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search artist, event or city..." /></label>
              <span className="results-label">{filteredEvents.length} SAVED EVENT{filteredEvents.length === 1 ? "" : "S"}</span>
            </div>
            {filteredEvents.length ? <div className="watchlist-grid">
              {filteredEvents.map((item) => {
                const provider = providerFor(item.providerId);
                if (!provider) return null;
                return (
                  <article className="watch-card" key={item.id}>
                    <div className="watch-head"><div className="watch-poster"><Ticket size={26} /><span>TIXBAM</span></div><div className="watch-title"><span className="watch-label">WATCHING • {provider.country}</span><h3>{item.artist}</h3><p>{item.title}</p>{item.performanceAt && <small>{new Date(item.performanceAt).toLocaleString()}</small>}</div><button className="icon-button danger" aria-label="Remove event" title="Remove event" onClick={() => removeEvent(item.id)}><Trash2 size={16} /></button></div>
                    <div className="watch-divider" />
                    <div className="watch-details"><div><CalendarDays size={16} /><span>{humanDate(item.saleAt)}</span></div><div><Globe2 size={16} /><span>{item.city || "Location not specified"}</span></div></div>
                    <div className="countdown-chip"><Clock3 size={13} />{countdown(item.saleAt, now)}</div>
                    {addons.find(a=>a.id===item.providerId)?.booking && <button className="button button-outline booking-entry" disabled={!installedIds.has(item.providerId)} onClick={()=>setBookingEvent(item)}><Settings2 size={15}/> Booking preferences & automation</button>}
                    <div className="watch-footer"><span className="provider-inline"><ProviderMark provider={provider} small />{provider.name}</span><button className="button button-primary" disabled={busy === provider.id} onClick={() => installedIds.has(provider.id) ? launch(provider.id, item.url) : setSection("providers")}><ExternalLink size={15} /> {installedIds.has(provider.id) ? "Open site" : "Install add-on"}</button></div>
                  </article>
                );
              })}
            </div> : <div className="empty-state"><div className="empty-icon"><Ticket size={32} /></div><h3>{watchlist.length ? "No matching events." : "Your next great memory begins here."}</h3><p>{watchlist.length ? "Try another search." : "Keep track of your favorite artists, ticket launch times and official booking links."}</p><button className="button button-primary" onClick={openCreate}><Plus size={17} /> Add your first event</button></div>}
          </>}

          {section === "sessions" && <>
            <SectionHeading eyebrow="THE CONTROL ROOM" title="Live windows" description="Manage the ticketing browsers you have opened."
              action={<span className="counter-badge"><span className="tiny-green-dot" />{windows.length} / {MAX_WINDOWS} WINDOWS OPEN</span>} />
            <div className="desktop-explainer"><div className="desktop-explainer-icon"><Monitor size={23} /></div><div><strong>{desktop ? "Each window is a real ticketing browser." : "Live ticketing windows require the desktop app."}</strong><p>Windows for the same provider share sign-in cookies. Keep track of provider queues yourself; opening more windows does not create extra queue positions.</p></div><button onClick={() => setSection("providers")}>Open a provider <ArrowUpRight size={17} /></button></div>
            <BookingRunList />
            {windows.length ? <div className="session-list">
              {windows.map((item) => {
                const provider = providerFor(item.providerId);
                if (!provider) return null;
                return <div key={item.id} className="session-row"><ProviderMark provider={provider} /><div className="session-meta"><strong>{provider.name} <span>· Window #{item.id}</span></strong><p title={item.url}>{item.title || item.url || provider.url}</p></div><span className={"session-state" + (item.loading ? " is-loading" : "")}><span />{item.loading ? "LOADING" : "OPEN"}</span>{provider.kind === "event-presale" && <button className="button button-outline" onClick={() => handoffToTicketAgent(item.id)}><ArrowRight size={15} /> Ticket agent</button>}<button className="button button-outline" onClick={() => controlWindow("focus", item.id)}><ExternalLink size={15} /> Focus</button><button className="icon-button" aria-label={"Close window " + item.id} onClick={() => controlWindow("close", item.id)}><X size={18} /></button></div>;
              })}
            </div> : <div className="empty-state sessions-empty"><div className="empty-icon"><Layers3 size={31} /></div><h3>No active windows yet.</h3><p>Open a provider to start a manual ticketing session. Your sign-in storage is kept separately for each provider.</p><button className="button button-primary" onClick={() => setSection("providers")}>Browse providers <ArrowRight size={16} /></button></div>}
            <div className="session-footnote"><LockKeyhole size={17} /> Windows are local to this device. Passwords and verification stay in the provider window. Saved cards are encrypted locally and used only for prepared booking runs.</div>
          </>}

          {section === "providers" && <>
            {remoteAddons.length > 0 && <div className="remote-banner"><Globe2 size={17}/><span>Server registry connected. {remoteAddons.filter(remote => { const local = addons.find(a => a.id === remote.id); return local && local.version !== remote.version; }).length} version updates available as metadata. Remote executable installation is not enabled yet.</span></div>}

            <SectionHeading eyebrow="ONE HUB. EVERY STAGE." title="Add-on Store" description="Install only the ticketing providers you use. Remove them whenever you like." />
            <div className="provider-intro"><div><Zap size={20} /><strong>ADD-ON CAPABILITIES</strong></div><p>Event / presale providers publish official event pages and member sale links; ticketing providers handle seat selection and checkout. Level 1 is browser assistance, Level 2 seat / order assistance, and Level 3 authorized checkout. “Via agent” indicates that a different official ticket agent performs that step. Cityline currently has performance and price selection plus checkout rehearsal only.</p></div>
            <div className="automation-legend" aria-label="Automation support legend">
              <span><span className="automation-legend-dot ready" />Available in TIXBAM</span>
              <span><span className="automation-legend-dot limited" />Restricted by published terms</span>
              <span><span className="automation-legend-dot pending" />Not yet verified</span><span>Via agent = handled by the official ticketing partner</span>
            </div>
            {(["event-presale", "ticketing"] as const).map(kind => <section key={kind} className="addon-provider-section">
              <h3 className="addon-group-title">{kind === "event-presale" ? "Event & presale providers" : "Ticketing providers"}</h3>
              <p className="addon-group-description">{kind === "event-presale" ? "Official concert pages and member presales. Tickets are purchased with each event's ticket agent." : "Open official ticketing websites. Booking automation support varies by provider."}</p>
              <div className="provider-grid">
              {addons.filter(addon => addon.kind === kind).map((provider) => {
                const openCount = windows.filter((item) => item.providerId === provider.id).length;
                return <article key={provider.id} className="provider-card"><div className="provider-card-top"><ProviderMark provider={provider} /><span className="provider-region"><Globe2 size={13} /> {provider.region}</span></div><h3>{provider.name}</h3><p className="provider-url">{new URL(provider.url).hostname}</p><AddonAutomationLevels addon={provider} />{provider.sites && <label className="addon-region-select">Regional site<select aria-label={provider.name + " regional website"} value={siteByProvider[provider.id] || provider.url} onChange={event => setSiteByProvider(prev => ({ ...prev, [provider.id]: event.target.value }))}>{provider.sites.map(site => <option key={site.url} value={site.url}>{site.label}</option>)}</select></label>}<div className="provider-card-bottom"><span className="provider-count"><span className="tiny-green-dot" /> {openCount ? openCount + " WINDOW" + (openCount === 1 ? "" : "S") + " OPEN" : provider.installed ? "INSTALLED" : "NOT INSTALLED"}</span><div style={{display:"flex",gap:8,alignItems:"center"}}><button type="button" aria-label={(provider.installed ? "Remove " : "Install ") + provider.name + " add-on"} title={provider.installed ? "Remove add-on" : "Install add-on"} disabled={Boolean(busy) || !desktop} onClick={() => toggleAddon(provider)} style={{width:"auto",padding:"0 12px",fontSize:12}}>{provider.installed ? "Remove" : "Install"}</button>{provider.installed && <button aria-label={"Open " + provider.name} disabled={Boolean(busy)} onClick={() => launch(provider.id, siteByProvider[provider.id])}><ArrowUpRight size={20} /></button>}</div></div></article>;
              })}
              </div>
            </section>)}
            <div className="hint-box"><ShieldCheck size={21} /><p><strong>Know before you go.</strong> Some websites may restrict embedded/desktop browsers or simultaneous access. TIXBAM never promises login compatibility or availability; always respect each site's policies.</p></div>
          </>}

          {section === "settings" && <>
            <SectionHeading eyebrow="MAKE IT YOURS" title="Settings & privacy" description="A transparent look at what TIXBAM stores and how it works." />
            <div className="settings-grid"><div className="settings-main">
               <div className="settings-panel account-panel">
                 <div className="settings-panel-title"><UserRound size={20}/><div><h3>TIXBAM account</h3><p>{account ? "Your artist favorites, event favorites and watchlist sync to the cloud." : "Sign in to save favorites and events to your account."}</p></div></div>
                 {account ? <>
                   <div className="settings-inline"><div className="account-identity"><strong>{account.displayName}</strong><span>{account.email || "No verified email"} · {account.providers.join(", ")}</span></div><button className="button button-outline" onClick={() => void signOut()} disabled={cloudBusy}>Sign out</button></div>
                   <div className="settings-inline"><span>{favoriteArtistIds.length} artists · {favoriteEventIds.length} favorite events · {watchlist.length} watched ticket sales</span><button className="button button-outline" disabled={cloudBusy} onClick={() => void refreshAccount()}>Sync now</button></div>
                   {loadWatchlist().length > 0 && <div className="settings-inline"><span>{loadWatchlist().length} guest events stored on this device</span><button className="button button-outline" disabled={cloudBusy} onClick={() => void importGuestEvents()}>Import guest events</button></div>}
                 </> : <>
                   <div className="account-options"><button className="button button-outline" disabled title="Native Google authorization is not configured in the desktop app yet.">Continue with Google · Soon</button><button className="button button-outline" disabled title="Native Apple authorization is not configured in the desktop app yet.">Continue with Apple · Soon</button></div>
                   {authMethods.developmentLogin && desktop && <div className="account-demo"><div><strong>Development sign-in</strong><p>Simulate social sign-in with two separate test accounts, no Google/Apple setup needed.</p></div><select aria-label="Demo account" value={demoAccount} onChange={e => setDemoAccount(e.target.value as "fan-one" | "fan-two")}><option value="fan-one">Demo Fan One</option><option value="fan-two">Demo Fan Two</option></select><button className="button button-primary" disabled={cloudBusy} onClick={() => void demoLogin()}>Sign in for testing</button></div>}
                   {!authMethods.developmentLogin && <div className="settings-note">Demo sign-in is disabled on this API. OAuth buttons will be enabled after native provider configuration.</div>}
                 </>}
                 {cloudError && <p className="account-error" role="alert">{cloudError}</p>}
                 <div className="settings-note">TIXBAM account data is stored on the server. Ticketing site logins and encrypted payment cards remain local to this device.</div>
               </div>
              <CardVaultPanel />
              <div className="settings-panel"><div className="settings-panel-title"><Globe2 size={20}/><div><h3>TIXBAM cloud</h3><p role="status">{apiStatus}. Events and add-on versions update automatically. Your ticketing sessions stay local.</p></div></div>
                <div className="settings-note">Connected to the official TIXBAM service automatically. No setup is required.</div>
                <div className="settings-inline"><span>{remoteEvents.length} published events · {remoteAddons.length} catalog add-ons</span><button className="button button-outline" onClick={() => setApiRefresh(value => value + 1)}>Retry connection</button></div>
              </div>
              <div className="settings-panel"><div className="settings-panel-title"><LockKeyhole size={20} /><div><h3>Provider sign-in data</h3><p>Stored locally, separate for each ticketing provider.</p></div></div><div className="settings-provider-list">{providers.map((provider) => <div key={provider.id} className="settings-provider-row"><span className="provider-inline"><ProviderMark provider={provider} small />{provider.name}</span><button onClick={() => clearProvider(provider)}>Clear cookies & storage <Trash2 size={14} /></button></div>)}</div><div className="settings-note">Close all windows for a provider before clearing their session. This will require a new manual sign-in.</div></div>
              <div className="settings-panel"><div className="settings-panel-title"><Heart size={20} /><div><h3>My saved events</h3><p>{account ? "Your personal watchlist is saved to your TIXBAM account." : "Guest events are saved on this device only."}</p></div></div><div className="settings-inline"><span>{watchlist.length} event{watchlist.length === 1 ? "" : "s"} {account ? "synced to your account" : "in local storage"}</span><button className="button button-outline" onClick={() => setSection("watchlist")}>Manage events <ArrowRight size={15} /></button></div></div>
            </div><div className="settings-side"><div className="settings-story"><div className="story-icon"><ShieldCheck size={28} /></div><h3>YOUR ACCOUNT.<br />YOUR RULES.</h3><p>We don't connect to a ticketing site's API, store passwords in our app, solve CAPTCHA or bypass queue systems.</p><span>V0.1 • LOCAL DESKTOP PROTOTYPE</span></div><div className="settings-facts"><strong>About this build</strong><div><span>Version</span><b>0.1.0 prototype</b></div><div><span>Providers</span><b>{installedIds.size} installed / {addons.length} available</b></div><div><span>Environment</span><b>{desktop ? "Electron desktop" : "Browser preview"}</b></div><div><span>Sync</span><b>{account ? "Cloud account" : "Guest / local"}</b></div></div></div></div>
          </>}
        </main>

        <footer className="footer"><div>© TIXBAM • FOR THE FANS, BY DESIGN.</div><div><span className="tiny-green-dot" /> LOCAL TICKETING WORKSPACE <span className="footer-separator">/</span> NO SUCCESS GUARANTEE</div></footer>
      </div>

      {eventModal && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setEventModal(false); }}>
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className="modal-top"><span className="eyebrow"><span className="eyebrow-line" /> STAY ONE STEP AHEAD</span><button className="icon-button" aria-label="Close" onClick={() => setEventModal(false)}><X size={20} /></button></div>
          <h2 id="modal-title">Add your next big thing.</h2><p className="modal-sub">Organize an event and its official booking site in one place.</p>
          <form onSubmit={saveEvent}>
            <div className="form-row"><label>Artist or group <span>*</span><input autoFocus maxLength={80} placeholder="e.g. Your favorite artist" value={form.artist} onChange={(e) => setForm({ ...form, artist: e.target.value })} /></label><label>Event name <span>*</span><input maxLength={120} placeholder="e.g. 2027 World Tour" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label></div>
            <div className="form-row"><label>City / venue<input maxLength={100} placeholder="e.g. Hong Kong" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label><label>Ticket sales begin<input type="datetime-local" value={form.saleAt} onChange={(e) => setForm({ ...form, saleAt: e.target.value })} /></label></div>
            <label>Ticketing provider<select value={form.providerId} onChange={(e) => setForm({ ...form, providerId: e.target.value })}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} — {provider.region}</option>)}</select></label>
            <label>Official ticket link <span className="optional">(optional)</span><div className="field-with-icon"><Link2 size={17} /><input type="url" placeholder={providerFor(form.providerId)?.url} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></div></label>
            <p className="input-hint">Leave the link blank to open the provider's home page. Direct links must belong to that provider.</p>
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <div className="modal-actions"><button type="button" className="button button-outline" onClick={() => setEventModal(false)}>Cancel</button><button type="submit" className="button button-primary"><Check size={17} /> Save event</button></div>
          </form>
        </div>
      </div>}

      {bookingEvent && <BookingPanel event={bookingEvent} addon={addons.find(a=>a.id===bookingEvent.providerId)!} windows={windows.filter(w=>w.providerId===bookingEvent.providerId)} onClose={()=>setBookingEvent(null)}/>}
      {toast && <div className={"toast" + (toast.error ? " toast-error" : "")} role="status">{toast.error ? <Bell size={19} /> : <Check size={19} />}<span>{toast.message}</span><button onClick={() => setToast(null)} aria-label="Dismiss notification"><X size={15} /></button></div>}
    </div>
  );
}

export default App;
