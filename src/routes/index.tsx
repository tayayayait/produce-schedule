import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAps } from "@/lib/aps/store";
import {
  PRIORITY_META,
  PROCESSES,
  ROLE_META,
  equipmentOf,
  fmt,
  fmtDur,
  productOf,
} from "@/lib/aps/data";
import { Kpi, PageHead, Panel, Pill, biTone, otdTone, tardTone } from "@/components/aps/ui";
import { Gantt } from "@/components/aps/Gantt";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Cpu,
  Flame,
  Layers,
  Play,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

function DashboardPage() {
  const {
    current,
    currentKpi,
    orders,
    downs,
    equipments,
    products,
    role,
    nowMin,
    freezeMin,
    busy,
    runOptimize,
    rescheduleNow,
    updateTaskStatus,
  } = useAps();

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const perms = ROLE_META[role];

  const selectedTask = useMemo(
    () => current.tasks.find((t) => t.code === selectedCode) ?? null,
    [current.tasks, selectedCode]
  );

  const bottleneckList = useMemo(
    () => [...currentKpi.eqs].sort((a, b) => b.BI - a.BI),
    [currentKpi.eqs]
  );
  const topBottleneck = bottleneckList[0] ?? {
    eq: "SMT-01",
    util: 0,
    BI: 0,
    Q: 0,
    CP: 0,
    level: "NORMAL" as const,
  };
  const topBottleneckEq = equipmentOf(topBottleneck.eq, equipments);
  const bottleneckSet = useMemo(
    () => new Set(currentKpi.eqs.filter((e) => e.level !== "NORMAL").map((e) => e.eq)),
    [currentKpi.eqs]
  );

  const lateResults = useMemo(
    () => currentKpi.orders.filter((r) => r.tardy > 0),
    [currentKpi.orders]
  );

  const riskOrders = useMemo(
    () =>
      [...currentKpi.orders]
        .sort((a, b) => a.due - a.completion - (b.due - b.completion))
        .slice(0, 6),
    [currentKpi.orders]
  );

  const maxTardiness = useMemo(
    () => Math.max(0, ...currentKpi.orders.map((r) => r.tardy)),
    [currentKpi.orders]
  );

  const handleQuickOptimize = async () => {
    if (!perms.canEditPlan) {
      toast.error("권한이 부족합니다. 생산계획 담당자(PLANNER) 또는 관리자(ADMIN) 역할이 필요합니다.");
      return;
    }
    await runOptimize(current.preset);
    toast.success("AI 하이브리드 최적화 완료", {
      description: "납기 지연 및 품목 전환 셋업(SDST) 최소화 스케줄이 생성되었습니다.",
    });
  };

  const handleQuickReschedule = async () => {
    if (!perms.canEditPlan) {
      toast.error("권한이 부족합니다. 생산계획 담당자(PLANNER) 또는 관리자(ADMIN) 역할이 필요합니다.");
      return;
    }
    await rescheduleNow(nowMin, freezeMin, current.preset);
    toast.success("긴급 동적 재스케줄링 완료", {
      description: `동결 구간(${freezeMin}분) 유지 및 고장 설비 우회 재배정이 반영되었습니다.`,
    });
  };

  const procName = (proc: string) => PROCESSES.find((p) => p.code === proc)?.name ?? proc;

  return (
    <div className="space-y-5">
      <PageHead
        title="종합 생산현황 대시보드 (SCR-DASH-01)"
        desc="실시간 주문 납기 준수율(OTD), 8대 설비 가동 부하, 병목 지수(BI) 및 7대 제약 위반·비가동 경보를 통합 관제합니다."
      >
        <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-xs shadow-2xs">
          <span className="text-muted-foreground">활성 계획 버전:</span>
          <span className="font-semibold text-foreground">{current.label}</span>
          <Pill tone={current.status === "CONFIRMED" ? "success" : "primary"}>{current.status}</Pill>
        </div>

        <button
          onClick={handleQuickOptimize}
          disabled={!perms.canEditPlan || busy}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-semibold text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {busy ? "최적화 연산중..." : "AI 최적화 실행"}
        </button>

        <Link
          to="/schedules"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-card px-3.5 text-xs font-semibold text-foreground hover:bg-muted"
        >
          간트 워크스페이스
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </PageHead>

      {/* Row 1: 6 Core KPI Cards */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="납기 준수율 (OTD)"
          value={currentKpi.otd.toFixed(1)}
          unit="%"
          tone={otdTone(currentKpi.otd)}
          sub={
            <span>
              정시 <b>{orders.filter((o) => o.status !== "CANCELLED").length - currentKpi.lateOrders}</b>건 · 지연{" "}
              <b className={currentKpi.lateOrders > 0 ? "text-destructive" : ""}>{currentKpi.lateOrders}</b>건 (목표 ≥95%)
            </span>
          }
        />
        <Kpi
          label="진행 / 전체 생산 주문"
          value={`${orders.filter((o) => o.status !== "CANCELLED").length}`}
          unit={`건 (${current.tasks.length}작업)`}
          tone="primary"
          sub={
            <span>
              1등급 긴급 <b className="text-destructive">{orders.filter((o) => o.priority === "P1_URGENT").length}</b>건 · 2등급 높음{" "}
              <b>{orders.filter((o) => o.priority === "P2_HIGH").length}</b>건
            </span>
          }
        />
        <Kpi
          label="평균 설비 가동률"
          value={currentKpi.util.toFixed(1)}
          unit="%"
          tone={currentKpi.util >= 65 && currentKpi.util <= 88 ? "success" : "warning"}
          sub={
            <span>
              셋업 손실률 <b>{currentKpi.setupLoss.toFixed(1)}%</b> · 총 완료 <b>{fmtDur(currentKpi.makespan)}</b>
            </span>
          }
        />
        <Kpi
          label="최우선 병목 설비 (BI)"
          value={topBottleneck.eq}
          unit={`BI ${topBottleneck.BI.toFixed(1)}`}
          tone={biTone(topBottleneck.level)}
          sub={
            <span>
              {procName(topBottleneckEq.proc)} · 가동률 <b>{topBottleneck.util.toFixed(1)}%</b>
            </span>
          }
        />
        <Kpi
          label="총 예상 납기 지연시간"
          value={currentKpi.tardiness === 0 ? "0분" : fmtDur(currentKpi.tardiness)}
          tone={tardTone(currentKpi.tardiness)}
          sub={
            <span>
              최대 단일 주문 지연 <b>{fmtDur(maxTardiness)}</b>
            </span>
          }
        />
        <Kpi
          label="생산계획 달성률 (PAR)"
          value={currentKpi.planAttainment.toFixed(1)}
          unit="%"
          tone={currentKpi.planAttainment >= 95 ? "success" : "warning"}
          sub={
            <span>
              목적함수 Z = <b className="num">{currentKpi.Z.toLocaleString()}</b>
            </span>
          }
        />
      </div>

      {/* Row 2: Left 8 cols (Equipment Status + Gantt), Right 4 cols (Real-time Alert Feed) */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          <Panel
            title={
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-primary" />
                <span>8대 생산설비 실시간 운전 상태 및 병목 지수 요약</span>
              </div>
            }
            action={
              <Link to="/equipments" className="text-xs font-medium text-primary hover:underline">
                설비 마스터 및 고장 제어 →
              </Link>
            }
          >
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {equipments.map((eq) => {
                const stat = currentKpi.eqs.find((x) => x.eq === eq.code);
                const hasDown = downs.some((d) => d.eq === eq.code && !d.resolved);
                const stLabel = hasDown ? "DOWN" : eq.status ?? "RUN";
                const stTone =
                  stLabel === "DOWN"
                    ? "danger"
                    : stLabel === "PM"
                    ? "warning"
                    : stLabel === "RUN"
                    ? "success"
                    : "muted";

                return (
                  <div
                    key={eq.code}
                    className="flex flex-col justify-between rounded-md border bg-background/60 p-2.5 transition-colors hover:border-primary/40"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="num text-xs font-bold text-foreground">{eq.code}</span>
                      <Pill tone={stTone}>{stLabel}</Pill>
                    </div>
                    <div className="mt-1 truncate text-[11px] text-muted-foreground">{eq.name}</div>
                    <div className="mt-2 flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">가동률 / BI</span>
                      <span className="num font-semibold">
                        {(stat?.util ?? 0).toFixed(1)}% ·{" "}
                        <span className={stat?.level === "CRITICAL" ? "text-destructive" : ""}>
                          BI {(stat?.BI ?? 0).toFixed(1)}
                        </span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full ${
                          stLabel === "DOWN"
                            ? "bg-destructive"
                            : (stat?.util ?? 0) >= 85
                            ? "bg-warning"
                            : "bg-primary"
                        }`}
                        style={{ width: `${Math.min(100, stat?.util ?? 0)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel
            title={
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" />
                <span>실시간 생산 스케줄 간트 타임라인 (설비 중심 뷰)</span>
              </div>
            }
            action={
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">작업 블록을 클릭하면 하단에 상세 제어가 표시됩니다</span>
                <Link
                  to="/schedules"
                  className="inline-flex items-center gap-1 rounded border bg-muted/60 px-2 py-1 text-xs font-medium hover:bg-muted"
                >
                  전체 화면 편집
                </Link>
              </div>
            }
          >
            <Gantt
              tasks={current.tasks}
              downs={downs}
              conflicts={currentKpi.conflicts}
              orders={orders}
              equipments={equipments}
              products={products}
              selected={selectedCode}
              onSelect={setSelectedCode}
              nowMin={nowMin}
              freezeMin={freezeMin}
              highlightBottleneck
              bottleneckEqs={bottleneckSet}
            />

            {selectedTask && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 px-3.5 py-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-3">
                  <Pill tone="primary">{selectedTask.code}</Pill>
                  <span className="font-semibold">
                    {procName(selectedTask.proc)} ({selectedTask.eq})
                  </span>
                  <span className="text-muted-foreground">
                    주문 <b className="num text-foreground">{selectedTask.orderNo}</b> · 수량{" "}
                    <b className="num text-foreground">{selectedTask.qty}</b> EA · 셋업{" "}
                    <b className="num text-foreground">{selectedTask.setup}</b>분
                  </span>
                  <span className="num text-muted-foreground">
                    {fmt(selectedTask.start - selectedTask.setup)} → {fmt(selectedTask.end)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">현장 상태 전환:</span>
                  {(["WAITING", "RUNNING", "COMPLETED"] as const).map((st) => (
                    <button
                      key={st}
                      onClick={() => {
                        updateTaskStatus(selectedTask.code, st);
                        toast.success(`${selectedTask.code} 상태 → ${st}`);
                      }}
                      className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                        (selectedTask.taskStatus ?? "WAITING") === st
                          ? "bg-primary text-primary-foreground"
                          : "border bg-card hover:bg-muted"
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Panel>
        </div>

        {/* Right 4 cols: Real-time Alert & Exception Center */}
        <div className="space-y-4 xl:col-span-4">
          <Panel
            title={
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-destructive" />
                <span>실시간 일정 지연 · 설비 충돌 경보 센터</span>
              </div>
            }
            action={
              <Pill
                tone={
                  currentKpi.violations.length > 0 || lateResults.length > 0 ? "danger" : "success"
                }
              >
                경보 {currentKpi.violations.length + downs.length + lateResults.length}건
              </Pill>
            }
          >
            <div className="max-h-[560px] space-y-2.5 overflow-y-auto pr-1">
              {currentKpi.violations.length === 0 && downs.length === 0 && lateResults.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-10 text-center">
                  <CheckCircle2 className="h-8 w-8 text-success" />
                  <p className="mt-2 text-xs font-semibold text-foreground">
                    모든 제약조건(HC-001~007) 및 납기 정상
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    현재 활성 스케줄에 설비 충돌이나 납기 지연 주문이 없습니다.
                  </p>
                </div>
              )}

              {/* Hard Constraint Violations */}
              {currentKpi.violations.map((v, i) => (
                <div
                  key={`v-${i}`}
                  className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 font-bold text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      [{v.hcCode}] 제약조건 위반 ({v.severity})
                    </span>
                    <Pill tone="danger">{v.eq}</Pill>
                  </div>
                  <p className="mt-1 text-foreground/90">{v.message}</p>
                  <div className="mt-2 flex justify-end">
                    <button
                      onClick={handleQuickReschedule}
                      className="inline-flex items-center gap-1 rounded bg-destructive px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-destructive/90"
                    >
                      <RefreshCw className="h-3 w-3" />
                      즉시 긴급 재스케줄링
                    </button>
                  </div>
                </div>
              ))}

              {/* Active Equipment Downtimes */}
              {downs.map((d) => (
                <div
                  key={d.id}
                  className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 font-bold text-warning">
                      <Wrench className="h-3.5 w-3.5" />
                      설비 비가동 이벤트: {d.eq}
                    </span>
                    <Pill tone="warning">{d.type}</Pill>
                  </div>
                  <p className="mt-1 text-foreground/90">{d.reason}</p>
                  <p className="mt-0.5 num text-[11px] text-muted-foreground">
                    구간: {fmt(d.start)} ~ {fmt(d.end)} ({fmtDur(d.end - d.start)})
                  </p>
                  <div className="mt-2 flex justify-end gap-1.5">
                    <Link
                      to="/equipments"
                      className="rounded border bg-card px-2 py-1 text-[11px] font-medium hover:bg-muted"
                    >
                      비가동 관리
                    </Link>
                    <button
                      onClick={handleQuickReschedule}
                      className="inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90"
                    >
                      <Play className="h-3 w-3" />
                      우회 재스케줄링
                    </button>
                  </div>
                </div>
              ))}

              {/* Late Order Warnings */}
              {lateResults.map((r) => {
                const ord = orders.find((o) => o.no === r.no);
                const prod = ord ? productOf(ord.product, products) : null;
                return (
                  <div
                    key={r.no}
                    className="rounded-md border border-destructive/30 bg-card p-3 text-xs shadow-2xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 font-bold text-destructive">
                        <Clock className="h-3.5 w-3.5" />
                        납기 지연: {r.no}
                      </span>
                      {ord && <Pill tone="danger">{PRIORITY_META[ord.priority].label}</Pill>}
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      고객사 <b className="text-foreground">{ord?.customer}</b> · 품목{" "}
                      <b className="text-foreground">{prod?.name}</b>
                    </p>
                    <div className="mt-1 flex items-center justify-between num text-[11px]">
                      <span>납기: {fmt(r.due)}</span>
                      <span className="font-bold text-destructive">
                        완료: {fmt(r.completion)} (+{fmtDur(r.tardy)} 지연)
                      </span>
                    </div>
                    <div className="mt-2 flex justify-end">
                      <button
                        onClick={handleQuickOptimize}
                        className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/20"
                      >
                        <Sparkles className="h-3 w-3" />
                        납기 준수 최적화 실행
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Bottleneck Warnings */}
              {bottleneckList
                .filter((b) => b.level !== "NORMAL")
                .map((b) => {
                  const eq = equipmentOf(b.eq, equipments);
                  return (
                    <div key={b.eq} className="rounded-md border bg-muted/40 p-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1 font-semibold">
                          <Flame className="h-3.5 w-3.5 text-warning" />
                          병목 주의: {b.eq} ({procName(eq.proc)})
                        </span>
                        <Pill tone={biTone(b.level)}>
                          {b.level} · BI {b.BI.toFixed(1)}
                        </Pill>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        가동률 <b className="num text-foreground">{b.util.toFixed(1)}%</b> (가공 {b.run}분 / 셋업 {b.setup}분)
                      </p>
                    </div>
                  );
                })}
            </div>
          </Panel>
        </div>
      </div>

      {/* Row 3: Left 6 cols (Equipment Utilization & BI), Right 6 cols (Top Risk Orders Table) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Panel
          className="lg:col-span-6"
          title="설비별 가동률 분해 및 병목 지수(BI) 분석 (85% 임계선 기준)"
          action={
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-xs bg-primary" /> 본가공(RUN)
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-xs bg-warning" /> 셋업(SDST)
              </span>
            </div>
          }
        >
          <div className="space-y-3">
            {currentKpi.eqs.map((u) => {
              const eq = equipmentOf(u.eq, equipments);
              const avail = Math.max(1, u.avail);
              const runPct = Math.min(100, Math.round((u.run / avail) * 1000) / 10);
              const setupPct = Math.min(100 - runPct, Math.round((u.setup / avail) * 1000) / 10);

              return (
                <div key={u.eq} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="num w-14 font-bold">{u.eq}</span>
                      <span className="text-muted-foreground">{procName(eq.proc)}</span>
                      <Pill tone={biTone(u.level)}>BI {u.BI.toFixed(1)}</Pill>
                    </div>
                    <div className="num flex items-center gap-3 text-[11px]">
                      <span className="text-muted-foreground">
                        가공 {u.run}m · 셋업 {u.setup}m
                      </span>
                      <span className="w-12 text-right font-bold">{u.util.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="relative h-3.5 w-full overflow-hidden rounded-sm bg-muted">
                    <div
                      className="absolute top-0 bottom-0 z-10 w-0.5 bg-destructive/80"
                      style={{ left: "85%" }}
                      title="병목 임계선 (85%)"
                    />
                    <div className="flex h-full w-full">
                      <div className="h-full bg-primary transition-all" style={{ width: `${runPct}%` }} />
                      <div className="h-full bg-warning transition-all" style={{ width: `${setupPct}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel
          className="lg:col-span-6"
          title="납기 지연 및 위험 주문 우선 관리 목록 (Top 6)"
          action={
            <Link to="/orders" className="text-xs font-medium text-primary hover:underline">
              전체 주문 관리 ({orders.length}건) →
            </Link>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b text-[11px] text-muted-foreground">
                  <th className="pb-2 font-medium">주문번호 / 고객사</th>
                  <th className="pb-2 font-medium">품목</th>
                  <th className="pb-2 font-medium">우선순위</th>
                  <th className="pb-2 font-medium">납기일시</th>
                  <th className="pb-2 font-medium">예상완료</th>
                  <th className="pb-2 text-right font-medium">여유 / 지연</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {riskOrders.map((r) => {
                  const ord = orders.find((o) => o.no === r.no);
                  if (!ord) return null;
                  const prod = productOf(ord.product, products);
                  const slack = r.due - r.completion;
                  return (
                    <tr key={ord.no} className="hover:bg-muted/40">
                      <td className="py-2.5">
                        <div className="num font-semibold text-foreground">{ord.no}</div>
                        <div className="text-[11px] text-muted-foreground">{ord.customer}</div>
                      </td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
                            {prod.family}
                          </span>
                          <span className="font-medium">{prod.name}</span>
                        </div>
                        <div className="num text-[11px] text-muted-foreground">주문 {ord.qty.toLocaleString()} EA</div>
                      </td>
                      <td className="py-2.5">
                        <Pill tone={ord.priority === "P1_URGENT" ? "danger" : ord.priority === "P2_HIGH" ? "warning" : "muted"}>
                          {PRIORITY_META[ord.priority].label}
                        </Pill>
                      </td>
                      <td className="num py-2.5 text-muted-foreground">{fmt(r.due)}</td>
                      <td className="num py-2.5 font-medium">{fmt(r.completion)}</td>
                      <td className="num py-2.5 text-right">
                        {r.tardy > 0 ? (
                          <Pill tone="danger">+{fmtDur(r.tardy)} 지연</Pill>
                        ) : (
                          <Pill tone={slack < 180 ? "warning" : "success"}>
                            {fmtDur(Math.max(0, slack))} 여유
                          </Pill>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
