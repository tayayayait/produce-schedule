import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAps } from "@/lib/aps/store";
import {
  PROCESSES,
  ROLE_META,
  equipmentOf,
  fmt,
  fmtDur,
  type TaskStatus,
} from "@/lib/aps/data";
import { PRESETS, type Preset, type Task } from "@/lib/aps/engine";
import { Gantt } from "@/components/aps/Gantt";
import { PageHead, Panel, Pill, biTone, otdTone, tardTone } from "@/components/aps/ui";
import {
  ArrowLeftRight,
  CheckCircle2,
  Cpu,
  Flame,
  GitBranch,
  Lock,
  Play,
  Redo2,
  RefreshCw,
  Save,
  ShieldCheck,
  Sliders,
  Sparkles,
  Undo2,
  Unlock,
  X,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/schedules")({
  component: SchedulesPage,
});

const HC_DEFINITIONS = [
  { code: "HC-001", name: "설비-공정·패밀리 적격 호환성", desc: "작업은 해당 공정 및 보드 패밀리를 지원하는 인가 설비에만 배정" },
  { code: "HC-002", name: "작업 소요시간 양수 및 정합성", desc: "셋업 및 본가공 시작~종료 시간의 수리적 유효성 보장" },
  { code: "HC-003", name: "공정 순서 및 선후행(이송시간) 제약", desc: "동일 로트 내 후속 공정은 선행 공정 완료 + 이송(10분) 이후 착수" },
  { code: "HC-004", name: "동일 설비·레인 중복 배정 금지", desc: "단일 설비 레인은 동일 시점에 최대 1개의 로트 작업만 수행" },
  { code: "HC-005", name: "설비 비가동(DOWN/PM) 및 휴무 회피", desc: "설비 고장·예방점검 및 야간 비근무 교대 시간 침범 금지" },
  { code: "HC-006", name: "원자재 투입 가능 시각(Release) 준수", desc: "첫 공정(SMT)은 주문 자재 입고 시각 이후에만 착수 가능" },
  { code: "HC-007", name: "고정 작업(Pinned) 및 동결 구간 보존", desc: "진행 중이거나 고정(Pin)된 작업은 재스케줄링 시 위치 보존" },
] as const;

