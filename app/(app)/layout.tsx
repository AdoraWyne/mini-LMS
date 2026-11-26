import { Suspense, type ReactNode } from "react";
import { AppHeader } from "@/components/app-header";

/**
 * Shell for the logged-in area (/dashboard, /admin). "(app)" is a route group: it shares this
 * layout without adding "/app" to the URL. Logged-out visitors never get here: the proxy
 * redirects page requests to /auth/login.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center">
      <Suspense>
        <AppHeader />
      </Suspense>
      <main className="w-full max-w-5xl flex-1 p-5">{children}</main>
    </div>
  );
}
