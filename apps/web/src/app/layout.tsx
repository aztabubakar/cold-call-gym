import "./globals.css";
import type { ReactNode } from "react";
import Nav from "@/components/Nav";
import { getCurrentLead } from "@/lib/server/access";

export const metadata = {
  title: "Cold Call Gym",
  description: "Practice cold calls with realistic AI prospects.",
};

export default async function Layout({ children }: { children: ReactNode }) {
  const lead = await getCurrentLead();

  return (
    <html lang="en">
      <body>
        <main className="container">
          <Nav hasAccess={Boolean(lead)} firstName={lead?.name.split(" ")[0] ?? null} />
          {children}
        </main>
      </body>
    </html>
  );
}
