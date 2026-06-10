import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
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
      <Sidebar user={user} />
      <main className="flex-1 overflow-x-hidden bg-[#f8f8fa]">{children}</main>
    </div>
  );
}
