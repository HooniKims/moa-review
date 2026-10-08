# 모아검토 1.1.0 검증

검증일: 2026-10-08. 실제 GitHub 릴리즈 게시 전 로컬 검증 기록이다.

| 항목 | 결과 |
| --- | --- |
| 문서 검사·업데이트 단위 테스트 | 38/38 통과 |
| 소스 실행의 기존 기능 | 9/9 통과 |
| 새 업데이트 대화상자 | 별도 UI 테스트 통과 |
| 패키지 Windows EXE UI | 10/10 통과, 42.3초 |
| 실제 설치된 Windows EXE UI | 10/10 통과, 29.3초 |
| 설치본 소스 대조 | 1.1.0 버전 및 app/·src/ 전체 코드 파일 바이트 일치 |
| 업데이트 메타데이터 | latest.yml의 버전·파일 크기·SHA-512가 배포 EXE와 일치 |
| 네이티브 설치 화면 | Computer Use로 시작·옵션·경로·진행·완료 페이지 직접 조작, 실행 선택에 따른 열기/닫기 전환 확인 |
| 완료 후 실행 | “모아검토 열기”로 설치본 창이 열리고 1.1.0 표시 확인 |
| 실제 electron-updater 네트워크 처리 | 로컬 HTTP 시험 서버에서 정상 SHA-512 파일 다운로드 성공, 잘못된 SHA-512 파일 거부 |
| 업데이트 공급자 설정 | 패키지의 app-update.yml에 HooniKims/moa-review 지정 확인 |
| 개발/설치형/ZIP 구분 | 개발 네트워크 차단, 설치형 수동 다운로드·설치, ZIP 릴리즈 안내 검증 |

단위 테스트는 상태 전환, 중복 확인 요청, 다운로드 실패 후 재시도, 누락된 릴리즈, 잘못된 버전 문자열, 일반 종료 시 자동 설치 비활성화를 검증했다. UI 진행률 테스트는 가상 이벤트로 화면 상태를 검증한다. 네트워크 통합 테스트는 실제 Electron HTTP executor와 electron-updater 다운로드·해시 검증을 사용하며 시험용 바이트 파일을 실행하지 않는다.

공개 GitHub의 새 버전을 확인하고 해당 EXE로 자동 교체하는 전체 경로는 공개 릴리즈 게시 후 별도 확인이 필요하다. 현재 기록을 실제 공개 업데이트 성공으로 해석하지 않는다.

설치본에서 실제 업데이트 메뉴를 열었으며, 저장소·릴리즈 게시 전에는 “배포된 업데이트 정보를 찾지 못했습니다”가 표시됨을 확인했다. 화면: `update-before-publish.png`. `screenshot-update.png`는 준비 완료 이벤트를 주입한 UI 테스트 화면이다.

설치 이미지: image_gen.imagegen 내장 생성. `build/installer/imagegen-prompt.txt`에 최종 프롬프트 보관. 2배 크기의 BMP로 변환하여 고해상도 화면에서 선명도를 유지한다.

## 배포 파일

```text
4eb06f7dbfdd79e3f713a565605b14cde478f598d1162c4f33747bcfa55ab407  MoaReview-Setup-1.1.0.exe
c59c9e57460045f8a75b55fd814f4bd174fcec0e40271def4959d18547955c23  MoaReview-Setup-1.1.0.exe.blockmap
092d9f061e4770e7b500638c69b1264935e50de946b754287e56abc3a29216b0  MoaReview-1.1.0-x64.zip
1702305b64e7c892111593d33a48cfa3e1d21599fc4692ea79ffdfde4998c69e  latest.yml
```

설치 EXE 116,330,890 bytes, ZIP 155,440,102 bytes. `latest.yml`의 SHA-512와 실제 설치 EXE의 일치를 확인했다.
