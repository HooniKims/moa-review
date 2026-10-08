# GitHub Releases 배포

배포 저장소는 `package.json`의 `build.publish`와 `app/updater.cjs`의 `RELEASE_REPOSITORY`에 지정합니다. 테스트가 두 설정의 일치를 확인합니다.

1. `package.json` 버전을 올리고 `npm install --package-lock-only`로 잠금 파일을 갱신합니다.
2. `CHANGELOG.md`에 `## 새버전` 항목과 변경 내용을 작성합니다.
3. 커밋한 뒤 원격 저장소에 push합니다.
4. `npm run release`를 실행합니다. 단위·Electron UI 테스트, Windows 설치형·ZIP 빌드, 해시 생성, GitHub 릴리즈 게시를 순서대로 수행합니다.
5. 첫 배포나 설치 UI 변경 시 실제 설치 파일을 열어 시작·진행·완료 화면, 완료 후 실행, 업데이트 확인을 검증합니다.

초안은 `npm run release -- --draft`로 만들 수 있습니다. 초안을 게시하기 전에는 자동 업데이트에 표시되지 않습니다. 한 번 게시한 버전의 파일을 교체하지 말고 버전을 올려 새 릴리즈를 만드세요. 과거 릴리즈는 그대로 보관합니다.

필수 첨부 파일: 설치 EXE, EXE.blockmap, ZIP, `latest.yml`, `SHA256SUMS.txt`. 특히 `latest.yml`과 해당 EXE는 같은 빌드 결과여야 합니다. `latest.yml`의 SHA-512 해시를 electron-updater가 다운로드 검증에 사용합니다.

설치형은 시작 15초 뒤와 4시간마다 새 버전을 확인합니다. 다운로드와 재시작 설치는 사용자가 선택합니다. 일반 앱 종료만으로 업데이트를 설치하지 않습니다. 설치 전 결과 저장 안내를 표시하고 검사 중 설치를 막습니다. ZIP은 GitHub 최신 릴리즈를 확인하고 다운로드 페이지로 안내합니다. 개발 실행에서는 네트워크 업데이트가 꺼집니다.

렌더러의 인터넷 연결은 계속 차단됩니다. 업데이트는 메인 프로세스의 별도 네트워크 세션을 사용하며 문서를 전송하지 않습니다. GitHub 인증 토큰을 앱에 넣지 않습니다. 공개 저장소는 사용자가 로그인하지 않아도 업데이트를 받을 수 있습니다.

설치 이미지는 `build/installer/desk-original.png`, 재현 프롬프트는 `build/installer/imagegen-prompt.txt`에 있습니다. `powershell -File build/prepare-installer-images.ps1`은 NSIS용 BMP를 다시 만듭니다. 프리텐다드는 공식 저장소 https://github.com/orioncactus/pretendard 에서 가져왔으며 라이선스는 `assets/Pretendard-LICENSE.txt`에 포함되어 있습니다.

업데이트 흐름 참고: https://github.com/HooniKims/edudock/blob/main/src/updater.cjs
