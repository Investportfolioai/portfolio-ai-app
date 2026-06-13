import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { MobileNav } from "@/components/mobile-nav";
import { TopBar } from "@/components/top-bar";
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
        <Sidebar />
      </div>
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <TopBar user={user} />
        <main className="flex-1 bg-[#f8f8fa] pb-16 md:pb-0">{children}</main>
      </div>
      <MobileNav />
    </div>
  );
}
