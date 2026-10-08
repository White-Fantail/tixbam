import Link from "next/link";
export default function NotFound() {
  return <div className="panel"><h1>Page not found</h1>
    <p className="muted">This record may no longer exist.</p>
    <Link href="/">Return to dashboard</Link>
  </div>;
}
