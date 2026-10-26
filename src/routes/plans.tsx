import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAps } from "@/lib/aps/store";
import {
  PRIORITY_META,
  PROCESSES,
  ROLE_META,
  calcTargetInputQty,
  fmt,
  productOf,
  type ProcCode,
  type TaskStatus,
} from "@/lib/aps/data";
import { PageHead, Panel, Pill } from "@/components/aps/ui";
import {
  CheckCircle2,
  ClipboardList,
  FolderTree,
  Lock,
  Play,
  PlusCircle,
  ShieldCheck,
  Unlock,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/plans")({
  component: PlansPage,
});

const TASK_STATUS_META: Record<
  TaskStatus,
  { label: string; tone: "muted" | "warning" | "primary" | "success" | "danger" }
> = {
  WAITING: { label: "대기(WAITING)", tone: "muted" },
  SETUP: { label: "셋업중(SETUP)", tone: "warning" },
  RUNNING: { label: "가공중(RUNNING)", tone: "primary" },
  PAUSED: { label: "일시정지(PAUSED)", tone: "danger" },
  COMPLETED: { label: "완료(COMPLETED)", tone: "success" },
  ABORTED: { label: "중단(ABORTED)", tone: "danger" },
};

function PlansPage() {
  const {
    versions,
    current,
    currentKpi,
    orders,
    role,
    products,
    setCurrent,
    generatePlanFromOrders,
    confirm,
    cancelVersion,
    togglePinTask,
    updateTaskStatus,
  } = useAps();

  const perms = ROLE_META[role];

  const [selectedOrderNo, setSelectedOrderNo] = useState<string | "ALL">("ALL");
  const [selectedLot, setSelectedLot] = useState<number | "ALL">("ALL");
  const [procFilter, setProcFilter] = useState<ProcCode | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "ALL">("ALL");

  const procName = (proc: ProcCode) => PROCESSES.find((p) => p.code === proc)?.name ?? proc;

  // Group tasks by order and lot
  const orderTree = useMemo(() => {
    return orders
      .filter((o) => o.status !== "CANCELLED")
      .map((ord) => {
        const prod = productOf(ord.product, products);
        const ordTasks = current.tasks.filter((t) => t.orderNo === ord.no);
        const lotMap = new Map<number, typeof ordTasks>();
        for (const t of ordTasks) {
          const list = lotMap.get(t.lot) ?? [];
          list.push(t);
          lotMap.set(t.lot, list);
        }
        const completedCount = ordTasks.filter((t) => t.taskStatus === "COMPLETED").length;
        const progressPct =
          ordTasks.length > 0 ? Math.round((completedCount / ordTasks.length) * 100) : 0;
        const metric = currentKpi.orders.find((m) => m.no === ord.no);

        return {
          ord,
          prod,
          targetQty: calcTargetInputQty(ord.product, ord.qty, true, products),
          lots: Array.from(lotMap.entries()).map(([lot, tasks]) => ({
            lot,
            tasks: tasks.sort((a, b) => a.seq - b.seq),
            qty: tasks[0]?.qty ?? 0,
          })),
          totalTasks: ordTasks.length,
          completedCount,
          progressPct,
          metric,
        };
      });
  }, [orders, current.tasks, currentKpi.orders, products]);

  const visibleTasks = useMemo(() => {
    return current.tasks
      .filter((t) => {
        if (selectedOrderNo !== "ALL" && t.orderNo !== selectedOrderNo) return false;
        if (selectedLot !== "ALL" && t.lot !== selectedLot) return false;
        if (procFilter !== "ALL" && t.proc !== procFilter) return false;
        const st = t.taskStatus ?? "WAITING";
        if (statusFilter !== "ALL" && st !== statusFilter) return false;
        return true;
      })
      .sort(
        (a, b) =>
          a.orderNo.localeCompare(b.orderNo) || a.lot - b.lot || a.seq - b.seq
      );
  }, [current.tasks, selectedOrderNo, selectedLot, procFilter, statusFilter]);

  const handleConfirmPlan = () => {
    if (!perms.canEditPlan) {
      toast.error("계획 확정 권한이 없습니다. 생산계획 담당자(PLANNER) 또는 관리자(ADMIN)로 전환해 주세요.");
      return;
    }
    if (currentKpi.violations.length > 0) {
      toast.error(`제약조건 위반(${currentKpi.violations.length}건)이 존재하여 계획을 확정할 수 없습니다.`, {
        description: currentKpi.violations[0]?.message,
      });
      return;
    }
    confirm(current.id);
    toast.success(`생산계획 확정(CONFIRMED) 완료: ${current.label}`, {
      description: "기존 확정 버전은 이력 보관(SUPERSEDED) 상태로 자동 전환되었습니다.",
    });
  };

  const handleCancelPlan = () => {
    if (!perms.canEditPlan) {
      toast.error("계획 취소 권한이 없습니다.");
      return;
    }
    cancelVersion(current.id);
    toast.warning(`생산계획 버전 취소 처리됨: ${current.label}`);
  };

  const handleAutoCreatePlan = () => {
    if (!perms.canEditPlan) {
      toast.error("신규 계획 생성 권한이 없습니다.");
      return;
    }
    generatePlanFromOrders(
      orders.filter((o) => o.status !== "CANCELLED").map((o) => o.no),
      `수율보정 자동 생성 계획 (${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })})`
    );
    toast.success("전체 주문 기반 신규 생산계획 초안이 생성되었습니다.");
  };

  const handleStepStatusChange = (
    taskCode: string,
    nextStatus: TaskStatus,
    seq: number,
    orderNo: string,
    lot: number
  ) => {
    if (!perms.canEditTask) {
      toast.error("작업 상태 변경 권한이 없습니다.");
      return;
    }
    if ((nextStatus === "RUNNING" || nextStatus === "COMPLETED") && seq > 10) {
      const prevTask = current.tasks
        .filter((t) => t.orderNo === orderNo && t.lot === lot && t.seq < seq)
        .sort((a, b) => b.seq - a.seq)[0];
      if (prevTask && prevTask.taskStatus === "PAUSED") {
        toast.error(`선행 공정(${prevTask.code})이 일시정지(PAUSED) 상태이므로 후속 공정을 진행할 수 없습니다.`);
        return;
      }
    }
    updateTaskStatus(taskCode, nextStatus);
    toast.success(`작업 상태 변경: ${taskCode} → ${TASK_STATUS_META[nextStatus].label}`);
  };

  return (
    <div className="space-y-5">
      <PageHead
        title="생산계획 및 작업지시 관리 (SCR-PLAN-01)"
        desc="생산계획 버전의 생명주기(DRAFT → REVIEW → CONFIRMED)를 통제하고 로트별 5단계 공정 작업지시 및 현장 실적을 관리합니다."
      >
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={current.id}
            onChange={(e) => setCurrent(e.target.value)}
            aria-label="생산계획 버전 선택"
            className="h-9 rounded-md border bg-card px-3 text-xs font-semibold shadow-2xs"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                [{v.status}] {v.label} (OTD {v.kpi.otd.toFixed(1)}%)
              </option>
            ))}
          </select>

          <button
            onClick={handleAutoCreatePlan}
            disabled={!perms.canEditPlan}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-card px-3 text-xs font-semibold hover:bg-muted disabled:opacity-50"
          >
            <PlusCircle className="h-3.5 w-3.5 text-primary" />
            신규 계획 자동 생성
          </button>

          <button
            onClick={handleConfirmPlan}
            disabled={!perms.canEditPlan || current.status === "CONFIRMED"}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-success px-3.5 text-xs font-semibold text-white shadow-xs hover:bg-success/90 disabled:opacity-50"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {current.status === "CONFIRMED" ? "확정 완료됨" : "계획 확정 승인"}
          </button>

          <button
            onClick={handleCancelPlan}
            disabled={!perms.canEditPlan || current.status === "CANCELLED"}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 text-xs font-semibold text-destructive hover:bg-destructive/15 disabled:opacity-50"
          >
            <XCircle className="h-3.5 w-3.5" />
            버전 취소
          </button>
        </div>
      </PageHead>

      {/* Version Status Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card px-4 py-3 text-xs shadow-2xs">
        <div className="flex flex-wrap items-center gap-3">
          <Pill
            tone={
              current.status === "CONFIRMED"
                ? "success"
                : current.status === "CANCELLED"
                ? "danger"
                : "primary"
            }
          >
            {current.status}
          </Pill>
          <span className="font-bold text-foreground">
            {current.id} · {current.label}
          </span>
          <span className="text-muted-foreground">({current.method})</span>
        </div>
        <div className="num flex flex-wrap items-center gap-4 text-xs">
          <span>
            전체 공정 작업: <b>{current.tasks.length}</b>건
          </span>
          <span>
            고정(Pin 🔒) 작업: <b>{current.tasks.filter((t) => t.pinned).length}</b>건
          </span>
          <span>
            완료 작업:{" "}
            <b className="text-success">
              {current.tasks.filter((t) => t.taskStatus === "COMPLETED").length}
            </b>
            건
          </span>
          <span>
            제약 위반:{" "}
            <b className={currentKpi.violations.length > 0 ? "text-destructive" : "text-success"}>
              {currentKpi.violations.length}건
            </b>
          </span>
        </div>
      </div>

      {/* Master-Detail Grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left 4 cols: Order & Split Lot Tree */}
        <Panel
          className="lg:col-span-4"
          title={
            <div className="flex items-center gap-2">
              <FolderTree className="h-4 w-4 text-primary" />
              <span>주문 및 분할 로트 트리 ({orderTree.length}건)</span>
            </div>
          }
          action={
            selectedOrderNo !== "ALL" || selectedLot !== "ALL" ? (
              <button
                onClick={() => {
                  setSelectedOrderNo("ALL");
                  setSelectedLot("ALL");
                }}
                className="text-xs font-medium text-primary hover:underline"
              >
                전체 보기
              </button>
            ) : null
          }
        >
          <div className="max-h-[640px] space-y-2.5 overflow-y-auto pr-1">
            {orderTree.map(({ ord, prod, targetQty, lots, progressPct, metric }) => {
              const isSelectedOrd = selectedOrderNo === ord.no;
              const isLate = (metric?.tardy ?? 0) > 0;
              return (
                <div
                  key={ord.no}
                  className={`rounded-md border p-3 transition-colors ${
                    isSelectedOrd
                      ? "border-primary bg-primary/5"
                      : "bg-background/60 hover:border-primary/40"
                  }`}
                >
                  <div
                    onClick={() => {
                      setSelectedOrderNo(isSelectedOrd ? "ALL" : ord.no);
                      setSelectedLot("ALL");
                    }}
                    className="cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="num text-xs font-bold text-foreground">{ord.no}</span>
                      <div className="flex items-center gap-1">
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
                        {isLate && <Pill tone="danger">지연</Pill>}
                      </div>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>
                        {ord.customer} · {prod.name}
                      </span>
                      <span className="num font-medium text-foreground">
                        {ord.qty} → {targetQty} EA
                      </span>
                    </div>
                    {/* Progress Bar */}
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-success transition-all"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      <span className="num text-[10px] font-semibold text-muted-foreground">
                        {progressPct}%
                      </span>
                    </div>
                  </div>

                  {/* Lots under order */}
                  <div className="mt-2.5 space-y-1 border-t pt-2">
                    {lots.map((l) => {
                      const isLotSelected = isSelectedOrd && selectedLot === l.lot;
                      return (
                        <button
                          key={l.lot}
                          onClick={() => {
                            setSelectedOrderNo(ord.no);
                            setSelectedLot(isLotSelected ? "ALL" : l.lot);
                          }}
                          className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11px] ${
                            isLotSelected
                              ? "bg-primary font-semibold text-primary-foreground"
                              : "text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          <span className="num">
                            {ord.no.slice(-4)} · Lot #{l.lot}
                          </span>
                          <span className="num">
                            {l.qty} EA · {l.tasks.length}공정
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        {/* Right 8 cols: 5-Step Process Work Order Table & Execution Control */}
        <Panel
          className="lg:col-span-8"
          title={
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" />
              <span>공정별 작업지시서 (Work Orders) 및 현장 상태 제어 ({visibleTasks.length}건)</span>
            </div>
          }
          action={
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={procFilter}
                onChange={(e) => setProcFilter(e.target.value as ProcCode | "ALL")}
                className="h-8 rounded border bg-background px-2 text-xs"
              >
                <option value="ALL">전체 공정</option>
                {PROCESSES.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name} ({p.short})
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as TaskStatus | "ALL")}
                className="h-8 rounded border bg-background px-2 text-xs"
              >
                <option value="ALL">전체 진행상태</option>
                <option value="WAITING">WAITING (대기)</option>
                <option value="SETUP">SETUP (셋업중)</option>
                <option value="RUNNING">RUNNING (가공중)</option>
                <option value="PAUSED">PAUSED (일시정지)</option>
                <option value="COMPLETED">COMPLETED (완료)</option>
              </select>
            </div>
          }
        >
          <div className="max-h-[640px] overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b bg-muted/40 text-[11px] font-semibold text-muted-foreground">
                  <th className="p-2.5">작업코드 / 주문·로트</th>
                  <th className="p-2.5">공정 · 배정설비</th>
                  <th className="p-2.5">계획 시간 (셋업+본가공)</th>
                  <th className="p-2.5 text-right">계획/양품 수량</th>
                  <th className="p-2.5 text-center">고정(Pin)</th>
                  <th className="p-2.5">현재 상태</th>
                  <th className="p-2.5 text-right">현장 상태 전환 제어</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visibleTasks.map((t) => {
                  const st: TaskStatus = t.taskStatus ?? "WAITING";
                  const stMeta = TASK_STATUS_META[st];
                  return (
                    <tr key={t.code} className="hover:bg-muted/30">
                      <td className="p-2.5">
                        <div className="num font-bold text-foreground">{t.code}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {t.orderNo} (Lot #{t.lot}) · {t.family}
                        </div>
                      </td>
                      <td className="p-2.5">
                        <div className="font-semibold text-foreground">{procName(t.proc)}</div>
                        <div className="num text-[11px] font-semibold text-primary">{t.eq}</div>
                      </td>
                      <td className="num p-2.5 text-[11px]">
                        <div className="font-medium text-foreground">
                          {fmt(t.start - t.setup)} → {fmt(t.end)}
                        </div>
                        <div className="text-muted-foreground">
                          셋업 {t.setup}분 + 본가공 {t.end - t.start}분
                        </div>
                      </td>
                      <td className="num p-2.5 text-right">
                        <div className="font-semibold">{t.qty} EA</div>
                        {t.actualGoodQty !== undefined && t.actualGoodQty > 0 && (
                          <div className="text-[10px] text-success">양품 {t.actualGoodQty} EA</div>
                        )}
                      </td>
                      <td className="p-2.5 text-center">
                        <button
                          onClick={() => {
                            togglePinTask(t.code);
                            toast.info(
                              `${t.code} ${t.pinned ? "고정 해제(Unpin)" : "작업 고정(Pin 🔒) 완료"}`
                            );
                          }}
                          disabled={!perms.canEditPlan}
                          className={`inline-flex h-7 w-7 items-center justify-center rounded border ${
                            t.pinned
                              ? "border-primary bg-primary/15 text-primary"
                              : "text-muted-foreground hover:bg-muted"
                          }`}
                          title={t.pinned ? "고정 해제" : "재스케줄링 시 위치 고정(Pin)"}
                        >
                          {t.pinned ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                      <td className="p-2.5">
                        <Pill tone={stMeta.tone}>{stMeta.label}</Pill>
                      </td>
                      <td className="p-2.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => handleStepStatusChange(t.code, "SETUP", t.seq, t.orderNo, t.lot)}
                            disabled={!perms.canEditTask || st === "SETUP"}
                            className="rounded border px-2 py-1 text-[10px] font-medium hover:bg-muted disabled:opacity-40"
                          >
                            셋업
                          </button>
                          <button
                            onClick={() => handleStepStatusChange(t.code, "RUNNING", t.seq, t.orderNo, t.lot)}
                            disabled={!perms.canEditTask || st === "RUNNING"}
                            className="inline-flex items-center gap-0.5 rounded border border-primary/40 bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary hover:bg-primary/20 disabled:opacity-40"
                          >
                            <Play className="h-2.5 w-2.5" />
                            착수
                          </button>
                          <button
                            onClick={() => handleStepStatusChange(t.code, "PAUSED", t.seq, t.orderNo, t.lot)}
                            disabled={!perms.canEditTask || st === "PAUSED"}
                            className="rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[10px] font-semibold text-warning hover:bg-warning/20 disabled:opacity-40"
                          >
                            정지
                          </button>
                          <button
                            onClick={() => handleStepStatusChange(t.code, "COMPLETED", t.seq, t.orderNo, t.lot)}
                            disabled={!perms.canEditTask || st === "COMPLETED"}
                            className="inline-flex items-center gap-0.5 rounded bg-success px-2 py-1 text-[10px] font-semibold text-white hover:bg-success/90 disabled:opacity-40"
                          >
                            <CheckCircle2 className="h-2.5 w-2.5" />
                            완료
                          </button>
                        </div>
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
