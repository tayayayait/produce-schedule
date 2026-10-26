import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
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
import { Gantt } from "@/components/aps/Gantt";
import { PageHead, Panel, Pill } from "@/components/aps/ui";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  GitCompare,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/simulation")({
  component: SimulationPage,
});

function SimulationPage() {
  const {
    versions,
    current,
    role,
    equipments,
    products,
    busy,
    setCurrent,
    runOptimize,
    confirm,
  } = useAps();

  const perms = ROLE_META[role];
  const [beforeId, setBeforeId] = useState<string>(versions[0]?.id ?? current.id);
  const [highlightOrderNo, setHighlightOrderNo] = useState<string | null>(null);

  const before = versions.find((v) => v.id === beforeId) ?? versions[0] ?? current;
  const after = current;

  const procName = (proc: string) => PROCESSES.find((p) => p.code === proc)?.name ?? proc;

  // Deltas
  const dOtd = Math.round((after.kpi.otd - before.kpi.otd) * 10) / 10;
  const dTard = after.kpi.tardiness - before.kpi.tardiness;
  const dMake = after.kpi.makespan - before.kpi.makespan;
  const dUtil = Math.round((after.kpi.util - before.kpi.util) * 10) / 10;
  const dSetup = after.kpi.totalSetup - before.kpi.totalSetup;
  const dObj = Math.round((after.kpi.Z - before.kpi.Z) * 10) / 10;

  const pctChange = (b: number, a: number) => {
    if (b === 0) return a === 0 ? "0%" : "+100%";
    const p = Math.round(((a - b) / b) * 1000) / 10;
    return `${p > 0 ? "+" : ""}${p}%`;
  };

  const handleAdoptCandidate = () => {
    if (!perms.canEditPlan) {
      toast.error("권한이 부족합니다. 생산계획 담당자(PLANNER) 또는 관리자(ADMIN) 역할이 필요합니다.");
      return;
    }
    confirm(after.id);
    toast.success(`Candidate 버전(${after.label})이 공식 확정 계획(CONFIRMED)으로 채택되었습니다.`);
  };

  const beforeMaxTardy = Math.max(0, ...before.kpi.orders.map((o) => o.tardy));
  const afterMaxTardy = Math.max(0, ...after.kpi.orders.map((o) => o.tardy));
  const beforeTopBi = [...before.kpi.eqs].sort((a, b) => b.BI - a.BI)[0]?.BI ?? 0;
  const afterTopBi = [...after.kpi.eqs].sort((a, b) => b.BI - a.BI)[0]?.BI ?? 0;

  return (
    <div className="space-y-5">
      <PageHead
        title="최적화 전후 성능 비교 및 시나리오 시뮬레이션 (SCR-SIM-01)"
        desc="초기 규칙 기반 스케줄(Baseline)과 2-Phase 하이브리드 최적화 스케줄(Candidate)의 6대 핵심 KPI 변화량(Δ) 및 간트 배치 차이를 정밀 검증합니다."
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-xs">
            <span className="font-semibold text-muted-foreground">Baseline(Before):</span>
            <select
              value={before.id}
              onChange={(e) => setBeforeId(e.target.value)}
              className="bg-transparent font-bold text-foreground focus:outline-hidden"
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} (OTD {v.kpi.otd.toFixed(1)}%)
                </option>
              ))}
            </select>
          </div>

          <ArrowRight className="h-4 w-4 text-muted-foreground" />

          <div className="flex items-center gap-1.5 rounded-md border border-primary/50 bg-primary/5 px-2.5 py-1 text-xs">
            <span className="font-semibold text-primary">Candidate(After):</span>
            <select
              value={after.id}
              onChange={(e) => setCurrent(e.target.value)}
              className="bg-transparent font-bold text-foreground focus:outline-hidden"
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} (OTD {v.kpi.otd.toFixed(1)}%)
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={async () => {
              await runOptimize(after.preset);
              toast.success("신규 후보 최적화 버전이 생성되었습니다.");
            }}
            disabled={!perms.canEditPlan || busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-card px-3 text-xs font-semibold hover:bg-muted disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            {busy ? "연산중..." : "새 후보 최적화 생성"}
          </button>

          <button
            onClick={handleAdoptCandidate}
            disabled={!perms.canEditPlan || after.status === "CONFIRMED"}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-success px-3.5 text-xs font-semibold text-white shadow-xs hover:bg-success/90 disabled:opacity-50"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {after.status === "CONFIRMED" ? "채택 완료됨" : "Candidate 확정 채택"}
          </button>
        </div>
      </PageHead>

      {/* Row 1: 6 KPI Delta Cards */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <DeltaCard
          label="납기 준수율 (OTD)"
          beforeVal={`${before.kpi.otd.toFixed(1)}%`}
          afterVal={`${after.kpi.otd.toFixed(1)}%`}
          deltaText={`${dOtd >= 0 ? "+" : ""}${dOtd.toFixed(1)}%p`}
          improved={dOtd >= 0}
          sub={`지연 주문 ${before.kpi.lateOrders}건 → ${after.kpi.lateOrders}건`}
        />

        <DeltaCard
          label="총 납기 지연시간"
          beforeVal={fmtDur(before.kpi.tardiness)}
          afterVal={fmtDur(after.kpi.tardiness)}
          deltaText={`${dTard <= 0 ? "" : "+"}${dTard}분 (${pctChange(before.kpi.tardiness, after.kpi.tardiness)})`}
          improved={dTard <= 0}
          sub={`최대 지연 ${fmtDur(beforeMaxTardy)} → ${fmtDur(afterMaxTardy)}`}
        />

        <DeltaCard
          label="총 완료시간 (Makespan)"
          beforeVal={fmtDur(before.kpi.makespan)}
          afterVal={fmtDur(after.kpi.makespan)}
          deltaText={`${dMake <= 0 ? "" : "+"}${dMake}분 (${pctChange(before.kpi.makespan, after.kpi.makespan)})`}
          improved={dMake <= 0}
          sub={`종료시각 ${fmt(before.kpi.makespan)} → ${fmt(after.kpi.makespan)}`}
        />

        <DeltaCard
          label="평균 설비 가동률"
          beforeVal={`${before.kpi.util.toFixed(1)}%`}
          afterVal={`${after.kpi.util.toFixed(1)}%`}
          deltaText={`${dUtil >= 0 ? "+" : ""}${dUtil.toFixed(1)}%p`}
          improved={dUtil >= 0}
          sub={`최대 병목 BI ${beforeTopBi.toFixed(1)} → ${afterTopBi.toFixed(1)}`}
        />

        <DeltaCard
          label="총 품목전환 셋업(SDST)"
          beforeVal={`${before.kpi.totalSetup}분`}
          afterVal={`${after.kpi.totalSetup}분`}
          deltaText={`${dSetup <= 0 ? "" : "+"}${dSetup}분 (${pctChange(before.kpi.totalSetup, after.kpi.totalSetup)})`}
          improved={dSetup <= 0}
          sub={`셋업 손실률 ${before.kpi.setupLoss.toFixed(1)}% → ${after.kpi.setupLoss.toFixed(1)}%`}
        />

        <DeltaCard
          label="목적함수 종합 비용 (Z)"
          beforeVal={before.kpi.Z.toLocaleString()}
          afterVal={after.kpi.Z.toLocaleString()}
          deltaText={pctChange(before.kpi.Z, after.kpi.Z)}
          improved={dObj <= 0}
          sub={`부하편차 ${before.kpi.loadImbalance}m → ${after.kpi.loadImbalance}m`}
        />
      </div>

      {/* Row 2: Synchronized Split Gantt Comparison */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title={
            <div className="flex items-center gap-2">
              <Pill tone="muted">BEFORE (Baseline)</Pill>
              <span>{before.label}</span>
            </div>
          }
          action={
            <span className="num text-xs text-muted-foreground">
              OTD {before.kpi.otd.toFixed(1)}% · 지연 {fmtDur(before.kpi.tardiness)} · 셋업 {before.kpi.totalSetup}분
            </span>
          }
        >
          <Gantt
            tasks={before.tasks}
            downs={before.downs}
            conflicts={before.kpi.conflicts}
            orders={before.orders}
            equipments={equipments}
            products={products}
            highlightOrder={highlightOrderNo}
            compact
            showDependencies={false}
          />
        </Panel>

        <Panel
          title={
            <div className="flex items-center gap-2">
              <Pill tone="primary">AFTER (Candidate)</Pill>
              <span>{after.label}</span>
            </div>
          }
          action={
            <span className="num text-xs font-semibold text-primary">
              OTD {after.kpi.otd.toFixed(1)}% · 지연 {fmtDur(after.kpi.tardiness)} · 셋업 {after.kpi.totalSetup}분
            </span>
          }
        >
          <Gantt
            tasks={after.tasks}
            downs={after.downs}
            conflicts={after.kpi.conflicts}
            orders={after.orders}
            equipments={equipments}
            products={products}
            highlightOrder={highlightOrderNo}
            compact
            showDependencies={false}
          />
        </Panel>
      </div>

      {/* Row 3: Order-by-Order Tardiness Comparison + Equipment Load Balancing Comparison */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Panel
          className="lg:col-span-7"
          title={
            <div className="flex items-center gap-2">
              <GitCompare className="h-4 w-4 text-primary" />
              <span>주문별 완료시각 및 납기 지연 개선 비교 (행 클릭 시 상단 간트 동시 하이라이트)</span>
            </div>
          }
          action={
            highlightOrderNo && (
              <button
                onClick={() => setHighlightOrderNo(null)}
                className="text-xs font-medium text-primary hover:underline"
              >
                주문 하이라이트 해제
              </button>
            )
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b bg-muted/40 text-[11px] font-semibold text-muted-foreground">
                  <th className="p-2">주문번호 / 고객사</th>
                  <th className="p-2">우선순위</th>
                  <th className="p-2">납기일시</th>
                  <th className="p-2">Before 완료 (지연)</th>
                  <th className="p-2">After 완료 (지연)</th>
                  <th className="p-2 text-right">단축 / 개선 효과</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {after.orders
                  .filter((o) => o.status !== "CANCELLED")
                  .map((ord) => {
                    const prod = productOf(ord.product, products);
                    const bMetric = before.kpi.orders.find((m) => m.no === ord.no);
                    const aMetric = after.kpi.orders.find((m) => m.no === ord.no);
                    const diffEnd = (aMetric?.completion ?? 0) - (bMetric?.completion ?? 0);
                    const isHighlighted = highlightOrderNo === ord.no;

                    return (
                      <tr
                        key={ord.no}
                        onClick={() => setHighlightOrderNo(isHighlighted ? null : ord.no)}
                        className={`cursor-pointer transition-colors ${
                          isHighlighted ? "bg-primary/10 font-semibold" : "hover:bg-muted/40"
                        }`}
                      >
                        <td className="p-2">
                          <div className="num font-bold">{ord.no}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {ord.customer} · {prod.name}
                          </div>
                        </td>
                        <td className="p-2">
                          <Pill
                            tone={
                              ord.priority === "P1_URGENT"
                                ? "danger"
                                : ord.priority === "P2_HIGH"
                                ? "warning"
                                : "muted"
                            }
                          >
                            {PRIORITY_META[ord.priority].label}
                          </Pill>
                        </td>
                        <td className="num p-2 text-muted-foreground">{fmt(ord.due)}</td>
                        <td className="num p-2">
                          <div>{bMetric ? fmt(bMetric.completion) : "-"}</div>
                          {bMetric && bMetric.tardy > 0 ? (
                            <span className="text-[11px] text-destructive">+{bMetric.tardy}m 지연</span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">정시</span>
                          )}
                        </td>
                        <td className="num p-2">
                          <div className="font-semibold">{aMetric ? fmt(aMetric.completion) : "-"}</div>
                          {aMetric && aMetric.tardy > 0 ? (
                            <span className="text-[11px] font-bold text-destructive">
                              +{aMetric.tardy}m 지연
                            </span>
                          ) : (
                            <span className="text-[11px] font-semibold text-success">정시 준수</span>
                          )}
                        </td>
                        <td className="num p-2 text-right">
                          {diffEnd < 0 ? (
                            <Pill tone="success">{Math.abs(diffEnd)}분 단축</Pill>
                          ) : diffEnd === 0 ? (
                            <Pill tone="muted">동일</Pill>
                          ) : (
                            <Pill tone="warning">+{diffEnd}분 이동</Pill>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          className="lg:col-span-5"
          title="설비별 가동률 및 셋업시간 전후 비교 (Load Balancing 효과)"
        >
          <div className="space-y-3">
            {after.kpi.eqs.map((aEq) => {
              const eq = equipmentOf(aEq.eq, equipments);
              const bEq = before.kpi.eqs.find((u) => u.eq === aEq.eq);
              const bUtil = bEq?.util ?? 0;
              const aUtil = aEq.util;
              const setupDiff = aEq.setup - (bEq?.setup ?? 0);

              return (
                <div key={aEq.eq} className="rounded-md border bg-background/50 p-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="num font-bold">{aEq.eq}</span>{" "}
                      <span className="text-muted-foreground">({procName(eq.proc)})</span>
                    </div>
                    <div className="num flex items-center gap-2 text-[11px]">
                      <span className="text-muted-foreground">
                        셋업: {bEq?.setup ?? 0}m → <b>{aEq.setup}m</b> (
                        {setupDiff <= 0 ? `${setupDiff}m` : `+${setupDiff}m`})
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="w-12 text-muted-foreground">Before</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-muted-foreground/60"
                          style={{ width: `${Math.min(100, bUtil)}%` }}
                        />
                      </div>
                      <span className="num w-10 text-right">{bUtil.toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="w-12 font-semibold text-primary">After</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-primary" style={{ width: `${Math.min(100, aUtil)}%` }} />
                      </div>
                      <span className="num w-10 text-right font-bold text-primary">
                        {aUtil.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function DeltaCard({
  label,
  beforeVal,
  afterVal,
  deltaText,
  improved,
  sub,
}: {
  label: string;
  beforeVal: string;
  afterVal: string;
  deltaText: string;
  improved: boolean;
  sub: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-3.5 shadow-card">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span
          className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-bold ${
            improved ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
          }`}
        >
          {improved ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {deltaText}
        </span>
      </div>
      <div className="num mt-2 flex items-baseline gap-2">
        <span className="text-xs text-muted-foreground line-through">{beforeVal}</span>
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
        <span className="text-xl font-bold text-foreground">{afterVal}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
        <CheckCircle2 className="h-3 w-3 shrink-0 text-success" />
        <span className="truncate">{sub}</span>
      </div>
    </div>
  );
}
