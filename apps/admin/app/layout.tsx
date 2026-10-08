import type { ReactNode } from "react";
import { Sidebar } from "./_components/sidebar";
import "./globals.css";
export const metadata = {title:"TIXBAM Admin",description:"TIXBAM platform control center"};
export default function Layout({children}: {children:ReactNode}) {
  return <html lang="en"><body>
    <div className="admin-layout">
      <Sidebar />
      <main id="main-content" className="admin-main">
        <div className="admin-topbar"><span>Platform Management</span><span className="admin-env">ADMIN CONSOLE</span></div>
        {children}
      </main>
    </div>
  </body></html>;
}
