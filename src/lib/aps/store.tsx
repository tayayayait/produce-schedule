import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ORDERS, EQUIPMENTS, PRODUCTS, SDST, at,
  type Downtime, type Order, type Equipment, type Product, type Family, type Role, type EquipmentStatus, type TaskStatus,
} from "./data";
import {
  evaluate, optimize, reschedule, scheduleFIFO, moveTaskWithCascade,
  type Kpi, type Preset, type Task, type MoveCheckResult,
} from "./engine";

export type ScenarioId = "A" | "B" | "C" | "D";
export const SCENARIOS: Record<ScenarioId, { title: string; desc: string }> = {
  A: { title: "A. 정상 계획 · FIFO 대비 최적화", desc: "주문 10건을 등록순(FIFO)으로 배정한 계획을 AI 최적화와 비교" },
  B: { title: "B. 납기 충돌 · SMT-01 병목 해소", desc: "ADAS 긴급 주문 PO-0011 추가로 SMT-01 과부하, 납기 우선 전략으로 해소" },
  C: { title: "C. SMT-02 돌발 고장 재스케줄링", desc: "확정 계획 진행 중 10-26 14:00~18:00 SMT-02 고장 → 긴급 재스케줄링" },
  D: { title: "D. 긴급 VIP 주문 중도 삽입", desc: "10-27 09:00 PO-0012 접수 → 동결 구간 유지 부분 재스케줄링" },
};

export const SCENARIO_C_DOWN: Downtime = {
  id: "DT-SMT02-BREAKDOWN",
  eq: "SMT-02",
  start: at(0, "14:00"),
  end: at(0, "18:00"),
  reason: "노즐 헤드 서보모터 이상 (돌발 고장)",
  type: "BREAKDOWN",
};
export const SCENARIO_C_TIME = at(0, "14:00");
export const SCENARIO_D_TIME = at(1, "09:00");

export interface Version {
  id: string; // PLN-20261026-V01
  label: string;
  method: string;
  preset: Preset;
  status: "DRAFT" | "REVIEW" | "CONFIRMED" | "SUPERSEDED" | "CANCELLED";
  tasks: Task[];
  orders: Order[];
  downs: Downtime[];
  kpi: Kpi;
  solveTimeSec?: number;
  createdAt?: string;
}

interface Ctx {
  scenario: ScenarioId;
  role: Role;
  theme: "dark" | "light";
  nowMin: number;
  freezeMin: number;
  orders: Order[];
  equipments: Equipment[];
  products: Product[];
  sdstMatrix: Record<Family, Record<Family, number>>;
  downs: Downtime[];
  versions: Version[];
  current: Version;
  currentKpi: Kpi;
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  isDirty: boolean;
  setRole: (r: Role) => void;
  toggleTheme: () => void;
  setNowMin: (m: number) => void;
  setFreezeMin: (m: number) => void;
  loadScenario: (s: ScenarioId) => void;
  setCurrent: (id: string) => void;
  runOptimize: (preset: Preset, customWeights?: [number, number, number, number]) => Promise<void>;
  rescheduleNow: (tNow: number, freeze: number, preset: Preset) => Promise<void>;
  generatePlanFromOrders: (orderNos: string[], label?: string) => void;
  addDowntime: (d: Omit<Downtime, "id">) => void;
  removeDowntime: (id: string) => void;
  addOrder: (o: Order) => void;
  updateOrder: (no: string, patch: Partial<Order>) => void;
  cancelOrder: (no: string, reason: string) => void;
  updateEquipmentStatus: (eqCode: string, status: EquipmentStatus) => void;
  updateEquipmentSpec: (eqCode: string, patch: Partial<Equipment>) => void;
  updateProductRouting: (productCode: string, seq: number, patch: { uph?: number; setup?: number; defectRate?: number }) => void;
  updateSdst: (fromFam: Family, toFam: Family, val: number) => void;
  moveTask: (taskCode: string, targetEq: string, targetLane: number, targetBlockStart: number) => { cascadedCodes: string[]; check: MoveCheckResult };
  togglePinTask: (taskCode: string) => void;
  updateTaskStatus: (taskCode: string, status: TaskStatus, goodQty?: number, defectQty?: number) => void;
  undo: () => void;
  redo: () => void;
  saveDraft: () => void;
  confirm: (id: string) => void;
  cancelVersion: (id: string) => void;
}

