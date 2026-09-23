import Link from "next/link";

export default function Nav({ hasAccess, firstName }: { hasAccess: boolean; firstName: string | null }) {
  return (
    <nav className="nav">
      <Link className="brand" href="/">
        Cold Call <span className="accent">Gym</span>
      </Link>
      <div className="nav-links">
        {hasAccess ? (
          <>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/scenarios">Scenarios</Link>
            <Link href="/contact-sales">Contact Sales</Link>
            {firstName && <span className="nav-email">{firstName}</span>}
          </>
        ) : (
          <>
            <Link href="/contact-sales">Contact Sales</Link>
            <Link className="button" href="/start">
              Start Practicing Free
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
