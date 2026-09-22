export default function SupabaseSetupNotice() {
  return (
    <div className="card panel">
      <p className="accent">
        <b>SETUP NEEDED</b>
      </p>
      <h1>Connect Supabase to continue</h1>
      <p className="muted">
        This page requires Supabase for authentication. Copy{" "}
        <code>apps/web/.env.example</code> to <code>apps/web/.env.local</code>, add your
        project&apos;s URL and anon key, then restart the dev server.
      </p>
    </div>
  );
}
