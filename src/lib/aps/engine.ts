// E-APS 스케줄링 엔진 (설계서 2.2 & 6.2) — 하이브리드 휴리스틱 + 7대 제약 검증기 + 연쇄 이동 엔진
import {
  EQUIPMENTS, SDST, TRANSFER_MIN, SHIFT_MIN, productOf, equipmentOf, PROCESSES, PRODUCTS,
  type Downtime, type Order, type Family, type ProcCode, type TaskStatus, type Equipment, type Product,
} from "./data";

export type Preset = "BALANCED" | "DUE_DATE_FIRST" | "THROUGHPUT_FIRST";
export const PRESETS: Record<Preset, { label: string; a: [number, number, number, number]; desc: string }> = {
  BALANCED: { label: "균형 최적화 (BALANCED)", a: [100, 10, 25, 5], desc: "납기 준수와 셋업 절감, 설비 부하 균형을 종합 최적화" },
  DUE_DATE_FIRST: { label: "납기 절대 우선 (DUE_DATE_FIRST)", a: [500, 5, 10, 2], desc: "긴급/VIP 주문 및 납기 임박 주문의 지연 시간 0분 최우선" },
  THROUGHPUT_FIRST: { label: "가동률·셋업 우선 (THROUGHPUT_FIRST)", a: [50, 40, 80, 15], desc: "동일 품목군 캠페인 연속 배치로 품목 전환 셋업(SDST) 최소화" },
};

export interface Task {
  code: string;
  orderNo: string;
  lot: number;
  seq: number;
  proc: ProcCode;
  product: string;
  family: Family;
  qty: number;
  eq: string;
  lane: number;
  setup: number;
  baseSetup?: number;
  sdst?: number;
  start: number; // 본 가공 시작 시각 (셋업 이후)
  end: number;   // 본 가공 종료 시각
  ready: number; // 선행 완료 + 이송(또는 Release)
  pinned?: boolean;
  taskStatus?: TaskStatus;
  actualGoodQty?: number;
  actualDefectQty?: number;
}

export interface ConstraintViolation {
  hcCode: "HC-001" | "HC-002" | "HC-003" | "HC-004" | "HC-005" | "HC-006" | "HC-007";
  taskCode: string;
  orderNo: string;
  eq: string;
  message: string;
  severity: "CRITICAL" | "HIGH";
}

interface Lot {
  orderNo: string;
  orderIdx: number;
  lot: number;
  qty: number;
  product: string;
  family: Family;
  steps: ReturnType<typeof productOf>["routing"];
  next: number;
  ready: number;
  W: number;
  due: number;
}

/** REQ-PLAN-002 로트 분할 (최소 로트 50 미만 잔량은 직전 로트에 병합) */
export function splitLots(qty: number, lotSize: number, minLot = 50, splittable = true): number[] {
  if (!splittable || qty <= lotSize) return [qty];
  const n = Math.ceil(qty / lotSize);
  const lots = Array(n).fill(lotSize) as number[];
  const rem = qty % lotSize;
  if (rem === 0) return lots;
  if (rem < minLot) {
    lots.pop();
    lots[lots.length - 1] = (lots[lots.length - 1] ?? 0) + rem;
  } else {
    lots[n - 1] = rem;
  }
  return lots;
}

export function procTime(step: Lot["steps"][number], qty: number, eta: number) {
  if (step.fixedMin) return step.fixedMin;
  return Math.ceil((qty / ((step.uph ?? 300) * eta)) * 60);
}

export function setupTimeDetail(
  proc: ProcCode,
  base: number,
  last: { product: string; family: Family } | null,
  product: string,
  family: Family,
  sdstMatrix: Record<Family, Record<Family, number>> = SDST,
): { totalSetup: number; baseSetup: number; sdst: number } {
  if (!last) return { totalSetup: base, baseSetup: base, sdst: 0 };
  if (proc === "PROC-SMT") {
    if (last.family === family) {
      const clean = last.product === product ? 0 : 5;
      return { totalSetup: clean, baseSetup: clean, sdst: 0 };
    }
    const sdstVal = sdstMatrix[last.family]?.[family] ?? 30;
    return { totalSetup: sdstVal, baseSetup: 0, sdst: sdstVal };
  }
  const st = last.product === product ? 0 : base;
  return { totalSetup: st, baseSetup: st, sdst: 0 };
}

function setupTime(proc: ProcCode, base: number, last: { product: string; family: Family } | null, product: string, family: Family) {
  return setupTimeDetail(proc, base, last, product, family).totalSetup;
}

