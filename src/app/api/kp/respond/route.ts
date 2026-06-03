import { NextResponse } from "next/server";
import { respondToAssignment } from "@/app/dashboard/pipeline/kp-actions";
import type { AssignmentStatus } from "@/lib/types";

export const runtime = "nodejs";

/** Public endpoint: records a KP's accept/decline for an assignment id. */
export async function POST(req: Request) {
  let body: { id?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const { id, action } = body;
  if (!id || (action !== "accepted" && action !== "declined")) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const res = await respondToAssignment(id, action as AssignmentStatus);
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
