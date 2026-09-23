import { Suspense } from "react";
import StartAccessForm from "@/components/StartAccessForm";

export const metadata = { title: "Start Practicing Free · Cold Call Gym" };

export default function StartPage() {
  return (
    <div className="auth-shell">
      <Suspense fallback={null}>
        <StartAccessForm />
      </Suspense>
    </div>
  );
}
