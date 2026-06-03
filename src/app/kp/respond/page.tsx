"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

type Phase = "loading" | "accepted" | "declined" | "error";

export default function KpRespondPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const action = params.get("action");

    if (!id || (action !== "accepted" && action !== "declined")) {
      setPhase("error");
      setMessage("This response link is invalid or incomplete.");
      return;
    }

    fetch("/api/kp/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    })
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        if (!r.ok) throw new Error(data.error || "Could not record your response.");
        setPhase(action as "accepted" | "declined");
      })
      .catch((e: Error) => {
        setPhase("error");
        setMessage(e.message);
      });
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0f1c3f] px-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 px-8 py-10 text-center backdrop-blur">
        <Image
          src="/logo-light.png"
          alt="Portfolio AI"
          width={150}
          height={40}
          className="mx-auto mb-8 h-9 w-auto"
          priority
        />
        {phase === "loading" && (
          <p className="text-sm text-white/70">Recording your response…</p>
        )}
        {phase === "accepted" && (
          <>
            <h1 className="text-xl font-medium text-white">You&apos;re in</h1>
            <p className="mt-2 text-sm text-white/70">
              Thanks — we&apos;ve recorded that you accepted this deal. The team
              will follow up with next steps.
            </p>
          </>
        )}
        {phase === "declined" && (
          <>
            <h1 className="text-xl font-medium text-white">Response recorded</h1>
            <p className="mt-2 text-sm text-white/70">
              Thanks for letting us know you&apos;re passing on this one. No
              further action is needed.
            </p>
          </>
        )}
        {phase === "error" && (
          <>
            <h1 className="text-xl font-medium text-white">Something went wrong</h1>
            <p className="mt-2 text-sm text-white/70">{message}</p>
          </>
        )}
      </div>
    </main>
  );
}
