"use client";
export default function ResourceError({error, reset}: {error:Error & {digest?:string};reset:()=>void}) {
  return <div className="panel">
    <h2>Unable to load this page</h2>
    <p className="muted">{error.message || "API connection failed."}</p>
    <button type="button" onClick={reset}>Try again</button>
  </div>;
}
