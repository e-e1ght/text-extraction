# AI 채팅 txt 추출기

AI 채팅 사이트의 대화 내역을 txt 파일로 저장하는 크롬 확장 프로그램입니다.

## 지원 사이트

- 케이브덕 (caveduck.io)
- 로판 AI (rofan.ai)
- 티팟 (teapotchat.com)
- 엘린 (elyn.ai)
- 크랙 (crack.wrtn.ai)
- 유니챗 (univers.chat)

## 설치

1. 이 저장소를 받습니다.
   - git: `git clone https://github.com/e-e1ght/text-extraction.git`
   - 또는 **Code → Download ZIP**으로 받은 뒤 압축을 풉니다.
2. 크롬 주소창에 `chrome://extensions`를 입력합니다.
3. 오른쪽 위 **개발자 모드**를 켭니다.
4. **압축해제된 확장 프로그램을 로드합니다**를 누르고 받은 폴더를 선택합니다.

## 사용법

1. 지원 사이트의 대화방을 엽니다.
2. 툴바의 확장 아이콘을 누르면 화면 오른쪽 위에 패널이 열립니다.
3. **이 대화방 추출하기**를 누르면 다운로드 폴더에 `캐릭터이름_날짜.txt`가 저장됩니다.

## 업데이트

GitHub에 새 버전이 올라오면 툴바 아이콘에 `NEW` 배지가 붙고, 패널 위쪽에 안내와 GitHub 링크가 표시됩니다. (하루 한 번, 그리고 패널을 열 때 확인합니다. 자동으로 설치되지는 않습니다.)

- git으로 받았다면 폴더에서 `git pull`을 실행합니다.
- ZIP으로 받았다면 새 ZIP을 받아 기존 폴더에 덮어씁니다.

그다음 `chrome://extensions`에서 이 확장의 **새로고침(↻)** 버튼을 누릅니다.

## 새 사이트 추가하기

1. `adapters/`에 사이트용 파일을 추가하고 `registerChatAdapter({...})`로 등록합니다. 형식은 `adapters/registry.js` 주석을 참고하세요.
2. `manifest.json`의 `host_permissions`와 `content_scripts.matches`에 도메인을 추가합니다.
3. `content_scripts.js`와 `background.js`의 `CONTENT_FILES`에 새 파일을 추가합니다.