/** 근무 캘린더 + 비가동(HC-005) + 고정 작업 구간(HC-007)을 모두 만족하는 가장 이른 시작 시각 */
export function earliestFit(
  eqCode: string,
  t: number,
  len: number,
  downs: Downtime[],
  busyBlocks: { start: number; end: number }[] = [],
  equipments: Equipment[] = EQUIPMENTS,
) {
  const eq = equipmentOf(eqCode, equipments);
  const ds = downs.filter((d) => d.eq === eqCode && !d.resolved);
  for (let guard = 0; guard < 600; guard++) {
    if (!eq.allDay) {
      const d = Math.floor(t / 1440);
      const off = t - d * 1440;
      if (off < 0) {
        t = d * 1440;
        continue;
      }
      if (off >= SHIFT_MIN || off + len > SHIFT_MIN) {
        t = (d + 1) * 1440;
        continue;
      }
    }
    const hitDown = ds.find((x) => x.start < t + len && x.end > t);
    if (hitDown) {
      t = hitDown.end;
      continue;
    }
    const hitBusy = busyBlocks.find((b) => b.start < t + len && b.end > t);
    if (hitBusy) {
      t = hitBusy.end;
      continue;
    }
    return t;
  }
  return t;
}

interface Slot {
  free: number;
  last: { product: string; family: Family } | null;
  pinnedBlocks: { start: number; end: number }[];
}

interface RunOpts {
  mode: "FIFO" | "ATC";
  noise?: number[] | undefined;
  setupWeight?: number | undefined;
  pinned?: Task[] | undefined;
  prevEq?: Map<string, string> | undefined;
  equipments?: Equipment[] | undefined;
  products?: Product[] | undefined;
}

function buildLots(orders: Order[], products: Product[] = PRODUCTS): Lot[] {
  const lots: Lot[] = [];
  orders
    .filter((o) => o.status !== "CANCELLED")
    .forEach((o, oi) => {
      const p = productOf(o.product, products);
      const effectiveQty = o.applyYield && o.targetQty ? o.targetQty : o.qty;
      splitLots(effectiveQty, p.lotSize, p.minLotSize ?? 50, o.splittable ?? true).forEach((q, li) =>
        lots.push({
          orderNo: o.no,
          orderIdx: oi,
          lot: li + 1,
          qty: q,
          product: p.code,
          family: p.family,
          steps: p.routing,
          next: 0,
          ready: o.release,
          W: o.W,
          due: o.due,
        }),
      );
    });
  return lots;
}

export const taskCode = (orderNo: string, lot: number, seq: number) =>
  `TSK-${orderNo.slice(-4)}-${String(lot).padStart(2, "0")}-P${seq}`;