const ApsContext = createContext<Ctx | null>(null);

const mkVersion = (
  n: number,
  label: string,
  method: string,
  preset: Preset,
  tasks: Task[],
  orders: Order[],
  downs: Downtime[],
  status: Version["status"] = "DRAFT",
  solveTimeSec = 1.42,
): Version => ({
  id: `PLN-20261026-V${String(n).padStart(2, "0")}`,
  label,
  method,
  preset,
  status,
  tasks,
  orders,
  downs,
  kpi: evaluate(tasks, orders, downs, preset),
  solveTimeSec,
  createdAt: "2026-10-26 14:30",
});

function initial(s: ScenarioId) {
  const base = ORDERS.slice(0, 10).map((o) => ({ ...o, status: "CONFIRMED" as const }));
  const eqs = EQUIPMENTS.map((e) => ({ ...e }));

  if (s === "A") {
    const v1 = mkVersion(1, "Before · FIFO 규칙 배정", "FIFO 등록순", "BALANCED", scheduleFIFO(base, []), base, [], "DRAFT", 0.08);
    return {
      orders: base,
      downs: [] as Downtime[],
      equipments: eqs,
      nowMin: 0,
      versions: [v1],
    };
  }
  if (s === "B") {
    const o = ORDERS.slice(0, 11).map((ord) => ({ ...ord, status: "CONFIRMED" as const }));
    const v1 = mkVersion(1, "Before · FIFO (PO-0011 납기경합)", "FIFO 등록순", "BALANCED", scheduleFIFO(o, []), o, [], "DRAFT", 0.09);
    return {
      orders: o,
      downs: [] as Downtime[],
      equipments: eqs,
      nowMin: 0,
      versions: [v1],
    };
  }
  if (s === "C") {
    const v1 = mkVersion(1, "Before · FIFO 초기 배정", "FIFO 등록순", "BALANCED", scheduleFIFO(base, []), base, [], "SUPERSEDED", 0.08);
    const optTasks = optimize({ orders: base, downs: [], preset: "BALANCED" });
    // 14:00 이전 시작된 첫 공정 작업들을 RUNNING/COMPLETED로 표시
    const cTasks = optTasks.map((t) => {
      if (t.end <= SCENARIO_C_TIME) {
        return { ...t, taskStatus: "COMPLETED" as const, actualGoodQty: t.qty, pinned: true };
      }
      if (t.start - t.setup < SCENARIO_C_TIME && t.end > SCENARIO_C_TIME && t.eq !== "SMT-02") {
        return { ...t, taskStatus: "RUNNING" as const, actualGoodQty: Math.floor(t.qty * 0.5), pinned: true };
      }
      return t;
    });
    const v2 = mkVersion(2, "확정 계획 · AI 최적화 (고장 발생)", "ATC + 다중시작 탐색", "BALANCED", cTasks, base, [SCENARIO_C_DOWN], "CONFIRMED", 2.14);
    const eqsC = eqs.map((e) => (e.code === "SMT-02" ? { ...e, status: "DOWN" as const } : e));
    return {
      orders: base,
      downs: [SCENARIO_C_DOWN],
      equipments: eqsC,
      nowMin: SCENARIO_C_TIME,
      versions: [v1, v2],
    };
  }
  // Scenario D: 긴급 VIP 주문 PO-0012 중도 삽입
  const oD = [...base, { ...ORDERS[11]!, status: "REGISTERED" as const }];
  const v1 = mkVersion(1, "Before · FIFO 초기 배정", "FIFO 등록순", "BALANCED", scheduleFIFO(base, []), base, [], "SUPERSEDED", 0.08);
  const v2Tasks = optimize({ orders: base, downs: [], preset: "BALANCED" });
  const v2 = mkVersion(2, "기존 확정 계획 (PO-0012 반영 전)", "ATC + 다중시작 탐색", "BALANCED", v2Tasks, base, [], "CONFIRMED", 1.95);
  return {
    orders: oD,
    downs: [] as Downtime[],
    equipments: eqs,
    nowMin: SCENARIO_D_TIME,
    versions: [v1, v2],
  };
}

