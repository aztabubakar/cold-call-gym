import "./globals.css";
import type { ReactNode } from "react";
import Nav from "@/components/Nav";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Cold Call Gym",
  description: "Practice cold calls with realistic AI prospects.",
};

async function getUserEmail(): Promise<string | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return null;
  }
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.email ?? null;
  } catch {
    return null;
  }
}

export default async function Layout({ children }: { children: ReactNode }) {
  const email = await getUserEmail();

  return (
    <html lang="en">
      <body>
        <main className="container">
          <Nav email={email} />
          {children}
        </main>
      </body>
    </html>
  );
}