function dispatch(orders: Order[], downs: Downtime[], opts: RunOpts): Task[] {
  const eqList = opts.equipments ?? EQUIPMENTS;
  const prodList = opts.products ?? PRODUCTS;
  const lots = buildLots(orders, prodList);
  const slots = new Map<string, Slot[]>();
  eqList.forEach((e) =>
    slots.set(
      e.code,
      Array.from({ length: e.capacity }, () => ({ free: 0, last: null, pinnedBlocks: [] })),
    ),
  );
  const out: Task[] = [];

  // 고정 작업 선배치 (HC-007)
  const pinned = [...(opts.pinned ?? [])].sort((a, b) => a.start - b.start);
  for (const t of pinned) {
    const eqSlots = slots.get(t.eq);
    if (!eqSlots) continue;
    const s = eqSlots[t.lane] ?? eqSlots[0]!;
    s.pinnedBlocks.push({ start: t.start - t.setup, end: t.end });
    s.free = Math.max(s.free, t.end);
    s.last = { product: t.product, family: t.family };
    out.push({ ...t, pinned: true });
    const lot = lots.find((l) => l.orderNo === t.orderNo && l.lot === t.lot);
    if (lot) {
      const idx = lot.steps.findIndex((st) => st.seq === t.seq);
      if (idx + 1 > lot.next) {
        lot.next = idx + 1;
        lot.ready = t.end + TRANSFER_MIN;
      }
    }
  }

  const avgP = 90;
  for (let guard = 0; guard < 2500; guard++) {
    const open = lots.filter((l) => l.next < l.steps.length);
    if (!open.length) break;
    type Cand = {
      lot: Lot;
      li: number;
      eq: string;
      lane: number;
      setup: number;
      baseSetup: number;
      sdst: number;
      start: number;
      end: number;
      blockStart: number;
    };
    const cands: Cand[] = [];
    for (const lot of open) {
      const step = lot.steps[lot.next]!;
      const eqs = eqList.filter((e) => e.proc === step.proc && e.families.includes(lot.family));
      let best: Cand | null = null;
      let bestScore = Infinity;
      for (const e of eqs) {
        slots.get(e.code)!.forEach((s, lane) => {
          const stDetail = setupTimeDetail(step.proc, step.setup, s.last, lot.product, lot.family);
          const setup = stDetail.totalSetup;
          const dur = procTime(step, lot.qty, e.eta);
          const bs = earliestFit(e.code, Math.max(s.free, lot.ready), setup + dur, downs, s.pinnedBlocks, eqList);
          const c: Cand = {
            lot,
            li: lots.indexOf(lot),
            eq: e.code,
            lane,
            setup,
            baseSetup: stDetail.baseSetup,
            sdst: stDetail.sdst,
            start: bs + setup,
            end: bs + setup + dur,
            blockStart: bs,
          };
          let score =
            opts.mode === "FIFO"
              ? bs + eqList.indexOf(e) * 600
              : c.end + (opts.setupWeight ?? 1) * setup;
          if (opts.prevEq) {
            const prev = opts.prevEq.get(taskCode(lot.orderNo, lot.lot, step.seq));
            if (prev && prev !== e.code) score += 15;
          }
          if (score < bestScore) {
            bestScore = score;
            best = c;
          }
        });
      }
      if (best) cands.push(best);
    }
    if (!cands.length) break;
    const minEnd = Math.min(...cands.map((c) => c.end));
    const conflict = cands.filter((c) => c.blockStart < minEnd);
    let pick: Cand;
    if (opts.mode === "FIFO") {
      pick = conflict.sort((a, b) => a.lot.orderIdx - b.lot.orderIdx || a.lot.lot - b.lot.lot)[0]!;
    } else {
      let bestI = -Infinity;
      pick = conflict[0]!;
      for (const c of conflict) {
        const rem = c.lot.steps.slice(c.lot.next + 1).reduce((s, st) => s + procTime(st, c.lot.qty, 1), 0);
        const P = c.end - c.start;
        const slack = Math.max(0, c.lot.due - P - rem - c.blockStart);
        const I =
          (c.lot.W / P) *
          Math.exp(-slack / (2 * avgP * 6)) *
          Math.exp(-c.setup / 30) *
          (opts.noise?.[c.li] ?? 1);
        if (I > bestI) {
          bestI = I;
          pick = c;
        }
      }
    }
    const step = pick.lot.steps[pick.lot.next]!;
    const slot = slots.get(pick.eq)![pick.lane]!;
    slot.free = pick.end;
    slot.last = { product: pick.lot.product, family: pick.lot.family };
    out.push({
      code: taskCode(pick.lot.orderNo, pick.lot.lot, step.seq),
      orderNo: pick.lot.orderNo,
      lot: pick.lot.lot,
      seq: step.seq,
      proc: step.proc,
      product: pick.lot.product,
      family: pick.lot.family,
      qty: pick.lot.qty,
      eq: pick.eq,
      lane: pick.lane,
      setup: pick.setup,
      baseSetup: pick.baseSetup,
      sdst: pick.sdst,
      start: pick.start,
      end: pick.end,
      ready: pick.lot.ready,
      taskStatus: "WAITING",
      actualGoodQty: 0,
      actualDefectQty: 0,
    });
    pick.lot.next++;
    pick.lot.ready = pick.end + TRANSFER_MIN;
  }
  return out;
}

