import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Lock, AlertTriangle, ArrowRightLeft, Flame } from "lucide-react";
import {
  EQUIPMENTS, PROCESSES, SHIFT_MIN, TRANSFER_MIN, fmt,
  type Downtime, type Equipment, type Order, type Product,
} from "@/lib/aps/data";
import { checkTaskMove, type Task, type MoveCheckResult } from "@/lib/aps/engine";
import { cn } from "@/lib/utils";
import { FAM_BG, Pill } from "./ui";

const ZOOMS = [
  { label: "15분 (초정밀)", ppm: 2.4, snap: 5, tick: 30 },
  { label: "1시간 (표준)", ppm: 1.2, snap: 5, tick: 60 },
  { label: "4시간 (요약)", ppm: 0.65, snap: 15, tick: 120 },
  { label: "1일 (전체)", ppm: 0.36, snap: 30, tick: 240 },
] as const;

const ROW_H = 38;
const LABEL_W = 168;

export interface GanttProps {
  tasks: Task[];
  downs: Downtime[];
  conflicts: string[];
  orders?: Order[];
  equipments?: Equipment[];
  products?: Product[];
  selected?: string | null;
  onSelect?: (code: string | null) => void;
  highlightOrder?: string | null;
  nowMin?: number;
  freezeMin?: number;
  showDependencies?: boolean;
  highlightBottleneck?: boolean;
  bottleneckEqs?: Set<string>;
  viewMode?: "MACHINE" | "ORDER";
  editable?: boolean;
  onMoveTask?: (taskCode: string, targetEq: string, targetLane: number, targetBlockStart: number) => void;
  onTogglePin?: (taskCode: string) => void;
  compact?: boolean;
}

interface DragState {
  task: Task;
  startX: number;
  origBlockStart: number;
  targetEq: string;
  targetLane: number;
  targetBlockStart: number;
  check: MoveCheckResult;
}

