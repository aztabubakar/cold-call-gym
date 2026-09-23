import Link from "next/link";

export default function Nav({ email }: { email: string | null }) {
  return (
    <nav className="nav">
      <Link className="brand" href="/">
        Cold Call <span className="accent">Gym</span>
      </Link>
      <div className="nav-links">
        {email ? (
          <>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/scenarios">Scenarios</Link>
            <Link href="/contact-sales">Contact Sales</Link>
            <span className="nav-email">{email}</span>
            <form action="/auth/sign-out" method="post">
              <button className="button ghost" type="submit">
                Sign out
              </button>
            </form>
          </>
        ) : (
          <>
            <Link href="/contact-sales">Contact Sales</Link>
            <Link href="/login">Sign in</Link>
            <Link className="button" href="/signup">
              Sign up
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
