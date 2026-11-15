import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "./lib/supabase/config";
import { isUnauthenticatedError } from "./lib/supabase/auth-errors";

const authRoutes = ["/login", "/cadastro", "/recuperar-senha", "/redefinir-senha"];
const publicRoutes = ["/planos"];
const adminRoles = ["admin", "administração", "administracion"];

function isAdmin(role: string | null) {
  return adminRoles.includes((role ?? "").trim().toLowerCase());
}

function redirectWithCookies(url: URL, response: NextResponse) {
  const redirectResponse = NextResponse.redirect(url);
  response.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  return redirectResponse;
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (
    pathname === "/api/webhooks/evolution" ||
    pathname === "/api/workers/campaigns"
  ) {
    return NextResponse.next({ request });
  }
  const isAuthRoute = authRoutes.includes(pathname);
  const isPublicRoute = publicRoutes.includes(pathname);
  const isCallback = pathname === "/auth/callback";
  const config = getSupabaseConfig();

  if (!config) {
    if (!isAuthRoute && !isPublicRoute && !isCallback) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = pathname === "/" ? "/planos" : "/login";
      loginUrl.search = "";
      loginUrl.searchParams.set("next", `${pathname}${search}`);
      return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error && !isUnauthenticatedError(error)) {
    return new NextResponse(
      "Não foi possível verificar a sessão agora. Tente novamente em instantes.",
      { status: 503 },
    );
  }

  if (user) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("is_active, role, plan_selected")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile) {
      return new NextResponse(
        "Não foi possível verificar o perfil. Confirme se as migrations do banco foram aplicadas.",
        { status: 503 },
      );
    }

    if (!profile.is_active) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = "";
      loginUrl.searchParams.set("account", "disabled");
      return redirectWithCookies(loginUrl, response);
    }

    if (pathname === "/" && !profile.plan_selected) {
      const plansUrl = request.nextUrl.clone();
      plansUrl.pathname = "/planos";
      plansUrl.search = "";
      return redirectWithCookies(plansUrl, response);
    }

    if (pathname === "/cadastro") {
      const billingUrl = request.nextUrl.clone();
      billingUrl.pathname = "/billing";
      billingUrl.search = "";
      const selectedPlan = request.nextUrl.searchParams.get("plan");
      if (selectedPlan) billingUrl.searchParams.set("plan", selectedPlan);
      return redirectWithCookies(billingUrl, response);
    }

    const isBillingRoute =
      pathname === "/billing" || pathname.startsWith("/billing/");
    if (
      !isBillingRoute &&
      !isPublicRoute &&
      !isAdmin(profile.role)
    ) {
      const { data: hasPlanAccess, error: accessError } = await supabase.rpc(
        "has_broadcast_hub_access",
      );

      if (accessError) {
        return new NextResponse(
          "Não foi possível verificar seu plano. Confirme se as migrations foram aplicadas.",
          { status: 503 },
        );
      }

      if (!hasPlanAccess) {
        const plansUrl = request.nextUrl.clone();
        plansUrl.pathname = "/planos";
        plansUrl.search = "";
        return redirectWithCookies(plansUrl, response);
      }
    }
  }

  if (!user && !isAuthRoute && !isPublicRoute && !isCallback) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = pathname === "/" ? "/planos" : "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return redirectWithCookies(loginUrl, response);
  }

  if (user && pathname === "/login") {
    const requestedNext = request.nextUrl.searchParams.get("next");
    const destination =
      requestedNext?.startsWith("/") && !requestedNext.startsWith("//")
        ? requestedNext
        : "/";
    return redirectWithCookies(new URL(destination, request.url), response);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
