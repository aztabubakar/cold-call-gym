import { redirect } from "next/navigation";

// Cold Call Gym has no self-service payment flow — there is nothing to
// bill. Teams that need more than the free daily allowance contact sales
// instead. This route is kept (rather than removed outright) only so any
// existing bookmark or hardcoded link to /billing lands somewhere useful
// instead of a 404 or a fake payment page.
export default function BillingRedirect() {
  redirect("/contact-sales");
}