const tick = () => new Promise((r) => setTimeout(r, 380));

export function ApsProvider({ children }: { children: ReactNode }) {
  const [scenario, setScenario] = useState<ScenarioId>("A");
  const [role, setRole] = useState<Role>("PLANNER");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const init = useMemo(() => initial("A"), []);
  const [nowMin, setNowMin] = useState<number>(init.nowMin);
  const [freezeMin, setFreezeMin] = useState<number>(120);
  const [orders, setOrders] = useState<Order[]>(init.orders);
  const [equipments, setEquipments] = useState<Equipment[]>(init.equipments);
  const [products, setProducts] = useState<Product[]>(() => PRODUCTS.map((p) => ({ ...p, routing: p.routing.map((r) => ({ ...r })) })));
  const [sdstMatrix, setSdstMatrix] = useState<Record<Family, Record<Family, number>>>(() => JSON.parse(JSON.stringify(SDST)));
  const [downs, setDowns] = useState<Downtime[]>(init.downs);
  const [versions, setVersions] = useState<Version[]>(init.versions);
  const [currentId, setCurrentId] = useState(init.versions[init.versions.length - 1]!.id);
  const [busy, setBusy] = useState(false);
  const [undoStack, setUndoStack] = useState<Task[][]>([]);
  const [redoStack, setRedoStack] = useState<Task[][]>([]);
  const [isDirty, setIsDirty] = useState(false);

  // 다크 모드 클래스 동기화
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", theme === "dark");
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const current = versions.find((v) => v.id === currentId) ?? versions[versions.length - 1]!;
  const currentKpi = useMemo(
    () => evaluate(current.tasks, orders, downs, current.preset, undefined, undefined, equipments),
    [current, orders, downs, equipments],
  );

  const loadScenario = useCallback((s: ScenarioId) => {
    const st = initial(s);
    setScenario(s);
    setOrders(st.orders);
    setDowns(st.downs);
    setEquipments(st.equipments);
    setNowMin(st.nowMin);
    setVersions(st.versions);
    setCurrentId(st.versions[st.versions.length - 1]!.id);
    setUndoStack([]);
    setRedoStack([]);
    setIsDirty(false);
  }, []);

  const push = useCallback((v: Version) => {
    setVersions((vs) => [...vs, v]);
    setCurrentId(v.id);
    setUndoStack([]);
    setRedoStack([]);
    setIsDirty(false);
  }, []);

  const updateCurrentTasks = useCallback((nextTasks: Task[], recordUndo = true) => {
    setVersions((vs) =>
      vs.map((v) => {
        if (v.id !== current.id) return v;
        if (recordUndo) {
          setUndoStack((st) => [...st.slice(-19), v.tasks]);
          setRedoStack([]);
          setIsDirty(true);
        }
        try {
          if (typeof sessionStorage !== "undefined") {
            sessionStorage.setItem(`eaps_unsaved_schedule_diff_${v.id}`, JSON.stringify(nextTasks));
          }
        } catch {
          // ignore storage errors
        }
        return {
          ...v,
          tasks: nextTasks,
          kpi: evaluate(nextTasks, orders, downs, v.preset, undefined, undefined, equipments),
        };
      }),
    );
  }, [current.id, orders, downs, equipments]);

  const runOptimize = useCallback(
    async (preset: Preset, customWeights?: [number, number, number, number]) => {
      setBusy(true);
      const t0 = performance.now();
      await tick();
      const pinned = current.tasks.filter((t) => t.pinned || t.taskStatus === "RUNNING" || t.taskStatus === "COMPLETED");
      const t = optimize({ orders, downs, preset, pinned, customWeights, equipments, products });
      const elapsed = Math.round(((performance.now() - t0) / 1000) * 100) / 100;
      setOrders((os) => os.map((o) => (o.status === "REGISTERED" ? { ...o, status: "PLANNED" } : o)));
      push(
        mkVersion(
          versions.length + 1,
          `AI 최적화 · ${preset}`,
          "ATC + 다중시작 탐색",
          preset,
          t,
          orders,
          downs,
          "REVIEW",
          elapsed,
        ),
      );
      setBusy(false);
    },
    [orders, downs, versions.length, current.tasks, equipments, products, push],
  );

  const rescheduleNow = useCallback(
    async (tNow: number, freeze: number, preset: Preset) => {
      setBusy(true);
      const t0 = performance.now();
      await tick();
      const t = reschedule(current.tasks, orders, downs, tNow, freeze, preset, equipments, products);
      const elapsed = Math.round(((performance.now() - t0) / 1000) * 100) / 100;
      setOrders((os) => os.map((o) => (o.status === "REGISTERED" ? { ...o, status: "PLANNED" } : o)));
      push(
        mkVersion(
          versions.length + 1,
          "긴급 재스케줄링",
          `동결 ${freeze}분 · 부분 재최적화`,
          preset,
          t,
          orders,
          downs,
          "REVIEW",
          elapsed,
        ),
      );
      setBusy(false);
    },
    [current.tasks, orders, downs, versions.length, equipments, products, push],
  );

  const generatePlanFromOrders = useCallback(
    (orderNos: string[], label = "신규 생산계획 초안 (FIFO)") => {
      const targetOrders = orders.filter((o) => orderNos.includes(o.no) && o.status !== "CANCELLED");
      const tasks = scheduleFIFO(targetOrders.length ? targetOrders : orders, downs, equipments, products);
      setOrders((os) =>
        os.map((o) => (orderNos.includes(o.no) && o.status === "REGISTERED" ? { ...o, status: "PLANNED" } : o)),
      );
      push(mkVersion(versions.length + 1, label, "FIFO 초기 전개", "BALANCED", tasks, orders, downs, "DRAFT", 0.09));
    },
    [orders, downs, equipments, products, versions.length, push],
  );

  const moveTask = useCallback(
    (taskCodeToMove: string, targetEq: string, targetLane: number, targetBlockStart: number) => {
      const res = moveTaskWithCascade(
        current.tasks,
        taskCodeToMove,
        targetEq,
        targetLane,
        targetBlockStart,
        orders,
        downs,
        equipments,
        products,
      );
      if (res.check.canDrop) {
        updateCurrentTasks(res.tasks, true);
      }
      return { cascadedCodes: res.cascadedCodes, check: res.check };
    },
    [current.tasks, orders, downs, equipments, products, updateCurrentTasks],
  );

  const togglePinTask = useCallback(
    (code: string) => {
      const next = current.tasks.map((t) => (t.code === code ? { ...t, pinned: !t.pinned } : t));
      updateCurrentTasks(next, true);
    },
    [current.tasks, updateCurrentTasks],
  );

  const updateTaskStatus = useCallback(
    (code: string, status: TaskStatus, goodQty?: number, defectQty?: number) => {
      const next = current.tasks.map((t) => {
        if (t.code !== code) return t;
        const gQty = goodQty !== undefined ? goodQty : status === "COMPLETED" ? t.qty : t.actualGoodQty ?? 0;
        const dQty = defectQty !== undefined ? defectQty : t.actualDefectQty ?? 0;
        return {
          ...t,
          taskStatus: status,
          actualGoodQty: gQty,
          actualDefectQty: dQty,
          pinned: status === "RUNNING" || status === "COMPLETED" ? true : Boolean(t.pinned),
        };
      });
      updateCurrentTasks(next, false);
    },
    [current.tasks, updateCurrentTasks],
  );

  const undo = useCallback(() => {
    if (!undoStack.length) return;
    const prevTasks = undoStack[undoStack.length - 1]!;
    setUndoStack((st) => st.slice(0, -1));
    setRedoStack((rt) => [...rt, current.tasks]);
    setVersions((vs) =>
      vs.map((v) =>
        v.id === current.id
          ? { ...v, tasks: prevTasks, kpi: evaluate(prevTasks, orders, downs, v.preset, undefined, undefined, equipments) }
          : v,
      ),
    );
  }, [undoStack, current.id, current.tasks, orders, downs, equipments]);

  const redo = useCallback(() => {
    if (!redoStack.length) return;
    const nextTasks = redoStack[redoStack.length - 1]!;
    setRedoStack((rt) => rt.slice(0, -1));
    setUndoStack((st) => [...st, current.tasks]);
    setVersions((vs) =>
      vs.map((v) =>
        v.id === current.id
          ? { ...v, tasks: nextTasks, kpi: evaluate(nextTasks, orders, downs, v.preset, undefined, undefined, equipments) }
          : v,
      ),
    );
  }, [redoStack, current.id, current.tasks, orders, downs, equipments]);

  const saveDraft = useCallback(() => {
    setIsDirty(false);
    try {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.removeItem(`eaps_unsaved_schedule_diff_${current.id}`);
      }
    } catch {
      // ignore
    }
  }, [current.id]);

  const value: Ctx = {
    scenario,
    role,
    theme,
    nowMin,
    freezeMin,
    orders,
    equipments,
    products,
    sdstMatrix,
    downs,
    versions,
    current,
    currentKpi,
    busy,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undoCount: undoStack.length,
    isDirty,
    setRole,
    toggleTheme,
    setNowMin,
    setFreezeMin,
    loadScenario,
    setCurrent: (id: string) => {
      setCurrentId(id);
      setUndoStack([]);
      setRedoStack([]);
      setIsDirty(false);
    },
    runOptimize,
    rescheduleNow,
    generatePlanFromOrders,
    addDowntime: (d) => {
      setDowns((x) => [...x, { ...d, id: `DT-${Date.now()}` }]);
      if (d.type === "BREAKDOWN") {
        setEquipments((eqs) => eqs.map((e) => (e.code === d.eq ? { ...e, status: "DOWN" } : e)));
      } else if (d.type === "PM") {
        setEquipments((eqs) => eqs.map((e) => (e.code === d.eq ? { ...e, status: "PM" } : e)));
      }
    },
    removeDowntime: (id) => {
      const target = downs.find((d) => d.id === id);
      setDowns((x) => x.filter((d) => d.id !== id));
      if (target) {
        setEquipments((eqs) => eqs.map((e) => (e.code === target.eq ? { ...e, status: "RUN" } : e)));
      }
    },
    addOrder: (o) => setOrders((x) => (x.some((y) => y.no === o.no) ? x : [...x, { status: "REGISTERED", splittable: true, ...o }])),
    updateOrder: (no, patch) => setOrders((x) => x.map((o) => (o.no === no ? { ...o, ...patch } : o))),
    cancelOrder: (no, reason) => {
      setOrders((x) => x.map((o) => (o.no === no ? { ...o, status: "CANCELLED", cancelReason: reason } : o)));
      const filteredTasks = current.tasks.filter((t) => t.orderNo !== no);
      updateCurrentTasks(filteredTasks, true);
    },
    updateEquipmentStatus: (eqCode, status) => {
      setEquipments((eqs) => eqs.map((e) => (e.code === eqCode ? { ...e, status } : e)));
    },
    updateEquipmentSpec: (eqCode, patch) => {
      setEquipments((eqs) => eqs.map((e) => (e.code === eqCode ? { ...e, ...patch } : e)));
    },
    updateProductRouting: (productCode, seq, patch) => {
      setProducts((ps) =>
        ps.map((p) =>
          p.code === productCode
            ? { ...p, routing: p.routing.map((r) => (r.seq === seq ? { ...r, ...patch } : r)) }
            : p,
        ),
      );
    },
    updateSdst: (fromFam, toFam, val) => {
      setSdstMatrix((m) => ({
        ...m,
        [fromFam]: { ...m[fromFam], [toFam]: Math.max(0, val) },
      }));
    },
    moveTask,
    togglePinTask,
    updateTaskStatus,
    undo,
    redo,
    saveDraft,
    confirm: (id) => {
      setVersions((vs) =>
        vs.map((v) => ({
          ...v,
          status: v.id === id ? "CONFIRMED" : v.status === "CONFIRMED" ? "SUPERSEDED" : v.status,
        })),
      );
      setOrders((os) => os.map((o) => (o.status === "PLANNED" || o.status === "REGISTERED" ? { ...o, status: "CONFIRMED" } : o)));
      setIsDirty(false);
    },
    cancelVersion: (id) => {
      setVersions((vs) => vs.map((v) => (v.id === id ? { ...v, status: "CANCELLED" } : v)));
    },
  };
  return <ApsContext.Provider value={value}>{children}</ApsContext.Provider>;
}

export function useAps() {
  const c = useContext(ApsContext);
  if (!c) throw new Error("useAps outside provider");
  return c;
}
