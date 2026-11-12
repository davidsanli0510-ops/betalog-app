# 베타로그 (BetaLog)

클라이머를 위한 **리플레이 카메라**와 **행보드 타이머** 앱이에요.

- **리플레이**: 카메라를 켜두면 최근 2분을 기억했다가, 버튼을 누른 순간부터 거꾸로 1분 / 1분 30초 / 2분을 골라 클립으로 남겨요. 배율·화질(최대 4K) 조절, 타이머 탭에 가도 녹화는 계속돼요
- **타이머**: 행보드 리피터·맥스행·타바타
- **내 폰에만 저장**: 로그인이 없어요. 클립은 각자의 폰에만 저장되고 어디에도 올라가지 않아요. 남길 클립은 사진첩에 저장하세요.

## 설치

| 기기 | 방법 |
|---|---|
| 안드로이드 | [Releases](../../releases/latest)에서 `betalog-x.y.z.apk`를 폰으로 받아 설치해요. '출처를 알 수 없는 앱' 설치를 허용해야 해요. 새 버전도 같은 방법으로 덮어 설치하면 기록이 유지돼요. |
| 아이폰 | 사파리로 웹 버전 `https://<GitHub 아이디>.github.io/betalog-app/`을 열고 공유 → **홈 화면에 추가**. 홈 화면에 추가해야 아이폰이 7일 뒤 데이터를 지우지 않아요. |

## 구조

```
frontend/   React + TypeScript (Vite). Capacitor로 안드로이드 앱(frontend/android)을 만들어요
.github/    APK 빌드·릴리스, 웹(GitHub Pages) 배포
```

## 개발

```bash
cd frontend && npm install && npm run dev        # http://localhost:5173
cd frontend && npm run cap:sync && npx cap open android   # Android Studio로 열기
```

## 앱 서명

APK는 GitHub Secrets의 키로 서명돼요: `KEYSTORE_B64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`. **키를 잃어버리면 기존 앱 위에 업데이트할 수 없으니** 키 파일을 안전한 곳에 따로 보관하세요. 키는 저장소에 올리지 않아요.

## 보안

- 서버가 없어요. 클립과 설정은 폰 안(브라우저 저장소)에만 있고 네트워크로 나가지 않아요.
- 웹 앱은 콘텐츠 보안 정책(CSP)으로 이 사이트의 코드만 실행하고, 다른 서버와는 통신하지 않아요(글꼴 제외).
- 서명 키(keystore)와 비밀번호는 저장소에 올리지 말고 GitHub Secrets에만 넣으세요.
