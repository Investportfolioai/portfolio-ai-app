import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { getSessionUser } from "@/lib/auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Defense in depth: proxy guards routes, but verify here too (close to data).
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen w-full">
      <Sidebar user={user} />
      <main className="flex-1 overflow-x-hidden bg-[#f8f8fa]">{children}</main>
    </div>
  );
}
