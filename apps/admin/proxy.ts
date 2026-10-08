import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const user = process.env.TIXBAM_ADMIN_USER;
  const password = process.env.TIXBAM_ADMIN_PASSWORD;
  if (!user || !password) return new NextResponse("Admin credentials are not configured.", { status: 503 });
  const authorization = request.headers.get("authorization");
  const expected = "Basic " + btoa(user + ":" + password);
  if (authorization !== expected) {
    return new NextResponse("Authentication required.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="TIXBAM Admin"', "Cache-Control": "no-store" }
    });
  }
  return NextResponse.next();
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
