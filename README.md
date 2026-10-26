# E-APS | 전자 생산계획 및 스케줄링 최적화 시스템

전자 제조업(PCB/SMT 조립·검사·에이징·포장 라인)을 위한 **생산계획 관리 및 2-Phase 하이브리드 스케줄링 최적화 시스템(Advanced Planning & Scheduling)**입니다.

## 주요 기능

1. **생산계획 및 주문 관리 (`SCR-ORD-01`, `SCR-PLAN-01`)**
   - 공정별 예상 불량률($r_k$)을 반영한 목표 투입 수량($Q'_i$) 자동 산출 및 표준 로트 분할
   - 납기 여유지수($CR_i$) 및 종합 우선순위 가중치($W_i$) 실시간 계산
   - 생산계획 버전 생명주기(`DRAFT` → `REVIEW` → `CONFIRMED` / `SUPERSEDED`) 관리 및 5단계 공정 작업지시 제어

2. **2-Phase 하이브리드 스케줄링 최적화 및 인터랙티브 간트 (`SCR-SCHED-01`)**
   - **Phase 1**: ATC(Apparent Tardiness Cost) + 품목 전환 셋업(SDST) 휴리스틱 초기해 생성
   - **Phase 2**: 다중 시작 섭동 탐색(Multi-start Local Search)을 통한 납기 지연, 셋업 손실, 설비 부하 불균형 종합 최적화
   - 7대 Hard Constraint(`HC-001` ~ `HC-007`) 실시간 검증기, 드래그 앤 드롭 연쇄 밀림(Cascade Push), 설비 중심 / 주문·로트 중심 듀얼 간트 뷰

3. **설비·공정 마스터 및 돌발 고장 동적 재스케줄링 (`SCR-EQP-01`, `SCR-SIM-01`)**
   - 8대 생산설비 운전 상태(`RUN`, `IDLE`, `SETUP`, `PM`, `DOWN`) 및 효율 계수($\eta_m$) 제어
   - 설비 고장/점검 구간 등록 시 충돌 작업 실시간 탐지 및 동결 구간(`Freeze Horizon`) 보존 우회 재스케줄링
   - 최적화 전후(`Before vs After`) 6대 핵심 KPI 변화량($\Delta$) 및 상하 동기화 간트 비교 시뮬레이션

## 실행 방법

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev

# 단위 테스트 실행
npm test

# 프로덕션 빌드
npm run build
```
