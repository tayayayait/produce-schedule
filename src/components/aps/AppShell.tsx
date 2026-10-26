import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  AlertTriangle, Bell, CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList,
  Cpu, Factory, GitCompareArrows, LayoutDashboard, ListOrdered, Moon, Shield, Sun, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useAps, SCENARIOS, type ScenarioId } from "@/lib/aps/store";
import { ROLE_META, fmt, type Role } from "@/lib/aps/data";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Pill } from "./ui";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "종합 대시보드", id: "SCR-DASH-01", icon: LayoutDashboard },
  { to: "/orders", label: "생산 주문 관리", id: "SCR-ORD-01", icon: ListOrdered },
  { to: "/plans", label: "생산계획·작업지시", id: "SCR-PLAN-01", icon: ClipboardList },
  { to: "/schedules", label: "스케줄링 간트", id: "SCR-SCHED-01", icon: CalendarRange },
  { to: "/simulation", label: "전후 비교·시뮬레이션", id: "SCR-SIM-01", icon: GitCompareArrows },
  { to: "/equipments", label: "설비·공정 마스터", id: "SCR-EQP-01", icon: Cpu },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [collapsed, setCollapsed] = useState(false);
  const {
    scenario, role, theme, nowMin, freezeMin, current, currentKpi, busy, isDirty,
    loadScenario, setRole, toggleTheme, rescheduleNow, runOptimize,
  } = useAps();

  if (path === "/login") {
    return <>{children}</>;
  }

  const criticalEqs = currentKpi.eqs.filter((e) => e.level === "CRITICAL");
  const alertCount = currentKpi.conflicts.length + currentKpi.lateOrders + criticalEqs.length;

  const handleScenarioChange = (v: ScenarioId) => {
    loadScenario(v);
    toast.success(`데모 시나리오 [${SCENARIOS[v].title}] 로드 완료`, {
      description: SCENARIOS[v].desc,
    });
  };

  const handleQuickReschedule = async () => {
    await rescheduleNow(nowMin, freezeMin, "BALANCED");
    toast.success("긴급 동적 재스케줄링 완료", {
      description: `동결 구간(${freezeMin}분) 보호 및 고장 충돌 작업 재배정이 완료되었습니다.`,
    });
  };

  const statusTone =
    current.status === "CONFIRMED"
      ? "success"
      : current.status === "REVIEW"
        ? "warning"
        : current.status === "CANCELLED"
          ? "danger"
          : "primary";

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200 md:flex",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-3.5">
          <Link to="/" className="flex items-center gap-2.5 overflow-hidden">
            <div className="grid size-8 shrink-0 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
              <Factory className="size-4" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="truncate text-sm font-bold tracking-tight text-sidebar-accent-foreground">E-APS</div>
                <div className="truncate text-[11px] opacity-70">전자 생산계획·스케줄링</div>
              </div>
            )}
          </Link>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="rounded p-1 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
            title={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
          >
            {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-2.5" aria-label="주 메뉴">
          {NAV.map((n) => {
            const active = n.to === "/" ? path === "/" : path.startsWith(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                title={`${n.label} (${n.id})`}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-xs"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  collapsed && "justify-center px-2",
                )}
              >
                <n.icon className={cn("size-4 shrink-0", active && "text-sidebar-primary")} />
                {!collapsed && <span className="truncate">{n.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-3 text-[11px] leading-relaxed">
          {!collapsed ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 font-medium text-sidebar-accent-foreground">
                <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>APS Hybrid Solver Ready</span>
              </div>
              <div className="opacity-70">
                기준 시각: <span className="num font-semibold">{fmt(nowMin)} KST</span>
              </div>
              <div className="opacity-70">
                동결 구간: <span className="num font-semibold">{freezeMin}분</span>
              </div>
              <Link
                to="/login"
                className="mt-1 inline-flex w-full items-center justify-center rounded border border-sidebar-border bg-sidebar-accent/50 px-2 py-1 text-[11px] font-medium text-sidebar-accent-foreground hover:bg-sidebar-accent"
              >
                로그인 / 역할 안내 화면
              </Link>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2" title="APS Hybrid Solver Ready">
              <span className="size-2 rounded-full bg-emerald-400" />
            </div>
          )}
        </div>
      </aside>

      {/* Main Workspace */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Header (56px) */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2.5 border-b bg-card/95 px-4 backdrop-blur md:px-6">
          {/* Mobile quick nav */}
          <div className="flex gap-1 md:hidden">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} className="rounded p-1.5 text-muted-foreground hover:bg-muted" aria-label={n.label}>
                <n.icon className="size-4" />
              </Link>
            ))}
          </div>

          <div className="hidden min-w-0 items-center gap-2 text-xs lg:flex">
            <Pill tone="primary">평택 전자1공장 SMT/PBA</Pill>
            <span className="text-muted-foreground">활성 버전:</span>
            <span className="num font-bold text-foreground">{current.id}</span>
            <Pill tone={statusTone}>{current.status}</Pill>
            <span className="truncate text-muted-foreground">· {current.label}</span>
            {isDirty && <Pill tone="warning">미저장 변경됨</Pill>}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* Demo Scenario 1-Click Loader */}
            <div className="flex items-center gap-1.5">
              <span className="hidden text-xs font-medium text-muted-foreground xl:inline">시연 시나리오:</span>
              <Select value={scenario} onValueChange={(v) => handleScenarioChange(v as ScenarioId)}>
                <SelectTrigger className="h-8 w-[225px] text-xs font-medium" aria-label="데모 시나리오 로더">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SCENARIOS) as ScenarioId[]).map((k) => (
                    <SelectItem key={k} value={k} className="text-xs">
                      {SCENARIOS[k].title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Role Switcher (RBAC) */}
            <div className="hidden items-center gap-1 sm:flex">
              <Select value={role} onValueChange={(v) => {
                setRole(v as Role);
                toast.info(`사용자 역할 전환: ${ROLE_META[v as Role].label}`);
              }}>
                <SelectTrigger className="h-8 w-[142px] text-xs" aria-label="사용자 역할 전환">
                  <Shield className="mr-1 size-3.5 text-primary" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLE_META) as Role[]).map((r) => (
                    <SelectItem key={r} value={r} className="text-xs">
                      {ROLE_META[r].badge} · {ROLE_META[r].label.split(" ")[0]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Dark/Light Theme Toggle */}
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
              title={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
            >
              {theme === "dark" ? <Sun className="size-4 text-amber-400" /> : <Moon className="size-4" />}
            </Button>

            {/* Real-time Alert Center Popover */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="relative size-8"
                  aria-label={`실시간 알림 ${alertCount}건`}
                >
                  <Bell className="size-4" />
                  {alertCount > 0 && (
                    <span className="num absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                      {alertCount}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-88 p-3">
                <div className="mb-2 flex items-center justify-between border-b pb-2">
                  <span className="text-xs font-bold">실시간 일정 지연 · 충돌 알림 센터</span>
                  <Pill tone={alertCount > 0 ? "danger" : "success"}>{alertCount}건 활성</Pill>
                </div>
                {alertCount === 0 ? (
                  <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                    <CheckCircle2 className="size-4 text-success" />
                    현재 모든 제약조건이 충족되었으며 납기 지연이 없습니다.
                  </div>
                ) : (
                  <div className="space-y-2 text-xs">
                    {currentKpi.conflicts.length > 0 && (
                      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5">
                        <div className="font-semibold text-destructive">
                          [CRITICAL] 제약 조건 충돌 {currentKpi.conflicts.length}건 감지
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          영향 작업: {currentKpi.conflicts.slice(0, 4).join(", ")}
                        </p>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busy}
                          onClick={handleQuickReschedule}
                          className="mt-2 h-7 w-full text-xs"
                        >
                          <Zap className="mr-1 size-3.5" />
                          원클릭 긴급 재스케줄링 실행
                        </Button>
                      </div>
                    )}
                    {currentKpi.lateOrders > 0 && (
                      <div className="rounded-md border border-warning/40 bg-warning/10 p-2.5">
                        <div className="font-semibold text-warning">
                          [HIGH] 납기 지연 예상 주문 {currentKpi.lateOrders}건 (총 {currentKpi.tardiness}분)
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => runOptimize("DUE_DATE_FIRST")}
                          className="mt-1.5 h-7 w-full text-xs"
                        >
                          납기 최우선(DUE_DATE_FIRST) 최적화 실행
                        </Button>
                      </div>
                    )}
                    {criticalEqs.map((e) => (
                      <div key={e.eq} className="rounded-md border bg-muted/50 p-2">
                        <div className="font-medium">
                          [BOTTLENECK] 설비 <span className="num font-bold">{e.eq}</span> 병목 지수 BI {e.BI}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          가동률 {e.util.toFixed(1)}% · 대기율 {e.Q.toFixed(1)}%
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>
        </header>

        {/* Global Critical Conflict Banner (CMP-11 Inline Alert) */}
        {currentKpi.conflicts.length > 0 && (
          <div
            role="alert"
            aria-live="assertive"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-destructive/40 bg-destructive/15 px-4 py-2 text-xs md:px-6"
          >
            <div className="flex items-center gap-2 font-medium text-destructive">
              <AlertTriangle className="size-4 shrink-0" />
              <span>
                <strong>[긴급 일정 충돌 감지]</strong> 설비 비가동 또는 선후행 위반으로 인해{" "}
                <span className="num font-bold">{currentKpi.conflicts.length}개</span> 작업({currentKpi.conflicts.slice(0, 3).join(", ")})에 Hard Constraint 충돌이 발생했습니다.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={handleQuickReschedule}
                className="h-7 text-xs"
              >
                <Zap className="mr-1 size-3.5" />
                {busy ? "재스케줄링 연산 중..." : "원클릭 긴급 재스케줄링 (동결 120분)"}
              </Button>
            </div>
          </div>
        )}

        {/* Main Content */}
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>

        {/* Footer (36px) */}
        <footer className="flex h-9 items-center justify-between border-t bg-card/60 px-4 text-[11px] text-muted-foreground md:px-6">
          <div className="flex items-center gap-3">
            <span>
              계획 기준 시각: <strong className="num text-foreground">2026-10-26 08:00 KST</strong>
            </span>
            <span>·</span>
            <span>
              현재 시뮬레이션 시각: <strong className="num text-foreground">{fmt(nowMin)}</strong>
            </span>
          </div>
          <div className="hidden items-center gap-3 sm:flex">
            <span>단축키: 간트 바 선택 후 ←/→(시간 이동), ↑/↓(설비 이동), P(고정 잠금), Ctrl+Z/Y(실행취소)</span>
            <span>·</span>
            <span className="num">E-APS v1.0.0</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