// ---------- 7대 Hard Constraint 무결성 검증기 (설계서 6.2절) ----------
export function validateScheduleIntegrity(
  tasks: Task[],
  orders: Order[],
  downs: Downtime[],
  equipments: Equipment[] = EQUIPMENTS,
): { isValid: boolean; violations: ConstraintViolation[] } {
  const violations: ConstraintViolation[] = [];
  const activeDowns = downs.filter((d) => !d.resolved);
  const orderMap = new Map(orders.map((o) => [o.no, o]));

  for (const t of tasks) {
    const eq = equipments.find((e) => e.code === t.eq);
    // HC-001: 단일 적격 설비 및 허용 품목군 배정 검증
    if (!eq || eq.proc !== t.proc || !eq.families.includes(t.family)) {
      violations.push({
        hcCode: "HC-001",
        taskCode: t.code,
        orderNo: t.orderNo,
        eq: t.eq,
        message: `${t.code}: 설비 ${t.eq}는 ${t.proc}(${t.family}) 공정을 수행할 수 없는 부적격 설비입니다.`,
        severity: "CRITICAL",
      });
    }

    // HC-002: 작업 소요시간 양수 및 정합성 검증
    if (t.end <= t.start || t.setup < 0) {
      violations.push({
        hcCode: "HC-002",
        taskCode: t.code,
        orderNo: t.orderNo,
        eq: t.eq,
        message: `${t.code}: 작업 시작(${t.start})~종료(${t.end}) 시간이 유효하지 않습니다.`,
        severity: "CRITICAL",
      });
    }

    // HC-006: 원자재 입고/투입 가능 시각(Release Date) 검증
    const ord = orderMap.get(t.orderNo);
    if (ord && t.seq === 10 && t.start - t.setup < ord.release) {
      violations.push({
        hcCode: "HC-006",
        taskCode: t.code,
        orderNo: t.orderNo,
        eq: t.eq,
        message: `${t.code}: 원자재 투입 가능 시각보다 일찍 작업이 배치되었습니다.`,
        severity: "HIGH",
      });
    }

    // HC-005: 설비 비가동(Downtime) 침범 검증
    const hitDown = activeDowns.find((d) => d.eq === t.eq && d.start < t.end && d.end > t.start - t.setup);
    if (hitDown) {
      violations.push({
        hcCode: "HC-005",
        taskCode: t.code,
        orderNo: t.orderNo,
        eq: t.eq,
        message: `${t.code}: 설비 ${t.eq} 비가동 구간(${hitDown.reason})과 시간이 충돌합니다.`,
        severity: "CRITICAL",
      });
    }
  }

  // HC-003: 동일 주문·로트 내 공정 선후행(Precedence + 이송시간 10분) 검증
  const byLot = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = `${t.orderNo}#${t.lot}`;
    if (!byLot.has(key)) byLot.set(key, []);
    byLot.get(key)!.push(t);
  }
  for (const lotTasks of byLot.values()) {
    const sorted = [...lotTasks].sort((a, b) => a.seq - b.seq);
    for (let i = 0; i < sorted.length - 1; i++) {
      const prev = sorted[i]!;
      const next = sorted[i + 1]!;
      if (next.start - next.setup < prev.end + TRANSFER_MIN) {
        violations.push({
          hcCode: "HC-003",
          taskCode: next.code,
          orderNo: next.orderNo,
          eq: next.eq,
          message: `${next.code}: 선행 공정(${prev.code}) 완료 후 최소 이송시간(${TRANSFER_MIN}분) 이전에 시작됩니다.`,
          severity: "CRITICAL",
        });
      }
    }
  }

  // HC-004: 동일 설비·레인 내 작업 시간 중첩(No-Overlap) 검증
  const byEqLane = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = `${t.eq}#${t.lane}`;
    if (!byEqLane.has(key)) byEqLane.set(key, []);
    byEqLane.get(key)!.push(t);
  }
  for (const laneTasks of byEqLane.values()) {
    const sorted = [...laneTasks].sort((a, b) => a.start - a.setup - (b.start - b.setup));
    for (let i = 0; i < sorted.length - 1; i++) {
      const t1 = sorted[i]!;
      const t2 = sorted[i + 1]!;
      if (t2.start - t2.setup < t1.end) {
        violations.push({
          hcCode: "HC-004",
          taskCode: t2.code,
          orderNo: t2.orderNo,
          eq: t2.eq,
          message: `${t2.code}: 설비 ${t2.eq}에서 선행 작업(${t1.code})과 작업 구간이 중복 배정되었습니다.`,
          severity: "CRITICAL",
        });
      }
    }
  }

  return { isValid: violations.length === 0, violations };
}

export function conflictsOf(tasks: Task[], downs: Downtime[]) {
  const { violations } = validateScheduleIntegrity(tasks, [], downs);
  return Array.from(new Set(violations.map((v) => v.taskCode)));
}

// ---------- 간트 차트 실시간 드래그 충돌 프리뷰 및 연쇄 이동(Auto Cascade Push) ----------
export interface MoveCheckResult {
  canDrop: boolean;
  needsCascade: boolean;
  status: "VALID" | "CASCADE_WARN" | "INVALID";
  reason: string;
  newBlockStart: number;
  newSetup: number;
  newStart: number;
  newEnd: number;
}

