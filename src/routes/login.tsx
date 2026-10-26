import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAps, type ScenarioId } from "@/lib/aps/store";
import { ROLE_META, type Role } from "@/lib/aps/data";
import { PageHead, Panel, Pill } from "@/components/aps/ui";
import { Check, KeyRound, Lock, Play, Shield, UserCheck, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

const DEMO_ACCOUNTS: { role: Role; email: string; name: string; dept: string; desc: string }[] = [
  {
    role: "PLANNER",
    email: "planner@e-aps.kr",
    name: "김계획 책임",
    dept: "생산관리팀 (APS 총괄)",
    desc: "생산 주문 관리, 간트 스케줄 편집, AI 최적화 실행 및 계획 확정 권한 보유",
  },
  {
    role: "OPERATOR",
    email: "operator@e-aps.kr",
    name: "박현장 반장",
    dept: "SMT/조립 제조파트",
    desc: "현장 작업지시 착수/정지/완료 보고 및 설비 고장(DOWN)·비가동 등록 권한 보유",
  },
  {
    role: "ADMIN",
    email: "admin@e-aps.kr",
    name: "이보안 수석",
    dept: "스마트팩토리 IT팀",
    desc: "전 시스템 마스터 데이터(라우팅, SDST, 설비 스펙) 및 전체 기능 최고 권한 보유",
  },
  {
    role: "VIEWER",
    email: "viewer@e-aps.kr",
    name: "최경영 상무",
    dept: "사업본부 / 글로벌영업",
    desc: "대시보드 KPI, 납기 준수율 및 시뮬레이션 비교 결과 읽기 전용(Read-Only) 조회",
  },
];

function LoginPage() {
  const { role, setRole, loadScenario } = useAps();
  const navigate = useNavigate();

  const [email, setEmail] = useState("planner@e-aps.kr");
  const [password, setPassword] = useState("••••••••••••");

  const handleQuickRoleSelect = (targetRole: Role, acctName: string, acctEmail: string, desc: string) => {
    setRole(targetRole);
    setEmail(acctEmail);
    toast.success(`${acctName} (${ROLE_META[targetRole].label}) 계정으로 전환되었습니다.`, {
      description: desc,
    });
  };

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const matched = DEMO_ACCOUNTS.find((a) => a.email.toLowerCase() === email.trim().toLowerCase());
    if (matched) {
      setRole(matched.role);
      toast.success(`${matched.name} (${ROLE_META[matched.role].label}) 로그인 성공`);
    } else {
      toast.success(`현재 선택된 역할(${ROLE_META[role].label})로 접속합니다.`);
    }
    navigate({ to: "/" });
  };

  const handleScenarioLaunch = (s: ScenarioId, targetPath: "/" | "/schedules") => {
    loadScenario(s);
    toast.success(`시나리오 ${s} 데모 데이터 로드 완료`);
    navigate({ to: targetPath });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-2">
      <PageHead
        title="사용자 인증 및 역할별 권한(RBAC) 시연 센터 (SCR-AUTH-01)"
        desc="4가지 직무 역할(PLANNER · OPERATOR · ADMIN · VIEWER)에 따른 세분화된 권한 통제와 4대 데모 시나리오 원클릭 실행을 지원합니다."
      >
        <Pill tone="primary">현재 활성 권한: {ROLE_META[role].label}</Pill>
      </PageHead>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Left 5 cols: Standard Login Form */}
        <Panel
          className="lg:col-span-5"
          title={
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              <span>E-APS 통합 계정 로그인</span>
            </div>
          }
        >
          <form onSubmit={handleLoginSubmit} className="space-y-4 text-xs">
            <div>
              <label className="mb-1 block font-semibold">사내 이메일 계정 (ID)</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-9 w-full rounded-md border bg-background px-3 text-xs"
              />
            </div>

            <div>
              <label className="mb-1 block font-semibold">비밀번호 (Password)</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-9 w-full rounded-md border bg-background px-3 text-xs"
              />
            </div>

            <div className="rounded-md border bg-muted/40 p-3 text-[11px] text-muted-foreground">
              <div className="font-semibold text-foreground">시연 안내</div>
              <p className="mt-0.5">
                우측의 <b>원클릭 역할 전환 카드</b>를 클릭하면 별도 비밀번호 입력 없이 해당 직무 권한이 즉시 활성화되며, 화면 상단 헤더에서도 상시 전환할 수 있습니다.
              </p>
            </div>

            <button
              type="submit"
              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-xs hover:bg-primary/90"
            >
              <Lock className="h-3.5 w-3.5" />
              선택 계정으로 대시보드 접속
            </button>
          </form>
        </Panel>

        {/* Right 7 cols: 1-Click Role Switcher & RBAC Matrix */}
        <Panel
          className="lg:col-span-7"
          title={
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              <span>직무 역할(RBAC) 원클릭 전환 및 권한 매트릭스</span>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {DEMO_ACCOUNTS.map((acct) => {
              const meta = ROLE_META[acct.role];
              const isCurrent = role === acct.role;
              return (
                <div
                  key={acct.role}
                  onClick={() => handleQuickRoleSelect(acct.role, acct.name, acct.email, acct.desc)}
                  className={`cursor-pointer rounded-lg border p-3.5 text-xs transition-all ${
                    isCurrent
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "bg-background/60 hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-foreground">{meta.label}</span>
                    <Pill tone={isCurrent ? "primary" : "muted"}>
                      {isCurrent ? "현재 적용중" : meta.badge}
                    </Pill>
                  </div>
                  <div className="mt-1 text-[11px] font-medium text-muted-foreground">
                    {acct.name} · {acct.dept}
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">{acct.desc}</p>

                  <div className="mt-3 grid grid-cols-2 gap-1 border-t pt-2 text-[10px]">
                    <PermItem label="주문·계획 편집" ok={meta.canEditPlan} />
                    <PermItem label="AI 최적화·확정" ok={meta.canEditPlan} />
                    <PermItem label="현장 작업상태 제어" ok={meta.canEditTask} />
                    <PermItem label="마스터·라우팅 관리" ok={meta.canEditMaster} />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      {/* Quick Scenario Launcher for Evaluators */}
      <Panel
        title={
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-primary" />
            <span>평가위원 및 시연자용 4대 표준 검증 시나리오 원클릭 런처 (Chapter 6 MVP 데모)</span>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              {
                key: "A" as ScenarioId,
                title: "시나리오 A: 초기 기준 계획",
                desc: "10건 표준 주문의 FIFO 초기 스케줄 (납기 지연 및 셋업 비효율 존재)",
              },
              {
                key: "B" as ScenarioId,
                title: "시나리오 B: 납기 충돌 해결",
                desc: "긴급 주문 PO-0011 경합 상태에서 2-Phase 하이브리드 최적화로 병목 해소",
              },
              {
                key: "C" as ScenarioId,
                title: "시나리오 C: SMT-02 돌발 고장",
                desc: "Day 1 14:00~18:00 SMT-02 4시간 고장 발생 및 병렬 설비 우회 재스케줄링",
              },
              {
                key: "D" as ScenarioId,
                title: "시나리오 D: 긴급 주문 투입",
                desc: "현대차 울산공장 URGENT 주문(PO-0012) 중도 투입 및 동결 구간 보존 재스케줄링",
              },
            ] as const
          ).map((item) => (
            <div key={item.key} className="flex flex-col justify-between rounded-md border bg-background/60 p-3.5">
              <div>
                <div className="font-bold text-foreground">{item.title}</div>
                <p className="mt-1 text-[11px] text-muted-foreground">{item.desc}</p>
              </div>
              <div className="mt-3 flex gap-1.5">
                <button
                  onClick={() => handleScenarioLaunch(item.key, "/")}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded border bg-card py-1.5 text-[11px] font-semibold hover:bg-muted"
                >
                  대시보드 시연
                </button>
                <button
                  onClick={() => handleScenarioLaunch(item.key, "/schedules")}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded bg-primary py-1.5 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  <Play className="h-3 w-3" />
                  간트 시연
                </button>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function PermItem({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-1">
      {ok ? <Check className="h-3 w-3 text-success" /> : <X className="h-3 w-3 text-muted-foreground/50" />}
      <span className={ok ? "font-medium text-foreground" : "text-muted-foreground/60"}>{label}</span>
    </div>
  );
}