export function Gantt({
  tasks,
  downs,
  conflicts,
  orders = [],
  equipments = EQUIPMENTS,
  products,
  selected,
  onSelect,
  highlightOrder,
  nowMin = 0,
  freezeMin = 120,
  showDependencies = false,
  highlightBottleneck = false,
  bottleneckEqs,
  viewMode = "MACHINE",
  editable = false,
  onMoveTask,
  onTogglePin,
  compact = false,
}: GanttProps) {
  const [zi, setZi] = useState(compact ? 3 : 2);
  const [drag, setDrag] = useState<DragState | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const zoom = ZOOMS[zi] ?? ZOOMS[2];
  const ppm = zoom.ppm;
  const rowH = compact ? 30 : ROW_H;

  const endMin = Math.max(
    3 * 1440,
    Math.ceil((Math.max(0, ...tasks.map((t) => t.end)) + 180) / 1440) * 1440,
  );
  const width = endMin * ppm;
  const conflictSet = useMemo(() => new Set(conflicts), [conflicts]);

  const machineRows = useMemo(
    () =>
      equipments.flatMap((e) =>
        Array.from({ length: e.capacity }, (_, lane) => ({
          id: `${e.code}#${lane}`,
          label: `${e.code}${e.capacity > 1 ? `-${lane + 1}` : ""}`,
          sub: PROCESSES.find((p) => p.code === e.proc)?.short ?? e.proc,
          eq: e,
          lane,
        })),
      ),
    [equipments],
  );

  const orderRows = useMemo(() => {
    const lotKeys = Array.from(new Set(tasks.map((t) => `${t.orderNo}#${t.lot}`))).sort();
    return lotKeys.map((k) => {
      const [orderNo = "", lotStr = "1"] = k.split("#");
      const lot = Number(lotStr);
      const sample = tasks.find((t) => t.orderNo === orderNo && t.lot === lot);
      return {
        id: k,
        orderNo,
        lot,
        label: `${orderNo.slice(-6)} · L${lot}`,
        sub: sample?.family ?? "",
      };
    });
  }, [tasks]);

  const days = Math.ceil(endMin / 1440);
  const ticks = Array.from({ length: Math.floor(endMin / zoom.tick) }, (_, i) => i * zoom.tick);

  // 드래그 중인 작업의 선행 공정 완료 시각 계산
  const earliestValidStartMin = useMemo(() => {
    if (!drag) return null;
    const t = drag.task;
    const prevOp = tasks
      .filter((x) => x.orderNo === t.orderNo && x.lot === t.lot && x.seq < t.seq)
      .sort((a, b) => b.seq - a.seq)[0];
    const ord = orders.find((o) => o.no === t.orderNo);
    return prevOp ? prevOp.end + TRANSFER_MIN : ord?.release ?? 0;
  }, [drag, tasks, orders]);

  const handlePointerDown = (e: PointerEvent<HTMLButtonElement>, t: Task) => {
    onSelect?.(t.code);
    if (!editable || viewMode !== "MACHINE" || !onMoveTask) return;
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const origBs = t.start - t.setup;
    const initialCheck = checkTaskMove(tasks, t.code, t.eq, t.lane, origBs, orders, downs, equipments, products);
    setDrag({
      task: t,
      startX: e.clientX,
      origBlockStart: origBs,
      targetEq: t.eq,
      targetLane: t.lane,
      targetBlockStart: origBs,
      check: initialCheck,
    });
  };

  const handlePointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    if (Math.abs(dx) < 3 && drag.targetEq === drag.task.eq && drag.targetLane === drag.task.lane) return;
    const deltaMin = Math.round(dx / ppm / zoom.snap) * zoom.snap;
    const candStart = Math.max(0, drag.origBlockStart + deltaMin);

    let targetEq = drag.targetEq;
    let targetLane = drag.targetLane;
    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const relY = e.clientY - rect.top - 40; // header height 40px
      const rowIdx = Math.max(0, Math.min(machineRows.length - 1, Math.floor(relY / rowH)));
      const row = machineRows[rowIdx];
      if (row) {
        targetEq = row.eq.code;
        targetLane = row.lane;
      }
    }

    const check = checkTaskMove(
      tasks,
      drag.task.code,
      targetEq,
      targetLane,
      candStart,
      orders,
      downs,
      equipments,
      products,
    );
    setDrag({
      ...drag,
      targetEq,
      targetLane,
      targetBlockStart: candStart,
      check,
    });
  };

  const handlePointerUp = () => {
    if (!drag) return;
    const movedChanged =
      drag.targetEq !== drag.task.eq ||
      drag.targetLane !== drag.task.lane ||
      drag.targetBlockStart !== drag.origBlockStart;
    if (movedChanged && onMoveTask) {
      onMoveTask(drag.task.code, drag.targetEq, drag.targetLane, drag.targetBlockStart);
    }
    setDrag(null);
  };

  const handleTaskKeyDown = (e: KeyboardEvent<HTMLButtonElement>, t: Task) => {
    if (!editable) return;
    if (e.key.toLowerCase() === "p" && onTogglePin) {
      e.preventDefault();
      onTogglePin(t.code);
      return;
    }
    if (!onMoveTask) return;
    const stepMin = e.shiftKey ? 60 : 15;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      onMoveTask(t.code, t.eq, t.lane, t.start - t.setup + stepMin);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      onMoveTask(t.code, t.eq, t.lane, Math.max(0, t.start - t.setup - stepMin));
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const eligible = machineRows.filter((r) => r.eq.proc === t.proc && r.eq.families.includes(t.family));
      const curIdx = eligible.findIndex((r) => r.eq.code === t.eq && r.lane === t.lane);
      const nextRow = eligible[curIdx + (e.key === "ArrowDown" ? 1 : -1)];
      if (nextRow) {
        onMoveTask(t.code, nextRow.eq.code, nextRow.lane, t.start - t.setup);
      }
    }
  };

  // 선후행 연결 화살표 좌표 계산 (선택된 작업의 로트 또는 전체 로트)
  const dependencyPaths = useMemo(() => {
    if (!showDependencies || viewMode !== "MACHINE") return [];
    const targetTask = tasks.find((t) => t.code === selected);
    const filterOrder = highlightOrder ?? targetTask?.orderNo ?? null;

    const byLot = new Map<string, Task[]>();
    for (const t of tasks) {
      if (filterOrder && t.orderNo !== filterOrder) continue;
      const k = `${t.orderNo}#${t.lot}`;
      if (!byLot.has(k)) byLot.set(k, []);
      byLot.get(k)!.push(t);
    }

    const lines: { key: string; x1: number; y1: number; x2: number; y2: number; isConflict: boolean }[] = [];
    for (const [lotKey, lotTasks] of byLot.entries()) {
      const sorted = [...lotTasks].sort((a, b) => a.seq - b.seq);
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i]!;
        const b = sorted[i + 1]!;
        const r1 = machineRows.findIndex((r) => r.eq.code === a.eq && r.lane === a.lane);
        const r2 = machineRows.findIndex((r) => r.eq.code === b.eq && r.lane === b.lane);
        if (r1 < 0 || r2 < 0) continue;
        const x1 = a.end * ppm;
        const y1 = r1 * rowH + rowH / 2;
        const x2 = (b.start - b.setup) * ppm;
        const y2 = r2 * rowH + rowH / 2;
        lines.push({
          key: `${lotKey}-${a.seq}-${b.seq}`,
          x1,
          y1,
          x2,
          y2,
          isConflict: x2 < x1 + TRANSFER_MIN * ppm,
        });
      }
    }
    return lines;
  }, [showDependencies, viewMode, tasks, selected, highlightOrder, machineRows, ppm, rowH]);

  return (
    <div>
      {!compact && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md border bg-card p-0.5" role="group" aria-label="시간 축 확대·축소">
              {ZOOMS.map((z, i) => (
                <button
                  key={z.label}
                  onClick={() => setZi(i)}
                  className={cn(
                    "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                    i === zi ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {z.label}
                </button>
              ))}
            </div>
            <Legend />
          </div>

          {/* 실시간 드래그 상태 배지 */}
          {drag && (
            <div
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-1 text-xs font-semibold shadow-sm",
                drag.check.status === "VALID"
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400"
                  : drag.check.status === "CASCADE_WARN"
                    ? "border-amber-500/50 bg-amber-500/15 text-amber-400"
                    : "border-destructive/50 bg-destructive/15 text-destructive",
              )}
            >
              <ArrowRightLeft className="size-3.5" />
              <span>
                {drag.task.code} → {drag.targetEq}: {fmt(drag.targetBlockStart)} ~ {fmt(drag.check.newEnd)}
              </span>
              <span>· {drag.check.reason}</span>
            </div>
          )}
        </div>
      )}

      <div ref={canvasRef} className="overflow-x-auto rounded-md border bg-card select-none">
        <div className="relative" style={{ width: width + LABEL_W }}>
          {/* 상단 이중 타임라인 헤더 */}
          <div className="sticky top-0 z-20 flex h-10 border-b bg-secondary">
            <div
              className="sticky left-0 z-30 flex shrink-0 items-center justify-between border-r bg-secondary px-3 text-[11px] font-semibold text-muted-foreground"
              style={{ width: LABEL_W }}
            >
              <span>{viewMode === "MACHINE" ? "설비 (Capacity)" : "주문 · 로트"}</span>
              <span>{viewMode === "MACHINE" ? "공정" : "품목군"}</span>
            </div>
            <div className="relative" style={{ width }}>
              {Array.from({ length: days }, (_, d) => (
                <div
                  key={d}
                  className="num absolute top-0.5 border-l border-border-strong px-1.5 text-[11px] font-bold text-foreground"
                  style={{ left: d * 1440 * ppm }}
                >
                  {fmt(d * 1440).slice(0, 5)} (D+{d})
                </div>
              ))}
              {ticks.map((t) => (
                <div
                  key={t}
                  className="num absolute bottom-0.5 border-l border-border/60 pl-1 text-[10px] text-muted-foreground"
                  style={{ left: t * ppm }}
                >
                  {fmt(t).slice(6)}
                </div>
              ))}
            </div>
          </div>

          {/* 본문 행 + 오버레이 컨테이너 */}
          <div className="relative">
            {/* 현재 기준 시각 수직선 (Now Line) 및 동결 구간 (Freeze Horizon) */}
            <div
              className="pointer-events-none absolute inset-y-0 z-10"
              style={{ left: LABEL_W, width }}
            >
              {freezeMin > 0 && (
                <div
                  className="absolute inset-y-0 border-r border-dashed border-amber-500/50 bg-amber-500/8"
                  style={{ left: nowMin * ppm, width: freezeMin * ppm }}
                  title={`동결 구간 (Freeze Horizon): ${fmt(nowMin)} ~ ${fmt(nowMin + freezeMin)}`}
                />
              )}
              <div
                className="absolute inset-y-0 w-0.5 bg-destructive/80"
                style={{ left: nowMin * ppm }}
              />
              {earliestValidStartMin !== null && (
                <div
                  className="absolute inset-y-0 w-0.5 border-l-2 border-dashed border-sky-400"
                  style={{ left: earliestValidStartMin * ppm }}
                />
              )}
            </div>

            {/* SVG 선후행 연결 화살표 레이어 */}
            {dependencyPaths.length > 0 && (
              <svg
                className="pointer-events-none absolute inset-0 z-10"
                style={{ left: LABEL_W, width, height: machineRows.length * rowH }}
              >
                <defs>
                  <marker id="arrow-ok" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" className="text-sky-400" />
                  </marker>
                  <marker id="arrow-err" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" className="text-destructive" />
                  </marker>
                </defs>
                {dependencyPaths.map((ln) => {
                  const midX = (ln.x1 + ln.x2) / 2;
                  const d = `M ${ln.x1} ${ln.y1} C ${midX} ${ln.y1}, ${midX} ${ln.y2}, ${ln.x2} ${ln.y2}`;
                  return (
                    <path
                      key={ln.key}
                      d={d}
                      fill="none"
                      stroke={ln.isConflict ? "#ef4444" : "#38bdf8"}
                      strokeWidth={1.75}
                      strokeDasharray={ln.isConflict ? "4 2" : undefined}
                      markerEnd={ln.isConflict ? "url(#arrow-err)" : "url(#arrow-ok)"}
                      opacity={0.85}
                    />
                  );
                })}
              </svg>
            )}

            {/* 설비 중심 뷰 (Machine View) */}
            {viewMode === "MACHINE" &&
              machineRows.map(({ id, label, sub, eq, lane }) => {
                const rowTasks = tasks.filter((t) => t.eq === eq.code && t.lane === lane);
                const isBottleneck = highlightBottleneck && bottleneckEqs?.has(eq.code);
                const isEligibleForDrag =
                  drag ? eq.proc === drag.task.proc && eq.families.includes(drag.task.family) : null;

                return (
                  <div
                    key={id}
                    className={cn(
                      "flex border-b last:border-b-0 transition-colors",
                      isBottleneck && "bg-destructive/5",
                      isEligibleForDrag === true && "bg-emerald-500/8",
                      isEligibleForDrag === false && "opacity-35",
                    )}
                    style={{ height: rowH }}
                  >
                    {/* 좌측 고정 설비 라벨 */}
                    <div
                      className="sticky left-0 z-10 flex shrink-0 items-center justify-between border-r bg-card px-3"
                      style={{ width: LABEL_W }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "size-2 rounded-full",
                            eq.status === "DOWN"
                              ? "bg-destructive animate-pulse"
                              : eq.status === "PM"
                                ? "bg-amber-400"
                                : eq.status === "IDLE"
                                  ? "bg-muted-foreground"
                                  : "bg-emerald-400",
                          )}
                        />
                        <span className="num text-[12px] font-semibold">{label}</span>
                        {isBottleneck && <Flame className="size-3.5 text-destructive" aria-label="핵심 병목 설비" />}
                      </div>
                      <span className="text-[10px] font-medium text-muted-foreground">{sub}</span>
                    </div>

                    {/* 타임라인 바 영역 */}
                    <div className="relative" style={{ width }}>
                      {!eq.allDay &&
                        Array.from({ length: days }, (_, d) => (
                          <div
                            key={d}
                            className="absolute inset-y-0 bg-gantt-off"
                            style={{ left: (d * 1440 + SHIFT_MIN) * ppm, width: (1440 - SHIFT_MIN) * ppm }}
                          />
                        ))}
                      {downs
                        .filter((d) => d.eq === eq.code && !d.resolved)
                        .map((d) => (
                          <div
                            key={d.id}
                            title={`비가동 (${d.type}): ${d.reason} (${fmt(d.start)} ~ ${fmt(d.end)})`}
                            className="hatch-down absolute inset-y-0 z-10 flex items-center justify-center overflow-hidden border-x border-destructive px-1 text-[10px] font-bold text-destructive"
                            style={{ left: d.start * ppm, width: Math.max(8, (d.end - d.start) * ppm) }}
                          >
                            <span className="truncate bg-background/80 px-1 rounded">{d.reason}</span>
                          </div>
                        ))}

                      {/* 드래그 고스트 바 프리뷰 */}
                      {drag && drag.targetEq === eq.code && drag.targetLane === lane && (
                        <div
                          className={cn(
                            "pointer-events-none absolute top-1 z-20 flex h-[28px] items-center rounded-sm border-2 px-1.5 text-[10px] font-bold",
                            drag.check.status === "VALID"
                              ? "border-emerald-400 bg-emerald-500/25 text-emerald-200"
                              : drag.check.status === "CASCADE_WARN"
                                ? "border-amber-400 bg-amber-500/25 text-amber-200"
                                : "border-destructive bg-destructive/30 text-destructive-foreground",
                          )}
                          style={{
                            left: drag.targetBlockStart * ppm,
                            width: Math.max(16, (drag.check.newEnd - drag.targetBlockStart) * ppm),
                          }}
                        >
                          <span className="num truncate">{drag.task.code}</span>
                        </div>
                      )}

                      {rowTasks.map((t) => {
                        const dim = Boolean(highlightOrder && t.orderNo !== highlightOrder);
                        const hasConflict = conflictSet.has(t.code);
                        const ord = orders.find((o) => o.no === t.orderNo);
                        const isLate = Boolean(ord && t.end > ord.due);
                        const isBeingDragged = drag?.task.code === t.code;

                        return (
                          <button
                            key={t.code}
                            type="button"
                            onPointerDown={(e) => handlePointerDown(e, t)}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onKeyDown={(e) => handleTaskKeyDown(e, t)}
                            title={`${t.code} | ${t.orderNo} (Lot #${t.lot})\n품목: ${t.product} (${t.qty} EA)\n설비: ${t.eq} | 상태: ${t.taskStatus ?? "WAITING"}\n셋업: ${fmt(t.start - t.setup)} ~ ${fmt(t.start)} (${t.setup}분)\n본가공: ${fmt(t.start)} ~ ${fmt(t.end)} (${t.end - t.start}분)${t.pinned ? "\n🔒 위치 고정됨 (Pin)" : ""}`}
                            aria-label={`${t.code} ${fmt(t.start)}부터 ${fmt(t.end)}까지`}
                            className={cn(
                              "absolute top-1 flex h-[28px] overflow-hidden rounded-sm text-left transition-opacity focus-visible:outline-2 focus-visible:outline-ring",
                              editable && !t.pinned ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                              dim && "opacity-25",
                              isBeingDragged && "opacity-40",
                              selected === t.code && "ring-2 ring-foreground ring-offset-1 z-20",
                              hasConflict && "glow-conflict z-20",
                              t.taskStatus === "COMPLETED" && "opacity-75",
                            )}
                            style={{
                              left: (t.start - t.setup) * ppm,
                              width: Math.max(6, (t.end - t.start + t.setup) * ppm),
                            }}
                          >
                            {t.setup > 0 && (
                              <span
                                className="stripe-setup h-full shrink-0 border-r border-black/20"
                                style={{ width: Math.max(2, t.setup * ppm) }}
                              />
                            )}
                            <span
                              className={cn(
                                "flex h-full min-w-0 flex-1 items-center justify-between gap-1 px-1.5 text-[10.5px] font-semibold text-primary-foreground",
                                FAM_BG[t.family],
                              )}
                            >
                              <span className="num truncate">
                                {t.orderNo.slice(-4)}-L{t.lot}
                                {!compact && ` (${t.qty})`}
                              </span>
                              <span className="flex shrink-0 items-center gap-0.5">
                                {t.pinned && <Lock className="size-2.5 text-white/90" />}
                                {(hasConflict || isLate) && <AlertTriangle className="size-2.5 text-amber-200" />}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

            {/* 주문·로트 중심 뷰 (Order Demand Path View - frePPLe 스타일) */}
            {viewMode === "ORDER" &&
              orderRows.map(({ id, orderNo, lot, label, sub }) => {
                const rowTasks = tasks
                  .filter((t) => t.orderNo === orderNo && t.lot === lot)
                  .sort((a, b) => a.seq - b.seq);
                const ord = orders.find((o) => o.no === orderNo);
                return (
                  <div key={id} className="flex border-b last:border-b-0" style={{ height: rowH }}>
                    <div
                      className="sticky left-0 z-10 flex shrink-0 items-center justify-between border-r bg-card px-3"
                      style={{ width: LABEL_W }}
                    >
                      <span className="num text-[12px] font-semibold">{label}</span>
                      <Pill tone="muted">{sub}</Pill>
                    </div>
                    <div className="relative" style={{ width }}>
                      {/* 주문 납기일 수직 마커 */}
                      {ord && (
                        <div
                          className="absolute inset-y-0 z-10 border-l-2 border-dashed border-amber-400"
                          style={{ left: ord.due * ppm }}
                          title={`${orderNo} 납기: ${fmt(ord.due)}`}
                        />
                      )}
                      {rowTasks.map((t) => (
                        <button
                          key={t.code}
                          type="button"
                          onClick={() => onSelect?.(selected === t.code ? null : t.code)}
                          title={`${t.code} (${t.proc} @ ${t.eq})\n${fmt(t.start - t.setup)} ~ ${fmt(t.end)}`}
                          className={cn(
                            "absolute top-1 flex h-[28px] items-center overflow-hidden rounded-sm px-1.5 text-[10px] font-semibold text-primary-foreground",
                            FAM_BG[t.family],
                            selected === t.code && "ring-2 ring-foreground",
                          )}
                          style={{
                            left: (t.start - t.setup) * ppm,
                            width: Math.max(12, (t.end - t.start + t.setup) * ppm),
                          }}
                        >
                          <span className="num truncate">
                            {PROCESSES.find((p) => p.code === t.proc)?.short}:{t.eq}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
      {(["ECU", "ADAS", "IOT", "POWER"] as const).map((f) => (
        <span key={f} className="flex items-center gap-1">
          <span className={cn("size-2.5 rounded-sm", FAM_BG[f])} />
          {f}
        </span>
      ))}
      <span className="flex items-center gap-1">
        <span className="stripe-setup size-2.5 rounded-sm" />
        셋업(SDST)
      </span>
      <span className="flex items-center gap-1">
        <span className="hatch-down size-2.5 rounded-sm" />
        고장·비가동
      </span>
      <span className="flex items-center gap-1">
        <span className="size-2.5 rounded-sm bg-gantt-off ring-1 ring-border" />
        야간 휴무
      </span>
      <span className="flex items-center gap-1">
        <span className="size-2.5 rounded-sm border border-amber-500/60 bg-amber-500/20" />
        동결 구간
      </span>
    </div>
  );
}