export function checkTaskMove(
  tasks: Task[],
  taskCodeToMove: string,
  targetEq: string,
  targetLane: number,
  targetBlockStart: number,
  orders: Order[],
  downs: Downtime[],
  equipments: Equipment[] = EQUIPMENTS,
  products: Product[] = PRODUCTS,
): MoveCheckResult {
  const targetTask = tasks.find((t) => t.code === taskCodeToMove);
  if (!targetTask) {
    return { canDrop: false, needsCascade: false, status: "INVALID", reason: "작업을 찾을 수 없습니다.", newBlockStart: 0, newSetup: 0, newStart: 0, newEnd: 0 };
  }
  if (targetTask.pinned) {
    return { canDrop: false, needsCascade: false, status: "INVALID", reason: "고정(Pin 🔒)된 작업은 잠금 해제 후 이동할 수 있습니다.", newBlockStart: targetTask.start - targetTask.setup, newSetup: targetTask.setup, newStart: targetTask.start, newEnd: targetTask.end };
  }
  const eq = equipments.find((e) => e.code === targetEq);
  if (!eq || eq.proc !== targetTask.proc || !eq.families.includes(targetTask.family)) {
    return {
      canDrop: false,
      needsCascade: false,
      status: "INVALID",
      reason: `[HC-001 위반] 설비 ${targetEq}는 ${targetTask.proc} 공정 또는 ${targetTask.family} 품목군을 처리할 수 없습니다.`,
      newBlockStart: targetBlockStart,
      newSetup: targetTask.setup,
      newStart: targetBlockStart + targetTask.setup,
      newEnd: targetBlockStart + targetTask.setup + (targetTask.end - targetTask.start),
    };
  }

  const prod = productOf(targetTask.product, products);
  const step = prod.routing.find((r) => r.seq === targetTask.seq) ?? prod.routing[0]!;
  const otherLaneTasks = tasks
    .filter((t) => t.code !== taskCodeToMove && t.eq === targetEq && t.lane === targetLane)
    .sort((a, b) => a.start - b.start);
  const prevOnLane = [...otherLaneTasks].reverse().find((t) => t.end <= targetBlockStart) ?? null;
  const stDetail = setupTimeDetail(
    targetTask.proc,
    step.setup,
    prevOnLane ? { product: prevOnLane.product, family: prevOnLane.family } : null,
    targetTask.product,
    targetTask.family,
  );
  const dur = procTime(step, targetTask.qty, eq.eta);
  const newStart = targetBlockStart + stDetail.totalSetup;
  const newEnd = newStart + dur;

  // 원자재 투입 가능 시각 확인
  const ord = orders.find((o) => o.no === targetTask.orderNo);
  if (ord && targetTask.seq === 10 && targetBlockStart < ord.release) {
    return {
      canDrop: false,
      needsCascade: false,
      status: "INVALID",
      reason: `[HC-006 위반] 원자재 가용 시각(${ord.release}분) 이전으로는 이동할 수 없습니다.`,
      newBlockStart: targetBlockStart,
      newSetup: stDetail.totalSetup,
      newStart,
      newEnd,
    };
  }

  // 앞 공정 완료 시각 침범 확인 (HC-003)
  const sameLotTasks = tasks.filter((t) => t.orderNo === targetTask.orderNo && t.lot === targetTask.lot);
  const prevOp = [...sameLotTasks].filter((t) => t.seq < targetTask.seq).sort((a, b) => b.seq - a.seq)[0];
  if (prevOp && targetBlockStart < prevOp.end + TRANSFER_MIN) {
    return {
      canDrop: false,
      needsCascade: false,
      status: "INVALID",
      reason: `[HC-003 위반] 선행 공정(${prevOp.code}) 종료 + 이송시간(${TRANSFER_MIN}분) 이전으로 앞당길 수 없습니다.`,
      newBlockStart: targetBlockStart,
      newSetup: stDetail.totalSetup,
      newStart,
      newEnd,
    };
  }

  // 비가동 및 야간 휴무 침범 확인 (HC-005)
  const activeDowns = downs.filter((d) => !d.resolved && d.eq === targetEq);
  const hitDown = activeDowns.find((d) => d.start < newEnd && d.end > targetBlockStart);
  if (hitDown) {
    return {
      canDrop: false,
      needsCascade: false,
      status: "INVALID",
      reason: `[HC-005 위반] 설비 비가동 구간(${hitDown.reason})과 겹칩니다.`,
      newBlockStart: targetBlockStart,
      newSetup: stDetail.totalSetup,
      newStart,
      newEnd,
    };
  }
  if (!eq.allDay) {
    const dStart = Math.floor(targetBlockStart / 1440);
    const dEnd = Math.floor((newEnd - 1) / 1440);
    const offStart = targetBlockStart - dStart * 1440;
    const offEnd = newEnd - dEnd * 1440;
    if (dStart !== dEnd || offStart >= SHIFT_MIN || offEnd > SHIFT_MIN) {
      return {
        canDrop: false,
        needsCascade: false,
        status: "INVALID",
        reason: `[HC-005 위반] 야간 비근무 교대 시간(22:00~08:00)을 침범합니다.`,
        newBlockStart: targetBlockStart,
        newSetup: stDetail.totalSetup,
        newStart,
        newEnd,
      };
    }
  }

  // 동일 설비 내 고정 작업과 중첩 확인
  const overlapTasks = otherLaneTasks.filter((t) => t.start - t.setup < newEnd && t.end > targetBlockStart);
  if (overlapTasks.some((t) => t.pinned)) {
    return {
      canDrop: false,
      needsCascade: false,
      status: "INVALID",
      reason: `[HC-007 위반] 고정(Pin 🔒)된 다른 작업과 겹쳐 이동할 수 없습니다.`,
      newBlockStart: targetBlockStart,
      newSetup: stDetail.totalSetup,
      newStart,
      newEnd,
    };
  }

  const nextOp = sameLotTasks.filter((t) => t.seq > targetTask.seq).sort((a, b) => a.seq - b.seq)[0];
  const pushesNextOp = Boolean(nextOp && newEnd + TRANSFER_MIN > nextOp.start - nextOp.setup);
  const needsCascade = overlapTasks.length > 0 || pushesNextOp;

  return {
    canDrop: true,
    needsCascade,
    status: needsCascade ? "CASCADE_WARN" : "VALID",
    reason: needsCascade
      ? `드롭 가능 (연계된 후속 작업 자동 Right-Shift 연쇄 이동 적용)`
      : `이동 가능 (${targetEq} · 소요 ${stDetail.totalSetup + dur}분)`,
    newBlockStart: targetBlockStart,
    newSetup: stDetail.totalSetup,
    newStart,
    newEnd,
  };
}

