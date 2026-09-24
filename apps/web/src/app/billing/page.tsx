import { redirect } from "next/navigation";

// Cold Call Gym has no self-service payment flow — there is nothing to
// bill. Practice is free and unlimited; teams wanting anything beyond
// self-service contact sales instead. This route is kept (rather than
// removed outright) only so any existing bookmark or hardcoded link to
// /billing lands somewhere useful instead of a 404 or a fake payment page.
export default function BillingRedirect() {
  redirect("/contact-sales");
}
