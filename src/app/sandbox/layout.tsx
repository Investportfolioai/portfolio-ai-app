import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { getSessionUser } from "@/lib/auth";

export default async function SandboxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "kp" || user.role === "viewer") redirect("/kp/dashboard");

  return (
    <div className="flex min-h-screen w-full">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <TopBar user={user} />
        <main className="flex-1 bg-[#f8f8fa]">{children}</main>
      </div>
    </div>
  );
}
