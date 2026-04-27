import { NextRequest, NextResponse } from "next/server";
import { verifyJWT } from "@/lib/auth/jwt";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Protect /admin/* routes (except /admin/login)
  if (pathname.startsWith("/admin") && !pathname.startsWith("/admin/login")) {
    const token = req.cookies.get("admin_token")?.value;
    if (!token) {
      return NextResponse.redirect(new URL("/admin/login", req.url));
    }
    const payload = await verifyJWT(token);
    if (!payload || !payload.isAdmin) {
      return NextResponse.redirect(new URL("/admin/login", req.url));
    }
  }

  // Protect /dashboard route
  if (pathname.startsWith("/dashboard")) {
    // Handle view-as token from admin panel: set cookie and redirect to clean URL
    const viewAsToken = req.nextUrl.searchParams.get("_vt");
    if (viewAsToken) {
      const payload = await verifyJWT(viewAsToken);
      if (payload) {
        const cleanUrl = new URL(pathname, req.nextUrl.origin);
        const res = NextResponse.redirect(cleanUrl);
        res.cookies.set("user_token", viewAsToken, {
          httpOnly: true,
          path: "/",
          sameSite: "lax",
          maxAge: 86400,
        });
        return res;
      }
    }

    const token = req.cookies.get("user_token")?.value;
    if (!token) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    const payload = await verifyJWT(token);
    if (!payload) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/dashboard/:path*"],
};