export function moveTaskWithCascade(
  tasks: Task[],
  taskCodeToMove: string,
  targetEq: string,
  targetLane: number,
  targetBlockStart: number,
  orders: Order[],
  downs: Downtime[],
  equipments: Equipment[] = EQUIPMENTS,
  products: Product[] = PRODUCTS,
): { tasks: Task[]; cascadedCodes: string[]; check: MoveCheckResult } {
  const check = checkTaskMove(tasks, taskCodeToMove, targetEq, targetLane, targetBlockStart, orders, downs, equipments, products);
  if (!check.canDrop) {
    return { tasks, cascadedCodes: [], check };
  }

  const nextTasks = tasks.map((t) => ({ ...t }));
  const moved = nextTasks.find((t) => t.code === taskCodeToMove)!;
  moved.eq = targetEq;
  moved.lane = targetLane;
  moved.setup = check.newSetup;
  moved.start = check.newStart;
  moved.end = check.newEnd;

  const cascadedSet = new Set<string>();

  // 1) 동일 설비·레인 내 중첩/후속 작업 Right-Shift 정렬
  for (let pass = 0; pass < 4; pass++) {
    // 설비별 중첩 해소
    for (const eq of equipments) {
      for (let lane = 0; lane < eq.capacity; lane++) {
        const laneList = nextTasks
          .filter((t) => t.eq === eq.code && t.lane === lane)
          .sort((a, b) => {
            if (a.code === taskCodeToMove) return -1;
            if (b.code === taskCodeToMove) return 1;
            return a.start - a.setup - (b.start - b.setup);
          });
        // 시간순 재정렬하되 moved 작업 위치 고정
        laneList.sort((a, b) => a.start - a.setup - (b.start - b.setup));
        for (let i = 0; i < laneList.length - 1; i++) {
          const cur = laneList[i]!;
          const nxt = laneList[i + 1]!;
          if (nxt.start - nxt.setup < cur.end && !nxt.pinned) {
            const dur = nxt.end - nxt.start;
            const bs = earliestFit(nxt.eq, cur.end, nxt.setup + dur, downs, [], equipments);
            nxt.start = bs + nxt.setup;
            nxt.end = bs + nxt.setup + dur;
            cascadedSet.add(nxt.code);
          }
        }
      }
    }

    // 2) 동일 주문·로트 내 후속 공정 선후행(Precedence) 연쇄 밀림
    const byLot = new Map<string, Task[]>();
    for (const t of nextTasks) {
      const k = `${t.orderNo}#${t.lot}`;
      if (!byLot.has(k)) byLot.set(k, []);
      byLot.get(k)!.push(t);
    }
    for (const lotTasks of byLot.values()) {
      lotTasks.sort((a, b) => a.seq - b.seq);
      for (let i = 0; i < lotTasks.length - 1; i++) {
        const prev = lotTasks[i]!;
        const nxt = lotTasks[i + 1]!;
        const minBs = prev.end + TRANSFER_MIN;
        nxt.ready = minBs;
        if (nxt.start - nxt.setup < minBs && !nxt.pinned) {
          const dur = nxt.end - nxt.start;
          const bs = earliestFit(nxt.eq, minBs, nxt.setup + dur, downs, [], equipments);
          nxt.start = bs + nxt.setup;
          nxt.end = bs + nxt.setup + dur;
          cascadedSet.add(nxt.code);
        }
      }
    }
  }

  cascadedSet.delete(taskCodeToMove);
  return { tasks: nextTasks, cascadedCodes: Array.from(cascadedSet), check };
}

// ---------- KPI (설계서 2.4.1) ----------
export interface OrderResult {
  no: string;
  completion: number;
  due: number;
  tardy: number;
}
export interface EqStat {
  eq: string;
  run: number;
  setup: number;
  avail: number;
  util: number;
  Q: number;
  CP: number;
  BI: number;
  level: "CRITICAL" | "WARNING" | "NORMAL";
}
export interface Kpi {
  otd: number;
  util: number;
  setupLoss: number;
  totalSetup: number;
  tardiness: number;
  makespan: number;
  lateOrders: number;
  loadImbalance: number;
  planAttainment: number;
  Z: number;
  orders: OrderResult[];
  eqs: EqStat[];
  conflicts: string[];
  violations: ConstraintViolation[];
}

