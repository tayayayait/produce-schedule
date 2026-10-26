import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import appCss from "../styles.css?url";
import { ApsProvider } from "../lib/aps/store";
import { AppShell } from "../components/aps/AppShell";
import { Toaster } from "../components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="num text-7xl font-bold text-primary">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">요청하신 화면을 찾을 수 없습니다</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          존재하지 않거나 이동된 페이지입니다. 종합 생산현황 대시보드로 이동해 주세요.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            대시보드로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          화면을 불러오는 중 일시적인 오류가 발생했습니다
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          다시 시도하거나 종합 생산현황 대시보드로 돌아가 작업을 계속하실 수 있습니다.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            다시 시도
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            대시보드 홈
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "E-APS | 전자 생산계획 및 스케줄링 최적화 시스템" },
      {
        name: "description",
        content: "전자 제조업(PCB/SMT) 생산계획 관리 및 2-Phase 하이브리드 스케줄링 최적화 플랫폼",
      },
      { name: "author", content: "E-APS Smart Factory System" },
      { property: "og:title", content: "E-APS | 전자 생산계획 및 스케줄링 최적화 시스템" },
      {
        property: "og:description",
        content: "전자 제조업(PCB/SMT) 생산계획 관리 및 2-Phase 하이브리드 스케줄링 최적화 플랫폼",
      },
      { property: "og:type", content: "website" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "alternate icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <ApsProvider>
        <AppShell>
          <Outlet />
        </AppShell>
        <Toaster position="top-right" richColors />
      </ApsProvider>
    </QueryClientProvider>
  );
}
