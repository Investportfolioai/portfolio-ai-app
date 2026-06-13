import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { MobileNav } from "@/components/mobile-nav";
import { getSessionUser } from "@/lib/auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "kp" || user.role === "viewer") redirect("/kp/dashboard");

  return (
    <div className="flex min-h-screen w-full">
      <div className="hidden md:flex">
        <Sidebar user={user} />
      </div>
      <main className="flex-1 overflow-x-hidden bg-[#f8f8fa] pb-16 md:pb-0">{children}</main>
      <MobileNav />
    </div>
  );
}