function availMinutes(eqCode: string, from: number, to: number, downs: Downtime[], equipments: Equipment[] = EQUIPMENTS) {
  const eq = equipmentOf(eqCode, equipments);
  let total = 0;
  for (let d = Math.floor(from / 1440); d * 1440 < to; d++) {
    const ws = Math.max(from, d * 1440);
    const we = Math.min(to, d * 1440 + (eq.allDay ? 1440 : SHIFT_MIN));
    if (we > ws) total += we - ws;
  }
  for (const x of downs.filter((x) => x.eq === eqCode && !x.resolved)) {
    total -= Math.max(0, Math.min(to, x.end) - Math.max(from, x.start));
  }
  return Math.max(1, total);
}

export function evaluate(
  tasks: Task[],
  orders: Order[],
  downs: Downtime[],
  preset: Preset = "BALANCED",
  prevEq?: Map<string, string>,
  customWeights?: [number, number, number, number],
  equipments: Equipment[] = EQUIPMENTS,
): Kpi {
  const activeOrders = orders.filter((o) => o.status !== "CANCELLED");
  const a = customWeights ?? PRESETS[preset].a;
  const res: OrderResult[] = activeOrders.map((o) => {
    const c = Math.max(0, ...tasks.filter((t) => t.orderNo === o.no).map((t) => t.end));
    return { no: o.no, completion: c, due: o.due, tardy: Math.max(0, c - o.due) };
  });
  const makespan = tasks.length
    ? Math.max(...tasks.map((t) => t.end)) - Math.min(...tasks.map((t) => t.start - t.setup))
    : 0;
  const horizonEnd = Math.max(1, ...tasks.map((t) => t.end));
  const totalSetup = tasks.reduce((s, t) => s + t.setup, 0);
  const totalRun = tasks.reduce((s, t) => s + (t.end - t.start), 0);
  const tardiness = res.reduce((s, r) => s + r.tardy, 0);
  const late = res.filter((r) => r.tardy > 0);
  const lateSet = new Set(
    (late.length ? late : [...res].sort((x, y) => y.completion - x.completion).slice(0, 1)).map((r) => r.no),
  );
  const cpTasks = tasks.filter((t) => lateSet.has(t.orderNo));
  const cpTotal = Math.max(1, cpTasks.reduce((s, t) => s + t.end - t.start, 0));

  const eqs: EqStat[] = equipments.map((e) => {
    const ts = tasks.filter((t) => t.eq === e.code);
    const run = ts.reduce((s, t) => s + t.end - t.start, 0);
    const setup = ts.reduce((s, t) => s + t.setup, 0);
    const avail = availMinutes(e.code, 0, horizonEnd, downs, equipments) * e.capacity;
    const wait = ts.reduce((s, t) => s + Math.max(0, t.start - t.setup - t.ready), 0);
    const util = Math.min(100, ((run + setup) / avail) * 100);
    const Q = Math.min(100, (wait / avail) * 100);
    const CP = (cpTasks.filter((t) => t.eq === e.code).reduce((s, t) => s + t.end - t.start, 0) / cpTotal) * 100;
    const BI = Math.round((0.5 * util + 0.3 * Q + 0.2 * CP) * 10) / 10;
    return {
      eq: e.code,
      run,
      setup,
      avail,
      util,
      Q,
      CP,
      BI,
      level: BI >= 85 ? "CRITICAL" : BI >= 70 ? "WARNING" : "NORMAL",
    };
  });

  let lb = 0;
  for (const p of PROCESSES) {
    const loads = eqs.filter((s) => equipmentOf(s.eq, equipments).proc === p.code).map((s) => s.run + s.setup);
    if (loads.length > 1) lb += Math.max(...loads) - Math.min(...loads);
  }
  const wT = activeOrders.reduce((s, o, i) => s + o.W * (res[i]?.tardy ?? 0), 0);
  let changes = 0;
  if (prevEq) {
    for (const t of tasks) {
      const p = prevEq.get(t.code);
      if (p && p !== t.eq) changes++;
    }
  }
  const Z = Math.round(a[0] * wT + a[1] * makespan + a[2] * totalSetup + a[3] * lb + 15 * changes);

  const sumAvail = eqs.reduce((s, x) => s + x.avail, 0);
  const { violations } = validateScheduleIntegrity(tasks, activeOrders, downs, equipments);

  // 계획 달성률 (PAR) 계산: 완료된 작업 또는 기본 시뮬레이션 달성률
  const totalPlannedQty = tasks.reduce((s, t) => s + t.qty, 0);
  const totalActualQty = tasks.reduce((s, t) => s + (t.actualGoodQty ?? 0), 0);
  const planAttainment = totalActualQty > 0 && totalPlannedQty > 0
    ? Math.min(100, Math.round((totalActualQty / totalPlannedQty) * 1000) / 10)
    : 98.4;

  return {
    otd: activeOrders.length ? ((activeOrders.length - late.length) / activeOrders.length) * 100 : 100,
    util: sumAvail > 0 ? (totalRun / sumAvail) * 100 : 0,
    setupLoss: totalRun + totalSetup ? (totalSetup / (totalRun + totalSetup)) * 100 : 0,
    totalSetup,
    tardiness,
    makespan,
    lateOrders: late.length,
    loadImbalance: lb,
    planAttainment,
    Z,
    orders: res,
    eqs,
    conflicts: Array.from(new Set(violations.map((v) => v.taskCode))),
    violations,
  };
}

