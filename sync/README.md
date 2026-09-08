# Growth OS Sync

1인용 습관 트래커(Growth OS)의 상태 동기화 백엔드. FastAPI + SQLite.

## 설계 원칙
- **스코프 계약**: 엔드포인트 2개(GET/PUT `/state`), 헤더 토큰 인증 1개, 테이블 1개. 유저 시스템·JWT·웹소켓 없음 — 유저가 1명이므로.
- **오프라인 우선**: 클라이언트가 localStorage에 전체 상태를 캐시하고 저장 시마다 PUT. 서버 디스크가 초기화돼도(무료 호스팅 재시작) 다음 저장 때 클라이언트가 자동 복구한다.
- **충돌 정책**: Last-Write-Wins. 단일 사용자 전제이므로 "동시에 두 기기에서 편집하지 않는다"는 운영 원칙으로 갈음한다.

## 로컬 실행
```bash
pip install -r requirements.txt
SYNC_TOKEN=my-secret uvicorn main:app --reload
```

## 배포 (Render 무료 티어 기준)
1. 이 폴더를 GitHub 리포지토리로 push
2. Render → New Web Service → 리포지토리 연결
3. Build: `pip install -r requirements.txt` / Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. 환경변수 `SYNC_TOKEN`에 긴 무작위 문자열 설정
5. 프런트엔드의 `SYNC_URL`, `SYNC_TOKEN`에 동일 값 입력

## 확인
```bash
curl https://<서비스URL>/health
```