function SchedulesPage() {
  const {
    versions,
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
    canUndo,
    canRedo,
    undoCount,
    setCurrent,
    setFreezeMin,
    runOptimize,
    rescheduleNow,
    moveTask,
    togglePinTask,
    updateTaskStatus,
    undo,
    redo,
    saveDraft,
    confirm,
  } = useAps();

  const perms = ROLE_META[role];

  // Gantt view options
  const [viewMode, setViewMode] = useState<"MACHINE" | "ORDER">("MACHINE");
  const [showDependencies, setShowDependencies] = useState<boolean>(true);
  const [highlightBottleneck, setHighlightBottleneck] = useState<boolean>(true);
  const [selectedCode, setSelectedCode] = useState<string | null>(current.tasks[0]?.code ?? null);
  const [inspectorTab, setInspectorTab] = useState<"CONSTRAINTS" | "BOTTLENECK" | "TASK">("CONSTRAINTS");

  // AI Optimization Config Modal state
  const [optModalOpen, setOptModalOpen] = useState(false);
  const [optPreset, setOptPreset] = useState<Preset>(current.preset);
  const [customWeights, setCustomWeights] = useState<[number, number, number, number]>([
    ...PRESETS[current.preset].a,
  ]);
  const [localFreeze, setLocalFreeze] = useState(freezeMin);

  const selectedTask: Task | undefined = useMemo(
    () => current.tasks.find((t) => t.code === selectedCode) ?? current.tasks[0],
    [current.tasks, selectedCode]
  );

  const compatibleEqs = useMemo(() => {
    if (!selectedTask) return [];
    return equipments.filter(
      (eq) => eq.proc === selectedTask.proc && eq.families.includes(selectedTask.family)
    );
  }, [equipments, selectedTask]);

  const bottleneckSet = useMemo(
    () => new Set(currentKpi.eqs.filter((e) => e.level !== "NORMAL").map((e) => e.eq)),
    [currentKpi.eqs]
  );

  const topBottleneck = useMemo(
    () => [...currentKpi.eqs].sort((a, b) => b.BI - a.BI)[0],
    [currentKpi.eqs]
  );

  const procName = (proc: string) => PROCESSES.find((p) => p.code === proc)?.name ?? proc;

  const handleTaskMove = (
    taskCode: string,
    targetEq: string,
    targetLane: number,
    targetBlockStart: number
  ) => {
    if (!perms.canEditPlan) {
      toast.error("권한이 부족합니다. 생산계획 담당자(PLANNER) 또는 시스템 관리자(ADMIN) 역할이 필요합니다.");
      return;
    }
    const { cascadedCodes, check } = moveTask(taskCode, targetEq, targetLane, targetBlockStart);
    if (!check.canDrop) {
      toast.error("제약조건 위반으로 이동이 거부되었습니다 (원래 위치로 복원)", {
        description: check.reason,
      });
    } else if (check.status === "CASCADE_WARN") {
      toast.warning(`연쇄 밀림(Cascade Push ${cascadedCodes.length}건) 자동 반영 완료`, {
        description: check.reason,
      });
    } else {
      toast.success("작업 일정 수동 조정 완료", {
        description: `${targetEq} · 블록 시작 ${fmt(check.newBlockStart)} (셋업 ${check.newSetup}분 자동 재계산)`,
      });
    }
  };

  const handleOpenOptModal = () => {
    setOptPreset(current.preset);
    setCustomWeights([...PRESETS[current.preset].a]);
    setLocalFreeze(freezeMin);
    setOptModalOpen(true);
  };

  const handleExecuteOptimize = async () => {
    if (!perms.canEditPlan) {
      toast.error("최적화 실행 권한이 없습니다.");
      return;
    }
    setFreezeMin(localFreeze);
    setOptModalOpen(false);
    await runOptimize(optPreset, customWeights);
    toast.success(`2-Phase 하이브리드 최적화 완료 (${PRESETS[optPreset].label})`);
  };

  const handleConfirmSchedule = () => {
    if (!perms.canEditPlan) {
      toast.error("스케줄 확정 권한이 없습니다.");
      return;
    }
    if (currentKpi.violations.length > 0) {
      toast.error(`Hard Constraint 위반(${currentKpi.violations.length}건)이 존재하여 확정할 수 없습니다.`);
      return;
    }
    confirm(current.id);
    toast.success(`스케줄 버전 확정(CONFIRMED) 완료: ${current.label}`);
  };

  return (
    <div className="space-y-4">
      <PageHead
        title="스케줄링 최적화 및 인터랙티브 간트 워크스페이스 (SCR-SCHED-01)"
        desc="스냅 드래그 앤 드롭, 품목 전환 셋업(SDST) 자동 재계산, 연쇄 밀림(Cascade) 시뮬레이션 및 2단계 메타휴리스틱 최적화를 수행합니다."
      >
        {/* Version Selector */}
        <select
          value={current.id}
          onChange={(e) => setCurrent(e.target.value)}
          aria-label="스케줄 버전 선택"
          className="h-9 rounded-md border bg-card px-2.5 text-xs font-semibold shadow-2xs"
        >
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              [{v.status}] {v.label} (OTD {v.kpi.otd.toFixed(1)}%)
            </option>
          ))}
        </select>

        {/* Undo / Redo */}
        <div className="inline-flex items-center rounded-md border bg-card p-0.5 shadow-2xs">
          <button
            onClick={() => {
              undo();
              toast.info("이전 편집 상태로 되돌렸습니다 (Undo)");
            }}
            disabled={!canUndo}
            className="inline-flex h-8 items-center gap-1 rounded px-2 text-xs font-medium hover:bg-muted disabled:opacity-40"
            title="실행 취소 (Undo)"
          >
            <Undo2 className="h-3.5 w-3.5" />
            <span className="num text-[11px]">({undoCount})</span>
          </button>
          <button
            onClick={() => {
              redo();
              toast.info("다시 실행했습니다 (Redo)");
            }}
            disabled={!canRedo}
            className="inline-flex h-8 items-center gap-1 rounded px-2 text-xs font-medium hover:bg-muted disabled:opacity-40"
            title="다시 실행 (Redo)"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Save Draft */}
        <button
          onClick={() => {
            saveDraft();
            toast.success("현재 스케줄 편집 상태가 임시 저장되었습니다.");
          }}
          disabled={!perms.canEditPlan}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-card px-3 text-xs font-semibold hover:bg-muted disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          임시 저장
        </button>

        {/* AI Optimize Modal Trigger */}
        <button
          onClick={handleOpenOptModal}
          disabled={!perms.canEditPlan || busy}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-semibold text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {busy ? "연산중..." : "AI 최적화 실행"}
        </button>

        {/* Emergency Reschedule */}
        <button
          onClick={async () => {
            await rescheduleNow(nowMin, freezeMin, current.preset);
            toast.success("긴급 동적 재스케줄링 완료");
          }}
          disabled={!perms.canEditPlan || busy}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-3 text-xs font-semibold text-warning hover:bg-warning/20 disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          긴급 재스케줄링
        </button>

        {/* Confirm */}
        <button
          onClick={handleConfirmSchedule}
          disabled={!perms.canEditPlan || current.status === "CONFIRMED"}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-success px-3.5 text-xs font-semibold text-white shadow-xs hover:bg-success/90 disabled:opacity-50"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          {current.status === "CONFIRMED" ? "확정됨" : "스케줄 확정"}
        </button>
      </PageHead>

      {/* Compact KPI & View Options Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-2.5 text-xs shadow-2xs">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">OTD:</span>
            <Pill tone={otdTone(currentKpi.otd)}>{currentKpi.otd.toFixed(1)}%</Pill>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">총 납기지연:</span>
            <Pill tone={tardTone(currentKpi.tardiness)}>{fmtDur(currentKpi.tardiness)}</Pill>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Makespan:</span>
            <span className="num font-bold">{fmtDur(currentKpi.makespan)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">평균 가동률:</span>
            <span className="num font-bold">{currentKpi.util.toFixed(1)}%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">셋업 손실(SDST):</span>
            <span className="num font-bold">{currentKpi.setupLoss.toFixed(1)}%</span>
          </div>
          {topBottleneck && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">최대 병목:</span>
              <Pill tone={biTone(topBottleneck.level)}>
                {topBottleneck.eq} (BI {topBottleneck.BI.toFixed(1)})
              </Pill>
            </div>
          )}
        </div>

        {/* View Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
            <button
              onClick={() => setViewMode("MACHINE")}
              className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                viewMode === "MACHINE" ? "bg-card text-foreground shadow-2xs" : "text-muted-foreground"
              }`}
            >
              설비 중심 간트 (Resource)
            </button>
            <button
              onClick={() => setViewMode("ORDER")}
              className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                viewMode === "ORDER" ? "bg-card text-foreground shadow-2xs" : "text-muted-foreground"
              }`}
            >
              주문·로트 중심 간트 (Order)
            </button>
          </div>

          <button
            onClick={() => setShowDependencies((v) => !v)}
            className={`inline-flex h-7 items-center gap-1 rounded border px-2.5 text-[11px] font-medium ${
              showDependencies ? "border-primary bg-primary/10 text-primary" : "bg-card text-muted-foreground"
            }`}
          >
            <GitBranch className="h-3 w-3" />
            공정 연결선
          </button>

          <button
            onClick={() => setHighlightBottleneck((v) => !v)}
            className={`inline-flex h-7 items-center gap-1 rounded border px-2.5 text-[11px] font-medium ${
              highlightBottleneck ? "border-warning bg-warning/10 text-warning" : "bg-card text-muted-foreground"
            }`}
          >
            <Flame className="h-3 w-3" />
            병목 설비 강조
          </button>

          <Link
            to="/simulation"
            className="inline-flex h-7 items-center gap-1 rounded border bg-card px-2.5 text-[11px] font-semibold text-primary hover:bg-muted"
          >
            <ArrowLeftRight className="h-3 w-3" />
            최적화 전후 비교 →
          </Link>
        </div>
      </div>

      {/* Main Interactive Gantt Chart */}
      <Panel>
        <Gantt
          tasks={current.tasks}
          downs={downs}
          conflicts={currentKpi.conflicts}
          orders={orders}
          equipments={equipments}
          products={products}
          editable={perms.canEditPlan}
          onMoveTask={handleTaskMove}
          onTogglePin={(code) => {
            togglePinTask(code);
            toast.info("작업 고정(Pin) 상태가 전환되었습니다.");
          }}
          selected={selectedTask?.code ?? null}
          onSelect={(code) => {
            setSelectedCode(code);
            if (code) setInspectorTab("TASK");
          }}
          viewMode={viewMode}
          showDependencies={showDependencies}
          highlightBottleneck={highlightBottleneck}
          bottleneckEqs={bottleneckSet}
          nowMin={nowMin}
          freezeMin={freezeMin}
        />
      </Panel>

      {/* Bottom 3-Tab Inspector Panel */}
      <div className="rounded-lg border bg-card shadow-card">
        <div className="flex flex-wrap items-center justify-between border-b px-4">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setInspectorTab("CONSTRAINTS")}
              className={`border-b-2 px-3.5 py-2.5 text-xs font-semibold transition-colors ${
                inspectorTab === "CONSTRAINTS"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              1. 7대 제약 검증 결과 (HC-001~007) 및 지연 분석 ({currentKpi.violations.length}건 위반)
            </button>
            <button
              onClick={() => setInspectorTab("BOTTLENECK")}
              className={`border-b-2 px-3.5 py-2.5 text-xs font-semibold transition-colors ${
                inspectorTab === "BOTTLENECK"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              2. 설비별 부하 프로파일 및 병목 지수 (BI)
            </button>
            <button
              onClick={() => setInspectorTab("TASK")}
              className={`border-b-2 px-3.5 py-2.5 text-xs font-semibold transition-colors ${
                inspectorTab === "TASK"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              3. 선택 작업 상세 제어 ({selectedTask ? `${selectedTask.code} · ${selectedTask.eq}` : "미선택"})
            </button>
          </div>
          <div className="py-2 text-[11px] text-muted-foreground">
            팁: 간트 바를 마우스로 드래그하거나 선택 후 키보드 화살표(←/→ 15분 이동, ↑/↓ 호환 설비 변경, P 고정)로 조작할 수 있습니다.
          </div>
        </div>

        <div className="p-4">
          {inspectorTab === "CONSTRAINTS" && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <div className="space-y-2 lg:col-span-7">
                <div className="text-xs font-bold">Hard Constraints (HC-001 ~ HC-007) 실시간 무결성 검증</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {HC_DEFINITIONS.map((hc) => {
                    const hcViolations = currentKpi.violations.filter((v) => v.hcCode === hc.code);
                    const passed = hcViolations.length === 0;
                    return (
                      <div
                        key={hc.code}
                        className={`rounded-md border p-2.5 text-xs ${
                          passed ? "bg-background/60" : "border-destructive/50 bg-destructive/5"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold">
                            [{hc.code}] {hc.name}
                          </span>
                          {passed ? (
                            <Pill tone="success">PASS</Pill>
                          ) : (
                            <Pill tone="danger">{hcViolations.length}건 위반</Pill>
                          )}
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">{hc.desc}</p>
                        {!passed && (
                          <p className="mt-1 text-[11px] font-semibold text-destructive">
                            {hcViolations[0]?.message}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2 lg:col-span-5">
                <div className="text-xs font-bold">
                  납기 지연 주문 및 비가동 충돌 상세 ({currentKpi.lateOrders}건 지연)
                </div>
                <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                  {currentKpi.orders
                    .filter((m) => m.tardy > 0)
                    .map((m) => {
                      const ord = orders.find((o) => o.no === m.no);
                      return (
                        <div
                          key={m.no}
                          className="flex items-center justify-between rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs"
                        >
                          <div>
                            <div className="font-bold text-destructive">
                              {m.no} ({ord?.customer})
                            </div>
                            <div className="num text-[11px] text-muted-foreground">
                              납기 {fmt(m.due)} → 완료 {fmt(m.completion)}
                            </div>
                          </div>
                          <Pill tone="danger">+{fmtDur(m.tardy)} 지연</Pill>
                        </div>
                      );
                    })}
                  {currentKpi.lateOrders === 0 && currentKpi.violations.length === 0 && (
                    <div className="flex items-center gap-2 rounded-md border bg-success/5 p-4 text-xs text-success">
                      <CheckCircle2 className="h-5 w-5 shrink-0" />
                      <span>모든 생산 주문이 납기일시 이내에 정상 배정되었으며 제약 위반이 없습니다.</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {inspectorTab === "BOTTLENECK" && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              {currentKpi.eqs.map((u) => {
                const eq = equipmentOf(u.eq, equipments);
                return (
                  <div key={u.eq} className="rounded-md border bg-background/60 p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="num font-bold">{u.eq}</span>
                      <Pill tone={biTone(u.level)}>BI {u.BI.toFixed(1)}</Pill>
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{procName(eq.proc)}</div>
                    <div className="num mt-2 text-lg font-bold">{u.util.toFixed(1)}%</div>
                    <div className="mt-1 space-y-0.5 text-[10px] text-muted-foreground">
                      <div>가공: {u.run}분</div>
                      <div>셋업: {u.setup}분</div>
                      <div>대기율(Q): {u.Q.toFixed(1)}%</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {inspectorTab === "TASK" && selectedTask && (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border bg-muted/20 p-4 text-xs">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Pill tone="primary">{selectedTask.code}</Pill>
                  <span className="text-sm font-bold">
                    {procName(selectedTask.proc)} ({selectedTask.eq})
                  </span>
                  <Pill tone="muted">{selectedTask.family}</Pill>
                </div>
                <div className="num text-muted-foreground">
                  주문번호: <b>{selectedTask.orderNo} (Lot #{selectedTask.lot})</b> · 로트 수량:{" "}
                  <b>{selectedTask.qty} EA</b> · 계획 구간:{" "}
                  <b>
                    {fmt(selectedTask.start - selectedTask.setup)} ~ {fmt(selectedTask.end)}
                  </b>{" "}
                  (셋업 {selectedTask.setup}분 + 본가공 {selectedTask.end - selectedTask.start}분)
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {/* Equipment Reassignment */}
                <div className="flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-semibold">배정 설비 변경:</span>
                  <select
                    value={selectedTask.eq}
                    onChange={(e) =>
                      handleTaskMove(
                        selectedTask.code,
                        e.target.value,
                        0,
                        selectedTask.start - selectedTask.setup
                      )
                    }
                    disabled={!perms.canEditPlan || selectedTask.pinned}
                    className="h-8 rounded border bg-card px-2 text-xs font-semibold"
                  >
                    {compatibleEqs.map((eq) => (
                      <option key={eq.code} value={eq.code}>
                        {eq.code} ({eq.name})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Time Nudge Buttons */}
                <div className="flex items-center gap-1">
                  <span className="font-semibold">시각 미세 조정:</span>
                  {[-60, -15, 15, 60].map((delta) => (
                    <button
                      key={delta}
                      onClick={() =>
                        handleTaskMove(
                          selectedTask.code,
                          selectedTask.eq,
                          selectedTask.lane,
                          Math.max(0, selectedTask.start - selectedTask.setup + delta)
                        )
                      }
                      disabled={!perms.canEditPlan || selectedTask.pinned}
                      className="num h-8 rounded border bg-card px-2 text-[11px] font-medium hover:bg-muted disabled:opacity-40"
                    >
                      {delta > 0 ? `+${delta}m` : `${delta}m`}
                    </button>
                  ))}
                </div>

                {/* Pin Toggle */}
                <button
                  onClick={() => {
                    togglePinTask(selectedTask.code);
                    toast.info(
                      `${selectedTask.code} ${selectedTask.pinned ? "고정 해제(Unpin)" : "고정(Pin 🔒) 설정"}`
                    );
                  }}
                  disabled={!perms.canEditPlan}
                  className={`inline-flex h-8 items-center gap-1 rounded border px-3 text-xs font-semibold ${
                    selectedTask.pinned
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-card hover:bg-muted"
                  }`}
                >
                  {selectedTask.pinned ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                  {selectedTask.pinned ? "고정됨 (Pinned)" : "작업 고정(Pin)"}
                </button>

                {/* Status Toggle */}
                <select
                  value={selectedTask.taskStatus ?? "WAITING"}
                  onChange={(e) => {
                    updateTaskStatus(selectedTask.code, e.target.value as TaskStatus);
                    toast.success(`작업 진행 상태 → ${e.target.value}`);
                  }}
                  disabled={!perms.canEditTask}
                  className="h-8 rounded border bg-card px-2 text-xs font-semibold"
                >
                  <option value="WAITING">WAITING (대기)</option>
                  <option value="SETUP">SETUP (셋업중)</option>
                  <option value="RUNNING">RUNNING (가공중)</option>
                  <option value="PAUSED">PAUSED (일시정지)</option>
                  <option value="COMPLETED">COMPLETED (완료)</option>
                </select>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AI Optimization Engine Configuration Modal */}
      {optModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xl rounded-lg border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Sliders className="h-4 w-4 text-primary" />
                <h3 className="text-base font-bold">2-Phase 하이브리드 최적화 엔진 파라미터 설정</h3>
              </div>
              <button
                onClick={() => setOptModalOpen(false)}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5 text-xs">
              <div>
                <label className="mb-1.5 block font-bold">1. 목적함수 가중치 프리셋 선택</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {(Object.keys(PRESETS) as Preset[]).map((k) => {
                    const meta = PRESETS[k];
                    const isSel = optPreset === k;
                    return (
                      <button
                        key={k}
                        onClick={() => {
                          setOptPreset(k);
                          setCustomWeights([...meta.a]);
                        }}
                        className={`rounded-md border p-2.5 text-left transition-colors ${
                          isSel ? "border-primary bg-primary/10" : "hover:bg-muted"
                        }`}
                      >
                        <div className="font-bold text-foreground">{meta.label}</div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">{meta.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom Sliders for Soft Constraints SC-001 ~ SC-004 */}
              <div className="space-y-3 rounded-md border bg-muted/30 p-3.5">
                <div className="font-bold">2. Soft Constraint 목적함수 세부 가중치 (α₁ ~ α₄)</div>

                <div>
                  <div className="flex justify-between text-[11px]">
                    <span>SC-001: 우선순위 가중 납기 지연 최소화 (α₁)</span>
                    <span className="num font-bold text-primary">{customWeights[0]}</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={500}
                    step={10}
                    value={customWeights[0]}
                    onChange={(e) =>
                      setCustomWeights([
                        Number(e.target.value),
                        customWeights[1],
                        customWeights[2],
                        customWeights[3],
                      ])
                    }
                    className="w-full accent-primary"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[11px]">
                    <span>SC-002: 총 완료시간(Makespan) 단축 (α₂)</span>
                    <span className="num font-bold text-primary">{customWeights[1]}</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    step={1}
                    value={customWeights[1]}
                    onChange={(e) =>
                      setCustomWeights([
                        customWeights[0],
                        Number(e.target.value),
                        customWeights[2],
                        customWeights[3],
                      ])
                    }
                    className="w-full accent-primary"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[11px]">
                    <span>SC-003: 품목 전환 셋업 시간(SDST) 최소화 (α₃)</span>
                    <span className="num font-bold text-primary">{customWeights[2]}</span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={120}
                    step={5}
                    value={customWeights[2]}
                    onChange={(e) =>
                      setCustomWeights([
                        customWeights[0],
                        customWeights[1],
                        Number(e.target.value),
                        customWeights[3],
                      ])
                    }
                    className="w-full accent-primary"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[11px]">
                    <span>SC-004: 설비 간 부하 평준화 (Load Balancing α₄)</span>
                    <span className="num font-bold text-primary">{customWeights[3]}</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={50}
                    step={1}
                    value={customWeights[3]}
                    onChange={(e) =>
                      setCustomWeights([
                        customWeights[0],
                        customWeights[1],
                        customWeights[2],
                        Number(e.target.value),
                      ])
                    }
                    className="w-full accent-primary"
                  />
                </div>
              </div>

              {/* Freeze Horizon */}
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="font-bold">3. 스케줄 동결 구간 (Freeze Horizon)</div>
                  <div className="text-[11px] text-muted-foreground">
                    현재 시각 이후 지정된 시간 내 작업은 현장 혼선 방지를 위해 위치를 고정합니다.
                  </div>
                </div>
                <select
                  value={localFreeze}
                  onChange={(e) => setLocalFreeze(Number(e.target.value))}
                  className="num h-9 rounded border bg-background px-2.5 text-xs font-semibold"
                >
                  <option value={0}>동결 없음 (0분)</option>
                  <option value={120}>2시간 (120분 · 권장)</option>
                  <option value={240}>4시간 (240분)</option>
                  <option value={480}>8시간 (480분)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
              <button
                onClick={() => setOptModalOpen(false)}
                className="h-9 rounded-md border px-4 text-xs font-medium hover:bg-muted"
              >
                취소
              </button>
              <button
                onClick={handleExecuteOptimize}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                <Play className="h-3.5 w-3.5" />
                최적화 엔진 실행 (신규 버전 생성)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