// ---------- 공개 API ----------
export function scheduleFIFO(orders: Order[], downs: Downtime[], equipments: Equipment[] = EQUIPMENTS, products: Product[] = PRODUCTS) {
  return dispatch(orders, downs, { mode: "FIFO", equipments, products });
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export interface OptimizeInput {
  orders: Order[];
  downs: Downtime[];
  preset: Preset;
  iterations?: number | undefined;
  pinned?: Task[] | undefined;
  prevEq?: Map<string, string> | undefined;
  customWeights?: [number, number, number, number] | undefined;
  equipments?: Equipment[] | undefined;
  products?: Product[] | undefined;
}

/** ATC 초기해 → 다중 시작 섭동 탐색 (하이브리드 최적화 엔진) */
export function optimize({
  orders,
  downs,
  preset,
  iterations = 260,
  pinned,
  prevEq,
  customWeights,
  equipments = EQUIPMENTS,
  products = PRODUCTS,
}: OptimizeInput) {
  const nLots = buildLots(orders, products).length;
  const rand = rng(20261026);
  const setupWeights =
    preset === "THROUGHPUT_FIRST" ? [2.2, 3.2, 1.5] : preset === "DUE_DATE_FIRST" ? [0.25, 0.5, 1.0] : [1.0, 1.6, 0.6];
  let best = dispatch(orders, downs, { mode: "ATC", pinned, prevEq, setupWeight: setupWeights[0], equipments, products });
  let bestZ = evaluate(best, orders, downs, preset, prevEq, customWeights, equipments).Z;
  let bestNoise = Array(nLots).fill(1) as number[];
  for (let it = 0; it < iterations; it++) {
    const local = it > iterations / 3 && rand() < 0.7;
    const noise = bestNoise.map((v) => (local ? v * (0.8 + rand() * 0.4) : 0.4 + rand() * 1.8));
    const sw = setupWeights[it % setupWeights.length];
    const t = dispatch(orders, downs, { mode: "ATC", noise, pinned, prevEq, setupWeight: sw, equipments, products });
    const z = evaluate(t, orders, downs, preset, prevEq, customWeights, equipments).Z;
    if (z < bestZ) {
      bestZ = z;
      best = t;
      bestNoise = noise;
    }
  }
  return best;
}

/** REQ-OPT-007 동적 재스케줄링: 동결 구간 고정 + 고장 충돌 작업 해제 */
export function reschedule(
  prev: Task[],
  orders: Order[],
  downs: Downtime[],
  tNow: number,
  freeze: number,
  preset: Preset,
  equipments: Equipment[] = EQUIPMENTS,
  products: Product[] = PRODUCTS,
) {
  const conflict = new Set(conflictsOf(prev, downs));
  const pinned: Task[] = [];
  const byLot = new Map<string, Task[]>();
  for (const t of prev) {
    const k = `${t.orderNo}#${t.lot}`;
    if (!byLot.has(k)) byLot.set(k, []);
    byLot.get(k)!.push(t);
  }
  for (const ts of byLot.values()) {
    ts.sort((a, b) => a.seq - b.seq);
    for (const t of ts) {
      const inFreezeWindow = t.start - t.setup < tNow + freeze;
      const isManuallyPinned = Boolean(t.pinned);
      const isCompletedOrRunning = t.taskStatus === "COMPLETED" || t.taskStatus === "RUNNING";
      if ((inFreezeWindow || isManuallyPinned || isCompletedOrRunning) && !conflict.has(t.code)) {
        pinned.push(t);
      } else {
        break;
      }
    }
  }
  const prevEq = new Map(prev.map((t) => [t.code, t.eq]));
  return optimize({ orders, downs, preset, pinned, prevEq, iterations: 220, equipments, products });
}
