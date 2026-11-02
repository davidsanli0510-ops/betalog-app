# 베타로그 (BetaLog)

클라이머가 푼 문제를 **사진·영상과 함께 색상(난이도)별로 기록**하는 앱이에요. 더클라임 지점과 색상 체계를 기준으로 만들었어요.

- **내 문제**: 사진에 홀드 순서(베타) 표시, 시도·완등·플래시 기록, 영상 보관
- **리플레이**: 카메라를 켜두면 최근 20~45초만 기억했다가, 버튼을 누르면 그 장면을 클립으로 남겨요
- **영상 비교**: 내 시도와 완등자 영상을 같은 속도로 나란히 재생
- **기록**: 주별 최고 난이도, 색상별 완등 수, 플래시 비율
- **타이머**: 행보드 리피터·맥스행·타바타
- **동기화**: 로그인하면 기록이 서버에 저장돼요. 서버가 없거나 연결이 안 돼도 폰에서 모두 동작하고, 연결되면 자동으로 올라가요(오프라인 우선). 사진·영상은 폰에만 남아요.

## 설치

| 기기 | 방법 |
|---|---|
| 안드로이드 | [Releases](../../releases/latest)에서 `betalog-x.y.z.apk`를 폰으로 받아 설치해요. '출처를 알 수 없는 앱' 설치를 허용해야 해요. 새 버전도 같은 방법으로 덮어 설치하면 기록이 유지돼요. |
| 아이폰 | 사파리로 웹 버전(`https://<아이디>.github.io/betalog-app/`)을 열고 공유 → **홈 화면에 추가**. 웹 버전은 http 서버와 동기화할 수 없어서, 서버를 https 클라우드로 옮기기 전까지는 폰 안에서만 기록돼요. |

## 서버 실행 (PC)

동기화가 필요할 때만 켜면 돼요. 폰과 PC가 **같은 와이파이**에 있어야 연결돼요.

1. **Java 17 이상**을 설치해요. 예: [Adoptium Temurin](https://adoptium.net/) 17 또는 21.
2. 서버를 준비해요. 둘 중 하나를 고르세요.
   - [Releases](../../releases)에서 `betalog-server.jar`(서버 1.0.x)를 받아요.
   - 또는 코드로 직접 빌드해요: `backend` 폴더에서 `./gradlew bootJar` (윈도우는 `gradlew.bat bootJar`) → `backend/build/libs/betalog-server.jar`
3. 실행해요.
   ```
   java -jar betalog-server.jar
   ```
   처음 실행하면 jar가 있는 곳에 `data/` 폴더가 생기고, 기록(DB)과 로그인 키가 여기에 저장돼요. **이 폴더를 지우면 서버의 기록이 사라져요.**
   윈도우에서 방화벽 허용 창이 뜨면 **개인 네트워크**를 허용하세요.
4. PC의 내부 IP를 확인해요.
   - 윈도우: 명령 프롬프트에서 `ipconfig` → "IPv4 주소" (예: 192.168.0.10)
   - 맥: 시스템 설정 → 네트워크 → 와이파이 → 세부사항 → IP 주소
5. 앱에서 상단의 **로그인** 버튼 → 서버 주소에 `192.168.0.10:8080`처럼 입력 → **연결 확인** → 회원가입.

PC 브라우저에서 `http://localhost:8080`을 열면 같은 웹 앱이 열려요(카메라 기능 제외).

### 설정 (환경 변수, 선택)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | 8080 | 서버 포트 |
| `DATA_DIR` | ./data | 로그인 키를 둘 폴더 |
| `DB_URL` / `DB_USER` / `DB_PASSWORD` | H2 파일 DB(`./data/betalog`) | PostgreSQL로 옮길 때 `jdbc:postgresql://...` |
| `JWT_SECRET` | 자동 생성 | 32자 이상. 비워 두면 `data/jwt.key`를 만들어 써요 |
| `CORS_ORIGINS` | `*` | 허용할 앱 주소(쉼표로 구분) |

## 구조

```
frontend/   React + TypeScript (Vite). Capacitor로 안드로이드 앱(frontend/android)을 만들어요
backend/    Spring Boot 3 (Java 17): 로그인(JWT), 동기화 API, H2 파일 DB
.github/    APK 빌드·릴리스, 웹(GitHub Pages) 배포, 서버 테스트·jar 배포
```

### API 요약

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/health` | 서버 확인 |
| POST | `/api/auth/signup` | `{username, password, displayName}` → `{token, username, displayName}` |
| POST | `/api/auth/login` | `{username, password}` → 같은 응답 |
| GET | `/api/me` | 내 정보 (Bearer 토큰) |
| POST | `/api/sync` | `{since, problems[], attempts[]}` → `{cursor, problems[], attempts[]}` |

동기화 규칙: 폰이 바꾼 행을 올리고, 서버에서 `since` 이후 바뀐 행을 받아요. 같은 행을 두 곳에서 고치면 **나중에 고친 쪽**(`updatedAt`)이 이겨요. 삭제는 `deleted: true`로 전달돼요.

## 개발

```bash
# 프론트
cd frontend && npm install && npm run dev        # http://localhost:5173
# 서버
cd backend && ./gradlew bootRun                  # http://localhost:8080
# 안드로이드 (Android Studio)
cd frontend && npm run cap:sync && npx cap open android
```

## 앱 서명

APK는 GitHub Secrets의 키로 서명돼요: `KEYSTORE_B64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`. **키를 잃어버리면 기존 앱 위에 업데이트할 수 없으니** 키 파일을 안전한 곳에 따로 보관하세요. 키는 저장소에 올리지 않아요.
